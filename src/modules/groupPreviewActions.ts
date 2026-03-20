// 展开组 STEP/STL 导出与 3D 预览建模：收口 worker 调用、预览 mesh 缓存读写与下载流程。
import { Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { snapGeometryPositions } from "./geometry";
import {
  buildStepInWorker,
  buildStlInWorker,
  buildMeshInWorker,
} from "./replicad/replicadWorkerClient";
import type { createPreviewMeshCacheManager } from "./previewMeshCache";
import type { WorkspaceState } from "../types/workspaceState.js";

type BindGroupPreviewActionsOptions = {
  exportGroupStlBtn: HTMLButtonElement | null;
  previewGroupModelBtn: HTMLButtonElement;
  getPreviewGroupId: () => number;
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getCurrentHistoryUid: () => number;
  getGroupPlaceAngle: (groupId: number) => number;
  hasGroupIntersection: (groupId: number) => boolean;
  getGroupPolygonsData: (groupId: number) => any[];
  previewMeshCacheManager: ReturnType<typeof createPreviewMeshCacheManager>;
  loadPreviewModel: (mesh: Mesh, angle: number) => void;
  changeWorkspaceState: (state: WorkspaceState) => void;
  onPreviewMeshCacheMutated?: () => void;
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export const bindGroupPreviewActions = (opts: BindGroupPreviewActionsOptions) => {
  const stlLoader = new STLLoader();

  if (opts.exportGroupStlBtn) {
    const stlBtn = opts.exportGroupStlBtn;
    stlBtn.addEventListener("click", async () => {
      stlBtn.disabled = true;
      try {
        const targetGroupId = opts.getPreviewGroupId();
        if (opts.hasGroupIntersection(targetGroupId)) {
          opts.log(opts.t("log.export.selfIntersect"), "error");
          return;
        }
        const groupName = opts.getPreviewGroupName(targetGroupId) ?? `group-${targetGroupId}`;
        const cached = getCachedPreviewMesh(targetGroupId);
        if (!cached) {
          const polygonsWithAngles = opts.getGroupPolygonsData(targetGroupId);
          if (!polygonsWithAngles.length) {
            opts.log(opts.t("log.export.noFaces"), "error");
            return;
          }
          opts.log(opts.t("log.export.stl.start"), "info");
          const { blob } = await buildStlInWorker(
            polygonsWithAngles,
            (progress) => opts.log(progress, "progress"),
            (msg, tone) => opts.log(msg, (tone as any) ?? "error"),
          );
          const buffer = await blob.arrayBuffer();
          const geometry = stlLoader.parse(buffer);
          snapGeometryPositions(geometry);
          const mesh = new Mesh(geometry);
          mesh.name = "Replicad Mesh";
          opts.previewMeshCacheManager.addCachedPreviewMesh(targetGroupId, mesh, opts.getCurrentHistoryUid());
          opts.onPreviewMeshCacheMutated?.();
          const refreshedCached = getCachedPreviewMesh(targetGroupId);
          if (refreshedCached) downloadMesh(groupName, refreshedCached.mesh);
        } else {
          opts.log(opts.t("log.export.stl.cached"), "info");
          downloadMesh(groupName, cached.mesh);
        }
      } catch (error) {
        console.error("展开组 STL 导出失败", error);
        opts.log(opts.t("log.export.stl.fail"), "error");
      } finally {
        stlBtn.disabled = false;
      }
    });
  }

  opts.previewGroupModelBtn.addEventListener("click", async () => {
    opts.previewGroupModelBtn.disabled = true;
    try {
      const targetGroupId = opts.getPreviewGroupId();
      if (opts.hasGroupIntersection(targetGroupId)) {
        opts.log(opts.t("log.export.selfIntersect"), "error");
        return;
      }
      const cached = getCachedPreviewMesh(targetGroupId);
      if (cached) {
        opts.loadPreviewModel(cached.mesh, cached.angle);
      } else {
        const polygonsWithAngles = opts.getGroupPolygonsData(targetGroupId);
        if (!polygonsWithAngles.length) {
          opts.log(opts.t("log.export.noFaces"), "error");
          return;
        }
        const { mesh } = await buildMeshInWorker(
          polygonsWithAngles,
          (progress) => opts.log(progress, "progress"),
          (msg, tone) => opts.log(msg, (tone as any) ?? "error"),
        );
        snapGeometryPositions(mesh.geometry);
        opts.previewMeshCacheManager.addCachedPreviewMesh(targetGroupId, mesh, opts.getCurrentHistoryUid());
        opts.onPreviewMeshCacheMutated?.();
        const refreshedCached = getCachedPreviewMesh(targetGroupId);
        if (refreshedCached) opts.loadPreviewModel(refreshedCached.mesh, refreshedCached.angle);
      }
      opts.changeWorkspaceState("previewGroupModel");
    } catch (error) {
      console.error("Replicad mesh 生成失败", error);
      opts.log(opts.t("log.replicad.mesh.fail"), "error");
    } finally {
      opts.previewGroupModelBtn.disabled = false;
    }
  });

  function getCachedPreviewMesh(groupId: number) {
    return opts.previewMeshCacheManager.getCachedPreviewMesh(
      groupId,
      opts.getCurrentHistoryUid(),
      opts.getGroupPlaceAngle(groupId),
    );
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadMesh(groupName: string, mesh: Mesh) {
    const projectName = opts.getProjectName() || "未命名工程";
    const exporter = new STLExporter();
    const stlResult = exporter.parse(mesh, { binary: true });
    const stlArray =
      stlResult instanceof ArrayBuffer
        ? new Uint8Array(stlResult)
        : stlResult instanceof DataView
          ? new Uint8Array(stlResult.buffer)
          : new Uint8Array();
    const stlCopy = new Uint8Array(stlArray);
    downloadBlob(new Blob([stlCopy.buffer], { type: "model/stl" }), `${projectName}-${groupName}.stl`);
    opts.log(opts.t("log.export.stl.success", { fileName: `${projectName}-${groupName}.stl` }), "success");
  }
};

// 导出选项类型
export type ExportOptions = {
  exportStl: boolean;
  exportStep: boolean;
};

// 导出回调函数类型
export type ExportCallback = (options: ExportOptions) => void;

// 创建导出回调函数
export function createExportCallback(opts: {
  getPreviewGroupId: () => number;
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getCurrentHistoryUid: () => number;
  getGroupPlaceAngle: (groupId: number) => number;
  hasGroupIntersection: (groupId: number) => boolean;
  getGroupPolygonsData: (groupId: number) => any[];
  previewMeshCacheManager: ReturnType<typeof createPreviewMeshCacheManager>;
  onPreviewMeshCacheMutated?: () => void;
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}): ExportCallback {
  const stlLoader = new STLLoader();

  function getCachedPreviewMesh(groupId: number) {
    return opts.previewMeshCacheManager.getCachedPreviewMesh(
      groupId,
      opts.getCurrentHistoryUid(),
      opts.getGroupPlaceAngle(groupId),
    );
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadMesh(groupName: string, mesh: Mesh) {
    const projectName = opts.getProjectName() || "未命名工程";
    const exporter = new STLExporter();
    const stlResult = exporter.parse(mesh, { binary: true });
    const stlArray =
      stlResult instanceof ArrayBuffer
        ? new Uint8Array(stlResult)
        : stlResult instanceof DataView
          ? new Uint8Array(stlResult.buffer)
          : new Uint8Array();
    const stlCopy = new Uint8Array(stlArray);
    downloadBlob(new Blob([stlCopy.buffer], { type: "model/stl" }), `${projectName}-${groupName}.stl`);
    opts.log(opts.t("log.export.stl.success", { fileName: `${projectName}-${groupName}.stl` }), "success");
  }

  return async (options: ExportOptions) => {
    const targetGroupId = opts.getPreviewGroupId();
    if (opts.hasGroupIntersection(targetGroupId)) {
      opts.log(opts.t("log.export.selfIntersect"), "error");
      return;
    }

    const groupName = opts.getPreviewGroupName(targetGroupId) ?? `group-${targetGroupId}`;
    const polygonsWithAngles = opts.getGroupPolygonsData(targetGroupId);

    if (!polygonsWithAngles.length) {
      opts.log(opts.t("log.export.noFaces"), "error");
      return;
    }

    // 导出 STL
    if (options.exportStl) {
      const cached = getCachedPreviewMesh(targetGroupId);
      if (!cached) {
        opts.log(opts.t("log.export.stl.start"), "info");
        const { blob } = await buildStlInWorker(
          polygonsWithAngles,
          (progress) => opts.log(progress, "progress"),
          (msg, tone) => opts.log(msg, (tone as any) ?? "error"),
        );
        const buffer = await blob.arrayBuffer();
        const geometry = stlLoader.parse(buffer);
        snapGeometryPositions(geometry);
        const mesh = new Mesh(geometry);
        mesh.name = "Replicad Mesh";
        opts.previewMeshCacheManager.addCachedPreviewMesh(targetGroupId, mesh, opts.getCurrentHistoryUid());
        opts.onPreviewMeshCacheMutated?.();
        const refreshedCached = getCachedPreviewMesh(targetGroupId);
        if (refreshedCached) downloadMesh(groupName, refreshedCached.mesh);
      } else {
        opts.log(opts.t("log.export.stl.cached"), "info");
        downloadMesh(groupName, cached.mesh);
      }
    }

    // 导出 STEP
    if (options.exportStep) {
      const projectName = opts.getProjectName() || "未命名工程";
      opts.log(opts.t("log.export.step.start"), "info");
      const { blob } = await buildStepInWorker(
        polygonsWithAngles,
        (progress) => opts.log(progress, "progress"),
        (msg, tone) => opts.log(msg, (tone as any) ?? "error"),
      );
      downloadBlob(blob, `${projectName}-${groupName}.step`);
      opts.log(opts.t("log.export.step.success", { fileName: `${projectName}-${groupName}.step` }), "success");
    }
  };
}
