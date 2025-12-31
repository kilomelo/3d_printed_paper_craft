// 展开组 2D 管理器：监听面增删事件，按需查询角度索引并维护组内面/边的缓存，后续可用于 2D 重建。
import { BufferGeometry, Mesh, Vector3, Float32BufferAttribute, Matrix4, Quaternion } from "three";
import type { GeometryIndex } from "./geometryIndex";
import { getFaceVertexIndices } from "./modelLoader";
import { AngleIndex } from "./angleIndex";
import { appEventBus } from "./eventBus";
import type { Renderer2DContext } from "./renderer2d";
import { createUnfoldEdgeMaterial, createUnfoldFaceMaterial } from "./materials";
import type { GroupTreeParent } from "./groups";

type GroupCache = {
  faces: Set<number>;
  edges: Set<number>;
};

// 记录“3D → 2D”变换矩阵，后续将按组树关系进行累乘展开。
type TransformTree = Map<number, Matrix4>;
type TransformStore = Map<number, TransformTree>;

type ManagerDeps = {
  angleIndex: AngleIndex;
  renderer2d: Renderer2DContext;
  getGroupFaces: () => Map<number, Set<number>>;
  getPreviewGroupId: () => number;
  refreshVertexWorldPositions: () => void;
  getFaceGroupMap: () => Map<number, number | null>;
  getGroupColor: (gid: number) => THREE.Color;
  getGroupTreeParent: () => GroupTreeParent;
  getFaceToEdges: () => Map<number, [number, number, number]>;
  getEdgesArray: () => ReturnType<GeometryIndex["getEdgesArray"]>;
  getVertexKeyToPos: () => Map<string, Vector3>;
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>;
};

export function createUnfold2dManager(opts: ManagerDeps) {
  const {
    angleIndex,
    renderer2d,
    getGroupFaces,
    getPreviewGroupId,
    refreshVertexWorldPositions,
    getFaceGroupMap,
    getGroupColor,
    getGroupTreeParent,
    getFaceToEdges,
    getEdgesArray,
    getVertexKeyToPos,
    getFaceIndexMap,
  } = opts;
  const groupCache = new Map<number, GroupCache>();
  const transformStore: TransformStore = new Map();
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

  const clearScene = () => {
    renderer2d.root.children.forEach((child) => {
      if ((child as Mesh).isMesh) {
        (child.geometry as BufferGeometry).dispose();
        ((child as Mesh).material as any)?.dispose?.();
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
    const sharedEdgeId = findSharedEdge(parentId, childId);
    if (sharedEdgeId === null) {
      console.warn("[unfold2d] no shared edge", { parentId, childId });
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
    setFaceTransform(groupId, childId, mat);
  };

  const buildTransformsForGroup = (groupId: number) => {
    const parentMap = getGroupTreeParent().get(groupId);
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
    const parentMap = getGroupTreeParent().get(groupId);
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
    const parentMap = getGroupTreeParent().get(groupId);
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
      console.debug("[unfold2d] root transform set", { groupId, faceId, normal: normal.toArray(), matrix: rootMat.elements });
    });
  };

  const rebuildGroup2D = (groupId: number) => {
    const faces = getGroupFaces().get(groupId);
    clearScene();
    if (!faces || faces.size === 0) return;
    clearTransforms();
    buildRootTransforms(groupId);
    buildTransformsForGroup(groupId);
    refreshVertexWorldPositions();
    const positions: number[] = [];
    const colors: number[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    faces.forEach((fid) => {
      const tri = faceTo2D(groupId, fid);
      if (!tri) return;
      const [a, b, c] = tri;
      const gid = getFaceGroupMap().get(fid);
      const col = gid !== null && gid !== undefined ? getGroupColor(gid) : getGroupColor(groupId);
      const cr = col.r;
      const cg = col.g;
      const cb = col.b;
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
    console.debug("[unfold2d] rebuild group", {
      groupId,
      faces: Array.from(faces),
      camera: {
        position: renderer2d.camera.position.clone(),
        lookAt: { x: renderer2d.camera.getWorldDirection(new Vector3()).x, y: renderer2d.camera.getWorldDirection(new Vector3()).y, z: renderer2d.camera.getWorldDirection(new Vector3()).z },
      },
      bounds: { minX, minY, maxX, maxY },
      sampleTri: positions.slice(0, 9),
    });
  };

  const ensureGroup = (groupId: number) => {
    if (!groupCache.has(groupId)) {
      groupCache.set(groupId, { faces: new Set(), edges: new Set() });
    }
    return groupCache.get(groupId)!;
  };

  const warmAnglesForFace = (faceId: number, cache: GroupCache) => {
    const faceToEdges = getFaceToEdges();
    const edges = faceToEdges.get(faceId);
    if (!edges) return;
    edges.forEach((eid) => {
      cache.edges.add(eid);
      angleIndex.getAngle(eid);
    });
  };

  const onFaceAdded = ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    const cache = ensureGroup(groupId);
    cache.faces.add(faceId);
    console.debug("[unfold2d] face added", { groupId, faceId });
    warmAnglesForFace(faceId, cache);
    rebuildGroup2D(groupId);
  };

  const onFaceRemoved = ({ groupId, faceId }: { groupId: number; faceId: number }) => {
    const cache = ensureGroup(groupId);
    cache.faces.delete(faceId);
    console.debug("[unfold2d] face removed", { groupId, faceId });
    // 不强制清理 edges，避免重复计算，后续完整重建时可重置
    rebuildGroup2D(groupId);
  };

  const reset = () => {
    groupCache.clear();
    clearScene();
    clearTransforms();
  };

  appEventBus.on("group2dFaceAdded", onFaceAdded);
  appEventBus.on("group2dFaceRemoved", onFaceRemoved);
  appEventBus.on("modelLoaded", () => {
    reset();
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });
  appEventBus.on("groupDataChanged", () => {
    const gid = getPreviewGroupId();
    rebuildGroup2D(gid);
  });

  return {
    reset,
    rebuildGroup: rebuildGroup2D,
    debugState: () => groupCache,
    setRootTransform,
    setFaceTransform,
    getTransformChain,
  };
}
