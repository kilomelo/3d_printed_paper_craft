// 叠色打印工具模块
import * as THREE from "three";
import { type GroupTextureTriangle, generateGroupTexture } from "./textureManager";
import { downloadBlob } from "./gifRecorder";
import type { PolygonWithEdgeInfo, PolygonContour } from "../types/geometryTypes";
import { processThreeMf, ThreeMfDocument, getCompositeChildrenUnionBoundingBoxFrom3mf } from "./threeMF/threeMfProcessor";
import {
  validateExpectedThreeMfStructure,
  ThreeMfExpectedStructureErrorCode,
} from "./threeMF/threeMfStructureValidator";
import { buildMeshInWorker } from "./replicad/replicadWorkerClient";
import { buildNegativeOutlineForLuminaLayers } from "./replicad/replicadModeling";
import { getSettings } from "./settings";

export type LuminaLayersDeps = {
  getPreviewGroupId: () => number | undefined;
  getPreviewGroupName: (groupId: number) => string | undefined;
  getProjectName: () => string;
  getGroupPolygonsData: (groupId: number) => PolygonContour[];
  getTexture: () => THREE.Texture | null;
  getGroupFaceUVs: (groupId: number) => GroupTextureTriangle[];
  getCurrentHistoryUid: () => number;
  getGroupPlaceAngle: (groupId: number) => number;
  getGroupBounds: () => { minX: number; maxX: number; minY: number; maxY: number } | undefined;
  hasGroupIntersection: (groupId: number) => boolean;
  log: (msg: string | number, tone?: "info" | "success" | "error" | "progress") => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string, params?: Record<string, any>) => string;
};

export type LuminaLayersRefs = {
  overlay: HTMLDivElement;
  groupNameLabel: HTMLSpanElement;
  faceCountLabel: HTMLSpanElement;
  pngFileNameLabel: HTMLSpanElement;
  luminaLayersParaWidthLabel: HTMLSpanElement;
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
    luminaLayersParaWidthLabel: get<HTMLSpanElement>("#lumina-layers-para-width"),
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
    // 更新展开组尺寸
    const bounds = deps.getGroupBounds();
    const { scale } = getSettings();
    // 乘以 2 以提高ll导出模型精度，抗锯齿
    const width = 1 * scale * (bounds ? bounds.maxX - bounds.minX : 100);
    const height = 1 * scale * (bounds ? bounds.maxY - bounds.minY : 100);
    if (bounds) {
      setTextWithTooltip(refs.luminaLayersParaWidthLabel, `${width.toFixed(2)} × ${height.toFixed(2)}`);
    } else {
      setTextWithTooltip(refs.luminaLayersParaWidthLabel, "-");
    }
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
    deps.log("正在生成展开组模型...", "info");

    let geometry: THREE.BufferGeometry;
    try {
      const { mesh } = await buildMeshInWorker(
        polygons as PolygonWithEdgeInfo[],
        (progress) => deps.log(progress, "progress"),
        (msg, tone) => deps.log(msg, tone as "info" | "success" | "error" | "progress"),
        "lumina",
      );
      geometry = mesh.geometry;
    } catch (err) {
      console.error("生成展开组模型失败:", err);
      deps.log("生成展开组模型失败", "error");
      return;
    }

    const { scale } = getSettings();
    if (!polygons.length) {
      deps.log("展开组没有面数据", "error");
      return;
    }
    deps.log("正在生成负轮廓几何体...", "info");

    let negativeGeometry: THREE.BufferGeometry;
    try {
      const solid = await buildNegativeOutlineForLuminaLayers(polygons);
      if (!solid) {
        deps.log("负轮廓几何体生成失败", "error");
        return;
      }
      const meshTolerance = 0.1;
      const meshAngularTolerance = 0.5;
      const mesh = solid.mesh({ tolerance: meshTolerance, angularTolerance: meshAngularTolerance });
      negativeGeometry = new THREE.BufferGeometry();
      negativeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices, 3));
      negativeGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
      const indexArray = mesh.vertices.length / 3 > 65535
        ? new THREE.Uint32BufferAttribute(mesh.triangles, 1)
        : new THREE.Uint16BufferAttribute(mesh.triangles, 1);
      negativeGeometry.setIndex(indexArray);
      negativeGeometry.computeBoundingBox();
    } catch (err) {
      console.error("生成负轮廓几何体失败:", err);
      deps.log("生成负轮廓几何体失败", "error");
      return;
    }
    const bbox = await getCompositeChildrenUnionBoundingBoxFrom3mf(file, { includeBuildItemTransform: true,});
    
    console.log('[LuminaLayersTool] bbox of model in 3mf ', bbox, 'scale', scale);

    let maxX = -Infinity;
    let minY = Infinity;
    polygons.forEach((polygon) => {
      polygon.points.forEach((point) => {
        maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]);
      })
    })
    console.log('[LuminaLayersTool] polygons min ', -maxX, minY);


    // 应用展开组旋转角度
    if (groupAngle && Math.abs(groupAngle) > 1e-9) {
      console.log('[LuminaLayersTool] apply group angle', groupAngle);
      geometry.rotateZ(-groupAngle);
      negativeGeometry.rotateZ(-groupAngle);
    }
    // 对其模型
    geometry.translate(maxX, -minY, 0);
    negativeGeometry.translate(maxX, -minY, 0);
    // 先放大 2 倍，因为后面还需要缩小 2 倍
    // geometry.scale(2, 2, 1)
    
    try {
      const doc = await processThreeMf(file, [
        ThreeMfDocument.processors.removeChildObjectsByName("Backing"),
        // 缩小 2 倍
        // ThreeMfDocument.processors.scaleAllModelInstances({
        //   xFactor: 0.5,
        //   yFactor: 0.5,
        //   zFactor: 1,
        // }),
        ThreeMfDocument.processors.addChildObjectFromGeometry({
          childName: groupName + "-NegativeMesh",
          geometry: negativeGeometry as THREE.BufferGeometry,
          partKind: "negative",
        }),
        ThreeMfDocument.processors.addChildObjectFromGeometry({
          childName: groupName || "GroupMesh",
          geometry: geometry as THREE.BufferGeometry,
          partKind: "normal",
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
