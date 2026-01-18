import * as THREE from "three";

export type Point2D = [number, number];
export type Point3D = [number, number, number];
export type Edge2D = [Point2D, Point2D];
export type Edge3D = [Point3D, Point3D];
export type Triangle2D = [Point2D, Point2D, Point2D];
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Plane3D = { normal: Vec3; point: Point3D };

export type TriangleWithEdgeInfo = {
  tri: Triangle2D;
  faceId: number;
  edges: { isOuter: boolean; angle: number; isSeam?: boolean; earAngleA?: number; earAngleB?: number; }[];
  pointAngleData?: { vertexKey: string; unfold2dPos: Point2D; minAngle: number }[];
  incenter?: Point2D;
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
