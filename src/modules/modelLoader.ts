import { Box3, BufferGeometry, Mesh, Object3D, PerspectiveCamera, Vector3, Float32BufferAttribute } from "three";
import { createBackMaterial, createEdgeMaterial } from "./materials";
import {
  ensureGroup,
  rebuildGroupTree,
  resetGroups,
  setEditGroupId,
  setPreviewGroupId,
  setFaceGroup,
} from "./groups";

export type EdgeRecord = { id: number; key: string; faces: Set<number>; vertices: [string, string] };
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
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 1;
    colors[i * 3 + 2] = 1;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
}

export function generateFunctionalMaterials(root: Object3D) {
  const replacements: { parent: Object3D; mesh: Mesh }[] = [];
  root.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      applyDefaultFaceColors(mesh);
      replacements.push({ parent: mesh.parent ? mesh.parent : root, mesh });
    }
  });
  replacements.forEach(({ parent, mesh }) => {
    const geomBack = mesh.geometry.clone();
    const meshBack = new Mesh(geomBack, createBackMaterial());
    meshBack.userData.functional = "back";
    meshBack.castShadow = mesh.castShadow;
    meshBack.receiveShadow = mesh.receiveShadow;
    meshBack.name = mesh.name ? `${mesh.name}-back` : "back-only";
    meshBack.position.copy(mesh.position);
    meshBack.rotation.copy(mesh.rotation);
    meshBack.scale.copy(mesh.scale);
    parent.add(meshBack);

    const geomWireframe = mesh.geometry.clone();
    const meshWireframe = new Mesh(geomWireframe, createEdgeMaterial());
    meshWireframe.userData.functional = "edge";
    meshWireframe.castShadow = false;
    meshWireframe.receiveShadow = false;
    meshWireframe.name = mesh.name ? `${mesh.name}-wireframe` : "wireframe-only";
    meshWireframe.position.copy(mesh.position);
    meshWireframe.rotation.copy(mesh.rotation);
    meshWireframe.scale.copy(mesh.scale);
    parent.add(meshWireframe);
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
  resetGroups();
  ensureGroup(1);
  setPreviewGroupId(1);
  setEditGroupId(null);

  const faceAdjacency = new Map<number, Set<number>>();
  const faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
  const meshFaceIdMap = new Map<string, Map<number, number>>();
  const faceToEdges = new Map<number, [number, number, number]>();
  const edges: EdgeRecord[] = [];
  const edgeKeyToId = new Map<string, number>();
  const vertexKeyToPos = new Map<string, Vector3>();

  let faceId = 0;
  const vertexKey = (pos: any, idx: number) => `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;

  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    const indexAttr = geometry.index;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const faceCount = indexAttr ? indexAttr.count / 3 : position.count / 3;

    if (!meshFaceIdMap.has(mesh.uuid)) {
      meshFaceIdMap.set(mesh.uuid, new Map<number, number>());
    }
    const localMap = meshFaceIdMap.get(mesh.uuid)!;

    for (let f = 0; f < faceCount; f++) {
      setFaceGroup(faceId, null);
      faceIndexMap.set(faceId, { mesh, localFace: f });
      localMap.set(f, faceId);
      const [a, b, c] = getFaceVertexIndices(geometry, f);
      const va = vertexKey(position, a);
      const vb = vertexKey(position, b);
      const vc = vertexKey(position, c);
      if (!vertexKeyToPos.has(va)) vertexKeyToPos.set(va, new Vector3(position.getX(a), position.getY(a), position.getZ(a)));
      if (!vertexKeyToPos.has(vb)) vertexKeyToPos.set(vb, new Vector3(position.getX(b), position.getY(b), position.getZ(b)));
      if (!vertexKeyToPos.has(vc)) vertexKeyToPos.set(vc, new Vector3(position.getX(c), position.getY(c), position.getZ(c)));
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
  rebuildGroupTree(1, faceAdjacency);
  const triangleCount = countTrianglesInObject(object);
  return { faceAdjacency, faceIndexMap, meshFaceIdMap, faceToEdges, edges, edgeKeyToId, vertexKeyToPos, triangleCount };
}

export function fitCameraToObject(object: Object3D, camera: PerspectiveCamera, controls: any) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = maxDim / (2 * Math.tan(fov / 2));
  const offset = 1.8;

  camera.position.set(-distance * offset * 0.75, -distance * offset, distance * offset * 0.75);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();
}
// 模型加载与几何预处理：生成功能性 mesh（背面/线框）、统计三角面、构建几何索引与默认颜色。
