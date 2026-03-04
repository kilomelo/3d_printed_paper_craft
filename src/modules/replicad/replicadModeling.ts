import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh, Shape } from "three";
import { localGC, setOC, getOC, Shape3D, makeBox, drawCircle, drawRectangle, Point, Plane, Sketcher } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, PolygonWithEdgeInfo } from "../../types/geometryTypes";
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
  extrudeCylinderAtPlaneLocalXY,
  translateWorldPointAlongPlaneAxes,
  transformPlaneLocal,
  splitSolidByPlane,
  arcByCenterStartAngleSafe,
} from "./replicadUtils";
import { t, initI18n, setLanguage } from "../i18n";

let i18nReady: Promise<void> | null = null;
let desiredLang: string | null = null;
export const setReplicadModelingLang = (lang: string) => {
  desiredLang = lang;
};
const ensureI18nReady = async (lang?: string) => {
  if (!i18nReady) i18nReady = initI18n();
  await i18nReady;
  const target = lang ?? desiredLang;
  if (target) {
    await setLanguage(target);
  }
};

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

// 构建卡口类型的拼接边舌片
const buildSeamTab = (edge: {
    isOuter: boolean;
    angle: number;
    isSeam?: boolean;
    tabAngle: number[];
    joinSide?: "mp" | "fp";
    stableOrder?: "ab" | "ba";
  }, pointA: Point2D, pointB: Point2D, distAB: number,
  connectionThickness: number, bodyThickness: number, layerHeight: number, tabWidth: number, tabThickness: number,
  tabClipKeelThickness: number, tabClipWingThickness: number, tabClipWingLength: number, tabClipMinSpacing: number, tabClipMaxSpacing: number,
  tabChamferSize: number, tabExtendMargin: number, cutToolMargin: number, minDistance: number,
  outerPointAngleMap: Map<string, number>,
  edgePerpendicularPlane: Plane, adjEdgeCutToolL: Shape3D, adjEdgeCutToolR: Shape3D,
  onLog?: (msg: string) => void
): Shape3D | null => {
  const tabClipGrooveClearance = 0.1;
  // 设置的舌片宽度过小时不创建舌片
  if (!edge.isSeam || tabWidth < bodyThickness + connectionThickness) return null;
  // 第三步：生成舌片
  const tabAngleA = edge.tabAngle[0];
  const tabAngleB = edge.tabAngle[1];
  const tabPointByAngle = buildTriangleByEdgeAndAngles(pointA, pointB, degToRad(tabAngleA), degToRad(tabAngleB));
  if (!tabPointByAngle) {
    onLog?.(t("log.replicad.tabPoint.fallback"));
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
  // 舌片从layerHeight处开始挤出，因为需要确保超小角度时的首层面积符合三角形面积
  const tabSolidBase = extrudeFromContourPoints(tabTrapezoid, "XY", layerHeight, tabThickness);
  if (!tabSolidBase) {
    onLog?.(t("log.replicad.tabSketch.fail"));
    console.warn('[ReplicadModeling] failed to create tab sketch for edge, skip this edge', edge);
    return null;
  }
  let tabSolid = tabSolidBase;
  // 为舌片卡子切割连接槽
  // 先创建挖槽工具
  const tabActualWidth = pointLineDistance2D(tabMiddlePoint, pointA, pointB);
  const grooveDepth = tabActualWidth - tabExtraWidth + tabClipWingExtrWidth;
  // 舌片宽度达不到挖槽要求则不挖槽
  if (grooveDepth < 1e-1) {
    onLog?.(t("log.replicad.tabGroove.tooNarrow"));
    console.warn('[ReplicadModeling] tab width is too narrow due to geometry constraint, skip this edge', edge);
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
      onLog?.(t("log.replicad.tabGrooveSketch.fail"));
      console.warn('[ReplicadModeling] failed to create tab clip grooving sketch for edge, skip this edge', edge);
    }
    else {
      if (grooveDepth < tabWidth + tabClipWingExtrWidth - 1e-6) {
        onLog?.(t("log.replicad.tabGroove.mayLoose"));
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
    [tabActualWidth + 1e-4, tabThickness + layerHeight - tabChamferSize],
    [tabActualWidth + 1e-4, tabThickness + layerHeight + 1e-4],
    [tabActualWidth - tabChamferSize * Math.tan(Math.PI / 4), tabThickness + layerHeight + 1e-4],
  ], edgePerpendicularPlane, -1, distAB);

  // 舌片两端也做倒角防止从一个顶点触发的拼接边舌片之间的干涉
  const tabEndChamferSolid = extrudeFromContourPoints([
    [ 0, tabThickness + layerHeight - tabChamferSize],
    [ 0, tabThickness + layerHeight + 1e-1],
    [ -tabThickness, tabThickness + layerHeight + 1e-1],
  ], edgePerpendicularPlane, -tabExtendMargin, distAB + 2 * tabExtendMargin);
  if (!tabChamferTool || !tabEndChamferSolid) {
    onLog?.(t("log.replicad.tabChamfer.fail"));
    console.warn('[ReplicadModeling] failed to create tab chamfer sketch for edge, skip chamfer', edge);
  } else {
    tabSolid = tabSolid.cut(tabChamferTool).simplify();
    tabSolid = tabSolid.cut(tabEndChamferSolid.clone().rotate(-tabAngleA, [pointA[0], pointA[1], 0], [0,0,1])).simplify();
    tabSolid = tabSolid.cut(tabEndChamferSolid.rotate(tabAngleB, [pointB[0], pointB[1], 0], [0,0,1])).simplify();
  }
  tabSolid = tabSolid.rotate(tabAngle, [pointA[0], pointA[1], layerHeight], [pointA[0] - pointB[0], pointA[1] - pointB[1], 0]);

  const tabCutTools: Shape3D[] = [adjEdgeCutToolL.clone(), adjEdgeCutToolR.clone()];
  // 向外翻的舌片可能需要根据外轮廓顶点角度进行相邻外轮廓舌片防干涉的裁剪
  if (edge.angle > 180) {
    const pointAKey = pointKey(pointA);
    const pointBKey = pointKey(pointB);
    const pointAAngle = outerPointAngleMap.get(pointAKey);
    const pointBAngle = outerPointAngleMap.get(pointBKey);
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
// 实际实行参数化建模的方法【核心逻辑】
// 这里已经从“按三角形输入”改为“按多边形输入”。
// 多边形的边按 points[i] -> points[(i + 1) % n] 解释。
// hollowStyle 开启时，生产端会退回为“三角形 polygon”，因此仍可复用现有镂空逻辑。
const buildSolidFromPolygonsWithAngles = async (
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (progress: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<{ solid: Shape3D }> => {
  const [gc, cleanup] = localGC();
  try {
    await ensureI18nReady(lang);
    onProgress?.(0);
    const {
      layerHeight,
      connectionLayers,
      bodyLayers,
      joinType,
      clawInterlockingAngle,
      clawTargetRadius,
      clawRadiusAdaptive,
      clawWidth,
      tabWidth,
      tabThickness,
      hollowStyle,
      wireframeThickness,
    } = getSettings();
    const bodyThickness = bodyLayers * layerHeight;
    const connectionThickness = connectionLayers * layerHeight;
    onProgress?.(1);
    await ensureReplicadOC();

    // 第一步：生成连接层和主体
    const outerResult  = polygons2Outer(polygonsWithAngles);
    if (!outerResult || !outerResult.outer || outerResult.outer.length < 3) {
      onLog?.(t("log.replicad.outer.fail"));
      throw new Error("外轮廓查找失败");
    }
    const connectionBase = extrudeFromContourPoints(
      outerResult.outer,
      "XY",
      -outerResult.maxEdgeLen,
      connectionThickness + bodyThickness + outerResult.maxEdgeLen,
    );
    if (!connectionBase) {
      onLog?.(t("log.replicad.connSketch.fail"));
      throw new Error("连接层草图生成失败");
    }
    let connectionSolid = connectionBase.simplify();
    if (!connectionSolid) {
      onLog?.(t("log.replicad.connModel.fail"));
      throw new Error("连接层建模失败");
    }
    onProgress?.(2);
    const progressPerPolygon = 48 / polygonsWithAngles.length;
    const tabCutToolMarginMin = tabWidth * 1.5;
    const slopToolHeight = 1e-3 + Math.hypot(tabWidth, tabThickness) + bodyThickness * 2 + connectionThickness + 1;
    const slopeTools: Shape3D[] = [];
    const vertexAngleMap = new Map<string, { position: Point2D; minAngle: number }>();
    // 生成的几何体的面最小间距
    const minDistance = 0.2 * connectionLayers;
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
        onLog?.(t("log.replicad.outer.fail"));
        console.warn("[ReplicadModeling] invalid polygon input, skip this polygon", polyData);
        return;
      }
      // 为每条边构造一个垂直切割平面。
      // 这里沿用旧三角形版本的约定：以边的反向向量作为平面法向。
      const planes = points.map((pointA, edgeIdx) => {
        const pointB = points[(edgeIdx + 1) % points.length];
        return makeVerticalPlaneNormalAB(pointB, pointA);
      });
      if (!planes.every(isDefined)) {
        onLog?.(t("log.replicad.edgePlane.fail"));
        console.warn("[ReplicadModeling] failed to create edge cutting planes for polygon, skip this polygon", polyData);
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
      if (!edgeCutTools.every(isDefined)) {
        onLog?.(t("log.replicad.edgeSketch.fail"));
        console.warn("[ReplicadModeling] failed to create edge cut tools for polygon, skip this polygon", polyData);
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
        // 这里不再依赖三角形专用的 pick()，直接按环索引取前后邻边。
        const adjEdgeCutToolL = edgeCutTools[nextEdgeIdx];
        const adjEdgeCutToolR = edgeCutTools[prevEdgeIdx];
        if ((!edge.isOuter && edge.angle > 180) || edge.angle < 180) {
          // 第二步：生成弯折、拼接坡度刀具
          const slopeStartZ = edge.isOuter ? layerHeight : connectionThickness;
          const slopeZDelta = slopToolHeight - slopeStartZ;
            // 这是数学上的标准偏移
          const mathmaticalTopOffset = slopeZDelta * Math.tan(degToRad(90 - edge.angle / 2));
          const excessiveBend = 6;
          const slopeTopOffset = Math.max(mathmaticalTopOffset, minDistance / 2)
            // 这是超量弯折需要的额外偏移量（为什么需要超量弯折？因为打印机因流量校准等因素不可能生产出绝对符合数学模型的尺寸，且装配中超量弯折会有帮助）
            + (edge.isOuter ? 0 : (slopeZDelta * Math.tan(degToRad(excessiveBend / 2 + 90 - edge.angle / 2)) - mathmaticalTopOffset));
          // 需要确保斜坡首层（layerHeight/2处）的最小间距，以保证两边的斜坡的首层不融合
          // 切片软甲中的“切片间隙闭合半径”需要设置得尽量小以减少该问题，但仍然需要从数据上保证间距
          // 注意这里公式求得的是确保首层的偏移为minDistance / 2时的坡底偏移
          const slopeFirstLayerOffset = 1e-4 + Math.max(0, slopeTopOffset - slopeZDelta * (slopeTopOffset - minDistance / 2) / (slopeZDelta - layerHeight / 2));

          const slopeToolBase = extrudeFromContourPoints(edge.isOuter ? [
              [0,slopeStartZ],
              [0, slopToolHeight], [-slopeTopOffset, slopToolHeight],
            ] : [
              [-slopeFirstLayerOffset, slopeStartZ], [0,slopeStartZ],
              [0, slopToolHeight], [-slopeTopOffset, slopToolHeight]],
            edgePerpendicularPlane, -cutToolMargin, distAB + cutToolMargin);
          if (!slopeToolBase) {
            onLog?.(t("log.replicad.slopeSketch.fail"));
            console.warn('[ReplicadModeling] failed to create slope tool sketch for edge, skip this edge', edge);
            return;
          }
          // 超量挤出了坡度刀具并切掉两头超出的部分，以更好地应付钝角
          const slopeTool = slopeToolBase.cut(adjEdgeCutToolL.clone()).cut(adjEdgeCutToolR.clone()).simplify();
          if (!slopeTool) {
            onLog?.(t("log.replicad.slopeTool.fail"));
            console.warn('[ReplicadModeling] failed to create slope tool for edge, skip this edge', edge);
            return;
          }
          slopeTools.push(slopeTool);
        }
        if (joinType === "clip") {
          const seamTabSolid = buildSeamTab(edge, pointA, pointB, distAB,
            connectionThickness, bodyThickness, layerHeight, tabWidth, tabThickness,
            tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, tabClipMinSpacing, tabClipMaxSpacing,
            tabChamferSize, tabExtendMargin, cutToolMargin, minDistance,
            outerResult.outerPointAngleMap, edgePerpendicularPlane, adjEdgeCutToolL, adjEdgeCutToolR,
            onLog,
          );
          if (seamTabSolid) connectionSolid = connectionSolid.fuse(seamTabSolid).simplify();
        }
        else if (joinType === "interlocking") {
          if (edge.isSeam) {
            const dirAB = [(pointA[0] - pointB[0]) / distAB, (pointA[1] - pointB[1]) / distAB];
            // 计算可用于放置爪的宽度和位置
            // 这里复用舌片计算逻辑，根据两端防干涉角度算出三角形->梯形->宽度和位置
            const tabAngleA = edge.tabAngle[0];
            const tabAngleB = edge.tabAngle[1];
            // 这里还需要考虑“窄缝”类型的外轮廓，这种情况需要把爪往外推
            const pointAKey = pointKey(pointA);
            const pointBKey = pointKey(pointB);
            const pointAAngle = outerResult.outerPointAngleMap.get(pointAKey)??360-2*tabAngleA;
            const pointBAngle = outerResult.outerPointAngleMap.get(pointBKey)??360-2*tabAngleB;
            const calcA = degToRad(Math.min(tabAngleA, 180-pointAAngle / 2));
            const calcB = degToRad(Math.min(tabAngleB, 180-pointBAngle / 2));
            console.log('[ReplicadModeling] edge info for tab', { pointAAngle, pointBAngle }, 'calc result', {calcA, calcB})
            // console.log('[ReplicadModeling] edge info for tab', { pointAAngle, pointBAngle });
            const tabPointByAngle = buildTriangleByEdgeAndAngles(
              pointA, pointB,
              degToRad(Math.min(tabAngleA, 180-pointAAngle / 2)),
              degToRad(Math.min(tabAngleB, 180-pointBAngle / 2)));
            if (!tabPointByAngle) {
              onLog?.(t("log.replicad.tabPoint.fallback"));
            }
            const tabPoint = tabPointByAngle ?? calculateIsoscelesRightTriangle(pointA, pointB)[0];
            const foot = footOfPerpendicularToSegmentLine(tabPoint, pointA, pointB)??[(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
            const triHeight = Math.hypot(foot[0] - tabPoint[0], foot[1] - tabPoint[1]);
            console.log('[ReplicadModeling] triHeight', { triHeight });
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
            const actualClawRadius = triHeight < clawTargetRadius ? clawTargetRadius : Math.min(idealClawRadius, triHeight);
            // 半径越大，互锁角度越小（使安装难度一致）
            // 另外，如果拼接角度大于225，则爪会紧贴打印板打印，需要减少互锁角度，不然安装会十分困难
            const actualClawInterlockAngle = (edge.angle > 225 ? 0.8 : 1) * 
            (clawRadiusAdaptive === "on"
              ? (clawIntersectionAngle > 90 ? clawInterlockingAngle : clawInterlockingAngle / Math.sqrt(90 / clawIntersectionAngle))
              : clawInterlockingAngle);
            console.log('[ReplicadModeling] edge.angle', edge.angle, 'baseOffsetAngle', baseOffsetAngle, 'clawIntersectionAngle', clawIntersectionAngle);
              
            // 根据爪半径裁剪三角形求出梯形
            const tabTrapezoid = trapezoid(pointA, pointB, tabPoint, actualClawRadius);
            const isTriangleTab = tabTrapezoid.length === 3;
            const tabLength = isTriangleTab ? 0 : Math.hypot(tabTrapezoid[2][0] - tabTrapezoid[3][0], tabTrapezoid[2][1] - tabTrapezoid[3][1]);
            
            const distBFoot = Math.hypot(foot[0] - pointB[0], foot[1] - pointB[1]);
            console.log('[ReplicadModeling] tabLength', tabLength, 'distBFoot', distBFoot, 'distBFoot / distAB', distBFoot / distAB);
            const clawExtrudePlane = transformPlaneLocal(edgePerpendicularPlane, { offset: 
              edge.angle < 225+1e-3 ? [
                (edge.angle < 180 ? bodyThickness : (bodyThickness + connectionThickness)) * -Math.tan(degToRad(90 - edge.angle / 2)),
                connectionThickness + bodyThickness, distBFoot - clawWidth / 2
              ] :
              [0, 0, distBFoot - clawWidth / 2]
            });
            const clawShapeSketcher = new Sketcher(clawExtrudePlane.clone());
            clawShapeSketcher.movePointerTo([0, 0]);
            const arcStartPoint: Point2D = [
              -actualClawRadius * Math.cos(degToRad(baseOffsetAngle)),
              actualClawRadius * Math.sin(degToRad(baseOffsetAngle))
            ];
            clawShapeSketcher.lineTo(arcStartPoint);
            arcByCenterStartAngleSafe(clawShapeSketcher, [0,0], arcStartPoint, -clawIntersectionAngle);
            const clawBaseCylinder = clawShapeSketcher.close().extrude(clawWidth);

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
            console.log('[ReplicadModeling] typeAAngle', typeAAngle, 'typeBAngle', typeBAngle);
            // 四个平面分割为五个爪
            const splitPlanes: Plane[] = [];
            const planeA_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawWidth * 1 / 5], rotateAround: "z", angle: typeAAngle });
            const planeA = transformPlaneLocal(planeA_, { rotateAround: "x", angle: actualClawInterlockAngle });
            planeA_.delete();
            const planeB_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawWidth * 2 / 5], rotateAround: "z", angle: typeBAngle });
            const planeB = transformPlaneLocal(planeB_, { rotateAround: "x", angle: -actualClawInterlockAngle });
            planeB_.delete();
            const planeC_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawWidth * 3 / 5], rotateAround: "z", angle: typeAAngle });
            const planeC = transformPlaneLocal(planeC_, { rotateAround: "x", angle: actualClawInterlockAngle });
            planeC_.delete();
            const planeD_ = transformPlaneLocal(clawExtrudePlane, { offset: [0, 0, clawWidth * 4 / 5], rotateAround: "z", angle: typeBAngle });
            const planeD = transformPlaneLocal(planeD_, { rotateAround: "x", angle: -actualClawInterlockAngle });
            planeD_.delete();
            const claws = splitCylinder(clawBaseCylinder, [planeA, planeB, planeC, planeD]);
            const mpClaw = claws[0].fuse(claws[2]).fuse(claws[4])
              .rotate(180, clawExtrudePlane.origin, [0,0,1])
              .rotate(180 - 2 * baseOffsetAngle - clawIntersectionAngle, clawExtrudePlane.origin, clawExtrudePlane.zDir)
              .translate(dirAB[0] * clawWidth, dirAB[1] * clawWidth, 0);
            const fpClaw = claws[1].fuse(claws[3]);
            if (interlockingClaws.length === 0) interlockingClaws.push(joinSide === "mp" ? mpClaw : fpClaw);
            else interlockingClaws[0] = interlockingClaws[0].fuse(joinSide === "mp" ? mpClaw : fpClaw);
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
              interlockingClaws[0] = interlockingClaws[0].fuse(clawBaseSketcher.close().extrude(clawWidth));
            }
            // 如果角度在225到270之间，则需要对body进行一些切割以让爪子通过
            if (edge.angle > 225 && edge.angle < 270) {
              const bodyCutSolid = extrudeFromContourPoints([[0, 0], [0, bodyThickness + connectionThickness + 1], arcStartPoint], clawExtrudePlane, 0, clawWidth);
              if (bodyCutSolid) connectionSolid = connectionSolid.cut(bodyCutSolid);
            }
            claws.forEach(p => p.delete());
            splitPlanes.forEach(p => p.delete());
            clawExtrudePlane.delete();
          }
        }
      });
      edgeCutTools.forEach((tool) => tool.delete());
      planes.forEach((plane) => { if (plane) plane.delete(); });

      onProgress?.(Math.floor(2 + progressPerPolygon * (i + 1)));

      if (hollowStyle) {
        const msg: Record<OffsetFailReason, string> = {
          DEGENERATE_INPUT: t("log.replicad.offset.reason.degenerateInput"),
          PARALLEL_SHIFTED_LINES: t("log.replicad.offset.reason.parallelShiftedLines"),
          DEGENERATE_RESULT: t("log.replicad.offset.reason.degenerateResult"),
          FLIPPED: t("log.replicad.offset.reason.flipped"),
          OUTSIDE_ORIGINAL: t("log.replicad.offset.reason.outsideOriginal"),
          INFEASIBLE_OFFSETS: t("log.replicad.offset.reason.infeasibleOffsets"),
        };
          // 镂空
          const offsets = polyData.edges.map(e => {
            return (e.isOuter && !e.isSeam) ? wireframeThickness : (wireframeThickness / 2);
          });
          // 根据当前数据生产约束，镂空模式下输入应保持为三角形。
          // 这里仍加显式保护，避免后续改动破坏这个前提时静默产出错误结果。
          if (points.length !== 3) {
            console.warn("[ReplicadModeling] hollow mode expects triangle polygons, skip this polygon", polyData);
            return;
          }
          const triangleForHollow = [points[0], points[1], points[2]] as [Point2D, Point2D, Point2D];
          // console.log('[ReplicadModeling] offsetting triangle for hollow', { tri: triangleForHollow, offsets });
          const offsetResult = offsetTriangleSafe(triangleForHollow, offsets);
          if (!offsetResult.tri) {
            onLog?.(t("log.replicad.offset.fail", { reason: msg[offsetResult.reason!] }));
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
      onLog?.(t("log.replicad.invalid.afterTab"));
      console.warn('[ReplicadModeling] after tab creation, solid is not valid OCCT shape');
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
      onLog?.(t("log.replicad.invalid.afterSlope"));
      console.warn('[ReplicadModeling] after applying slope tools, solid is not valid OCCT shape');
    }
    if (interlockingClaws.length > 0) {
      connectionSolid = connectionSolid.fuse(interlockingClaws[0]).simplify();
    }

    onProgress?.(98);

    // 第五步，削平底部
    const margin = tabWidth + 1;
    const tool = makeBox(
      [outerResult.min[0] - margin, outerResult.min[1] - margin, -outerResult.maxEdgeLen - 1] as Point,
      [outerResult.max[0] + margin, outerResult.max[1] + margin, 0] as Point
    );
    connectionSolid = connectionSolid.cut(tool) as Shape3D;
    connectionSolid = connectionSolid.simplify().mirror("XY").rotate(180, [0, 0, 0], [0, 1, 0])
    onProgress?.(100);
    if (!isOcctValid(connectionSolid)) {
      onLog?.(t("log.replicad.invalid.final"));
      console.warn('[ReplicadModeling] final solid is not valid OCCT shape');
    }
    return { solid: connectionSolid };
  }
  finally {
    cleanup();
  }
};

export const buildTabClip = async () => {
  await ensureReplicadOC();
  const { tabThickness, tabWidth } = getSettings();
  const { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, clipGap } = tabClipGemometry();
  const keelChamferSize = Math.min(tabClipKeelThickness / 2, 0.5);
  const wingChamferSize = Math.max(tabClipWingThickness - 0.5, 1e-2);
  const tabClipSolidKeel = extrudeFromContourPoints([
    [0, 0],
    [tabClipKeelThickness / 2, 0],
    [tabClipKeelThickness / 2, tabWidth - keelChamferSize],
    [tabClipKeelThickness / 2 - keelChamferSize, tabWidth],
    [0, tabWidth],
  ], "XZ", 0, -(tabClipWingThickness + tabThickness));
  const tabClipSolidWing = extrudeFromContourPoints([
    [0, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2 - wingChamferSize, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2, tabThickness + tabClipWingThickness - wingChamferSize],
    [tabClipWingLength / 2, tabThickness + clipGap / 2],
    [tabClipKeelThickness / 2, tabThickness + clipGap],
    [0, tabThickness + clipGap],
  ], "XY", 0, tabWidth);
  const tabClipWingChamferTool = extrudeFromContourPoints([
    [tabThickness + tabClipWingThickness + clipGap + 1e-4, tabWidth + 1e-4],
    [tabThickness + tabClipWingThickness + clipGap + 1e-4, tabWidth - wingChamferSize],
    [tabThickness + tabClipWingThickness + clipGap - wingChamferSize, tabWidth + 1e-4],
  ], "YZ", 0, tabClipWingLength / 2 + 1);
  if (!tabClipSolidKeel || !tabClipSolidWing || !tabClipWingChamferTool) {
    throw new Error("舌片卡子草图创建失败");
  }
  const tabClipSolidOneQuater = tabClipSolidKeel.fuse(tabClipSolidWing).cut(tabClipWingChamferTool).simplify();
  const tabClipSolidHalf = tabClipSolidOneQuater.fuse(tabClipSolidOneQuater.clone().mirror("YZ")).simplify();
  return tabClipSolidHalf.fuse(tabClipSolidHalf.clone().mirror("XZ")).simplify();
};

export async function buildGroupStepFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<Blob> {
  if (!polygonsWithAngles.length) {
    onLog?.(t("log.replicad.noTriangles"));
    throw new Error("没有可用于建模的展开面片");
  }
  const { solid } = await buildSolidFromPolygonsWithAngles(polygonsWithAngles, onProgress, onLog, lang);
  return solid.blobSTEP();
}

const buildMeshTolerance = 0.1;
const buildMeshAngularTolerance = 0.5;
export async function buildGroupStlFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<Blob> {
  if (!polygonsWithAngles.length) {
    onLog?.(t("log.replicad.noTriangles"));
    throw new Error("没有可用于建模的展开面片");
  }
  const { solid } = await buildSolidFromPolygonsWithAngles(polygonsWithAngles, onProgress, onLog, lang);
  return solid.blobSTL({ binary: true, tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });
}

export async function buildGroupMeshFromPolygons(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<{ mesh: Mesh }> {
  if (!polygonsWithAngles.length) {
    onLog?.(t("log.replicad.noTriangles"));
    throw new Error("没有可用于建模的展开面片");
  }
  const { solid } = await buildSolidFromPolygonsWithAngles(polygonsWithAngles, onProgress, onLog, lang);
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
  return { mesh: expotMesh };
}
