import {
  buildGroupMeshFromTriangles,
  buildGroupStepFromTriangles,
  buildGroupStlFromTriangles,
} from "../modules/replicadModeling";
import type { TriangleWithEdgeInfo } from "../types/triangles";
import { applySettings, type Settings } from "../modules/settings";

type WorkerRequest =
  | { id: number; type: "step"; triangles: TriangleWithEdgeInfo[]; settings: Settings }
  | { id: number; type: "stl"; triangles: TriangleWithEdgeInfo[]; settings: Settings }
  | { id: number; type: "mesh"; triangles: TriangleWithEdgeInfo[]; settings: Settings };

type MeshPayload = {
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  indices: ArrayBuffer | null;
  indexType: "uint16" | "uint32" | null;
};

type WorkerResponse =
  | { id: number; ok: true; type: "step"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "stl"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "mesh"; mesh: MeshPayload }
  | { id: number; ok: true; type: "progress"; message: number }
  | { id: number; ok: false; error: string };

/// <reference lib="webworker" />
const ctx: DedicatedWorkerGlobalScope = self as any;

const serializeMesh = async (
  triangles: TriangleWithEdgeInfo[],
  onProgress?: (msg: number) => void,
): Promise<MeshPayload> => {
  const mesh = await buildGroupMeshFromTriangles(triangles, onProgress);
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
  const { id, type, settings } = event.data;
  try {
    applySettings(settings);
    const report = (message: string) => ctx.postMessage({ id, ok: true, type: "progress", message } as WorkerResponse);
    if (type === "step") {
      const buffer = await (await buildGroupStepFromTriangles(event.data.triangles, report)).arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "step", buffer, mime: "application/step" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    if (type === "stl") {
      const buffer = await (await buildGroupStlFromTriangles(event.data.triangles, report)).arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "stl", buffer, mime: "model/stl" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }
    if (type === "mesh") {
      const mesh = await serializeMesh(event.data.triangles, report);
      const transfers: ArrayBuffer[] = [mesh.positions, mesh.normals].filter(Boolean) as ArrayBuffer[];
      if (mesh.indices) transfers.push(mesh.indices);
      const resp: WorkerResponse = { id, ok: true, type: "mesh", mesh };
      ctx.postMessage(resp, transfers);
      return;
    }
    ctx.postMessage({ id, ok: false, error: "Unknown task type" } as WorkerResponse);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) } as WorkerResponse);
  }
};
