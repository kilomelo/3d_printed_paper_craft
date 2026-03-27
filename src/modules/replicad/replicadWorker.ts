import {
  buildGroupStepFromPolygons,
  buildGroupStlFromPolygons,
  buildGroupMeshDataFromPolygons,
  buildNegativeOutlineForLuminaLayers,
} from "./replicadModeling";
import { extractReplicadErrorCode } from "./replicadErrors";
import type { PolygonWithEdgeInfo } from "../../types/geometryTypes";
import { applySettings, type Settings } from "../settings";
import type { LogTone } from "../log";

type WorkerLogTone = Exclude<LogTone, "progress">;

type WorkerRequest =
  | { id: number; type: "step"; polygons: PolygonWithEdgeInfo[]; settings: Settings; mode?: "normal" | "lumina" }
  | { id: number; type: "stl"; polygons: PolygonWithEdgeInfo[]; settings: Settings; mode?: "normal" | "lumina" }
  | { id: number; type: "mesh"; polygons: PolygonWithEdgeInfo[]; settings: Settings; mode?: "normal" | "lumina" }
  | { id: number; type: "negativeMesh"; polygons: PolygonWithEdgeInfo[]; settings: Settings };

type WorkerResponse =
  | { id: number; ok: true; type: "step"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "stl"; buffer: ArrayBuffer; mime: string }
  | { id: number; ok: true; type: "mesh"; vertices: ArrayBuffer; normals: ArrayBuffer; triangles: ArrayBuffer; trianglesType: "uint16" | "uint32" }
  | { id: number; ok: true; type: "negativeMesh"; vertices: ArrayBuffer; normals: ArrayBuffer; triangles: ArrayBuffer; trianglesType: "uint16" | "uint32" }
  | { id: number; ok: true; type: "progress"; message: number }
  | { id: number; ok: true; type: "log"; message: string; tone?: WorkerLogTone }
  | { id: number; ok: false; error: string; code?: string };

/// <reference lib="webworker" />
const ctx: DedicatedWorkerGlobalScope = self as any;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, settings, mode } = event.data;
  try {
    // 这句话不能删除
    applySettings(settings);
    const report = (message: number) => ctx.postMessage({ id, ok: true, type: "progress", message } as WorkerResponse);
    const reportLog = (msg: string, tone: WorkerLogTone = "error") =>
      ctx.postMessage({ id, ok: true, type: "log", message: msg, tone } as WorkerResponse);

    if (type === "step") {
      const blob = await buildGroupStepFromPolygons(event.data.polygons, report, reportLog);
      const buffer = await blob.arrayBuffer();
      const resp: WorkerResponse = { id, ok: true, type: "step", buffer, mime: "application/step" };
      ctx.postMessage(resp, [resp.buffer]);
      return;
    }

    if (type === "stl") {
      const blob = await buildGroupStlFromPolygons(event.data.polygons, report, reportLog);
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

    if (type === "negativeMesh") {
      const solid = await buildNegativeOutlineForLuminaLayers(
        event.data.polygons,
        report,
        reportLog,
      );
      if (!solid) {
        const emptyVertices = new Float32Array();
        const emptyNormals = new Float32Array();
        const emptyTriangles = new Uint16Array();
        const resp = {
          id,
          ok: true,
          type: "negativeMesh" as const,
          vertices: emptyVertices.buffer,
          normals: emptyNormals.buffer,
          triangles: emptyTriangles.buffer,
          trianglesType: "uint16" as const,
        };
        ctx.postMessage(resp, [resp.vertices, resp.normals, resp.triangles]);
        return;
      }
      const meshTolerance = 0.1;
      const meshAngularTolerance = 0.5;
      const mesh = solid.mesh({ tolerance: meshTolerance, angularTolerance: meshAngularTolerance });
      const vertices = new Float32Array(mesh.vertices);
      const normals = new Float32Array(mesh.normals);
      const triangles =
        mesh.vertices.length / 3 > 65535
          ? new Uint32Array(mesh.triangles)
          : new Uint16Array(mesh.triangles);
      const resp = {
        id,
        ok: true,
        type: "negativeMesh" as const,
        vertices: vertices.buffer,
        normals: normals.buffer,
        triangles: triangles.buffer,
        trianglesType: triangles instanceof Uint32Array ? "uint32" as const : "uint16" as const,
      };
      ctx.postMessage(resp, [resp.vertices, resp.normals, resp.triangles]);
      return;
    }

    ctx.postMessage({ id, ok: false, error: "Unknown worker task type" } as WorkerResponse);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    ctx.postMessage({
      id,
      ok: false,
      error: message,
      code: extractReplicadErrorCode(message),
    } as WorkerResponse);
  }
};
