import { Sketcher, PlaneName, Point, Plane } from "replicad";
import type { Point2D } from "../../types/triangles";

export function makeVerticalPlaneThroughAB(a: Point2D, b: Point2D, z = 0): Plane | undefined {
  const ax = a[0], ay = a[1];
  const bx = b[0], by = b[1];

  const dx = bx - ax;
  const dy = by - ay;

  // A、B 重合则无法定义方向与平面
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return undefined;

  const origin: Point = [ax, ay, z];

  // 平面局部 X 方向：沿 AB
  const xDir: Point = [dx / len, dy / len, 0];

  // 平面法向：AB × Z = [dy, -dx, 0]（归一化后仍在 XY 内）
  const nx = dy / len;
  const ny = -dx / len;
  const normal: Point = [nx, ny, 0];

  return new Plane(origin, xDir, normal); // Plane(origin, xDirection, normal) :contentReference[oaicite:2]{index=2}
}

export function makeVerticalSketcherThroughAB(a: Point2D, b: Point2D) {
  const plane = makeVerticalPlaneThroughAB(a, b);
  if (!plane) return undefined;
  // Sketcher 支持直接用 Plane 实例构造 :contentReference[oaicite:3]{index=3}
  return new Sketcher(plane);
}

export function makeVerticalPlaneNormalAB(a: Point2D, b: Point2D, z = 0): Plane | undefined {
  const ax = a[0], ay = a[1];
  const bx = b[0], by = b[1];

  const dx = bx - ax;
  const dy = by - ay;

  // A、B 重合则无法定义法向
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return undefined;

  // 平面通过的点：默认仍取 A（你也可以改成 AB 中点或其它参考点）
  const origin: Point = [ax, ay, z];

  // 新需求：平面法向 = AB（归一化）
  const normal: Point = [dx / len, dy / len, 0];

  // 平面内的一条方向（xDir）：取与 AB 垂直且仍在 XY 内的方向
  // 这里选 [-dy, dx, 0]，这样配合 normal 后，平面的局部 y 方向会指向 +Z（更直观）
  const xDir: Point = [-dy / len, dx / len, 0];

  return new Plane(origin, xDir, normal);
}

export function sketchFromContourPoints(points: Point2D[], plane: PlaneName | Plane = "XY", offset: number = 0) {
  if (points.length < 3) return undefined;
  const sketcher =
    typeof plane === "string"
      ? new Sketcher(plane, offset) // PlaneName + number 偏移 :contentReference[oaicite:2]{index=2}
      : new Sketcher(offset === 0 ? plane.clone() : plane.clone().translate(plane.zDir.normalized().multiply(offset)));

  points.forEach(([x, y], idx) => {
    if (idx === 0) sketcher.movePointerTo([x, y]);
    else sketcher.lineTo([x, y]);
  });

  return sketcher.close();
}
