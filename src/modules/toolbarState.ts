// 工具栏状态管理模块
import { t } from "./i18n";
import type { WorkspaceState } from "../types/workspaceState.js";

export type ToggleConfig = {
  btn: HTMLButtonElement | null;
  keyOn: string;
  keyOff: string;
  isOn: () => boolean;
};

export const refreshToggleTexts = (
  toggles: ToggleConfig[],
) => {
  toggles.forEach(({ btn, keyOn, keyOff, isOn }) => {
    if (!btn) return;
    btn.textContent = t(isOn() ? keyOn : keyOff);
  });
};

// 工具栏按钮元素引用（由 main.ts 注入）
let textureToggle: HTMLButtonElement | null = null;
let lightToggle: HTMLButtonElement | null = null;
let edgesToggle: HTMLButtonElement | null = null;
let seamsToggle: HTMLButtonElement | null = null;
let facesToggle: HTMLButtonElement | null = null;
let bboxToggle: HTMLButtonElement | null = null;
let loadTextureBtn: HTMLButtonElement | null = null;
let generateTextureBtn: HTMLButtonElement | null = null;
let clearTextureBtn: HTMLButtonElement | null = null;
let exportTextureBtn: HTMLButtonElement | null = null;
let groupPreviewMask: HTMLDivElement | null = null;

// renderer3d 方法引用（由 main.ts 注入）
let renderer3dRef: {
  isLightEnabled: () => boolean;
  isEdgesEnabled: () => boolean;
  isSeamsEnabled: () => boolean;
  isFacesEnabled: () => boolean;
  isTextureEnabled: () => boolean;
  getBBoxVisible: () => boolean;
  setFacesEnabled: (enabled: boolean) => void;
  setTextureEnabled: (enabled: boolean) => void;
  setEdgesEnabled: (enabled: boolean) => void;
  setSeamsEnabled: (enabled: boolean) => void;
} | null = null;

// 内部状态
let edgesEnabledBeforeEditingSeam: boolean | null = null;
let seamsEnabledBeforeEditingSeam: boolean | null = null;

// hasTextures 函数引用（由 main.ts 注入）
let hasTexturesRef: (() => boolean) | null = null;

// refreshToggleTextLabels 函数引用
let refreshToggleTextLabelsRef: (() => void) | null = null;

export function setRefreshToggleTextLabelsRef(ref: () => void) {
  refreshToggleTextLabelsRef = ref;
}

export function setHasTexturesRef(ref: () => boolean) {
  hasTexturesRef = ref;
}

export function setToolbarElements(
  elements: {
    textureToggle: HTMLButtonElement | null;
    lightToggle: HTMLButtonElement | null;
    edgesToggle: HTMLButtonElement | null;
    seamsToggle: HTMLButtonElement | null;
    facesToggle: HTMLButtonElement | null;
    bboxToggle: HTMLButtonElement | null;
    loadTextureBtn?: HTMLButtonElement | null;
    generateTextureBtn?: HTMLButtonElement | null;
    clearTextureBtn?: HTMLButtonElement | null;
    exportTextureBtn?: HTMLButtonElement | null;
    groupPreviewMask?: HTMLDivElement | null;
  },
) {
  textureToggle = elements.textureToggle;
  lightToggle = elements.lightToggle;
  edgesToggle = elements.edgesToggle;
  seamsToggle = elements.seamsToggle;
  facesToggle = elements.facesToggle;
  bboxToggle = elements.bboxToggle;
  if (elements.loadTextureBtn !== undefined) loadTextureBtn = elements.loadTextureBtn;
  if (elements.generateTextureBtn !== undefined) generateTextureBtn = elements.generateTextureBtn;
  if (elements.clearTextureBtn !== undefined) clearTextureBtn = elements.clearTextureBtn;
  if (elements.exportTextureBtn !== undefined) exportTextureBtn = elements.exportTextureBtn;
  if (elements.groupPreviewMask !== undefined) groupPreviewMask = elements.groupPreviewMask;
}

export function setRendererRef(
  ref: typeof renderer3dRef,
) {
  renderer3dRef = ref;
}

export function createRefreshToggleTextLabels(): () => void {
  return () => {
    if (!renderer3dRef) return;
    refreshToggleTexts([
      { btn: lightToggle, keyOn: "toolbar.left.light.on", keyOff: "toolbar.left.light.off", isOn: () => renderer3dRef!.isLightEnabled() },
      { btn: edgesToggle, keyOn: "toolbar.left.wireframe.on", keyOff: "toolbar.left.wireframe.off", isOn: () => renderer3dRef!.isEdgesEnabled() },
      { btn: seamsToggle, keyOn: "toolbar.left.seam.on", keyOff: "toolbar.left.seam.off", isOn: () => renderer3dRef!.isSeamsEnabled() },
      { btn: facesToggle, keyOn: "toolbar.left.surface.on", keyOff: "toolbar.left.surface.off", isOn: () => renderer3dRef!.isFacesEnabled() },
      { btn: textureToggle, keyOn: "toolbar.left.texture.on", keyOff: "toolbar.left.texture.off", isOn: () => renderer3dRef!.isTextureEnabled() },
      { btn: bboxToggle, keyOn: "toolbar.left.bbox.on", keyOff: "toolbar.left.bbox.off", isOn: () => renderer3dRef!.getBBoxVisible() },
    ]);
  };
}

// 处理工作区状态变化时的工具栏更新
export function handleWorkspaceStateChange(
  current: WorkspaceState,
  previous: WorkspaceState,
) {
  const r3d = renderer3dRef;
  if (!r3d) return;

  const isPreview = current === "previewGroupModel";
  const enteringEditingSeam = current === "editingSeam" && previous !== "editingSeam";
  const leavingEditingSeam = previous === "editingSeam" && current !== "editingSeam";
  const enteringEditingTexture = current === "editingTexture" && previous !== "editingTexture";
  const enterEditingGroup = current === "editingGroup" && previous !== "editingGroup";
  const enterNormal = current === "normal" && previous !== "normal";

  // 进入"贴图编辑"状态时总是打开面渲染和贴图渲染
  if (enteringEditingTexture) {
    r3d.setFacesEnabled(true);
    r3d.setTextureEnabled(true);
  }
  if (enteringEditingSeam) {
    edgesEnabledBeforeEditingSeam = r3d.isEdgesEnabled();
    seamsEnabledBeforeEditingSeam = r3d.isSeamsEnabled();
    r3d.setEdgesEnabled(false);
    r3d.setSeamsEnabled(true);
  }
  if (leavingEditingSeam) {
    if (edgesEnabledBeforeEditingSeam !== null) {
      r3d.setEdgesEnabled(edgesEnabledBeforeEditingSeam);
    }
    if (seamsEnabledBeforeEditingSeam !== null) {
      r3d.setSeamsEnabled(seamsEnabledBeforeEditingSeam);
    }
    edgesEnabledBeforeEditingSeam = null;
    seamsEnabledBeforeEditingSeam = null;
  }
  if (enterEditingGroup) {
    r3d.setTextureEnabled(false);
  }
  if (enterNormal) {
    if (hasTexturesRef?.()) r3d.setTextureEnabled(true);
  }

  // 根据工作模式显示/隐藏工具栏按钮
  const isEditingTexture = current === "editingTexture";
  const isEditingSeam = current === "editingSeam";
  const hasTexture = hasTexturesRef?.() ?? false;

  // "载入贴图"按钮仅在"编辑贴图"状态下显示
  loadTextureBtn?.classList.toggle("hidden", !isEditingTexture || hasTexture);
  // "生成贴图"按钮仅在"编辑贴图"状态下且没有贴图时显示
  generateTextureBtn?.classList.toggle("hidden", !isEditingTexture || hasTexture);
  // "清除贴图"按钮仅在"编辑贴图"状态下且已有贴图时显示
  clearTextureBtn?.classList.toggle("hidden", !isEditingTexture || !hasTexture);
  // "导出贴图"按钮仅在"编辑贴图"状态下且已有贴图时显示
  exportTextureBtn?.classList.toggle("hidden", !isEditingTexture || !hasTexture);
  // "贴图渲染"按钮在"贴图编辑"状态下隐藏
  textureToggle?.classList.toggle("hidden", isEditingTexture || !hasTexture);
  // "包围盒"按钮在"贴图编辑"状态下隐藏
  bboxToggle?.classList.toggle("hidden", isEditingTexture || isPreview);
  // "线框"、"拼接边"按钮在"拼接边编辑"状态下隐藏
  edgesToggle?.classList.toggle("hidden", isEditingSeam);
  seamsToggle?.classList.toggle("hidden", isEditingSeam);
  // "面渲染"按钮在"贴图编辑"状态下隐藏
  facesToggle?.classList.toggle("hidden", isEditingTexture);

  const disableEdgeControls = isEditingSeam;
  edgesToggle?.classList.toggle("active", r3d.isEdgesEnabled());
  seamsToggle?.classList.toggle("active", r3d.isSeamsEnabled());
  textureToggle?.classList.toggle("active", r3d.isTextureEnabled());
  facesToggle?.classList.toggle("active", r3d.isFacesEnabled());
  if (edgesToggle) edgesToggle.disabled = disableEdgeControls;
  if (seamsToggle) seamsToggle.disabled = disableEdgeControls;
  groupPreviewMask?.classList.toggle("hidden", !disableEdgeControls);

  if (isPreview) {
    bboxToggle?.classList.remove("active");
    refreshToggleTextLabelsRef?.();
  } else {
    const visible = (r3d as any).getBBoxVisible?.() ?? false;
    bboxToggle?.classList.toggle("active", visible);
    refreshToggleTextLabelsRef?.();
  }
}
