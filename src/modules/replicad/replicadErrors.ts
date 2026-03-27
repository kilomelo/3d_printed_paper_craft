import { OffsetFailReason } from "../mathUtils";

export const REPLICAD_LOG_CODES = {
  outerFail: "log.replicad.outer.fail",
  connSketchFail: "log.replicad.connSketch.fail",
  connModelFail: "log.replicad.connModel.fail",
  edgePlaneFail: "log.replicad.edgePlane.fail",
  edgeSketchFail: "log.replicad.edgeSketch.fail",
  slopeSketchFail: "log.replicad.slopeSketch.fail",
  slopeToolFail: "log.replicad.slopeTool.fail",
  tabPointFallback: "log.replicad.tabPoint.fallback",
  tabSketchFail: "log.replicad.tabSketch.fail",
  tabGrooveTooNarrow: "log.replicad.tabGroove.tooNarrow",
  tabGrooveSketchFail: "log.replicad.tabGrooveSketch.fail",
  tabGrooveMayLoose: "log.replicad.tabGroove.mayLoose",
  tabChamferFail: "log.replicad.tabChamfer.fail",
  invalidAfterTab: "log.replicad.invalid.afterTab",
  invalidAfterSlope: "log.replicad.invalid.afterSlope",
  invalidFinal: "log.replicad.invalid.final",
  clawFail: "log.replicad.claw.fail",
  polygonInvalid: "log.replicad.polygon.invalid",
  hollowNonTriangle: "log.replicad.hollow.nonTriangle",
  offsetFailDegenerateInput: "log.replicad.offset.fail.degenerateInput",
  offsetFailParallelShiftedLines: "log.replicad.offset.fail.parallelShiftedLines",
  offsetFailDegenerateResult: "log.replicad.offset.fail.degenerateResult",
  offsetFailFlipped: "log.replicad.offset.fail.flipped",
  offsetFailOutsideOriginal: "log.replicad.offset.fail.outsideOriginal",
  offsetFailInfeasibleOffsets: "log.replicad.offset.fail.infeasibleOffsets",
  luminaCutFail: "log.replicad.lumina.cut.fail",
  noTriangles: "log.replicad.noTriangles",
  tabClipSketchFail: "log.replicad.tabClip.sketch.fail",
  negativeOuterFail: "log.replicad.negative.outer.fail",
  negativeNonTriangle: "log.replicad.negative.nonTriangle",
  negativeOffsetFail: "log.replicad.negative.offset.fail",
  negativeExtrudeTriangleFail: "log.replicad.negative.extrudeTriangle.fail",
  negativeExtrudeFail: "log.replicad.negative.extrude.fail",
} as const;

export const OFFSET_FAIL_CODE_MAP: Record<OffsetFailReason, string> = {
  DEGENERATE_INPUT: REPLICAD_LOG_CODES.offsetFailDegenerateInput,
  PARALLEL_SHIFTED_LINES: REPLICAD_LOG_CODES.offsetFailParallelShiftedLines,
  DEGENERATE_RESULT: REPLICAD_LOG_CODES.offsetFailDegenerateResult,
  FLIPPED: REPLICAD_LOG_CODES.offsetFailFlipped,
  OUTSIDE_ORIGINAL: REPLICAD_LOG_CODES.offsetFailOutsideOriginal,
  INFEASIBLE_OFFSETS: REPLICAD_LOG_CODES.offsetFailInfeasibleOffsets,
};

export const createReplicadError = (code: string, description: string) => {
  return new Error(`[${code}] ${description}`);
};

export const extractReplicadErrorCode = (input: unknown): string | undefined => {
  const message =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : undefined;
  if (!message) return undefined;
  const match = /^\[([^\]]+)\]/.exec(message);
  return match?.[1];
};

export class ReplicadWorkerError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ReplicadWorkerError";
    this.code = code;
  }
}
