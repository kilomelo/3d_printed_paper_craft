import { Sketcher, Sketch, PlaneName, Point, Plane, drawCircle, drawRectangle, Shape3D } from "replicad";
import type { Point2D } from "../../types/geometryTypes";

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

// 在指定平面上以外轮廓绘制草图
export function sketchFromContourPoints(points: Point2D[], plane: PlaneName | Plane = "XY", offset: number = 0): Sketch | undefined {
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

// 在指定平面上以外轮廓绘制草图并挤出
export function extrudeFromContourPoints(points: Point2D[], plane: PlaneName | Plane = "XY", offset: number = 0, height: number): Shape3D | undefined {
  const sketcher = sketchFromContourPoints(points, plane, offset);
  if (!sketcher) return undefined;
  return sketcher.extrude(height);
}

// 在指定平面上以指定圆心画圆然后挤出圆柱体
export function extrudeCylinderAtPlaneLocalXY(
  plane: Plane,
  center2d: [number, number], // plane 局部坐标
  radius: number,
  height: number,
  offset = 0                  // 沿 plane 法向偏移（世界长度单位）
): Shape3D {
  const [cx, cy] = center2d;

  // 1) 不改原 plane
  let p = plane.clone();

  // 2) 先把局部原点移到 (cx, cy)
  p.setOrigin2d(cx, cy);

  // 3) 再沿法向偏移到“offset 平面”
  if (offset !== 0) {
    // zDir 是 plane 的法向方向向量
    const dz = p.zDir.normalized().multiply(offset);
    p = p.translate([dz.x, dz.y, dz.z]);
  }

  // 4) 以 (0,0) 为圆心画圆并挤出
  return drawCircle(radius).sketchOnPlane(p).extrude(height) as Shape3D;
}

export function translateWorldPointAlongPlaneAxes(
  plane: { xDir: any; yDir: any; zDir: any },
  worldPoint: [number, number, number],
  offset: [number, number, number]
): [number, number, number] {
  // 兼容 replicad Vector / three Vector / tuple
  function asVec3(v: any): [number, number, number] {
    if (Array.isArray(v)) return v as [number, number, number];
    return [v.x, v.y, v.z];
  }

  function normalize(v: [number, number, number]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len < 1e-12) throw new Error("Zero-length axis in plane basis.");
    return [v[0] / len, v[1] / len, v[2] / len];
  }
  const xDir = normalize(asVec3(plane.xDir));
  const yDir = normalize(asVec3(plane.yDir));
  const zDir = normalize(asVec3(plane.zDir));

  return [
    worldPoint[0] + xDir[0] * offset[0] + yDir[0] * offset[1] + zDir[0] * offset[2],
    worldPoint[1] + xDir[1] * offset[0] + yDir[1] * offset[1] + zDir[1] * offset[2],
    worldPoint[2] + xDir[2] * offset[0] + yDir[2] * offset[1] + zDir[2] * offset[2],
  ];
}

export function splitSolidByPlane(solid: Shape3D, plane: Plane): Shape3D[] {
  const bigShape = drawRectangle(1e4, 1e4).sketchOnPlane(plane).extrude(1e4) as Shape3D;
  const plus = bigShape.intersect(solid.clone()) as Shape3D;
  const minus = solid.cut(bigShape);
  return [plus, minus];
}

/**
 * 在 plane 的局部坐标系下做变换，并保证：
 * - 只保留最终返回的那个 Plane
 * - 中间生成的其他 Plane 在返回前都会 delete()
 *
 * 约定：
 * - 先做局部 offset，再做局部轴旋转
 * - angle 为弧度
 * - rotateAround:
 *    - "x" / "y"：绕当前 plane 的局部 x/y 轴旋转（用 pivot）
 *    - "z"：绕当前 plane 的局部 z 轴旋转（用 rotate2DAxes）
 */
export function transformPlaneLocal(
  plane: Plane,
  opts?: {
    offset?: [number, number, number];
    rotateAround?: "x" | "y" | "z";
    angle?: number;
  }
): Plane {
  // 这是最终返回链条的起点；如果后面又生成新 Plane，会把旧的删掉
  let current = plane.clone();

  try {
    // ---------- 1) 局部 offset ----------
    if (opts?.offset) {
      const [dx, dy, dz] = opts.offset;

      // 局部位移 -> 世界位移
      const x = current.xDir.normalized().multiply(dx);
      const y = current.yDir.normalized().multiply(dy);
      const z = current.zDir.normalized().multiply(dz);
      const worldOffset = x.add(y).add(z);

      const next = current.translate([worldOffset.x, worldOffset.y, worldOffset.z]);
      current.delete();
      current = next;
    }

    // ---------- 2) 绕局部轴旋转 ----------
    if (opts?.rotateAround && opts.angle) {
      const angle = opts.angle;

      let next: Plane | undefined;

      if (opts.rotateAround === "z") {
        // 公开 API：绕 plane 自己的 2D 轴旋转
        next = current.rotate2DAxes(angle);
      } else {
        const axis =
          opts.rotateAround === "x"
            ? current.xDir
            : current.yDir;

        // 公开 API：绕当前 origin + 指定方向轴 pivot
        next = current.pivot(angle, [axis.x, axis.y, axis.z]);
      }

      current.delete();
      current = next;
    }

    return current;
  } catch (err) {
    // 出错时把当前链条对象释放掉，避免泄漏
    current.delete();
    throw err;
  }
}

/**
 * 从当前点（应等于 start）开始，
 * 按“圆心 + 起点 + 弧度”画圆弧。
 *
 * deltaAngle:
 *   > 0 逆时针
 *   < 0 顺时针
 */
function arcByCenterStartAngle(
  sketcher: Sketcher,
  center: Point2D,
  start: Point2D,
  deltaAngle: number,
  eps = 1e-12
) {
  if (Math.abs(deltaAngle) < eps) return sketcher;

  const [cx, cy] = center;
  const [sx, sy] = start;

  const vx = sx - cx;
  const vy = sy - cy;
  const r = Math.hypot(vx, vy);
  if (r < eps) {
    throw new Error("start 与 center 重合，无法定义圆弧。");
  }

  const startAngle = Math.atan2(vy, vx);
  const endAngle = startAngle + deltaAngle;
  const midAngle = startAngle + deltaAngle * 0.5;

  const end: Point2D = [
    cx + r * Math.cos(endAngle),
    cy + r * Math.sin(endAngle),
  ];

  const midPoint: Point2D = [
    cx + r * Math.cos(midAngle),
    cy + r * Math.sin(midAngle),
  ];

  return sketcher.threePointsArcTo(end, midPoint);
}

export function arcByCenterStartAngleSafe(
  sketcher: Sketcher,
  center: Point2D,
  start: Point2D,
  deltaAngle: number,
  eps = 1e-12
) {
  if (Math.abs(deltaAngle) < eps) return sketcher;

  if (Math.abs(deltaAngle) <= Math.PI) {
    return arcByCenterStartAngle(sketcher, center, start, deltaAngle, eps);
  }

  const half = deltaAngle * 0.5;

  const [cx, cy] = center;
  const [sx, sy] = start;
  const vx = sx - cx;
  const vy = sy - cy;
  const r = Math.hypot(vx, vy);
  const startAngle = Math.atan2(vy, vx);

  const midStart: Point2D = [
    cx + r * Math.cos(startAngle + half),
    cy + r * Math.sin(startAngle + half),
  ];

  arcByCenterStartAngle(sketcher, center, start, half, eps);
  return arcByCenterStartAngle(sketcher, center, midStart, half, eps);
}