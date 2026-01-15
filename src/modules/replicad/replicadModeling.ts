import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh } from "three";
import { Shape3D, setOC, getOC, makeBox, sketchCircle, Point, Plane, Sketcher } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, TriangleWithEdgeInfo } from "../../types/triangles";
import { getSettings } from "../settings";
import {
  pointKey, radToDeg, degToRad,
  pointLineDistance2D, trapezoid, triangles2Outer, solveE, offsetTriangleSafe, OffsetTriangleResult, OffsetFailReason
} from "../mathUtils";
import {
  makeVerticalPlaneThroughAB,
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


const isOcctValid = (shape: { wrapped: any }) => {
  const oc = getOC();

  // 你的 d.ts 要求 3 个参数：S, theGeomControls, theIsParallel
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);

  // 你的 d.ts 要求 IsValid_1(S)
  const ok = analyzer.IsValid_1(shape.wrapped);

  analyzer.delete?.();
  return ok;
};

const earClipGemometry = () => {
  const { earThickness, earWidth, earClipGap } = getSettings();
  // 耳朵卡子相关定义
  const earClipKeelThickness = 2 * earThickness;
  const earClipWingThickness = earClipKeelThickness;
  const earClipWingLength = Math.sqrt(earClipWingThickness) * 5;
  const earClipMinSpacing = earClipWingLength + 1;
  const earClipMaxSpacing = earClipWingLength * 4 + earWidth;
  return { earClipKeelThickness, earClipWingThickness, earClipWingLength, earClipMinSpacing, earClipMaxSpacing, earClipGap };
};

// 实际实行参数化建模的方法
const buildSolidFromTrianglesWithAngles = async (
  trianglesWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (progress: number) => void,
  onLog?: (msg: string) => void,
): Promise<{ solid: Shape3D; earClipNumTotal: number }> => {
  onProgress?.(0);
  const { layerHeight, connectionLayers, bodyLayers, earWidth, earThickness, hollowStyle, wireframeThickness } = getSettings();
  const bodyThickness = bodyLayers * layerHeight;
  const connectionThickness = connectionLayers * layerHeight;
  onProgress?.(1);
  await ensureReplicadOC();
  // 第一步：生成连接层和主体
  const outerResult  = triangles2Outer(trianglesWithAngles);
  if (!outerResult || !outerResult.outer || outerResult.outer.length < 3) {
    onLog?.("外轮廓查找失败");
    throw new Error("外轮廓查找失败");
  }
  const connectionSketch = sketchFromContourPoints(outerResult.outer, "XY", -outerResult.maxEdgeLen);
  if (!connectionSketch) {
    onLog?.("连接层草图生成失败");
    throw new Error("连接层草图生成失败");
  }
  let connectionSolid = connectionSketch.extrude(connectionThickness + bodyThickness + outerResult.maxEdgeLen).simplify();
  if (!connectionSolid) {
    onLog?.("连接层建模失败");
    throw new Error("连接层建模失败");
  }
  onProgress?.(2);
  const progressPerTriangle = 38 / trianglesWithAngles.length;
  const earCutToolMarginMin = earWidth * 1.5;
  const slopToolHeight = 1e-3 + Math.hypot(earWidth, earThickness) + bodyThickness + connectionThickness + 1;
  const slopeTools: Shape3D[] = [];
  const vertexAngleMap = new Map<string, { position: Point2D; minAngle: number }>();
  // 生成的几何体的面最小间距
  const minDistance = 0.2 * connectionLayers;
  // 耳朵外沿倒角
  const chamferSize = earThickness - layerHeight;
  let earClipNumTotal: number = 0;
  trianglesWithAngles.forEach((triData, i) => {
    const isDefined = <T,>(v: T | undefined | null): v is T => v != null;
    // 收集顶点最小角度信息
    triData.pointAngleData?.forEach((item) => {
      const key = pointKey(item.unfold2dPos);
      const prev = vertexAngleMap.get(key);
      if (!prev || item.minAngle < prev.minAngle) {
        vertexAngleMap.set(key, { position: item.unfold2dPos, minAngle: item.minAngle });
      }
    });
    const [p0, p1, p2] = triData.tri;
    // 基准顺序：AC, CB, BA 对应 [p0->p2, p2->p1, p1->p0]
    const planes = [makeVerticalPlaneNormalAB(p2, p1), makeVerticalPlaneNormalAB(p0, p2), makeVerticalPlaneNormalAB(p1, p0)];
    if (!planes.every(isDefined)) {
      onLog?.("创建切边平面失败，跳过三角形");
      console.warn('[ReplicadModeling] failed to create edge cutting planes for triangle, skip this triangle', triData);
      return;
    }
    const dists  = [Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), Math.hypot(p2[0] - p0[0], p2[1] - p0[1]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1])];
    // 准备每条边都要用到的辅助刀具
    const earExtendMargin = Math.max(...dists);
    const cutToolMargin = Math.max(earCutToolMarginMin, earExtendMargin);
    const edgeCutToolSketches = [
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
    if (!edgeCutToolSketches.every(isDefined)) {
      onLog?.("创建切边草图失败，跳过三角形");
      console.warn('[ReplicadModeling] failed to create edge cut tool sketches for triangle, skip this triangle', triData);
      return;
    }
    // 这个工具会用来裁剪掉耳朵和坡度刀具超出三角形范围的部分
    const edgeCutTools = [
      edgeCutToolSketches[0].extrude(dists[0] + 2 * cutToolMargin),
      edgeCutToolSketches[1].extrude(dists[1] + 2 * cutToolMargin),
      edgeCutToolSketches[2].extrude(dists[2] + 2 * cutToolMargin),
    ];

    // 耳朵卡子相关定义
    const { earClipKeelThickness, earClipWingThickness, earClipWingLength, earClipMinSpacing, earClipMaxSpacing } = earClipGemometry();
    const earClipGrooveClearance = 0.1;
    triData.edges.forEach((edge, idx) => {
      const pick = (k: 0 | 1 | 2): 0 | 1 | 2 => ((k + (idx % 3) + 3) % 3) as 0 | 1 | 2;
      const [pointA, pointB] = [triData.tri[pick(0)], triData.tri[pick(1)]];
      const distAB = dists[pick(2)];
      const edgePerpendicularPlane = planes[pick(2)];
      const adjEdgeCutToolL = edgeCutTools[pick(0)];
      const adjEdgeCutToolR = edgeCutTools[pick(1)];
      if ((!edge.isOuter && Math.abs(edge.angle - Math.PI) > 1e-3) || edge.angle < Math.PI - 1e-3) {
        // 第二步：生成弯折、拼接坡度刀具
        const slopeStartZ = edge.isOuter ? layerHeight : connectionThickness;
        const slopeZDelta = slopToolHeight - slopeStartZ;
          // 这是数学上的标准偏移
        const mathmaticalTopOffset = slopeZDelta * Math.tan(degToRad(90 - (radToDeg(edge.angle / 2))));
        const excessiveBend = 6;
        const slopeTopOffset = Math.max(mathmaticalTopOffset, minDistance / 2)
          // 这是超量弯折需要的额外偏移量（为什么需要超量弯折？因为打印机因流量校准等因素不可能生产出绝对符合数学模型的尺寸，且装配中超量弯折会有帮助）
          + (edge.isOuter ? 0 : (slopeZDelta * Math.tan(degToRad(excessiveBend / 2 + 90 - (radToDeg(edge.angle / 2)))) - mathmaticalTopOffset));
        // 需要确保斜坡首层（layerHeight/2处）的最小间距，以保证两边的斜坡的首层不融合
        // 切片软甲中的“切片间隙闭合半径”需要设置得尽量小以减少该问题，但仍然需要从数据上保证间距
        // 注意这里公式求得的是确保首层的偏移为minDistance / 2时的坡底偏移
        const slopeFirstLayerOffset = 1e-4 + Math.max(0, slopeTopOffset - slopeZDelta * (slopeTopOffset - minDistance / 2) / (slopeZDelta - layerHeight / 2));

        const slopeToolSketch = sketchFromContourPoints(edge.isOuter ? [
            [0,slopeStartZ],
            [0, slopToolHeight], [-slopeTopOffset, slopToolHeight],
          ] : [
            [-slopeFirstLayerOffset, slopeStartZ], [0,slopeStartZ],
            [0, slopToolHeight], [-slopeTopOffset, slopToolHeight]],
          edgePerpendicularPlane, -cutToolMargin);
        if (!slopeToolSketch) {
          onLog?.("创建坡度刀具草图失败，跳过该边");
          console.warn('[ReplicadModeling] failed to create slope tool sketch for edge, skip this edge', edge);
          return;
        }
        // 超量挤出了坡度刀具并切掉两头超出的部分，以更好地应付钝角
        const slopeTool = slopeToolSketch?.extrude(distAB + cutToolMargin).cut(adjEdgeCutToolL.clone()).cut(adjEdgeCutToolR.clone()).simplify();
        if (!slopeTool) {
          onLog?.("创建坡度刀具失败，跳过该边");
          console.warn('[ReplicadModeling] failed to create slope tool for edge, skip this edge', edge);
          return;
        }
        slopeTools.push(slopeTool);
      }
      // 设置的耳朵宽度过小时不创建耳朵
      if ((earWidth > bodyThickness + connectionThickness) && edge.incenter) {
        // 第三步：生成耳朵
        // 用拼接对向三角形的内心与拼接边形成的三角形和自己的内心相对于拼接边的镜像点与拼接边形成的三角形计算交集，作为耳朵三角形形状
        const minIncenter = solveE(edge.incenter, pointA, pointB, triData.incenter);
        if (!minIncenter) {
          onLog?.("耳朵内心求解失败，跳过该边");
          console.warn('[ReplicadModeling] failed to solve ear incenter for edge, skip this edge', edge);
          return;
        }
        const distanceAIncenter = Math.hypot(minIncenter[0] - pointA[0], minIncenter[1] - pointA[1]);
        const distanceBIncenter = Math.hypot(minIncenter[0] - pointB[0], minIncenter[1] - pointB[1]);

        // 根据耳朵宽度裁剪耳朵三角形求出梯形
        // 首先求得实际耳朵宽度，因为实际宽度需要根据二面角做调整，以保证连接槽的高度一致
        const earAngle = 180 - radToDeg(edge.angle / 2);
        const earClipWingExtrWidth = earAngle < 90 ? 0 : earClipWingThickness * Math.tan(degToRad(earAngle - 90));
        const earExtraWidth = earAngle < 90 ? (bodyThickness + connectionThickness - layerHeight) * Math.sin(degToRad(earAngle))
          : (bodyThickness + connectionThickness - layerHeight) / Math.cos(degToRad(earAngle - 90))
          + earThickness * Math.tan(degToRad(earAngle - 90)) + earClipWingExtrWidth;
        const earTrapezoid = trapezoid(pointA, pointB, minIncenter, earWidth + earExtraWidth);
        const isTriangleEar = earTrapezoid.length === 3;
        const earLength = isTriangleEar ? 0 : Math.hypot(earTrapezoid[2][0] - earTrapezoid[3][0], earTrapezoid[2][1] - earTrapezoid[3][1]);
        const earClipNum = 
          isTriangleEar || earLength < 2 * earClipMinSpacing  ? 1
          : earLength < 3 * earClipMinSpacing ? 2 
          : earLength < 7 * earClipMinSpacing ? 3
          : earLength < 13 * earClipMinSpacing ? 4
          : Math.max(4, Math.floor(earLength / earClipMaxSpacing));
        earClipNumTotal += earClipNum;
        const earClipSpacing = earClipNum === 1 ? 0 : (earLength - earClipWingLength) / (earClipNum - 1);
        const earMiddlePoint = isTriangleEar ? minIncenter : [
          (earTrapezoid[2][0] + earTrapezoid[3][0]) / 2,
          (earTrapezoid[2][1] + earTrapezoid[3][1]) / 2,
        ] as Point2D;

        // 向下延伸一点点以确保耳朵和主体连接良好
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
        // 耳朵从layerHeight处开始挤出，因为需要确保超小角度时的首层面积符合三角形面积
        const earSolidSketch = sketchFromContourPoints(earTrapezoid, "XY", layerHeight);
        if (!earSolidSketch) {
          onLog?.("创建耳朵草图失败，跳过该边");
          console.warn('[ReplicadModeling] failed to create ear sketch for edge, skip this edge', edge);
          return;
        }
        let earSolid = earSolidSketch.extrude(earThickness);
        // 为耳朵卡子切割连接槽
        // 先创建挖槽工具
        const earActualWidth = pointLineDistance2D(earMiddlePoint, pointA, pointB);
        const grooveDepth = earActualWidth - earExtraWidth + earClipWingExtrWidth;
        // 耳朵宽度因为内心限制达不到挖槽要求则不挖槽
        if (grooveDepth < 1e-1) {
          onLog?.("耳朵因几何限制宽度太窄，该边无法安装连接夹");
          console.warn('[ReplicadModeling] ear width is too narrow due to geometry constraint, skip this edge', edge);
        }
        else {
          const earClipGroovingPlane = new Plane(earMiddlePoint, [(pointA[0]-pointB[0]) / distAB, (pointA[1]-pointB[1]) / distAB, 0], [0, 0, 1]);
          const earClipGroovingSketch = new Sketcher(earClipGroovingPlane)
            .movePointerTo([-1.5 * earClipKeelThickness / 2 - earClipGrooveClearance, 0])
            .lineTo([-earClipKeelThickness / 2 - earClipGrooveClearance, -1.5 * earClipKeelThickness / 2])
            .lineTo([-earClipKeelThickness / 2 - earClipGrooveClearance, -grooveDepth + 1e-4])
            .lineTo([earClipKeelThickness / 2 + earClipGrooveClearance, -grooveDepth + 1e-4])
            .lineTo([earClipKeelThickness / 2 + earClipGrooveClearance, -1.5 * earClipKeelThickness / 2])
            .lineTo([1.5 * earClipKeelThickness / 2 + earClipGrooveClearance, 0])
            .close();
          if (!earClipGroovingSketch) {
            onLog?.("创建耳朵卡子挖槽草图失败，跳过该边");
            console.warn('[ReplicadModeling] failed to create ear clip grooving sketch for edge, skip this edge', edge);
          }
          else {
            if (grooveDepth < earWidth + earClipWingExtrWidth - 1e-6)
              onLog?.("耳朵因几何限制宽度太窄，连接夹安装可能不牢固");
            const earClipGroovingTool = earClipGroovingSketch.extrude(earThickness + 2 * layerHeight);
            const dirAB = [(pointA[0] - pointB[0]) / distAB, (pointA[1] - pointB[1]) / distAB];
            for (let clipIdx = 0; clipIdx < earClipNum; clipIdx++) {
              const distance2MiddlePoint = (-0.5 * earClipNum +clipIdx + 0.5) * earClipSpacing;
              earSolid = earSolid.cut(earClipGroovingTool.clone().translate(dirAB[0] * distance2MiddlePoint, dirAB[1] * distance2MiddlePoint, 0)).simplify();
            }
            earClipGroovingTool.delete();
          }
        }
        // 耳朵外侧上沿做一个倒角方便卡子安装
        const earChamferSketch = sketchFromContourPoints([
          [earActualWidth + 1e-4, earThickness + layerHeight - chamferSize],
          [earActualWidth + 1e-4, earThickness + layerHeight + 1e-4],
          [earActualWidth - chamferSize * Math.tan(Math.PI / 3), earThickness + layerHeight + 1e-4],
        ], edgePerpendicularPlane, -1);
        if (!earChamferSketch) {
          onLog?.("创建耳朵倒角草图失败，跳过倒角");
          console.warn('[ReplicadModeling] failed to create ear chamfer sketch for edge, skip chamfer', edge);
        } else {
          const earChamferTool = earChamferSketch.extrude(distAB + 2);
          earSolid = earSolid.cut(earChamferTool).simplify();
        }

        earSolid = earSolid.rotate(earAngle, [pointA[0], pointA[1], layerHeight], [pointA[0] - pointB[0], pointA[1] - pointB[1], 0]);

        const earCutTools: Shape3D[] = [adjEdgeCutToolL.clone(), adjEdgeCutToolR.clone()];
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
              edgePerpendicularPlane.clone(), distAB + cutToolMargin);
            if (earAntiInterferenceSketch) {
              earCutTools.push(earAntiInterferenceSketch.extrude(-(minDistance / 2 + cutToolMargin))
                .rotate((pointAAngle - 180) / 2, [pointA[0], pointA[1], 0], [0,0,1]));
            }
          }
          if (pointBAngle && pointBAngle > 180) {
            // console.log('[ReplicadModeling] edge info for ear anti-interference', { pointBAngle });
            const earAntiInterferenceSketch = sketchFromContourPoints(
              [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
              edgePerpendicularPlane.clone(), -cutToolMargin);
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
      }
    });
    edgeCutTools.forEach((tool) => tool.delete());
    planes.forEach((plane) => { if (plane) plane.delete(); });

    onProgress?.(Math.floor(2 + progressPerTriangle * (i + 1)));

    if (hollowStyle) {
      const msg: Record<OffsetFailReason, string> = {
        DEGENERATE_INPUT: "原三角形退化（点重合或面积过小）",
        PARALLEL_SHIFTED_LINES: "偏移后边线无法相交（偏移过大或近乎平行）",
        DEGENERATE_RESULT: "偏移结果退化（新三角形面积过小）",
        FLIPPED: "偏移导致三角形翻转（偏移过大）",
        OUTSIDE_ORIGINAL: "偏移结果跑到原三角形外（不满足内偏移）",
        INFEASIBLE_OFFSETS: "偏移导致三角形翻转（偏移过大）",
      };
        console.log('[ReplicadModeling] offsetTriangleSafe for hollowing', { triData, wireframeThickness });
        // 镂空
        const offsetResult = offsetTriangleSafe(triData.tri, [wireframeThickness, wireframeThickness, wireframeThickness]);
        if (!offsetResult.tri) {
          onLog?.(`三角形内偏移失败，跳过内偏移操作，原因：${msg[offsetResult.reason!]}`);
        }
        else
        {
          const voronoiCutToolSketch = sketchFromContourPoints(offsetResult.tri, "XY", -1);
          if (voronoiCutToolSketch)
            connectionSolid = connectionSolid.cut(voronoiCutToolSketch.extrude(connectionThickness + bodyThickness + 1 + 1e-4)).simplify();
        }
    }
  });

  if (!isOcctValid(connectionSolid)) {
    onLog?.("生成耳朵后实体不是有效的 OCCT 形状");
    console.warn('[ReplicadModeling] after ear creation, solid is not valid OCCT shape');
  }
  
  onProgress?.(40);
  const progressPerSlope = 40 / slopeTools.length;
  // 第四步：应用坡度刀具
  slopeTools.forEach((tool, idx) => {
    connectionSolid = connectionSolid.cut(tool).simplify();
    onProgress?.(Math.floor(40 + progressPerSlope * (idx + 1)));
  });
  slopeTools.forEach((tool) => tool.delete());
  if (!isOcctValid(connectionSolid)) {
    onLog?.("应用坡度刀具后实体不是有效的 OCCT 形状");
    console.warn('[ReplicadModeling] after applying slope tools, solid is not valid OCCT shape');
  }

  onProgress?.(80);
  // 第五步：消除干涉
  // const progressPerPoint = 19 / vertexAngleMap.size;
  // let itor = 0;
  // vertexAngleMap.forEach((data, key) => {
  //   if (data.minAngle < Math.PI) {
  //     const coneHeight =  Math.max(earCutToolMarginMin, bodyThickness + 1);
  //     const radius = 1.415 * Math.max(0.01, coneHeight * Math.tan((Math.PI - data.minAngle) * 0.5));
  //     const base = sketchCircle(radius, { plane: "XY", origin: coneHeight + connectionThickness });
  //     const bottom = sketchCircle(0.05, { plane: "XY", origin: connectionThickness });
  //     const cone = base.loftWith(bottom)
  //     // const cone = base.loftWith([], { endPoint: [0, 0, connectionThickness + 1e-2], ruled: true })
  //       .translate([data.position[0], data.position[1], 0]);
  //     connectionSolid = connectionSolid.cut(cone).simplify();
  //   }
  //   onProgress?.(Math.floor(80 + progressPerPoint * (itor + 1)));
  //   itor++;
  // });
  // if (!isOcctValid(connectionSolid)) {
  //   onLog?.("消除干涉后实体不是有效的 OCCT 形状");
  //   console.warn('[ReplicadModeling] after interference removal, solid is not valid OCCT shape');
  // }

  // 第六步，削平底部
  const margin = earWidth + 1;
  const tool = makeBox(
    [outerResult.min[0] - margin, outerResult.min[1] - margin, -outerResult.maxEdgeLen - 1] as Point,
    [outerResult.max[0] + margin, outerResult.max[1] + margin, 0] as Point
  );
  connectionSolid = connectionSolid.cut(tool) as Shape3D;
  connectionSolid = connectionSolid.simplify().mirror("XY").rotate(180, [0, 0, 0], [0, 1, 0])
  onProgress?.(100);
  if (!isOcctValid(connectionSolid)) {
    onLog?.("最终实体不是有效的 OCCT 形状");
    console.warn('[ReplicadModeling] final solid is not valid OCCT shape');
  }
  return { solid: connectionSolid, earClipNumTotal };
};

export const buildEarClip = async () => {
  await ensureReplicadOC();
  const { earThickness, earWidth } = getSettings();
  const { earClipKeelThickness, earClipWingThickness, earClipWingLength, earClipGap } = earClipGemometry();
  const keelChamferSize = Math.min(earClipKeelThickness / 2, 0.5);
  const wingChamferSize = Math.max(earClipWingThickness - 0.5, 1e-2);
  const earClipSketchKeel = sketchFromContourPoints([
    [0, 0],
    [earClipKeelThickness / 2, 0],
    [earClipKeelThickness / 2, earWidth - keelChamferSize],
    [earClipKeelThickness / 2 - keelChamferSize, earWidth],
    [0, earWidth],
  ], "XZ");
  const earClipSketchWing = sketchFromContourPoints([
    [0, earThickness + earClipWingThickness],
    [earClipWingLength / 2 - wingChamferSize, earThickness + earClipWingThickness],
    [earClipWingLength / 2, earThickness + earClipWingThickness - wingChamferSize],
    [earClipWingLength / 2, earThickness + earClipGap / 2],
    [earClipKeelThickness / 2, earThickness + earClipGap],
    [0, earThickness + earClipGap],
  ], "XY");
  const earClipSketchWingChamferYZ = sketchFromContourPoints([
    [earThickness + earClipWingThickness + earClipGap + 1e-4, earWidth + 1e-4],
    [earThickness + earClipWingThickness + earClipGap + 1e-4, earWidth - wingChamferSize],
    [earThickness + earClipWingThickness + earClipGap - wingChamferSize, earWidth + 1e-4],
  ], "YZ", 0);
  if (!earClipSketchKeel || !earClipSketchWing || !earClipSketchWingChamferYZ) {
    throw new Error("耳朵卡子草图创建失败");
  }
  const earClipSolidOneQuater = earClipSketchKeel.extrude(-(earClipWingThickness + earThickness))
    .fuse(earClipSketchWing.extrude(earWidth))
    .cut(earClipSketchWingChamferYZ.extrude(earClipWingLength / 2 + 1)).simplify();
  const earClipSolidHalf = earClipSolidOneQuater.fuse(earClipSolidOneQuater.clone().mirror("YZ")).simplify();
  return earClipSolidHalf.fuse(earClipSolidHalf.clone().mirror("XZ")).simplify();
};

export async function buildGroupStepFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
): Promise<{ blob: Blob; earClipNumTotal: number }> {
  if (!trisWithAngles.length) {
    onLog?.("没有可用于建模的展开三角形");
    throw new Error("没有可用于建模的展开三角形");
  }
  const { solid, earClipNumTotal } = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress, onLog);
  const blob = solid.blobSTEP();
  return { blob, earClipNumTotal };
}

const buildMeshTolerance = 0.1;
const buildMeshAngularTolerance = 0.5;
export async function buildGroupStlFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
): Promise<{ blob: Blob; earClipNumTotal: number }> {
  if (!trisWithAngles.length) {
    onLog?.("没有可用于建模的展开三角形");
    throw new Error("没有可用于建模的展开三角形");
  }
  const { solid, earClipNumTotal } = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress, onLog);
  const blob = solid.blobSTL({ binary: true, tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });
  return { blob, earClipNumTotal };
}

export async function buildGroupMeshFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
): Promise<{ mesh: Mesh; earClipNumTotal: number }> {
  if (!trisWithAngles.length) {
    onLog?.("没有可用于建模的展开三角形");
    throw new Error("没有可用于建模的展开三角形");
  }
  const { solid, earClipNumTotal } = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress, onLog);
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
  return { mesh: expotMesh, earClipNumTotal };
}
