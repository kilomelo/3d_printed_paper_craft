import {
  buildGroupStepFromPolygons,
  buildGroupStlFromPolygons,
  buildGroupMeshDataFromPolygons,
} from "./replicadModeling";
import type { PolygonWithEdgeInfo } from "../../types/geometryTypes";
import { applySettings, type Settings } from "../settings";
import type { LogTone } from "../log";

type WorkerRequest =
  | { id: number; type: "step"; polygons: PolygonWithEdgeInfo[]; settings: Settings; lang?: string; mode?: "normal" | "lumina" }
  | { id: number; type: "stl"; polygons: PolygonWithEdgeInfo[]; settings: Settings; lang?: string; mode?: "normal" | "lumina" }
  | { id: number; type: "mesh"; polygons: PolygonWithEdgeInfo[]; settings: Settings; lang?: string; mode?: "normal" | "lumina" };

type WorkerResponse =
  | { id: number; ok: true; type: "step"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "stl"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "mesh"; vertices: ArrayBuffer; normals: ArrayBuffer; triangles: ArrayBuffer; trianglesType: "uint16" | "uint32" }
  | { id: number; ok: true; type: "progress"; message: number }
  | { id: number; ok: true; type: "log"; message: string; tone?: LogTone }
  | { id: number; ok: false; error: string };

/// <reference lib="webworker" />
const ctx: DedicatedWorkerGlobalScope = self as any;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, settings, lang, mode } = event.data;
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
      const { vertices, normals, triangles } = await buildGroupMeshDataFromPolygons(
        event.data.polygons,
        report,
        reportLog,
        lang,
        mode
      );
      const resp = {
        id,
        ok: true,
        type: "mesh" as const,
        vertices: vertices.buffer,
        normals: normals.buffer,
        triangles: triangles.buffer,
        trianglesType: vertices.length / 3 > 65535 ? "uint32" as const : "uint16" as const,
      };
      ctx.postMessage(resp, [resp.vertices, resp.normals, resp.triangles]);
      return;
    }

    ctx.postMessage({ id, ok: false, error: "Unknown task type" } as WorkerResponse);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) } as WorkerResponse);
  }
};
