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
import type { GeometryIndex } from "./geometry";
import { sharedEdgeIsSeam } from "./groups";
import { getFaceVertexIndices } from "./model";
import { AngleIndex } from "./geometry";
import { appEventBus } from "./eventBus";
import type { Renderer2DContext } from "./renderer2d";
import { createUnfoldEdgeMaterial, createUnfoldFaceMaterial } from "./materials";
import type { Point2D, TriangleWithEdgeInfo as TriangleData } from "../types/triangles";
import { getSettings } from "./settings";

// 记录“3D → 2D”变换矩阵，后续将按组树关系进行累乘展开。
type TransformTree = Map<number, Matrix4>;
type TransformStore = Map<number, TransformTree>;

type ManagerDeps = {
  angleIndex: AngleIndex;
  renderer2d: Renderer2DContext;
  getGroupIds: () => number[];
  getGroupFaces: (id: number) => Set<number> | undefined;
  getPreviewGroupId: () => number;
  getFaceGroupMap: () => Map<number, number | null>;
  getGroupColor: (id: number) => THREE.Color | undefined;
  getGroupTreeParent: (id: number) => Map<number, number | null> | undefined;
  getFaceToEdges: () => Map<number, [number, number, number]>;
  getEdgesArray: () => ReturnType<GeometryIndex["getEdgesArray"]>;
  getVertexKeyToPos: () => Map<string, Vector3>;
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>;
};

export function createUnfold2dManager(opts: ManagerDeps) {
  const {
    angleIndex,
    renderer2d,
    getGroupIds,
    getGroupFaces,
    getPreviewGroupId,
    getFaceGroupMap,
    getGroupColor,
    getGroupTreeParent,
    getFaceToEdges,
    getEdgesArray,
    getVertexKeyToPos,
    getFaceIndexMap,
  } = opts;
  const transformStore: TransformStore = new Map();
  const transformCache: Map<string, Matrix4> = new Map();
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const tmpD = new Vector3();
  const tmpE = new Vector3();
  const basisU = new Vector3();
  const basisV = new Vector3();
  const normal = new Vector3();
  const targetNormal = new Vector3(0, 0, 1);
  const quat = new Quaternion();
  const anchor = new Vector3();
  const axis = new Vector3();
  const transformKey = (a: number, b: number) => `${a}->${b}`;

  let modelLoaded = false;

  const clearScene = () => {
    renderer2d.root.children.forEach((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        (mesh.geometry as BufferGeometry).dispose();
        (mesh.material as any)?.dispose?.();
      }
    });
    renderer2d.root.clear();
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

  const rebuildGroup2D = (groupId: number) => {
    // console.log(`[Unfold2DManager] rebuildGroup2D called for group ${groupId}`);
    const faces = getGroupFaces(groupId);
    clearScene();
    if (!faces || faces.size === 0) return;
    clearTransforms();
    buildRootTransforms(groupId);
    buildTransformsForGroup(groupId);
    const positions: number[] = [];
    const colors: number[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    faces.forEach((fid) => {
      const tri = faceTo2D(groupId, fid);
      if (!tri) return;
      const [a, b, c] = tri;
      const gid = getFaceGroupMap().get(fid);
      const col = gid !== null && gid !== undefined ? getGroupColor(gid) : getGroupColor(groupId);
      const cr = col?.r ?? 255;
      const cg = col?.g ?? 255;
      const cb = col?.b ?? 255;
      [a, b, c].forEach((v) => {
        positions.push(v.x, v.y, 0);
        colors.push(cr, cg, cb);
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      });
    });
    if (positions.length === 0) return;
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
    renderer2d.camera.zoom = Math.min(zoomX, zoomY);
    renderer2d.camera.updateProjectionMatrix();
  };

  const computeIncenter2D = (p1: Point2D, p2: Point2D, p3: Point2D): Point2D => {
    const la = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
    const lb = Math.hypot(p1[0] - p3[0], p1[1] - p3[1]);
    const lc = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    const sum = la + lb + lc;
    if (sum < 1e-8) return [p1[0], p1[1]];
    return [
      (la * p1[0] + lb * p2[0] + lc * p3[0]) / sum,
      (la * p1[1] + lb * p2[1] + lc * p3[1]) / sum,
    ];
  };

  const getGroupTrianglesData = (groupId: number): TriangleData[] => {
    const faces = getGroupFaces(groupId);
    if (!faces || faces.size === 0) return [];
    buildRootTransforms(groupId);
    buildTransformsForGroup(groupId);
    const faceToEdges = getFaceToEdges();
    const faceIndexMap = getFaceIndexMap();
    const vertexKeyToPos = getVertexKeyToPos();
    const snap = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v);
    const tris: Array<TriangleData> = [];
    const { scale } = getSettings();
    const makeVertexKey = (pos: BufferAttribute | InterleavedBufferAttribute, idx: number) =>
      `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;
    faces.forEach((fid) => {
      const tri = faceTo2D(groupId, fid);
      if (!tri) return;
      const [a, b, c] = tri;
      // 数值归零，避免共边顶点因极小误差导致不一致
      a.x = snap(a.x);
      a.y = snap(a.y);
      b.x = snap(b.x);
      b.y = snap(b.y);
      c.x = snap(c.x);
      c.y = snap(c.y);
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
      const edges = edgeIds.map((eid, edgeIdx) => {
        const edgeRec = getEdgesArray()[eid];
        const isSeam = edgeRec?.faces && edgeRec.faces.size === 2 && sharedEdgeIsSeam([...edgeRec.faces][0], [...edgeRec.faces][1]);
        const isOuter = isSeam || (edgeRec?.faces.size ?? 0) === 1;
        let seamIncenter: Point2D | undefined;
        if (isSeam && edgeRec?.faces) {
          const [k1, k2] = edgeRec.vertices;
          const p1 = keyTo2D.get(k1);
          const p2 = keyTo2D.get(k2);
          const v1 = vertexKeyToPos.get(k1);
          const v2 = vertexKeyToPos.get(k2);
          const otherFace = Array.from(edgeRec.faces).find((f) => f !== fid);
          if (p1 && p2 && v1 && v2 && otherFace !== undefined) {
            const otherMapping = faceIndexMap.get(otherFace);
            if (otherMapping) {
              const geom = otherMapping.mesh.geometry;
              const posAttr = geom.getAttribute("position");
              if (posAttr) {
                const [ia, ib, ic] = getFaceVertexIndices(geom, otherMapping.localFace);
                const keyForOther = (idx: number) => `${posAttr.getX(idx)},${posAttr.getY(idx)},${posAttr.getZ(idx)}`;
                const keys = [keyForOther(ia), keyForOther(ib), keyForOther(ic)];
                const thirdKey = keys.find((k) => k !== k1 && k !== k2);
                if (thirdKey) {
                  const v3 = vertexKeyToPos.get(thirdKey);
                  if (v3) {
                    const d1 = v1.distanceTo(v3);
                    const d2 = v2.distanceTo(v3);
                    const base2d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
                    if (base2d > 1e-8) {
                      const ex: Point2D = [(p2[0] - p1[0]) / base2d, (p2[1] - p1[1]) / base2d];
                      const ey: Point2D = [-ex[1], ex[0]];
                      const x = (d1 * d1 - d2 * d2 + base2d * base2d) / (2 * base2d);
                      const ySq = d1 * d1 - x * x;
                      if (ySq >= 0) {
                        const y = Math.sqrt(ySq);
                        const cand = (sgn: number): Point2D => [
                          p1[0] + ex[0] * x + ey[0] * y * sgn,
                          p1[1] + ex[1] * x + ey[1] * y * sgn,
                        ];
                        const c1 = cand(1);
                        const c2 = cand(-1);
                        const triThird =
                          edgeIdx === 0 ? c :
                          edgeIdx === 1 ? a :
                          b;
                        const edgeVec: Point2D = [p2[0] - p1[0], p2[1] - p1[1]];
                        const side = (pt: Point2D) =>
                          Math.sign(edgeVec[0] * (pt[1] - p1[1]) - edgeVec[1] * (pt[0] - p1[0]));
                        const triSide = side([triThird.x, triThird.y]);
                        const s1 = side(c1);
                        const s2 = side(c2);
                        let flatV3 = c1;
                        if (triSide !== 0) {
                          if (s1 === -triSide) flatV3 = c1;
                          else if (s2 === -triSide) flatV3 = c2;
                          else if (s1 === 0) flatV3 = c2;
                          else flatV3 = c1;
                        } else {
                          flatV3 = s1 !== 0 ? c1 : c2;
                        }
                        const inc = computeIncenter2D(p1, p2, flatV3);
                        seamIncenter = [inc[0] * scale, inc[1] * scale];
                      }
                    }
                  }
                }
              }
            }
          }
        }
        return {
          isOuter,
          angle: angleIndex.getAngle(eid),
          isSeam,
          incenter: seamIncenter,
        };
      });
      const pointAngleData: TriangleData["pointAngleData"] = [];
      if (mapping) {
        const geom = mapping.mesh.geometry;
        const pos = geom.getAttribute("position");
        if (pos) {
          const [ia, ib, ic] = getFaceVertexIndices(geom, mapping.localFace);
          // 预计算与该三角顶点相关的最小二面角
          angleIndex.precomputeVertexMinAngle(makeVertexKey(pos, ia));
          angleIndex.precomputeVertexMinAngle(makeVertexKey(pos, ib));
          angleIndex.precomputeVertexMinAngle(makeVertexKey(pos, ic));
          const keys = [
            { key: makeVertexKey(pos, ia), pos: a },
            { key: makeVertexKey(pos, ib), pos: b },
            { key: makeVertexKey(pos, ic), pos: c },
          ];
          keys.forEach(({ key, pos }) => {
            const minAngle = angleIndex.getVertexMinAngle(key);
            if (minAngle !== undefined) {
              pointAngleData.push({ vertexKey: key, unfold2dPos: [pos.x * scale, pos.y * scale], minAngle });
            }
          });
        }
      }
      tris.push({
        tri: [
          [a.x * scale, a.y * scale],
          [b.x * scale, b.y * scale],
          [c.x * scale, c.y * scale],
        ],
        faceId: fid,
        edges: edges,
        pointAngleData,
        incenter: computeIncenter2D(
          [a.x * scale, a.y * scale],
          [b.x * scale, b.y * scale],
          [c.x * scale, c.y * scale],
        ),
      });
    });
    return tris;
  };

  appEventBus.on("modelCleared", () => {
    modelLoaded = false;
    clearScene();
    clearTransforms();
  });

  appEventBus.on("groupFaceAdded", ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    if (!modelLoaded) return;
    rebuildGroup2D(groupId);
  });
  appEventBus.on("groupFaceRemoved", ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    if (!modelLoaded) return;
    rebuildGroup2D(groupId);
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
    if (!modelLoaded) return;
    const ok = repaintGroupColor(groupId);
    if (!ok) rebuildGroup2D(groupId);
  });
  appEventBus.on("modelLoaded", () => {
    modelLoaded = true;
    const groups = getGroupIds();
    if (groups.length === 0) return;
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });
  appEventBus.on("groupAdded", ({ groupId }) => {
    clearScene();
  });
  appEventBus.on("groupRemoved", ({ groupId, faces }) => {
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });

  appEventBus.on("groupCurrentChanged", (groupId: number) => {
    rebuildGroup2D(groupId);
  });

  return {
    getGroupTrianglesData,
  };
}
