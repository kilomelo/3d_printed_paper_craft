import { Mesh, Object3D, Vector3 } from "three";
import { EdgeRecord, prepareGeometryData } from "./modelLoader";

export class GeometryIndex {
  private faceAdjacency = new Map<number, Set<number>>();
  private faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
  private meshFaceIdMap = new Map<string, Map<number, number>>();
  private faceToEdges = new Map<number, [number, number, number]>();
  private edges: EdgeRecord[] = [];
  private edgeKeyToId = new Map<string, number>();
  private vertexKeyToPos = new Map<string, Vector3>();
  private triangleCount = 0;

  reset() {
    this.faceAdjacency = new Map();
    this.faceIndexMap = new Map();
    this.meshFaceIdMap = new Map();
    this.faceToEdges = new Map();
    this.edges = [];
    this.edgeKeyToId = new Map();
    this.vertexKeyToPos = new Map();
    this.triangleCount = 0;
  }

  buildFromObject(object: Object3D) {
    const prep = prepareGeometryData(object);
    this.faceAdjacency = prep.faceAdjacency;
    this.faceIndexMap = prep.faceIndexMap;
    this.meshFaceIdMap = prep.meshFaceIdMap;
    this.faceToEdges = prep.faceToEdges;
    this.edges = prep.edges;
    this.edgeKeyToId = prep.edgeKeyToId;
    this.vertexKeyToPos = prep.vertexKeyToPos;
    this.triangleCount = prep.triangleCount;
  }

  refreshVertexWorldPositions(model: Object3D | null) {
    this.vertexKeyToPos.clear();
    if (!model) return;
    const vertexKey = (pos: any, idx: number) => `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;
    model.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      mesh.updateWorldMatrix(true, false);
      const position = mesh.geometry.getAttribute("position");
      if (!position) return;
      const count = position.count;
      for (let i = 0; i < count; i++) {
        const key = vertexKey(position, i);
        const world = new Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
        this.vertexKeyToPos.set(key, world);
      }
    });
  }

  getFaceId(mesh: Mesh, localFace: number | undefined): number | null {
    if (localFace === undefined || localFace === null) return null;
    const map = this.meshFaceIdMap.get(mesh.uuid);
    if (!map) return null;
    return map.get(localFace) ?? null;
  }

  getEdgeWorldPositions(edgeId: number): [Vector3, Vector3] | null {
    const edge = this.edges[edgeId];
    if (!edge) return null;
    const v1 = this.vertexKeyToPos.get(edge.vertices[0]);
    const v2 = this.vertexKeyToPos.get(edge.vertices[1]);
    if (!v1 || !v2) return null;
    return [v1, v2];
  }
  getEdgesArray() {
    return this.edges;
  }

  getFaceAdjacency() {
    return this.faceAdjacency;
  }
  getFaceIndexMap() {
    return this.faceIndexMap;
  }
  getMeshFaceIdMap() {
    return this.meshFaceIdMap;
  }
  getFaceToEdges() {
    return this.faceToEdges;
  }
  getEdges() {
    return this.edges;
  }
  getEdgeKeyToId() {
    return this.edgeKeyToId;
  }
  getVertexKeyToPos() {
    return this.vertexKeyToPos;
  }
  getTriangleCount() {
    return this.triangleCount;
  }
}
// 几何索引缓存：对加载的模型构建 face/edge/vertex 映射与邻接关系，并支持刷新的 getter。
