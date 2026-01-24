// 几何工具：计算面-边索引、顶点键、邻接关系等基础几何数据，供索引/业务层使用。
import { Vector3, type Object3D, type Mesh, BufferAttribute } from "three";
import { EdgeRecord, prepareGeometryData, getFaceVertexIndices } from "./model";
import { triangleArea } from "./mathUtils";
import { Point3D } from "@/types/geometryTypes";

// 角度索引：按需计算并缓存边的二面角（弧度），在模型重新加载时清空。
export class AngleIndex {
  private cache: Map<number, number> = new Map();
  // 顶点 -> 已见到的最小二面角（弧度，取绝对值）
  private vertexMinAngle: Map<string, number> = new Map();
  private geometryIndex: GeometryIndex | null = null;
  private faceNormalCache: Map<number, Vector3> = new Map();
  private tempA = new Vector3();
  private tempB = new Vector3();
  private tempC = new Vector3();
  private edgeDir = new Vector3();
  private n1 = new Vector3();
  private n2 = new Vector3();
  private crossN = new Vector3();

  setGeometryIndex(geometryIndex: GeometryIndex) {
    this.geometryIndex = geometryIndex;
    this.cache.clear();
    this.vertexMinAngle.clear();
    this.faceNormalCache.clear();
  }

  clear() {
    this.cache.clear();
    this.vertexMinAngle.clear();
    this.faceNormalCache.clear();
    this.geometryIndex = null;
  }

  getAngle(edgeId: number): number {
    if (this.cache.has(edgeId)) {
      return this.cache.get(edgeId)!;
    }
    const val = this.computeAngle(edgeId);
    this.cache.set(edgeId, val);
    return val;
  }

  private computeAngle(edgeId: number): number {
    const fallbackAngle = Math.PI;
    if (!this.geometryIndex) return fallbackAngle;
    const edges = this.geometryIndex.getEdgesArray();
    const edge = edges[edgeId];
    if (!edge) return fallbackAngle;
    const faces = Array.from(edge.faces);
    if (faces.length < 2) return fallbackAngle;
    const faceIndexMap = this.geometryIndex.getFaceIndexMap();
    const vertexKeyToPos = this.geometryIndex.getVertexKeyToPos();

    const faceAId = faces[0];
    const faceBId = faces[1];
    const faceA = faceIndexMap.get(faceAId);
    const faceB = faceIndexMap.get(faceBId);
    if (!faceA || !faceB) return fallbackAngle;

    const [k1, k2] = edge.vertices;
    const v1 = vertexKeyToPos.get(k1);
    const v2 = vertexKeyToPos.get(k2);
    if (!v1 || !v2) return fallbackAngle;

    this.applyWorld(v1, faceA.mesh[0], this.tempA);
    this.applyWorld(v2, faceA.mesh[0], this.tempB);
    this.edgeDir.copy(this.tempB).sub(this.tempA).normalize();

    this.getFaceNormal(faceAId, this.n1);
    this.getFaceNormal(faceBId, this.n2);
    this.crossN.crossVectors(this.n1, this.n2);
    const sin = this.edgeDir.dot(this.crossN);
    const cos = Math.min(1, Math.max(-1, this.n1.dot(this.n2)));
    const crossLen = this.crossN.length();
    if (crossLen < 1e-6) {
      const angle = cos > 0 ? Math.PI : 0;
      this.updateVertexMinAngles(edge.vertices, angle);
      return angle;
    }
    const normalAngle = Math.acos(cos);
    const faceAngle = Math.PI - normalAngle;
    const angle = sin > 0 ? faceAngle : 2 * Math.PI - faceAngle;

    this.updateVertexMinAngles(edge.vertices, angle);
    return angle;
  }

  private updateVertexMinAngles(vertexKeys: [string, string], angleRad: number) {
    const mag = Math.abs(angleRad);
    for (const vk of vertexKeys) {
      const prev = this.vertexMinAngle.get(vk);
      const next = prev === undefined ? mag : Math.min(prev, mag);
      this.vertexMinAngle.set(vk, next);
    }
  }

  getVertexMinAngle(key: string): number | undefined {
    return this.vertexMinAngle.get(key);
  }

  // 预计算指定顶点关联边的二面角，确保最小角度已就绪
  precomputeVertexMinAngle(vertexKey: string) {
    if (!this.geometryIndex) return;
    const edges = this.geometryIndex.getEdgesArray();
    edges.forEach((edge, idx) => {
      if (edge.vertices[0] === vertexKey || edge.vertices[1] === vertexKey) {
        this.getAngle(idx);
      }
    });
  }

  private applyWorld(src: Vector3, mesh: Mesh, out: Vector3) {
    mesh.updateWorldMatrix(true, false);
    out.copy(src).applyMatrix4(mesh.matrixWorld);
  }

  private computeFaceNormal(mesh: Mesh, localFace: number, out: Vector3) {
    const geometry = mesh.geometry;
    const pos = geometry.getAttribute("position");
    if (!pos) {
      out.set(0, 0, 1);
      return;
    }
    const [ia, ib, ic] = getFaceVertexIndices(geometry, localFace);
    this.tempA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mesh.matrixWorld);
    this.tempB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mesh.matrixWorld);
    this.tempC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mesh.matrixWorld);
    out.subVectors(this.tempB, this.tempA).cross(this.tempC.sub(this.tempA)).normalize();
  }

  // 对外提供获取某个面的世界法线（带缓存）
  getFaceNormal(faceId: number, out: Vector3): boolean {
    if (!this.geometryIndex) return false;
    const cached = this.faceNormalCache.get(faceId);
    if (cached) {
      out.copy(cached);
      return true;
    }
    const mapping = this.geometryIndex.getFaceIndexMap().get(faceId);
    if (!mapping) return false;
    this.computeFaceNormal(mapping.mesh[0], mapping.localFace, out);
    this.faceNormalCache.set(faceId, out.clone());
    return true;
  }
}

export type PPCGeometry = {
  vertices: number[][];
  triangles: number[][];
};

export function collectGeometry(object: Object3D): PPCGeometry {
  const vertices: number[][] = [];
  const triangles: number[][] = [];

  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const indexAttr = geometry.index;
    const indices: number[] = [];
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        indices.push(i);
      }
    }

    // 不去重顶点，保持硬边
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const vaIdx = vertices.length;
      vertices.push([position.getX(a), position.getY(a), position.getZ(a)]);
      const vbIdx = vertices.length;
      vertices.push([position.getX(b), position.getY(b), position.getZ(b)]);
      const vcIdx = vertices.length;
      vertices.push([position.getX(c), position.getY(c), position.getZ(c)]);
      triangles.push([vaIdx, vbIdx, vcIdx]);
    }
  });
  return { vertices, triangles };
}

export function filterLargestComponent(
  geom: PPCGeometry,
): { vertices: number[][]; triangles: number[][]; mapping: number[] } {
  const { vertices, triangles } = geom;
  if (triangles.length === 0) return { ...geom, mapping: [] };

  // collectGeometry 为硬边模式，每个三角的三个顶点都是独立的。
  // 建连通性时按坐标匹配顶点来判断三角是否相邻。
  const posKeys = vertices.map((v) => `${v[0]},${v[1]},${v[2]}`);
  const keyToTris = new Map<string, number[]>();
  triangles.forEach((tri, idx) => {
    tri.forEach((vIdx) => {
      const key = posKeys[vIdx];
      const list = keyToTris.get(key) ?? [];
      list.push(idx);
      keyToTris.set(key, list);
    });
  });

  const visited = new Array(triangles.length).fill(false);
  let best: { triIdx: number[]; area: number } = { triIdx: [], area: -Infinity };

  for (let i = 0; i < triangles.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = true;
    const comp: number[] = [];
    let area = 0;

    while (queue.length) {
      const tIdx = queue.pop()!;
      comp.push(tIdx);
      const [a, b, c] = triangles[tIdx];
      area += triangleArea(vertices[a] as Point3D, vertices[b] as Point3D, vertices[c] as Point3D);

      [a, b, c].forEach((vIdx) => {
        const key = posKeys[vIdx];
        (keyToTris.get(key) ?? []).forEach((n) => {
          if (!visited[n]) {
            visited[n] = true;
            queue.push(n);
          }
        });
      });

      [a, b, c].forEach((vIdx) => {
        const key = posKeys[vIdx];
        (keyToTris.get(key) ?? []).forEach((n) => {
          if (!visited[n]) {
            visited[n] = true;
            queue.push(n);
          }
        });
      });
    }

    if (area > best.area) {
      best = { triIdx: comp, area };
    }
  }

  const newTriangles: number[][] = [];
  const newVertices: number[][] = [];
  const mapping = new Array(triangles.length).fill(-1);
  best.triIdx.forEach((oldIdx, newIdx) => {
    mapping[oldIdx] = newIdx;
  });

  const vertMap = new Map<number, number>();
  best.triIdx.forEach((oldIdx) => {
    const tri = triangles[oldIdx];
    const mappedTri: number[] = [];
    tri.forEach((oldV) => {
      if (!vertMap.has(oldV)) {
        vertMap.set(oldV, newVertices.length);
        newVertices.push(vertices[oldV]);
      }
      mappedTri.push(vertMap.get(oldV)!);
    });
    newTriangles.push(mappedTri);
  });

  return { vertices: newVertices, triangles: newTriangles, mapping };
}

// 几何索引缓存：对加载的模型构建 face/edge/vertex 映射与邻接关系，并支持刷新的 getter。
export class GeometryIndex {
  private faceAdjacency = new Map<number, Set<number>>();
  private faceIndexMap = new Map<number, { mesh: Mesh[]; localFace: number }>();
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
  // 给定边和其所在的面，返回该面的第三个顶点 key（不在该边上的那个点）
  getThirdVertexKeyOnFace(edgeId: number, faceId: number): string | undefined {
    const faceEdges = this.faceToEdges.get(faceId);
    const targetEdge = this.edges[edgeId];
    if (!faceEdges || !targetEdge) return undefined;
    const allVerts = new Set<string>();
    faceEdges.forEach((fid) => {
      const e = this.edges[fid];
      if (!e) return;
      e.vertices.forEach((v) => allVerts.add(v));
    });
    for (const v of allVerts) {
      if (!targetEdge.vertices.includes(v)) {
        return v;
      }
    }
    return undefined;
  }
  getTriangleCount() {
    return this.triangleCount;
  }
}

export type GeometryContext = {
  geometryIndex: GeometryIndex;
  angleIndex: AngleIndex;
  rebuildFromModel: (model: Object3D | null) => void;
  reset: () => void;
};

export function createGeometryContext(): GeometryContext {
  const geometryIndex = new GeometryIndex();
  const angleIndex = new AngleIndex();

  const rebuildFromModel = (model: Object3D | null) => {
    // console.log("[GeometryContext] Rebuilding geometry index from model...");
    reset();
    if (!model) return;
    geometryIndex.buildFromObject(model);
    angleIndex.setGeometryIndex(geometryIndex);
  };

  const reset = () => {
    geometryIndex.reset();
    angleIndex.clear();
  };

  return { geometryIndex, angleIndex, rebuildFromModel, reset };
}

export function snapGeometryPositions(geometry: THREE.BufferGeometry, decimals = 5) {
  const factor = 10 ** decimals;
  const pos = geometry.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return;
  for (let i = 0; i < pos.count; i += 1) {
    const x = Math.round(pos.getX(i) * factor) / factor;
    const y = Math.round(pos.getY(i) * factor) / factor;
    const z = Math.round(pos.getZ(i) * factor) / factor;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}