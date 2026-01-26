import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Mesh } from "three";
import { Shape3D, setOC, getOC, makeBox, sketchCircle, Point, Plane, Sketcher } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { Point2D, TriangleWithEdgeInfo } from "../../types/geometryTypes";
import { getSettings } from "../settings";
import {
  pointKey, radToDeg, degToRad,
  pointLineDistance2D, trapezoid, triangles2Outer, solveE, offsetTriangleSafe, OffsetFailReason, calculateIsoscelesRightTriangle,
  buildTriangleByEdgeAndAngles
} from "../mathUtils";
import {
  makeVerticalPlaneNormalAB,
  sketchFromContourPoints,
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


const isOcctValid = (shape: { wrapped: any }) => {
  const oc = getOC();

  // 你的 d.ts 要求 3 个参数：S, theGeomControls, theIsParallel
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);

  // 你的 d.ts 要求 IsValid_1(S)
  const ok = analyzer.IsValid_1(shape.wrapped);

  analyzer.delete?.();
  return ok;
};

const tabClipGemometry = () => {
  const { tabThickness, tabWidth, tabClipGap } = getSettings();
  // 舌片卡子相关定义
  const tabClipKeelThickness = 2 * tabThickness;
  const tabClipWingThickness = tabClipKeelThickness;
  const tabClipWingLength = Math.sqrt(tabClipWingThickness) * 5;
  const tabClipMinSpacing = tabClipWingLength + 1;
  const tabClipMaxSpacing = tabClipWingLength * 4 + tabWidth;
  return { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, tabClipMinSpacing, tabClipMaxSpacing, tabClipGap };
};

// 实际实行参数化建模的方法
const buildSolidFromTrianglesWithAngles = async (
  trianglesWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (progress: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<{ solid: Shape3D; tabClipNumTotal: number }> => {
  await ensureI18nReady(lang);
  onProgress?.(0);
  const { layerHeight, connectionLayers, bodyLayers, tabWidth, tabThickness, hollowStyle, wireframeThickness } = getSettings();
  const bodyThickness = bodyLayers * layerHeight;
  const connectionThickness = connectionLayers * layerHeight;
  onProgress?.(1);
  await ensureReplicadOC();
  // 第一步：生成连接层和主体
  const outerResult  = triangles2Outer(trianglesWithAngles);
  if (!outerResult || !outerResult.outer || outerResult.outer.length < 3) {
    onLog?.(t("log.replicad.outer.fail"));
    throw new Error("外轮廓查找失败");
  }
  const connectionSketch = sketchFromContourPoints(outerResult.outer, "XY", -outerResult.maxEdgeLen);
  if (!connectionSketch) {
    onLog?.(t("log.replicad.connSketch.fail"));
    throw new Error("连接层草图生成失败");
  }
  let connectionSolid = connectionSketch.extrude(connectionThickness + bodyThickness + outerResult.maxEdgeLen).simplify();
  if (!connectionSolid) {
    onLog?.(t("log.replicad.connModel.fail"));
    throw new Error("连接层建模失败");
  }
  onProgress?.(2);
  const progressPerTriangle = 48 / trianglesWithAngles.length;
  const tabCutToolMarginMin = tabWidth * 1.5;
  const slopToolHeight = 1e-3 + Math.hypot(tabWidth, tabThickness) + bodyThickness * 2 + connectionThickness + 1;
  const slopeTools: Shape3D[] = [];
  const vertexAngleMap = new Map<string, { position: Point2D; minAngle: number }>();
  // 生成的几何体的面最小间距
  const minDistance = 0.2 * connectionLayers;
  // 舌片外沿倒角
  const chamferSize = tabThickness - layerHeight;
  let tabClipNumTotal: number = 0;
  let booleanOperations: number = 0;
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
      onLog?.(t("log.replicad.edgePlane.fail"));
      console.warn('[ReplicadModeling] failed to create edge cutting planes for triangle, skip this triangle', triData);
      return;
    }
    const dists  = [Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), Math.hypot(p2[0] - p0[0], p2[1] - p0[1]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1])];
    // 准备每条边都要用到的辅助刀具
    const tabExtendMargin = Math.max(...dists);
    const cutToolMargin = Math.max(tabCutToolMarginMin, tabExtendMargin);
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
      onLog?.(t("log.replicad.edgeSketch.fail"));
      console.warn('[ReplicadModeling] failed to create edge cut tool sketches for triangle, skip this triangle', triData);
      return;
    }
    // 这个工具会用来裁剪掉舌片和坡度刀具超出三角形范围的部分
    const edgeCutTools = [
      edgeCutToolSketches[0].extrude(dists[0] + 2 * cutToolMargin),
      edgeCutToolSketches[1].extrude(dists[1] + 2 * cutToolMargin),
      edgeCutToolSketches[2].extrude(dists[2] + 2 * cutToolMargin),
    ];

    // 舌片卡子相关定义
    const { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, tabClipMinSpacing, tabClipMaxSpacing } = tabClipGemometry();
    const tabClipGrooveClearance = 0.1;
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
          onLog?.(t("log.replicad.slopeSketch.fail"));
          console.warn('[ReplicadModeling] failed to create slope tool sketch for edge, skip this edge', edge);
          return;
        }
        // 超量挤出了坡度刀具并切掉两头超出的部分，以更好地应付钝角
        const slopeTool = slopeToolSketch?.extrude(distAB + cutToolMargin).cut(adjEdgeCutToolL.clone()).cut(adjEdgeCutToolR.clone()).simplify();
        booleanOperations += 2;
        if (!slopeTool) {
          onLog?.(t("log.replicad.slopeTool.fail"));
          console.warn('[ReplicadModeling] failed to create slope tool for edge, skip this edge', edge);
          return;
        }
        slopeTools.push(slopeTool);
      }
      // 设置的舌片宽度过小时不创建舌片
      if (edge.isSeam && tabWidth > bodyThickness + connectionThickness) {
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
        const tabAngle = 180 - radToDeg(edge.angle / 2);
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
        tabClipNumTotal += tabClipNum;
        const tabClipSpacing = tabClipNum === 1 ? 0 : (tabLength - tabClipWingLength * 3) / (tabClipNum - 1);
        const tabMiddlePoint = isTriangleTab ? tabPoint : [
          (tabTrapezoid[2][0] + tabTrapezoid[3][0]) / 2,
          (tabTrapezoid[2][1] + tabTrapezoid[3][1]) / 2,
        ] as Point2D;

        // 向下延伸一点点以确保舌片和主体连接良好
        if (edge.angle > Math.PI) {
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
        const tabSolidSketch = sketchFromContourPoints(tabTrapezoid, "XY", layerHeight);
        if (!tabSolidSketch) {
          onLog?.(t("log.replicad.tabSketch.fail"));
          console.warn('[ReplicadModeling] failed to create tab sketch for edge, skip this edge', edge);
          return;
        }
        let tabSolid = tabSolidSketch.extrude(tabThickness);
        // 为舌片卡子切割连接槽
        // 先创建挖槽工具
        const tabActualWidth = pointLineDistance2D(tabMiddlePoint, pointA, pointB);
        const grooveDepth = tabActualWidth - tabExtraWidth + tabClipWingExtrWidth;
        // 舌片宽度因为内心限制达不到挖槽要求则不挖槽
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
              booleanOperations += 1;
            }
            tabClipGroovingTool.delete();
          }
        }
        // 舌片外侧上沿做一个倒角方便卡子安装
        const tabChamferSketch = sketchFromContourPoints([
          [tabActualWidth + 1e-4, tabThickness + layerHeight - chamferSize],
          [tabActualWidth + 1e-4, tabThickness + layerHeight + 1e-4],
          [tabActualWidth - chamferSize * Math.tan(Math.PI / 3), tabThickness + layerHeight + 1e-4],
        ], edgePerpendicularPlane, -1);
        // 舌片两端也做倒角防止从一个顶点触发的拼接边舌片之间的干涉
        const tabEndChamferSketch = sketchFromContourPoints([
          [ 0, tabThickness + layerHeight - chamferSize],
          [ 0, tabThickness + layerHeight + 1e-1],
          [ -tabThickness, tabThickness + layerHeight + 1e-1],
        ], edgePerpendicularPlane, -tabExtendMargin);
        if (!tabChamferSketch || !tabEndChamferSketch) {
          onLog?.(t("log.replicad.tabChamfer.fail"));
          console.warn('[ReplicadModeling] failed to create tab chamfer sketch for edge, skip chamfer', edge);
        } else {
          // const tabChamferTool = tabChamferSketch.extrude(distAB);
          // tabSolid = tabSolid.cut(tabChamferTool).simplify();
          // const tabEndChamferSolid = tabEndChamferSketch.extrude(distAB + 2 * tabExtendMargin);
          // tabSolid = tabSolid.cut(tabEndChamferSolid.clone().rotate(-tabAngleA, [pointA[0], pointA[1], 0], [0,0,1])).simplify();
          // tabSolid = tabSolid.cut(tabEndChamferSolid.rotate(tabAngleB, [pointB[0], pointB[1], 0], [0,0,1])).simplify();
          booleanOperations += 3;
        }

        tabSolid = tabSolid.rotate(tabAngle, [pointA[0], pointA[1], layerHeight], [pointA[0] - pointB[0], pointA[1] - pointB[1], 0]);

        const tabCutTools: Shape3D[] = [adjEdgeCutToolL.clone(), adjEdgeCutToolR.clone()];
        // 向外翻的舌片可能需要根据外轮廓顶点角度进行相邻外轮廓舌片防干涉的裁剪
        if (edge.angle > Math.PI) {
          const pointAKey = pointKey(pointA);
          const pointBKey = pointKey(pointB);
          const pointAAngle = outerResult.outerPointAngleMap.get(pointAKey);
          const pointBAngle = outerResult.outerPointAngleMap.get(pointBKey);
          // console.log('[ReplicadModeling] edge info for tab', { pointAAngle, pointBAngle });
          // 只有拼接边与拼接边相邻，且拼接边与拼接边相邻的顶点角度小于180度（阴角）时才需要进行防干涉
          if (pointAAngle && pointAAngle > 180) {
            // console.log('[ReplicadModeling] edge info for tab anti-interference', { pointAAngle });
            const tabAntiInterferenceSketch = sketchFromContourPoints(
              [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
              edgePerpendicularPlane.clone(), distAB + cutToolMargin);
            if (tabAntiInterferenceSketch) {
              tabCutTools.push(tabAntiInterferenceSketch.extrude(-(minDistance / 2 + cutToolMargin))
                .rotate((pointAAngle - 180) / 2, [pointA[0], pointA[1], 0], [0,0,1]));
            }
          }
          if (pointBAngle && pointBAngle > 180) {
            // console.log('[ReplicadModeling] edge info for tab anti-interference', { pointBAngle });
            const tabAntiInterferenceSketch = sketchFromContourPoints(
              [[0,-cutToolMargin], [0,cutToolMargin], [cutToolMargin,cutToolMargin], [cutToolMargin,-cutToolMargin]],
              edgePerpendicularPlane.clone(), -cutToolMargin);
            if (tabAntiInterferenceSketch) {
              tabCutTools.push(tabAntiInterferenceSketch.extrude(minDistance / 2 + cutToolMargin)
                .rotate(-(pointBAngle - 180) / 2, [pointB[0], pointB[1], 0], [0,0,1]));
            }
          }
        }
        tabCutTools.forEach((tool) => {
          if (tool) tabSolid = tabSolid.cut(tool).simplify();
        });
        connectionSolid = connectionSolid.fuse(tabSolid).simplify();
        booleanOperations += tabCutTools.length + 1;
      }
    });
    edgeCutTools.forEach((tool) => tool.delete());
    planes.forEach((plane) => { if (plane) plane.delete(); });

    onProgress?.(Math.floor(2 + progressPerTriangle * (i + 1)));

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
        const offsets = triData.edges.map(e => {
          return (e.isOuter && !e.isSeam) ? wireframeThickness : (wireframeThickness / 2);
        });
        // console.log('[ReplicadModeling] offsetting triangle for hollow', { tri: triData.tri, offsets });
        const offsetResult = offsetTriangleSafe(triData.tri, offsets);
        if (!offsetResult.tri) {
          onLog?.(t("log.replicad.offset.fail", { reason: msg[offsetResult.reason!] }));
        }
        else
        {
          const voronoiCutToolSketch = sketchFromContourPoints(offsetResult.tri, "XY", -1);
          if (voronoiCutToolSketch)
            connectionSolid = connectionSolid.cut(voronoiCutToolSketch.extrude(connectionThickness + bodyThickness + 1 + 1e-4)).simplify();
        }
        booleanOperations += 1;
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
    booleanOperations += 1;
  });
  slopeTools.forEach((tool) => tool.delete());
  if (!isOcctValid(connectionSolid)) {
    onLog?.(t("log.replicad.invalid.afterSlope"));
    console.warn('[ReplicadModeling] after applying slope tools, solid is not valid OCCT shape');
  }

  onProgress?.(98);

  // 第五步，削平底部
  const margin = tabWidth + 1;
  const tool = makeBox(
    [outerResult.min[0] - margin, outerResult.min[1] - margin, -outerResult.maxEdgeLen - 1] as Point,
    [outerResult.max[0] + margin, outerResult.max[1] + margin, 0] as Point
  );
  connectionSolid = connectionSolid.cut(tool) as Shape3D;
  booleanOperations += 1;
  connectionSolid = connectionSolid.simplify().mirror("XY").rotate(180, [0, 0, 0], [0, 1, 0])
  onProgress?.(100);
  if (!isOcctValid(connectionSolid)) {
    onLog?.(t("log.replicad.invalid.final"));
    console.warn('[ReplicadModeling] final solid is not valid OCCT shape');
  }
  // console.log(`[ReplicadModeling] buildSolidFromTrianglesWithAngles completed with ${booleanOperations} boolean operations`);
  return { solid: connectionSolid, tabClipNumTotal };
};

export const buildTabClip = async () => {
  await ensureReplicadOC();
  const { tabThickness, tabWidth } = getSettings();
  const { tabClipKeelThickness, tabClipWingThickness, tabClipWingLength, tabClipGap } = tabClipGemometry();
  const keelChamferSize = Math.min(tabClipKeelThickness / 2, 0.5);
  const wingChamferSize = Math.max(tabClipWingThickness - 0.5, 1e-2);
  const tabClipSketchKeel = sketchFromContourPoints([
    [0, 0],
    [tabClipKeelThickness / 2, 0],
    [tabClipKeelThickness / 2, tabWidth - keelChamferSize],
    [tabClipKeelThickness / 2 - keelChamferSize, tabWidth],
    [0, tabWidth],
  ], "XZ");
  const tabClipSketchWing = sketchFromContourPoints([
    [0, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2 - wingChamferSize, tabThickness + tabClipWingThickness],
    [tabClipWingLength / 2, tabThickness + tabClipWingThickness - wingChamferSize],
    [tabClipWingLength / 2, tabThickness + tabClipGap / 2],
    [tabClipKeelThickness / 2, tabThickness + tabClipGap],
    [0, tabThickness + tabClipGap],
  ], "XY");
  const tabClipSketchWingChamferYZ = sketchFromContourPoints([
    [tabThickness + tabClipWingThickness + tabClipGap + 1e-4, tabWidth + 1e-4],
    [tabThickness + tabClipWingThickness + tabClipGap + 1e-4, tabWidth - wingChamferSize],
    [tabThickness + tabClipWingThickness + tabClipGap - wingChamferSize, tabWidth + 1e-4],
  ], "YZ", 0);
  if (!tabClipSketchKeel || !tabClipSketchWing || !tabClipSketchWingChamferYZ) {
    throw new Error("舌片卡子草图创建失败");
  }
  const tabClipSolidOneQuater = tabClipSketchKeel.extrude(-(tabClipWingThickness + tabThickness))
    .fuse(tabClipSketchWing.extrude(tabWidth))
    .cut(tabClipSketchWingChamferYZ.extrude(tabClipWingLength / 2 + 1)).simplify();
  const tabClipSolidHalf = tabClipSolidOneQuater.fuse(tabClipSolidOneQuater.clone().mirror("YZ")).simplify();
  return tabClipSolidHalf.fuse(tabClipSolidHalf.clone().mirror("XZ")).simplify();
};

export async function buildGroupStepFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<{ blob: Blob; tabClipNumTotal: number }> {
  if (!trisWithAngles.length) {
    onLog?.(t("log.replicad.noTriangles"));
    throw new Error("没有可用于建模的展开三角形");
  }
  const { solid, tabClipNumTotal } = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress, onLog, lang);
  const blob = solid.blobSTEP();
  return { blob, tabClipNumTotal };
}

const buildMeshTolerance = 0.1;
const buildMeshAngularTolerance = 0.5;
export async function buildGroupStlFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<{ blob: Blob; tabClipNumTotal: number }> {
  if (!trisWithAngles.length) {
    onLog?.(t("log.replicad.noTriangles"));
    throw new Error("没有可用于建模的展开三角形");
  }
  const { solid, tabClipNumTotal } = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress, onLog, lang);
  const blob = solid.blobSTL({ binary: true, tolerance: buildMeshTolerance, angularTolerance: buildMeshAngularTolerance });
  return { blob, tabClipNumTotal };
}

export async function buildGroupMeshFromTriangles(
  trisWithAngles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
  lang?: string,
): Promise<{ mesh: Mesh; tabClipNumTotal: number }> {
  if (!trisWithAngles.length) {
    onLog?.(t("log.replicad.noTriangles"));
    throw new Error("没有可用于建模的展开三角形");
  }
  const { solid, tabClipNumTotal } = await buildSolidFromTrianglesWithAngles(trisWithAngles, onProgress, onLog, lang);
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
  return { mesh: expotMesh, tabClipNumTotal };
}
