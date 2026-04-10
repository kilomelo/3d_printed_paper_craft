import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh, Shape } from "three";
import { localGC, setOC, getOC, Shape3D, makeBox, drawCircle, drawRectangle, Point, Plane, Sketcher } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, PolygonWithEdgeInfo, PolygonContour } from "../../types/geometryTypes";
import { getSettings } from "../settings";
import {
  pointKey, degToRad,
  pointLineDistance2D, trapezoid, polygons2Outer, solveE, offsetTriangleSafe, OffsetFailReason, calculateIsoscelesRightTriangle,
  buildTriangleByEdgeAndAngles,
  angleDegFromRadiusAndArcLength,
  footOfPerpendicularToSegmentLine
} from "../mathUtils";
import {
  makeVerticalPlaneNormalAB,
  extrudeFromContourPoints,
  sketchFromContourPoints,
  extrudeCylinderAtPlaneLocalXY,
  translateWorldPointAlongPlaneAxes,
  transformPlaneLocal,
  splitSolidByPlane,
  arcByCenterStartAngleSafe,
  extrudeRingFromOuterAndInnerContours,
} from "./replicadUtils";
import {
  createReplicadError,
  OFFSET_FAIL_CODE_MAP,
  REPLICAD_LOG_CODES,
} from "./replicadErrors";

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

// 检查 OC 是否为有效的
const isOcctValid = (shape: { wrapped: any }) => {
  const oc = getOC();
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  const ok = analyzer.IsValid_1(shape.wrapped);
  analyzer.delete?.();
  return ok;
};

// 计算舌片卡子相关参数
const tabClipGemometry = () => {
  const { tabThickness, tabWidth, tabClipGap, clipGapAdjust } = getSettings();
  // 舌片卡子相关定义
  const tabClipKeelThickness = 2 * tabThickness;
  const tabClipWingThickness = tabClipKeelThickness * 0.7;
  const tabClipWingLength = Math.sqrt(tabClipWingThickness) * 5;
  const tabClipMinSpacing = tabClipWingLength + 1;
  const tabClipMaxSpacing = tabClipWingLength * 4 + tabWidth;
  // 如果开启了自动调整配合间隙，则当间隙设置设置小于1时，增加配合间隙，防止间隙太小安装不上
  const clipGap = clipGapAdjust === "off" ? tabClipGap : (tabThickness > 1 ? (tabClipGap - (tabThickness - 1) * 0.04) : (tabClipGap - (tabThickness - 1) * 0.9));
  return { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, tabClipMinSpacing, tabClipMaxSpacing, clipGap };
};

const reportReplicadIssue = (
  onLog: ((msg: string) => void) | undefined,
  code: string,
  context?: Record<string, unknown>,
) => {
  onLog?.(code);
  console.log("[ReplicadModeling]", code, context ?? {});
};

const throwReplicadIssue = (
  onLog: ((msg: string) => void) | undefined,
  code: string,
  description: string,
  context?: Record<string, unknown>,
): never => {
  reportReplicadIssue(onLog, code, context);
  throw createReplicadError(code, description);
};

// 实际实行参数化建模的方法【核心逻辑】
// 这里已经从"按三角形输入"改为"按多边形输入"。
// 多边形的边按 points[i] -> points[(i + 1) % n] 解释。
// hollowStyle 开启时，生产端会退回为"三角形 polygon"，因此仍可复用现有镂空逻辑。
const buildSolidFromPolygonsWithAngles = async (
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (progress: number) => void,
  onLog?: (msg: string) => void,
  mode: "normal" | "lumina" = "normal",
): Promise<{ solid: Shape3D }> => {
  const [gc, cleanup] = localGC();
  try {
    onProgress?.(0);
    const {
      layerHeight,
      luminaLayersTotalHeight,
      connectionLayers,
      bodyLayers,
      joinType,
      clawInterlockingAngle,
      clawTargetRadius,
      clawRadiusAdaptive,
      clawWidth,
      clawFitGap,
      clawDensity,
      tabWidth,
      tabThickness,
      antiSlipClip,
      hollowStyle,
      wireframeThickness,
    } = getSettings();
    const bodyThickness = bodyLayers * layerHeight;
    const connectionThickness = mode === "normal" ? connectionLayers * layerHeight : luminaLayersTotalHeight;
    onProgress?.(1);
    await ensureReplicadOC();

    // 第一步：生成连接层和主体
    const outerResult  = polygons2Outer(polygonsWithAngles);
    if (!outerResult || !outerResult.outer || outerResult.outer.length < 3) {
      throwReplicadIssue(onLog, REPLICAD_LOG_CODES.outerFail, "Failed to resolve outer contour");
    }
    const validOuterResult = outerResult!;
    const connectionBase = extrudeFromContourPoints(
      validOuterResult.outer,
      "XY",
      -validOuterResult.maxEdgeLen,
      connectionThickness + bodyThickness + validOuterResult.maxEdgeLen,
    );
    if (!connectionBase) {
      throwReplicadIssue(onLog, REPLICAD_LOG_CODES.connSketchFail, "Failed to build connection-layer sketch");
    }
    const validConnectionBase = connectionBase!;
    let connectionSolid = validConnectionBase.simplify();
    
    if (!connectionSolid) {
      throwReplicadIssue(onLog, REPLICAD_LOG_CODES.connModelFail, "Failed to build connection-layer solid");
    }
    onProgress?.(2);
    const progressPerPolygon = 48 / polygonsWithAngles.length;
    const tabCutToolMarginMin = tabWidth * 1.5;
    const slopToolHeight = 1e-3 + Math.hypot(tabWidth, tabThickness) + bodyThickness * 2 + connectionThickness + 1;
    const slopeTools: Shape3D[] = [];
    const vertexAngleMap = new Map<string, { position: Point2D; minAngle: number }>();
    // 生成的几何体的面最小间距
    const minDistance = 0.2;
    // 舌片外沿倒角
    const tabChamferSize = tabThickness - layerHeight;
    // 
    const interlockingClaws: Shape3D[] = [];

    polygonsWithAngles.forEach((polyData, i) => {
      const isDefined = <T,>(v: T | undefined | null): v is T => v != null;
      // 收集顶点最小角度信息
      polyData.pointAngleData?.forEach((item) => {
        const key = pointKey(item.unfold2dPos);
        const prev = vertexAngleMap.get(key);
        if (!prev || item.minAngle < prev.minAngle) {
          vertexAngleMap.set(key, { position: item.unfold2dPos, minAngle: item.minAngle });
        }
      });
      const points = polyData.points;
      if (points.length < 3 || polyData.edges.length !== points.length) {
        reportReplicadIssue(onLog, REPLICAD_LOG_CODES.polygonInvalid, { polygon: polyData });
        return;
      }
      // polygon 自身边界顶点角度（优先使用数据生产层新增的数据）。
      // 这层角度用于判断当前边在相邻顶点处是否为阴角（>180），
      // 以决定相邻边裁剪刀具是否需要翻转方向。
      const polygonPointAngleMap = new Map<string, number>();
      polyData.boundaryPointAngleData?.forEach((item) => {
        polygonPointAngleMap.set(pointKey(item.point), item.angle);
      });
      const getPolygonPointAngle = (pt: Point2D): number | undefined => {
        return polygonPointAngleMap.get(pointKey(pt)) ?? validOuterResult.outerPointAngleMap.get(pointKey(pt));
      };
      // 为每条边构造一个垂直切割平面。
      // 这里沿用旧三角形版本的约定：以边的反向向量作为平面法向。
      const planes = points.map((pointA, edgeIdx) => {
        const pointB = points[(edgeIdx + 1) % points.length];
        return makeVerticalPlaneNormalAB(pointB, pointA);
      });
      // 额外准备"反向法向"的平面，用于构造相邻边裁剪刀具的反向版本。
      // 多边形出现阴角时，同一条边对不同相邻边的裁剪语义可能相反；
      // 因此不能再只依赖每条边一把固定方向的刀具。
      const planesReversed = points.map((pointA, edgeIdx) => {
        const pointB = points[(edgeIdx + 1) % points.length];
        return makeVerticalPlaneNormalAB(pointA, pointB);
      });
      if (!planes.every(isDefined) || !planesReversed.every(isDefined)) {
        reportReplicadIssue(onLog, REPLICAD_LOG_CODES.edgePlaneFail, { polygon: polyData });
        return;
      }
      const dists = points.map((pointA, edgeIdx) => {
        const pointB = points[(edgeIdx + 1) % points.length];
        return Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]);
      });
      // 准备每条边都要用到的辅助刀具
      const tabExtendMargin = Math.max(...dists);
      const cutToolMargin = Math.max(tabCutToolMarginMin, tabExtendMargin);
      const edgeCutTools = planes.map((plane, edgeIdx) => extrudeFromContourPoints(
          [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
          plane,
          -cutToolMargin,
          dists[edgeIdx] + 2 * cutToolMargin,
        ));
      const edgeCutToolsReversed = planesReversed.map((plane, edgeIdx) => extrudeFromContourPoints(
          [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
          plane,
          -cutToolMargin,
          dists[edgeIdx] + 2 * cutToolMargin,
        ));
      if (!edgeCutTools.every(isDefined) || !edgeCutToolsReversed.every(isDefined)) {
        reportReplicadIssue(onLog, REPLICAD_LOG_CODES.edgeSketchFail, { polygon: polyData });
        return;
      }

      // 舌片卡子相关定义
      const { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, tabClipMinSpacing, tabClipMaxSpacing } = tabClipGemometry();
      polyData.edges.forEach((edge, idx) => {
        const pointA = points[idx];
        const pointB = points[(idx + 1) % points.length];
        const nextEdgeIdx = (idx + 1) % points.length;
        const prevEdgeIdx = (idx - 1 + points.length) % points.length;
        const joinSide = edge.joinSide;
        const stableOrder = edge.stableOrder ?? "ab";
        const [stablePointA, stablePointB] =
          stableOrder === "ab" ? [pointA, pointB] : [pointB, pointA];
        const distAB = dists[idx];
        const edgePerpendicularPlane = planes[idx];
        // 相邻两条边的刀具用于裁剪当前边生成的几何体。
        //
        // 多边形语境下，如果当前边在某个共享顶点处是阴角（>180），
        // 则该顶点对应的"相邻边裁剪刀具"需要反向。
        // - 当前边终点(pointB)对应 nextEdgeIdx
        // - 当前边起点(pointA)对应 prevEdgeIdx
        const pointAReflex = (getPolygonPointAngle(pointA) ?? 0) > 180 + 1e-6;
        const pointBReflex = (getPolygonPointAngle(pointB) ?? 0) > 180 + 1e-6;
        const adjEdgeCutToolL = pointBReflex ? edgeCutToolsReversed[nextEdgeIdx] : edgeCutTools[nextEdgeIdx];
        const adjEdgeCutToolR = pointAReflex ? edgeCutToolsReversed[prevEdgeIdx] : edgeCutTools[prevEdgeIdx];
        if ((!edge.isOuter && edge.angle > 180) || edge.angle < 180) {
          // 第二步：生成弯折、拼接坡度刀具
          // 坡度的起始z高度，如果不是叠色模式，则以"尽量减少接缝"为目标；如果是叠色模式，则以"尽量不裁剪叠色区域"为目标
          const slopeStartZ = (mode !== "lumina" && edge.isOuter) ? layerHeight : connectionThickness;
          const slopeZDelta = slopToolHeight - slopeStartZ;
            // 这是数学上的标准偏移
          const mathmaticalTopOffset = slopeZDelta * Math.tan(degToRad(90 - edge.angle / 2));
          const excessiveBend = 6;
          const slopeTopOffset = Math.max(mathmaticalTopOffset, minDistance / 2)
            // 这是超量弯折需要的额外偏移量（为什么需要超量弯折？因为打印机因流量校准等因素不可能生产出绝对符合数学模型的尺寸，且装配中超量弯折会有帮助）
            + (edge.isOuter ? 0 : (slopeZDelta * Math.tan(degToRad(excessiveBend / 2 + 90 - edge.angle / 2)) - mathmaticalTopOffset));
          // 需要确保斜坡首层（layerHeight/2处）的最小间距，以保证两边的斜坡的首层不融合
          // 切片软甲中的"切片间隙闭合半径"需要设置得尽量小以减少该问题，但仍然需要从数据上保证间距
          // 注意这里公式求得的是确保首层的偏移为minDistance / 2时的坡底偏移
          const slopeFirstLayerOffset = 1e-4 + Math.max(0, slopeTopOffset - slopeZDelta * (slopeTopOffset - minDistance / 2) / (slopeZDelta - layerHeight / 2));

          const slopeToolBase = extrudeFromContourPoints(edge.isOuter ? [
              [0,slopeStartZ],
              [0, slopToolHeight], [-slopeTopOffset, slopToolHeight],
            ] : [
              [-slopeFirstLayerOffset, slopeStartZ], [0,slopeStartZ],
              [0, slopToolHeight], [-slopeTopOffset, slopToolHeight]],
            edgePerpendicularPlane, -cutToolMargin, distAB + 2 * cutToolMargin);
          if (!slopeToolBase) {
            reportReplicadIssue(onLog, REPLICAD_LOG_CODES.slopeSketchFail, { edge });
            return;
          }
          // 超量挤出了坡度刀具并切掉两头超出的部分，以更好地应付钝角
          const slopeTool = slopeToolBase.cut(adjEdgeCutToolL.clone()).cut(adjEdgeCutToolR.clone()).simplify();
          if (!slopeTool) {
            reportReplicadIssue(onLog, REPLICAD_LOG_CODES.slopeToolFail, { edge });
            return;
          }
          slopeTools.push(slopeTool);
        }
        if (edge.isSeam) {
          // 构建卡扣类型的拼接边舌片
          const buildSeamTab = (): Shape3D | null => {
            const tabClipGrooveClearance = 0.1;
            // 设置的舌片宽度过小时不创建舌片
            if (tabWidth < bodyThickness + connectionThickness) return null;
            // 第三步：生成舌片
            const tabAngleA = edge.tabAngle[0];
            const tabAngleB = edge.tabAngle[1];
            const tabPointByAngle = buildTriangleByEdgeAndAngles(pointA, pointB, degToRad(tabAngleA), degToRad(tabAngleB));
            if (!tabPointByAngle) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabPointFallback, { edge });
            }
            const tabPoint = tabPointByAngle ?? calculateIsoscelesRightTriangle(pointA, pointB)[0];
            const distAP = Math.hypot(tabPoint[0] - pointA[0], tabPoint[1] - pointA[1]);
            const distBP = Math.hypot(tabPoint[0] - pointB[0], tabPoint[1] - pointB[1]);

            // 根据舌片宽度裁剪舌片三角形求出梯形
            // 首先求得实际舌片宽度，因为实际宽度需要根据二面角做调整，以保证连接槽的高度一致
            const tabAngle = 180 - edge.angle / 2;
            const tabClipWingExtrWidth = tabAngle < 90 ? 0 : tabClipWingThickness * Math.tan(degToRad(tabAngle - 90));
            const tabExtraWidth = tabAngle < 90 ? (bodyThickness + connectionThickness - layerHeight) * Math.sin(degToRad(tabAngle))
              : (bodyThickness + connectionThickness - layerHeight) / Math.cos(degToRad(tabAngle - 90))
              + tabThickness * Math.tan(degToRad(tabAngle - 90)) + tabClipWingExtrWidth;
            const tabTrapezoid = trapezoid(pointA, pointB, tabPoint, tabWidth + tabExtraWidth);
            const isTriangleTab = tabTrapezoid.length === 3;
            const tabLength = isTriangleTab ? 0 : Math.hypot(tabTrapezoid[2][0] - tabTrapezoid[3][0], tabTrapezoid[2][1] - tabTrapezoid[3][1]);
            const tabClipNum = 
              isTriangleTab || tabLength < 4 * tabClipMinSpacing  ? 1
              : tabLength < 7 * tabClipMinSpacing ? 2 
              : tabLength < 10 * tabClipMinSpacing ? 3
              : tabLength < 14 * tabClipMinSpacing ? 4
              : Math.max(5, Math.floor(tabLength / tabClipMaxSpacing));
            // console.log(`[ReplicadModeling] tab clip num for edge`, { tabLength, tabClipNum });
            const tabClipSpacing = tabClipNum === 1 ? 0 : (tabLength - tabClipWingLength * 3) / (tabClipNum - 1);
            const tabMiddlePoint = isTriangleTab ? tabPoint : [
              (tabTrapezoid[2][0] + tabTrapezoid[3][0]) / 2,
              (tabTrapezoid[2][1] + tabTrapezoid[3][1]) / 2,
            ] as Point2D;

            // 向下延伸一点点以确保舌片和主体连接良好
            if (edge.angle > 180) {
              const pointA_Incenter_extend: Point2D = [
                tabPoint[0] + (pointA[0] - tabPoint[0]) * (tabExtendMargin + distAP) / distAP,
                tabPoint[1] + (pointA[1] - tabPoint[1]) * (tabExtendMargin + distAP) / distAP];
              const pointB_Incenter_extend: Point2D = [
                tabPoint[0] + (pointB[0] - tabPoint[0]) * (tabExtendMargin + distBP) / distBP,
                tabPoint[1] + (pointB[1] - tabPoint[1]) * (tabExtendMargin + distBP) / distBP];
              tabTrapezoid[0] = pointA_Incenter_extend;
              tabTrapezoid[1] = pointB_Incenter_extend;
            }
            // 如果是非lumina模式，舌片从layerHeight处开始挤出，因为需要确保超小角度时的首层面积符合三角形面积
            // 如果是lumina模式，舌片从connectionThickness处开始挤出，因为需要确保和叠色层对齐
            const tabStartZ = mode === "lumina" ? connectionThickness: layerHeight;
            const tabSolidBase = extrudeFromContourPoints(tabTrapezoid, "XY", tabStartZ, tabThickness);
            if (!tabSolidBase) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabSketchFail, { edge });
              return null;
            }
            let tabSolid = tabSolidBase;
            // 为舌片卡子切割连接槽
            // 先创建挖槽工具
            const tabActualWidth = pointLineDistance2D(tabMiddlePoint, pointA, pointB);
            const grooveDepth = tabActualWidth - tabExtraWidth + tabClipWingExtrWidth;
            // 舌片宽度达不到挖槽要求则不挖槽
            if (grooveDepth < 1e-1) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabGrooveTooNarrow, { edge, grooveDepth });
            }
            else {
              const tabClipGroovingPlane = new Plane(tabMiddlePoint, [(pointA[0]-pointB[0]) / distAB, (pointA[1]-pointB[1]) / distAB, 0], [0, 0, 1]);
              const tabClipGroovingSketch = new Sketcher(tabClipGroovingPlane)
                .movePointerTo([-1.5 * tabClipKeelThickness / 2 - tabClipGrooveClearance, 0])
                .lineTo([-tabClipKeelThickness / 2 - tabClipGrooveClearance, -1.5 * tabClipKeelThickness / 2])
                .lineTo([-tabClipKeelThickness / 2 - tabClipGrooveClearance, -grooveDepth + 1e-4])
                .lineTo([tabClipKeelThickness / 2 + tabClipGrooveClearance, -grooveDepth + 1e-4])
                .lineTo([tabClipKeelThickness / 2 + tabClipGrooveClearance, -1.5 * tabClipKeelThickness / 2])
                .lineTo([1.5 * tabClipKeelThickness / 2 + tabClipGrooveClearance, 0])
                .close();
              if (!tabClipGroovingSketch) {
                reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabGrooveSketchFail, { edge });
              }
              else {
                if (grooveDepth < tabWidth + tabClipWingExtrWidth - 1e-6) {
                  reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabGrooveMayLoose, { edge, grooveDepth });
                }
                const tabClipGroovingTool = tabClipGroovingSketch.extrude(tabThickness + 2 * layerHeight);
                const dirAB = [(pointA[0] - pointB[0]) / distAB, (pointA[1] - pointB[1]) / distAB];
                for (let clipIdx = 0; clipIdx < tabClipNum; clipIdx++) {
                  const distance2MiddlePoint = (-0.5 * tabClipNum +clipIdx + 0.5) * tabClipSpacing;
                  tabSolid = tabSolid.cut(tabClipGroovingTool.clone().translate(dirAB[0] * distance2MiddlePoint, dirAB[1] * distance2MiddlePoint, 0)).simplify();
                }
                tabClipGroovingTool.delete();
              }
            }

            // 舌片外侧上沿做一个倒角方便卡子安装
            const tabChamferTool = extrudeFromContourPoints([
              [tabActualWidth + 1e-4, tabThickness + tabStartZ - tabChamferSize],
              [tabActualWidth + 1e-4, tabThickness + tabStartZ + 1e-4],
              [tabActualWidth - tabChamferSize * Math.tan(Math.PI / 4), tabThickness + tabStartZ + 1e-4],
            ], edgePerpendicularPlane, -1, distAB);

            // 防脱卡扣结构
            const antiSlipClipDepth = antiSlipClip === "off" ? 0 : (antiSlipClip === "weak" ? 0.1: 0.15);
            const tabAntiSlipTool = antiSlipClip === "off" ? null : extrudeFromContourPoints([
              [0, tabThickness + tabStartZ + 1 - antiSlipClipDepth],
              [0, tabThickness + tabStartZ - antiSlipClipDepth],
              [tabActualWidth - 0.75 * tabWidth, tabThickness + tabStartZ - antiSlipClipDepth],
              [tabActualWidth - 0.75 * tabWidth + 1 * Math.tan(Math.PI / 4), tabThickness + tabStartZ + 1 - antiSlipClipDepth],
            ], edgePerpendicularPlane, -1, distAB);

            // 舌片两端也做倒角防止从一个顶点触发的拼接边舌片之间的干涉
            const tabEndChamferSolid = extrudeFromContourPoints([
              [ 0, tabThickness + tabStartZ - tabChamferSize],
              [ 0, tabThickness + tabStartZ + 1e-1],
              [ -tabThickness, tabThickness + tabStartZ + 1e-1],
            ], edgePerpendicularPlane, -tabExtendMargin, distAB + 2 * tabExtendMargin);
            if (!tabChamferTool || !tabEndChamferSolid || (antiSlipClip !== "off" && !tabAntiSlipTool)) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabChamferFail, { edge });
            } else {
              if (antiSlipClip !== "off" && tabAntiSlipTool) tabSolid = tabSolid.cut(tabAntiSlipTool);
              tabSolid = tabSolid.cut(tabChamferTool).simplify();
              tabSolid = tabSolid.cut(tabEndChamferSolid.clone().rotate(-tabAngleA, [pointA[0], pointA[1], 0], [0,0,1])).simplify();
              tabSolid = tabSolid.cut(tabEndChamferSolid.rotate(tabAngleB, [pointB[0], pointB[1], 0], [0,0,1])).simplify();
            }
            tabSolid = tabSolid.rotate(tabAngle,
              [pointA[0], pointA[1], tabStartZ],
              [pointA[0] - pointB[0], pointA[1] - pointB[1], 0]);

            const tabCutTools: Shape3D[] = [adjEdgeCutToolL.clone(), adjEdgeCutToolR.clone()];
            // 向外翻的舌片可能需要根据外轮廓顶点角度进行相邻外轮廓舌片防干涉的裁剪
            if (edge.angle > 180) {
              const pointAKey = pointKey(pointA);
              const pointBKey = pointKey(pointB);
              const pointAAngle = validOuterResult.outerPointAngleMap.get(pointAKey);
              const pointBAngle = validOuterResult.outerPointAngleMap.get(pointBKey);
              // console.log('[ReplicadModeling] edge info for tab', { pointAAngle, pointBAngle });
              // 只有拼接边与拼接边相邻，且拼接边与拼接边相邻的顶点角度小于180度（阴角）时才需要进行防干涉
              if (pointAAngle && pointAAngle > 180) {
                // console.log('[ReplicadModeling] edge info for tab anti-interference', { pointAAngle });
                const tabAntiInterferenceTool = extrudeFromContourPoints(
                  [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
                  edgePerpendicularPlane.clone(), distAB + cutToolMargin, -(minDistance / 2 + cutToolMargin));
                if (tabAntiInterferenceTool) {
                  tabCutTools.push(tabAntiInterferenceTool
                    .rotate((pointAAngle - 180) / 2, [pointA[0], pointA[1], 0], [0,0,1]));
                }
              }
              if (pointBAngle && pointBAngle > 180) {
                // console.log('[ReplicadModeling] edge info for tab anti-interference', { pointBAngle });
                const tabAntiInterferenceTool = extrudeFromContourPoints(
                  [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
                  edgePerpendicularPlane.clone(), -cutToolMargin, minDistance / 2 + cutToolMargin);
                if (tabAntiInterferenceTool) {
                  tabCutTools.push(tabAntiInterferenceTool
                    .rotate(-(pointBAngle - 180) / 2, [pointB[0], pointB[1], 0], [0,0,1]));
                }
              }
            }
            tabCutTools.forEach((tool) => {
              if (tool) tabSolid = tabSolid.cut(tool).simplify();
            });
            return tabSolid;
          };
          // 构建互锁类型的拼接结构
          const buildInterlockingClaw = (): boolean => {
            const dirAB = [(pointA[0] - pointB[0]) / distAB, (pointA[1] - pointB[1]) / distAB];
            const clawCylinderWidth = clawWidth - 4 * clawFitGap;
            // 计算可用于放置爪的宽度和位置
            // 这里复用舌片计算逻辑，根据两端防干涉角度算出三角形->梯形->宽度和位置
            // 这里可以比舌片的策略激进一些，因为爪大概率不会分布在拼接边的端点附近
            const tabAngleA = edge.tabAngle[0] + (edge.tabAngle[0] > 45 ? 0 : (45 - edge.tabAngle[0]) * 0.7);
            const tabAngleB = edge.tabAngle[1] + (edge.tabAngle[1] > 45 ? 0 : (45 - edge.tabAngle[1]) * 0.7);
            // console.log('[ReplicadModeling] tabAngleA, tabAngleB', { tabAngleA, tabAngleB }, edge.tabAngle);
            const tabPointByAngle = buildTriangleByEdgeAndAngles(
              pointA, pointB,
              degToRad(tabAngleA),
              degToRad(tabAngleB));
            if (!tabPointByAngle) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.tabPointFallback, { edge });
            }
            const tabPoint = tabPointByAngle ?? calculateIsoscelesRightTriangle(pointA, pointB)[0];
            const foot = footOfPerpendicularToSegmentLine(tabPoint, pointA, pointB)??[(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
            const triHeight = Math.hypot(foot[0] - tabPoint[0], foot[1] - tabPoint[1]);
            // 没有足够的位置生成爪子
            if (triHeight < clawTargetRadius) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.clawFail, { edge, triHeight, clawTargetRadius });
              return false;
            }
            // 爪的伸出角度最大为90度，所以对于大于90度的拼接边，需要补一个基座，并且回退爪的位置
            const clawIntersectionAngle =
            edge.angle < 90 ? edge.angle : 
            edge.angle < 180 ? 90 :
            edge.angle < 225+1e-3 ? 270 - edge.angle :
            360 - edge.angle;
            const baseOffsetAngle = (edge.angle - clawIntersectionAngle) / 2
            // 根据爪的伸出角度，计算爪的实际半径和互锁角度，以平衡各种角度拼接的限位力度
            // 伸出角度越小，半径越大（提供更高的限位力度）
            const idealClawRadius = 
              clawRadiusAdaptive === "on"
              ? (clawIntersectionAngle > 90 ? clawTargetRadius : clawTargetRadius * Math.sqrt(90 / clawIntersectionAngle))
              : clawTargetRadius;
            // 如果没有空间放置自适应后更大的爪子，就尝试放目标尺寸的爪子
            const actualClawRadius = Math.min(idealClawRadius, triHeight);
            // 半径越大，互锁角度越小（使安装难度一致）
            // 另外，如果拼接角度大于225，则爪会紧贴打印板打印，需要减少互锁角度，不然安装会十分困难
            const actualClawInterlockAngle = (edge.angle > 225 ? 0.8 : 1) * 
            (clawRadiusAdaptive === "on"
              ? (clawIntersectionAngle > 90 ? clawInterlockingAngle : clawInterlockingAngle / Math.sqrt(90 / clawIntersectionAngle))
              : clawInterlockingAngle);
            // console.log('[ReplicadModeling] edge.angle', edge.angle, 'baseOffsetAngle', baseOffsetAngle, 'clawIntersectionAngle', clawIntersectionAngle);
              
            // 根据爪半径裁剪三角形求出梯形
            const tabTrapezoid = trapezoid(pointA, pointB, tabPoint, actualClawRadius);
            // 没有足够的位置生成爪子
            if (tabTrapezoid.length === 3) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.clawFail, { edge, tabTrapezoid });
              return false;
            }
            const tabLength = Math.hypot(tabTrapezoid[2][0] - tabTrapezoid[3][0], tabTrapezoid[2][1] - tabTrapezoid[3][1]);
            // 没有足够的位置生成爪子
            if (tabLength < clawCylinderWidth) {
              reportReplicadIssue(onLog, REPLICAD_LOG_CODES.clawFail, { edge, tabLength, actualClawWidth: clawCylinderWidth });
              return false;
            }
            const clawDensityFactor = clawDensity === "low" ? 3.8 : clawDensity === "high" ? 2.5 : 3;
            const clawSetCount = Math.max(1, Math.floor(tabLength / (clawWidth * clawDensityFactor)));
            const distBFoot = Math.hypot(foot[0] - pointB[0], foot[1] - pointB[1]);
            const clawSetSpacing = tabLength / clawSetCount;
            const clawSetOffsets = Array.from({ length: clawSetCount }, (_, idx) => {
              return (idx - (clawSetCount - 1) / 2) * clawSetSpacing;
            });
            // 交替顺序按稳定端点方向定义，避免互拼边局部方向相反时偶数组出现同类型对位。
            const stableDir: Point2D = [
              stablePointB[0] - stablePointA[0],
              stablePointB[1] - stablePointA[1],
            ];
            const stableDirLen = Math.hypot(stableDir[0], stableDir[1]);
            const normalizedStableDir: Point2D =
              stableDirLen > 1e-8 ? [stableDir[0] / stableDirLen, stableDir[1] / stableDirLen] : [0, 0];
            const orderedClawPlacements = clawSetOffsets
              .map((offset) => {
                const clawCenter: Point2D = [foot[0] + dirAB[0] * offset, foot[1] + dirAB[1] * offset];
                const projectionOnStableDir =
                  (clawCenter[0] - stablePointA[0]) * normalizedStableDir[0] +
                  (clawCenter[1] - stablePointA[1]) * normalizedStableDir[1];
                return { offset, projectionOnStableDir };
              })
              .sort((a, b) => a.projectionOnStableDir - b.projectionOnStableDir);
            const clawExtrudePlane = transformPlaneLocal(edgePerpendicularPlane, { offset: 
              edge.angle < 225+1e-3 ? [
                (edge.angle < 180 ? bodyThickness : (bodyThickness + connectionThickness)) * -Math.tan(degToRad(90 - edge.angle / 2)),
                connectionThickness + bodyThickness, distBFoot - clawCylinderWidth / 2
              ] :
              [0, 0, distBFoot - clawCylinderWidth / 2]
            });
            const clawShapeSketcher = new Sketcher(clawExtrudePlane.clone());
            clawShapeSketcher.movePointerTo([0, 0]);
            const arcStartPoint: Point2D = [
              -actualClawRadius * Math.cos(degToRad(baseOffsetAngle)),
              actualClawRadius * Math.sin(degToRad(baseOffsetAngle))
            ];
            clawShapeSketcher.lineTo(arcStartPoint);
            arcByCenterStartAngleSafe(clawShapeSketcher, [0,0], arcStartPoint, -clawIntersectionAngle);
            const clawBaseCylinder = clawShapeSketcher.close().extrude(clawCylinderWidth);

            // 分割圆柱体，平面数组顺序必须从底到上
            const splitCylinder = (cylinder: Shape3D, planes: Plane[]): Shape3D[] => {
              const parts: Shape3D[] = [];
              let c = cylinder;
              planes.forEach(p => {
                const splitResult = splitSolidByPlane(c, p);
                parts.push(splitResult[1]);
                c = splitResult[0];
              })
              parts.push(c);
              return parts;
            }
            
            const typeAAngle = 180 - clawIntersectionAngle - baseOffsetAngle;
            const typeBAngle = typeAAngle + clawIntersectionAngle;
            // console.log('[ReplicadModeling] typeAAngle', typeAAngle, 'typeBAngle', typeBAngle);
            // 四个平面分割为五个爪
            const splitPlanes: Plane[] = [];
            const planeA_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawCylinderWidth * 1 / 5], rotateAround: "z", angle: typeAAngle });
            const planeA = transformPlaneLocal(planeA_, { rotateAround: "x", angle: actualClawInterlockAngle });
            planeA_.delete();
            const planeB_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawCylinderWidth * 2 / 5], rotateAround: "z", angle: typeBAngle });
            const planeB = transformPlaneLocal(planeB_, { rotateAround: "x", angle: -actualClawInterlockAngle });
            planeB_.delete();
            const planeC_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawCylinderWidth * 3 / 5], rotateAround: "z", angle: typeAAngle });
            const planeC = transformPlaneLocal(planeC_, { rotateAround: "x", angle: actualClawInterlockAngle });
            planeC_.delete();
            const planeD_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawCylinderWidth * 4 / 5], rotateAround: "z", angle: typeBAngle });
            const planeD = transformPlaneLocal(planeD_, { rotateAround: "x", angle: -actualClawInterlockAngle });
            planeD_.delete();
            const claws = splitCylinder(clawBaseCylinder, [planeA, planeB, planeC, planeD]);
            // 在这里需要把各个指头移动以使他们的间距满足clawFitGap
            const mpClaw = claws[0].translate(dirAB[0] * 2 * -clawFitGap, dirAB[1] * 2 * -clawFitGap, 0).fuse(claws[2])
              .fuse(claws[4].translate(dirAB[0] * 2 * clawFitGap, dirAB[1] * 2 * clawFitGap, 0))
              .rotate(180, clawExtrudePlane.origin, [0,0,1])
              .rotate(180 - 2 * baseOffsetAngle - clawIntersectionAngle, clawExtrudePlane.origin, clawExtrudePlane.zDir)
              .translate(dirAB[0] * clawCylinderWidth, dirAB[1] * clawCylinderWidth, 0);
            const fpClaw = claws[1].translate(dirAB[0] * -clawFitGap, dirAB[1] * -clawFitGap, 0)
              .fuse(claws[3].translate(dirAB[0] * clawFitGap, dirAB[1] * clawFitGap, 0));
            const primaryClawTemplate = joinSide === "mp" ? mpClaw : fpClaw;
            const secondaryClawTemplate = joinSide === "mp" ? fpClaw : mpClaw;
            orderedClawPlacements.forEach(({ offset }, clawIdx) => {
              const clawTemplate = clawIdx % 2 === 0 ? primaryClawTemplate : secondaryClawTemplate;
              const placedClaw = clawTemplate.clone().translate(dirAB[0] * offset, dirAB[1] * offset, 0);
              if (interlockingClaws.length === 0) interlockingClaws.push(placedClaw);
              else interlockingClaws[0] = interlockingClaws[0].fuse(placedClaw);
            });
            // 补基座
            if (edge.angle > 90) {
              const clawBaseSketcher = new Sketcher(clawExtrudePlane);
              clawBaseSketcher.movePointerTo([0, 0]);
              if (edge.angle < 225+1e-3) {
                clawBaseSketcher.lineTo([
                  (edge.angle < 180 ? bodyThickness : (bodyThickness + connectionThickness)) * Math.tan(degToRad(90 - edge.angle / 2)),
                  - bodyThickness - connectionThickness
                ]);
              }
              clawBaseSketcher.lineTo([-actualClawRadius, 0]);
              if (baseOffsetAngle < 90) {
                arcByCenterStartAngleSafe(clawBaseSketcher, [0,0], [-actualClawRadius, 0], -baseOffsetAngle);
              } else {
                // 基座太大的时候，只构造一个四边形而不是圆弧以节省材料
                clawBaseSketcher.lineTo([
                  -actualClawRadius * Math.cos(degToRad(baseOffsetAngle - (angleDegFromRadiusAndArcLength(actualClawRadius, 1)??0))),
                  actualClawRadius * Math.sin(degToRad(baseOffsetAngle - (angleDegFromRadiusAndArcLength(actualClawRadius, 1)??0)))
                ]);
                clawBaseSketcher.lineTo(arcStartPoint);
              }
              const clawBaseTemplate = clawBaseSketcher.close().extrude(clawWidth).translate(dirAB[0] * 2 * -clawFitGap, dirAB[1] * 2 * -clawFitGap, 0);
              clawSetOffsets.forEach((offset) => {
                const base = clawBaseTemplate.clone().translate(dirAB[0] * offset, dirAB[1] * offset, 0);
                interlockingClaws[0] = interlockingClaws[0].fuse(base);
              });
            }
            // 如果角度在225到270之间，则需要对body进行一些切割以让爪子通过
            if (edge.angle > 225 && edge.angle < 270) {
              const bodyCutTemplate = extrudeFromContourPoints([[0, 0], [0, bodyThickness + connectionThickness + 1], arcStartPoint], clawExtrudePlane, 0, clawWidth);
              if (bodyCutTemplate) {
                clawSetOffsets.forEach((offset) => {
                  const bodyCutSolid = bodyCutTemplate.clone().translate(dirAB[0] * offset, dirAB[1] * offset, 0);
                  connectionSolid = connectionSolid.cut(bodyCutSolid);
                });
              }
            }
            try {
              splitPlanes.forEach(p => p.delete());
              clawExtrudePlane.delete();
              claws.forEach(p => p.delete());
              mpClaw.delete();
              fpClaw.delete();
            } catch (e) { }
            return true;
          };
          // 如果边有连接类型数据，则采用边的连接类型，否则使用设置中的默认类型
          const targetJointType = edge.joinType === "default" ? joinType : edge.joinType;
          // 如果连接类型是clip或者连接类型是interlocking但生成爪子失败，则回退为生成卡扣用的连接舌片
          if (targetJointType === "clip" || !buildInterlockingClaw()) {
            const seamTabSolid = buildSeamTab();
            if (seamTabSolid) connectionSolid = connectionSolid.fuse(seamTabSolid).simplify();
          }
        }
      });
      edgeCutTools.forEach((tool) => tool.delete());
      edgeCutToolsReversed.forEach((tool) => tool.delete());
      planes.forEach((plane) => { if (plane) plane.delete(); });
      planesReversed.forEach((plane) => { if (plane) plane.delete(); });

      onProgress?.(Math.floor(2 + progressPerPolygon * (i + 1)));

      if (hollowStyle) {
          // 镂空
          const offsets = polyData.edges.map(e => {
            return (e.isOuter && !e.isSeam) ? wireframeThickness : (wireframeThickness / 2);
          });
          // 根据当前数据生产约束，镂空模式下输入应保持为三角形。
          // 这里仍加显式保护，避免后续改动破坏这个前提时静默产出错误结果。
          if (points.length !== 3) {
            reportReplicadIssue(onLog, REPLICAD_LOG_CODES.hollowNonTriangle, { polygon: polyData });
            return;
          }
          const triangleForHollow = [points[0], points[1], points[2]] as [Point2D, Point2D, Point2D];
          // console.log('[ReplicadModeling] offsetting triangle for hollow', { tri: triangleForHollow, offsets });
          const offsetResult = offsetTriangleSafe(triangleForHollow, offsets);
          if (!offsetResult.tri) {
            reportReplicadIssue(onLog, OFFSET_FAIL_CODE_MAP[offsetResult.reason!], {
              polygon: polyData,
              reason: offsetResult.reason,
            });
          }
          else
          {
            const voronoiCutTool = extrudeFromContourPoints(
              offsetResult.tri,
              "XY",
              -1,
              connectionThickness + bodyThickness + 1 + 1e-4,
            );
            if (voronoiCutTool)
              connectionSolid = connectionSolid.cut(voronoiCutTool).simplify();
          }
      }
    });

    if (!isOcctValid(connectionSolid)) {
      reportReplicadIssue(onLog, REPLICAD_LOG_CODES.invalidAfterTab);
    }
    
    onProgress?.(50);
    const progressPerSlope = 48 / slopeTools.length;
    // 第四步：应用坡度刀具
    slopeTools.forEach((tool, idx) => {
      connectionSolid = connectionSolid.cut(tool).simplify();
      onProgress?.(Math.floor(50 + progressPerSlope * (idx + 1)));
    });
    slopeTools.forEach((tool) => tool.delete());
    if (!isOcctValid(connectionSolid)) {
      reportReplicadIssue(onLog, REPLICAD_LOG_CODES.invalidAfterSlope);
    }
    if (interlockingClaws.length > 0) {
      connectionSolid = connectionSolid.fuse(interlockingClaws[0]).simplify();
    }

    onProgress?.(98);

    // 第五步，削平底部
    const margin = tabWidth + 1;
    const tool = makeBox(
      [validOuterResult.min[0] - margin, validOuterResult.min[1] - margin, -validOuterResult.maxEdgeLen - 1] as Point,
      [validOuterResult.max[0] + margin, validOuterResult.max[1] + margin, 0] as Point
    );
    connectionSolid = connectionSolid.cut(tool) as Shape3D;

    // 如果是为LuminaLayersTool生成的几何，则需要减去叠色模型所在的区域
    if (mode === "lumina") {
      console.log('[ReplicadModeling] cutting lumina layers solid');
      const luminaLayersSolid = extrudeFromContourPoints(validOuterResult.outer, "XY", 0, connectionThickness);
      if (!luminaLayersSolid) {
        throwReplicadIssue(onLog, REPLICAD_LOG_CODES.luminaCutFail, "Failed to build lumina exclusion solid");
      } else connectionSolid = connectionSolid.cut(luminaLayersSolid) as Shape3D;
    }
    connectionSolid = connectionSolid.simplify().mirror("XY").rotate(180, [0, 0, 0], [0, 1, 0])
    onProgress?.(100);
    if (!isOcctValid(connectionSolid)) {
      reportReplicadIssue(onLog, REPLICAD_LOG_CODES.invalidFinal);
    }
    // console.log('[ReplicadModeling] final solid', connectionSolid);
    return { solid: connectionSolid };
  }
  finally {
    cleanup();
  }
};

export const buildTabClip = async () => {
  await ensureReplicadOC();
  const { tabThickness, tabWidth, antiSlipClip } = getSettings();
  const { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, clipGap } = tabClipGemometry();
  const keelChamferSize = Math.min(tabClipKeelThickness / 2, 0.5);
  const wingChamferSize = Math.max(tabClipWingThickness - 0.5, 1e-2);
  const antiSlipClipDepth = antiSlipClip === "off" ? 0 : (antiSlipClip === "weak" ? 0.1: 0.15);
  const tabClipSolidKeel = extrudeFromContourPoints([
    [0, 0],
    [tabClipKeelThickness / 2, 0],
    [tabClipKeelThickness / 2, tabWidth - keelChamferSize],
    [tabClipKeelThickness / 2 - keelChamferSize, tabWidth],
    [0, tabWidth],
  ], "XZ", 0, -(tabClipWingThickness + tabThickness));

  const loftSketch1 = sketchFromContourPoints([
    [0, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2 - wingChamferSize, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2, tabThickness + tabClipWingThickness - wingChamferSize],
    [tabClipWingLength / 2, tabThickness + clipGap / 2],
    [tabClipKeelThickness / 2, tabThickness + clipGap],
    [0, tabThickness + clipGap],
  ], "XY", 0);

  const loftSketch2 = sketchFromContourPoints([
    [0, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2 - wingChamferSize, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2, tabThickness + tabClipWingThickness - wingChamferSize],
    [tabClipWingLength / 2, tabThickness + clipGap / 2],
    [tabClipKeelThickness / 2, tabThickness + clipGap],
    [0, tabThickness + clipGap],
  ], "XY", tabWidth * 0.75 - 0.1);

  const loftSketch3 = sketchFromContourPoints([
    [0, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2 - wingChamferSize, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2, tabThickness + tabClipWingThickness - wingChamferSize],
    [tabClipWingLength / 2, tabThickness + clipGap / 2 - antiSlipClipDepth],
    [tabClipKeelThickness / 2, tabThickness + clipGap - antiSlipClipDepth],
    [0, tabThickness + clipGap - antiSlipClipDepth],
  ], "XY", tabWidth * 0.75);

  const loftSketch4 = sketchFromContourPoints([
    [0, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2 - wingChamferSize, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2, tabThickness + tabClipWingThickness - wingChamferSize],
    [tabClipWingLength / 2, tabThickness + clipGap / 2 - antiSlipClipDepth],
    [tabClipKeelThickness / 2, tabThickness + clipGap - antiSlipClipDepth],
    [0, tabThickness + clipGap - antiSlipClipDepth],
  ], "XY", tabWidth);

  if (!loftSketch1 || !loftSketch2 || !loftSketch3 || !loftSketch4) {
    throw createReplicadError(REPLICAD_LOG_CODES.tabClipSketchFail, "Failed to build seam-clip sketch");
  }

  const tabClipSolidWing = loftSketch1?.loftWith([loftSketch2, loftSketch3, loftSketch4]);

  const tabClipWingChamferTool = extrudeFromContourPoints([
    [tabThickness + tabClipWingThickness + clipGap + 1e-4, tabWidth + 1e-4],
    [tabThickness + tabClipWingThickness + clipGap + 1e-4, tabWidth - wingChamferSize],
    [tabThickness + tabClipWingThickness + clipGap - wingChamferSize, tabWidth + 1e-4],
  ], "YZ", 0, tabClipWingLength / 2 + 1);
  if (!tabClipSolidKeel || !tabClipSolidWing || !tabClipWingChamferTool) {
    throw createReplicadError(REPLICAD_LOG_CODES.tabClipSketchFail, "Failed to build seam-clip sketch");
  }
  const tabClipSolidOneQuater = tabClipSolidKeel.fuse(tabClipSolidWing).cut(tabClipWingChamferTool).simplify();
  const tabClipSolidHalf = tabClipSolidOneQuater.fuse(tabClipSolidOneQuater.clone().mirror("YZ")).simplify();
  return tabClipSolidHalf.fuse(tabClipSolidHalf.clone().mirror("XZ")).simplify();
};

export const buildNegativeOutlineForLuminaLayers = async (
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (progress: number) => void,
  onLog?: (msg: string) => void,
) => {
  if (!polygonsWithAngles.length) return undefined;
  await ensureReplicadOC();
  onProgress?.(0);

  const outerResult  = polygons2Outer(polygonsWithAngles);
  if (!outerResult || !outerResult.outer || outerResult.outer.length < 3) {
    throwReplicadIssue(onLog, REPLICAD_LOG_CODES.negativeOuterFail, "Failed to resolve outer contour for negative outline");
  }
  const validOuterResult = outerResult!;

  const { luminaLayersTotalHeight } = getSettings();
  const offsetAmount = 1;
  let outerSolid: Shape3D | undefined;
  const progressPerPolygon = 90 / polygonsWithAngles.length;

  for (let index = 0; index < polygonsWithAngles.length; index += 1) {
    const polygon = polygonsWithAngles[index];
    if (polygon.points.length !== 3) {
      throwReplicadIssue(onLog, REPLICAD_LOG_CODES.negativeNonTriangle, `Negative outline expects triangles only at polygon index ${index}`);
    }
    const triangle = [polygon.points[0], polygon.points[1], polygon.points[2]] as [Point2D, Point2D, Point2D];
    const offsetResult = offsetTriangleSafe(
      triangle,
      [-offsetAmount, -offsetAmount, -offsetAmount],
      { requireInside: false }
    );
    if (!offsetResult.tri) {
      throwReplicadIssue(
        onLog,
        REPLICAD_LOG_CODES.negativeOffsetFail,
        `Failed to offset triangle ${index} for negative outline: ${offsetResult.reason}`,
        { polygonIndex: index, reason: offsetResult.reason },
      );
    }
    const offsetTriangle = offsetResult.tri!;
    const extrudedTriangle = extrudeFromContourPoints(offsetTriangle, "XY", 0, luminaLayersTotalHeight);
    if (!extrudedTriangle) {
      throwReplicadIssue(
        onLog,
        REPLICAD_LOG_CODES.negativeExtrudeTriangleFail,
        `Failed to extrude triangle ${index} for negative outline`,
        { polygonIndex: index },
      );
    }
    const validExtrudedTriangle = extrudedTriangle!;
    outerSolid = outerSolid ? outerSolid.fuse(validExtrudedTriangle).simplify() : validExtrudedTriangle;
    onProgress?.(Math.min(90, progressPerPolygon * (index + 1)));
  }
  const innerSolid = extrudeFromContourPoints(validOuterResult.outer, "XY", 0, luminaLayersTotalHeight);
  if (!outerSolid || !innerSolid) {
    throwReplicadIssue(onLog, REPLICAD_LOG_CODES.negativeExtrudeFail, "Failed to extrude negative outline solids");
  }
  const validOuterSolid = outerSolid!;
  const validInnerSolid = innerSolid!;
  onProgress?.(90);
  const resultSolid = validOuterSolid.cut(validInnerSolid).mirror("YZ").simplify();
  onProgress?.(100);
  return resultSolid;
}

export async function buildGroupStepFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
): Promise<Blob> {
  if (!polygonsWithAngles.length) {
    throwReplicadIssue(onLog, REPLICAD_LOG_CODES.noTriangles, "No unfolded polygons available for STEP export");
  }
  const { solid } = await buildSolidFromPolygonsWithAngles(polygonsWithAngles, onProgress, onLog);
  return solid.blobSTEP();
}

const buildMeshTolerance = 0.1;
const buildMeshAngularTolerance = 0.5;

export async function buildGroupStlFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  mode: "normal" | "lumina" = "normal",
): Promise<Blob> {
  if (!polygonsWithAngles.length) {
    throwReplicadIssue(onLog, REPLICAD_LOG_CODES.noTriangles, "No unfolded polygons available for STL export");
  }
  const { solid } = await buildSolidFromPolygonsWithAngles(polygonsWithAngles, onProgress, onLog, mode);
  return solid.blobSTL({ binary: true, tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });
}

export async function buildGroupMeshFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  mode: "normal" | "lumina" = "normal",
): Promise<{ mesh: Mesh }> {
  const { vertices, normals, triangles } = await buildGroupMeshDataFromPolygons(polygonsWithAngles, onProgress, onLog, mode);
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(vertices, 3);
  const normal = new Float32BufferAttribute(normals, 3);
  const indexArray =
    vertices.length / 3 > 65535
      ? new Uint32BufferAttribute(triangles, 1)
      : new Uint16BufferAttribute(triangles, 1);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setIndex(indexArray);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const expotMesh = new Mesh(geometry);
  expotMesh.name = "group_preview_mesh";
  return { mesh: expotMesh };
}

/**
 * 构建网格数据（不创建 Three.js 对象，用于 Worker 通信）
 */
export async function buildGroupMeshDataFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  mode: "normal" | "lumina" = "normal",
): Promise<{ vertices: Float32Array; normals: Float32Array; triangles: Uint16Array | Uint32Array }> {
  if (!polygonsWithAngles.length) {
    throwReplicadIssue(onLog, REPLICAD_LOG_CODES.noTriangles, "No unfolded polygons available for mesh generation");
  }
  const { solid } = await buildSolidFromPolygonsWithAngles(polygonsWithAngles, onProgress, onLog, mode);
  const mesh = solid.mesh({ tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });

  const indexArray =
    mesh.vertices.length / 3 > 65535
      ? new Uint32Array(mesh.triangles)
      : new Uint16Array(mesh.triangles);

  return {
    vertices: new Float32Array(mesh.vertices),
    normals: new Float32Array(mesh.normals),
    triangles: indexArray,
  };
}
