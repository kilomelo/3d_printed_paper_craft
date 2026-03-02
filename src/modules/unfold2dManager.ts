// 展开组 2D 管理器：监听面增删事件，按需查询角度索引并维护组内面/边的缓存，后续可用于 2D 重建。
import {
  BufferGeometry,
  Mesh,
  Vector3,
  Vector2,
  Color,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  BufferAttribute,
  InterleavedBufferAttribute,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { EdgeRecord, getFaceVertexIndices } from "./model";
import { sharedEdgeIsSeam } from "./groups";
import { AngleIndex } from "./geometry";
import { appEventBus } from "./eventBus";
import type { Renderer2DContext } from "./renderer2d";
import {
  createUnfoldFaceMaterial,
  createWarnningMaterial,
  createUnfoldEdgeLineFoldinMaterial,
  createUnfoldEdgeLineFoldoutMaterial,
  ensurePlanarUVWorldScale, ensurePlanarUVScreenSpaceCSS } from "./materials";
import type {
  Point2D,
  Point3D,
  Vec3,
  PolygonWithEdgeInfo as PolygonData,
  PolygonEdgeInfo,
} from "../types/geometryTypes";
import { p3, v3 } from "../types/geometryTypes";
import {
  isCounterClockwiseFromFront,
  pointKey3D,
  edgeKey3D,
  sub3,
  cross3,
  norm3,
  mul3,
  dot3,
  bisectorPlaneOfDihedral,
  triHasAreaIntersection,
} from "./mathUtils";
import { getSettings } from "./settings";
import { disposeGroupDeep } from "./threeUtils";
import { t } from "./i18n";

// 记录“3D → 2D”变换矩阵，后续将按组树关系进行累乘展开。
type TransformTree = Map<number, Matrix4>;
type TransformStore = Map<number, TransformTree>;

export type EdgeCache = { origPos: [Vector3, Vector3]; unfoldedPos: [Vector3, Vector3]; faceId: number };

export function createUnfold2dManager(
  angleIndex: AngleIndex,
  renderer2d: Renderer2DContext,
  getGroupIds: () => number[],
  getGroupFaces: (id: number) => Set<number> | undefined,
  getPreviewGroupId: () => number,
  getFaceGroupMap: () => Map<number, number | null>,
  getGroupColor: (id: number) => THREE.Color | undefined,
  getGroupVisibility: (id: number) => boolean,
  getGroupTreeParent: (id: number) => Map<number, number | null> | undefined,
  getFaceToEdges: () => Map<number, [number, number, number]>,
  getEdgesArray: () => EdgeRecord[],
  getVertexKeyToPos: () => Map<string, Vector3>,
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>,
  getEdgeKeyToId: () => Map<string, number>,
  getThirdVertexKeyOnFace: (edgeId: number, faceId: number) => string | undefined,
  getGroupPlaceAngle: (id: number) => number | undefined,
  log: (message: string | number, tone?: import("./log").LogTone) => void,
) {
  const transformStore: TransformStore = new Map();
  const transformCache: Map<string, Matrix4> = new Map();
  let cachedSnapped: { groupId: number; tris: SnappedTri[] } | null = null;
  const groupIntersected: Map<number, boolean> = new Map();
  const groupEdgesCache: Map<
    number,
    { edges: Map<number, EdgeCache[]>; medianEdgeLength: number }
  > = new Map();
  const tmpVec = new Vector3();
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const tmpD = new Vector3();
  const tmpE = new Vector3();
  // const basisU = new Vector3();
  // const basisV = new Vector3();
  const normal = new Vector3();
  const targetNormal = new Vector3(0, 0, 1);
  const quat = new Quaternion();
  const anchor = new Vector3();
  const axis = new Vector3();
  const transformKey = (a: number, b: number) => `${a}->${b}`;
  let lastBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  const clearScene = () => {
    disposeGroupDeep(renderer2d.root);
    renderer2d.root.rotation.set(0, 0, 0);
    renderer2d.root.updateMatrixWorld(true);
    groupEdgesCache.clear();
    groupIntersected.clear();
  };

  const computeFaceNormal = (faceId: number, out: Vector3) => {
    const mapping = getFaceIndexMap().get(faceId);
    if (!mapping) {
      out.set(0, 0, 1);
      return;
    }
    const mesh = mapping.mesh;
    const geom = mesh.geometry;
    const pos = geom.getAttribute("position");
    if (!pos) {
      out.set(0, 0, 1);
      return;
    }
    const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
    mesh.updateWorldMatrix(true, false);
    tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mesh.matrixWorld);
    tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mesh.matrixWorld);
    tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mesh.matrixWorld);
    out.subVectors(tmpB, tmpA).cross(tmpC.sub(tmpA)).normalize();
  };

  const findSharedEdge = (parentId: number, childId: number): number | null => {
    const faceToEdges = getFaceToEdges();
    const edgesArray = getEdgesArray();
    const childEdges = faceToEdges.get(childId);
    if (!childEdges) return null;
    for (const eid of childEdges) {
      const rec = edgesArray[eid];
      if (rec && rec.faces.has(parentId)) return eid;
    }
    return null;
  };

  const buildChildTransform = (groupId: number, parentId: number, childId: number) => {
    const cached = transformCache.get(transformKey(parentId, childId));
    if (cached) {
      setFaceTransform(groupId, childId, cached);
      return;
    }
    const sharedEdgeId = findSharedEdge(parentId, childId);
    if (sharedEdgeId === null) {
      return;
    }
    const edgesArray = getEdgesArray();
    const edge = edgesArray[sharedEdgeId];
    if (!edge) return;
    const vpos = getVertexKeyToPos();
    const v1 = vpos.get(edge.vertices[0]);
    const v2 = vpos.get(edge.vertices[1]);
    if (!v1 || !v2) return;
    const nParent = tmpD;
    const nChild = tmpE;
    computeFaceNormal(parentId, nParent);
    computeFaceNormal(childId, nChild);

    axis.copy(v2).sub(v1).normalize();
    const projParent = nParent.clone().sub(axis.clone().multiplyScalar(nParent.dot(axis))).normalize();
    const projChild = nChild.clone().sub(axis.clone().multiplyScalar(nChild.dot(axis))).normalize();
    if (projParent.lengthSq() === 0 || projChild.lengthSq() === 0) return;
    const cross = projChild.clone().cross(projParent);
    const sign = Math.sign(axis.dot(cross));
    const cos = projChild.dot(projParent);
    const ang = Math.atan2(Math.min(Math.max(cross.length(), -1), 1) * sign, cos);

    const rot = new Matrix4().makeRotationAxis(axis, ang);
    const toOrigin = new Matrix4().makeTranslation(-v1.x, -v1.y, -v1.z);
    const back = new Matrix4().makeTranslation(v1.x, v1.y, v1.z);
    const mat = new Matrix4().multiplyMatrices(back, new Matrix4().multiplyMatrices(rot, toOrigin));
    transformCache.set(transformKey(parentId, childId), mat.clone());
    transformCache.set(transformKey(childId, parentId), mat.clone().invert());
    setFaceTransform(groupId, childId, mat);
  };

  const getMeshVertexBounds = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    renderer2d.root.updateMatrixWorld(true);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    renderer2d.root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh as any).isMesh) return;
      if (mesh.userData.main !== true) return;
      const posAttr = mesh.geometry.getAttribute("position");
      if (!posAttr) return;
      for (let i = 0; i < posAttr.count; i++) {
        tmpVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(mesh.matrixWorld);
        minX = Math.min(minX, tmpVec.x);
        maxX = Math.max(maxX, tmpVec.x);
        minY = Math.min(minY, tmpVec.y);
        maxY = Math.max(maxY, tmpVec.y);
      }
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return lastBounds ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    lastBounds = { minX, maxX, minY, maxY };
    return lastBounds;
  };

  const getLastBounds = () => lastBounds;

  const buildTransformsForGroup = (groupId: number) => {
    const parentMap = getGroupTreeParent(groupId);
    if (!parentMap) return;
    // 根已在 buildRootTransforms 设置，这里做 BFS，子面依赖父面
    const queue: number[] = [];
    parentMap.forEach((parent, faceId) => {
      if (parent === null) queue.push(faceId);
    });
    while (queue.length) {
      const cur = queue.shift()!;
      parentMap.forEach((parent, fid) => {
        if (parent !== cur) return;
        buildChildTransform(groupId, parent, fid);
        queue.push(fid);
      });
    }
  };

  const clearTransforms = () => {
    transformStore.clear();
    transformCache.clear();
  };

  type SnappedTri = {
    faceId: number;
    tri: [Vector3, Vector3, Vector3];
    vertexKeys: string[];
    edgeIds: number[];
    bbox: { minX: number; maxX: number; minY: number; maxY: number };
    intersected?: boolean;
  };

  const buildSnappedTris = (groupId: number, force: boolean = false): SnappedTri[] => {
    if (cachedSnapped?.groupId === groupId && cachedSnapped && !force) {
      return cachedSnapped.tris;
    }
    const faces = getGroupFaces(groupId);
    if (!faces || faces.size === 0) return [];
    clearTransforms();
    buildRootTransforms(groupId);
    buildTransformsForGroup(groupId);
    const faceToEdges = getFaceToEdges();
    const faceIndexMap = getFaceIndexMap();
    const parentMap = getGroupTreeParent(groupId);
    const makeVertexKey = (pos: BufferAttribute | InterleavedBufferAttribute, idx: number) =>
      pointKey3D([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
    const snap = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v);
    const tris: SnappedTri[] = [];
    let hasIntersect = false;
    faces.forEach((fid) => {
      const tri = faceTo2D(groupId, fid);
      if (!tri) return;
      const [a, b, c] = tri;
      a.x = snap(a.x); a.y = snap(a.y);
      b.x = snap(b.x); b.y = snap(b.y);
      c.x = snap(c.x); c.y = snap(c.y);
      const rawEdges = faceToEdges.get(fid);
      const edgeIds: number[] = rawEdges ? Array.from(rawEdges) : [];
      const vertexKeys: string[] = [];
      const mapping = faceIndexMap.get(fid);
      if (mapping) {
        const geom = mapping.mesh.geometry;
        const pos = geom.getAttribute("position");
        if (pos) {
          const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
          vertexKeys.push(makeVertexKey(pos, ia), makeVertexKey(pos, ib), makeVertexKey(pos, ic));
        }
      }
      const minX = Math.min(a.x, b.x, c.x);
      const maxX = Math.max(a.x, b.x, c.x);
      const minY = Math.min(a.y, b.y, c.y);
      const maxY = Math.max(a.y, b.y, c.y);
      const newTri: SnappedTri = {
        faceId: fid,
        tri: [a.clone(), b.clone(), c.clone()],
        vertexKeys,
        edgeIds,
        bbox: { minX, maxX, minY, maxY },
      };
      const newTri2d: [[number, number], [number, number], [number, number]] = [
        [a.x, a.y],
        [b.x, b.y],
        [c.x, c.y],
      ];
      tris.forEach((t) => {
        // 跳过展开树中的父子三角形（共边，不视为自交）；仅共享顶点仍需检测
        if (parentMap) {
          const parentOfNew = parentMap.get(fid);
          const parentOfOld = parentMap.get(t.faceId);
          if (parentOfNew === t.faceId || parentOfOld === fid) return;
        }
        // bbox 预检查
        const bb = t.bbox;
        if (
          newTri.bbox.maxX < bb.minX - 1e-6 ||
          newTri.bbox.minX > bb.maxX + 1e-6 ||
          newTri.bbox.maxY < bb.minY - 1e-6 ||
          newTri.bbox.minY > bb.maxY + 1e-6
        ) {
          return;
        }
        const tri2d: [[number, number], [number, number], [number, number]] = [
          [t.tri[0].x, t.tri[0].y],
          [t.tri[1].x, t.tri[1].y],
          [t.tri[2].x, t.tri[2].y],
        ];
        if (triHasAreaIntersection(tri2d, newTri2d)) {
          t.intersected = true;
          newTri.intersected = true;
          hasIntersect = true;
        }
      });
      tris.push(newTri);
    });
    if (!tris.length) return [];
    groupIntersected.set(groupId, hasIntersect);
    if (hasIntersect) {
      log(t("log.group.selfIntersectTri"), "error");
    }
    cachedSnapped = { groupId, tris };
    return cachedSnapped.tris;
  };

  const ensureTransformTree = (groupId: number): TransformTree => {
    if (!transformStore.has(groupId)) {
      transformStore.set(groupId, new Map());
    }
    return transformStore.get(groupId)!;
  };

  const setRootTransform = (groupId: number, faceId: number, matrix: Matrix4) => {
    const tree = ensureTransformTree(groupId);
    tree.set(faceId, matrix.clone());
  };

  const setFaceTransform = (groupId: number, faceId: number, matrix: Matrix4) => {
    const tree = ensureTransformTree(groupId);
    tree.set(faceId, matrix.clone());
  };

  // 按叶到根依次收集当前存储的变换矩阵（后续展开时再进行累乘）
  const getTransformChain = (groupId: number, faceId: number): Matrix4[] => {
    const chain: Matrix4[] = [];
    const parentMap = getGroupTreeParent(groupId);
    const tree = transformStore.get(groupId);
    if (!parentMap || !tree) return chain;
    let cur: number | null | undefined = faceId;
    while (cur !== null && cur !== undefined) {
      const m = tree.get(cur);
      if (m) chain.push(m.clone());
      cur = parentMap.get(cur) ?? null;
    }
    return chain;
  };

  const faceTo2D = (groupId: number, faceId: number): [Vector3, Vector3, Vector3] | null => {
    const chain = getTransformChain(groupId, faceId);
    if (!chain.length) return null;
    const faceIndexMap = getFaceIndexMap();
    const mapping = faceIndexMap.get(faceId);
    if (!mapping) return null;
    const mesh = mapping.mesh;
    const geom = mesh.geometry;
    const pos = geom.getAttribute("position");
    if (!pos) return null;
    const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
    mesh.updateWorldMatrix(true, false);
    tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mesh.matrixWorld);
    tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mesh.matrixWorld);
    tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mesh.matrixWorld);

    const applyChain = (v: Vector3) => {
      const out = v.clone();
      chain.forEach((m) => out.applyMatrix4(m));
      return out;
    };
    const a2 = applyChain(tmpA);
    const b2 = applyChain(tmpB);
    const c2 = applyChain(tmpC);
    return [a2, b2, c2];
  };

  const buildRootTransforms = (groupId: number) => {
    const parentMap = getGroupTreeParent(groupId);
    if (!parentMap) return;
    parentMap.forEach((parent, faceId) => {
      if (parent !== null) return;
      const faceIndexMap = getFaceIndexMap();
      const mapping = faceIndexMap.get(faceId);
      if (!mapping) return;
      const mesh = mapping.mesh;
      const geom = mesh.geometry;
      const pos = geom.getAttribute("position");
      if (!pos) return;
      const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
      mesh.updateWorldMatrix(true, false);
      tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mesh.matrixWorld);
      tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mesh.matrixWorld);
      tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mesh.matrixWorld);

      normal.crossVectors(tmpB.clone().sub(tmpA), tmpC.clone().sub(tmpA)).normalize();
      if (normal.lengthSq() === 0) return;
      anchor.copy(tmpA);

      quat.setFromUnitVectors(normal, targetNormal);
      const rot = new Matrix4().makeRotationFromQuaternion(quat);
      const toOrigin = new Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z);
      const back = new Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z);
      const rootMat = new Matrix4().multiplyMatrices(back, new Matrix4().multiplyMatrices(rot, toOrigin));
      setRootTransform(groupId, faceId, rootMat);
    });
  };

  const rebuildGroup2D = (groupId: number, force: boolean = false) => {
    clearScene();
    const tris = buildSnappedTris(groupId, force);
    if (tris.length === 0) {
      renderer2d.bboxRuler.hide();
      return;
    }
    const positions: number[] = [];
    const colors: number[] = [];
    tris.forEach(({ faceId, tri, intersected }) => {
      paintFace(groupId, faceId, tri, intersected, positions, colors);
    });
    if (positions.length === 0) {
      renderer2d.bboxRuler.hide();
      return;
    }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geom.setAttribute("color", new Float32BufferAttribute(colors, 4));
    const indices: number[] = [];
    for (let i = 0; i < positions.length / 3; i += 3) {
      indices.push(i, i + 1, i + 2);
    }
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mesh = new Mesh(geom, createUnfoldFaceMaterial());
    const meshIntersect = new Mesh(geom, createWarnningMaterial(4, Math.PI * 0.25 - (getGroupPlaceAngle(groupId)??0), 0.15));
    mesh.userData.groupId = groupId;
    mesh.userData.main = true;
    renderer2d.root.add(mesh);
    renderer2d.root.add(meshIntersect);

    // 缓存展开边信息（未应用 placeAngle）
    const edgeCache = new Map<number, EdgeCache[]>();
    const edgeLengths: number[] = [];
    const edgesArray = getEdgesArray();
    const vertexKeyToPos = getVertexKeyToPos();
    const faceToEdges = getFaceToEdges();
    const faceIndexMap = getFaceIndexMap();
    const makeVertexKey = (pos: BufferAttribute | InterleavedBufferAttribute, idx: number) =>
      pointKey3D([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);

    tris.forEach(({ faceId: fid, tri }) => {
      const [a, b, c] = tri;
      const edgeIds = faceToEdges.get(fid) ?? [];
      const keyTo2D = new Map<string, Vector3>();
      const mapping = faceIndexMap.get(fid);
      if (mapping) {
        const geom = mapping.mesh.geometry;
        const pos = geom.getAttribute("position");
        if (pos) {
          const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
          keyTo2D.set(makeVertexKey(pos, ia), new Vector3(a.x, a.y, 0));
          keyTo2D.set(makeVertexKey(pos, ib), new Vector3(b.x, b.y, 0));
          keyTo2D.set(makeVertexKey(pos, ic), new Vector3(c.x, c.y, 0));
        }
      }
      edgeIds.forEach((eid) => {
        const edgeCacheList: EdgeCache[] = edgeCache.has(eid) ? edgeCache.get(eid)! : [];
        const edgeRec = edgesArray[eid];
        if (!edgeRec) return;
        const [k1, k2] = edgeRec.vertices;
        const v1 = vertexKeyToPos.get(k1);
        const v2 = vertexKeyToPos.get(k2);
        const p1 = keyTo2D.get(k1);
        const p2 = keyTo2D.get(k2);
        if (!v1 || !v2 || !p1 || !p2) return;
        edgeCacheList.push({
          origPos: [v1.clone(), v2.clone()],
          unfoldedPos: [p1.clone(), p2.clone()],
          faceId: fid,
        });
        edgeCache.set(eid, edgeCacheList);
        edgeLengths.push(p1.distanceTo(p2));
      });
    });
    const medianEdgeLength = (() => {
      if (!edgeLengths.length) return 0;
      const sorted = edgeLengths.slice().sort((m, n) => m - n);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) * 0.5 : sorted[mid];
    })();
    const foldinDashScale = medianEdgeLength > 1e-6 ? 4 / medianEdgeLength : 1;
    groupEdgesCache.set(groupId, { edges: edgeCache, medianEdgeLength });
    renderer2d.refreshSeamConnectLines(foldinDashScale);
    // 展开边线段渲染
    const sizeVec = new Vector2();
    renderer2d.renderer.getSize(sizeVec);
    const { minFoldAngleThreshold } = getSettings();
    // 与 getGroupPolygonsData 中的共面合并规则保持一致：
    // 仅当一条边确实是双面共享边，且其二面角距离 180° 的偏差不超过阈值时，
    // 才认为它不会形成折痕，因此在 2D 预览中不绘制该线段。
    // 外轮廓边只有一个相邻面，必须继续显示，不能因为 fallback angle = PI 而被误隐藏。
    const coplanarThresholdRad = (minFoldAngleThreshold * Math.PI) / 180;
    edgeCache.forEach((rec, eid) => {
      if (!rec || rec.length === 0) return;
      const edgeRec = edgesArray[eid];
      const angleRad = angleIndex.getAngle(eid);
      const isSeamEdge =
        !!edgeRec &&
        edgeRec.faces.size === 2 &&
        sharedEdgeIsSeam(...Array.from(edgeRec.faces) as [number, number]);
      const isCoplanarInnerEdge =
        !!edgeRec &&
        edgeRec.faces.size === 2 &&
        !isSeamEdge &&
        Math.abs(angleRad - Math.PI) <= coplanarThresholdRad;
      if (isCoplanarInnerEdge) return;
      rec.forEach((unfoldedEdge) => {
        const p1 = unfoldedEdge.unfoldedPos[0];
        const p2 = unfoldedEdge.unfoldedPos[1];
        const lineGeom = new LineSegmentsGeometry();
        lineGeom.setPositions(new Float32Array([p1.x, p1.y, 0, p2.x, p2.y, 1]));
        const mat =
        angleRad > Math.PI + 1e-4
        ? createUnfoldEdgeLineFoldinMaterial({ width: sizeVec.x || 1, height: sizeVec.y || 1 }, foldinDashScale)
        : createUnfoldEdgeLineFoldoutMaterial({ width: sizeVec.x || 1, height: sizeVec.y || 1 });
        const line = new LineSegments2(lineGeom, mat);
        line.computeLineDistances();
        renderer2d.root.add(line);
      });
    });

    renderer2d.root.rotateOnAxis(new Vector3(0, 0, 1), getGroupPlaceAngle(groupId)??0);
    renderer2d.root.updateMatrixWorld(true);
    const bounds = getMeshVertexBounds();
    const maxDim = Math.max(Math.abs(bounds.maxX - bounds.minX), Math.abs(bounds.maxY - bounds.minY));
    ensurePlanarUVWorldScale(geom, maxDim / 15, "xy");
    updateCamera(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY);
    updateBBoxRuler(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY);
  };

  function updateCamera(minX: number, maxX: number, minY: number, maxY: number, zoomInOnly: boolean = false) {
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    renderer2d.camera.position.x = centerX;
    renderer2d.camera.position.y = centerY;
    // 根据展开尺寸自动调整正交相机缩放，避免小模型看不到
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const pad = 1.1; // 留出边距
    const viewW = (renderer2d.renderer.domElement.clientWidth || renderer2d.renderer.domElement.width || 1);
    const viewH = (renderer2d.renderer.domElement.clientHeight || renderer2d.renderer.domElement.height || 1);
    const zoomX = viewW / (spanX * pad);
    const zoomY = viewH / (spanY * pad);
    const newZoom = Math.min(zoomX, zoomY);
    renderer2d.camera.zoom = zoomInOnly ? Math.min(newZoom, renderer2d.camera.zoom) : newZoom;
    renderer2d.camera.updateProjectionMatrix();
  }

  function updateBBoxRuler(minX: number, maxX: number, minY: number, maxY: number) {
    // 更新 2D 尺寸线
    const { scale } = getSettings();
    renderer2d.bboxRuler.update(minX, maxX, minY, maxY, scale);
  }

  // 新建模链路：按“共面连通块”输出多边形。
  // 这里刻意复用单面边信息计算，再做边界合并，避免重复实现 tabAngle / joinSide 等规则。
  // scale 只在最终构造返回结果时应用，避免影响依赖原始坐标/顶点 key 的中间计算。
  const getGroupPolygonsData = (groupId: number): PolygonData[] => {
    const tris = buildSnappedTris(groupId);
    if (!tris.length) return [];
    const { scale, hollowStyle, minFoldAngleThreshold } = getSettings();
    // 当前设置项的单位是“度”，表示与完全共面（180°）的允许偏差。
    // 偏差不超过该阈值的相邻三角面，会被视为共面并参与合并。
    const coplanarThresholdRad = (minFoldAngleThreshold * Math.PI) / 180;
    const seamContext = createSeamContext();
    type FacePolygonSeed = {
      faceId: number;
      points: [Point2D, Point2D, Point2D];
      vertexKeys: [string, string, string] | null;
      edgeIds: number[];
      edges: PolygonEdgeInfo[];
    };
    const faceSeeds = new Map<number, FacePolygonSeed>();
    tris.forEach(({ faceId: fid, tri, vertexKeys, edgeIds }) => {
      const [a, b, c] = tri;
      const triNormal = new Vector3();
      angleIndex.getFaceNormal(fid, triNormal);
      const localVertexKeys =
        vertexKeys.length === 3
          ? [vertexKeys[0], vertexKeys[1], vertexKeys[2]] as [string, string, string]
          : null;
      faceSeeds.set(fid, {
        faceId: fid,
        points: [
          // 保持未缩放坐标参与后续合并。
          // 任何依赖原始展开坐标的判断，都在 scale 之前完成。
          [a.x, a.y],
          [b.x, b.y],
          [c.x, c.y],
        ],
        vertexKeys: localVertexKeys,
        edgeIds,
        edges: buildFaceEdgeInfo(fid, vertexKeys, edgeIds, [a, b, c], triNormal, seamContext),
      });
    });
    if (hollowStyle) {
      return Array.from(faceSeeds.values()).map((seed) => ({
        // 镂空模式下按你的约束，不做共面合并，退回到“三角形即 polygon”。
        points: seed.points.map(([x, y]) => [x * scale, y * scale] as Point2D),
        edges: seed.edges.map(clonePolygonEdgeInfo),
      }));
    }

    const faceIds = new Set(faceSeeds.keys());
    const visited = new Set<number>();
    const polygons: PolygonData[] = [];

    const collectComponent = (startFaceId: number) => {
      const component: number[] = [];
      const queue = [startFaceId];
      visited.add(startFaceId);
      while (queue.length) {
        const faceId = queue.pop()!;
        component.push(faceId);
        const seed = faceSeeds.get(faceId);
        if (!seed) continue;
        seed.edgeIds.forEach((eid) => {
          const edgeRec = getEdgesArray()[eid];
          if (!edgeRec || edgeRec.faces.size !== 2) return;
          const angle = angleIndex.getAngle(eid);
          if (Math.abs(angle - Math.PI) > coplanarThresholdRad) return;
          edgeRec.faces.forEach((neighborFaceId) => {
            if (neighborFaceId === faceId || !faceIds.has(neighborFaceId) || visited.has(neighborFaceId)) return;
            visited.add(neighborFaceId);
            queue.push(neighborFaceId);
          });
        });
      }
      return component;
    };

    Array.from(faceSeeds.keys()).forEach((faceId) => {
      if (visited.has(faceId)) return;
      const componentFaceIds = collectComponent(faceId);
      const merged = mergeCoplanarFaceSeeds(componentFaceIds.map((id) => faceSeeds.get(id)).filter(Boolean) as FacePolygonSeed[]);
      if (merged) {
        polygons.push(merged);
        return;
      }
      componentFaceIds.forEach((id) => {
        const seed = faceSeeds.get(id);
        if (!seed) return;
        polygons.push({
          points: seed.points.map((pt) => [...pt] as Point2D),
          edges: seed.edges.map(clonePolygonEdgeInfo),
        });
      });
    });

    // 统一在最终返回时应用 scale，避免中间步骤的任何 key / 拓扑判断受缩放影响。
    return polygons.map((polygon) => ({
      ...polygon,
      points: polygon.points.map(([x, y]) => [x * scale, y * scale] as Point2D),
    }));
  };

  // 深拷贝边信息，避免合并/反转时直接修改单面缓存。
  const clonePolygonEdgeInfo = (edge: PolygonEdgeInfo): PolygonEdgeInfo => ({
    ...edge,
    tabAngle: [...edge.tabAngle],
  });

  // 边方向反转时，stableOrder 的语义也要同步反转。
  const reverseStableOrder = (stableOrder: "ab" | "ba" | undefined): "ab" | "ba" | undefined => {
    if (stableOrder === "ab") return "ba";
    if (stableOrder === "ba") return "ab";
    return undefined;
  };

  // 合并多边形边界时，如果边的遍历方向与原三角形局部方向相反，
  // 需要同步翻转与方向相关的附加属性。
  const orientPolygonEdgeInfo = (edge: PolygonEdgeInfo, reversed: boolean): PolygonEdgeInfo => {
    if (!reversed) return clonePolygonEdgeInfo(edge);
    return {
      ...edge,
      tabAngle: [...edge.tabAngle].reverse(),
      stableOrder: reverseStableOrder(edge.stableOrder),
    };
  };

  const mergeCoplanarFaceSeeds = (
    seeds: Array<{
      faceId: number;
      points: [Point2D, Point2D, Point2D];
      vertexKeys: [string, string, string] | null;
      edgeIds: number[];
      edges: PolygonEdgeInfo[];
    }>,
  ): PolygonData | null => {
    if (seeds.length === 0) return null;
    if (seeds.length === 1) {
      return {
        points: seeds[0].points.map((pt) => [...pt] as Point2D),
        edges: seeds[0].edges.map(clonePolygonEdgeInfo),
      };
    }

    type BoundaryEdge = {
      id: string;
      aKey: string;
      bKey: string;
      a: Point2D;
      b: Point2D;
      edge: PolygonEdgeInfo;
      localOrder: [string, string];
    };

    // 用“无向顶点对”统计边出现次数：
    // - 出现 2 次：组件内部共享边，应消除
    // - 出现 1 次：组件边界边，应保留
    const edgeCounts = new Map<string, BoundaryEdge[]>();
    const edgePointIndex: Array<[0, 1] | [1, 2] | [2, 0]> = [[0, 1], [1, 2], [2, 0]];

    seeds.forEach((seed) => {
      if (!seed.vertexKeys) return;
      edgePointIndex.forEach(([i0, i1], edgeIdx) => {
        const aKey = seed.vertexKeys![i0];
        const bKey = seed.vertexKeys![i1];
        const undirectedKey = [aKey, bKey].sort().join("|");
        const list = edgeCounts.get(undirectedKey) ?? [];
        list.push({
          id: undirectedKey,
          aKey,
          bKey,
          a: seed.points[i0],
          b: seed.points[i1],
          edge: seed.edges[edgeIdx],
          localOrder: [aKey, bKey],
        });
        edgeCounts.set(undirectedKey, list);
      });
    });

    const boundaryEdges = Array.from(edgeCounts.values())
      .filter((entries) => entries.length === 1)
      .map((entries) => entries[0]);
    if (!boundaryEdges.length) return null;

    // 由边界边重建边界环。展开来自树结构，因此这里按单一闭环处理。
    const adjacency = new Map<string, BoundaryEdge[]>();
    boundaryEdges.forEach((edge) => {
      const from = adjacency.get(edge.aKey) ?? [];
      from.push(edge);
      adjacency.set(edge.aKey, from);
      const to = adjacency.get(edge.bKey) ?? [];
      to.push(edge);
      adjacency.set(edge.bKey, to);
    });

    const orderedPoints: Point2D[] = [];
    const orderedEdges: PolygonEdgeInfo[] = [];
    const visitedBoundaryEdges = new Set<string>();
    let current = boundaryEdges[0];
    let currentStartKey = current.aKey;
    let currentStartPoint = current.a;
    let currentEndKey = current.bKey;
    const loopStartKey = currentStartKey;
    const maxGuard = boundaryEdges.length + 1;
    let guard = 0;

    while (guard++ < maxGuard) {
      const reversed = current.localOrder[0] !== currentStartKey;
      orderedPoints.push(currentStartPoint);
      orderedEdges.push(orientPolygonEdgeInfo(current.edge, reversed));
      visitedBoundaryEdges.add(current.id);
      if (currentEndKey === loopStartKey) {
        break;
      }
      const nextCandidates = (adjacency.get(currentEndKey) ?? []).filter((edge) => !visitedBoundaryEdges.has(edge.id));
      if (nextCandidates.length !== 1) return null;
      const next = nextCandidates[0];
      if (next.aKey === currentEndKey) {
        current = next;
        currentStartKey = next.aKey;
        currentStartPoint = next.a;
        currentEndKey = next.bKey;
      } else if (next.bKey === currentEndKey) {
        current = next;
        currentStartKey = next.bKey;
        currentStartPoint = next.b;
        currentEndKey = next.aKey;
      } else {
        return null;
      }
    }

    if (orderedEdges.length !== boundaryEdges.length) return null;
    return {
      points: orderedPoints,
      edges: orderedEdges,
    };
  };

  const buildFaceEdgeInfo = (
    fid: number,
    vertexKeys: string[],
    edgeIds: number[],
    tri: [Vector3, Vector3, Vector3],
    triNormal: Vector3,
    seamContext: {
      vertexSeamNeighbors: Map<string, { key: string; pos: Point3D }[]>;
      seamEdgeAngleMap: Map<string, number>;
    },
  ): PolygonEdgeInfo[] => {
    // 这里定义“单个三角面上的边信息”。
    // 多边形模式只是复用该结果，再按边界顺序重排，不改变单边的几何定义。
    const faceIndexMap = getFaceIndexMap();
    const vertexKeyToPos = getVertexKeyToPos();
    const edgesArray = getEdgesArray();
    const { vertexSeamNeighbors, seamEdgeAngleMap } = seamContext;
    const edgeKeyToId = getEdgeKeyToId();
    const makeEndpointKey = (edgeKey: string, vertexKey: string) => `${edgeKey}|${vertexKey}`;
    const makeVertexKey = (pos: BufferAttribute | InterleavedBufferAttribute, idx: number) => pointKey3D([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
    const [a, b, c] = tri;
    const keyTo2D = new Map<string, Point2D>();
    let triVertexKeys: [string, string, string] | null = null;
    const localVertexKeys =
      vertexKeys.length === 3
        ? [vertexKeys[0], vertexKeys[1], vertexKeys[2]] as [string, string, string]
        : null;
    if (localVertexKeys) {
      triVertexKeys = localVertexKeys;
      keyTo2D.set(localVertexKeys[0], [a.x, a.y]);
      keyTo2D.set(localVertexKeys[1], [b.x, b.y]);
      keyTo2D.set(localVertexKeys[2], [c.x, c.y]);
    } else {
      const mapping = faceIndexMap.get(fid);
      if (mapping) {
        const geom = mapping.mesh.geometry;
        const pos = geom.getAttribute("position");
        if (pos) {
          const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
          const keyA = makeVertexKey(pos, ia);
          const keyB = makeVertexKey(pos, ib);
          const keyC = makeVertexKey(pos, ic);
          triVertexKeys = [keyA, keyB, keyC];
          keyTo2D.set(keyA, [a.x, a.y]);
          keyTo2D.set(keyB, [b.x, b.y]);
          keyTo2D.set(keyC, [c.x, c.y]);
        }
      }
    }
    return edgeIds.map((eid, edgeIdx) => {
        const edgeRec = edgesArray[eid];
        const isSeam = edgeRec?.faces && edgeRec.faces.size === 2 && sharedEdgeIsSeam([...edgeRec.faces][0], [...edgeRec.faces][1]);
        const isOuter = isSeam || (edgeRec?.faces.size ?? 0) === 1;
        const tabAngle: number[] = [];
        let joinSide: "mp" | "fp" | undefined;
        let stableOrder: "ab" | "ba" | undefined;
        if (isSeam && edgeRec?.vertices) {
          const [k1, k2] = edgeRec.vertices;
          // console.log("Processing seam edge:", edgeRec.id, k1, k2);
          const p1Vec = vertexKeyToPos.get(k1);
          const p2Vec = vertexKeyToPos.get(k2);
          if (p1Vec && p2Vec) {
            const p1: Point3D = [p1Vec.x, p1Vec.y, p1Vec.z];
            const p2: Point3D = [p2Vec.x, p2Vec.y, p2Vec.z];
            const edgeKeyUndir = edgeKey3D(p1, p2);
            const endpointKeyA = makeEndpointKey(edgeKeyUndir, k1);
            const endpointKeyB = makeEndpointKey(edgeKeyUndir, k2);
            const calculateSeamEndPointAngle = (aKey: string, bKey: string, a: Point3D, b: Point3D) => {
              // console.log("Calculating seam edge angle for edge:", edgeKeyToId.get(edgeKey3D(a,b)), "endpoint:", aKey);
              const edgeKeyForward = edgeKey3D(a, b);
              const relatedSeams = [...(vertexSeamNeighbors.get(aKey) ?? [])];
              // console.log("  Found related ", relatedSeams.length, "seams:", relatedSeams.map((nb) => edgeKeyToId.get(edgeKey3D(a, p3(vertexKeyToPos.get(nb.key)??new Vector3())))));
              if (relatedSeams.length < 2) {
                seamEdgeAngleMap.set(makeEndpointKey(edgeKeyForward, aKey), 45);
                // console.log("  No related seams found. Defaulting angle to 45°.");
                return;
              }
              // key是端点的pointKey
              const normalOfBisectorPlaneOfDihedral: Map<string, Vec3> = new Map();
              relatedSeams.forEach((nb) => {
                // console.log("  Processing neighbor seam:", nb.key);
                const seamKey = [aKey, nb.key].sort().join("|");
                const seamEdgeId = edgeKeyToId.get(seamKey);
                const seamEdge = seamEdgeId !== undefined ? edgesArray[seamEdgeId] : undefined;
                if (seamEdgeId === undefined || !seamEdge || !seamEdge.faces || seamEdge.faces.size < 2) {
                  console.warn("Invalid seam edge for key:", { seamKey, seamEdgeId, seamEdge });
                  return;
                }
                const [f1, f2] = Array.from(seamEdge.faces);
                const third1Key = getThirdVertexKeyOnFace(seamEdgeId, f1);
                const third2Key = getThirdVertexKeyOnFace(seamEdgeId, f2);
                if (!third1Key || !third2Key) {
                  console.warn("Cannot find third vertex on faces", f1, f2, "for seam edge", seamKey);
                  return;
                }
                const t1 = vertexKeyToPos.get(third1Key);
                const t2 = vertexKeyToPos.get(third2Key);
                if (!t1 || !t2) {
                  console.warn("Cannot find third vertex positions for keys", third1Key, third2Key);
                  return;
                }
                const plane = bisectorPlaneOfDihedral(a, nb.pos, [t1.x, t1.y, t1.z], [t2.x, t2.y, t2.z]);
                if (plane) {
                  normalOfBisectorPlaneOfDihedral.set(nb.key, plane.normal);
                }
                // console.log("  Bisector plane for seam edge", seamKey, ":", plane?.normal);
              });
              // 记录二面角平分面两两相交得出的交线与拼接边的夹角的最小值
              const minAngleBetweenTwoPlaneIntersectionLinesAndSeamEdge: Map<string, number> = new Map();
              const normals = Array.from(normalOfBisectorPlaneOfDihedral.entries());
              for (let i = 0; i < normals.length; i += 1) {
                const [keyI, n1] = normals[i];
                const seamKeyAI = edgeKeyToId.get(edgeKey3D(a, p3(vertexKeyToPos.get(keyI)??new Vector3())));
                for (let j = i + 1; j < normals.length; j += 1) {
                  const [keyJ, n2] = normals[j];
                  const seamKeyAJ = edgeKeyToId.get(edgeKey3D(a, p3(vertexKeyToPos.get(keyJ)??new Vector3())));
                  // console.log("    Computing intersection line between planes for seam", seamKeyAI, "and", seamKeyAJ, "dot value:", Math.abs(dot3(n1, n2)));
                  const normalsDot = Math.abs(dot3(n1, n2));
                  const posI = vertexKeyToPos.get(keyI);
                  const posJ = vertexKeyToPos.get(keyJ);
                  if (!posI || !posJ) {
                    console.warn("Cannot find neighbor positions for keys", keyI, keyJ);
                    continue;
                  }
                  const edgeDirI = sub3([posI.x, posI.y, posI.z], a);
                  const edgeDirJ = sub3([posJ.x, posJ.y, posJ.z], a);
                  const lenI = norm3(edgeDirI);
                  const lenJ = norm3(edgeDirJ);
                  if (lenI < 1e-8 || lenJ < 1e-8) continue;
                  const baseDirI = mul3(edgeDirI, 1 / lenI);
                  const baseDirJ = mul3(edgeDirJ, 1 / lenJ);
                  let newI = 45;
                  let newJ = 45;
                  // 如果baseDirI与n2接近垂直，或者baseDirJ与n1接近垂直，说明a-i几乎在a-j的平分面上，或a-j几乎在a-i的平分面上
                  if (Math.abs(dot3(baseDirI, n2)) < 1e-5 || Math.abs(dot3(baseDirJ, n1)) < 1e-5 ||
                  // 如果两个平分面几乎平行，也无法通过平分面的交线来确定夹角
                    normalsDot > 1 - 1e-5) {
                    // 针对这几种情况，取两拼接边夹角的一半作为新角度
                    const dotVal = Math.min(1, Math.max(-1, dot3(baseDirI, baseDirJ)));
                    const halfDeg = (Math.acos(dotVal) * 180) / Math.PI / 2;
                    // console.log(`    Nearly parallel planes for keys ${keyI} and ${keyJ}. Using half angle between seam edges: ${halfDeg.toFixed(2)}°`);
                    newI = halfDeg;
                    newJ = halfDeg;
                  } else {
                    const lineDir = cross3(n1, n2);
                    const len = norm3(lineDir);
                    if (len < 1e-8) {
                      console.warn("Skipping nearly parallel planes for keys", keyI, keyJ);
                      continue;
                    }
                    let dir = mul3(lineDir, 1 / len);
                    // 纠正交线方向，使其与任一相关三角面的法线夹角 > 90°
                    const pickAnyNormal = (vk: string): Vec3 | undefined => {
                      const seamKey = [aKey, vk].sort().join("|");
                      const seamEdgeId = edgeKeyToId.get(seamKey);
                      const seamEdge = seamEdgeId !== undefined ? edgesArray[seamEdgeId] : undefined;
                      if (!seamEdge || !seamEdge.faces) return undefined;
                      for (const fid of seamEdge.faces) {
                        const n = new Vector3();
                        if (angleIndex.getFaceNormal(fid, n)) {
                          return [n.x, n.y, n.z];
                        }
                      }
                      return undefined;
                    };
                    const normal = pickAnyNormal(keyI) ?? pickAnyNormal(keyJ);
                    if (normal && dot3(dir, normal) > 0) {
                      dir = mul3(dir, -1);
                    }
                    const posI = vertexKeyToPos.get(keyI);
                    const posJ = vertexKeyToPos.get(keyJ);
                    if (!posI || !posJ) {
                      console.warn("Cannot find neighbor positions for keys", keyI, keyJ);
                      continue;
                    }
                    const edgeDirI = sub3([posI.x, posI.y, posI.z], a);
                    const edgeDirJ = sub3([posJ.x, posJ.y, posJ.z], a);
                    const lenI = norm3(edgeDirI);
                    const lenJ = norm3(edgeDirJ);
                    if (lenI < 1e-8 || lenJ < 1e-8) {
                      console.warn("Skipping nearly zero-length seam edge for keys", keyI, keyJ);
                      continue;
                    }
                    const baseDirI = mul3(edgeDirI, 1 / lenI);
                    const baseDirJ = mul3(edgeDirJ, 1 / lenJ);
                    const angleI = Math.acos(Math.min(1, Math.max(-1, dot3(dir, baseDirI))));
                    const angleJ = Math.acos(Math.min(1, Math.max(-1, dot3(dir, baseDirJ))));
                    newI = (angleI * 180) / Math.PI;
                    newJ = (angleJ * 180) / Math.PI;
                    // console.log(`    Angle between intersection line and seam`, seamKeyAI, `is`, newI, `°, seam`, seamKeyAJ, `is`, newJ, `°`);
                  }
                  if (newI > 45 || newJ > 45) {
                    newI = 45;
                    newJ = 45;
                  }
                  const prevI = minAngleBetweenTwoPlaneIntersectionLinesAndSeamEdge.get(keyI);
                  minAngleBetweenTwoPlaneIntersectionLinesAndSeamEdge.set(keyI, prevI === undefined ? newI : Math.min(prevI, newI));
                  const prevJ = minAngleBetweenTwoPlaneIntersectionLinesAndSeamEdge.get(keyJ);
                  minAngleBetweenTwoPlaneIntersectionLinesAndSeamEdge.set(keyJ, prevJ === undefined ? newJ : Math.min(prevJ, newJ));
                }
              }
              minAngleBetweenTwoPlaneIntersectionLinesAndSeamEdge.forEach((angle, pkey) => {
                const vec = vertexKeyToPos.get(pkey);
                if (!vec) return;
                const baseKey = edgeKey3D(a, [vec.x, vec.y, vec.z]);
                // console.log("  Setting seam edge angle for edge:", edgeKeyToId.get(baseKey), "endpoint:", aKey, "angle:", angle);
                seamEdgeAngleMap.set(makeEndpointKey(baseKey, aKey), angle);
              });
            };
            if (!seamEdgeAngleMap.has(endpointKeyA)) {
              calculateSeamEndPointAngle(k1, k2, p1, p2);
            }
            // else console.log("Seam edge angle cache hit for", endpointKeyA, seamEdgeAngleMap.get(endpointKeyA));
            if (!seamEdgeAngleMap.has(endpointKeyB)) {
              calculateSeamEndPointAngle(k2, k1, p2, p1);
            }
            // else console.log("Seam edge angle cache hit for", endpointKeyB, seamEdgeAngleMap.get(endpointKeyB));
            tabAngle.push(seamEdgeAngleMap.get(endpointKeyA) ?? 45);
            tabAngle.push(seamEdgeAngleMap.get(endpointKeyB) ?? 45);
            // const thirdVertexKey = pointKey3DArray.find((pk) => pk !== k1 && pk !== k2);
            const thirdVertexKey = getThirdVertexKeyOnFace(eid, fid);
            if (thirdVertexKey) {
              // console.log("[geometry] Found third vertex", thirdVertexKey, "for face", fid, "when processing seam edge", edgeRec.id);
              const thirdVertexPos = vertexKeyToPos.get(thirdVertexKey);
              if (thirdVertexPos) {
                const isEdgeOrderCCW = isCounterClockwiseFromFront(p1Vec, p2Vec, thirdVertexPos, [triNormal.x, triNormal.y, triNormal.z]);
                if (!isEdgeOrderCCW) {
                  // console.log("Reversing tab angle order for edge:", edgeRec.id, "due to CW face winding", p1Vec, p2Vec, thirdVertexPos);
                  tabAngle.reverse();
                }
                if (triVertexKeys) {
                  const localEndpoints: [string, string] | null =
                    edgeIdx === 0 ? [triVertexKeys[0], triVertexKeys[1]]
                    : edgeIdx === 1 ? [triVertexKeys[1], triVertexKeys[2]]
                    : edgeIdx === 2 ? [triVertexKeys[2], triVertexKeys[0]]
                    : null;
                  if (localEndpoints) {
                    const [pointAKey, pointBKey] = localEndpoints;
                    stableOrder = pointAKey > pointBKey ? "ab" : "ba";
                    const stableFirstKey = stableOrder === "ab" ? pointAKey : pointBKey;
                    const stableMatchesEdgeOrder = stableFirstKey === k1;
                    const isStableOrderCCW = stableMatchesEdgeOrder ? isEdgeOrderCCW : !isEdgeOrderCCW;
                    joinSide = isStableOrderCCW ? "fp" : "mp";
                  }
                }
              }
              else {
                console.warn("Cannot find third vertex position for face", fid, "when processing seam edge", k1, k2);
              }
            }
            else {
              console.warn("Cannot find third vertex for face", fid, "when processing seam edge", edgeRec.id);
            }
          }
        }
        return {
          isOuter: isOuter,
          angle: angleIndex.getAngle(eid),
          isSeam: isSeam,
          tabAngle: tabAngle,
          joinSide,
          stableOrder,
        };
    });
  };

  // seam 相关缓存按一次导出构建一次，避免每个面重复扫描所有边。
  const createSeamContext = () => {
    const vertexKeyToPos = getVertexKeyToPos();
    const edgesArray = getEdgesArray();
    const vertexSeamNeighbors = new Map<string, { key: string; pos: Point3D }[]>();
    const seamEdgeAngleMap = new Map<string, number>();
    const addNeighbor = (k: string, neighborKey: string, p: Vector3 | undefined) => {
      if (!p) return;
      const arr = vertexSeamNeighbors.get(k) ?? [];
      arr.push({ key: neighborKey, pos: [p.x, p.y, p.z] });
      vertexSeamNeighbors.set(k, arr);
    };
    edgesArray.forEach((edge) => {
      if (!edge || !edge.faces || edge.faces.size !== 2) return;
      const [f1, f2] = [...edge.faces];
      if (!sharedEdgeIsSeam(f1, f2)) return;
      const [k1, k2] = edge.vertices;
      const p1 = vertexKeyToPos.get(k1);
      const p2 = vertexKeyToPos.get(k2);
      addNeighbor(k1, k2, p2);
      addNeighbor(k2, k1, p1);
    });
    return { vertexSeamNeighbors, seamEdgeAngleMap };
  };

  appEventBus.on("clearAppStates", () => {
    // clearScene();
    clearTransforms();
    cachedSnapped = null;
  });

  appEventBus.on("groupFaceAdded", ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    cachedSnapped = null;
    rebuildGroup2D(groupId, true);
  });
  appEventBus.on("groupFaceRemoved", ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    const current = getPreviewGroupId();
    if (groupId !== current) return;
    rebuildGroup2D(groupId, true);
  });
  type XY = { x: number; y: number };

  const paintFace = (
    groupId: number,
    faceId: number,
    tri: [XY, XY, XY],
    intersected: boolean | undefined,
    positions: number[] | null,
    colors: number[],
  ) => {
    const gid = getFaceGroupMap().get(faceId) ?? groupId;
    const groupColor = getGroupColor(gid) ?? getGroupColor(groupId) ?? new Color(0xffffff);
    const visible = getGroupVisibility(gid);
    const color = visible ? groupColor : new Color(0x898e9c);
    const verts = tri;
    verts.forEach((v) => {
      if (positions) {
        positions.push(v.x, v.y, 0);
      }
      colors.push(color.r, color.g, color.b, intersected ? 1 : 0);
    });
  };

  const repaintGroupColor = (groupId: number) => {
    const cache = cachedSnapped;
    if (!cache || cache.groupId !== groupId) return false;
    const colors: number[] = [];
    cache.tris.forEach(({ faceId, tri, intersected }) => {
      paintFace(groupId, faceId, tri, intersected, null, colors);
    });
    let painted = false;
    renderer2d.root.children.forEach((child) => {
      const mesh = child as Mesh;
      if (!(mesh as any).isMesh) return;
      if (mesh.userData.groupId !== groupId) return;
      const colorAttr = (mesh.geometry as BufferGeometry).getAttribute("color") as Float32BufferAttribute | undefined;
      if (!colorAttr) return;
      if (colorAttr.count * 4 !== colors.length) return;
      const arr = colorAttr.array as Float32Array;
      for (let i = 0; i < colors.length; i++) {
        arr[i] = colors[i];
      }
      colorAttr.needsUpdate = true;
      painted = true;
    });
    return painted;
  };

  appEventBus.on("groupColorChanged", ({ groupId }) => {
    const ok = repaintGroupColor(groupId);
    if (!ok) {
      rebuildGroup2D(groupId, true);
    }
  });
  appEventBus.on("groupVisibilityChanged", ({ groupId }) => {
    const ok = repaintGroupColor(groupId);
    if (!ok) {
      rebuildGroup2D(groupId, true);
    }
  });
  appEventBus.on("projectChanged", () => {
    const groups = getGroupIds();
    if (groups.length === 0) return;
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });
  appEventBus.on("groupAdded", clearScene);
  appEventBus.on("groupRemoved", () => {
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });

  appEventBus.on("groupCurrentChanged", (groupId: number) => rebuildGroup2D(groupId));

  appEventBus.on("settingsChanged", (changedItemCnt) => {
    // 目前没有细粒度的“某个设置项发生变化”事件。
    // 为了让 minFoldAngleThreshold 改动后立即反映到 2D 边线显示，
    // 这里在任意设置变更时直接强制重建当前展开组。
    // 这样 bbox 尺寸线、折痕线过滤、拼接线材质都会同步刷新。
    if (!lastBounds) return;
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid, true);
  });

  appEventBus.on("groupPlaceAngleChanged", ({ groupId, newAngle, oldAngle }) => {
    if (groupId !== getPreviewGroupId()) return;
    const delta = newAngle - oldAngle;
    renderer2d.root.rotateOnAxis(new Vector3(0, 0, 1), delta);
    renderer2d.root.updateMatrixWorld(true);
    const { minX, maxX, minY, maxY } = getMeshVertexBounds();
    updateCamera(minX, maxX, minY, maxY, true);
    updateBBoxRuler(minX, maxX, minY, maxY);
  });

  appEventBus.on("historyApplied", () => {
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid, true);
  });

  return {
    getGroupPolygonsData,
    getEdges2D: () => groupEdgesCache,
    getLastBounds,
    hasGroupIntersection: (groupId: number) => {
      buildSnappedTris(groupId);
      return groupIntersected.get(groupId) ?? false;
    },
  };
}

export type Unfold2dManager = ReturnType<typeof createUnfold2dManager>;
