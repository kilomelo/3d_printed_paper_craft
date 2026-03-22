// 叠色打印工具模块
import { type GroupTextureTriangle, generateGroupTexture } from "./textureManager";
import { downloadBlob } from "./gifRecorder";
import type { PolygonWithPoints } from "./textureManager";

export type LuminaLayersDeps = {
  getPreviewGroupId: () => number | undefined;
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getGroupPolygonsData: (groupId: number) => PolygonWithPoints[];
  getTexture: () => THREE.Texture | null;
  getGroupFaceUVs: (groupId: number) => GroupTextureTriangle[];
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
  videoIframe: HTMLIFrameElement;
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
    videoIframe: get<HTMLIFrameElement>("#lumina-layers-video-iframe"),
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
    const dataSrc = refs.videoIframe.getAttribute("data-src");
    if (dataSrc) {
      refs.videoIframe.setAttribute("src", dataSrc);
    }
    refs.overlay.classList.remove("hidden");
  };

  const close = () => {
    // 清空视频 src 停止播放
    refs.videoIframe.src = "";
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

    deps.log(deps.t("log.export.png.start"), "info");

    try {
      const pngBlob = await generateGroupTexture({
        polygons,
        faceUVs,
        texture,
      });
      downloadBlob(pngBlob, `${projectName}-${groupName}.png`);
      deps.log(deps.t("log.export.png.success", { fileName: `${projectName}-${groupName}.png` }), "success");
    } catch (err) {
      console.error("导出 PNG 失败:", err);
      deps.log(deps.t("log.export.png.failed"), "error");
    }
  };

  const handleDropZoneClick = () => {
    // 创建文件输入元素
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".3mf";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file && file.name.endsWith(".3mf")) {
        console.log(`已载入 ${file.name}`);
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

  const handleDropZoneDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.style.borderColor = "#ccc";
    refs.dropZone.style.background = "";

    const file = event.dataTransfer?.files?.[0];
    if (file && file.name.endsWith(".3mf")) {
      console.log(`已载入 ${file.name}`);
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
