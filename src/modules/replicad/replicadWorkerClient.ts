import { PolygonWithEdgeInfo } from "../../types/geometryTypes";
import { getSettings } from "../settings";
import { Mesh, BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Uint16BufferAttribute } from "three";
import { extractReplicadErrorCode, ReplicadWorkerError } from "./replicadErrors";

type WorkerLogTone = "info" | "error" | "success";

type WorkerResponse =
  | { id: number; ok: true; type: "step"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "stl"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "mesh"; vertices: ArrayBuffer; normals: ArrayBuffer; triangles: ArrayBuffer; trianglesType: "uint16" | "uint32" }
  | { id: number; ok: true; type: "negativeMesh"; vertices: ArrayBuffer; normals: ArrayBuffer; triangles: ArrayBuffer; trianglesType: "uint16" | "uint32" }
  | { id: number; ok: true; type: "progress"; message: number }
  | { id: number; ok: true; type: "log"; message: string; tone?: WorkerLogTone }
  | { id: number; ok: false; error: string; code?: string };

type WorkerRequest =
  | { id: number; type: "step"; polygons: PolygonWithEdgeInfo[]; settings: ReturnType<typeof getSettings>; mode?: "normal" | "lumina" }
  | { id: number; type: "stl"; polygons: PolygonWithEdgeInfo[]; settings: ReturnType<typeof getSettings>; mode?: "normal" | "lumina" }
  | { id: number; type: "mesh"; polygons: PolygonWithEdgeInfo[]; settings: ReturnType<typeof getSettings>; mode?: "normal" | "lumina" }
  | { id: number; type: "negativeMesh"; polygons: PolygonWithEdgeInfo[]; settings: ReturnType<typeof getSettings> };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (msg: number) => void; onLog?: (msg: string, tone?: WorkerLogTone) => void }
>();
let busy = false;
const busyListeners = new Set<(busy: boolean) => void>();

const setBusy = (next: boolean) => {
  if (busy === next) return;
  busy = next;
  busyListeners.forEach((fn) => fn(busy));
};

const ensureWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL("./replicadWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (msg.ok && msg.type === "progress") {
      setBusy(true);
      entry.onProgress?.(msg.message);
      return;
    }
    if (msg.ok && msg.type === "log") {
      entry.onLog?.(msg.message, msg.tone);
      return;
    }
    pending.delete(msg.id);
    setBusy(false);
    if (!msg.ok) {
      entry.reject(new ReplicadWorkerError(msg.error, msg.code ?? extractReplicadErrorCode(msg.error)));
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

const callWorker = (payload: Omit<WorkerRequest, "id">, onProgress?: (msg: number) => void, onLog?: (msg: string, tone?: WorkerLogTone) => void) =>
  new Promise<WorkerResponse>((resolve, reject) => {
    const id = ++seq;
    setBusy(true);
    ensureWorker().postMessage({ id, ...payload } satisfies WorkerRequest);
    pending.set(id, { resolve, reject, onProgress, onLog });
  });

export const isWorkerBusy = () => busy;
export const onWorkerBusyChange = (cb: (busy: boolean) => void) => {
  busyListeners.add(cb);
  return () => busyListeners.delete(cb);
};

export async function buildStepInWorker(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string, tone?: WorkerLogTone) => void,
) {
  const res = (await callWorker({ type: "step", polygons: polygonsWithAngles, settings: getSettings() }, onProgress, onLog)) as Extract<
    WorkerResponse,
    { type: "step"; ok: true }
  >;
  return { blob: new Blob([res.buffer], { type: res.mime }) };
}

export async function buildStlInWorker(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string, tone?: WorkerLogTone) => void,
) {
  const res = (await callWorker({ type: "stl", polygons: polygonsWithAngles, settings: getSettings() }, onProgress, onLog)) as Extract<
    WorkerResponse,
    { type: "stl"; ok: true }
  >;
  return { blob: new Blob([res.buffer], { type: res.mime }) };
}

export async function buildMeshInWorker(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string, tone?: WorkerLogTone) => void,
  mode: "normal" | "lumina" = "normal",
) {
  const res = (await callWorker({ type: "mesh", polygons: polygonsWithAngles, settings: getSettings(), mode }, onProgress, onLog)) as Extract<
    WorkerResponse,
    { type: "mesh"; ok: true }
  >;

  const vertices = new Float32Array(res.vertices);
  const normals = new Float32Array(res.normals);
  const triangles =
    res.trianglesType === "uint32"
      ? new Uint32Array(res.triangles)
      : new Uint16Array(res.triangles);

  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(vertices, 3);
  const normal = new Float32BufferAttribute(normals, 3);
  const indexArray =
    res.trianglesType === "uint32"
      ? new Uint32BufferAttribute(triangles, 1)
      : new Uint16BufferAttribute(triangles, 1);

  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setIndex(indexArray);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new Mesh(geometry);
  mesh.name = "Replicad Mesh";
  return { mesh };
}

export async function buildNegativeOutlineMeshInWorker(
  polygonsWithAngles: PolygonWithEdgeInfo[],
  onProgress?: (msg: number) => void,
  onLog?: (msg: string, tone?: WorkerLogTone) => void,
) {
  const res = (await callWorker({ type: "negativeMesh", polygons: polygonsWithAngles, settings: getSettings() }, onProgress, onLog)) as Extract<
    WorkerResponse,
    { type: "negativeMesh"; ok: true }
  >;

  const vertices = new Float32Array(res.vertices);
  const normals = new Float32Array(res.normals);
  const triangles =
    res.trianglesType === "uint32"
      ? new Uint32Array(res.triangles)
      : new Uint16Array(res.triangles);

  return { vertices, normals, triangles, trianglesType: res.trianglesType };
}
