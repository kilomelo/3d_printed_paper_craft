import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh } from "three";
import { Sketcher, Shape3D, setOC, getOC, PlaneName, type ShapeMesh, shapeType, sketchCircle, loft, makeBox, Sketches, Point, Plane, Vector } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, Point3D, Triangle2D, TriangleWithEdgeInfo } from "../../types/triangles";
import { getSettings } from "../settings";

type OcFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<OpenCascadeInstance>;

let ocReady: Promise<void> | null = null;

const radToDeg = (rad: number) => (rad * 180) / Math.PI;
const degToRad = (deg: number) => (deg * Math.PI) / 180;

const pointKey = ([x, y]: Point2D) => `${x.toFixed(5)},${y.toFixed(5)}`;
const edgeKey = (a: Point2D, b: Point2D) => {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function polygonArea(pts: Point2D[]) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return area * 0.5;
}

function intersectLines(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
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

// 在三角形 ABC 上，根据高度 d 截取与 AB 平行的线段 EF，返回[A,B,F,E]。如果d大于C到AB的距离则返回[A,B,C]
function trapezoid(
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

// 确保 OC 已初始化
async function ensureReplicadOC() {
  if (ocReady) return ocReady;
  ocReady = (async () => {
    const oc = await (initOC as unknown as OcFactory)({
      locateFile: (file) => (file.endsWith(".wasm") ? ocWasmUrl : file),
    });
    setOC(oc);
  })();
  return ocReady;
}

function triangles2Outer(trianglesWithAngles: TriangleWithEdgeInfo[]): { outer: Point2D[], min: Point2D, max: Point2D } | undefined {
  if (!trianglesWithAngles.length) return undefined;
  const edgeMap = new Map<string, { a: Point2D; b: Point2D }>();
  const max: Point2D = [-Infinity, -Infinity];
  const min: Point2D = [Infinity, Infinity];
  trianglesWithAngles.forEach((triData) => {
    const edges: [Point2D, Point2D, { isOuter: boolean; angle: number } | undefined][] = [
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
      if (!info?.isOuter) return;
      const k = edgeKey(a, b);
      if (!edgeMap.has(k)) {
        edgeMap.set(k, { a, b });
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
  return {outer, min, max};
}

// 根据三条边的二面角对三角形做内偏移（每条边向内平移 offset，取平移后的交点作为新三角）
// zDelta: 放样面的高度，非负数，表示要求的三角形所在平面相对于xy平面的距离
// minDistance: 最小偏移量，非负数，0 表示3d打印中两个相邻的外墙间可设置的最小间距
// layerHeight: 3d打印设置的层高，用来确保首层（外墙间隔最近）的间隔大于minDistance
function calculateOffset(
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
function offsetTriangle(
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

function sketchFromContourPoints(points: Point2D[], plane: PlaneName | Plane = "XY", offset: number = 0) {
  if (points.length < 3) return undefined;
  const sketcher =
    typeof plane === "string"
      ? new Sketcher(plane, offset) // PlaneName + number 偏移 :contentReference[oaicite:2]{index=2}
      : new Sketcher(
          offset === 0
            ? plane
            : plane
                .clone()
                .translate(
                  plane.zDir.normalized().multiply(offset) // 沿 plane 法向偏移 :contentReference[oaicite:3]{index=3}
                )
        );

  points.forEach(([x, y], idx) => {
    if (idx === 0) sketcher.movePointerTo([x, y]);
    else sketcher.lineTo([x, y]);
  });

  return sketcher.close();
}

const debugBuildSolid = async () => {
  console.log('[ReplicadModeling] debugBuildSolid called');
  await ensureReplicadOC();
  const baseSketch = new Sketcher("XY")
    .movePointerTo([0, 0])
    .lineTo([50, 0])
    .lineTo([50, 50])
    .lineTo([0, 50])
    .close();
  const extruded = baseSketch.extrude(20);
  // const toolSketch = new Sketcher("XY", 5)
  //   .movePointerTo([-5, -5])
  //   .lineTo([20, -5])
  //   .lineTo([20, 20])
  //   .lineTo([-5, 20])
  //   .close();
  // const tool = toolSketch.extrude(10);

  const radius = 5;
  const base = sketchCircle(radius, { plane: "XY" });
  const tool = base.loftWith([], { endPoint: [0, 0, -5], ruled: true }).translate([0, 0, 24]);

  return extruded.cut(tool);
};

function makeVerticalPlaneThroughAB(a: Point2D, b: Point2D, z = 0): Plane | undefined {
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

function makeVerticalPlaneNormalAB(a: Point2D, b: Point2D, z = 0): Plane | undefined {
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

export function makeVerticalSketcherThroughAB(a: Point2D, b: Point2D) {
  const plane = makeVerticalPlaneThroughAB(a, b);
  if (!plane) return undefined;

  // Sketcher 支持直接用 Plane 实例构造 :contentReference[oaicite:3]{index=3}
  return new Sketcher(plane);
}

function makeBoxInPlaneCS(
  plane: Plane,
  corner1: Point2D,
  corner2: Point2D,
  zMin = 0,
  zMax = 10
) {
  const xMin = Math.min(corner1[0], corner2[0]);
  const xMax = Math.max(corner1[0], corner2[0]);
  const yMin = Math.min(corner1[1], corner2[1]);
  const yMax = Math.max(corner1[1], corner2[1]);

  const height = zMax - zMin;
  if (height <= 0) return undefined;

  // 在 plane 的“局部 XY”里画矩形
  const sketch = new Sketcher(plane)
    .movePointerTo([xMin, yMin])
    .lineTo([xMax, yMin])
    .lineTo([xMax, yMax])
    .lineTo([xMin, yMax])
    .close();

  // 默认沿 sketch 所在平面的法向挤出（也就是 plane 的 zDir）
  let solid = sketch.extrude(height);

  // 如果你希望 box 从局部 zMin 开始（而不是从 0 开始），再沿 plane.zDir 平移
  if (zMin !== 0) {
    const dz = plane.zDir.normalized().multiply(zMin); // Vector.multiply(scale):contentReference[oaicite:1]{index=1}
    solid = solid.translate([dz.x, dz.y, dz.z]);
  }

  return solid;
}

// 实际实行参数化建模的方法
const buildSolidFromTrianglesWithAngles = async (
  trianglesWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (progress: number) => void,
) => {
  // return await debugBuildSolid();
  const { layerHeight, connectionLayers, bodyLayers, earWidth, earThickness } = getSettings();
  const bodyThickness = bodyLayers * layerHeight;
  const connectionThickness = connectionLayers * layerHeight;
  onProgress?.(1);
  await ensureReplicadOC();
  // 第一步：生成连接层和主体
  const outerResult  = triangles2Outer(trianglesWithAngles);
  if (!outerResult || !outerResult.outer || outerResult.outer.length < 3) {
    throw new Error("三角形建模失败");
  }
  const connectionSketch = sketchFromContourPoints(outerResult.outer);
  if (!connectionSketch) {
    throw new Error("连接层草图生成失败");
  }
  let connectionSolid = connectionSketch.extrude(connectionThickness + bodyThickness).simplify();
  if (!connectionSolid) {
    throw new Error("连接层建模失败");
  }
  onProgress?.(2);
  const progressPerTriangle = 90 / trianglesWithAngles.length;
  const earCutToolMarginMin = earWidth * 1.5;
  trianglesWithAngles.forEach((triData, i) => {
    console.log('[ReplicadModeling] processing triangle for ears', triData);
    const isDefined = <T,>(v: T | undefined | null): v is T => v != null;
    const [p0, p1, p2] = triData.tri;
    // 基准顺序：AC, CB, BA 对应 [p0->p2, p2->p1, p1->p0]
    const planes = [makeVerticalPlaneNormalAB(p0, p2), makeVerticalPlaneNormalAB(p2, p1), makeVerticalPlaneNormalAB(p1, p0)];
    if (!planes.every(isDefined)) {
      console.warn('[ReplicadModeling] failed to create cutting planes for triangle, skip this triangle', triData);
      return;
    }
    const dists  = [Math.hypot(p2[0] - p0[0], p2[1] - p0[1]), Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1])];
    const earExtendMargin = Math.max(...dists);
    const cutToolMargin = Math.max(earCutToolMarginMin, earExtendMargin);
    const earCutToolSketches = [
      sketchFromContourPoints(
        [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
        planes[0].clone(),
        -cutToolMargin),
      sketchFromContourPoints(
        [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
        planes[1].clone(),
        -cutToolMargin),
      sketchFromContourPoints(
        [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
        planes[2].clone(),
        -cutToolMargin),
    ];
    if (!earCutToolSketches.every(isDefined)) {
      console.warn('[ReplicadModeling] failed to create ear cutting tools for triangle, skip this triangle', triData);
      return;
    }
    const earCutTools = [
      earCutToolSketches[0].extrude(dists[0] + 2 * cutToolMargin),
      earCutToolSketches[1].extrude(dists[1] + 2 * cutToolMargin),
      earCutToolSketches[2].extrude(dists[2] + 2 * cutToolMargin),
    ];
    triData.edges.forEach((edge, idx) => {
      const pick = (k: 0 | 1 | 2): 0 | 1 | 2 => ((k - (idx % 3) + 3) % 3) as 0 | 1 | 2;
      const [pointA, pointB, pointC] = [triData.tri[pick(0)], triData.tri[pick(1)], triData.tri[pick(2)]];
      // const distanceAC = dists[pick(0)];
      // const distanceCB = dists[pick(1)];
      if (!edge.incenter) return;
      // 第二步：生成耳朵
      const distanceAIncenter = Math.hypot(edge.incenter[0] - pointA[0], edge.incenter[1] - pointA[1]);
      const distanceBIncenter = Math.hypot(edge.incenter[0] - pointB[0], edge.incenter[1] - pointB[1]);

      const pointA_Incenter_extend: Point2D = [
        edge.incenter[0] + (pointA[0] - edge.incenter[0]) * (earExtendMargin + distanceAIncenter) / distanceAIncenter,
        edge.incenter[1] + (pointA[1] - edge.incenter[1]) * (earExtendMargin + distanceAIncenter) / distanceAIncenter];
      const pointB_Incenter_extend: Point2D = [
        edge.incenter[0] + (pointB[0] - edge.incenter[0]) * (earExtendMargin + distanceBIncenter) / distanceBIncenter,
        edge.incenter[1] + (pointB[1] - edge.incenter[1]) * (earExtendMargin + distanceBIncenter) / distanceBIncenter];
      // const earTrapezoid = trapezoid(pointA, pointB, edge.incenter, earWidth);
      const earTrapezoid = [pointA, pointB, edge.incenter];

      // earTrapezoid[0] = pointA_Incenter_extend;
      // earTrapezoid[1] = pointB_Incenter_extend;
      console.log(`[ReplicadModeling] adding ear for edge`, {pointA, pointB, incenter: edge.incenter, angle: radToDeg(edge.angle / 2)});
      const earSolidSketch = sketchFromContourPoints(earTrapezoid, "XY");
      if (!earSolidSketch) {
        console.warn('[ReplicadModeling] failed to create ear sketch for edge, skip this edge', edge);
        return;
      }
      const earSolid = earSolidSketch.extrude(earThickness);//.rotate(180 - radToDeg(edge.angle / 2), [pointA[0], pointA[1], 0], [pointA[0] - pointB[0], pointA[1] - pointB[1], 0]);
      // connectionSolid = connectionSolid.fuse(earSolid.cut(earCutTools[pick(1)].clone()).cut(earCutTools[pick(2)].clone())).simplify();
      connectionSolid = connectionSolid.fuse(earSolid).simplify();
    });

    // 第三步：生成弯折、拼接坡度刀具

    earCutTools.forEach((tool) => tool.delete());
    planes.forEach((plane) => plane.delete());

    onProgress?.(Math.floor(2 + progressPerTriangle * (i + 1)));
  });

  // 第二步：生成刀具
  // console.log(`[ReplicadModeling] buildSolidFromTrianglesWithAngles: progressPerTriangle`, progressPerTriangle, trianglesWithAngles.length);
  // const vertexAngleMap = new Map<string, { position: Point2D; minAngle: number }>();
  // trianglesWithAngles.forEach((triData, i) => {
  //   console.log(`Building triangle triData}`, triData);
  //   triData.pointAngleData?.forEach((item) => {
  //     const prev = vertexAngleMap.get(item.vertexKey);
  //     if (!prev || item.minAngle < prev.minAngle) {
  //       vertexAngleMap.set(item.vertexKey, { position: item.unfold2dPos, minAngle: item.minAngle });
  //     }
  //   });
  //   const offsetResult = calculateOffset(triData, bodyThickness, 0.25, layerHeight);
  //   const topOffsettedTri = offsetTriangle(triData.tri, offsetResult.topOffsets);
  //   const bottomOffsettedTri = offsetTriangle(triData.tri, offsetResult.bottomOffsets);
  //   const bodySolid = sketchFromContourPoints(bottomOffsettedTri, "XY").loftWith(sketchFromContourPoints(topOffsettedTri, "XY", bodyThickness));
  //   connectionSolid = connectionSolid.fuse(bodySolid, { optimisation: "commonFace" }).simplify();
  //   onProgress?.(Math.floor(2 + progressPerTriangle * (i + 1)));
  //   i++;
  // });
  
  
  // 第四步：消除干涉
  const toolHeight = Math.max(2 * earWidth, bodyThickness);
  // const progressPerPoint = 10 / vertexAngleMap.size;
  // let itor = 0;
  // vertexAngleMap.forEach((data, key) => {
  //   // console.log(`[ReplicadModeling] vertex ${key} minAngle ${data.minAngle} pos`, data.position);
  //   if (data.minAngle < Math.PI) {
  //     const radius = 1.414 * Math.max(0.01, toolHeight * Math.tan((Math.PI - data.minAngle) * 0.5));
  //     // console.log(`[ReplicadModeling] adding cone at vertex ${key} with radius ${radius}`);
  //     const base = sketchCircle(radius, { plane: "XY", origin: toolHeight });
  //     const cone = base.loftWith([], { endPoint: [0, 0, -1e-3], ruled: true })
  //       .translate([data.position[0], data.position[1], 0]);
  //     connectionSolid = connectionSolid.cut(cone).simplify();
  //   }
  //   onProgress?.(Math.floor(90 + progressPerPoint * (itor + 1)));
  //   itor++;
  // });
  // 第四步，削平底部
  const margin = earWidth + 1;
  // const tool = makeBox(
  //   [outerResult.min[0] - margin, outerResult.min[1] - margin, toolHeight] as Point,
  //   [outerResult.max[0] + margin, outerResult.max[1] + margin, 0] as Point
  // );
  // connectionSolid = connectionSolid.intersect(tool) as Shape3D;
  onProgress?.(100);
  return connectionSolid.simplify().mirror("XY").rotate(180, [0, 0, 0], [0, 1, 0]);
};

export async function buildGroupStepFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
) {
  if (!trisWithAngles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const fused = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress);
  const blob = fused.blobSTEP();
  return blob;
}

const buildMeshTolerance = 0.1;
const buildMeshAngularTolerance = 0.5;
export async function buildGroupStlFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
) {
  if (!trisWithAngles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const fused = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress);
  return fused.blobSTL({ binary: true, tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });
}

export async function buildGroupMeshFromTriangles(trisWithAngles: TriangleWithEdgeInfo[], onProgress?: (msg: number) => void) {
  if (!trisWithAngles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const solid = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress);
  const mesh = solid.mesh({ tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(mesh.vertices, 3);
  const normal = new Float32BufferAttribute(mesh.normals, 3);
  const indexArray =
    mesh.vertices.length / 3 > 65535
      ? new Uint32BufferAttribute(mesh.triangles, 1)
      : new Uint16BufferAttribute(mesh.triangles, 1);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setIndex(indexArray);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const expotMesh = new Mesh(geometry);
  expotMesh.name = "Replicad Demo";
  return expotMesh;
}