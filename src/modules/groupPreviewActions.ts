// 展开组 STEP/STL 导出与 3D 预览建模：收口 worker 调用、预览 mesh 缓存读写与下载流程。
import * as THREE from "three";
import { Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { snapGeometryPositions } from "./geometry";
import {
  buildStepInWorker,
  buildStlInWorker,
  buildMeshInWorker,
} from "./replicad/replicadWorkerClient";
import { extractReplicadErrorCode } from "./replicad/replicadErrors";
import { generateGroupTexture } from "./textureManager";
import type { GroupTextureOptions } from "./textureManager";
import type { createPreviewMeshCacheManager } from "./previewMeshCache";
import type { WorkspaceState } from "../types/workspaceState.js";

type BindGroupPreviewActionsOptions = {
  exportGroupStlBtn: HTMLButtonElement | null;
  previewGroupModelBtn: HTMLButtonElement;
  validateGroupOutputAccess?: () => boolean;
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
  getTexture: () => THREE.Texture | null;
  getGroupFaceUVs: (groupId: number) => GroupTextureOptions["faceUVs"];
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export const bindGroupPreviewActions = (opts: BindGroupPreviewActionsOptions) => {
  const stlLoader = new STLLoader();
  const forwardReplicadLog = (msg: string, tone?: "info" | "success" | "error") => {
    opts.log(opts.t(msg), tone ?? "error");
  };
  const handleReplicadFailure = (error: unknown, fallbackKey: string, consoleMessage: string) => {
    console.error(consoleMessage, error);
    if (!extractReplicadErrorCode(error)) {
      opts.log(opts.t(fallbackKey), "error");
    }
  };

  if (opts.exportGroupStlBtn) {
    const stlBtn = opts.exportGroupStlBtn;
    stlBtn.addEventListener("click", async () => {
      if (opts.validateGroupOutputAccess && !opts.validateGroupOutputAccess()) return;
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
            forwardReplicadLog,
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
        handleReplicadFailure(error, "log.export.stl.fail", "[GroupPreviewActions] Failed to export STL");
      } finally {
        stlBtn.disabled = false;
      }
    });
  }

  opts.previewGroupModelBtn.addEventListener("click", async () => {
    if (opts.validateGroupOutputAccess && !opts.validateGroupOutputAccess()) return;
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
          forwardReplicadLog,
        );
        snapGeometryPositions(mesh.geometry);
        opts.previewMeshCacheManager.addCachedPreviewMesh(targetGroupId, mesh, opts.getCurrentHistoryUid());
        opts.onPreviewMeshCacheMutated?.();
        const refreshedCached = getCachedPreviewMesh(targetGroupId);
        if (refreshedCached) opts.loadPreviewModel(refreshedCached.mesh, refreshedCached.angle);
      }
      opts.changeWorkspaceState("previewGroupModel");
    } catch (error) {
      handleReplicadFailure(error, "log.replicad.mesh.fail", "[GroupPreviewActions] Failed to build preview mesh");
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
  exportPng: boolean;
  exportAllGroups: boolean;
};

// 导出回调函数类型
export type ExportCallback = (options: ExportOptions) => void | Promise<void>;

// 创建导出回调函数
export function createExportCallback(opts: {
  getPreviewGroupId: () => number;
  getExportableGroupIds: () => number[];
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getCurrentHistoryUid: () => number;
  getGroupPlaceAngle: (groupId: number) => number;
  hasGroupIntersection: (groupId: number) => boolean;
  getGroupPolygonsData: (groupId: number) => any[];
  previewMeshCacheManager: ReturnType<typeof createPreviewMeshCacheManager>;
  onPreviewMeshCacheMutated?: () => void;
  getTexture: () => THREE.Texture | null;
  getGroupFaceUVs: (groupId: number) => GroupTextureOptions["faceUVs"];
  setBatchExportBusy?: (busy: boolean) => void;
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}): ExportCallback {
  const stlLoader = new STLLoader();
  const forwardReplicadLog = (msg: string, tone?: "info" | "success" | "error") => {
    opts.log(opts.t(msg), tone ?? "error");
  };
  const handleReplicadFailure = (error: unknown, fallbackKey: string, consoleMessage: string) => {
    console.error(consoleMessage, error);
    if (!extractReplicadErrorCode(error)) {
      opts.log(opts.t(fallbackKey), "error");
    }
  };

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

  async function exportGroupById(targetGroupId: number, options: ExportOptions) {
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
      try {
        const cached = getCachedPreviewMesh(targetGroupId);
        if (!cached) {
          opts.log(opts.t("log.export.stl.start"), "info");
          const { blob } = await buildStlInWorker(
            polygonsWithAngles,
            (progress) => opts.log(progress, "progress"),
            forwardReplicadLog,
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
        handleReplicadFailure(error, "log.export.stl.fail", "[GroupPreviewActions] Failed to export STL");
      }
    }

    // 导出 STEP
    if (options.exportStep) {
      try {
        const projectName = opts.getProjectName() || "未命名工程";
        opts.log(opts.t("log.export.step.start"), "info");
        const { blob } = await buildStepInWorker(
          polygonsWithAngles,
          (progress) => opts.log(progress, "progress"),
          forwardReplicadLog,
        );
        downloadBlob(blob, `${projectName}-${groupName}.step`);
        opts.log(opts.t("log.export.step.success", { fileName: `${projectName}-${groupName}.step` }), "success");
      } catch (error) {
        handleReplicadFailure(error, "log.export.step.fail", "[GroupPreviewActions] Failed to export STEP");
      }
    }

    // 导出 PNG
    if (options.exportPng) {
      try {
        const projectName = opts.getProjectName() || "未命名工程";
        const texture = opts.getTexture();
        const faceUVs = opts.getGroupFaceUVs(targetGroupId);
        const groupAngle = opts.getGroupPlaceAngle(targetGroupId);

        const pngBlob = await generateGroupTexture({
          polygons: polygonsWithAngles,
          faceUVs,
          texture,
          groupAngle,
        });
        downloadBlob(pngBlob, `${projectName}-${groupName}.png`);
        opts.log(opts.t("log.export.png.success", { fileName: `${projectName}-${groupName}.png` }), "success");
      } catch (error) {
        console.error("[GroupPreviewActions] Failed to export PNG", error);
        opts.log(opts.t("log.export.png.fail"), "error");
      }
    }
  }

  return async (options: ExportOptions) => {
    if (options.exportAllGroups) {
      const targetGroupIds = opts.getExportableGroupIds();
      if (!targetGroupIds.length) {
        opts.log(opts.t("log.export.noValidGroups"), "error");
        return;
      }

      opts.setBatchExportBusy?.(true);
      try {
        for (let index = 0; index < targetGroupIds.length; index++) {
          await exportGroupById(targetGroupIds[index], options);
          opts.log(opts.t("log.export.batch.progress", { current: index + 1, total: targetGroupIds.length }), "info");
        }
      } finally {
        opts.setBatchExportBusy?.(false);
      }
      return;
    }

    await exportGroupById(opts.getPreviewGroupId(), options);
  };
}
