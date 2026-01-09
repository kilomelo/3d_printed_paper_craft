import { Sketcher, PlaneName, Point, Plane } from "replicad";
import type { Point2D, Triangle2D, TriangleWithEdgeInfo } from "../../types/triangles";

export function radToDeg(rad: number) { return (rad * 180) / Math.PI; }
export function degToRad(deg: number) { return (deg * Math.PI) / 180;}

export function pointKey([x, y]: Point2D) { return `${x.toFixed(5)},${y.toFixed(5)}`; }
export function edgeKey(a: Point2D, b: Point2D) {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export function polygonArea(pts: Point2D[]) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return area * 0.5;
}

export function intersectLines(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return null;
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
  return [px, py];
}

// 通过展开后的三角形信息找到外轮廓，并且计算用于参数化建模的一系列数据
export function triangles2Outer(trianglesWithAngles: TriangleWithEdgeInfo[]): {
  outer: Point2D[];
  min: Point2D;
  max: Point2D;
  maxEdgeLen: number; // 所有三角形的边中最长的边长
  pointAngleMap: Map<string, number>;
} | undefined {
  if (!trianglesWithAngles.length) return undefined;
  const edgeMap = new Map<string, { a: Point2D; b: Point2D; isSeam: boolean }>();
  const max: Point2D = [-Infinity, -Infinity];
  const min: Point2D = [Infinity, Infinity];
  let maxEdgeLen = 0;
  trianglesWithAngles.forEach((triData) => {
    const edges: [Point2D, Point2D, { isOuter: boolean; angle: number; isSeam?: boolean } | undefined][] = [
      [triData.tri[0], triData.tri[1], triData.edges?.[0]],
      [triData.tri[1], triData.tri[2], triData.edges?.[1]],
      [triData.tri[2], triData.tri[0], triData.edges?.[2]],
    ];

    triData.tri.forEach((pt) => {
      if (pt[0] < min[0]) min[0] = pt[0];
      if (pt[1] < min[1]) min[1] = pt[1];
      if (pt[0] > max[0]) max[0] = pt[0];
      if (pt[1] > max[1]) max[1] = pt[1];
    });
    edges.forEach(([a, b, info]) => {
      const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (edgeLen > maxEdgeLen) maxEdgeLen = edgeLen;
      if (!info?.isOuter) return;
      const k = edgeKey(a, b);
      if (!edgeMap.has(k)) {
        edgeMap.set(k, { a, b, isSeam: !!info.isSeam });
      }
    });
  });

  const boundary = Array.from(edgeMap.values());
  if (!boundary.length) return undefined;

  const adjacency = new Map<string, Point2D[]>();
  boundary.forEach(({ a, b }) => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push(b);
    adjacency.get(kb)!.push(a);
  });

  const visited = new Set<string>();
  const loops: Point2D[][] = [];
  boundary.forEach(({ a, b }) => {
    const startEdgeKey = edgeKey(a, b);
    if (visited.has(startEdgeKey)) return;
    let current = a;
    const loop: Point2D[] = [];
    let guard = boundary.length * 3 + 3;
    while (guard-- > 0) {
      loop.push(current);
      const neigh = adjacency.get(pointKey(current)) || [];
      const next = neigh.find((n) => !visited.has(edgeKey(current, n)));
      if (!next) break;
      visited.add(edgeKey(current, next));
      current = next;
      if (pointKey(current) === pointKey(loop[0])) break;
    }
    if (loop.length >= 3 && pointKey(current) === pointKey(loop[0])) {
      loops.push(loop);
    }
  });
  if (!loops.length) return undefined;
  let outer = loops[0];
  let bestArea = Math.abs(polygonArea(outer));
  loops.slice(1).forEach((lp) => {
    const area = Math.abs(polygonArea(lp));
    if (area > bestArea) {
      bestArea = area;
      outer = lp;
    }
  });
  if (outer.length > 1 && pointKey(outer[0]) === pointKey(outer[outer.length - 1])) {
    outer = outer.slice(0, -1);
  }
  const polyOrientation = Math.sign(polygonArea(outer)) || 1; // 1:CCW, -1:CW
  const pointAngleMap = new Map<string, number>();
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const len = outer.length;
  for (let i = 0; i < len; i += 1) {
    const curr = outer[i];
    const prev = outer[(i - 1 + len) % len];
    const next = outer[(i + 1) % len];
    const ePrev = edgeMap.get(edgeKey(prev, curr));
    const eNext = edgeMap.get(edgeKey(curr, next));
    if (!(ePrev?.isSeam && eNext?.isSeam)) {
      continue;
    }
    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) {
      pointAngleMap.set(pointKey(curr), 0);
      continue;
    }
    const cos = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
    const baseDeg = radToDeg(Math.acos(cos));
    const cross = ax * by - ay * bx;
    const isReflex = polyOrientation > 0 ? cross > 0 : cross < 0;
    const angleDeg = isReflex ? 360 - baseDeg : baseDeg;
    pointAngleMap.set(pointKey(curr), angleDeg);
  }
  return { outer, min, max, maxEdgeLen, pointAngleMap };
}

// 根据三条边的二面角对三角形做内偏移（每条边向内平移 offset，取平移后的交点作为新三角）
// zDelta: 放样面的高度，非负数，表示要求的三角形所在平面相对于xy平面的距离
// minDistance: 最小偏移量，非负数，0 表示3d打印中两个相邻的外墙间可设置的最小间距
// layerHeight: 3d打印设置的层高，用来确保首层（外墙间隔最近）的间隔大于minDistance
export function calculateOffset(
  triData: TriangleWithEdgeInfo,
  zDelta: number,
  minDistance: number,
  layerHeight: number = 0,
): {topOffsets: number[], bottomOffsets: number[]} {
  if (zDelta < 0 || minDistance < 0) {
    console.warn('offsetTriangleWithAngles: invalid zDelta or minDistance, skip offsetting');
    return {topOffsets: [0, 0, 0], bottomOffsets: [0, 0, 0]};
  }
  const { tri, edges } = triData;
  

  const offsets: number[] = [];
  const edgeHeights: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const p0 = tri[i];
    const p1 = tri[(i + 1) % 3];
    const pOpp = tri[(i + 2) % 3];
    const vx = p1[0] - p0[0];
    const vy = p1[1] - p0[1];
    const ox = pOpp[0] - p0[0];
    const oy = pOpp[1] - p0[1];
    const edgeLen = Math.hypot(vx, vy) || 1;
    const height = Math.abs(vx * oy - vy * ox) / edgeLen;
    edgeHeights.push(height);
  }
  const bottomOffsetValue: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angleRad = edges[i]?.angle ?? Math.PI; // 非共享边视为 180°
    const angleDeg = Math.abs(radToDeg(angleRad));
    // 采用 min 而非 max，保证当二面角 < 180 时产生正偏移；二面角→0 时需裁剪
    const half = angleDeg * 0.5;
    const term = Math.min(90, half); // <= 90
    const raw = 90 - term; // >=0
    let offset = zDelta * Math.tan(degToRad(raw));
    if (!Number.isFinite(offset)) offset = 0;
    const heightCap = edgeHeights[i] * 0.5;
    if (Math.abs(offset) > heightCap) {
      offset = Math.sign(offset) * heightCap;
      console.warn('offsetTriangleWithAngles: offset exceeds height cap, adjusted', offset);
    }
    // 对于弯折边，需要保证最小偏移量以防止打印时边缘融合
    if (!edges[i]?.isOuter) {
      offset = Math.max(offset, minDistance / 2);
    }
    // 不但需要确保zDelta高度的层之间的间距，还需要确保首层（layerHeight/2处）的间距
    // 切片软甲中的“切片间隙闭合半径”需要设置得尽量小以减少该问题，但仍然需要从数据上保证间距
    // 注意这里公式求得的是确保首层的偏移为minDistance / 2时的放样底部偏移
    const bottomOffset = edges[i]?.isOuter ? 0 : Math.max(0, offset - zDelta * (offset - minDistance / 2) / (zDelta - layerHeight / 2));
    bottomOffsetValue.push(bottomOffset);
    offsets.push(offset + (edges[i]?.isOuter ? 0 : 0.15));
  }
  return {topOffsets: offsets, bottomOffsets: bottomOffsetValue};
}

// 根据三条边的偏移值对三角形做内偏移（每条边向内平移 offset，取平移后的交点作为新三角）
export function offsetTriangle(
  tri: Triangle2D,
  offsets: number[],
): Triangle2D {
  const area = polygonArea(tri);
  const inwardNormal = (vx: number, vy: number): Point2D => {
    // CCW: inward is left normal; CW: right normal
    return area >= 0 ? [-vy, vx] : [vy, -vx];
  };
  const shiftedLines: Array<[Point2D, Point2D]> = [];
  for (let i = 0; i < 3; i += 1) {
    const p0 = tri[i];
    const p1 = tri[(i + 1) % 3];
    const vx = p1[0] - p0[0];
    const vy = p1[1] - p0[1];
    const normal = inwardNormal(vx, vy);
    const len = Math.hypot(normal[0], normal[1]) || 1;
    const nx = (normal[0] / len) * offsets[i];
    const ny = (normal[1] / len) * offsets[i];
    const q0: Point2D = [p0[0] + nx, p0[1] + ny];
    const q1: Point2D = [p1[0] + nx, p1[1] + ny];
    shiftedLines.push([q0, q1]);
  }

  const offsettedTri: Triangle2D = [
    tri[0],
    tri[1],
    tri[2],
  ];
  for (let i = 0; i < 3; i += 1) {
    const l1 = shiftedLines[i];
    const l2 = shiftedLines[(i + 2) % 3]; // previous edge
    const inter = intersectLines(l1[0], l1[1], l2[0], l2[1]);
    offsettedTri[i] = inter ?? tri[i];
  }
  return offsettedTri;
}

// 在三角形 ABC 上，根据高度 d 截取与 AB 平行的线段 EF，返回[A,B,F,E]。如果d大于C到AB的距离则返回[A,B,C]
export function trapezoid(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: number,
  eps = 1e-9
): Point2D[] {
  if (!Number.isFinite(d) || d < 0) return [a, b, c];
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abLen = Math.hypot(abx, aby);
  if (abLen <= eps) return [a, b, c]; // A、B 重合，直线 AB 不成立
  // 取 AB 的单位法向量 n̂（方向无关紧要，因为后面用绝对值）
  const nhx = -aby / abLen;
  const nhy = abx / abLen;
  // C 到直线 AB 的有符号距离：distSigned = n̂ · (C - A)
  const distSigned = nhx * (c[0] - a[0]) + nhy * (c[1] - a[1]);
  const h = Math.abs(distSigned);
  // ABC 共线（退化三角形）
  if (h <= eps) {
    return [a, b, c];
  }
  // 超出高度，无法在 AC、BC 上截出与 AB 平行且距离为 d 的线段
  if (d > h + eps) return [a, b, c];
  // 相似三角形比例：t = d / h，E、F 在 AC、BC 上的参数一致
  let t = d / h;
  // 数值稳定：把非常接近边界的值钳制到 [0,1]
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const e: Point2D = [
    a[0] + t * (c[0] - a[0]),
    a[1] + t * (c[1] - a[1]),
  ];
  const f: Point2D = [
    b[0] + t * (c[0] - b[0]),
    b[1] + t * (c[1] - b[1]),
  ];
  return [a, b, f, e];
}

type Vec2 = [number, number];
const EPS = 1e-12;

function sub(a: Point2D, b: Point2D): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}
function add(a: Point2D, v: Vec2): Point2D {
  return [a[0] + v[0], a[1] + v[1]];
}
function mul(v: Vec2, s: number): Vec2 {
  return [v[0] * s, v[1] * s];
}
function dot(u: Vec2, v: Vec2): number {
  return u[0] * v[0] + u[1] * v[1];
}
function cross(u: Vec2, v: Vec2): number {
  return u[0] * v[1] - u[1] * v[0];
}
function norm2(v: Vec2): number {
  return dot(v, v);
}

/** 点 p 关于直线 through l0->l1 的镜像 */
function reflectPointAcrossLine(p: Point2D, l0: Point2D, l1: Point2D): Point2D | undefined {
  const v = sub(l1, l0);
  const vv = norm2(v);
  if (vv < EPS) return undefined; // 线退化
  const w = sub(p, l0);
  const t = dot(w, v) / vv;          // 投影参数
  const proj: Point2D = add(l0, mul(v, t));
  // p' = 2*proj - p
  return [2 * proj[0] - p[0], 2 * proj[1] - p[1]];
}

/**
 * 在顶点 vtx 处，baseDir 指向“共享边方向”（例如在 b 点用 c-b，在 c 点用 b-c）。
 * 在两条候选边界 vtx->a 与 vtx->d2 中选出“更靠近 baseDir”的那条（角度更小）。
 */
function chooseLimitingApex(
  vtx: Point2D,
  baseDir: Vec2,
  a: Point2D,
  d2: Point2D
): Point2D | undefined {
  const sideSign = Math.sign(cross(baseDir, sub(a, vtx)));
  if (sideSign === 0) return undefined; // a 与 baseDir 共线 => 退化

  const candidates: Point2D[] = [a, d2];

  let best: { apex: Point2D; angle: number } | undefined;

  for (const apex of candidates) {
    const r = sub(apex, vtx);
    const cr = cross(baseDir, r);
    // apex 必须在与 a 相同一侧（否则不是该三角形的有效“上边界”）
    if (Math.sign(cr) !== 0 && Math.sign(cr) !== sideSign) continue;

    // 有向角度：保证在同侧时为 (0, pi)
    const ang = Math.atan2(sideSign * cr, dot(baseDir, r)); // 越小越靠近 baseDir
    if (ang <= EPS) continue; // 几乎共线，数值不稳定

    if (!best || ang < best.angle) best = { apex, angle: ang };
  }

  return best?.apex;
}

/**
 * 给定 a,b,c,d：
 * - 三角形 [a,b,c] 与 [b,c,d] 共享边 bc
 * - a 与 d 位于直线 bc 两侧
 * - d2 为 d 关于 bc 的镜像
 * 返回交集三角形 [b,c,e] 的顶点 e；若不满足前提或退化则 undefined
 */
export function solveE(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | undefined {
  const vBC = sub(c, b);
  if (norm2(vBC) < EPS) return undefined; // b==c，退化

  // 确认 a 与 d 在 bc 两侧
  const sA = Math.sign(cross(vBC, sub(a, b)));
  const sD = Math.sign(cross(vBC, sub(d, b)));
  if (sA === 0 || sD === 0) return undefined; // a 或 d 在直线 bc 上
  if (sA === sD) return undefined;            // 不在两侧

  const d2 = reflectPointAcrossLine(d, b, c);
  if (!d2) return undefined;

  // 在 b 点：baseDir = b->c
  const apexB = chooseLimitingApex(b, vBC, a, d2);
  if (!apexB) return undefined;

  // 在 c 点：baseDir = c->b
  const vCB = sub(b, c);
  const apexC = chooseLimitingApex(c, vCB, a, d2);
  if (!apexC) return undefined;

  const e = intersectLines(b, apexB, c, apexC);
  if (!e) return undefined;

  // 额外稳健性检查：e 应在与 a 同侧（同半平面）
  if (Math.sign(cross(vBC, sub(e, b))) !== sA) return undefined;

  return e;
}

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
