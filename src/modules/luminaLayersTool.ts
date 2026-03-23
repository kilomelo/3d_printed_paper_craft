// 叠色打印工具模块
import * as THREE from "three";
import { type GroupTextureTriangle, generateGroupTexture } from "./textureManager";
import { downloadBlob } from "./gifRecorder";
import type { PolygonWithPoints } from "./textureManager";
import type { PolygonWithEdgeInfo } from "../types/geometryTypes";
import { processThreeMf, ThreeMfDocument } from "./threeMF/threeMfProcessor";
import {
  validateExpectedThreeMfStructure,
  assertExpectedThreeMfStructure,
  ThreeMfExpectedStructureErrorCode,
} from "./threeMF/threeMfStructureValidator";
import { buildStlInWorker } from "./replicad/replicadWorkerClient";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export type LuminaLayersDeps = {
  getPreviewGroupId: () => number | undefined;
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getGroupPolygonsData: (groupId: number) => PolygonWithPoints[];
  getTexture: () => THREE.Texture | null;
  getGroupFaceUVs: (groupId: number) => GroupTextureTriangle[];
  getCurrentHistoryUid: () => number;
  getGroupPlaceAngle: (groupId: number) => number;
  hasGroupIntersection: (groupId: number) => boolean;
  previewMeshCacheManager: {
    getCachedPreviewMesh: (groupId: number, currentHistoryUid: number, currentGroupAngle: number) => { mesh: THREE.Mesh; angle: number } | null;
    addCachedPreviewMesh: (groupId: number, mesh: THREE.Mesh, currentHistoryUid: number) => void;
  };
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string, params?: Record<string, any>) => string;
};

export type LuminaLayersRefs = {
  overlay: HTMLDivElement;
  groupNameLabel: HTMLSpanElement;
  faceCountLabel: HTMLSpanElement;
  pngFileNameLabel: HTMLSpanElement;
  exportPngBtn: HTMLButtonElement;
  dropZone: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  // videoIframe: HTMLIFrameElement;
};

export function getLuminaLayersRefs(): LuminaLayersRefs | null {
  const get = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

  const refs: LuminaLayersRefs = {
    overlay: get<HTMLDivElement>("#lumina-layers-overlay"),
    groupNameLabel: get<HTMLSpanElement>("#lumina-layers-group-name"),
    faceCountLabel: get<HTMLSpanElement>("#lumina-layers-face-count"),
    pngFileNameLabel: get<HTMLSpanElement>("#lumina-layers-png-filename"),
    exportPngBtn: get<HTMLButtonElement>("#lumina-layers-export-png-btn"),
    dropZone: get<HTMLDivElement>("#lumina-layers-drop-zone"),
    closeBtn: get<HTMLButtonElement>("#lumina-layers-close-btn"),
    // videoIframe: get<HTMLIFrameElement>("#lumina-layers-video-iframe"),
  };

  const values = Object.values(refs);
  if (values.some((el) => !el)) {
    console.error("叠色打印工具 DOM 元素缺失:", values.map((el) => (el ? "ok" : "missing")));
    return null;
  }

  return refs;
}

export type LuminaLayersApi = {
  isOpen: () => boolean;
  open: (groupName: string, faceCount: number, projectName: string, pngFileName: string) => void;
  close: () => void;
  dispose: () => void;
};

export function createLuminaLayersTool(refs: LuminaLayersRefs, deps: LuminaLayersDeps): LuminaLayersApi {
  const isOpen = () => !refs.overlay.classList.contains("hidden");

  const setTextWithTooltip = (el: HTMLElement, text: string) => {
    el.textContent = text;
    el.title = text;
  };

  const open = (groupName: string, faceCount: number, projectName: string, pngFileName: string) => {
    setTextWithTooltip(refs.groupNameLabel, groupName);
    setTextWithTooltip(refs.faceCountLabel, faceCount.toString());
    setTextWithTooltip(refs.pngFileNameLabel, `文件名：${pngFileName}`);
    // 延迟加载视频
    // const dataSrc = refs.videoIframe.getAttribute("data-src");
    // if (dataSrc) {
    //   refs.videoIframe.setAttribute("src", dataSrc);
    // }
    refs.overlay.classList.remove("hidden");
  };

  const close = () => {
    // 清空视频 src 停止播放
    // refs.videoIframe.src = "";
    refs.overlay.classList.add("hidden");
  };

  const handleExportPng = async () => {
    const groupId = deps.getPreviewGroupId();
    if (groupId === undefined) {
      deps.log(deps.t("log.export.noGroup"), "error");
      return;
    }

    const groupName = deps.getPreviewGroupName(groupId);
    if (!groupName) {
      deps.log(deps.t("log.export.noGroup"), "error");
      return;
    }

    const projectName = deps.getProjectName() || "未命名工程";
    const texture = deps.getTexture();
    const faceUVs = deps.getGroupFaceUVs(groupId);
    const polygons = deps.getGroupPolygonsData(groupId);
    const groupAngle = deps.getGroupPlaceAngle(groupId);

    deps.log(deps.t("log.export.png.start"), "info");

    try {
      const pngBlob = await generateGroupTexture({
        polygons,
        faceUVs,
        texture,
        groupAngle,
      });
      downloadBlob(pngBlob, `${projectName}-${groupName}.png`);
      deps.log(deps.t("log.export.png.success", { fileName: `${projectName}-${groupName}.png` }), "success");
    } catch (err) {
      console.error("导出 PNG 失败:", err);
      deps.log(deps.t("log.export.png.failed"), "error");
    }
  };

  // 处理 3MF 文件的通用函数
  const process3mfFile = async (file: File) => {
    console.log(`已载入 ${file.name}`);
    try {
      // 返回结果式
      const result = await validateExpectedThreeMfStructure(file);
      if (!result.ok) {
        console.error(result.code, result.message, result.details);
        // 这里根据 result.code 给用户弹提示
        return;
      }
    } catch (err) {
      console.error("处理 3MF 失败:", err);
    }
      
    // 获取当前展开组的缓存 mesh
    const groupId = deps.getPreviewGroupId();
    if (groupId === undefined) {
      deps.log("没有预览的展开组", "error");
      return;
    }
    const groupName = deps.getPreviewGroupName(groupId);
    const currentHistoryUid = deps.getCurrentHistoryUid();
    const groupAngle = deps.getGroupPlaceAngle(groupId);

    let cachedMesh = deps.previewMeshCacheManager.getCachedPreviewMesh(groupId, currentHistoryUid, groupAngle);

    // 缓存中没有模型，先生成并缓存
    if (!cachedMesh || !cachedMesh.mesh.geometry) {
      // 检查是否有自相交
      if (deps.hasGroupIntersection(groupId)) {
        deps.log("展开组存在自相交，无法生成模型", "error");
        return;
      }

      const polygons = deps.getGroupPolygonsData(groupId);
      if (!polygons.length) {
        deps.log("展开组没有面数据", "error");
        return;
      }
      deps.log("正在生成 STL 模型...", "info");

      try {
          const { blob } = await buildStlInWorker(
            polygons as PolygonWithEdgeInfo[],
            (progress) => deps.log(progress, "progress"),
            (msg, tone) => deps.log(msg, tone as "info" | "success" | "error" | "progress"),
          );

          const buffer = await blob.arrayBuffer();
          const stlLoader = new STLLoader();
          const geometry = stlLoader.parse(buffer);

          // 修正 geometry 位置
          geometry.computeBoundingBox();
          const min = geometry.boundingBox!.min;
          geometry.translate(-(min.x ?? 0), -(min.y ?? 0), -(min.z ?? 0));

          const mesh = new THREE.Mesh(geometry);
          mesh.name = "Replicad Mesh";

          // 添加到缓存
          deps.previewMeshCacheManager.addCachedPreviewMesh(groupId, mesh, currentHistoryUid);
      } catch (err) {
        console.error("生成展开组模型失败:", err);
        deps.log("生成展开组模型失败", "error");
      }
      // 重新获取缓存
      cachedMesh = deps.previewMeshCacheManager.getCachedPreviewMesh(groupId, currentHistoryUid, groupAngle);
      if (!cachedMesh || !cachedMesh.mesh.geometry) {
        deps.log("生成展开组模型失败", "error");
        return;
      }
    }

    const geometry = cachedMesh.mesh.geometry.clone();

    const bbox = await getCompositeChildrenUnionBoundingBoxFrom3mf(file, { includeBuildItemTransform: true,});
    console.log('[LuminaLayersTool] bbox of model in 3mf ', bbox)
    // 应用展开组旋转角度
    if (groupAngle && Math.abs(groupAngle) > 1e-9) {
      geometry.rotateZ(-groupAngle);
    }
    
    try {
      const doc = await processThreeMf(file, [
        ThreeMfDocument.processors.removeChildObjectsByName("Backing"),
        ThreeMfDocument.processors.addChildObjectFromGeometry({
          childName: groupName || "NewPart",
          geometry: geometry as THREE.BufferGeometry,
        }),
      ]);
      await doc.download("modified.3mf");
    }
    catch (err) {
      console.error("处理 3MF 失败:", err);
      deps.log("处理 3MF 失败", "error");
    }
    finally {
      geometry.dispose();
    }
    deps.log("3MF 文件处理完成，已下载", "success");
  };

  const handleDropZoneClick = () => {
    // 创建文件输入元素
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".3mf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file && file.name.endsWith(".3mf")) {
        await process3mfFile(file);
      }
    };
    input.click();
  };

  const handleDropZoneDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.style.borderColor = "#2196F3";
    refs.dropZone.style.background = "#E3F2FD";
  };

  const handleDropZoneDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.style.borderColor = "#ccc";
    refs.dropZone.style.background = "";
  };

  const handleDropZoneDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.style.borderColor = "#ccc";
    refs.dropZone.style.background = "";

    const file = event.dataTransfer?.files?.[0];
    if (file && file.name.endsWith(".3mf")) {
      await process3mfFile(file);
    }
  };

  const handleOverlayMouseDown = (event: MouseEvent) => {
    if (event.target === refs.overlay) {
      close();
    }
  };

  // 绑定事件
  refs.closeBtn.addEventListener("click", close);
  refs.exportPngBtn.addEventListener("click", handleExportPng);
  refs.dropZone.addEventListener("click", handleDropZoneClick);
  refs.dropZone.addEventListener("dragover", handleDropZoneDragOver);
  refs.dropZone.addEventListener("dragleave", handleDropZoneDragLeave);
  refs.dropZone.addEventListener("drop", handleDropZoneDrop);
  refs.overlay.addEventListener("mousedown", handleOverlayMouseDown);

  return {
    isOpen,
    open,
    close,
    dispose: () => {
      refs.closeBtn.removeEventListener("click", close);
      refs.exportPngBtn.removeEventListener("click", handleExportPng);
      refs.dropZone.removeEventListener("click", handleDropZoneClick);
      refs.dropZone.removeEventListener("dragover", handleDropZoneDragOver);
      refs.dropZone.removeEventListener("dragleave", handleDropZoneDragLeave);
      refs.dropZone.removeEventListener("drop", handleDropZoneDrop);
      refs.overlay.removeEventListener("mousedown", handleOverlayMouseDown);
    },
  };
}
