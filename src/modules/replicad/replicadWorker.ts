import {
  buildGroupMeshFromTriangles,
  buildGroupStepFromTriangles,
  buildGroupStlFromTriangles,
} from "./replicadModeling";
import type { TriangleWithEdgeInfo } from "../../types/geometryTypes";
import { applySettings, type Settings } from "../settings";
import type { LogTone } from "../log";

type WorkerRequest =
  | { id: number; type: "step"; triangles: TriangleWithEdgeInfo[]; settings: Settings; lang?: string }
  | { id: number; type: "stl"; triangles: TriangleWithEdgeInfo[]; settings: Settings; lang?: string }
  | { id: number; type: "mesh"; triangles: TriangleWithEdgeInfo[]; settings: Settings; lang?: string };

type MeshPayload = {
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  indices: ArrayBuffer | null;
  indexType: "uint16" | "uint32" | null;
};

type WorkerResponse =
  | { id: number; ok: true; type: "step"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "stl"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "mesh"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "progress"; message: number }
  | { id: number; ok: true; type: "log"; message: string; tone?: LogTone }
  | { id: number; ok: false; error: string };

/// <reference lib="webworker" />
const ctx: DedicatedWorkerGlobalScope = self as any;

const serializeMesh = async (
  triangles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string) => void,
): Promise<MeshPayload> => {
  const { mesh } = await buildGroupMeshFromTriangles(triangles, onProgress, onLog);
  const geom = mesh.geometry;
  const posAttr = geom.getAttribute("position");
  const normAttr = geom.getAttribute("normal");
  const index = geom.getIndex();
  const positions = posAttr?.array ? new Float32Array(posAttr.array).buffer : new ArrayBuffer(0);
  const normals = normAttr?.array ? new Float32Array(normAttr.array).buffer : new ArrayBuffer(0);
  let indices: ArrayBuffer | null = null;
  let indexType: MeshPayload["indexType"] = null;
  if (index) {
    const arr = index.array;
    if (arr instanceof Uint32Array) {
      indices = new Uint32Array(arr).buffer;
      indexType = "uint32";
    } else {
      indices = new Uint16Array(arr as any).buffer;
      indexType = "uint16";
    }
  }
  return { positions, normals, indices, indexType };
};

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, settings, lang } = event.data;
  try {
    // 这句话不能删除
    applySettings(settings);
    const report = (message: number) => ctx.postMessage({ id, ok: true, type: "progress", message } as WorkerResponse);
    const reportLog = (msg: string, tone: LogTone = "error") =>
      ctx.postMessage({ id, ok: true, type: "log", message: msg, tone } as WorkerResponse);
    if (type === "step") {
      const blob = await buildGroupStepFromTriangles(event.data.triangles, report, reportLog, lang);
      const buffer = await blob.arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "step", buffer, mime: "application/step" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    if (type === "stl") {
      const blob = await buildGroupStlFromTriangles(event.data.triangles, report, reportLog, lang);
      const buffer = await blob.arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "stl", buffer, mime: "model/stl" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    if (type === "mesh") {
      // 通过生成 STL，再由主线程解析为 mesh，减少重复建模路径
      const blob = await buildGroupStlFromTriangles(event.data.triangles, report, reportLog, lang);
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
