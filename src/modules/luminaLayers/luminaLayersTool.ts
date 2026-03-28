// 叠色打印工具模块
import * as THREE from "three";
import { type GroupTextureTriangle, generateGroupTexture } from "../textureManager";
import { downloadBlob } from "../gifRecorder";
import type { PolygonWithEdgeInfo, PolygonContour } from "../../types/geometryTypes";
import { processThreeMf, ThreeMfDocument, getCompositeChildrenUnionBoundingBoxFrom3mf } from "../threeMF/threeMfProcessor";
import {
  validateExpectedThreeMfStructure,
  ThreeMfExpectedStructureErrorCode,
} from "../threeMF/threeMfStructureValidator";
import { buildMeshInWorker, buildNegativeOutlineMeshInWorker } from "../replicad/replicadWorkerClient";
import { extractReplicadErrorCode } from "../replicad/replicadErrors";
import { getSettings } from "../settings";
import { LUMINA_LAYERS_EMBEDDED_VIDEO_ENABLED } from "./luminaLayersConfig";

export type LuminaLayersDeps = {
  getPreviewGroupId: () => number | undefined;
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getGroupPolygonsData: (groupId: number, forceTriangle?: boolean) => PolygonWithEdgeInfo[];
  getTexture: () => THREE.Texture | null;
  getGroupFaceUVs: (groupId: number) => GroupTextureTriangle[];
  getGroupPlaceAngle: (groupId: number) => number;
  getGroupBounds: () => { minX: number; maxX: number; minY: number; maxY: number } | undefined;
  hasGroupIntersection: (groupId: number) => boolean;
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string, params?: Record<string, any>) => string;
};

export type LuminaLayersRefs = {
  overlay: HTMLDivElement;
  waitOverlay: HTMLDivElement;
  pngFileNameLabel: HTMLSpanElement;
  luminaLayersParaWidthLabel: HTMLSpanElement;
  exportPngBtn: HTMLButtonElement;
  dropZone: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  waitMessage: HTMLDivElement;
  waitAdvice: HTMLDivElement;
  waitSubmessage: HTMLDivElement;
  waitProgress: HTMLDivElement;
  waitProgressFill: HTMLDivElement;
  waitProgressLabel: HTMLSpanElement;
  waitCloseBtn: HTMLButtonElement;
  videoIframe: HTMLIFrameElement | null;
};

export function getLuminaLayersRefs(): LuminaLayersRefs | null {
  const get = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

  const refs: LuminaLayersRefs = {
    overlay: get<HTMLDivElement>("#lumina-layers-overlay"),
    waitOverlay: get<HTMLDivElement>("#lumina-layers-wait-overlay"),
    pngFileNameLabel: get<HTMLSpanElement>("#lumina-layers-png-filename"),
    luminaLayersParaWidthLabel: get<HTMLSpanElement>("#lumina-layers-para-width"),
    exportPngBtn: get<HTMLButtonElement>("#lumina-layers-export-png-btn"),
    dropZone: get<HTMLDivElement>("#lumina-layers-drop-zone"),
    closeBtn: get<HTMLButtonElement>("#lumina-layers-close-btn"),
    waitMessage: get<HTMLDivElement>("#lumina-layers-wait-message"),
    waitAdvice: get<HTMLDivElement>("#lumina-layers-wait-advice"),
    waitSubmessage: get<HTMLDivElement>("#lumina-layers-wait-submessage"),
    waitProgress: get<HTMLDivElement>("#lumina-layers-wait-progress"),
    waitProgressFill: get<HTMLDivElement>("#lumina-layers-wait-progress-fill"),
    waitProgressLabel: get<HTMLSpanElement>("#lumina-layers-wait-progress-label"),
    waitCloseBtn: get<HTMLButtonElement>("#lumina-layers-wait-close-btn"),
    videoIframe: document.querySelector<HTMLIFrameElement>("#lumina-layers-video-iframe"),
  };

  const values = [
    refs.overlay,
    refs.waitOverlay,
    refs.pngFileNameLabel,
    refs.luminaLayersParaWidthLabel,
    refs.exportPngBtn,
    refs.dropZone,
    refs.closeBtn,
    refs.waitMessage,
    refs.waitAdvice,
    refs.waitSubmessage,
    refs.waitProgress,
    refs.waitProgressFill,
    refs.waitProgressLabel,
    refs.waitCloseBtn,
  ];
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

const LUMINA_WAIT_PROGRESS = {
  initial: 2,
  validationDone: 5,
  buildModelDone: 85,
  negativeOutlineDone: 98,
  finished: 100,
} as const;

const mapProgressToRange = (progress: number, start: number, end: number) => {
  const clamped = Math.max(0, Math.min(100, progress));
  return start + ((end - start) * clamped) / 100;
};

const computeAlignmentOffsetFromPolygons = (
  polygons: PolygonWithEdgeInfo[],
  rotationRad: number,
) => {
  let maxX = -Infinity;
  let minY = Infinity;
  const hasRotation = Math.abs(rotationRad) > 1e-9;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);

  polygons.forEach((polygon) => {
    polygon.points.forEach(([x, y]) => {
      const rotatedX = hasRotation ? x * cos - y * sin : x;
      const rotatedY = hasRotation ? x * sin + y * cos : y;
      maxX = Math.max(maxX, rotatedX);
      minY = Math.min(minY, rotatedY);
    });
  });

  return {
    offsetX: Number.isFinite(maxX) ? maxX : 0,
    offsetY: Number.isFinite(minY) ? -minY : 0,
  };
};

type WaitModalState = "running" | "finished" | "error";

export function createLuminaLayersTool(refs: LuminaLayersRefs, deps: LuminaLayersDeps): LuminaLayersApi {
  let waitModalState: WaitModalState = "running";
  let lastOpenState: { groupName: string; faceCount: number; projectName: string; pngFileName: string } | null = null;
  const isOpen = () => !refs.overlay.classList.contains("hidden");

  const setTextWithTooltip = (el: HTMLElement, text: string) => {
    el.textContent = text;
    el.title = text;
  };

  const getValidationErrorReason = (
    code: ThreeMfExpectedStructureErrorCode,
    details?: Record<string, unknown>,
  ) => {
    switch (code) {
      case ThreeMfExpectedStructureErrorCode.INVALID_PLATE_COUNT:
        return deps.t("luminaLayers.wait.error.reason.INVALID_PLATE_COUNT", {
          plateCount: details?.plateCount ?? "?",
        });
      case ThreeMfExpectedStructureErrorCode.INVALID_MODEL_OBJECT_COUNT:
        return deps.t("luminaLayers.wait.error.reason.INVALID_MODEL_OBJECT_COUNT", {
          objectCount: details?.objectCount ?? "?",
          buildItemCount: details?.buildItemCount ?? "?",
        });
      case ThreeMfExpectedStructureErrorCode.ROOT_OBJECT_NOT_COMPOSITE:
        return deps.t("luminaLayers.wait.error.reason.ROOT_OBJECT_NOT_COMPOSITE");
      case ThreeMfExpectedStructureErrorCode.COMPONENT_COUNT_TOO_SMALL:
        return deps.t("luminaLayers.wait.error.reason.COMPONENT_COUNT_TOO_SMALL", {
          componentCount: details?.componentCount ?? "?",
        });
      case ThreeMfExpectedStructureErrorCode.INVALID_BACKING_COUNT:
        return deps.t("luminaLayers.wait.error.reason.INVALID_BACKING_COUNT", {
          backingCount: details?.backingCount ?? "?",
        });
      case ThreeMfExpectedStructureErrorCode.PRIMARY_MODEL_NOT_FOUND:
        return deps.t("luminaLayers.wait.error.reason.PRIMARY_MODEL_NOT_FOUND");
      case ThreeMfExpectedStructureErrorCode.PRIMARY_MODEL_XML_INVALID:
        return deps.t("luminaLayers.wait.error.reason.PRIMARY_MODEL_XML_INVALID");
      case ThreeMfExpectedStructureErrorCode.REFERENCED_MODEL_NOT_FOUND:
        return deps.t("luminaLayers.wait.error.reason.REFERENCED_MODEL_NOT_FOUND");
      case ThreeMfExpectedStructureErrorCode.REFERENCED_OBJECT_NOT_FOUND:
        return deps.t("luminaLayers.wait.error.reason.REFERENCED_OBJECT_NOT_FOUND");
      case ThreeMfExpectedStructureErrorCode.PLATE_METADATA_NOT_FOUND:
        return deps.t("luminaLayers.wait.error.reason.PLATE_METADATA_NOT_FOUND");
      default:
        return deps.t("luminaLayers.wait.error.reason.generic");
    }
  };

  const open = (groupName: string, faceCount: number, projectName: string, pngFileName: string) => {
    lastOpenState = { groupName, faceCount, projectName, pngFileName };
    setTextWithTooltip(refs.pngFileNameLabel, deps.t("luminaLayers.fileName", { fileName: pngFileName }));
    // 更新展开组尺寸
    const bounds = deps.getGroupBounds();
    const { scale } = getSettings();
    // 乘以 2 以提高ll导出模型精度，抗锯齿
    const width = 1 * scale * (bounds ? bounds.maxX - bounds.minX : 100);
    if (bounds) {
      setTextWithTooltip(
        refs.luminaLayersParaWidthLabel,
        deps.t("luminaLayers.step2.item1", { width: width.toFixed(2) }),
      );
    } else {
      setTextWithTooltip(refs.luminaLayersParaWidthLabel, deps.t("luminaLayers.step2.item1", { width: "-" }));
    }
    if (LUMINA_LAYERS_EMBEDDED_VIDEO_ENABLED && refs.videoIframe) {
      const dataSrc = refs.videoIframe.getAttribute("data-src");
      if (dataSrc) {
        refs.videoIframe.setAttribute("src", dataSrc);
      }
    }
    refs.overlay.classList.remove("hidden");
  };

  const close = () => {
    if (LUMINA_LAYERS_EMBEDDED_VIDEO_ENABLED && refs.videoIframe) {
      refs.videoIframe.src = "";
    }
    refs.overlay.classList.add("hidden");
  };

  const setWaitingProgress = (progress: number, label: string) => {
    const clampedProgress = Math.max(0, Math.min(100, progress));
    refs.waitProgressFill.style.width = `${clampedProgress}%`;
    refs.waitProgress.setAttribute("aria-valuenow", String(Math.round(clampedProgress)));
    refs.waitProgressLabel.textContent = label;
    refs.waitProgressLabel.title = label;
  };

  const openWaitingModal = () => {
    waitModalState = "running";
    refs.waitMessage.textContent = deps.t("luminaLayers.wait.running");
    refs.waitAdvice.textContent = "";
    refs.waitAdvice.classList.add("hidden");
    refs.waitSubmessage.textContent = "";
    refs.waitSubmessage.classList.add("hidden");
    refs.waitProgress.classList.remove("hidden");
    refs.waitCloseBtn.classList.add("hidden");
    refs.waitCloseBtn.disabled = true;
    refs.waitCloseBtn.textContent = deps.t("luminaLayers.wait.finishBtn");
    setWaitingProgress(LUMINA_WAIT_PROGRESS.initial, deps.t("luminaLayers.wait.step.validate"));
    refs.waitOverlay.classList.remove("hidden");
  };

  const closeWaitingModal = () => {
    waitModalState = "running";
    refs.waitOverlay.classList.add("hidden");
    refs.waitProgress.classList.remove("hidden");
    refs.waitCloseBtn.classList.add("hidden");
    refs.waitCloseBtn.disabled = true;
    refs.waitCloseBtn.textContent = deps.t("luminaLayers.wait.finishBtn");
    refs.waitMessage.textContent = deps.t("luminaLayers.wait.running");
    refs.waitAdvice.textContent = "";
    refs.waitAdvice.classList.add("hidden");
    refs.waitSubmessage.textContent = "";
    refs.waitSubmessage.classList.add("hidden");
    setWaitingProgress(LUMINA_WAIT_PROGRESS.initial, deps.t("luminaLayers.wait.step.validate"));
  };

  const finishWaitingModal = (startedAt: number) => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    waitModalState = "finished";
    refs.waitMessage.textContent = deps.t("luminaLayers.wait.done", { minutes, seconds });
    refs.waitAdvice.textContent = "";
    refs.waitAdvice.classList.add("hidden");
    refs.waitSubmessage.textContent = "";
    refs.waitSubmessage.classList.add("hidden");
    setWaitingProgress(LUMINA_WAIT_PROGRESS.finished, deps.t("luminaLayers.wait.step.process3mf"));
    refs.waitProgress.classList.add("hidden");
    refs.waitCloseBtn.classList.remove("hidden");
    refs.waitCloseBtn.disabled = false;
    refs.waitCloseBtn.textContent = deps.t("luminaLayers.wait.finishBtn");
  };

  const interruptWaitingModalWithValidationError = (
    code: ThreeMfExpectedStructureErrorCode,
    details?: Record<string, unknown>,
  ) => {
    waitModalState = "error";
    refs.waitMessage.textContent = deps.t("luminaLayers.wait.error.title");
    refs.waitAdvice.textContent = deps.t("luminaLayers.wait.error.advice");
    refs.waitAdvice.classList.remove("hidden");
    refs.waitSubmessage.textContent = getValidationErrorReason(code, details);
    refs.waitSubmessage.classList.remove("hidden");
    refs.waitProgress.classList.add("hidden");
    refs.waitCloseBtn.classList.remove("hidden");
    refs.waitCloseBtn.disabled = false;
    refs.waitCloseBtn.textContent = deps.t("luminaLayers.wait.error.backBtn");
  };

  const getRuntimeErrorReason = (error: unknown) => {
    const code = extractReplicadErrorCode(error);
    if (code) {
      const translated = deps.t(code);
      if (translated !== code) {
        return translated;
      }
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error) {
      return error;
    }
    return deps.t("luminaLayers.wait.error.reason.runtimeGeneric");
  };

  const interruptWaitingModalWithRuntimeError = (title: string, reason: string) => {
    waitModalState = "error";
    refs.waitMessage.textContent = title;
    refs.waitAdvice.textContent = deps.t("luminaLayers.wait.error.retryAdvice");
    refs.waitAdvice.classList.remove("hidden");
    refs.waitSubmessage.textContent = reason;
    refs.waitSubmessage.classList.remove("hidden");
    refs.waitProgress.classList.add("hidden");
    refs.waitCloseBtn.classList.remove("hidden");
    refs.waitCloseBtn.disabled = false;
    refs.waitCloseBtn.textContent = deps.t("luminaLayers.wait.error.backBtn");
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
    close();
    openWaitingModal();

    const startedAt = Date.now();
    let succeeded = false;
    let geometry: THREE.BufferGeometry | null = null;
    let negativeGeometry: THREE.BufferGeometry | null = null;

    try {
      // 返回结果式
      const result = await validateExpectedThreeMfStructure(file);
      if (!result.ok) {
        console.error(result.code, result.details);
        interruptWaitingModalWithValidationError(result.code, result.details);
        return;
      }

      const groupId = deps.getPreviewGroupId();
      if (groupId === undefined) {
        return;
      }
      const groupName = deps.getPreviewGroupName(groupId);
      const groupAngle = deps.getGroupPlaceAngle(groupId);

      // 检查是否有自相交
      if (deps.hasGroupIntersection(groupId)) {
        return;
      }
      setWaitingProgress(LUMINA_WAIT_PROGRESS.validationDone, deps.t("luminaLayers.wait.step.buildModel"));

      const polygons = deps.getGroupPolygonsData(groupId);
      if (!polygons.length) {
        return;
      }

      try {
        const handleBuildMeshProgress = (progress: number) => {
          setWaitingProgress(
            mapProgressToRange(progress, LUMINA_WAIT_PROGRESS.validationDone, LUMINA_WAIT_PROGRESS.buildModelDone),
            deps.t("luminaLayers.wait.step.buildModel"),
          );
        };
        const handleBuildMeshLog = (msg: string, tone?: "info" | "success" | "error") => {
          deps.log(deps.t(msg), tone);
        };
        const { mesh } = await buildMeshInWorker(
          polygons as PolygonWithEdgeInfo[],
          handleBuildMeshProgress,
          handleBuildMeshLog,
          "lumina",
        );
        geometry = mesh.geometry;
      } catch (err) {
        console.error("[LuminaLayersTool] Failed to build unfolded-group mesh", err);
        interruptWaitingModalWithRuntimeError(
          deps.t("luminaLayers.wait.error.buildModel.title"),
          getRuntimeErrorReason(err),
        );
        return;
      }
      setWaitingProgress(LUMINA_WAIT_PROGRESS.buildModelDone, deps.t("luminaLayers.wait.step.negativeOutline"));

      const { scale } = getSettings();
      const triangles = deps.getGroupPolygonsData(groupId, true);
      try {
        const handleNegativeOutlineProgress = (progress: number) => {
          setWaitingProgress(
            mapProgressToRange(progress, LUMINA_WAIT_PROGRESS.buildModelDone, LUMINA_WAIT_PROGRESS.negativeOutlineDone),
            deps.t("luminaLayers.wait.step.negativeOutline"),
          );
        };
        const handleNegativeOutlineLog = (msg: string) => {
          deps.log(deps.t(msg), "error");
        };
        const { vertices, normals, triangles: meshTriangles, trianglesType } = await buildNegativeOutlineMeshInWorker(
          triangles,
          handleNegativeOutlineProgress,
          handleNegativeOutlineLog,
        );
        if (!vertices.length) {
          interruptWaitingModalWithRuntimeError(
            deps.t("luminaLayers.wait.error.negativeOutline.title"),
            deps.t("luminaLayers.wait.error.reason.EMPTY_NEGATIVE_MESH"),
          );
          return;
        }
        negativeGeometry = new THREE.BufferGeometry();
        negativeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        negativeGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
        const indexArray = trianglesType === "uint32"
          ? new THREE.Uint32BufferAttribute(meshTriangles, 1)
          : new THREE.Uint16BufferAttribute(meshTriangles, 1);
        negativeGeometry.setIndex(indexArray);
        negativeGeometry.computeBoundingBox();
      } catch (err) {
        if (!extractReplicadErrorCode(err)) {
          console.error("[LuminaLayersTool] Failed to build negative outline geometry", err);
        } else {
          console.error("[LuminaLayersTool] Replicad negative outline failed", err);
        }
        interruptWaitingModalWithRuntimeError(
          deps.t("luminaLayers.wait.error.negativeOutline.title"),
          getRuntimeErrorReason(err),
        );
        return;
      }
      setWaitingProgress(LUMINA_WAIT_PROGRESS.negativeOutlineDone, deps.t("luminaLayers.wait.step.process3mf"));
      const bbox = await getCompositeChildrenUnionBoundingBoxFrom3mf(file, { includeBuildItemTransform: true });

      console.log("[LuminaLayersTool] bbox of model in 3mf ", bbox, "scale", scale);

      // 应用展开组旋转角度
      if (groupAngle && Math.abs(groupAngle) > 1e-9 && geometry && negativeGeometry) {
        console.log("[LuminaLayersTool] apply group angle", groupAngle);
        geometry.rotateZ(-groupAngle);
        negativeGeometry.rotateZ(-groupAngle);
      }
      if (!geometry || !negativeGeometry) {
        return;
      }
      const { offsetX, offsetY } = computeAlignmentOffsetFromPolygons(polygons, (groupAngle ?? 0));
      console.log("[LuminaLayersTool] alignment offset", { offsetX, offsetY });
      // 对齐模型
      geometry.translate(offsetX, offsetY, 0);
      negativeGeometry.translate(offsetX, offsetY, 0);
      // 先放大 2 倍，因为后面还需要缩小 2 倍
      // geometry.scale(2, 2, 1)

      const doc = await processThreeMf(file, [
        ThreeMfDocument.processors.removeChildObjectsByName("Backing"),
        // 缩小 2 倍
        // ThreeMfDocument.processors.scaleAllModelInstances({
        //   xFactor: 0.5,
        //   yFactor: 0.5,
        //   zFactor: 1,
        // }),
        ThreeMfDocument.processors.addChildObjectFromGeometry({
          childName: groupName + "-边缘抗锯齿",
          geometry: negativeGeometry as THREE.BufferGeometry,
          partKind: "negative",
        }),
        ThreeMfDocument.processors.addChildObjectFromGeometry({
          childName: groupName || "3D打印纸艺模型",
          geometry,
          partKind: "normal",
        }),
        ThreeMfDocument.processors.addHeightRangeModifier({
          // todo 改为从setting里读取叠色层厚度值
          minZ: 0.4,
          maxZ: 100,
          slicerOptions: {},
        }),
        ThreeMfDocument.processors.renameCompositeRootObject(groupName || "3D打印纸艺模型"),
      ]);
      await doc.download("modified.3mf");
      succeeded = true;
      finishWaitingModal(startedAt);
    } catch (err) {
      console.error("[LuminaLayersTool] Failed to process 3MF", err);
    } finally {
      geometry?.dispose();
      negativeGeometry?.dispose();
    }

    if (!succeeded) {
      closeWaitingModal();
    }
  };

  const handleWaitClose = () => {
    const currentState = waitModalState;
    if (currentState === "running") {
      return;
    }
    closeWaitingModal();
    if (currentState === "error" && lastOpenState) {
      open(lastOpenState.groupName, lastOpenState.faceCount, lastOpenState.projectName, lastOpenState.pngFileName);
    }
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
    refs.dropZone.classList.add("is-dragover");
  };

  const handleDropZoneDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.classList.remove("is-dragover");
  };

  const handleDropZoneDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.classList.remove("is-dragover");

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
  refs.waitCloseBtn.addEventListener("click", handleWaitClose);
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
      refs.waitCloseBtn.removeEventListener("click", handleWaitClose);
      refs.exportPngBtn.removeEventListener("click", handleExportPng);
      refs.dropZone.removeEventListener("click", handleDropZoneClick);
      refs.dropZone.removeEventListener("dragover", handleDropZoneDragOver);
      refs.dropZone.removeEventListener("dragleave", handleDropZoneDragLeave);
      refs.dropZone.removeEventListener("drop", handleDropZoneDrop);
      refs.overlay.removeEventListener("mousedown", handleOverlayMouseDown);
    },
  };
}
