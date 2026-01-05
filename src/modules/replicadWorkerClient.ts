import { TriangleWithEdgeInfo } from "../types/triangles";
import { getSettings } from "./settings";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
  Mesh,
} from "three";

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

type WorkerRequest =
  | { id: number; type: "step"; triangles: TriangleWithEdgeInfo[]; settings: ReturnType<typeof getSettings> }
  | { id: number; type: "stl"; triangles: TriangleWithEdgeInfo[]; settings: ReturnType<typeof getSettings> }
  | { id: number; type: "mesh"; triangles: TriangleWithEdgeInfo[]; settings: ReturnType<typeof getSettings> };

let worker: Worker | null = null;
const blocker = () => document.querySelector<HTMLElement>("#menu-blocker");
let seq = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (msg: number) => void }
>();
let busy = false;
const busyListeners = new Set<(busy: boolean) => void>();

const setBusy = (next: boolean) => {
  if (busy === next) return;
  busy = next;
  if (!busy) {
    blocker()?.classList.remove("active");
  }
  busyListeners.forEach((fn) => fn(busy));
};

const ensureWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/replicadWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (msg.ok && msg.type === "progress") {
      setBusy(true);
      entry.onProgress?.(msg.message);
      return;
    }
    pending.delete(msg.id);
    setBusy(false);
    if (!msg.ok) {
      entry.reject(new Error(msg.error));
      return;
    }
    entry.resolve(msg);
  };
  worker.onerror = (err) => {
    setBusy(false);
    pending.forEach(({ reject }) => reject(err));
    pending.clear();
  };
  return worker;
};

const callWorker = (payload: Omit<WorkerRequest, "id">, onProgress?: (msg: number) => void) =>
  new Promise<WorkerResponse>((resolve, reject) => {
    const id = ++seq;
    setBusy(true);
    blocker()?.classList.add("active");
    ensureWorker().postMessage({ id, ...payload } satisfies WorkerRequest);
    pending.set(id, { resolve, reject, onProgress });
  });

export const isWorkerBusy = () => busy;
export const onWorkerBusyChange = (cb: (busy: boolean) => void) => {
  busyListeners.add(cb);
  return () => busyListeners.delete(cb);
};

export async function buildStepInWorker(trisWithAngles: TriangleWithEdgeInfo[], onProgress?: (msg: number) => void) {
  const res = (await callWorker({ type: "step", triangles: trisWithAngles, settings: getSettings() }, onProgress)) as Extract<
    WorkerResponse,
    { type: "step"; ok: true }
  >;
  return new Blob([res.buffer], { type: res.mime });
}

export async function buildStlInWorker(trisWithAngles: TriangleWithEdgeInfo[], onProgress?: (msg: number) => void) {
  const res = (await callWorker({ type: "stl", triangles: trisWithAngles, settings: getSettings() }, onProgress)) as Extract<
    WorkerResponse,
    { type: "stl"; ok: true }
  >;
  return new Blob([res.buffer], { type: res.mime });
}

const reconstructMesh = (payload: MeshPayload) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(payload.positions), 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(new Float32Array(payload.normals), 3));
  if (payload.indices && payload.indexType) {
    if (payload.indexType === "uint32") {
      geometry.setIndex(new Uint32BufferAttribute(new Uint32Array(payload.indices), 1));
    } else {
      geometry.setIndex(new Uint16BufferAttribute(new Uint16Array(payload.indices), 1));
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry);
  mesh.name = "Replicad Mesh";
  return mesh;
};

export async function buildMeshInWorker(trisWithAngles: TriangleWithEdgeInfo[], onProgress?: (msg: number) => void) {
  const res = (await callWorker({ type: "mesh", triangles: trisWithAngles, settings: getSettings() }, onProgress)) as Extract<
    WorkerResponse,
    { type: "mesh"; ok: true }
  >;
  return reconstructMesh(res.mesh);
}
