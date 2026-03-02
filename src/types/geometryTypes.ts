import * as THREE from "three";

export type Point2D = [number, number];
export type Point3D = [number, number, number];
export type Edge2D = [Point2D, Point2D];
export type Edge3D = [Point3D, Point3D];
export type Triangle2D = [Point2D, Point2D, Point2D];
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Plane3D = { normal: Vec3; point: Point3D };

// 建模阶段使用的边属性。语义与旧的三角形数据保持一致，
// 只是被提取为可复用的独立类型，便于三角形/多边形共用。
export type PolygonEdgeInfo = {
  isOuter: boolean;
  // 二面角，单位为角度（degree）。
  // 几何索引层内部仍使用弧度，只有在 PolygonWithEdgeInfo 这层输出时统一转换为角度，
  // 这样建模侧的配置和日志都能直接使用更直观的数值。
  angle: number;
  isSeam?: boolean;
  tabAngle: number[];
  joinSide?: "mp" | "fp";
  stableOrder?: "ab" | "ba";
};

// 顶点角度相关的附加信息，当前建模侧尚未正式消费，但保留类型语义。
export type PointAngleData = { vertexKey: string; unfold2dPos: Point2D; minAngle: number };

// 新的多边形建模输入。
// points[i] -> points[(i + 1) % n] 对应 edges[i]。
export type PolygonWithEdgeInfo = {
  points: Point2D[];
  edges: PolygonEdgeInfo[];
  pointAngleData?: PointAngleData[];
};

export const v2 = (p: Point2D) => new THREE.Vector2(p[0], p[1]);
export const v3 = (p: Point3D) => new THREE.Vector3(p[0], p[1], p[2]);

export const p2 = (v: THREE.Vector2): Point2D => [v.x, v.y];
export const p3 = (v: THREE.Vector3): Point3D => [v.x, v.y, v.z];

export const toThreePlane = (pl: Plane3D) =>
  new THREE.Plane().setFromNormalAndCoplanarPoint(
    new THREE.Vector3(pl.normal[0], pl.normal[1], pl.normal[2]),
    new THREE.Vector3(pl.point[0], pl.point[1], pl.point[2]),
  );
