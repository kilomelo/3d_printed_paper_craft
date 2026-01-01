// 角度索引：按需计算并缓存边的二面角（弧度），在模型重新加载时清空，查询时若未命中则计算并写入缓存。
import { Vector3, Mesh } from "three";
import { GeometryIndex } from "./geometryIndex";
import { getFaceVertexIndices } from "./modelLoader";

type AngleCache = Map<number, number>;

export class AngleIndex {
  private cache: AngleCache = new Map();
  private geometryIndex: GeometryIndex | null = null;
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
  }

  clear() {
    this.cache.clear();
    this.geometryIndex = null;
  }

  getAngle(edgeId: number): number {
    if (this.cache.has(edgeId)) {
      const val = this.cache.get(edgeId)!;
      const deg = (val * 180) / Math.PI;
      console.debug("[angleIndex] hit", {
        edgeId,
        angleRad: val,
        angleDeg: deg.toFixed(3),
        type: val < 0 ? "concave" : "convex",
      });
      return val;
    }
    const val = this.computeAngle(edgeId);
    const deg = (val * 180) / Math.PI;
    console.debug("[angleIndex] miss-computed", {
        edgeId,
        angleRad: val,
        angleDeg: deg.toFixed(3),
        type: val < 0 ? "concave" : "convex",
      });
    this.cache.set(edgeId, val);
    return val;
  }

  private computeAngle(edgeId: number): number {
    const fallbackAngle = 180;
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

    // 取共享边两个顶点的世界坐标
    const [k1, k2] = edge.vertices;
    const v1 = vertexKeyToPos.get(k1);
    const v2 = vertexKeyToPos.get(k2);
    if (!v1 || !v2) return fallbackAngle;

    // 更新矩阵并转世界坐标
    this.applyWorld(v1, faceA.mesh, this.tempA);
    this.applyWorld(v2, faceA.mesh, this.tempB);
    this.edgeDir.copy(this.tempB).sub(this.tempA).normalize();

    // 计算两面法线
    this.computeFaceNormal(faceA.mesh, faceA.localFace, this.n1);
    this.computeFaceNormal(faceB.mesh, faceB.localFace, this.n2);
    this.crossN.crossVectors(this.n1, this.n2);
    console.debug('[angleIndex] n1', this.n1, 'n2', this.n2, 'edgeDir', this.edgeDir, 'crossN', this.crossN);    
    const sin = this.edgeDir.dot(this.crossN);
    const cos = Math.min(1, Math.max(-1, this.n1.dot(this.n2)));
    const crossLen = this.crossN.length();
    if (crossLen < 1e-6) {
      // 法线平行：同向 => 面角 180°，反向 => 面角 0°
      return cos > 0 ? Math.PI : 0;
    }
    // 面间角 = 180° - 法线夹角；用 sin 判定凹/凸的符号
    const normalAngle = Math.acos(cos); // ∈ [0, π]
    const faceAngle = Math.PI - normalAngle; // 同向 -> 180°, 反向 -> 0°
    const sign = sin >= 0 ? 1 : -1;
    return faceAngle * sign;
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
}
