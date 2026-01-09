import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh } from "three";
import { Shape3D, setOC, makeBox, Point } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, TriangleWithEdgeInfo } from "../../types/triangles";
import { getSettings } from "../settings";
import {
  pointKey,
  radToDeg,
  degToRad,
  trapezoid,
  triangles2Outer,
  solveE,
  makeVerticalPlaneNormalAB,
  sketchFromContourPoints,
} from "./replicadUtils";

type OcFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<OpenCascadeInstance>;
let ocReady: Promise<void> | null = null;

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

// 实际实行参数化建模的方法
const buildSolidFromTrianglesWithAngles = async (
  trianglesWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (progress: number) => void,
) => {
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
  const progressPerTriangle = 38 / trianglesWithAngles.length;
  const earCutToolMarginMin = earWidth * 1.5;
  const slopToolHeight = 1e-3 + Math.max(Math.hypot(earWidth, earThickness), bodyThickness + connectionThickness);
  const slopeTools: Shape3D[] = [];
  trianglesWithAngles.forEach((triData, i) => {
    // console.log('[ReplicadModeling] processing triangle for ears', triData);
    const isDefined = <T,>(v: T | undefined | null): v is T => v != null;
    const [p0, p1, p2] = triData.tri;
    // 基准顺序：AC, CB, BA 对应 [p0->p2, p2->p1, p1->p0]
    const planes = [makeVerticalPlaneNormalAB(p2, p1), makeVerticalPlaneNormalAB(p0, p2), makeVerticalPlaneNormalAB(p1, p0)];
    if (!planes.every(isDefined)) {
      console.warn('[ReplicadModeling] failed to create cutting planes for triangle, skip this triangle', triData);
      return;
    }
    const dists  = [Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), Math.hypot(p2[0] - p0[0], p2[1] - p0[1]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1])];
    const earExtendMargin = Math.max(...dists);
    const cutToolMargin = Math.max(earCutToolMarginMin, earExtendMargin);
    const earEdgeCutToolSketches = [
      sketchFromContourPoints(
        [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
        planes[0],
        -cutToolMargin),
      sketchFromContourPoints(
        [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
        planes[1],
        -cutToolMargin),
      sketchFromContourPoints(
        [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
        planes[2],
        -cutToolMargin),
    ];
    if (!earEdgeCutToolSketches.every(isDefined)) {
      console.warn('[ReplicadModeling] failed to create ear cutting tools for triangle, skip this triangle', triData);
      return;
    }
    const earEdgeCutTools = [
      earEdgeCutToolSketches[0].extrude(dists[0] + 2 * cutToolMargin),
      earEdgeCutToolSketches[1].extrude(dists[1] + 2 * cutToolMargin),
      earEdgeCutToolSketches[2].extrude(dists[2] + 2 * cutToolMargin),
    ];
    triData.edges.forEach((edge, idx) => {
      const pick = (k: 0 | 1 | 2): 0 | 1 | 2 => ((k + (idx % 3) + 3) % 3) as 0 | 1 | 2;
      const [pointA, pointB, pointC] = [triData.tri[pick(0)], triData.tri[pick(1)], triData.tri[pick(2)]];
      const minDistance = 0.2;
      if (!edge.isOuter || edge.angle < Math.PI - 1e-6) {
        // 第二步：生成弯折、拼接坡度刀具
        const slopeStartZ = connectionThickness;//edge.isOuter ? 0 : connectionThickness;
        const slopeZDelta = slopToolHeight - slopeStartZ;
        const slopeTopOffset = Math.max(slopeZDelta * Math.tan(degToRad(90-(radToDeg(edge.angle / 2)))), minDistance / 2) + (!edge.isOuter ? 0.15 : 0);
        // 需要确保斜坡首层（layerHeight/2处）的最小间距，以保证两边的斜坡的首层不融合
        // 切片软甲中的“切片间隙闭合半径”需要设置得尽量小以减少该问题，但仍然需要从数据上保证间距
        // 注意这里公式求得的是确保首层的偏移为minDistance / 2时的放样底部偏移
        const slopeFirstLayerOffset = 1e-3 + (edge.isOuter ? 0 : Math.max(0, slopeTopOffset - slopeZDelta * (slopeTopOffset - minDistance / 2) / (slopeZDelta - layerHeight / 2)));

        const slopeToolSketch = sketchFromContourPoints([
          [-slopeFirstLayerOffset, slopeStartZ], [0,slopeStartZ],
          [0, slopToolHeight], [-slopeTopOffset, slopToolHeight]], planes[pick(2)]);
        if (!slopeToolSketch) {
          console.warn('[ReplicadModeling] failed to create slope tool sketch for edge, skip this edge', edge);
        }
        const slopeTool = slopeToolSketch?.extrude(dists[pick(2)])
        if (!slopeTool) {
          console.warn('[ReplicadModeling] failed to create slope tool for edge, skip this edge', edge);
          return;
        }
        slopeTools.push(slopeTool);
      }
      if (!edge.incenter) return;
      // 第三步：生成耳朵
      // 用拼接对向三角形的内心与拼接边形成的三角形和自己的内心相对于拼接边的镜像点与拼接边形成的三角形计算交集，作为耳朵三角形形状
      const minIncenter = solveE(edge.incenter, pointA, pointB, triData.incenter);
      if (!minIncenter) {
        console.warn('[ReplicadModeling] failed to solve ear incenter for edge, skip this edge', edge);
        return;
      }
      const distanceAIncenter = Math.hypot(minIncenter[0] - pointA[0], minIncenter[1] - pointA[1]);
      const distanceBIncenter = Math.hypot(minIncenter[0] - pointB[0], minIncenter[1] - pointB[1]);

      // 根据耳朵宽度裁剪耳朵三角形求出梯形
      const earTrapezoid = trapezoid(pointA, pointB, minIncenter, earWidth);
      if (edge.angle > Math.PI) {
        const pointA_Incenter_extend: Point2D = [
          minIncenter[0] + (pointA[0] - minIncenter[0]) * (earExtendMargin + distanceAIncenter) / distanceAIncenter,
          minIncenter[1] + (pointA[1] - minIncenter[1]) * (earExtendMargin + distanceAIncenter) / distanceAIncenter];
        const pointB_Incenter_extend: Point2D = [
          minIncenter[0] + (pointB[0] - minIncenter[0]) * (earExtendMargin + distanceBIncenter) / distanceBIncenter,
          minIncenter[1] + (pointB[1] - minIncenter[1]) * (earExtendMargin + distanceBIncenter) / distanceBIncenter];
        earTrapezoid[0] = pointA_Incenter_extend;
        earTrapezoid[1] = pointB_Incenter_extend;
      }
      const earSolidSketch = sketchFromContourPoints(earTrapezoid, "XY", connectionThickness);
      if (!earSolidSketch) {
        console.warn('[ReplicadModeling] failed to create ear sketch for edge, skip this edge', edge);
        return;
      }
      let earSolid = earSolidSketch.extrude(earThickness).rotate(180 - radToDeg(edge.angle / 2), [pointA[0], pointA[1], connectionThickness], [pointA[0] - pointB[0], pointA[1] - pointB[1], 0]);
      const earCutTools: Shape3D[] = [earEdgeCutTools[pick(0)].clone(), earEdgeCutTools[pick(1)].clone()];
      // 向外翻的耳朵可能需要根据外轮廓顶点角度进行相邻外轮廓耳朵防干涉的裁剪
      if (edge.angle > Math.PI) {
        const pointAKey = pointKey(pointA);
        const pointBKey = pointKey(pointB);
        const pointAAngle = outerResult.pointAngleMap.get(pointAKey);
        const pointBAngle = outerResult.pointAngleMap.get(pointBKey);
        // console.log('[ReplicadModeling] edge info for ear', { pointAAngle, pointBAngle });
        // 只有拼接边与拼接边相邻，且拼接边与拼接边相邻的顶点角度小于180度（阴角）时才需要进行防干涉
        if (pointAAngle && pointAAngle > 180) {
          // console.log('[ReplicadModeling] edge info for ear anti-interference', { pointAAngle });
          const earAntiInterferenceSketch = sketchFromContourPoints(
            [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
            planes[pick(2)].clone(), dists[pick(2)] + cutToolMargin);
          if (earAntiInterferenceSketch) {
            earCutTools.push(earAntiInterferenceSketch.extrude(-(minDistance / 2 + cutToolMargin))
              .rotate((pointAAngle - 180) / 2, [pointA[0], pointA[1], 0], [0,0,1]));
          }
        }
        if (pointBAngle && pointBAngle > 180) {
          // console.log('[ReplicadModeling] edge info for ear anti-interference', { pointBAngle });
          const earAntiInterferenceSketch = sketchFromContourPoints(
            [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
            planes[pick(2)].clone(), -cutToolMargin);
          if (earAntiInterferenceSketch) {
            earCutTools.push(earAntiInterferenceSketch.extrude(minDistance / 2 + cutToolMargin)
              .rotate(-(pointBAngle - 180) / 2, [pointB[0], pointB[1], 0], [0,0,1]));
          }
        }
      }
      earCutTools.forEach((tool) => {
        if (tool) earSolid = earSolid.cut(tool).simplify();
      });
      connectionSolid = connectionSolid.fuse(earSolid).simplify();
    });

    // 第三步：生成弯折、拼接坡度刀具
    earEdgeCutTools.forEach((tool) => tool.delete());
    planes.forEach((plane) => { if (plane) plane.delete(); });

    onProgress?.(Math.floor(2 + progressPerTriangle * (i + 1)));
  });
  
  onProgress?.(60);
  const progressPerSlope = 49 / slopeTools.length;
  // 第四步：应用刀具
  slopeTools.forEach((tool, idx) => {
    connectionSolid = connectionSolid.cut(tool).simplify();
    onProgress?.(Math.floor(80 + progressPerSlope * (idx + 1)));
  });
  slopeTools.forEach((tool) => tool.delete());

  // 第四步，削平底部
  const margin = earWidth + 1;
  const tool = makeBox(
    [outerResult.min[0] - margin, outerResult.min[1] - margin, slopToolHeight] as Point,
    [outerResult.max[0] + margin, outerResult.max[1] + margin, 0] as Point
  );
  connectionSolid = connectionSolid.intersect(tool) as Shape3D;
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
  expotMesh.name = "group_preview_mesh";
  return expotMesh;
}