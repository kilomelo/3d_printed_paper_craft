import {
  buildGroupStepFromPolygons,
  buildGroupStlFromPolygons,
} from "./replicadModeling";
import type { PolygonWithEdgeInfo } from "../../types/geometryTypes";
import { applySettings, type Settings } from "../settings";
import type { LogTone } from "../log";

type WorkerRequest =
  | { id: number; type: "step"; polygons: PolygonWithEdgeInfo[]; settings: Settings; lang?: string }
  | { id: number; type: "stl"; polygons: PolygonWithEdgeInfo[]; settings: Settings; lang?: string }
  | { id: number; type: "mesh"; polygons: PolygonWithEdgeInfo[]; settings: Settings; lang?: string };

type WorkerResponse =
  | { id: number; ok: true; type: "step"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "stl"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "mesh"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "progress"; message: number }
  | { id: number; ok: true; type: "log"; message: string; tone?: LogTone }
  | { id: number; ok: false; error: string };

/// <reference lib="webworker" />
const ctx: DedicatedWorkerGlobalScope = self as any;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, settings, lang } = event.data;
  try {
    // 这句话不能删除
    applySettings(settings);
    const report = (message: number) => ctx.postMessage({ id, ok: true, type: "progress", message } as WorkerResponse);
    const reportLog = (msg: string, tone: LogTone = "error") =>
      ctx.postMessage({ id, ok: true, type: "log", message: msg, tone } as WorkerResponse);
    if (type === "step") {
      const blob = await buildGroupStepFromPolygons(event.data.polygons, report, reportLog, lang);
      const buffer = await blob.arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "step", buffer, mime: "application/step" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    if (type === "stl") {
      const blob = await buildGroupStlFromPolygons(event.data.polygons, report, reportLog, lang);
      const buffer = await blob.arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "stl", buffer, mime: "model/stl" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    if (type === "mesh") {
      // 通过生成 STL，再由主线程解析为 mesh，减少重复建模路径
      const blob = await buildGroupStlFromPolygons(event.data.polygons, report, reportLog, lang);
      const buffer = await blob.arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "mesh", buffer, mime: "model/stl" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    ctx.postMessage({ id, ok: false, error: "Unknown task type" } as WorkerResponse);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) } as WorkerResponse);
  }
};
