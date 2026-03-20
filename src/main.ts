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
import { createSettingsUI, applySettingsI18n, getSettingsUIRefs, type SettingsUIRefs } from "./modules/settingsUI";
import { SETTINGS_LIMITS } from "./modules/settings";
import { exportEdgeJoinTypes, getModel, importEdgeJoinTypes } from "./modules/model";
import {
  onWorkerBusyChange,
} from "./modules/replicad/replicadWorkerClient";
import { buildTabClip } from "./modules/replicad/replicadModeling";
import { startNewProject, getCurrentProject } from "./modules/project";
import { historyManager } from "./modules/history";
import { loadRawObject } from "./modules/fileLoader";
import { loadTextureFromFile, addTexture, getTextureCount, hasTextures, replaceTexture, createThreeTexture, getAllTextures, clearAllTextures, generateUVTexture, ensureUVsForModel } from "./modules/textureManager";
import {
  menu_open_IconSvg,
  menu_export_3dppc_IconSvg,
  menu_export_clip_IconSvg,
  menu_export_stl_IconSvg,
  menu_preview_IconSvg,
  menu_setting_IconSvg,
  menu_about_IconSvg,
  menu_exit_preview_IconSvg,
  viewerModeIconSvg,
  groupEditModeIconSvg,
  seamEditModeIconSvg,
  textureEditModeIconSvg,
} from "./templates/icons";
import { renderSettingsOverlay, renderRenameDialog, renderExportDialog } from "./templates/PopupsMarkup";
import type { Snapshot, ProjectState } from "./types/historyTypes.js";
import { exportGroupsData, getGroupColorCursor } from "./modules/groups";
import { importSettings, getSettings, resetSettings, applySettings } from "./modules/settings";
import { createOperationHints } from "./modules/operationHints";
import { createPreviewMeshCacheManager } from "./modules/previewMeshCache";
import { bindHistorySystem } from "./modules/historyBindings";
import { bindGroupPreviewActions, createExportCallback } from "./modules/groupPreviewActions";
import { downloadBlob } from "./modules/gifRecorder";
import { loadHomeChangelog } from "./modules/homeChangelog";
import { createGifCaptureController } from "./modules/gifCapture";
import { createHoldButton } from "./components/createHoldButton";
import { createSegmentedControl } from "./components/createSegmentedControl";
import "./styles/home.css";
import { renderHomeSection } from "./templates/homeMarkup";
import { initI18n, t, getCurrentLang, setLanguage, onLanguageChanged } from "./modules/i18n";
import {
  setHomeDemoElements,
  loadHomeDemoProjects,
  renderHomeDemoOptions,
  syncHomeDemoCoverDisplaySize,
  getHomeDemoCaptureTargetHeight,
  getDemoFileName,
  setIsCurrentProjectDemo,
  isCurrentProjectDemo,
  homeDemoProjects,
  selectedHomeDemoProjectId,
} from "./modules/homeDemo";
import { setToolbarElements, setRendererRef, createRefreshToggleTextLabels, refreshToggleTexts, handleWorkspaceStateChange, setHasTexturesRef, setRefreshToggleTextLabelsRef } from "./modules/toolbarState";
import { initAboutDialog } from "./modules/aboutDialog";
import { initRenameDialog } from "./modules/renameDialog";
import { getExportUIRefs, createExportUI } from "./modules/exportUI";

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
  applySettingsI18n();
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
        <button class="btn ghost menu-btn-with-icon" id="export-group-stl-btn"><span class="menu-btn-icon">${menu_export_stl_IconSvg}</span><span class="menu-btn-label" data-i18n="menu.export.group">导出展开组</span></button>
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

  ${renderSettingsOverlay()}
  ${renderRenameDialog()}
  ${renderExportDialog()}
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
const renameModal = document.querySelector<HTMLDivElement>("#rename-modal");
const loadingOverlay = document.querySelector<HTMLDivElement>("#loading-overlay");
langToggleBtn = document.querySelector<HTMLButtonElement>("#lang-toggle");
langToggleGlobalBtn = document.querySelector<HTMLButtonElement>("#lang-toggle-global");

// 设置 homeDemo 模块的 DOM 元素引用
setHomeDemoElements(homeDemoOptionsEl, homeDemoEntry);

const showLoadingOverlay = () => loadingOverlay?.classList.remove("hidden");
const hideLoadingOverlay = () => loadingOverlay?.classList.add("hidden");
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
  !exportGroupStlBtn ||
  !previewGroupModelBtn ||
  !jumpLinkBtn ||
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
  !renameModal ||
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

// 初始化关于对话框（包含 DOM 元素查询和完整性检测）
const aboutDialog = initAboutDialog();

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

// 获取设置面板的 DOM 元素
const settingsRefs = getSettingsUIRefs();
if (!settingsRefs) {
  throw new Error("初始化设置界面失败，缺少必要的元素");
}

const settingsUI = createSettingsUI(settingsRefs, { log });

// 获取导出对话框的 DOM 元素
const exportRefs = getExportUIRefs();
if (!exportRefs) {
  throw new Error("初始化导出对话框失败，缺少必要的元素");
}

// 创建导出回调函数
const exportCallback = createExportCallback({
  getPreviewGroupId: () => groupController.getPreviewGroupId(),
  getPreviewGroupName: (groupId) => groupController.getGroupName(groupId),
  getProjectName: () => getCurrentProject().name || "未命名工程",
  getCurrentHistoryUid: () => historyManager.getCurrentSnapshotUid() ?? -1,
  getGroupPlaceAngle: (groupId) => groupController.getGroupPlaceAngle(groupId) ?? 0,
  hasGroupIntersection: (groupId) => unfold2d.hasGroupIntersection(groupId),
  getGroupPolygonsData: (groupId) => unfold2d.getGroupPolygonsData(groupId),
  previewMeshCacheManager,
  onPreviewMeshCacheMutated: refreshPreviewMeshCacheIndicator,
  log,
  t,
});

// 创建导出对话框 UI
const exportUI = createExportUI(exportRefs, { onExport: exportCallback });

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

// 初始化重命名对话框（包含 DOM 元素查询和完整性检测）
const renameDialog = initRenameDialog({
  groupController,
  settingsUI,
  log,
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
// 设置工具栏元素引用
const bboxToggle = document.querySelector<HTMLButtonElement>("#bbox-toggle")!;
bboxToggle.classList.add("active");
setToolbarElements({
  textureToggle,
  lightToggle,
  edgesToggle,
  seamsToggle,
  facesToggle,
  bboxToggle,
  loadTextureBtn,
  generateTextureBtn,
  clearTextureBtn,
  exportTextureBtn,
  groupPreviewMask,
});
setRendererRef(renderer3d);
setHasTexturesRef(hasTextures);
refreshToggleTextLabels = createRefreshToggleTextLabels();
setRefreshToggleTextLabelsRef(refreshToggleTextLabels);
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

// 监听设置变化，当 scale 变化时自动打开包围盒
appEventBus.on("settingsChanged", (changedItems) => {
  if (changedItems.includes("scale")) {
    const currentVisible = renderer3d.getBBoxVisible();
    if (!currentVisible) {
      renderer3d.setBBoxEnabled(true);
      bboxToggle.classList.add("active");
      refreshToggleTextLabels?.();
    }
  }
});

// 监听贴图变动事件
// 监听贴图变动事件，统一处理贴图相关逻辑
appEventBus.on("texturesChanged", async ({ textureData, action, userInitiated }) => {
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
    // 仅用户主动清除时输出日志
    if (userInitiated) {
      log(t("log.texture.cleared"), "info");
    }

    // 如果贴图渲染开关打开，重建 2D 视图
    if (renderer3d.isTextureEnabled()) {
      unfold2d.rebuildCurrentGroup();
    }
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

    // 如果贴图渲染开关打开，重建 2D 视图
    if (renderer3d.isTextureEnabled()) {
      unfold2d.rebuildCurrentGroup();
    }
  }
});

appEventBus.on("workspaceStateChanged", ({ current, previous }) => {
  const isPreview = current === "previewGroupModel";
  handleWorkspaceStateChange(current, previous);
  // 历史面板显示/隐藏（保留在 main.ts 中因为涉及 historyPanelUI）
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
    setIsCurrentProjectDemo(false);
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
    setIsCurrentProjectDemo(true);
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
    // 确保模型有 UV 坐标
    const uvGenerated = ensureUVsForModel(getModel());
    if (uvGenerated) {
      log(t("log.texture.uvAutoGenerated"), "info");
    }

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
    // 获取当前模型并确保有 UV 坐标
    const model = getModel();
    const uvGenerated = ensureUVsForModel(model);
    if (uvGenerated) {
      log(t("log.texture.uvAutoGenerated"), "info");
    }

    let geometry: THREE.BufferGeometry | undefined;
    if (model) {
      model.traverse((child) => {
        const mesh = child as { isMesh?: boolean; geometry?: THREE.BufferGeometry };
        if (mesh.isMesh && mesh.geometry && !geometry) {
          geometry = mesh.geometry;
        }
      });
    }
    const textureData = await generateUVTexture(geometry);
    // 清除旧贴图数据（自动替换，不输出日志）
    if (hasTextures()) {
      clearAllTextures(false);
    }
    addTexture(textureData);
  } catch (err) {
    console.error("生成贴图失败", err);
    log(t("log.texture.generateFailed"), "error");
  }
});

clearTextureBtn.addEventListener("click", () => {
  clearAllTextures(true);
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
const menuButtons = [menuOpenBtn, exportBtn, exportGroupStlBtn, exportTabClipBtn, previewGroupModelBtn, settingsOpenBtn, aboutDialog.aboutBtn];
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
  jumpLinkBtn.classList.toggle("hidden", isPreview);
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
    onRenameRequest: () => renameDialog.open(),
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
  exportGroupStlBtn: null as any,
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

// 导出 STL 按钮点击事件：打开导出对话框
exportGroupStlBtn?.addEventListener("click", () => {
  const groupId = groupController.getPreviewGroupId();
  const groupName = groupController.getGroupName(groupId) || `展开组 ${groupId}`;
  const faces = groupController.getGroupFaces(groupId);
  const faceCount = faces ? faces.size : 0;
  const projectName = getCurrentProject().name || "未命名工程";
  exportUI.open(groupName, faceCount, projectName);
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
