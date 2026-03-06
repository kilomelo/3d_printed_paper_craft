// 模型与几何工具：存储当前模型引用、最近文件名，并提供几何预处理（功能 mesh 生成、索引构建）。
import { BufferGeometry, Group, Mesh, Object3D, Vector3, Float32BufferAttribute } from "three";
import { createFrontMaterial, createBackMaterial, createEdgeMaterial, createSilhouetteMaterial, createDepthMaterial,
  patchOpaquePass, patchTranslucentPass } from "./materials";
import { type EdgeJoinType, v3 } from "../types/geometryTypes";
import { pointKey3D } from "./mathUtils";
// 几何索引层的去重边记录。
// joinType 是业务属性，但它与边一一对应，放在这里可以保证：
// 1. 任何拿到 edgeId 的模块都能直接读取当前边的拼接方式；
// 2. 后续做 2D 数据生产、3D 建模、序列化时，不必额外查第二份表。
export type EdgeRecord = {
  id: number;
  key: string;
  faces: Set<number>;
  vertices: [string, string];
  joinType: EdgeJoinType;
};
export type GeometryPrep = {
  faceAdjacency: Map<number, Set<number>>;
  faceIndexMap: Map<number, { mesh: Mesh; localFace: number }>;
  meshFaceIdMap: Map<string, Map<number, number>>;
  faceToEdges: Map<number, [number, number, number]>;
  edges: EdgeRecord[];
  edgeKeyToId: Map<string, number>;
  vertexKeyToPos: Map<string, Vector3>;
  triangleCount: number;
};

// ---- 模型状态 ----

type ModelState = {
  current: Group | null;
  // 以 edge key 为索引保存边属性。
  // 它是当前模型会话内的“源数据”，prepareGeometryData 重建 EdgeRecord 时会从这里回填，
  // 避免几何索引重建导致边属性丢失。
  edgeJoinTypeByKey: Map<string, EdgeJoinType>;
  // 当前所有仍在使用中的 EdgeRecord 引用。
  // 这层注册表用于解决一个关键问题：
  // - history / 导入操作会批量修改 edgeJoinTypeByKey；
  // - 但渲染与建模模块手里拿着的是已经构建好的 EdgeRecord 对象；
  // - 如果不把新值同步回这些活动对象，撤销重做后界面和建模仍会读到旧 joinType。
  //
  // 因此这里按 edge key 维护“所有活动 EdgeRecord 实例”的集合，供批量同步使用。
  liveEdgeRecordsByKey: Map<string, Set<EdgeRecord>>;
};

const state: ModelState = {
  current: null,
  edgeJoinTypeByKey: new Map<string, EdgeJoinType>(),
  liveEdgeRecordsByKey: new Map<string, Set<EdgeRecord>>(),
};

const EDGE_JOIN_TYPE_VALUES: EdgeJoinType[] = ["default", "clip", "interlocking"];

export function isValidEdgeJoinType(value: unknown): value is EdgeJoinType {
  return typeof value === "string" && EDGE_JOIN_TYPE_VALUES.includes(value as EdgeJoinType);
}

export function getDefaultEdgeJoinType(): EdgeJoinType {
  return "default";
}

export function setModel(root: Group | null) {
  state.current = root;
  // 当前模型切换时，边 key 集合会整体变化。
  // 这里直接清空边属性表和活动 EdgeRecord 注册表，后续如需从 3dppc 恢复，会在模型加载完成后重新导入。
  state.edgeJoinTypeByKey.clear();
  state.liveEdgeRecordsByKey.clear();
}

export function getModel(): Group | null {
  return state.current;
}

// 读取指定边 key 的拼接方式；若尚未设置，返回三元定义中的默认态。
export function getEdgeJoinTypeByKey(edgeKey: string): EdgeJoinType {
  return state.edgeJoinTypeByKey.get(edgeKey) ?? getDefaultEdgeJoinType();
}

// 直接写入指定边 key 的拼接方式。
// joinType 为 "default" 时会删除显式记录，保持存储紧凑，并明确与“未覆盖”语义一致。
export function setEdgeJoinTypeByKey(edgeKey: string, joinType: EdgeJoinType): boolean {
  if (!isValidEdgeJoinType(joinType)) return false;
  if (joinType === "default") {
    state.edgeJoinTypeByKey.delete(edgeKey);
  } else {
    state.edgeJoinTypeByKey.set(edgeKey, joinType);
  }
  syncLiveEdgeRecordsByKey(edgeKey);
  return true;
}

// 对已存在的 EdgeRecord 直接更新 joinType，同时同步底层存储。
// 后续交互层通常会先拿到 edgeId -> EdgeRecord，再调用这个方法更直接。
export function setEdgeJoinType(edge: EdgeRecord, joinType: EdgeJoinType): boolean {
  if (!setEdgeJoinTypeByKey(edge.key, joinType)) return false;
  edge.joinType = joinType;
  return true;
}

// 导出当前模型会话内“显式覆盖”的边属性。
// 仅输出非 default 值，便于后续 3dppc 持久化保持最小体积。
export function exportEdgeJoinTypes(): [string, EdgeJoinType][] {
  return Array.from(state.edgeJoinTypeByKey.entries());
}

// 批量导入边属性。
// 允许未来从 3dppc annotations 中恢复；当前轮先把底层接口准备好。
export function importEdgeJoinTypes(entries: Iterable<[string, unknown]> | null | undefined) {
  state.edgeJoinTypeByKey.clear();
  if (!entries) return;
  for (const [edgeKey, rawJoinType] of entries) {
    if (typeof edgeKey !== "string") continue;
    if (!isValidEdgeJoinType(rawJoinType)) continue;
    if (rawJoinType === "default") continue;
    state.edgeJoinTypeByKey.set(edgeKey, rawJoinType);
  }
  syncAllLiveEdgeRecords();
}

// 注册一批当前处于活动状态的 EdgeRecord。
// GeometryIndex 在重建完索引后会调用它；后续 import/history 才能把 joinType 推回这些对象。
export function registerLiveEdgeRecords(edges: Iterable<EdgeRecord>) {
  for (const edge of edges) {
    const list = state.liveEdgeRecordsByKey.get(edge.key) ?? new Set<EdgeRecord>();
    list.add(edge);
    state.liveEdgeRecordsByKey.set(edge.key, list);
    // 注册时顺手把当前源数据同步到实例，保证新建索引与状态表一致。
    edge.joinType = getEdgeJoinTypeByKey(edge.key);
  }
}

// 注销一批不再使用的 EdgeRecord，避免多次 rebuild 后把废弃引用留在注册表里。
export function unregisterLiveEdgeRecords(edges: Iterable<EdgeRecord>) {
  for (const edge of edges) {
    const list = state.liveEdgeRecordsByKey.get(edge.key);
    if (!list) continue;
    list.delete(edge);
    if (list.size === 0) {
      state.liveEdgeRecordsByKey.delete(edge.key);
    }
  }
}

function syncLiveEdgeRecordsByKey(edgeKey: string) {
  const list = state.liveEdgeRecordsByKey.get(edgeKey);
  if (!list) return;
  const joinType = getEdgeJoinTypeByKey(edgeKey);
  list.forEach((edge) => {
    edge.joinType = joinType;
  });
}

function syncAllLiveEdgeRecords() {
  state.liveEdgeRecordsByKey.forEach((_, edgeKey) => {
    syncLiveEdgeRecordsByKey(edgeKey);
  });
}

// ---- 几何预处理与索引 ----

export function getFaceVertexIndices(geometry: BufferGeometry, faceIndex: number): number[] {
  const indexAttr = geometry.index;
  if (indexAttr) {
    return [
      indexAttr.getX(faceIndex * 3),
      indexAttr.getX(faceIndex * 3 + 1),
      indexAttr.getX(faceIndex * 3 + 2),
    ];
  }
  return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
}

function applyDefaultFaceColors(mesh: Mesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return;
  const vertexCount = position.count;
  const colors = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 1;
    colors[i * 3 + 2] = 1;
    colors[i * 3 + 3] = 1;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
}

export function generateFunctionalMeshes(root: Object3D, target: Object3D) {
  target.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      applyDefaultFaceColors(mesh);
      const frontMat = createFrontMaterial();
      patchOpaquePass(frontMat);
      mesh.material = frontMat;

      // 用于绘制模型背面的材质
      const geomBack = mesh.geometry;
      const matBack = createBackMaterial();
      patchOpaquePass(matBack);
      const meshBack = new Mesh(geomBack, matBack);
      meshBack.name = mesh.name ? `${mesh.name}-back` : "back-only";
      meshBack.userData.functional = "back";
      meshBack.castShadow = false;
      meshBack.receiveShadow = false;
      meshBack.renderOrder = 1;
      root.add(meshBack);
      // 用于绘制三角面线框的材质
      const geomWireframe = mesh.geometry;
      const matWireframe = createEdgeMaterial();
      patchOpaquePass(matWireframe);
      const meshWireframe = new Mesh(geomWireframe, matWireframe);
      meshWireframe.userData.functional = "edge";
      meshWireframe.castShadow = false;
      meshWireframe.receiveShadow = false;
      meshWireframe.name = mesh.name ? `${mesh.name}-wireframe` : "wireframe-only";
      meshWireframe.renderOrder = 2;
      root.add(meshWireframe);
      // 用于绘制模型剪影的材质
      const geoSilhouette = mesh.geometry;
      const meshSilhouette = new Mesh(geoSilhouette, createSilhouetteMaterial());
      meshSilhouette.name = mesh.name ? `${mesh.name}-silhouette` : "silhouette-only";
      const meshDepth = new Mesh(geoSilhouette, createDepthMaterial());
      meshDepth.name = mesh.name ? `${mesh.name}-depth` : "depth-only";
      meshSilhouette.userData.functional = "silhouette";
      meshDepth.userData.functional = "depth";
      meshSilhouette.castShadow = false;
      meshDepth.castShadow = false;
      meshSilhouette.receiveShadow = false;
      meshDepth.receiveShadow = false;
      meshSilhouette.renderOrder = 1000;
      meshDepth.renderOrder = 1001;
      root.add(meshSilhouette);
      root.add(meshDepth);
    }
  });
}

export function countTrianglesInObject(object: Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    if (geometry.index) {
      count += geometry.index.count / 3;
    } else {
      const position = geometry.getAttribute("position");
      count += position ? position.count / 3 : 0;
    }
  });
  return count;
}

export function prepareGeometryData(object: Object3D): GeometryPrep {
  const faceAdjacency = new Map<number, Set<number>>();
  const faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
  const meshFaceIdMap = new Map<string, Map<number, number>>();
  const faceToEdges = new Map<number, [number, number, number]>();
  const edges: EdgeRecord[] = [];
  const edgeKeyToId = new Map<string, number>();
  const vertexKeyToPos = new Map<string, Vector3>();

  let faceId = 0;
  const vertexKey = (pos: any, idx: number) => pointKey3D([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);

  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    const indexAttr = geometry.index;
    const position = geometry.getAttribute("position");
    if (position) {
      const faceCount = indexAttr ? indexAttr.count / 3 : position.count / 3;

      if (!meshFaceIdMap.has(mesh.uuid)) {
        meshFaceIdMap.set(mesh.uuid, new Map<number, number>());
      }
      const localMap = meshFaceIdMap.get(mesh.uuid)!;

      for (let f = 0; f < faceCount; f++) {
        faceIndexMap.set(faceId, { mesh: mesh, localFace: f });
        localMap.set(f, faceId);
        const [a, b, c] = getFaceVertexIndices(geometry, f);
        const va = vertexKey(position, a);
        const vb = vertexKey(position, b);
        const vc = vertexKey(position, c);
        if (!vertexKeyToPos.has(va)) vertexKeyToPos.set(va, v3([position.getX(a), position.getY(a), position.getZ(a)]));
        if (!vertexKeyToPos.has(vb)) vertexKeyToPos.set(vb, v3([position.getX(b), position.getY(b), position.getZ(b)]));
        if (!vertexKeyToPos.has(vc)) vertexKeyToPos.set(vc, v3([position.getX(c), position.getY(c), position.getZ(c)]));
        const faceEdges: number[] = [];
        const edgePairs = [
          [va, vb],
          [vb, vc],
          [vc, va],
        ];
        edgePairs.forEach(([p1, p2]) => {
          const key = [p1, p2].sort().join("|");
          let edgeId = edgeKeyToId.get(key);
          if (edgeId === undefined) {
            edgeId = edges.length;
            edgeKeyToId.set(key, edgeId);
            // 只在边第一次被创建时，从模型状态里的源数据回填 joinType。
            // 后续同一条边被其他三角再次访问时，继续复用这条记录，不重复计算。
            edges.push({
              id: edgeId,
              key,
              faces: new Set<number>(),
              vertices: [p1, p2],
              joinType: getEdgeJoinTypeByKey(key),
            });
          }
          edges[edgeId].faces.add(faceId);
          faceEdges.push(edgeId);
        });
        faceToEdges.set(faceId, faceEdges as [number, number, number]);
        faceId++;
      }
    }
  });

  edges.forEach((edge) => {
    const faces = Array.from(edge.faces);
    if (faces.length < 2) return;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const a = faces[i];
        const b = faces[j];
        if (!faceAdjacency.has(a)) faceAdjacency.set(a, new Set<number>());
        if (!faceAdjacency.has(b)) faceAdjacency.set(b, new Set<number>());
        faceAdjacency.get(a)!.add(b);
        faceAdjacency.get(b)!.add(a);
      }
    }
  });
  const triangleCount = countTrianglesInObject(object);
  return { faceAdjacency, faceIndexMap, meshFaceIdMap, faceToEdges, edges, edgeKeyToId, vertexKeyToPos, triangleCount };
}
