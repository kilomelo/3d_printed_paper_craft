// 展开组 2D 管理器：监听面增删事件，按需查询角度索引并维护组内面/边的缓存，后续可用于 2D 重建。
import {
  BufferGeometry,
  Mesh,
  Vector3,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  BufferAttribute,
  InterleavedBufferAttribute,
} from "three";
import { EdgeRecord, getFaceVertexIndices } from "./model";
import { sharedEdgeIsSeam } from "./groups";
import {  } from "./model";
import { AngleIndex } from "./geometry";
import { appEventBus } from "./eventBus";
import type { Renderer2DContext } from "./renderer2d";
import { createUnfoldEdgeMaterial, createUnfoldFaceMaterial } from "./materials";
import type { Point2D, Point3D, Vec3, TriangleWithEdgeInfo as TriangleData } from "../types/geometryTypes";
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
  triIntersect2D,
} from "./mathUtils";
import { getSettings } from "./settings";

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
  getGroupTreeParent: (id: number) => Map<number, number | null> | undefined,
  getFaceToEdges: () => Map<number, [number, number, number]>,
  getEdgesArray: () => EdgeRecord[],
  getVertexKeyToPos: () => Map<string, Vector3>,
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>,
  getEdgeKeyToId: () => Map<string, number>,
  getThirdVertexKeyOnFace: (edgeId: number, faceId: number) => string | undefined,
  getGroupPlaceAngle: (id: number) => number | undefined,
  logFn: (message: string | number, tone?: import("./log").LogTone) => void,
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

  // let modelLoaded = false;

  const clearScene = () => {
    renderer2d.root.children.forEach((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        (mesh.geometry as BufferGeometry).dispose();
        (mesh.material as any)?.dispose?.();
      }
    });
    renderer2d.root.clear();
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
    const geom = mapping.mesh.geometry;
    const pos = geom.getAttribute("position");
    if (!pos) {
      out.set(0, 0, 1);
      return;
    }
    const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
    mapping.mesh.updateWorldMatrix(true, false);
    tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mapping.mesh.matrixWorld);
    tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mapping.mesh.matrixWorld);
    tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mapping.mesh.matrixWorld);
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
        // 跳过共享边的相邻三角形（共边不视为自交）；仅共享顶点仍需检测
        if (t.edgeIds.some((eid) => edgeIds.includes(eid))) return;
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
        if (triIntersect2D(tri2d, newTri2d)) {
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
      logFn("当前展开组存在自交三角形", "error");
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
    const geom = mapping.mesh.geometry;
    const pos = geom.getAttribute("position");
    if (!pos) return null;
    const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
    mapping.mesh.updateWorldMatrix(true, false);
    tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mapping.mesh.matrixWorld);
    tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mapping.mesh.matrixWorld);
    tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mapping.mesh.matrixWorld);

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
      const geom = mapping.mesh.geometry;
      const pos = geom.getAttribute("position");
      if (!pos) return;
      const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
      mapping.mesh.updateWorldMatrix(true, false);
      tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mapping.mesh.matrixWorld);
      tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mapping.mesh.matrixWorld);
      tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mapping.mesh.matrixWorld);

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
      const [a, b, c] = tri;
      const gid = getFaceGroupMap().get(faceId);
      const col = gid !== null && gid !== undefined ? getGroupColor(gid) : getGroupColor(groupId);
      const flagged = intersected === true;
      const cr = flagged ? 1 : col?.r ?? 255;
      const cg = flagged ? 0 : col?.g ?? 255;
      const cb = flagged ? 1 : col?.b ?? 255;
      [a, b, c].forEach((v) => {
        positions.push(v.x, v.y, 0);
        colors.push(cr, cg, cb);
      });
    });
    if (positions.length === 0) {
      renderer2d.bboxRuler.hide();
      return;
    }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geom.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const indices: number[] = [];
    for (let i = 0; i < positions.length / 3; i += 3) {
      indices.push(i, i + 1, i + 2);
    }
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mesh = new Mesh(geom, createUnfoldFaceMaterial());
    const edgeGeom = geom.clone();
    const edgeMesh = new Mesh(edgeGeom, createUnfoldEdgeMaterial());
    mesh.userData.groupId = groupId;
    edgeMesh.userData.groupId = groupId;
    renderer2d.root.add(mesh);
    renderer2d.root.add(edgeMesh);

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
    groupEdgesCache.set(groupId, { edges: edgeCache, medianEdgeLength });

    renderer2d.root.rotateOnAxis(new Vector3(0, 0, 1), getGroupPlaceAngle(groupId)??0);
    renderer2d.root.updateMatrixWorld(true);
    const bounds = getMeshVertexBounds();
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

  // 获取指定展开组的三角形数据（含边信息），用于生成 2D 展开图及用于打印的展开3D模型
  const getGroupTrianglesData = (groupId: number): TriangleData[] => {
    const tris = buildSnappedTris(groupId);
    if (!tris.length) return [];
    const faceToEdges = getFaceToEdges();
    const faceIndexMap = getFaceIndexMap();
    const vertexKeyToPos = getVertexKeyToPos();
    const edgesArray = getEdgesArray();
    // 预构建：顶点 -> 与之相连的拼接边的另一端点列表（3D）
    const vertexSeamNeighbors = new Map<string, { key: string; pos: Point3D }[]>();
    const addNeighbor = (k: string, neighborKey: string, p: Vector3 | undefined) => {
      if (!p) return;
      const arr = vertexSeamNeighbors.get(k) ?? [];
      arr.push({ key: neighborKey, pos: [p.x, p.y, p.z] });
      vertexSeamNeighbors.set(k, arr);
    };
    edgesArray.forEach((edge) => {
      if (!edge) return;
      const isSeam = edge?.faces && edge.faces.size === 2 && sharedEdgeIsSeam([...edge.faces][0], [...edge.faces][1]);
      if (!isSeam) return;
      const [k1, k2] = edge.vertices;
      const p1 = vertexKeyToPos.get(k1);
      const p2 = vertexKeyToPos.get(k2);
      addNeighbor(k1, k2, p2);
      addNeighbor(k2, k1, p1);
    });
    const edgeKeyToId = getEdgeKeyToId();
    const makeEndpointKey = (edgeKey: string, vertexKey: string) => `${edgeKey}|${vertexKey}`;
    // 缓存：拼接边 key -> 角度
    const seamEdgeAngleMap = new Map<string, number>();
    const { scale } = getSettings();
    const makeVertexKey = (pos: BufferAttribute | InterleavedBufferAttribute, idx: number) => pointKey3D([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);
    const result: Array<TriangleData> = [];
    tris.forEach(({ faceId: fid, tri }) => {
      const [a, b, c] = tri;
      // const pointKey3DArray = [a, b, c].map((v) => pointKey3D([v.x, v.y, v.z]));
      // console.log("Processing face:", fid, "with points:", pointKey3DArray);
      const triNormal = new Vector3();
      angleIndex.getFaceNormal(fid, triNormal);
      // const isCCW = isCounterClockwiseFromFront(p3(a), p3(b), p3(c), [faceNormal.x, faceNormal.y, faceNormal.z]);
      // console.log("Processing face:", fid, "isCCW:", isCCW);
      const edgeIds = faceToEdges.get(fid) ?? [];
      const keyTo2D = new Map<string, Point2D>();
      const mapping = faceIndexMap.get(fid);
      if (mapping) {
        const geom = mapping.mesh.geometry;
        const pos = geom.getAttribute("position");
        if (pos) {
          const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
          keyTo2D.set(makeVertexKey(pos, ia), [a.x, a.y]);
          keyTo2D.set(makeVertexKey(pos, ib), [b.x, b.y]);
          keyTo2D.set(makeVertexKey(pos, ic), [c.x, c.y]);
        }
      }
      const edgeInfo = edgeIds.map((eid, edgeIdx) => {
        const edgeRec = getEdgesArray()[eid];
        const isSeam = edgeRec?.faces && edgeRec.faces.size === 2 && sharedEdgeIsSeam([...edgeRec.faces][0], [...edgeRec.faces][1]);
        const isOuter = isSeam || (edgeRec?.faces.size ?? 0) === 1;
        const earAngle: number[] = [];
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
                    const faceNormals: Vec3[] = [];
                    const collectNormals = (vk: string) => {
                      const seamKey = [aKey, vk].sort().join("|");
                      const seamEdgeId = edgeKeyToId.get(seamKey);
                      const seamEdge = seamEdgeId !== undefined ? edgesArray[seamEdgeId] : undefined;
                      if (!seamEdge || !seamEdge.faces) return;
                      seamEdge.faces.forEach((fid) => {
                        const n = new Vector3();
                        if (angleIndex.getFaceNormal(fid, n)) {
                          faceNormals.push([n.x, n.y, n.z]);
                        }
                      });
                    };
                    collectNormals(keyI);
                    collectNormals(keyJ);
                    // faceNormals.forEach(fn => {
                    //   console.log("      Related face normal:", dot3(dir, fn) > 0 ? "same direction" : "opposite direction");
                    // });
                    if (faceNormals.some((fn) => dot3(dir, fn) > 0)) {
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
            earAngle.push(seamEdgeAngleMap.get(endpointKeyA) ?? 45);
            earAngle.push(seamEdgeAngleMap.get(endpointKeyB) ?? 45);
            // const thirdVertexKey = pointKey3DArray.find((pk) => pk !== k1 && pk !== k2);
            const thirdVertexKey = getThirdVertexKeyOnFace(eid, fid);
            if (thirdVertexKey) {
              // console.log("[geometry] Found third vertex", thirdVertexKey, "for face", fid, "when processing seam edge", edgeRec.id);
              const thirdVertexPos = vertexKeyToPos.get(thirdVertexKey);
              if (thirdVertexPos) {
                const isCCW = isCounterClockwiseFromFront(p1Vec, p2Vec, thirdVertexPos, [triNormal.x, triNormal.y, triNormal.z]);
                if (!isCCW) {
                  // console.log("Reversing ear angle order for edge:", edgeRec.id, "due to CW face winding", p1Vec, p2Vec, thirdVertexPos);
                  earAngle.reverse();
                }
                // else console.log("Keeping ear angle order for edge:", edgeRec.id, "due to CCW face winding", p1Vec, p2Vec, thirdVertexPos);
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
          earAngle: earAngle,
        };
      });
      result.push({
        tri: [
          [a.x * scale, a.y * scale],
          [b.x * scale, b.y * scale],
          [c.x * scale, c.y * scale],
        ],
        faceId: fid,
        edges: edgeInfo,
      });
    });
    return result;
  };

  appEventBus.on("clearAppStates", () => {
    // modelLoaded = false;
    clearScene();
    clearTransforms();
    cachedSnapped = null;
  });

  appEventBus.on("groupFaceAdded", ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    // if (!modelLoaded) return;
    cachedSnapped = null;
    rebuildGroup2D(groupId, true);
  });
  appEventBus.on("groupFaceRemoved", ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    // if (!modelLoaded) return;
    const current = getPreviewGroupId();
    if (groupId !== current) return;
    rebuildGroup2D(groupId, true);
  });
  const repaintGroupColor = (groupId: number) => {
    let painted = false;
    const col = getGroupColor(groupId);
    const cr = col?.r ?? 255;
    const cg = col?.g ?? 255;
    const cb = col?.b ?? 255;
    renderer2d.root.children.forEach((child) => {
      const mesh = child as Mesh;
      if (!(mesh as any).isMesh) return;
      if (mesh.userData.groupId !== groupId) return;
      const colorAttr = (mesh.geometry as BufferGeometry).getAttribute("color") as Float32BufferAttribute | undefined;
      if (!colorAttr) return;
      const arr = colorAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = cr;
        arr[i + 1] = cg;
        arr[i + 2] = cb;
      }
      colorAttr.needsUpdate = true;
      painted = true;
    });
    return painted;
  };

  appEventBus.on("groupColorChanged", ({ groupId }) => {
    // if (!modelLoaded) return;
    const ok = repaintGroupColor(groupId);
    if (!ok) {
      rebuildGroup2D(groupId, true);
    }
  });
  appEventBus.on("projectChanged", () => {
    // modelLoaded = true;
    const groups = getGroupIds();
    if (groups.length === 0) return;
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });
  appEventBus.on("groupAdded", () => {
    clearScene();
  });
  appEventBus.on("groupRemoved", () => {
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });

  appEventBus.on("groupCurrentChanged", (groupId: number) => {
    rebuildGroup2D(groupId);
  });

  appEventBus.on("settingsChanged", (changedItemCnt) => {
    if (!lastBounds) return;
    const { scale } = getSettings();
    renderer2d.bboxRuler.update(lastBounds.minX, lastBounds.maxX, lastBounds.minY, lastBounds.maxY, scale);
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
    getGroupTrianglesData,
    getEdges2D: () => groupEdgesCache,
    getLastBounds,
    hasGroupIntersection: (groupId: number) => {
      buildSnappedTris(groupId);
      return groupIntersected.get(groupId) ?? false;
    },
  };
}

export type Unfold2dManager = ReturnType<typeof createUnfold2dManager>;
