import type { Point2D, Point3D, Vec3, Triangle2D, Vec2, Plane3D, TriangleWithEdgeInfo } from "../types/geometryTypes";

export function radToDeg(rad: number) { return (rad * 180) / Math.PI; }
export function degToRad(deg: number) { return (deg * Math.PI) / 180;}
export function pointKey([x, y]: Point2D) { return `${x.toFixed(5)},${y.toFixed(5)}`; }
export function edgeKey(a: Point2D, b: Point2D) {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
export function pointKey3D([x, y, z]: Point3D) { return `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`; }
export function edgeKey3D(a: Point3D, b: Point3D) {
  const ka = pointKey3D(a);
  const kb = pointKey3D(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

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

export function sub3(p: Point3D, q: Point3D): Vec3 { return [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; }
export function dot3(u: Vec3, v: Vec3): number { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }
export function cross3(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}
export function norm3(v: Vec3): number { return Math.hypot(v[0], v[1], v[2]); }
export function mul3(v: Vec3, s: number): Vec3 { return [v[0] * s, v[1] * s, v[2] * s]; }
function add3(u: Vec3, v: Vec3): Vec3 { return [u[0] + v[0], u[1] + v[1], u[2] + v[2]]; }

function rotate2(v: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

export function polygonArea(pts: Point2D[]): number {
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

export function pointLineDistance2D(p: Point2D, a: Point2D, b: Point2D) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay); // 退化为点
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/** 点 p 是否在三角形 tri 内，sign 表示三角形的方向（1:CCW, -1:CW） */
export function pointInTriangle(p: Point2D, tri: Triangle2D, sign: 1 | -1, eps = 1e-10) {
  const [a, b, c] = tri;

  // 边向量
  const ab = sub(b, a);
  const bc = sub(c, b);
  const ca = sub(a, c);

  // 点到各顶点向量
  const ap = sub(p, a);
  const bp = sub(p, b);
  const cp = sub(p, c);

  // 同向（或在边上）则在三角形内
  const s1 = sign * cross(ab, ap);
  const s2 = sign * cross(bc, bp);
  const s3 = sign * cross(ca, cp);

  return s1 >= -eps && s2 >= -eps && s3 >= -eps;
}

/** 点 p 关于直线 through l0->l1 的镜像 */
export function reflectPointAcrossLine(p: Point2D, l0: Point2D, l1: Point2D): Point2D | undefined {
  const v = sub(l1, l0);
  const vv = norm2(v);
  if (vv < EPS) return undefined; // 线退化
  const w = sub(p, l0);
  const t = dot(w, v) / vv;          // 投影参数
  const proj: Point2D = add(l0, mul(v, t));
  // p' = 2*proj - p
  return [2 * proj[0] - p[0], 2 * proj[1] - p[1]];
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

export type OffsetFailReason =
  | "DEGENERATE_INPUT"       // 原三角形退化（面积≈0）或存在零长度边
  | "PARALLEL_SHIFTED_LINES" // 平移后的相邻边近平行/无法求交
  | "DEGENERATE_RESULT"      // 新三角形退化（面积≈0）
  | "FLIPPED"                // 新三角形发生翻转（朝向与原三角形相反）
  | "OUTSIDE_ORIGINAL"       // （内偏移模式）新顶点不在原三角形内
  | "INFEASIBLE_OFFSETS";    // 半平面无公共交集（offset 过大等）

export type OffsetTriangleResult = { tri?: Triangle2D; reason?: OffsetFailReason };

/**
 * 根据三条边的偏移值对三角形做内偏移（每条边向内平移 offsets[i]），
 * 取平移后的相邻边交点作为新三角。
 *
 * 若发生翻转/退化/无法形成合法交点，返回 { reason }。
 */
export function offsetTriangleSafe(
  tri: Triangle2D,
  offsets: [number, number, number] | number[],
  opts?: {
    requireInside?: boolean;
    eps?: number;
  }
): OffsetTriangleResult {
  const requireInside = opts?.requireInside ?? true;
  const eps = opts?.eps ?? 1e-12;

  if (offsets.length !== 3) return { reason: "DEGENERATE_INPUT" };
  const off = offsets as [number, number, number];

  const area = polygonArea(tri);
  if (Math.abs(area) < eps) return { reason: "DEGENERATE_INPUT" };
  const sign: 1 | -1 = area > 0 ? 1 : -1;

  // 尺度自适应阈值
  const [A, B, C] = tri;
  const l0 = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const l1 = Math.hypot(C[0] - B[0], C[1] - B[1]);
  const l2 = Math.hypot(A[0] - C[0], A[1] - C[1]);
  const scale = Math.max(l0, l1, l2);
  if (scale < eps) return { reason: "DEGENERATE_INPUT" };
  const areaEps = eps * scale * scale;
  const hpEps = 1e-10 * scale; // 半平面容差（可按你单位调整）

  // 计算三条平移后的直线（两点式）以及每条线上的一点 q0（供半平面测试）
  const shiftedLines: Array<[Point2D, Point2D]> = [];
  const shiftedQ0: [Point2D, Point2D, Point2D] = [[0, 0], [0, 0], [0, 0]];

  for (let i = 0; i < 3; i += 1) {
    const ii = i as 0 | 1 | 2;
    const p0 = tri[ii];
    const p1 = tri[((i + 1) % 3) as 0 | 1 | 2];

    const vx = p1[0] - p0[0];
    const vy = p1[1] - p0[1];
    const len = Math.hypot(vx, vy);
    if (len < eps) return { reason: "DEGENERATE_INPUT" };

    // inward normal：CCW 左法向，CW 右法向
    const nx = (sign > 0 ? -vy : vy) / len;
    const ny = (sign > 0 ?  vx : -vx) / len;

    const q0: Point2D = [p0[0] + nx * off[ii], p0[1] + ny * off[ii]];
    const q1: Point2D = [p1[0] + nx * off[ii], p1[1] + ny * off[ii]];

    shiftedLines.push([q0, q1]);
    shiftedQ0[ii] = q0;
  }

  // 相邻两线求交点（分别靠近原三角形的 B、C、A）
  const p01 = intersectLines(shiftedLines[0][0], shiftedLines[0][1], shiftedLines[1][0], shiftedLines[1][1]);
  const p12 = intersectLines(shiftedLines[1][0], shiftedLines[1][1], shiftedLines[2][0], shiftedLines[2][1]);
  const p20 = intersectLines(shiftedLines[2][0], shiftedLines[2][1], shiftedLines[0][0], shiftedLines[0][1]);
  if (!p01 || !p12 || !p20) return { reason: "PARALLEL_SHIFTED_LINES" };

  const newTri: Triangle2D = [p01, p12, p20];

  // 退化检查
  const newArea = polygonArea(newTri);
  if (Math.abs(newArea) < areaEps) return { reason: "DEGENERATE_RESULT" };

  // （可选）方向翻转检查：符号不同才算严格翻转
  const newSign: 1 | -1 = newArea > 0 ? 1 : -1;
  if (newSign !== sign) return { reason: "FLIPPED" };

  /** 检查点 p 是否在“边 i 内偏移后的半平面”内 */
  const inShiftedHalfPlane = (
    p: Point2D,
    tri: Triangle2D,
    shiftedLinePoint: Point2D, // q0
    edgeIndex: 0 | 1 | 2,
    sign: 1 | -1,
    eps: number
  ) => {
    const p0 = tri[edgeIndex];
    const p1 = tri[((edgeIndex + 1) % 3) as 0 | 1 | 2];
    const dir = sub(p1, p0);           // 原边方向
    const rel = sub(p, shiftedLinePoint);
    // CCW: inside is left-of-edge => cross(dir, p-q0) >= 0
    // CW : inside is right-of-edge => cross(dir, p-q0) <= 0
    return sign * cross(dir, rel) >= -eps;
  }
  // 关键新增：半平面可行性检查（offset 过大时会失败）
  const verts: [Point2D, Point2D, Point2D] = [p01, p12, p20];
  for (const v of verts) {
    for (let i = 0; i < 3; i += 1) {
      const ii = i as 0 | 1 | 2;
      if (!inShiftedHalfPlane(v, tri, shiftedQ0[ii], ii, sign, hpEps)) {
        return { reason: "INFEASIBLE_OFFSETS" };
      }
    }
  }

  // 内偏移模式：还要求新点在原三角形内（你若允许外扩，关掉）
  if (requireInside) {
    if (
      !pointInTriangle(p01, tri, sign) ||
      !pointInTriangle(p12, tri, sign) ||
      !pointInTriangle(p20, tri, sign)
    ) {
      return { reason: "OUTSIDE_ORIGINAL" };
    }
  }

  return { tri: newTri };
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
/** 求由三角形 ABC 与 ABD（共享边 AB）构成的二面角的角平分面。
 * 返回的 Plane3D 以 point = a，normal 给出平分面的法向 
 */
export function bisectorPlaneOfDihedral(
  a: Point3D,
  b: Point3D,
  c: Point3D,
  d: Point3D
): Plane3D | undefined {
  // console.log('a,b,c,d', a, b, c, d);
  // --- minimal 3D math ---
  const sub3 = (p: Point3D, q: Point3D): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const add3 = (u: Vec3, v: Vec3): Vec3 => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
  const mul3 = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  const dot3 = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross3 = (u: Vec3, v: Vec3): Vec3 => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const norm3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
  const unit3 = (v: Vec3): Vec3 | undefined => {
    const L = norm3(v);
    if (L < EPS) return undefined;
    return mul3(v, 1 / L);
  };

  // --- shared edge AB ---
  const ab = sub3(b, a);
  const abUnit = unit3(ab);
  if (!abUnit) return undefined; // A==B, undefined dihedral

  const ac = sub3(c, a);
  const ad = sub3(d, a);

  // Face normals (both ⟂ AB). Use same convention: n = unit(AB × AX)
  const nABC = unit3(cross3(ab, ac));
  const nABD = unit3(cross3(ab, ad));
  if (!nABC || !nABD) return undefined; // degenerate triangle(s)

  const cos = dot3(nABC, nABD); // [-1, 1]

  // Robust coplanar thresholds
  const COPLANAR_EPS = 1e-10;

  // Case 1: dihedral = 0° (same oriented plane) => return the triangle plane
  if (1 - cos < COPLANAR_EPS) {
    // Plane of ABC (== plane of ABD)
    return { normal: nABC, point: a };
  }

  // Case 2: dihedral = 180° (opposite oriented plane) => return plane ⟂ triangle plane and containing AB
  if (1 + cos < COPLANAR_EPS) {
    // Need plane containing AB, and perpendicular to plane(ABC).
    // Its normal must be ⟂ AB and ⟂ nABC  => m = unit(nABC × abUnit)
    const m = unit3(cross3(nABC, abUnit));
    if (!m) return undefined;

    // Optional: choose sign so that C and D tend to be on opposite sides if possible
    const sc = dot3(m, ac);
    const sd = dot3(m, ad);
    const normal = sc * sd > 0 ? mul3(m, -1) : m;

    return { normal, point: a };
  }

  // General case: two bisector candidates along AB
  const candPlus = unit3(add3(nABC, nABD));           // unit(n1 + n2)
  const candMinus = unit3(add3(nABC, mul3(nABD, -1))); // unit(n1 - n2)

  const candidates: Vec3[] = [];
  if (candPlus) candidates.push(candPlus);
  if (candMinus) candidates.push(candMinus);
  if (candidates.length === 0) return undefined;

  // Choose the one that separates C and D: dot(n, AC) and dot(n, AD) have opposite signs
  const scale = Math.max(norm3(ac), norm3(ad), 1);
  const sepTol = 1e-10 * scale;

  let best: { n: Vec3; sepScore: number } | undefined;

  for (const n of candidates) {
    const sc = dot3(n, ac);
    const sd = dot3(n, ad);

    // separation: product should be negative beyond tolerance
    const prod = sc * sd;
    if (prod < -(sepTol * sepTol)) {
      // more negative => stronger separation
      if (!best || prod < best.sepScore) best = { n, sepScore: prod };
    }
  }

  if (!best) {
    // 按你的需求：一般情况必须把 C 和 D 分隔两侧
    // 若由于数值/特殊构型两者都不满足，就返回 undefined
    return undefined;
  }

  // Normalize sign for deterministic output (optional): make C on positive side if possible
  const sC = dot3(best.n, ac);
  const normal = sC < 0 ? mul3(best.n, -1) : best.n;

  return { normal, point: a };
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


/**
 * 计算等腰直角三角形的第三个顶点坐标，使得ab为斜边，并按照左侧和右侧的顺序返回
 * @param a 第一个点坐标
 * @param b 第二个点坐标  
 * @returns 返回两个可能的第三个点坐标，按照在向量ab的左侧和右侧的顺序 [左侧点, 右侧点]
 */
export function calculateIsoscelesRightTriangle(
  a: Point2D, 
  b: Point2D
): [Point2D, Point2D] {
  // 计算向量AB
  const abVector: Point2D = [b[0] - a[0], b[1] - a[1]];
  
  // 计算AB的长度
  const abLength = Math.sqrt(abVector[0] ** 2 + abVector[1] ** 2);
  
  // 计算AB的中点M
  const midpoint: Point2D = [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2
  ];
  
  // 关键修正：直角顶点C到中点M的距离是斜边AB长度的一半
  const distanceCM = abLength / 2;
  
  // 计算垂直于AB的单位向量
  const perpendicularVector: Point2D = [
    -abVector[1] / abLength,  // 旋转90度
    abVector[0] / abLength
  ];
  
  // 计算两个可能的C点位置
  const c1: Point2D = [
    midpoint[0] + perpendicularVector[0] * distanceCM,
    midpoint[1] + perpendicularVector[1] * distanceCM
  ];
  
  const c2: Point2D = [
    midpoint[0] - perpendicularVector[0] * distanceCM,
    midpoint[1] - perpendicularVector[1] * distanceCM
  ];
  
  // 判断点相对于向量ab的位置（使用屏幕坐标系，Y轴向下）
  const isC1OnLeft = isPointOnLeftSideOfVector(a, b, c1);
  
  // 按照左侧点在前，右侧点在后的顺序返回
  if (isC1OnLeft) {
    return [c1, c2];  // c1在左侧，c2在右侧
  } else {
    return [c2, c1];  // c2在左侧，c1在右侧
  }
}

/**
 * 判断点C相对于向量AB的位置（使用左手坐标系，Y轴向下）
 * @param a 向量起点
 * @param b 向量终点  
 * @param c 要判断的点
 * @returns 如果点C在向量AB的左侧返回true，右侧返回false
 */
function isPointOnLeftSideOfVector(a: Point2D, b: Point2D, c: Point2D): boolean {
  // 计算向量AB和AC
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  
  // 计算二维叉积：AB × AC = (Bx-Ax)*(Cy-Ay) - (By-Ay)*(Cx-Ax)
  const crossProduct = abx * acy - aby * acx;
  
  // 在标准数学坐标系（Y轴向上）中，叉积>0表示点在向量左侧
  // 在屏幕坐标系（Y轴向下）中，叉积<0表示点在向量左侧
  // 这里假设使用常见的屏幕坐标系（Y轴向下）
  return crossProduct < 0;
}

/**
 * 判断点C相对于向量AB的位置（使用右手坐标系，Y轴向上）
 * 适用于标准数学坐标系
 */
function isPointOnLeftSideOfVectorMath(a: Point2D, b: Point2D, c: Point2D): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  
  const crossProduct = abx * acy - aby * acx;
  // 在标准数学坐标系中，叉积>0表示点在向量左侧
  return crossProduct > 0;
}


/**
 * 构造三角形 ABC：
 * - A 点内角 = aAngle
 * - B 点内角 = bAngle
 * - side 决定 C 在向量 AB 的左侧或右侧
 * 角度单位：弧度
 */
export function buildTriangleByEdgeAndAngles(
  a: Point2D,
  b: Point2D,
  aAngle: number,
  bAngle: number,
  side: "left" | "right" = "right"
): Point2D | undefined {
  if (!Number.isFinite(aAngle) || !Number.isFinite(bAngle)) return undefined;
  if (aAngle <= EPS || bAngle <= EPS) return undefined;
  if (aAngle + bAngle >= Math.PI - 1e-9) return undefined; // 无解/退化到无穷远

  const ab = sub(b, a);
  const abLen = Math.hypot(ab[0], ab[1]);
  if (abLen < EPS) return undefined;

  const u: Vec2 = [ab[0] / abLen, ab[1] / abLen]; // A->B 单位向量
  const s = side === "left" ? 1 : -1;

  // A 点：从 AB 方向旋转到 AC
  const dirA = rotate2(u, s * aAngle);

  // B 点：从 BA 方向旋转到 BC（方向由 side 决定）
  const ba: Vec2 = [-u[0], -u[1]];
  const dirB = rotate2(ba, -s * bAngle);

  // 求两直线交点
  const c = intersectLines(a, add(a, dirA), b, add(b, dirB));
  if (!c) return undefined;

  // 必须在两条射线的正方向
  const ac = sub(c, a);
  const bc = sub(c, b);
  if (dot(ac, dirA) <= EPS) return undefined;
  if (dot(bc, dirB) <= EPS) return undefined;

  // 必须在 AB 指定侧：left => cross(ab, ac) > 0；right => cross(ab, ac) < 0
  if (s * cross(ab, ac) <= EPS) return undefined;

  return c;
}

export function incenter3D(p1: Point2D, p2: Point2D, p3: Point2D): Point2D {
  const la = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
  const lb = Math.hypot(p1[0] - p3[0], p1[1] - p3[1]);
  const lc = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  const sum = la + lb + lc;
  if (sum < 1e-8) return [p1[0], p1[1]];
  return [
    (la * p1[0] + lb * p2[0] + lc * p3[0]) / sum,
    (la * p1[1] + lb * p2[1] + lc * p3[1]) / sum,
  ];
}