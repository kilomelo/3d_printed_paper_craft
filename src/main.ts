// 应用入口与编排层：负责初始化页面结构、事件总线订阅、组/拼缝控制器与渲染器的装配，并绑定 UI 交互。
// 先导入组件 CSS（基础样式），再导入应用样式（可覆盖基础样式）
import "./components/segmentedControl.css";
import "./components/holdButton.css";
import "./style.css";
import packageJson from "../package.json";
import { inject } from "@vercel/analytics";
import { Color } from "three";
import { type WorkspaceState, getWorkspaceState, setWorkspaceState } from "./types/workspaceState.js";
import { createLog } from "./modules/log";
import { createRenderer3D } from "./modules/renderer3d";
import { createGroupController } from "./modules/groupController";
import { appEventBus } from "./modules/eventBus";
import { createGroupUI } from "./modules/groupUI";
import { createRenderer2D } from "./modules/renderer2d";
import { createUnfold2dManager } from "./modules/unfold2dManager";
import { createGeometryContext, snapGeometryPositions } from "./modules/geometry";
import { build3dppcData, download3dppc, type PPCFile } from "./modules/ppc";
import { createSettingsUI } from "./modules/settingsUI";
import { SETTINGS_LIMITS } from "./modules/settings";
import { exportEdgeJoinTypes, getModel, importEdgeJoinTypes } from "./modules/model";
import {
  onWorkerBusyChange,
} from "./modules/replicad/replicadWorkerClient";
import { buildTabClip } from "./modules/replicad/replicadModeling";
import { startNewProject, getCurrentProject } from "./modules/project";
import { historyManager } from "./modules/history";
import { loadRawObject } from "./modules/fileLoader";
import { loadTextureFromFile, addTexture, getTextureCount, hasTextures, replaceTexture, createThreeTexture, getAllTextures, clearAllTextures, generateUVTexture } from "./modules/textureManager";
import type { Snapshot, ProjectState } from "./types/historyTypes.js";
import { exportGroupsData, getGroupColorCursor } from "./modules/groups";
import { importSettings, getSettings, resetSettings, applySettings } from "./modules/settings";
import { createOperationHints } from "./modules/operationHints";
import { createPreviewMeshCacheManager } from "./modules/previewMeshCache";
import { bindHistorySystem } from "./modules/historyBindings";
import { bindGroupPreviewActions } from "./modules/groupPreviewActions";
import { downloadBlob } from "./modules/gifRecorder";
import { loadHomeChangelog } from "./modules/homeChangelog";
import { createGifCaptureController } from "./modules/gifCapture";
import { createHoldButton } from "./components/createHoldButton";
import { createSegmentedControl } from "./components/createSegmentedControl";
import "./styles/home.css";
import { renderHomeSection } from "./templates/homeMarkup";
import { initI18n, t, getCurrentLang, setLanguage, onLanguageChanged } from "./modules/i18n";

const VERSION = packageJson.version ?? "0.0.0.0";

const previewMeshCacheManager = createPreviewMeshCacheManager();
const limits = SETTINGS_LIMITS;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

let langToggleBtn: HTMLButtonElement | null = null;
let langToggleGlobalBtn: HTMLButtonElement | null = null;
let refreshToggleTextLabels: (() => void) | null = null;
let workerBusy = false;
let viewerModeControl: ReturnType<typeof createSegmentedControl> | null = null;
let edgesEnabledBeforeEditingSeam: boolean | null = null;
let seamsEnabledBeforeEditingSeam: boolean | null = null;

const ENABLE_GIF_RECORDER_TOOL = new URLSearchParams(window.location.search).get("gifTool") === "1";
const resolveGifCaptureFps = () => {
  const raw = new URLSearchParams(window.location.search).get("gifFps");
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 60) return Math.round(parsed);
  return 45;
};
const GIF_CAPTURE_FPS = resolveGifCaptureFps();

// 右侧展开组预览区的缓存有效性指示器。
// 规则很简单：
// - 当前预览组在当前历史时间点上存在有效 mesh 缓存：显示 "✓"
// - 否则显示 "*"
//
// 它不区分“缓存来自 STL 导出”还是“缓存来自预览建模”，因为两者底层复用的是同一套预览 mesh 缓存。
const refreshPreviewMeshCacheIndicator = () => {
  if (!groupPreviewCacheIndicator) return;
  const groupId = groupController.getPreviewGroupId();
  const currentHistoryUid = historyManager.getCurrentSnapshotUid() ?? -1;
  const hasActiveCache = previewMeshCacheManager.hasActiveCachedPreviewMesh(groupId, currentHistoryUid);
  groupPreviewCacheIndicator.textContent = hasActiveCache ? "✓ " : "-";
};

const setProjectNameLabel = (name: string) => {
  if (projectNameLabel) {
    projectNameLabel.textContent = isFileSaved ? `${name}` : `${name} *`;
  }
};

const refreshToggleTexts = (
  toggles: {
    btn: HTMLButtonElement | null;
    keyOn: string;
    keyOff: string;
    isOn: () => boolean;
  }[],
) => {
  toggles.forEach(({ btn, keyOn, keyOff, isOn }) => {
    if (!btn) return;
    btn.textContent = t(isOn() ? keyOn : keyOff);
  });
};

const applyI18nTexts = () => {
  document.title = t("app.title");

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    el.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-href]").forEach((el) => {
    const key = el.dataset.i18nHref;
    if (!key) return;
    const href = t(key);
    if (href && el instanceof HTMLAnchorElement) {
      el.href = href;
    }
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (!key) return;
    el.title = t(key);
  });
  homeDemoOptionsEl?.setAttribute("aria-label", "Demo project selector");
  const layerHeightDesc = document.querySelector<HTMLElement>('[data-i18n="settings.layerHeight.desc"]');
  if (layerHeightDesc) {
    layerHeightDesc.textContent = t("settings.layerHeight.desc", {
      max: limits.layerHeight.max,
    });
  }
  const connectionDesc = document.querySelector<HTMLElement>('[data-i18n="settings.connectionLayers.desc"]');
  if (connectionDesc) {
    connectionDesc.textContent = t("settings.connectionLayers.desc", {
      min: limits.connectionLayers.min,
      max: limits.connectionLayers.max,
    });
  }
  const bodyLayersDesc = document.querySelector<HTMLElement>('[data-i18n="settings.bodyLayers.desc"]');
  if (bodyLayersDesc) {
    bodyLayersDesc.textContent = t("settings.bodyLayers.desc", {
      min: limits.bodyLayers.min,
      max: limits.bodyLayers.max,
    });
  }
  const joinTypeDesc = document.querySelector<HTMLElement>('[data-i18n="settings.joinType.desc"]');
  if (joinTypeDesc) {
    joinTypeDesc.textContent = t("settings.joinType.desc");
  }
  const clawInterlockingAngleDesc = document.querySelector<HTMLElement>('[data-i18n="settings.clawInterlockingAngle.desc"]');
  if (clawInterlockingAngleDesc) {
    clawInterlockingAngleDesc.textContent = t("settings.clawInterlockingAngle.desc", {
      min: limits.clawInterlockingAngle.min,
      max: limits.clawInterlockingAngle.max,
    });
  }
  const clawTargetRadiusDesc = document.querySelector<HTMLElement>('[data-i18n="settings.clawTargetRadius.desc"]');
  if (clawTargetRadiusDesc) {
    clawTargetRadiusDesc.textContent = t("settings.clawTargetRadius.desc", {
      min: limits.clawTargetRadius.min,
      max: limits.clawTargetRadius.max,
    });
  }
  const clawRadiusAdaptiveDesc = document.querySelector<HTMLElement>('[data-i18n="settings.clawRadiusAdaptive.desc"]');
  if (clawRadiusAdaptiveDesc) {
    clawRadiusAdaptiveDesc.textContent = t("settings.clawRadiusAdaptive.desc");
  }
  const clawWidthDesc = document.querySelector<HTMLElement>('[data-i18n="settings.clawWidth.desc"]');
  if (clawWidthDesc) {
    clawWidthDesc.textContent = t("settings.clawWidth.desc", {
      min: limits.clawWidth.min,
      max: limits.clawWidth.max,
    });
  }
  const clawFitGapDesc = document.querySelector<HTMLElement>('[data-i18n="settings.clawFitGap.desc"]');
  if (clawFitGapDesc) {
    clawFitGapDesc.textContent = t("settings.clawFitGap.desc", {
      min: limits.clawFitGap.min,
      max: limits.clawFitGap.max,
    });
  }
  const tabWidthDesc = document.querySelector<HTMLElement>('[data-i18n="settings.tabWidth.desc"]');
  if (tabWidthDesc) {
    tabWidthDesc.textContent = t("settings.tabWidth.desc", {
      min: limits.tabWidth.min,
      max: limits.tabWidth.max,
    });
  }
  const tabThicknessDesc = document.querySelector<HTMLElement>('[data-i18n="settings.tabThickness.desc"]');
  if (tabThicknessDesc) {
    tabThicknessDesc.textContent = t("settings.tabThickness.desc", {
      min: limits.tabThickness.min,
      max: limits.tabThickness.max,
    });
  }
  const minFoldAngleThresholdDesc = document.querySelector<HTMLElement>('[data-i18n="settings.minFoldAngleThreshold.desc"]');
  if (minFoldAngleThresholdDesc) {
    minFoldAngleThresholdDesc.textContent = t("settings.minFoldAngleThreshold.desc");
  }
  const tabClipDesc = document.querySelector<HTMLElement>('[data-i18n="settings.tabClipGap.desc"]');
  if (tabClipDesc) {
    tabClipDesc.textContent = t("settings.tabClipGap.desc", {
      min: limits.tabClipGap.min,
      max: limits.tabClipGap.max,
    });
  }
  const clipGapAdjustDesc = document.querySelector<HTMLElement>('[data-i18n="settings.clipGapAdjusts.desc"]');
  if (clipGapAdjustDesc) {
    clipGapAdjustDesc.textContent = t("settings.clipGapAdjusts.desc");
  }
  const hollowDesc = document.querySelector<HTMLElement>('[data-i18n="settings.hollow.desc"]');
  if (hollowDesc) {
    hollowDesc.textContent = t("settings.hollow.desc");
  }
  const wireframeDesc = document.querySelector<HTMLElement>('[data-i18n="settings.wireframeThickness.desc"]');
  if (wireframeDesc) {
    wireframeDesc.textContent = t("settings.wireframeThickness.desc", {
      min: limits.wireframeThickness.min,
      max: limits.wireframeThickness.max,
    });
  }
  void loadHomeChangelog(homeChangelogList, t);
  void loadHomeDemoProjects();
  renderHomeDemoOptions();
  refreshToggleTextLabels?.();
  const viewerModeAriaLabel = t("viewer.mode.ariaLabel");
  if (viewerModeControl) {
    viewerModeControl.el.setAttribute("aria-label", viewerModeAriaLabel);
    viewerModeControl.setItemLabel("view", t("workspace.mode.normal"));
    viewerModeControl.setItemLabel("group-edit", t("workspace.mode.editingGroup"));
    viewerModeControl.setItemLabel("seam-edit", t("workspace.mode.editingSeam"));
    viewerModeControl.setItemLabel("texture-edit", t("workspace.mode.editingTexture"));
  }
  groupUI.render(buildGroupUIState());
  // 语言切换时刷新历史面板条目文本
  historyPanelUI?.render();
  deleteHold?.setLabel(t("preview.right.groupDelete.btn"));
};

// 文件已保存状态
let isFileSaved = true;
const setFileSaved = (value: boolean) => {
  isFileSaved = value;
  setProjectNameLabel(getCurrentProject().name ?? "未命名工程");
};

let historyPanelUI: ReturnType<typeof bindHistorySystem> | null = null;
let operationHints: ReturnType<typeof createOperationHints> | null = null;
let deleteHold: ReturnType<typeof createHoldButton> | null = null;
const captureProjectState = (): ProjectState => ({
  groups: exportGroupsData(),
  colorCursor: getGroupColorCursor(),
  previewGroupId: groupController.getPreviewGroupId(),
  settings: getSettings(),
  groupVisibility: groupController.getGroupVisibilityEntries(),
  edgeJoinTypes: exportEdgeJoinTypes(),
});

const applyProjectState = (snap: Snapshot) => {
  const state = snap.data;
  const importedGroups = state.groups.map((g) => ({
    id: g.id,
    faces: Array.from(g.faces),
    color: typeof g.color === "number" ? `#${g.color.toString(16).padStart(6, "0")}` : g.color,
    name: g.name,
    placeAngle: g.placeAngle,
  })) as NonNullable<PPCFile["groups"]>;
  groupController.applyImportedGroups(importedGroups, state.colorCursor);
  const fallbackGroupId = importedGroups[0]?.id ?? groupController.getPreviewGroupId();
  groupController.setPreviewGroupId(state.previewGroupId ?? fallbackGroupId);
  if (state.groupVisibility) {
    groupController.applyGroupVisibility(state.groupVisibility);
  }
  importSettings(state.settings);
  importEdgeJoinTypes(state.edgeJoinTypes);
  groupUI.render(buildGroupUIState());
};

// 菜单按钮图标
const menu_open_IconSvg = `
<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M20 21H3C2.44772 21 2 20.5523 2 20L2 4C2 3.44772 2.44771 3 3 3H7.73381C8.08507 3 8.41058 3.1843 8.5913 3.4855L9.8087 5.5145C9.98942 5.8157 10.3149 6 10.6662 6H20C20.5523 6 21 6.44772 21 7V10" stroke="#200E32" stroke-width="2" stroke-linecap="round"/>
<path d="M4.79903 10.7369L2.34449 19.7369C2.17099 20.373 2.64988 21 3.30925 21H19.2362C19.6872 21 20.0823 20.6982 20.201 20.2631L22.6555 11.2631C22.829 10.627 22.3501 10 21.6908 10H5.7638C5.31284 10 4.91769 10.3018 4.79903 10.7369Z" stroke="#200E32" stroke-width="2"/>
</svg>
`;

const menu_export_3dppc_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: MIT. Made by basicons: https://basicons.xyz/ -->
<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5 21H19C20.1046 21 21 20.1046 21 19V8.82843C21 8.29799 20.7893 7.78929 20.4142 7.41421L16.5858 3.58579C16.2107 3.21071 15.702 3 15.1716 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21Z" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7 3V8H15V3" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="12" cy="15" r="2" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const menu_export_clip_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: PD. Made by stephenhutchings: https://github.com/stephenhutchings/microns -->
<svg fill="#000000" width="800px" height="800px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" ><title>download</title><path d="M232 64L280 64 280 214 277 270 300 242 356 189 388 221 256 353 124 221 156 189 212 242 235 270 232 214 232 64ZM64 400L448 400 448 448 64 448 64 400Z" /></svg>
`;

const menu_export_stp_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: PD. Made by stephenhutchings: https://github.com/stephenhutchings/microns -->
<svg fill="#000000" width="800px" height="800px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" ><title>download</title><path d="M232 64L280 64 280 214 277 270 300 242 356 189 388 221 256 353 124 221 156 189 212 242 235 270 232 214 232 64ZM64 400L448 400 448 448 64 448 64 400Z" /></svg>
`;

const menu_export_stl_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: PD. Made by stephenhutchings: https://github.com/stephenhutchings/microns -->
<svg fill="#000000" width="800px" height="800px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" ><title>download</title><path d="M232 64L280 64 280 214 277 270 300 242 356 189 388 221 256 353 124 221 156 189 212 242 235 270 232 214 232 64ZM64 400L448 400 448 448 64 448 64 400Z" /></svg>
`;

const menu_preview_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: MIT. Made by radix-ui: https://github.com/radix-ui/icons -->
<svg width="800px" height="800px" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M10 6.5C10 8.433 8.433 10 6.5 10C4.567 10 3 8.433 3 6.5C3 4.567 4.567 3 6.5 3C8.433 3 10 4.567 10 6.5ZM9.30884 10.0159C8.53901 10.6318 7.56251 11 6.5 11C4.01472 11 2 8.98528 2 6.5C2 4.01472 4.01472 2 6.5 2C8.98528 2 11 4.01472 11 6.5C11 7.56251 10.6318 8.53901 10.0159 9.30884L12.8536 12.1464C13.0488 12.3417 13.0488 12.6583 12.8536 12.8536C12.6583 13.0488 12.3417 13.0488 12.1464 12.8536L9.30884 10.0159Z"
    fill="#000000"
  />
</svg>
`;

const menu_setting_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: MIT. Made by teenyicons: https://github.com/teenyicons/teenyicons -->
<svg width="800px" height="800px" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4.5 1C3.29052 1 2.28165 1.85888 2.05001 3L3.21071e-06 3L3.167e-06 4H2.05001C2.28165 5.14112 3.29052 6 4.5 6C5.70948 6 6.71836 5.14112 6.94999 4L15 4V3L6.94999 3C6.71836 1.85888 5.70948 1 4.5 1Z" fill="#000000"/>
<path d="M10.5 9C9.29053 9 8.28165 9.85888 8.05001 11H2.86102e-06L3.77099e-06 12H8.05001C8.28165 13.1411 9.29052 14 10.5 14C11.7095 14 12.7184 13.1411 12.95 12L15 12V11L12.95 11C12.7184 9.85888 11.7095 9 10.5 9Z" fill="#000000"/>
</svg>
`;

const menu_about_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: CC Attribution. Made by tetrisly: https://tetrisly.gumroad.com/l/freeicons -->
<svg fill="#000000" width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" d="M12,2 C17.5228475,2 22,6.4771525 22,12 C22,17.5228475 17.5228475,22 12,22 C6.4771525,22 2,17.5228475 2,12 C2,6.4771525 6.4771525,2 12,2 Z M12,4 C7.581722,4 4,7.581722 4,12 C4,16.418278 7.581722,20 12,20 C16.418278,20 20,16.418278 20,12 C20,7.581722 16.418278,4 12,4 Z M12,16 C12.5522847,16 13,16.4477153 13,17 C13,17.5522847 12.5522847,18 12,18 C11.4477153,18 11,17.5522847 11,17 C11,16.4477153 11.4477153,16 12,16 Z M12,6 C14.209139,6 16,7.790861 16,10 C16,11.7948083 14.8179062,13.3135239 13.1897963,13.8200688 L13,13.8739825 L13,14 C13,14.5522847 12.5522847,15 12,15 C11.4871642,15 11.0644928,14.6139598 11.0067277,14.1166211 L11,14 L11,13 C11,12.4871642 11.3860402,12.0644928 11.8833789,12.0067277 L12.1492623,11.9945143 C13.1841222,11.9181651 14,11.0543618 14,10 C14,8.8954305 13.1045695,8 12,8 C10.8954305,8 10,8.8954305 10,10 C10,10.5522847 9.55228475,11 9,11 C8.44771525,11 8,10.5522847 8,10 C8,7.790861 9.790861,6 12,6 Z"/>
</svg>
`;

const menu_exit_preview_IconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: CC Attribution. Made by salesforce: https://lightningdesignsystem.com/ -->
<svg fill="#000000" xmlns="http://www.w3.org/2000/svg" 
	 width="800px" height="800px" viewBox="0 0 52 52" enable-background="new 0 0 52 52" xml:space="preserve">
<path d="M48.6,23H15.4c-0.9,0-1.3-1.1-0.7-1.7l9.6-9.6c0.6-0.6,0.6-1.5,0-2.1l-2.2-2.2c-0.6-0.6-1.5-0.6-2.1,0
	L2.5,25c-0.6,0.6-0.6,1.5,0,2.1L20,44.6c0.6,0.6,1.5,0.6,2.1,0l2.1-2.1c0.6-0.6,0.6-1.5,0-2.1l-9.6-9.6C14,30.1,14.4,29,15.3,29
	h33.2c0.8,0,1.5-0.6,1.5-1.4v-3C50,23.8,49.4,23,48.6,23z"/>
</svg>
`;

app.innerHTML = `
  <main class="shell">
    <div class="version-badge version-badge-global">v${VERSION}</div>
    <button class="btn sm ghost version-lang-toggle" id="lang-toggle-global" data-i18n="language.toggle">Language: ZH</button>
    <input id="file-input" type="file" accept=".obj,.fbx,.stl,.3dppc,application/json" style="display:none" autocomplete="off" />
    <input id="texture-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" style="display:none" autocomplete="off" />

    ${renderHomeSection()}

    <section id="layout-workspace" class="page">
      <header class="editor-header">
        <div class="editor-logo">
          <img src="/android-chrome-192x192.png" alt="Logo" />
        </div>
        <div class="editor-title">
          <span class="editor-title-main" data-i18n="app.title">3D 打印纸艺</span>
          <span class="editor-title-project" id="project-name-label"></span>
        </div>
        <div class="editor-header-right">
          <button class="btn sm ghost" id="lang-toggle" data-i18n="language.toggle">Language: ZH</button>
          <div class="version-badge">v${VERSION}</div>
        </div>
      </header>
    <nav class="editor-menu">
        <button class="btn ghost hidden menu-btn-with-icon" id="exit-preview-btn"><span class="menu-btn-icon">${menu_exit_preview_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.preview.exit">退出预览</span></button>
        <button class="btn ghost menu-btn-with-icon" id="menu-open"><span class="menu-btn-icon">${menu_open_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.model.open">打开文件</span></button>
        <button class="btn ghost menu-btn-with-icon" id="export-3dppc-btn"><span class="menu-btn-icon">${menu_export_3dppc_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.save3dppc">保存工程</span></button>
        <button class="btn ghost menu-btn-with-icon" id="export-group-step-btn"><span class="menu-btn-icon">${menu_export_stp_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.export.step">导出 STEP</span></button>
        <button class="btn ghost menu-btn-with-icon" id="export-group-stl-btn"><span class="menu-btn-icon">${menu_export_stl_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.export.stl">导出 STL</span></button>
        <button class="btn ghost menu-btn-with-icon" id="export-seam-clip-btn"><span class="menu-btn-icon">${menu_export_clip_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.export.seamClamp.stl">导出固定夹</span></button>
        <button class="btn ghost menu-btn-with-icon" id="preview-group-model-btn"><span class="menu-btn-icon">${menu_preview_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.preview.group">预览展开组模型</span></button>
        <button class="btn ghost menu-btn-with-icon" id="settings-open-btn"><span class="menu-btn-icon">${menu_setting_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.project.settings">项目设置</span></button>
        <a class="btn img-btn ghost hidden" id="jump-link-btn" target="_blank" rel="noopener noreferrer">
          <img src="/demo/makerworld.png" alt="Jump Link" />
        </a>
        <div class="about-spacer"></div>
        <button class="btn ghost menu-btn-with-icon" id="about-btn"><span class="menu-btn-icon">${menu_about_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.about">帮助 & 关于</span></button>
        <div id="menu-blocker" class="menu-blocker"></div>
      </nav>
  <section class="editor-preview">
    <div class="preview-panel">
      <div class="preview-toolbar">
        <button class="btn sm" id="load-texture-btn" data-i18n="toolbar.l.loadTexture">载入贴图</button>
        <button class="btn sm" id="generate-texture-btn" data-i18n="toolbar.l.generateTexture">生成贴图</button>
        <button class="btn sm" id="clear-texture-btn" data-i18n="toolbar.l.clearTexture">清除贴图</button>
        <button class="btn sm" id="export-texture-btn" data-i18n="toolbar.l.exportTexture">导出贴图</button>
        <button class="btn sm" id="reset-view-btn" data-i18n="toolbar.l.resetView">重置视角</button>
        <button class="btn sm toggle" id="texture-toggle">贴图：关</button>
        <button class="btn sm toggle active" id="light-toggle">光源：开</button>
        <button class="btn sm toggle" id="edges-toggle">线框：开</button>
        <button class="btn sm toggle" id="seams-toggle">拼接边：开</button>
        <button class="btn sm toggle active" id="faces-toggle">面渲染：开</button>
        <button class="btn sm toggle" id="bbox-toggle">包围盒：关</button>
        <button class="btn sm ghost ${ENABLE_GIF_RECORDER_TOOL ? "" : "hidden"}" id="gif-record-btn">录制GIF</button>
        <div class="toolbar-spacer"></div>
        <span class="toolbar-stat" id="tri-counter">渲染负载：0</span>
      </div>
      <div class="preview-area" id="viewer">
        <div class="viewer-mode-slot" id="viewer-mode-slot"></div>
        <div id="history-panel" class="history-panel hidden">
          <div id="history-list" class="history-list"></div>
        </div>
      </div>
    </div>
    <div class="preview-panel">
          <div class="preview-toolbar">
            <div class="group-tabs" id="group-tabs"></div>
            <div class="toolbar-spacer"></div>
            <button class="btn tab-add" id="group-add" data-i18n-title="toolbar.right.groupAdd.tooltip" title="添加展开组">+</button>
          </div>
          <div class="preview-area" id="group-preview">
            <div class="overlay-group-meta">
              <button class="overlay-btn color-swatch" id="group-color-btn" data-i18n-title="preview.right.groupColor.tooltip" title="修改组颜色"></button>
              <button class="overlay-btn overlay-visibility" id="group-visibility-toggle" data-i18n-title="preview.right.groupVisibility.tooltip" title="显示/隐藏展开组">
                <svg class="icon-visible" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
                  <path d="M-896-256H384v800H-896z" style="fill:none"/>
                  <path d="M32.513 13.926C43.087 14.076 51.654 23.82 56 32c0 0-1.422 2.892-2.856 4.895a46.344 46.344 0 0 1-2.191 2.826 41.265 41.265 0 0 1-1.698 1.898c-5.237 5.5-12.758 9.603-20.7 8.01C19.732 47.859 12.823 40.131 8.497 32c0 0 1.248-2.964 2.69-4.964a45.105 45.105 0 0 1 2.034-2.617 41.618 41.618 0 0 1 1.691-1.897c4.627-4.876 10.564-8.63 17.601-8.596Zm-.037 4c-5.89-.022-10.788 3.267-14.663 7.35a37.553 37.553 0 0 0-1.527 1.713 41.472 41.472 0 0 0-1.854 2.386c-.544.755-1.057 1.805-1.451 2.59 3.773 6.468 9.286 12.323 16.361 13.742 6.563 1.317 12.688-2.301 17.016-6.846a37.224 37.224 0 0 0 1.534-1.715c.7-.833 1.366-1.694 1.999-2.579.557-.778 1.144-1.767 1.588-2.567-3.943-6.657-10.651-13.944-19.003-14.074Z"/>
                  <path d="M32.158 23.948c4.425 0 8.018 3.593 8.018 8.017a8.021 8.021 0 0 1-8.018 8.017 8.021 8.021 0 0 1-8.017-8.017 8.022 8.022 0 0 1 8.017-8.017Zm0 4.009a4.01 4.01 0 0 1 4.009 4.008 4.01 4.01 0 0 1-4.009 4.009 4.01 4.01 0 0 1-4.008-4.009 4.01 4.01 0 0 1 4.008-4.008Z"/>
                </svg>
                <svg class="icon-hidden hidden" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
                  <path d="M-960-256H320v800H-960z" style="fill:none"/>
                  <path d="m13.673 10.345-3.097 3.096 39.853 39.854 3.097-3.097-39.853-39.853Z"/>
                  <path d="m17.119 19.984 2.915 2.915c-3.191 2.717-5.732 6.099-7.374 9.058l-.005.01c4.573 7.646 11.829 14.872 20.987 13.776 2.472-.296 4.778-1.141 6.885-2.35l2.951 2.95c-4.107 2.636-8.815 4.032-13.916 3.342-9.198-1.244-16.719-8.788-21.46-17.648 2.226-4.479 5.271-8.764 9.017-12.053Zm6.63-4.32c2.572-1.146 5.355-1.82 8.327-1.868.165-.001 2.124.092 3.012.238a18.45 18.45 0 0 1 1.659.35C45.472 16.657 51.936 24.438 56 32.037c-1.705 3.443-3.938 6.398-6.601 9.277l-2.827-2.827c1.967-2.12 3.622-4.161 4.885-6.45 0 0-1.285-2.361-2.248-3.643a37.988 37.988 0 0 0-1.954-2.395c-.54-.608-2.637-2.673-3.136-3.103-3.348-2.879-7.279-5.138-11.994-5.1-1.826.029-3.582.389-5.249.995l-3.127-3.127Z" style="fill-rule:nonzero"/>
                  <path d="m25.054 27.92 2.399 2.398a4.843 4.843 0 0 0 6.114 6.114l2.399 2.399A8.02 8.02 0 0 1 25.054 27.92Zm6.849-4.101.148-.002a8.021 8.021 0 0 1 8.017 8.017l-.001.148-8.164-8.163Z"/>
                </svg>
              </button>
              <span class="overlay-label group-faces-count" id="group-faces-count">面数量：0</span>
            </div>
            <div class="overlay-cache-indicator" id="group-preview-cache-indicator" aria-hidden="true">*</div>
            <div class="tab-delete-slot" id="group-delete-slot"></div>
            <div id="group-preview-empty" class="preview-2d-empty hidden" data-i18n="preview.right.placeholder">
              点击【编辑展开组】按钮进行编辑
            </div>
            <input type="color" id="group-color-input" class="color-input" autocomplete="off" />
          </div>
          <div id="group-preview-mask" class="group-preview-mask hidden" aria-hidden="true"></div>
        </div>
      </section>
  </section>
</main>
  <div id="loading-overlay" class="loading-overlay hidden"></div>
  <div id="log-panel" class="log-panel hidden">
    <div id="log-list" class="log-list"></div>
  </div>
  <div id="about-overlay" class="about-overlay hidden">
    <div id="about-modal" class="about-modal">
      <div class="about-body" id="about-content" data-i18n="about.loading">加载中...</div>
      <div class="about-footer">
        <button id="about-back-btn" class="btn primary" data-i18n="about.close.btn">返回</button>
      </div>
    </div>
  </div>

  <div id="settings-overlay" class="settings-overlay hidden">
    <div class="settings-modal">
      <div class="settings-header">
        <div class="settings-title" data-i18n="settings.title">项目设置</div>
      </div>
        <div class="settings-body">
          <div class="settings-nav">
          <button class="settings-nav-item active" id="settings-nav-basic" data-i18n="settings.nav.basic">基础设置</button>
          <button class="settings-nav-item" id="settings-nav-interlocking" data-i18n="settings.nav.interlocking">咬合拼接</button>
          <button class="settings-nav-item" id="settings-nav-clip" data-i18n="settings.nav.clip">卡扣拼接</button>
          <button class="settings-nav-item" id="settings-nav-experiment" data-i18n="settings.nav.experimental">实验设置</button>
        </div>
        <div class="settings-content">
          <div class="settings-panel active" id="settings-panel-basic">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-scale" class="setting-label" data-i18n="settings.scale.label">缩放比例</label>
                <span class="setting-desc" data-i18n="settings.scale.desc">模型整体缩放比例，太小会导致打印文件生成失败</span>
              </div>
              <div class="setting-field">
                <input id="setting-scale" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-scale-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-layer-height" class="setting-label" data-i18n="settings.layerHeight.label">打印层高</label>
                <span class="setting-desc" data-i18n="settings.layerHeight.desc">实际打印时的层高设置，最大${limits.layerHeight.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-layer-height" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-layer-height-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.connectionLayers.label">连接层数</span>
                <span class="setting-desc" data-i18n="settings.connectionLayers.desc">面之间连接处的层数，${limits.connectionLayers.min}-${limits.connectionLayers.max}</span>
              </div>
              <div class="setting-field">
                <div class="setting-counter-group">
                  <button id="setting-connection-layers-dec" class="btn settings-inline-btn">-</button>
                  <span id="setting-connection-layers-value" class="setting-range-value"></span>
                  <button id="setting-connection-layers-inc" class="btn settings-inline-btn">+</button>
                </div>
                <button id="setting-connection-layers-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.bodyLayers.label">主体额外层数</span>
                <span class="setting-desc" data-i18n="settings.bodyLayers.desc">面主体的额外层数，${limits.bodyLayers.min}-${limits.bodyLayers.max}</span>
              </div>
              <div class="setting-field">
                <div class="setting-counter-group">
                  <button id="setting-body-layers-dec" class="btn settings-inline-btn">-</button>
                  <span id="setting-body-layers-value" class="setting-range-value"></span>
                  <button id="setting-body-layers-inc" class="btn settings-inline-btn">+</button>
                </div>
                <button id="setting-body-layers-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.joinType.label">拼接方式</span>
                <span class="setting-desc" data-i18n="settings.joinType.desc">拼接边的默认连接方式</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-join-type-interlocking" class="btn settings-inline-btn" data-i18n="settings.joinType.interlocking">咬合</button>
                  <button id="setting-join-type-clip" class="btn settings-inline-btn" data-i18n="settings.joinType.clip">卡扣</button>
                </div>
                <button id="setting-join-type-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-min-fold-angle-threshold" class="setting-label" data-i18n="settings.minFoldAngleThreshold.label">折痕最小角度阈值</label>
                <span class="setting-desc" data-i18n="settings.minFoldAngleThreshold.desc">角度小于该数值的三角面之间不会生成折痕</span>
              </div>
              <div class="setting-field">
                <input id="setting-min-fold-angle-threshold" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-min-fold-angle-threshold-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-interlocking">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-interlocking-angle" class="setting-label" data-i18n="settings.clawInterlockingAngle.label">咬合角度</label>
                <span class="setting-desc" data-i18n="settings.clawInterlockingAngle.desc">抱爪的互锁角度，最小${limits.clawInterlockingAngle.min}，最大${limits.clawInterlockingAngle.max}</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-interlocking-angle" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-interlocking-angle-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-target-radius" class="setting-label" data-i18n="settings.clawTargetRadius.label">目标抱爪半径</label>
                <span class="setting-desc" data-i18n="settings.clawTargetRadius.desc">抱爪的期望大小，最小${limits.clawTargetRadius.min}，最大${limits.clawTargetRadius.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-target-radius" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-target-radius-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.clawRadiusAdaptive.label">抱爪半径自适应</span>
                <span class="setting-desc" data-i18n="settings.clawRadiusAdaptive.desc">根据拼接夹角调整抱爪半径，改善拼接牢固度</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-claw-radius-adaptive-off" class="btn settings-inline-btn" data-i18n="settings.clawRadiusAdaptive.off">关闭</button>
                  <button id="setting-claw-radius-adaptive-on" class="btn settings-inline-btn" data-i18n="settings.clawRadiusAdaptive.on">开启</button>
                </div>
                <button id="setting-claw-radius-adaptive-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-width" class="setting-label" data-i18n="settings.clawWidth.label">抱爪宽度</label>
                <span class="setting-desc" data-i18n="settings.clawWidth.desc">单个抱爪的宽度，最小${limits.clawWidth.min}，最大${limits.clawWidth.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-width" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-width-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-fit-gap" class="setting-label" data-i18n="settings.clawFitGap.label">抱爪配合间隙</label>
                <span class="setting-desc" data-i18n="settings.clawFitGap.desc">抱爪的松紧程度，越大越容易安装，${limits.clawFitGap.min}-${limits.clawFitGap.max}</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-fit-gap" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-fit-gap-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-clip">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-tab-width" class="setting-label" data-i18n="settings.tabWidth.label">拼接边舌片宽度</label>
                <span class="setting-desc" data-i18n="settings.tabWidth.desc">用于拼接边粘接的舌片宽度，${limits.tabWidth.min}-${limits.tabWidth.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-tab-width" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-tab-width-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-tab-thickness" class="setting-label" data-i18n="settings.tabThickness.label">拼接边舌片厚度</label>
                <span class="setting-desc" data-i18n="settings.tabThickness.desc">用于拼接边粘接的舌片厚度，${limits.tabThickness.min}-${limits.tabThickness.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-tab-thickness" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-tab-thickness-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-tab-clip-gap" class="setting-label" data-i18n="settings.tabClipGap.label">夹子配合间隙</label>
                <span class="setting-desc" data-i18n="settings.tabClipGap.desc">连接舌片的夹子松紧程度，值越大越容易安装，${limits.tabClipGap.min}-${limits.tabClipGap.max}</span>
              </div>
              <div class="setting-field">
                <input id="setting-tab-clip-gap" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-tab-clip-gap-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.clipGapAdjusts.label">夹子厚度</span>
                <span class="setting-desc" data-i18n="settings.clipGapAdjusts.desc">夹子模型的配合间隙自动根据舌片厚度反比补偿</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-clip-thickness-normal" class="btn settings-inline-btn" data-i18n="settings.clipGapAdjusts.off">标准</button>
                  <button id="setting-clip-thickness-narrow" class="btn settings-inline-btn" data-i18n="settings.clipGapAdjusts.on">薄夹</button>
                </div>
                <button id="setting-clip-thickness-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-experiment">
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.hollow.label">镂空风格</span>
                <span class="setting-desc" data-i18n="settings.hollow.desc">去除三角面的中间部分</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-hollow-off" class="btn settings-inline-btn" data-i18n="settings.hollow.off">关闭</button>
                  <button id="setting-hollow-on" class="btn settings-inline-btn" data-i18n="settings.hollow.on">开启</button>
                </div>
                <button id="setting-hollow-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-wireframe-thickness" class="setting-label" data-i18n="settings.wireframeThickness.label">线框粗细</label>
                <span class="setting-desc" data-i18n="settings.wireframeThickness.desc">镂空风格下线框的粗细，${limits.wireframeThickness.min}-${limits.wireframeThickness.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-wireframe-thickness" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-wireframe-thickness-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-footer">
        <button id="settings-cancel-btn" class="btn ghost settings-action" data-i18n="settings.cancel.btn">取消</button>
        <button id="settings-confirm-btn" class="btn primary settings-action" data-i18n="settings.confirm.btn">确定</button>
      </div>
    </div>
  </div>

  <div id="rename-overlay" class="rename-overlay hidden">
    <div id="rename-modal" class="rename-modal">
      <div class="settings-header">
        <div class="settings-title">修改展开组名称</div>
      </div>
      <div class="settings-body rename-body">
        <input id="rename-input" type="text" autocomplete="off" />
      </div>
      <div class="settings-footer">
        <button id="rename-cancel-btn" class="btn ghost settings-action">取消</button>
        <button id="rename-confirm-btn" class="btn primary settings-action">确定</button>
      </div>
    </div>
  </div>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const viewerModeSlot = document.querySelector<HTMLDivElement>("#viewer-mode-slot");
const projectNameLabel = document.getElementById("project-name-label");
const logListEl = document.querySelector<HTMLDivElement>("#log-list");
const logPanelEl = document.querySelector<HTMLDivElement>("#log-panel");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const textureInput = document.querySelector<HTMLInputElement>("#texture-input");
const homeStartBtn = document.querySelector<HTMLButtonElement>("#home-start");
const homeDemoBtn = document.querySelector<HTMLButtonElement>("#home-demo");
const homeDemoOptionsEl = document.querySelector<HTMLDivElement>("#home-demo-options");
const homeDemoEntry = document.querySelector<HTMLDivElement>("#home-demo-entry");
const homeChangelogList = document.querySelector<HTMLDivElement>("#home-changelog-list");
const exitPreviewBtn = document.querySelector<HTMLButtonElement>("#exit-preview-btn");
const menuOpenBtn = document.querySelector<HTMLButtonElement>("#menu-open");
const menuBlocker = document.querySelector<HTMLDivElement>("#menu-blocker");
const editorPreviewEl = document.querySelector<HTMLElement>(".editor-preview");
const loadTextureBtn = document.querySelector<HTMLButtonElement>("#load-texture-btn");
const generateTextureBtn = document.querySelector<HTMLButtonElement>("#generate-texture-btn");
const clearTextureBtn = document.querySelector<HTMLButtonElement>("#clear-texture-btn");
const exportTextureBtn = document.querySelector<HTMLButtonElement>("#export-texture-btn");
const resetViewBtn = document.querySelector<HTMLButtonElement>("#reset-view-btn");
const textureToggle = document.querySelector<HTMLButtonElement>("#texture-toggle");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const seamsToggle = document.querySelector<HTMLButtonElement>("#seams-toggle");
const facesToggle = document.querySelector<HTMLButtonElement>("#faces-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-3dppc-btn");
const exportGroupStepBtn = document.querySelector<HTMLButtonElement>("#export-group-step-btn");
const exportGroupStlBtn = document.querySelector<HTMLButtonElement>("#export-group-stl-btn");
const exportTabClipBtn = document.querySelector<HTMLButtonElement>("#export-seam-clip-btn");
const previewGroupModelBtn = document.querySelector<HTMLButtonElement>("#preview-group-model-btn");
const settingsOpenBtn = document.querySelector<HTMLButtonElement>("#settings-open-btn");
const jumpLinkBtn = document.querySelector<HTMLAnchorElement>("#jump-link-btn");
const triCounter = document.querySelector<HTMLDivElement>("#tri-counter");
const groupTabsEl = document.querySelector<HTMLDivElement>("#group-tabs");
const groupAddBtn = document.querySelector<HTMLButtonElement>("#group-add");
const groupPreview = document.querySelector<HTMLDivElement>("#group-preview");
const groupPreviewEmpty = document.querySelector<HTMLDivElement>("#group-preview-empty");
const groupPreviewMask = document.querySelector<HTMLDivElement>("#group-preview-mask");
const groupPreviewCacheIndicator = document.querySelector<HTMLDivElement>("#group-preview-cache-indicator");
const groupVisibilityToggle = document.querySelector<HTMLButtonElement>("#group-visibility-toggle");
const gifRecordBtn = document.querySelector<HTMLButtonElement>("#gif-record-btn");
const settingsOverlay = document.querySelector<HTMLDivElement>("#settings-overlay");
const settingsContent = settingsOverlay?.querySelector<HTMLDivElement>(".settings-content") || null;
const renameOverlay = document.querySelector<HTMLDivElement>("#rename-overlay");
const renameModal = document.querySelector<HTMLDivElement>("#rename-modal");
const renameInput = document.querySelector<HTMLInputElement>("#rename-input");
const renameCancelBtn = document.querySelector<HTMLButtonElement>("#rename-cancel-btn");
const renameConfirmBtn = document.querySelector<HTMLButtonElement>("#rename-confirm-btn");
const loadingOverlay = document.querySelector<HTMLDivElement>("#loading-overlay");
const aboutOverlay = document.querySelector<HTMLDivElement>("#about-overlay");
const aboutContent = document.querySelector<HTMLDivElement>("#about-content");
const aboutBackBtn = document.querySelector<HTMLButtonElement>("#about-back-btn");
const aboutBtn = document.querySelector<HTMLButtonElement>("#about-btn");
langToggleBtn = document.querySelector<HTMLButtonElement>("#lang-toggle");
langToggleGlobalBtn = document.querySelector<HTMLButtonElement>("#lang-toggle-global");

const getDemoFileName = () => {
  const selected = homeDemoProjects.find((item) => item.id === selectedHomeDemoProjectId) ?? homeDemoProjects[0];
  return selected?.filePath ?? "";
};

type HomeDemoProject = {
  id: string;
  filePath: string;
  gifPath: string;
  stillPath: string;
  jumpLink?: string;
};

const ZH_HOME_DEMO_CONFIG_PATH = "/demo/demo_projects.json";
let homeDemoProjects: HomeDemoProject[] = [];
let selectedHomeDemoProjectId = "";
let loadedHomeDemoConfigPath = "";
// 当前加载的项目是否为示例项目
let isCurrentProjectDemo = false;
let homeDemoCaptureSizeCache: { width: number; height: number } | null = null;
let homeDemoGifPlayNonce = 0;

const refreshHomeDemoEntryVisibility = () => {
  if (!homeDemoEntry) return;
  homeDemoEntry.classList.toggle("hidden", homeDemoProjects.length === 0);
};

const syncHomeDemoCoverDisplaySize = () => {
  if (!homeDemoOptionsEl) return;
  const optionsWidth = Math.round(homeDemoOptionsEl.getBoundingClientRect().width);
  if (optionsWidth <= 0) return;
  const optionsStyle = window.getComputedStyle(homeDemoOptionsEl);
  const columnGap = parseFloat(optionsStyle.columnGap || optionsStyle.gap || "8") || 8;
  const optionOuterWidth = Math.max(1, Math.floor((optionsWidth - columnGap) / 2));
  homeDemoOptionsEl.style.gridTemplateColumns = `repeat(2, ${optionOuterWidth}px)`;
  homeDemoOptionsEl.style.justifyContent = "space-between";
  const sampleOption = homeDemoOptionsEl.querySelector<HTMLElement>(".home-demo-option");
  const sampleOptionStyle = sampleOption ? window.getComputedStyle(sampleOption) : null;
  if (sampleOptionStyle) {
    const inlineHeight = parseFloat(homeDemoOptionsEl.style.getPropertyValue("--home-demo-cover-height") || "0");
    const computedHeight = parseFloat(window.getComputedStyle(homeDemoOptionsEl).getPropertyValue("--home-demo-cover-height") || "0");
    const effectiveHeight = inlineHeight > 0 ? inlineHeight : computedHeight;
    if (!effectiveHeight || effectiveHeight <= 0) {
      homeDemoOptionsEl.style.setProperty("--home-demo-cover-height", "131px");
    }
    const finalHeight = Math.max(1, Math.round(
      parseFloat(window.getComputedStyle(homeDemoOptionsEl).getPropertyValue("--home-demo-cover-height") || "131"),
    ));
    const buttonHorizontalInset = (
      parseFloat(sampleOptionStyle.paddingLeft || "0")
      + parseFloat(sampleOptionStyle.paddingRight || "0")
      + parseFloat(sampleOptionStyle.borderLeftWidth || "0")
      + parseFloat(sampleOptionStyle.borderRightWidth || "0")
    );
    const finalWidth = Math.max(1, Math.round(optionOuterWidth - buttonHorizontalInset));
    homeDemoCaptureSizeCache = { width: finalWidth, height: finalHeight };
  }
};

const renderHomeDemoOptions = () => {
  if (!homeDemoOptionsEl) return;
  homeDemoOptionsEl.innerHTML = "";
  const withNonce = (url: string, nonce: number) => {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}play=${nonce}`;
  };
  homeDemoProjects.forEach((item) => {
    const isSelected = item.id === selectedHomeDemoProjectId;
    const gifSrc = isSelected ? withNonce(item.gifPath, homeDemoGifPlayNonce) : item.gifPath;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `home-demo-option${isSelected ? " is-selected" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(isSelected));
    button.setAttribute("aria-label", item.id);
    button.innerHTML = `
      <span class="home-demo-option-cover">
        <img class="home-demo-option-still" src="${item.stillPath}" alt="" loading="lazy" />
        <img class="home-demo-option-gif" src="${gifSrc}" alt="" loading="lazy" />
      </span>
    `;
    button.addEventListener("click", () => {
      if (selectedHomeDemoProjectId !== item.id) {
        homeDemoGifPlayNonce += 1;
      }
      selectedHomeDemoProjectId = item.id;
      renderHomeDemoOptions();
    });
    homeDemoOptionsEl.appendChild(button);
  });
  syncHomeDemoCoverDisplaySize();
};

const normalizeHomeDemoProjects = (raw: unknown): HomeDemoProject[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is HomeDemoProject =>
      !!item &&
      typeof (item as HomeDemoProject).id === "string" &&
      typeof (item as HomeDemoProject).filePath === "string" &&
      typeof (item as HomeDemoProject).gifPath === "string" &&
      typeof (item as HomeDemoProject).stillPath === "string",
    )
    .map((item) => ({
      id: item.id,
      filePath: item.filePath,
      gifPath: item.gifPath,
      stillPath: item.stillPath,
      jumpLink: (item as HomeDemoProject).jumpLink,
    }));
};

const resolveHomeDemoConfigPath = () => {
  const configuredPath = t("mainpage.demoConfigFile");
  if (configuredPath && configuredPath !== "mainpage.demoConfigFile") return configuredPath;
  return ZH_HOME_DEMO_CONFIG_PATH;
};

const loadHomeDemoProjects = async () => {
  const primaryConfigPath = resolveHomeDemoConfigPath();
  const candidatePaths = primaryConfigPath === ZH_HOME_DEMO_CONFIG_PATH
    ? [primaryConfigPath]
    : [primaryConfigPath, ZH_HOME_DEMO_CONFIG_PATH];
  if (loadedHomeDemoConfigPath === primaryConfigPath && homeDemoProjects.length > 0) return;

  let loaded = false;
  for (const configPath of candidatePaths) {
    try {
      const res = await fetch(configPath, { cache: "no-cache" });
      if (!res.ok) throw new Error(`failed: ${res.status}`);
      const data = await res.json();
      const parsed = normalizeHomeDemoProjects(data);
      if (parsed.length === 0) throw new Error("empty or invalid demo project config");
      homeDemoProjects = parsed;
      loadedHomeDemoConfigPath = configPath;
      loaded = true;
      break;
    } catch (error) {
      console.warn("[main] loadHomeDemoProjects failed", { configPath, error });
    }
  }
  if (!loaded) {
    homeDemoProjects = [];
    loadedHomeDemoConfigPath = "";
  }
  if (!homeDemoProjects.some((item) => item.id === selectedHomeDemoProjectId)) {
    selectedHomeDemoProjectId = homeDemoProjects[0]?.id ?? "";
  }
  renderHomeDemoOptions();
  refreshHomeDemoEntryVisibility();
};

const showLoadingOverlay = () => loadingOverlay?.classList.remove("hidden");
const hideLoadingOverlay = () => loadingOverlay?.classList.add("hidden");
const settingsCancelBtn = document.querySelector<HTMLButtonElement>("#settings-cancel-btn");
const settingsConfirmBtn = document.querySelector<HTMLButtonElement>("#settings-confirm-btn");
const settingJoinTypeInterlockingBtn = document.querySelector<HTMLButtonElement>("#setting-join-type-interlocking");
const settingJoinTypeClipBtn = document.querySelector<HTMLButtonElement>("#setting-join-type-clip");
const settingJoinTypeResetBtn = document.querySelector<HTMLButtonElement>("#setting-join-type-reset");
const settingScaleInput = document.querySelector<HTMLInputElement>("#setting-scale");
const settingScaleResetBtn = document.querySelector<HTMLButtonElement>("#setting-scale-reset");
const settingMinFoldAngleThresholdInput = document.querySelector<HTMLInputElement>("#setting-min-fold-angle-threshold");
const settingMinFoldAngleThresholdResetBtn = document.querySelector<HTMLButtonElement>("#setting-min-fold-angle-threshold-reset");
const settingClawInterlockingAngleInput = document.querySelector<HTMLInputElement>("#setting-claw-interlocking-angle");
const settingClawInterlockingAngleResetBtn = document.querySelector<HTMLButtonElement>("#setting-claw-interlocking-angle-reset");
const settingClawTargetRadiusInput = document.querySelector<HTMLInputElement>("#setting-claw-target-radius");
const settingClawTargetRadiusResetBtn = document.querySelector<HTMLButtonElement>("#setting-claw-target-radius-reset");
const settingClawRadiusAdaptiveOffBtn = document.querySelector<HTMLButtonElement>("#setting-claw-radius-adaptive-off");
const settingClawRadiusAdaptiveOnBtn = document.querySelector<HTMLButtonElement>("#setting-claw-radius-adaptive-on");
const settingClawRadiusAdaptiveResetBtn = document.querySelector<HTMLButtonElement>("#setting-claw-radius-adaptive-reset");
const settingClawWidthInput = document.querySelector<HTMLInputElement>("#setting-claw-width");
const settingClawWidthResetBtn = document.querySelector<HTMLButtonElement>("#setting-claw-width-reset");
const settingClawFitGapInput = document.querySelector<HTMLInputElement>("#setting-claw-fit-gap");
const settingClawFitGapResetBtn = document.querySelector<HTMLButtonElement>("#setting-claw-fit-gap-reset");
const settingLayerHeightInput = document.querySelector<HTMLInputElement>("#setting-layer-height");
const settingLayerHeightResetBtn = document.querySelector<HTMLButtonElement>("#setting-layer-height-reset");
const settingConnectionLayersDecBtn = document.querySelector<HTMLButtonElement>("#setting-connection-layers-dec");
const settingConnectionLayersIncBtn = document.querySelector<HTMLButtonElement>("#setting-connection-layers-inc");
const settingConnectionLayersValue = document.querySelector<HTMLSpanElement>("#setting-connection-layers-value");
const settingConnectionLayersResetBtn = document.querySelector<HTMLButtonElement>("#setting-connection-layers-reset");
const settingBodyLayersDecBtn = document.querySelector<HTMLButtonElement>("#setting-body-layers-dec");
const settingBodyLayersIncBtn = document.querySelector<HTMLButtonElement>("#setting-body-layers-inc");
const settingBodyLayersValue = document.querySelector<HTMLSpanElement>("#setting-body-layers-value");
const settingBodyLayersResetBtn = document.querySelector<HTMLButtonElement>("#setting-body-layers-reset");
const settingTabWidthInput = document.querySelector<HTMLInputElement>("#setting-tab-width");
const settingTabWidthResetBtn = document.querySelector<HTMLButtonElement>("#setting-tab-width-reset");
const settingTabThicknessInput = document.querySelector<HTMLInputElement>("#setting-tab-thickness");
const settingTabThicknessResetBtn = document.querySelector<HTMLButtonElement>("#setting-tab-thickness-reset");
const settingTabClipGapInput = document.querySelector<HTMLInputElement>("#setting-tab-clip-gap");
const settingTabClipGapResetBtn = document.querySelector<HTMLButtonElement>("#setting-tab-clip-gap-reset");
const settingClipGapAdjustNormalBtn = document.querySelector<HTMLButtonElement>("#setting-clip-thickness-normal");
const settingClipGapAdjustNarrowBtn = document.querySelector<HTMLButtonElement>("#setting-clip-thickness-narrow");
const settingClipGapAdjustResetBtn = document.querySelector<HTMLButtonElement>("#setting-clip-thickness-reset");
const settingHollowOffBtn = document.querySelector<HTMLButtonElement>("#setting-hollow-off");
const settingHollowOnBtn = document.querySelector<HTMLButtonElement>("#setting-hollow-on");
const settingHollowResetBtn = document.querySelector<HTMLButtonElement>("#setting-hollow-reset");
const settingWireframeThicknessInput = document.querySelector<HTMLInputElement>("#setting-wireframe-thickness");
const settingWireframeThicknessResetBtn = document.querySelector<HTMLButtonElement>("#setting-wireframe-thickness-reset");
const settingWireframeRow = settingWireframeThicknessInput?.closest(".setting-row") as HTMLDivElement | null;
const settingNavBasic = document.querySelector<HTMLButtonElement>("#settings-nav-basic");
const settingNavInterlocking = document.querySelector<HTMLButtonElement>("#settings-nav-interlocking");
const settingNavClip = document.querySelector<HTMLButtonElement>("#settings-nav-clip");
const settingNavExperiment = document.querySelector<HTMLButtonElement>("#settings-nav-experiment");
const settingPanelBasic = document.querySelector<HTMLDivElement>("#settings-panel-basic");
const settingPanelInterlocking = document.querySelector<HTMLDivElement>("#settings-panel-interlocking");
const settingPanelClip = document.querySelector<HTMLDivElement>("#settings-panel-clip");
const settingPanelExperiment = document.querySelector<HTMLDivElement>("#settings-panel-experiment");
const groupPreviewPanel = groupPreview?.closest(".preview-panel") as HTMLDivElement | null;
const groupFacesCountLabel = document.querySelector<HTMLSpanElement>("#group-faces-count");
const groupColorBtn = document.querySelector<HTMLButtonElement>("#group-color-btn");
const groupColorInput = document.querySelector<HTMLInputElement>("#group-color-input");
const layoutHome = document.querySelector<HTMLElement>("#layout-home");
const layoutWorkspace = document.querySelector<HTMLElement>("#layout-workspace");
const versionBadgeGlobal = document.querySelector<HTMLDivElement>(".version-badge-global");
const groupDeleteSlot = document.querySelector<HTMLDivElement>("#group-delete-slot");

if (
  !viewer ||
  !viewerModeSlot ||
  !logListEl ||
  !fileInput ||
  !homeStartBtn ||
  !homeDemoBtn ||
  !homeDemoOptionsEl ||
  !exitPreviewBtn ||
  !editorPreviewEl ||
  !menuOpenBtn ||
  !resetViewBtn ||
  !textureToggle ||
  !lightToggle ||
  !edgesToggle ||
  !seamsToggle ||
  !facesToggle ||
  !exportBtn ||
  !exportGroupStepBtn ||
  !exportGroupStlBtn ||
  !previewGroupModelBtn ||
  !triCounter ||
  !groupTabsEl ||
  !groupAddBtn ||
  !groupPreviewPanel ||
  !groupPreview ||
  !groupPreviewEmpty ||
  !groupPreviewMask ||
  !groupPreviewCacheIndicator ||
  !groupFacesCountLabel ||
  !groupColorBtn ||
  !groupColorInput ||
  !groupDeleteSlot ||
  !layoutHome ||
  !layoutWorkspace ||
  !settingsOverlay ||
  !renameOverlay ||
  !renameModal ||
  !renameInput ||
  !renameCancelBtn ||
  !renameConfirmBtn ||
  !settingsCancelBtn ||
  !settingsConfirmBtn ||
  !settingJoinTypeInterlockingBtn ||
  !settingJoinTypeClipBtn ||
  !settingJoinTypeResetBtn ||
  !settingScaleInput ||
  !settingScaleResetBtn ||
  !settingMinFoldAngleThresholdInput ||
  !settingMinFoldAngleThresholdResetBtn ||
  !settingClawInterlockingAngleInput ||
  !settingClawInterlockingAngleResetBtn ||
  !settingClawTargetRadiusInput ||
  !settingClawTargetRadiusResetBtn ||
  !settingClawRadiusAdaptiveOffBtn ||
  !settingClawRadiusAdaptiveOnBtn ||
  !settingClawRadiusAdaptiveResetBtn ||
  !settingClawWidthInput ||
  !settingClawWidthResetBtn ||
  !settingClawFitGapInput ||
  !settingClawFitGapResetBtn ||
  !settingTabWidthInput ||
  !settingTabWidthResetBtn ||
  !settingLayerHeightInput ||
  !settingLayerHeightResetBtn ||
  !settingConnectionLayersDecBtn ||
  !settingConnectionLayersIncBtn ||
  !settingConnectionLayersValue ||
  !settingConnectionLayersResetBtn ||
  !settingBodyLayersDecBtn ||
  !settingBodyLayersIncBtn ||
  !settingBodyLayersValue ||
  !settingBodyLayersResetBtn ||
  !settingTabThicknessInput ||
  !settingTabThicknessResetBtn ||
  !settingTabClipGapInput ||
  !settingTabClipGapResetBtn ||
  !settingClipGapAdjustNormalBtn ||
  !settingClipGapAdjustNarrowBtn ||
  !settingClipGapAdjustResetBtn ||
  !settingHollowOffBtn ||
  !settingHollowOnBtn ||
  !settingHollowResetBtn ||
  !settingWireframeThicknessInput ||
  !settingWireframeThicknessResetBtn ||
  !settingWireframeRow ||
  !settingNavBasic ||
  !settingNavInterlocking ||
  !settingNavClip ||
  !settingNavExperiment ||
  !settingPanelBasic ||
  !settingPanelInterlocking ||
  !settingPanelClip ||
  !settingPanelExperiment ||
  !settingsOpenBtn ||
  !settingsContent ||
  !textureInput ||
  !loadTextureBtn ||
  !clearTextureBtn
) {
  throw new Error("初始化界面失败，缺少必要的元素");
}
// 预加载 workspace 布局，方便渲染器在首帧前完成尺寸初始化
layoutWorkspace.classList.add("preloaded");
// 确保文件选择框只允许支持的模型/3dppc 后缀
fileInput.setAttribute("accept", ".obj,.fbx,.stl,.3dppc");
document.querySelectorAll("input").forEach((inp) => inp.setAttribute("autocomplete", "off"));

const { log } = createLog(logListEl);
const i18nReadyPromise = initI18n();

const viewerModeIconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<?xml version="1.0" encoding="utf-8"?>
<!-- License: Apache. Made by UXAspects: https://github.com/UXAspects/UXAspects -->
<svg fill="#000000" height="800px" width="800px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
	 viewBox="0 0 24 24" enable-background="new 0 0 24 24" xml:space="preserve">
<g id="view">
	<g>
		<path d="M12,21c-5,0-8.8-2.8-11.8-8.5L0,12l0.2-0.5C3.2,5.8,7,3,12,3s8.8,2.8,11.8,8.5L24,12l-0.2,0.5C20.8,18.2,17,21,12,21z
			 M2.3,12c2.5,4.7,5.7,7,9.7,7s7.2-2.3,9.7-7C19.2,7.3,16,5,12,5S4.8,7.3,2.3,12z"/>
	</g>
	<g>
		<path d="M12,17c-2.8,0-5-2.2-5-5s2.2-5,5-5s5,2.2,5,5S14.8,17,12,17z M12,9c-1.7,0-3,1.3-3,3s1.3,3,3,3s3-1.3,3-3S13.7,9,12,9z"/>
	</g>
</g>
</svg>
`;

const groupEditModeIconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- License: Apache. Made by vaadin: https://github.com/vaadin/vaadin-icons -->
<svg width="800px" height="800px" viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <g transform="matrix(0.9 0 0 0.9 1.8 1.8)">
    <path d="M8 0l-8 2v10l8 4 8-4v-10l-8-2zM14.4 2.6l-5.9 2.2-6.6-2.2 6.1-1.6 6.4 1.6zM1 11.4v-8.1l7 2.4v9.2l-7-3.5z"></path>
  </g>
</svg>
`;

const seamEditModeIconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: MIT. Made by phosphor: https://github.com/phosphor-icons/phosphor-icons -->
<svg fill="#000000" width="800px" height="800px" viewBox="0 0 256 256" id="Flat" xmlns="http://www.w3.org/2000/svg">
  <g transform="matrix(1.1 0 0 1.1 2.2 2.2)">
    <path d="M217.45557,38.544a35.9967,35.9967,0,0,0-57.937,40.96679L79.5105,159.51855a36.05906,36.05906,0,0,0-40.96607,7.0254H38.544a36.00029,36.00029,0,1,0,57.93737,9.94531L176.4895,96.48145A35.99663,35.99663,0,0,0,217.45557,38.544ZM72.48584,200.48535a12.00027,12.00027,0,0,1-16.97119-16.9707h-.00049a12.00044,12.00044,0,0,1,16.97168,16.9707Zm128-128a12.01673,12.01673,0,0,1-16.969.00244l-.0022-.00244a12.0001,12.0001,0,1,1,16.97119,0Z"/>
  </g>
</svg>
`;

const textureEditModeIconSvg = `
<?xml version="1.0" encoding="utf-8"?>
<!-- License: MIT. Made by Neuicons: https://github.com/neuicons/neu -->
<svg fill="#000000" width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M21,2H3A1,1,0,0,0,2,3V21a1,1,0,0,0,1,1H21a1,1,0,0,0,1-1V3A1,1,0,0,0,21,2ZM20,14l-3-3-5,5-2-2L4,20V4H20ZM6,8.5A2.5,2.5,0,1,1,8.5,11,2.5,2.5,0,0,1,6,8.5Z"/></svg>
`;

const segmentedItemValueToWorkspaceState = (value: string): WorkspaceState => {
  if (value === "group-edit") return "editingGroup";
  if (value === "seam-edit") return "editingSeam";
  if (value === "texture-edit") return "editingTexture";
  return "normal";
};

const workspaceStateToSegmentedItemValue = (state: WorkspaceState): string => {
  if (state === "editingGroup") return "group-edit";
  if (state === "editingSeam") return "seam-edit";
  if (state === "editingTexture") return "texture-edit";
  return "view";
};

const getWorkspaceStateDisplayName = (state: WorkspaceState): string => {
  if (state === "editingGroup") return t("workspace.mode.editingGroup");
  if (state === "editingSeam") return t("workspace.mode.editingSeam");
  if (state === "editingTexture") return t("workspace.mode.editingTexture");
  return t("workspace.mode.normal");
};

const isViewerModeControlDisabled = (state: WorkspaceState): boolean => {
  return workerBusy || state === "previewGroupModel" || state === "loading";
};

viewerModeControl = createSegmentedControl({
  ariaLabel: t("viewer.mode.ariaLabel"),
  value: "view",
  equalWidth: true,
  items: [
    {
      value: "view",
      label: t("workspace.mode.normal"),
      iconSvg: viewerModeIconSvg,
      hoverBg: "rgba(245, 158, 11, 0.18)",
      activeBg: "rgba(245, 158, 61, 0.68)",
      textColor: "#dddddd",
      activeTextColor: "#ffffff",
    },
    {
      value: "group-edit",
      label: t("workspace.mode.editingGroup"),
      iconSvg: groupEditModeIconSvg,
      hoverBg: "rgba(37, 99, 235, 0.18)",
      activeBg: "rgba(67, 129, 235, 0.68)",
      textColor: "#dddddd",
      activeTextColor: "#ffffff",
    },
    {
      value: "seam-edit",
      label: t("workspace.mode.editingSeam"),
      iconSvg: seamEditModeIconSvg,
      hoverBg: "rgba(20, 184, 166, 0.18)",
      activeBg: "rgba(80, 184, 166, 0.68)",
      textColor: "#dddddd",
      activeTextColor: "#ffffff",
    },
    {
      value: "texture-edit",
      label: t("workspace.mode.editingTexture"),
      iconSvg: textureEditModeIconSvg,
      hoverBg: "rgba(168, 85, 247, 0.18)",
      activeBg: "rgba(168, 85, 247, 0.68)",
      textColor: "#dddddd",
      activeTextColor: "#ffffff",
    },
  ],
  onChange(value) {
    const nextState = segmentedItemValueToWorkspaceState(value);
    // console.log("[ViewerModeControl] mode changed:", value, "->", nextState);
    renderer3d.setBBoxEnabled(false);
    changeWorkspaceState(nextState);
  },
});
viewerModeControl.el.classList.add("viewer-mode-control");
viewerModeSlot.appendChild(viewerModeControl.el);
viewerModeControl.el.classList.toggle("hidden", getWorkspaceState() === "previewGroupModel");
viewerModeControl.setValue(workspaceStateToSegmentedItemValue(getWorkspaceState()), false);
viewerModeControl.setDisabled(isViewerModeControlDisabled(getWorkspaceState()));

// Initialize Vercel Web Analytics
inject();
const changeWorkspaceState = (state: WorkspaceState) => {
  const previousState = getWorkspaceState();
  if (previousState === state) return;
  setWorkspaceState(state);
  if (state === "loading") {
    showLoadingOverlay();
  } else {
    hideLoadingOverlay();
  }
  if (state === "previewGroupModel") log(t("log.preview.loaded"), "info");
  appEventBus.emit("workspaceStateChanged", { previous: previousState, current: state });
};

appEventBus.on("workspaceStateChanged", ({ current }) => {
  viewerModeControl.el.classList.toggle("hidden", current === "previewGroupModel");
  viewerModeControl.setValue(workspaceStateToSegmentedItemValue(current), false);
  viewerModeControl.setDisabled(isViewerModeControlDisabled(current));
});

aboutBackBtn?.addEventListener("click", () => {
  aboutOverlay?.classList.add("hidden");
});
aboutBtn?.addEventListener("click", async () => {
  if (!aboutOverlay || !aboutContent) return;
  aboutOverlay.classList.remove("hidden");
  try {
    const lang = getCurrentLang();
    const aboutPath = lang.startsWith("zh") ? "about_cn.html" : "about_en.html";
    const res = await fetch(aboutPath, { cache: "no-cache" });
    if (res.ok) {
      aboutContent.innerHTML = await res.text();
    } else {
      aboutContent.textContent = "加载关于页面失败";
    }
  } catch (err) {
    aboutContent.textContent = "加载关于页面失败";
  }
});

langToggleBtn?.addEventListener("click", async () => {
  const lang = getCurrentLang();
  const next = lang.startsWith("zh") ? "en" : "zh";
  await setLanguage(next);
});
langToggleGlobalBtn?.addEventListener("click", async () => {
  const lang = getCurrentLang();
  const next = lang.startsWith("zh") ? "en" : "zh";
  await setLanguage(next);
});

const clearAppStates = () => {
  changeWorkspaceState("loading");
  document.querySelector(".version-badge-global")?.classList.add("hidden-global");
  document.querySelector(".version-lang-toggle")?.classList.add("hidden-global");
  previewMeshCacheManager.clear();
  refreshPreviewMeshCacheIndicator();
  historyManager.reset();
  appEventBus.emit("clearAppStates", undefined);
  operationHints?.resetHighlights();
}
// 全局禁用右键菜单，避免画布交互被系统菜单打断
document.addEventListener("contextmenu", (e) => e.preventDefault());
const settingsUI = createSettingsUI(
  {
    overlay: settingsOverlay,
    content: settingsContent,
    openBtn: settingsOpenBtn,
    cancelBtn: settingsCancelBtn,
    confirmBtn: settingsConfirmBtn,
    joinTypeInterlockingBtn: settingJoinTypeInterlockingBtn,
    joinTypeClipBtn: settingJoinTypeClipBtn,
    joinTypeResetBtn: settingJoinTypeResetBtn,
    scaleInput: settingScaleInput,
    scaleResetBtn: settingScaleResetBtn,
    minFoldAngleThresholdInput: settingMinFoldAngleThresholdInput,
    minFoldAngleThresholdResetBtn: settingMinFoldAngleThresholdResetBtn,
    clawInterlockingAngleInput: settingClawInterlockingAngleInput,
    clawInterlockingAngleResetBtn: settingClawInterlockingAngleResetBtn,
    clawTargetRadiusInput: settingClawTargetRadiusInput,
    clawTargetRadiusResetBtn: settingClawTargetRadiusResetBtn,
    clawRadiusAdaptiveOffBtn: settingClawRadiusAdaptiveOffBtn,
    clawRadiusAdaptiveOnBtn: settingClawRadiusAdaptiveOnBtn,
    clawRadiusAdaptiveResetBtn: settingClawRadiusAdaptiveResetBtn,
    clawWidthInput: settingClawWidthInput,
    clawWidthResetBtn: settingClawWidthResetBtn,
    clawFitGapInput: settingClawFitGapInput,
    clawFitGapResetBtn: settingClawFitGapResetBtn,
    tabWidthInput: settingTabWidthInput,
    tabWidthResetBtn: settingTabWidthResetBtn,
    tabThicknessInput: settingTabThicknessInput,
    tabThicknessResetBtn: settingTabThicknessResetBtn,
    tabClipGapInput: settingTabClipGapInput,
    tabClipGapResetBtn: settingTabClipGapResetBtn,
    clipGapAdjustNormalBtn: settingClipGapAdjustNormalBtn,
    clipGapAdjustNarrowBtn: settingClipGapAdjustNarrowBtn,
    clipGapAdjustResetBtn: settingClipGapAdjustResetBtn,
    hollowOnBtn: settingHollowOnBtn,
    hollowOffBtn: settingHollowOffBtn,
    hollowResetBtn: settingHollowResetBtn,
    wireframeThicknessInput: settingWireframeThicknessInput,
    wireframeThicknessResetBtn: settingWireframeThicknessResetBtn,
    wireframeRow: settingWireframeRow,
    navBasic: settingNavBasic,
    navInterlocking: settingNavInterlocking,
    navClip: settingNavClip,
    navExperiment: settingNavExperiment,
    panelBasic: settingPanelBasic,
    panelInterlocking: settingPanelInterlocking,
    panelClip: settingPanelClip,
    panelExperiment: settingPanelExperiment,
    layerHeightInput: settingLayerHeightInput,
    layerHeightResetBtn: settingLayerHeightResetBtn,
    connectionLayersDecBtn: settingConnectionLayersDecBtn,
    connectionLayersIncBtn: settingConnectionLayersIncBtn,
    connectionLayersValue: settingConnectionLayersValue,
    connectionLayersResetBtn: settingConnectionLayersResetBtn,
    bodyLayersDecBtn: settingBodyLayersDecBtn,
    bodyLayersIncBtn: settingBodyLayersIncBtn,
    bodyLayersValue: settingBodyLayersValue,
    bodyLayersResetBtn: settingBodyLayersResetBtn,
  },
  { log },
);

const geometryContext = createGeometryContext();
const groupController = createGroupController(log, () => geometryContext.geometryIndex.getFaceAdjacency());
if (groupDeleteSlot) {
  deleteHold = createHoldButton({
    label: t("preview.right.groupDelete.btn"),
    holdMs: 500,
    showPercent: false,
    lockOnConfirm: false,
    onConfirm: () => {
      const gid = groupController.getPreviewGroupId();
      groupController.deleteGroup(gid);
      deleteHold?.reset();
    },
    onCancel: () => {
      deleteHold?.reset();
    },
  });
  groupDeleteSlot.appendChild(deleteHold.el);
}

const openRenameDialog = () => {
  if (!renameOverlay || !renameModal || !renameInput) return;
  if (settingsUI.isOpen()) return;
  const previewId = groupController.getPreviewGroupId();
  const currentName = groupController.getGroupName(previewId) ?? `展开组 ${previewId}`;
  renameInput.value = currentName;
  renameOverlay.classList.remove("hidden");
  renameInput.focus();
  // 全选文本，便于直接输入新名称
  renameInput.select();
  // 某些浏览器需要延迟才能正确选中
  requestAnimationFrame(() => renameInput.setSelectionRange(0, renameInput.value.length));
  appEventBus.emit("userOperation", { side: "right", op: "rename-group", highlightDuration: 0 })
};

const closeRenameDialog = () => {
  if (!renameOverlay) return;
  renameOverlay.classList.add("hidden");
  appEventBus.emit("userOperationDone", { side: "right", op: "rename-group" })
};

renameCancelBtn.addEventListener("click", closeRenameDialog);
const isValidGroupName = (val: string) => !!val && /\S/.test(val);
const handleRenameConfirm = () => {
  const val = renameInput.value ?? "";
  if (!isValidGroupName(val)) {
    log(t("log.group.rename.invalid"), "error");
    closeRenameDialog();
    return;
  }
  groupController.setGroupName(groupController.getPreviewGroupId(), val.trim());
  log(t("log.group.rename.success"), "success");
  closeRenameDialog();
};
renameConfirmBtn.addEventListener("click", handleRenameConfirm);
renameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleRenameConfirm();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeRenameDialog();
  }
});
const renderer3d = createRenderer3D(
  log,
  {
    handleRemoveFace: (faceId: number) => {
      return groupController.removeFace(faceId, groupController.getPreviewGroupId());
    },
    handleAddFace: (faceId: number) => {
      return groupController.addFace(faceId, groupController.getPreviewGroupId());
    },
    getGroupColor: groupController.getGroupColor,
    getGroupFaces: groupController.getGroupFaces,
    getFaceGroupMap: groupController.getFaceGroupMap,
    getGroupVisibility: groupController.getGroupVisibility,
    getGroupParentTree: groupController.getGroupTreeParent,
    // isVisibleSeam: groupController.isVisibleSeam,
  },
  geometryContext,
  () => {
    const rect = viewer.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  },
  (canvas) => viewer.appendChild(canvas),
);
const bboxToggle = document.querySelector<HTMLButtonElement>("#bbox-toggle")!;
bboxToggle.classList.add("active");
refreshToggleTextLabels = () => {
  refreshToggleTexts([
    { btn: lightToggle, keyOn: "toolbar.left.light.on", keyOff: "toolbar.left.light.off", isOn: () => renderer3d.isLightEnabled() },
    { btn: edgesToggle, keyOn: "toolbar.left.wireframe.on", keyOff: "toolbar.left.wireframe.off", isOn: () => renderer3d.isEdgesEnabled() },
    { btn: seamsToggle, keyOn: "toolbar.left.seam.on", keyOff: "toolbar.left.seam.off", isOn: () => renderer3d.isSeamsEnabled() },
    { btn: facesToggle, keyOn: "toolbar.left.surface.on", keyOff: "toolbar.left.surface.off", isOn: () => renderer3d.isFacesEnabled() },
    { btn: textureToggle, keyOn: "toolbar.left.texture.on", keyOff: "toolbar.left.texture.off", isOn: () => renderer3d.isTextureEnabled() },
    { btn: bboxToggle, keyOn: "toolbar.left.bbox.on", keyOff: "toolbar.left.bbox.off", isOn: () => renderer3d.getBBoxVisible() },
  ]);
};
refreshToggleTextLabels?.();
textureToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleTexture();
  textureToggle.classList.toggle("active", enabled);
  refreshToggleTextLabels?.();
});
bboxToggle.addEventListener("click", () => {
  const visible = renderer3d.toggleBBox();
  bboxToggle.classList.toggle("active", visible);
  refreshToggleTextLabels?.();
});
// 监听贴图变动事件
// 监听贴图变动事件，统一处理贴图相关逻辑
appEventBus.on("texturesChanged", async ({ textureData, action }) => {
  const isEditingTexture = getWorkspaceState() === "editingTexture";
  const hasTexture = textureData !== null;

  if (action === "clear") {
    // 清除贴图
    renderer3d.setTexture(null);
    textureToggle?.classList.remove("active");
    textureToggle?.classList.add("hidden");
    // 根据状态更新按钮显示/隐藏
    loadTextureBtn.classList.toggle("hidden", !isEditingTexture || hasTexture);
    generateTextureBtn?.classList.toggle("hidden", !isEditingTexture || hasTexture);
    clearTextureBtn?.classList.add("hidden");
    exportTextureBtn?.classList.add("hidden");
    refreshToggleTextLabels?.();
    log(t("log.texture.cleared"), "info");
  } else if (textureData) {
    // 添加/替换贴图：转换为 Three.js Texture 并设置到渲染器
    const threeTexture = await createThreeTexture(textureData);
    renderer3d.setTexture(threeTexture);
    renderer3d.setTextureEnabled(true);

    // 根据状态更新按钮显示/隐藏
    loadTextureBtn.classList.toggle("hidden", !isEditingTexture || hasTexture);
    generateTextureBtn?.classList.toggle("hidden", !isEditingTexture || hasTexture);
    clearTextureBtn?.classList.toggle("hidden", !isEditingTexture || !hasTexture);
    exportTextureBtn?.classList.toggle("hidden", !isEditingTexture || !hasTexture);
    if (!isEditingTexture) {
      textureToggle?.classList.remove("hidden");
    }
    textureToggle?.classList.add("active");
    refreshToggleTextLabels?.();

    // 输出日志
    const logKey = action === "add" ? "log.texture.loaded" : "log.texture.replaced";
    log(t(logKey, { filename: textureData.name, width: textureData.width, height: textureData.height }), "success");
  }
});

appEventBus.on("workspaceStateChanged", ({ current, previous }) => {
  const isPreview = current === "previewGroupModel";
  const enteringEditingSeam = current === "editingSeam" && previous !== "editingSeam";
  const leavingEditingSeam = previous === "editingSeam" && current !== "editingSeam";
  const enteringEditingTexture = current === "editingTexture" && previous !== "editingTexture";
  const enterEditingGroup = current === "editingGroup" && previous !== "editingGroup";
  const enterNormal = current === "normal" && previous !== "normal";
  // 进入"贴图编辑"状态时总是打开面渲染和贴图渲染
  if (enteringEditingTexture) {
    renderer3d.setFacesEnabled(true);
    renderer3d.setTextureEnabled(true);
  }
  if (enteringEditingSeam) {
    edgesEnabledBeforeEditingSeam = renderer3d.isEdgesEnabled();
    seamsEnabledBeforeEditingSeam = renderer3d.isSeamsEnabled();
    renderer3d.setEdgesEnabled(false);
    renderer3d.setSeamsEnabled(true);
  }
  if (leavingEditingSeam) {
    if (edgesEnabledBeforeEditingSeam !== null) {
      renderer3d.setEdgesEnabled(edgesEnabledBeforeEditingSeam);
    }
    if (seamsEnabledBeforeEditingSeam !== null) {
      renderer3d.setSeamsEnabled(seamsEnabledBeforeEditingSeam);
    }
    edgesEnabledBeforeEditingSeam = null;
    seamsEnabledBeforeEditingSeam = null;
  }
  if (enterEditingGroup) {
    renderer3d.setTextureEnabled(false);
  }
  if (enterNormal) {
    if (hasTextures()) renderer3d.setTextureEnabled(true);
  }
  // 根据工作模式显示/隐藏工具栏按钮
  const isEditingTexture = current === "editingTexture";
  const isEditingSeam = current === "editingSeam";
  const hasTexture = hasTextures();

  // "载入贴图"按钮仅在"编辑贴图"状态下显示
  loadTextureBtn.classList.toggle("hidden", !isEditingTexture || hasTexture);
  // "生成贴图"按钮仅在"编辑贴图"状态下且没有贴图时显示
  generateTextureBtn?.classList.toggle("hidden", !isEditingTexture || hasTexture);
  // "清除贴图"按钮仅在"编辑贴图"状态下且已有贴图时显示
  clearTextureBtn.classList.toggle("hidden", !isEditingTexture || !hasTexture);
  // "导出贴图"按钮仅在"编辑贴图"状态下且已有贴图时显示
  exportTextureBtn?.classList.toggle("hidden", !isEditingTexture || !hasTexture);
  // "贴图渲染"按钮在"贴图编辑"状态下隐藏
  textureToggle.classList.toggle("hidden", isEditingTexture || !hasTexture);
  // "包围盒"按钮在"贴图编辑"状态下隐藏
  bboxToggle.classList.toggle("hidden", isEditingTexture || isPreview);
  // "线框"、"拼接边"按钮在"拼接边编辑"状态下隐藏
  edgesToggle.classList.toggle("hidden", isEditingSeam);
  seamsToggle.classList.toggle("hidden", isEditingSeam);
  // "面渲染"按钮在"贴图编辑"状态下隐藏
  facesToggle.classList.toggle("hidden", isEditingTexture);
  
  const disableEdgeControls = isEditingSeam;
  edgesToggle.classList.toggle("active", renderer3d.isEdgesEnabled());
  seamsToggle.classList.toggle("active", renderer3d.isSeamsEnabled());
  textureToggle.classList.toggle("active", renderer3d.isTextureEnabled());
  facesToggle.classList.toggle("active", renderer3d.isFacesEnabled());
  edgesToggle.disabled = disableEdgeControls;
  seamsToggle.disabled = disableEdgeControls;
  groupPreviewMask.classList.toggle("hidden", !disableEdgeControls);
  if (isPreview) {
    bboxToggle.classList.remove("active");
    refreshToggleTextLabels?.();
  } else {
    const visible = (renderer3d as any).getBBoxVisible?.() ?? false;
    bboxToggle.classList.toggle("active", visible);
    refreshToggleTextLabels?.();
  }
  if (historyPanelUI) {
    const panel = document.getElementById("history-panel");
    panel?.classList.toggle("hidden", isPreview);
  }
});

const projectLoaded = () => {
  if (versionBadgeGlobal) versionBadgeGlobal.style.display = "none";
  logPanelEl?.classList.remove("hidden");
  layoutHome.classList.toggle("active", false);
  layoutWorkspace.classList.toggle("active", true);
  layoutWorkspace.classList.remove("preloaded");
  updateMenuState();
  groupUI.render(buildGroupUIState());
  historyManager.reset();
  historyManager.push(captureProjectState(), { name: "loadModel", timestamp: Date.now(), payload: {}});
  historyPanelUI?.render();
  refreshPreviewMeshCacheIndicator();
  // 加载新项目时隐藏贴图开关
  textureToggle?.classList.add("hidden");
};

const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];
function getExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}
const getProjectNameFromFile = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "未命名工程";
  const lastDot = trimmed.lastIndexOf(".");
  return lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
};
setProjectNameLabel(getCurrentProject().name ?? "未命名工程");
const handleFileSelectedFromFile = async (file: File) => {
  const ext = getExtension(file.name);
  if (!allowedExtensions.includes(ext)) {
    log(t("log.file.unsupported"), "error");
    return;
  }
  try {
    clearAppStates();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { object, importedGroups, importedColorCursor, importedSeting, importedEdgeJoinTypes, suggestedScale } = await loadRawObject(file, ext);
    const projectInfo = startNewProject(getProjectNameFromFile(file.name));
    if (importedSeting) {
      importSettings(importedSeting);
    } else {
      resetSettings();
    }
    // 对 OBJ/FBX/STL 模型进行自适应缩放
    if (suggestedScale !== undefined && suggestedScale !== 1) {
      applySettings({ scale: suggestedScale });
    }
    await renderer3d.applyObject(object, file.name);
    // 自适应缩放后输出日志
    if (suggestedScale !== undefined && suggestedScale !== 1) {
      log(t("log.scale.autoAdjusted", { scale: suggestedScale }));
    }
    if (importedGroups && importedGroups.length) {
      groupController.applyImportedGroups(importedGroups, importedColorCursor);
    }
    // 边级拼接方式依赖于当前模型已完成几何索引构建。
    // 因此必须放在 applyObject 之后恢复；同时又要早于 projectChanged，
    // 这样 seamManager 首次根据 projectChanged 重建 seam 线时，就能拿到正确的 joinType 颜色。
    if (importedEdgeJoinTypes) {
      importEdgeJoinTypes(importedEdgeJoinTypes);
    }
    appEventBus.emit("projectChanged", projectInfo);
    projectLoaded();
    setProjectNameLabel(projectInfo.name);
    // 更新跳转链接按钮状态
    if (isCurrentProjectDemo && jumpLinkBtn) {
      const currentDemo = homeDemoProjects.find(item => item.id === selectedHomeDemoProjectId);
      if (currentDemo?.jumpLink) {
        jumpLinkBtn.href = currentDemo.jumpLink;
        jumpLinkBtn.classList.remove("hidden");
      } else {
        jumpLinkBtn.classList.add("hidden");
      }
    } else {
      jumpLinkBtn?.classList.add("hidden");
    }
    isCurrentProjectDemo = false;
    // 重置工具栏开关状态到默认值（全部开启）
    renderer3d.setTextureEnabled(false);
    renderer3d.setLightEnabled(true);
    renderer3d.setEdgesEnabled(true);
    renderer3d.setSeamsEnabled(true);
    renderer3d.setFacesEnabled(true);
    renderer3d.setBBoxEnabled(true);
    textureToggle.classList.remove("active");
    lightToggle.classList.add("active");
    edgesToggle.classList.add("active");
    seamsToggle.classList.add("active");
    facesToggle.classList.add("active");
    bboxToggle.classList.remove("active");
    refreshToggleTextLabels?.();
  } catch (error) {
    console.error("加载模型失败", error);
    if ((error as Error)?.stack) {
      console.error((error as Error).stack);
    }
    log(t("log.file.loadFailed"), "error");
    renderer3d.clearModel();
    resetSettings();
  }
  finally {
    changeWorkspaceState("normal");
  }
  fileInput.value = "";
  hideLoadingOverlay();
};

const handleFileSelected = async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    hideLoadingOverlay();
    return;
  }
  await handleFileSelectedFromFile(file);
};

fileInput.addEventListener("change", handleFileSelected);

const focusCancelHandler = () => {
  if (!fileInput.files || fileInput.files.length === 0) {
    hideLoadingOverlay();
    window.removeEventListener("focus", focusCancelHandler);
  }
};

fileInput.addEventListener("cancel", () => {
  hideLoadingOverlay();
  window.removeEventListener("focus", focusCancelHandler);
});

fileInput.addEventListener("click", () => {
  window.addEventListener("focus", focusCancelHandler);
});
const openFilePickerFromHome = () => {
  fileInput.value = "";
  showLoadingOverlay();
  fileInput.click();
};
const loadDemoProjectFromHome = async () => {
  try {
    showLoadingOverlay();
    isCurrentProjectDemo = true;
    await loadHomeDemoProjects();
    const demoFile = getDemoFileName();
    if (!demoFile) throw new Error("demo project config is empty");
    const resp = await fetch(`/${demoFile}`, { cache: "no-cache" });
    if (!resp.ok) throw new Error("demo file fetch failed");
    const blob = await resp.blob();
    const demoFileName = demoFile.replace(/[?#].*$/, "").split(/[\\/]/).pop() || demoFile;
    const file = new File([blob], demoFileName, { type: "application/json" });
    await handleFileSelectedFromFile(file);
  } catch (err) {
    console.error("加载 demo 失败", err);
    log(t("log.demo.loadFail"), "error");
    hideLoadingOverlay();
  }
};

const getHomeDemoCaptureTargetHeight = (): number => {
  if (homeDemoCaptureSizeCache) return homeDemoCaptureSizeCache.height;

  const coverEl = homeDemoOptionsEl?.querySelector<HTMLElement>(".home-demo-option-cover");
  if (coverEl) {
    const rect = coverEl.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width > 0 && height > 0) {
      homeDemoCaptureSizeCache = { width, height };
      return height;
    }
  }

  const height = homeDemoOptionsEl
    ? parseFloat(window.getComputedStyle(homeDemoOptionsEl).getPropertyValue("--home-demo-cover-height") || "131")
    : 131;
  const fallbackHeight = Math.max(1, Math.round(height));
  if (Number.isFinite(fallbackHeight)) {
    return fallbackHeight;
  }
  return 131;
};

const gifCaptureController = createGifCaptureController({
  renderer3d,
  getTargetHeight: getHomeDemoCaptureTargetHeight,
  downloadBlob,
  log,
  showLoadingOverlay,
  hideLoadingOverlay,
  gifRecordBtn,
  gifFps: GIF_CAPTURE_FPS,
  frameCount: 120,
  turns: 1,
});

homeStartBtn.addEventListener("click", openFilePickerFromHome);
homeDemoBtn?.addEventListener("click", loadDemoProjectFromHome);
gifRecordBtn?.addEventListener("click", gifCaptureController.captureGifFromViewer);
menuOpenBtn.addEventListener("click", () => {
  fileInput.value = "";
  showLoadingOverlay();
  fileInput.click();
});
// 贴图加载处理
const handleTextureSelected = async () => {
  const file = textureInput.files?.[0];
  if (!file) return;

  try {
    const textureData = await loadTextureFromFile(file);
    const existingTextures = getAllTextures();

    if (existingTextures.length > 0) {
      // 替换已有贴图（使用已有贴图的 ID）
      const existingId = existingTextures[0].id;
      replaceTexture(existingId, textureData);
    } else {
      // 首次加载贴图
      addTexture(textureData);
    }
  } catch (err) {
    console.error("贴图加载失败", err);
    log(t("log.texture.loadFailed"), "error");
  }

  textureInput.value = "";
};

textureInput.addEventListener("change", handleTextureSelected);

loadTextureBtn.addEventListener("click", () => {
  textureInput.click();
});

generateTextureBtn?.addEventListener("click", async () => {
  try {
    const textureData = await generateUVTexture();
    clearAllTextures();
    addTexture(textureData);
  } catch (err) {
    console.error("生成贴图失败", err);
    log(t("log.texture.generateFailed"), "error");
  }
});

clearTextureBtn.addEventListener("click", () => {
  clearAllTextures();
});

exportTextureBtn?.addEventListener("click", () => {
  const textures = getAllTextures();
  if (textures.length === 0) {
    log(t("log.texture.noTextureToExport") || "没有可导出的贴图", "error");
    return;
  }
  // 导出第一张贴图（通常只有一张）
  const textureData = textures[0];
  const blob = new Blob([textureData.data], { type: `image/${textureData.format}` });
  const url = URL.createObjectURL(blob);
  const base = getCurrentProject().name || "未命名工程";
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
  const fileName = `${base}_${stamp}.png`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(t("log.texture.exported", { fileName }), "info");
});

resetViewBtn.addEventListener("click", () => renderer3d.resetView());
lightToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleLight();
  lightToggle.classList.toggle("active", enabled);
  refreshToggleTextLabels?.();
});
edgesToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleEdges();
  edgesToggle.classList.toggle("active", enabled);
  refreshToggleTextLabels?.();
});
seamsToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleSeams();
  seamsToggle.classList.toggle("active", enabled);
  refreshToggleTextLabels?.();
});
facesToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleFaces();
  facesToggle.classList.toggle("active", enabled);
  refreshToggleTextLabels?.();
});

// 初始化开关状态（renderer 默认全开启）
lightToggle.classList.add("active");
edgesToggle.classList.add("active");
seamsToggle.classList.add("active");
facesToggle.classList.add("active");
refreshToggleTextLabels?.();

// 三角形计数跟随渲染器
const syncTriCount = () => {
  triCounter.textContent = t("toolbar.left.renderLoad.label", { count: renderer3d.getTriCount() });
  requestAnimationFrame(syncTriCount);
};
requestAnimationFrame(syncTriCount);

const renderer2d = createRenderer2D(() => {
    const rect = groupPreview.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  },
  (canvas) => groupPreview.appendChild(canvas),
  () => { return groupController.getGroupPlaceAngle(groupController.getPreviewGroupId()) ?? 0; },
  groupController.updateCurrentGroupPlaceAngle,
);
const unfold2d = createUnfold2dManager(
  geometryContext.angleIndex,
  renderer2d,
  groupController.getGroupIds,
  groupController.getGroupFaces,
  groupController.getPreviewGroupId,
  groupController.getFaceGroupMap,
  groupController.getGroupColor,
  groupController.getGroupVisibility,
  groupController.getGroupTreeParent,
  () => geometryContext.geometryIndex.getFaceToEdges(),
  () => geometryContext.geometryIndex.getEdgesArray(),
  () => geometryContext.geometryIndex.getVertexKeyToPos(),
  () => geometryContext.geometryIndex.getFaceIndexMap(),
  () => geometryContext.geometryIndex.getEdgeKeyToId(),
  (edgeId, faceId) => geometryContext.geometryIndex.getThirdVertexKeyOnFace(edgeId, faceId),
  groupController.getGroupPlaceAngle,
  renderer3d.isTextureEnabled,
  () => renderer3d.getTexture(),
  log,
);
renderer2d.setEdgeQueryProviders({
  getEdges: unfold2d.getEdges2D,
  getBounds: unfold2d.getLastBounds,
  getFaceIdToEdges: () => geometryContext.geometryIndex.getFaceToEdges(),
  getPreviewGroupId: groupController.getPreviewGroupId,
});
const menuButtons = [menuOpenBtn, exportBtn, exportGroupStepBtn, exportGroupStlBtn, exportTabClipBtn, previewGroupModelBtn, settingsOpenBtn, aboutBtn];
const updateMenuState = () => {
  const isPreview = getWorkspaceState() === "previewGroupModel";
  menuButtons.forEach((btn) => {
    const shouldHide = isPreview && btn !== exportGroupStlBtn;
    btn?.classList.toggle("hidden", shouldHide);
  });
  exitPreviewBtn.classList.toggle("hidden", !isPreview);
  exportGroupStlBtn?.classList.toggle("hidden", false); // 在预览与普通模式都可见
  groupPreviewPanel.classList.toggle("hidden", isPreview);
  settingsOpenBtn.classList.toggle("hidden", isPreview);
  editorPreviewEl.classList.toggle("single-col", isPreview);
  requestAnimationFrame(() => renderer3d.resizeRenderer3D());
};

const buildGroupUIState = () => {
  const groupCount = groupController.getGroupsCount();
  const previewGroupId = groupController.getPreviewGroupId();
  const faces = groupController.getGroupFaces(previewGroupId)?.size ?? 0;
  const placeholderKey =
    getWorkspaceState() === "editingGroup"
      ? "preview.right.placeholder.edit"
      : "preview.right.placeholder";
  if (groupPreviewEmpty.dataset.i18n !== placeholderKey) {
    groupPreviewEmpty.dataset.i18n = placeholderKey;
  }
  groupPreviewEmpty.textContent = t(placeholderKey);
  groupPreviewEmpty.classList.toggle("hidden", faces > 0);
  return {
    groupCount: groupCount,
    groupIds: groupController.getGroupIds(),
    previewGroupId,
    editGroupState: getWorkspaceState() === "editingGroup",
    getGroupColor: groupController.getGroupColor,
    getGroupName: groupController.getGroupName,
    getGroupFacesCount: (id: number) => groupController.getGroupFaces(id)?.size ?? 0,
    getGroupVisibility: groupController.getGroupVisibility,
    deletable: groupCount > 1,
  };
};

const groupUI = createGroupUI(
  {
    groupTabsEl,
    groupPreview,
    groupFacesCountLabel,
    groupColorBtn,
    groupColorInput,
    groupDeleteBtn: (deleteHold?.el as HTMLButtonElement) ?? document.createElement("button"),
    groupVisibilityBtn: groupVisibilityToggle ?? undefined,
  },
  {
    onGroupSelect: (id) => {
      if (id === groupController.getPreviewGroupId()) return;
      groupController.setPreviewGroupId(id);
      const name = groupController.getGroupName(id) ?? `展开组 ${groupController.getGroupIds().indexOf(id) + 1}`;
      // log(`预览 ${name}`, "info");
    },
    onColorChange: (color: Color) => groupController.setGroupColor(groupController.getPreviewGroupId(), color),
    onDelete: () => {
      const previewGroupId = groupController.getPreviewGroupId();
      // const ok = confirm(`确定删除展开组 ${previewGroupId} 吗？该组的面将被移出。`);
      // if (!ok) return;
      groupController.deleteGroup(previewGroupId);
    },
    onRenameRequest: () => openRenameDialog(),
    onVisibilityToggle: (visible: boolean) => {
      const gid = groupController.getPreviewGroupId();
      groupController.setGroupVisibility(gid, visible);
      setFileSaved(false);
      groupUI.render(buildGroupUIState());
    },
    onTabHover: (id) => appEventBus.emit("groupBreathStart", id),
    onTabHoverOut: (id) => appEventBus.emit("groupBreathEnd", id),
  },
);
onLanguageChanged(applyI18nTexts);
void i18nReadyPromise.then(() => {
  applyI18nTexts();
});
window.addEventListener("resize", () => {
  syncHomeDemoCoverDisplaySize();
});

appEventBus.on("groupCurrentChanged", (groupId: number) => {
  groupUI.render(buildGroupUIState());
  refreshPreviewMeshCacheIndicator();
});
appEventBus.on("groupColorChanged", ({ groupId, color }) => {
  groupUI.render(buildGroupUIState());
  setFileSaved(false);
});
appEventBus.on("groupFaceAdded", ({ groupId }) => {
  groupUI.render(buildGroupUIState());
  setFileSaved(false);
});
appEventBus.on("groupFaceRemoved", ({ groupId }) => {
  groupUI.render(buildGroupUIState());
  setFileSaved(false);
});
appEventBus.on("groupPlaceAngleChanged", () => { setFileSaved(false); });
appEventBus.on("workspaceStateChanged", ({ previous, current }) =>  {
  if (current !== "loading") groupUI.render(buildGroupUIState());
  updateMenuState();
});

groupUI.render(buildGroupUIState());
updateMenuState();
historyPanelUI = bindHistorySystem({
  panel: document.getElementById("history-panel"),
  list: document.getElementById("history-list"),
  renderGroupUI: () => groupUI.render(buildGroupUIState()),
  captureProjectState,
  setFileSaved,
  previewMeshCacheManager,
  getPreviewGroupId: () => groupController.getPreviewGroupId(),
  getPreviewGroupName: () => groupController.getGroupName(groupController.getPreviewGroupId()) ?? "???",
  changeWorkspaceState,
  applyProjectState,
  updateMenuState,
  onPreviewMeshCacheMutated: refreshPreviewMeshCacheIndicator,
  log,
  t,
});
refreshPreviewMeshCacheIndicator();
if (viewer && groupPreview) {
  operationHints = createOperationHints({
    leftMount: viewer,
    rightMount: groupPreview,
    getWorkspaceState,
  });
}
onWorkerBusyChange((busy) => {
  workerBusy = busy;
  appEventBus.emit("workerBusyChange", busy);
  if (menuBlocker) {
    menuBlocker.classList.toggle("active", busy);
  }
  viewerModeControl.setDisabled(isViewerModeControlDisabled(getWorkspaceState()));
  if (busy && getWorkspaceState() === "editingGroup") {
    changeWorkspaceState("normal");
  }
});

groupAddBtn.addEventListener("click", () => {
  groupController.addGroup();
  if (getWorkspaceState() !== "editingGroup") {
    changeWorkspaceState("editingGroup");
  }
});
const handleExport3dppc = async () => {
  exportBtn.disabled = true;
  const model = getModel();
  if (!model) {
    log(t("log.export.none"), "error");
    return;
  }
  try {
    log(t("log.export.3dppc.start"), "info");
    const data = await build3dppcData(model);
    const fileName = download3dppc(data);
    log(t("log.export.3dppc.success", { fileName }), "success");
    setFileSaved(true);
  } catch (error) {
    console.error("保存失败", error);
    log(t("log.export.3dppc.fail"), "error");
  }
  finally {
    exportBtn.disabled = false;
  }
};
exportBtn.addEventListener("click", handleExport3dppc);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (getWorkspaceState() === "normal") {
      handleExport3dppc();
    }
  }
});
bindGroupPreviewActions({
  exportGroupStepBtn,
  exportGroupStlBtn,
  previewGroupModelBtn,
  getPreviewGroupId: () => groupController.getPreviewGroupId(),
  getPreviewGroupName: (groupId) => groupController.getGroupName(groupId),
  getProjectName: () => getCurrentProject().name || "未命名工程",
  getCurrentHistoryUid: () => historyManager.getCurrentSnapshotUid() ?? -1,
  getGroupPlaceAngle: (groupId) => groupController.getGroupPlaceAngle(groupId) ?? 0,
  hasGroupIntersection: (groupId) => unfold2d.hasGroupIntersection(groupId),
  getGroupPolygonsData: (groupId) => unfold2d.getGroupPolygonsData(groupId),
  previewMeshCacheManager,
  loadPreviewModel: (mesh, angle) => renderer3d.loadPreviewModel(mesh, angle),
  changeWorkspaceState,
  onPreviewMeshCacheMutated: refreshPreviewMeshCacheIndicator,
  log,
  t,
});

exportTabClipBtn?.addEventListener("click", async () => {
  if (!exportTabClipBtn) return;
  exportTabClipBtn.disabled = true;
  try {
    log(t("log.export.seamClip.start"), "info");
    const solid = await buildTabClip();
    const blob = solid.blobSTL({ binary: true });
    const buffer = await blob.arrayBuffer();
    const baseName = getCurrentProject().name || "未命名工程";
    const fileName = `${baseName}_tabClip.stl`;
    const url = URL.createObjectURL(new Blob([buffer], { type: "model/stl" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log(t("log.export.seamClip.success", { fileName }), "success");
  } catch (error) {
    console.error("拼接边固定夹导出失败", error);
    log(t("log.export.seamClip.fail"), "error");
  } finally {
    exportTabClipBtn.disabled = false;
  }
});

exitPreviewBtn.addEventListener("click", () => {
  changeWorkspaceState("normal");
});
