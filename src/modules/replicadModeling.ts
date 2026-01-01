import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh } from "three";
import { Sketcher, setOC, FaceFinder, EdgeFinder, type ShapeMesh, makeOffset } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, Triangle2D, TriangleWithEdgeInfo } from "../types/triangles";

type OcFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<OpenCascadeInstance>;

let ocReady: Promise<void> | null = null;

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

const pointKey = ([x, y]: Point2D) => `${x.toFixed(5)},${y.toFixed(5)}`;
const edgeKey = (a: Point2D, b: Point2D) => {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const polygonArea = (pts: Point2D[]) => {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return area * 0.5;
};

// 从三角形列表提取外轮廓（去除重复边，返回面积最大的环）
// export function triangles2Outer(triangles: Triangle2D[]): Point2D[] {
//   if (!triangles.length) return [];
//   const edgeMap = new Map<string, { a: Point2D; b: Point2D; count: number }>();
//   triangles.forEach((tri) => {
//     const edges: [Point2D, Point2D][] = [
//       [tri[0], tri[1]],
//       [tri[1], tri[2]],
//       [tri[2], tri[0]],
//     ];
//     edges.forEach(([a, b]) => {
//       const k = edgeKey(a, b);
//       const rec = edgeMap.get(k);
//       if (rec) rec.count += 1;
//       else edgeMap.set(k, { a, b, count: 1 });
//     });
//   });

//   const boundary = Array.from(edgeMap.values()).filter((e) => e.count === 1);
//   if (!boundary.length) return [];

//   const adjacency = new Map<string, Point2D[]>();
//   boundary.forEach(({ a, b }) => {
//     const ka = pointKey(a);
//     const kb = pointKey(b);
//     if (!adjacency.has(ka)) adjacency.set(ka, []);
//     if (!adjacency.has(kb)) adjacency.set(kb, []);
//     adjacency.get(ka)!.push(b);
//     adjacency.get(kb)!.push(a);
//   });

//   const visited = new Set<string>();
//   const loops: Point2D[][] = [];

//   boundary.forEach(({ a, b }) => {
//     const startEdgeKey = edgeKey(a, b);
//     if (visited.has(startEdgeKey)) return;
//     let current = a;
//     const loop: Point2D[] = [];
//     let guard = boundary.length * 3 + 3;
//     while (guard-- > 0) {
//       loop.push(current);
//       const neigh = adjacency.get(pointKey(current)) || [];
//       const next = neigh.find((n) => !visited.has(edgeKey(current, n)));
//       if (!next) break;
//       visited.add(edgeKey(current, next));
//       current = next;
//       if (pointKey(current) === pointKey(loop[0])) break;
//     }
//     if (loop.length >= 3 && pointKey(current) === pointKey(loop[0])) {
//       loops.push(loop);
//     }
//   });

//   if (!loops.length) return [];
//   let best = loops[0];
//   let bestArea = Math.abs(polygonArea(best));
//   loops.slice(1).forEach((lp) => {
//     const area = Math.abs(polygonArea(lp));
//     if (area > bestArea) {
//       bestArea = area;
//       best = lp;
//     }
//   });
//   if (best.length > 1 && pointKey(best[0]) === pointKey(best[best.length - 1])) {
//     best = best.slice(0, -1);
//   }
//   return best;
// }
export function triangles2Outer(trianglesWithAngles: TriangleWithEdgeInfo[]): Point2D[] {
  if (!trianglesWithAngles.length) return [];
  const edgeMap = new Map<string, { a: Point2D; b: Point2D }>();
  trianglesWithAngles.forEach((triData) => {
    const edges: [Point2D, Point2D, { isOuter: boolean; angle: number } | undefined][] = [
      [triData.tri[0], triData.tri[1], triData.edges?.[0]],
      [triData.tri[1], triData.tri[2], triData.edges?.[1]],
      [triData.tri[2], triData.tri[0], triData.edges?.[2]],
    ];
    edges.forEach(([a, b, info]) => {
      if (!info?.isOuter) return;
      const k = edgeKey(a, b);
      if (!edgeMap.has(k)) {
        edgeMap.set(k, { a, b });
      }
    });
  });

  const boundary = Array.from(edgeMap.values());
  if (!boundary.length) return [];

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

  if (!loops.length) return [];
  let best = loops[0];
  let bestArea = Math.abs(polygonArea(best));
  loops.slice(1).forEach((lp) => {
    const area = Math.abs(polygonArea(lp));
    if (area > bestArea) {
      bestArea = area;
      best = lp;
    }
  });
  if (best.length > 1 && pointKey(best[0]) === pointKey(best[best.length - 1])) {
    best = best.slice(0, -1);
  }
  return best;
}

const radToDeg = (rad: number) => (rad * 180) / Math.PI;
const degToRad = (deg: number) => (deg * Math.PI) / 180;

const intersectLines = (p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null => {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return null;
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
  return [px, py];
};

// 根据三条边的二面角对三角形做内偏移（每条边向内平移 offset，取平移后的交点作为新三角）
// shrinkFactor: 控制偏移量的系数，非负数，0 表示不偏移
// nonSeamShrinkFactor: 非接缝边额外偏移量，非负数，0 表示不额外偏移
// obsoluteExtraOffset: 全局额外偏移量，非负数，0 表示不额外偏移
export function offsetTriangleWithAngles(
  triData: TriangleWithEdgeInfo,
  shrinkFactor: number,
  nonSeamShrinkFactor: number,
  obsoluteExtraOffsets: number[],
): {offsettedTri: Triangle2D, extraOffsetValue: number[]} {
  if (shrinkFactor < 0 || nonSeamShrinkFactor < 0) {
    console.warn('offsetTriangleWithAngles: invalid shrinkFactor or nonSeamShrinkFactor, skip offsetting');
    return {offsettedTri: triData.tri, extraOffsetValue: [0, 0, 0]};
  }
  if (obsoluteExtraOffsets.length !== 3) {
    console.warn('offsetTriangleWithAngles: invalid obsoluteExtraOffsets length, skip offsetting');
    return {offsettedTri: triData.tri, extraOffsetValue: [0, 0, 0]};
  }
  console.debug('[offset] offsetTriangleWithAngles', 'shrinkFactor', shrinkFactor, 'nonSeamShrinkFactor', nonSeamShrinkFactor, 'obsoluteExtraOffsets', obsoluteExtraOffsets);
  const { tri, edges } = triData;
  const area = polygonArea(tri);
  const inwardNormal = (vx: number, vy: number): Point2D => {
    // CCW: inward is left normal; CW: right normal
    return area >= 0 ? [-vy, vx] : [vy, -vx];
  };

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
  const extraOffsetValue: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angleRad = edges[i]?.angle ?? Math.PI; // 非共享边视为 180°
    const angleDeg = Math.abs(radToDeg(angleRad));
    // 采用 min 而非 max，保证当二面角 < 180 时产生正偏移；二面角→0 时需裁剪
    const half = angleDeg * 0.5;
    const term = Math.min(90, half); // <= 90
    const raw = 90 - term; // >=0
    let offset = shrinkFactor * Math.tan(degToRad(raw));
    if (!Number.isFinite(offset)) offset = 0;
    const heightCap = edgeHeights[i] * 0.5;
    if (Math.abs(offset) > heightCap) {
      offset = Math.sign(offset) * heightCap;
      console.warn('offsetTriangleWithAngles: offset exceeds height cap, adjusted', offset);
    }
    console.log('Math.abs(angleRad - Math.PI)', Math.abs(angleRad - Math.PI * 0.5));
    const bendingOffset = (Math.abs(angleRad - Math.PI) < 0.001 || edges[i]?.isOuter? 0 : obsoluteExtraOffsets[i] + offset * nonSeamShrinkFactor);
    console.log('offset', offset, 'bendingOffset', bendingOffset, 'obsoluteExtraOffsets[i]', obsoluteExtraOffsets[i]);
    extraOffsetValue.push(bendingOffset);
    if (!edges[i]?.isOuter) offset += bendingOffset;
    offsets.push(offset);
  }

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
  return {offsettedTri, extraOffsetValue};
}

// const buildSolidFromTriangles = async (trisWithAngles: TriangleWithEdgeInfo[]) => {
//   await ensureReplicadOC();
//   const outer = triangles2Outer(trisWithAngles);
//   if (!outer.length) {
//     throw new Error("三角形建模失败");
//   }
//   const baseSketcher = new Sketcher("XY");
//   outer.forEach(([x, y], idx) => {
//     if (idx === 0) baseSketcher.movePointerTo([x, y]);
//     else baseSketcher.lineTo([x, y]);
//   });
//   let connectionSolid = baseSketcher.close().extrude(-1);
//   const sideFinder = new FaceFinder().when(({ normal }) => (normal ? Math.abs(normal.z) < 0.99 : false));
//   trisWithAngles.forEach((triData) => {
//     const sketch = new Sketcher("XY")
//       .movePointerTo(triData.tri[0])
//       .lineTo(triData.tri[1])
//       .lineTo(triData.tri[2])
//       .close();
//     const solid = sketch.extrude(0.5);
//     const sideFaces = sideFinder.find(solid, { unique: false });
//     console.log('sideFaces', sideFaces.length);
//     sideFaces.forEach((f) => {
//       makeOffset(f, -0.5);
//     });
//     connectionSolid = connectionSolid.fuse(solid, { optimisation: "commonFace" });
//   });
//   return connectionSolid;
// };

const buildSolidFromTrianglesWithAngles = async (trianglesWithAngles: TriangleWithEdgeInfo[]) => {
    const bodyThickness = 0.4;
    const connectionThickness = 0.2;
    const nonSeamShrinkFactor = 0.2;
    const topSketchObsoluteExtraOffsets = [0.05, 0.05, 0.05];
    // const topSketchObsoluteExtraOffsets = [0, 0, 0];
    const chamferSize = 0.2;
    await ensureReplicadOC();
    const outer = triangles2Outer(trianglesWithAngles);
    console.log('trianglesWithAngles', trianglesWithAngles, 'outer', outer);
    if (!outer.length) {
      throw new Error("三角形建模失败");
    }
    const baseSketcher = new Sketcher("XY");
    outer.forEach(([x, y], idx) => {
      if (idx === 0) baseSketcher.movePointerTo([x, y]);
      else baseSketcher.lineTo([x, y]);
    });
    let connectionSolid = baseSketcher.close().extrude(-connectionThickness);
    let i = 0;
    trianglesWithAngles.forEach((triData) => {
      i++;
      // if (i != 1) return;
      const offsetResult = offsetTriangleWithAngles(triData, bodyThickness, nonSeamShrinkFactor, topSketchObsoluteExtraOffsets);
      const bodyTopTriangle = offsetResult.offsettedTri;
      const bodyBottomTriangle = offsetTriangleWithAngles(triData, 0, 0, offsetResult.extraOffsetValue).offsettedTri;
      console.log('bodyTopTriangle', bodyTopTriangle, 'extraOffsetValue', offsetResult.extraOffsetValue);
      const bodyTopSketch = new Sketcher("XY", bodyThickness)
        .movePointerTo(bodyTopTriangle[0])
        .lineTo(bodyTopTriangle[1])
        .lineTo(bodyTopTriangle[2])
        .close();
      const bodyBottomSketch = new Sketcher("XY")
        .movePointerTo(bodyBottomTriangle[0])
        .lineTo(bodyBottomTriangle[1])
        .lineTo(bodyBottomTriangle[2])
        .close();
      const bodySolid = bodyBottomSketch.loftWith(bodyTopSketch);
      const onlySideEdges = (e: EdgeFinder) =>
        e.not((f: EdgeFinder) =>
          f.either([
            (ff: EdgeFinder) => ff.inPlane("XY", 0),
            (ff: EdgeFinder) => ff.inPlane("XY", bodyThickness),
          ])
        );
      const bodyFilleted = bodySolid.chamfer(chamferSize, onlySideEdges);
      connectionSolid = connectionSolid.fuse(bodyFilleted, { optimisation: "commonFace" });
    });
    return connectionSolid;
  }

export async function buildGroupStepFromTriangles(trisWithAngles: TriangleWithEdgeInfo[]) {
  if (!trisWithAngles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const fused = await buildSolidFromTrianglesWithAngles(trisWithAngles);
  const blob = fused.blobSTEP();
  return blob;
}

export async function buildGroupStlFromTriangles(trisWithAngles: TriangleWithEdgeInfo[]) {
  if (!trisWithAngles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const fused = await buildSolidFromTrianglesWithAngles(trisWithAngles);
  return fused.blobSTL({ binary: true, tolerance: 0.2, angularTolerance: 0.1 });
}

export async function buildGroupMeshFromTriangles(trisWithAngles: TriangleWithEdgeInfo[]) {
  if (!trisWithAngles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const solid = await buildSolidFromTrianglesWithAngles(trisWithAngles);
  const mesh = solid.mesh({ tolerance: 0.2, angularTolerance: 0.1 });
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
