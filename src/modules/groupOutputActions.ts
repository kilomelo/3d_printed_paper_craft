// 展开组输出动作模块：负责导出各格式文件、预览建模，以及预览 mesh 缓存的复用与回填。
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
import { getSettings, type Settings } from "./settings";
import { ThreeMfDocument } from "./threeMF/threeMfProcessor";
import {
  createObjectElementFromMesh,
  getElementsByLocalName,
  getOrCreateResourcesElement,
  meshDataFromBufferGeometry,
  nextNumericIdFromElements,
  setOrCreateMetadataValue,
  setOrCreateModelSettingsMetadataValue,
} from "./threeMF/threeMfHelper";

const THREE_MF_TEMPLATE_PATH_BY_LAYER_HEIGHT: Record<Settings["layerHeight"], string> = {
  0.08: "/threeMF_templates/template08.3mf",
  0.12: "/threeMF_templates/template12.3mf",
  0.16: "/threeMF_templates/template16.3mf",
  0.2: "/threeMF_templates/template20.3mf",
  0.24: "/threeMF_templates/template24.3mf",
};

type BindGroupOutputActionsOptions = {
  exportGroupStlBtn: HTMLButtonElement | null;
  previewModelBtn: HTMLButtonElement;
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

export const bindGroupOutputActions = (opts: BindGroupOutputActionsOptions) => {
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
        const cachedMesh = getCachedGroupMesh(targetGroupId);
        if (!cachedMesh) {
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
          const refreshedCached = getCachedGroupMesh(targetGroupId);
          if (refreshedCached) downloadMesh(groupName, refreshedCached.mesh);
        } else {
          opts.log(opts.t("log.export.stl.cached"), "info");
          downloadMesh(groupName, cachedMesh.mesh);
        }
      } catch (error) {
        handleReplicadFailure(error, "log.export.stl.fail", "[GroupOutputActions] Failed to export STL");
      } finally {
        stlBtn.disabled = false;
      }
    });
  }

  opts.previewModelBtn.addEventListener("click", async () => {
    if (opts.validateGroupOutputAccess && !opts.validateGroupOutputAccess()) return;
    opts.previewModelBtn.disabled = true;
    try {
      const targetGroupId = opts.getPreviewGroupId();
      if (opts.hasGroupIntersection(targetGroupId)) {
        opts.log(opts.t("log.export.selfIntersect"), "error");
        return;
      }
      const cachedMesh = getCachedGroupMesh(targetGroupId);
      if (cachedMesh) {
        opts.loadPreviewModel(cachedMesh.mesh, cachedMesh.angle);
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
        const refreshedCached = getCachedGroupMesh(targetGroupId);
        if (refreshedCached) opts.loadPreviewModel(refreshedCached.mesh, refreshedCached.angle);
      }
      opts.changeWorkspaceState("previewGroupModel");
    } catch (error) {
      handleReplicadFailure(error, "log.replicad.mesh.fail", "[GroupOutputActions] Failed to build preview mesh");
    } finally {
      opts.previewModelBtn.disabled = false;
    }
  });

  function getCachedGroupMesh(groupId: number) {
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
export type GroupExportOptions = {
  export3mf: boolean;
  exportStl: boolean;
  exportStep: boolean;
  exportPng: boolean;
  exportAllGroups: boolean;
};

// 导出回调函数类型
export type GroupExportCallback = (options: GroupExportOptions) => void | Promise<void>;

// 创建导出回调函数
export function createGroupExportCallback(opts: {
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
}): GroupExportCallback {
  const stlLoader = new STLLoader();
  const template3mfPromiseByPath = new Map<string, Promise<ArrayBuffer>>();
  const forwardReplicadLog = (msg: string, tone?: "info" | "success" | "error") => {
    opts.log(opts.t(msg), tone ?? "error");
  };
  const handleReplicadFailure = (error: unknown, fallbackKey: string, consoleMessage: string) => {
    console.error(consoleMessage, error);
    if (!extractReplicadErrorCode(error)) {
      opts.log(opts.t(fallbackKey), "error");
    }
  };

  function getCachedGroupMesh(groupId: number) {
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

  const getCurrentThreeMfTemplatePath = () => {
    const layerHeight = getSettings().layerHeight;
    const templatePath = THREE_MF_TEMPLATE_PATH_BY_LAYER_HEIGHT[layerHeight];
    if (!templatePath) {
      throw new Error(`Unsupported 3MF template layerHeight: ${layerHeight}`);
    }
    return templatePath;
  };

  async function loadTemplate3mfBuffer() {
    const templatePath = getCurrentThreeMfTemplatePath();
    if (!template3mfPromiseByPath.has(templatePath)) {
      template3mfPromiseByPath.set(templatePath, fetch(templatePath, { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load 3MF template ${templatePath}: ${response.status}`);
        }
        return response.arrayBuffer();
      }));
    }
    const buffer = await template3mfPromiseByPath.get(templatePath)!;
    return buffer.slice(0);
  }

  async function ensureGroupMesh(targetGroupId: number) {
    const cachedMesh = getCachedGroupMesh(targetGroupId);
    if (cachedMesh) {
      return { mesh: cachedMesh.mesh, fromCache: true };
    }

    const polygonsWithAngles = opts.getGroupPolygonsData(targetGroupId);
    if (!polygonsWithAngles.length) {
      opts.log(opts.t("log.export.noFaces"), "error");
      return null;
    }

    const { mesh } = await buildMeshInWorker(
      polygonsWithAngles,
      (progress) => opts.log(progress, "progress"),
      forwardReplicadLog,
    );
    snapGeometryPositions(mesh.geometry);
    opts.previewMeshCacheManager.addCachedPreviewMesh(targetGroupId, mesh, opts.getCurrentHistoryUid());
    opts.onPreviewMeshCacheMutated?.();
    const refreshedCached = getCachedGroupMesh(targetGroupId);
    return { mesh: refreshedCached?.mesh ?? mesh, fromCache: false };
  }

  function buildTemplate3mfDocumentFromMesh(
    templateDoc: ThreeMfDocument,
    mesh: Mesh,
    objectName: string,
  ) {
    const exportGeometry = createExportGeometryFromMesh(mesh);
    const modelXml = templateDoc.getModelXml(templateDoc.getPrimaryModelPath() ?? undefined);
    const modelSettingsXml = templateDoc.getModelSettingsXml();
    const resourcesEl = getOrCreateResourcesElement(modelXml);
    const modelEl = modelXml.documentElement;
    const ns = modelEl.namespaceURI;
    const existingObjects = getElementsByLocalName(modelXml, "object");
    const newObjectId = nextNumericIdFromElements(existingObjects, "id");
    const objectEl = createObjectElementFromMesh(
      modelXml,
      newObjectId,
      meshDataFromBufferGeometry(exportGeometry, objectName),
      objectName,
    );
    resourcesEl.appendChild(objectEl);

    let buildEl = getElementsByLocalName(modelXml, "build")[0] ?? null;
    if (!buildEl) {
      buildEl = modelXml.createElementNS(ns, "build");
      modelEl.appendChild(buildEl);
    }
    const itemEl = modelXml.createElementNS(ns, "item");
    itemEl.setAttribute("objectid", String(newObjectId));
    buildEl.appendChild(itemEl);

    setOrCreateMetadataValue(modelEl, "Title", objectName);

    if (modelSettingsXml) {
      const configRoot = modelSettingsXml.documentElement;
      const modelSettingsObjectEl = modelSettingsXml.createElement("object");
      modelSettingsObjectEl.setAttribute("id", String(newObjectId));
      modelSettingsObjectEl.setAttribute("name", objectName);
      setOrCreateModelSettingsMetadataValue(modelSettingsObjectEl, "name", objectName);
      configRoot.appendChild(modelSettingsObjectEl);
    }

    exportGeometry.dispose();
  }

  function createExportGeometryFromMesh(mesh: Mesh) {
    mesh.updateMatrixWorld(true);
    const exportGeometry = mesh.geometry.clone();
    exportGeometry.applyMatrix4(mesh.matrixWorld);
    snapGeometryPositions(exportGeometry);
    exportGeometry.computeBoundingBox();
    exportGeometry.computeBoundingSphere();
    return exportGeometry;
  }

  async function exportGroupById(targetGroupId: number, options: GroupExportOptions) {
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

    if (options.export3mf) {
      try {
        opts.log(opts.t("log.export.3mf.start"), "info");
        const ensuredMesh = await ensureGroupMesh(targetGroupId);
        if (!ensuredMesh) return;
        if (ensuredMesh.fromCache) {
          opts.log(opts.t("log.export.3mf.cached"), "info");
        }
        const templateBuffer = await loadTemplate3mfBuffer();
        const doc = await ThreeMfDocument.from(templateBuffer);
        buildTemplate3mfDocumentFromMesh(doc, ensuredMesh.mesh, groupName);
        doc.centerSingleBuildItemOnPrintableArea();
        if (getSettings().connectionLayers !== 1) {
          doc.setProjectSettings({
            bottom_surface_pattern: "monotonic",
          });
        }
        const projectName = opts.getProjectName() || "未命名工程";
        const fileName = `${projectName}-${groupName}.3mf`;
        await doc.download(fileName);
        opts.log(opts.t("log.export.3mf.success", { fileName }), "success");
      } catch (error) {
        console.error("[GroupOutputActions] Failed to export 3MF", error);
        opts.log(opts.t("log.export.3mf.fail"), "error");
      }
    }

    // 导出 STL
    if (options.exportStl) {
      try {
        const cachedMesh = getCachedGroupMesh(targetGroupId);
        if (!cachedMesh) {
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
          const refreshedCached = getCachedGroupMesh(targetGroupId);
          if (refreshedCached) downloadMesh(groupName, refreshedCached.mesh);
        } else {
          opts.log(opts.t("log.export.stl.cached"), "info");
          downloadMesh(groupName, cachedMesh.mesh);
        }
      } catch (error) {
        handleReplicadFailure(error, "log.export.stl.fail", "[GroupOutputActions] Failed to export STL");
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
        handleReplicadFailure(error, "log.export.step.fail", "[GroupOutputActions] Failed to export STEP");
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
        console.error("[GroupOutputActions] Failed to export PNG", error);
        opts.log(opts.t("log.export.png.fail"), "error");
      }
    }
  }

  return async (options: GroupExportOptions) => {
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
