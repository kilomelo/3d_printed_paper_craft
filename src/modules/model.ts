// 模型与几何工具：存储当前模型引用、最近文件名，并提供几何预处理（功能 mesh 生成、索引构建）。
import { BufferGeometry, Group, Mesh, Object3D, Vector3, Float32BufferAttribute } from "three";
import { createFrontMaterial, createBackMaterial, createEdgeMaterial, createSilhouetteMaterial, createDepthMaterial,
  patchOpaquePass, patchTranslucentPass } from "./materials";
import { v3 } from "../types/geometryTypes";
import { pointKey3D } from "./mathUtils";
export type EdgeRecord = { id: number; key: string; faces: Set<number>; vertices: [string, string] };
export type GeometryPrep = {
  faceAdjacency: Map<number, Set<number>>;
  faceIndexMap: Map<number, { mesh: Mesh[]; localFace: number }>;
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
};

const state: ModelState = {
  current: null,
};

export function setModel(root: Group | null) {
  state.current = root;
}

export function getModel(): Group | null {
  return state.current;
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
  const faceIndexMap = new Map<number, { mesh: Mesh[]; localFace: number }>();
  const meshFaceIdMap = new Map<string, Map<number, number>>();
  const faceToEdges = new Map<number, [number, number, number]>();
  const edges: EdgeRecord[] = [];
  const edgeKeyToId = new Map<string, number>();
  const vertexKeyToPos = new Map<string, Vector3>();

  let faceId = 0;
  const vertexKey = (pos: any, idx: number) => pointKey3D([pos.getX(idx), pos.getY(idx), pos.getZ(idx)]);

  const backMesh = object.children.find((child) => (child as Mesh).isMesh && (child as Mesh).userData.functional === "back") as Mesh;
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
        faceIndexMap.set(faceId, { mesh: [mesh, backMesh], localFace: f });
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
            edges.push({ id: edgeId, key, faces: new Set<number>(), vertices: [p1, p2] });
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
