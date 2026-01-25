// 应用入口与编排层：负责初始化页面结构、事件总线订阅、组/拼缝控制器与渲染器的装配，并绑定 UI 交互。
import "./style.css";
import packageJson from "../package.json";
import { Color, Mesh, Matrix4 } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
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
import { getDefaultSettings, SETTINGS_LIMITS } from "./modules/settings";
import { getModel } from "./modules/model";
import {
  buildStepInWorker,
  buildStlInWorker,
  buildMeshInWorker,
  onWorkerBusyChange,
  isWorkerBusy,
} from "./modules/replicad/replicadWorkerClient";
import { buildEarClip } from "./modules/replicad/replicadModeling";
import { startNewProject, getCurrentProject } from "./modules/project";
import { historyManager } from "./modules/history";
import type { MetaAction } from "./types/historyTypes.js";
import { loadRawObject } from "./modules/fileLoader";
import { createHistoryPanel } from "./modules/historyPanel";
import type { Snapshot, ProjectState } from "./types/historyTypes.js";
import { exportGroupsData, getGroupColorCursor } from "./modules/groups";
import { importSettings, getSettings, resetSettings } from "./modules/settings";
import { createOperationHints } from "./modules/operationHints";

const VERSION = packageJson.version ?? "0.0.0.0";

type PreviewMeshCacheItem = { mesh: Mesh, earClipNumTotal: number, groupId: number, historyUidCreated: number, historyUidAbandoned: number };
// 预览模型缓存，带有效期 
const previewMeshCache: PreviewMeshCacheItem[] = [];
const MAX_PREVIEW_MESH_CACHE_SIZE = 30;
const stlLoader = new STLLoader();
const defaultSettings = getDefaultSettings();
const limits = SETTINGS_LIMITS;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

const setProjectNameLabel = (name: string) => {
  if (projectNameLabel) {
    projectNameLabel.textContent = isFileSaved ? `${name}` : `${name} *`;
  }
};
// 文件已保存状态
let isFileSaved = true;
const setFileSaved = (value: boolean) => {
  isFileSaved = value;
  setProjectNameLabel(getCurrentProject().name ?? "未命名工程");
};

let historyPanelUI: ReturnType<typeof createHistoryPanel> | null = null;
let operationHints: ReturnType<typeof createOperationHints> | null = null;
const captureProjectState = (): ProjectState => ({
  groups: exportGroupsData(),
  colorCursor: getGroupColorCursor(),
  previewGroupId: groupController.getPreviewGroupId(),
  settings: getSettings(),
  groupVisibility: groupController.getGroupVisibilityEntries(),
});

const applyProjectState = (snap: Snapshot) => {
  const state = snap.data;
  const importedGroups = state.groups.map((g) => ({
    id: g.id,
    faces: g.faces,
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
  groupUI.render(buildGroupUIState());
};

app.innerHTML = `
  <main class="shell">
    <div class="version-badge version-badge-global">v${VERSION}</div>
    <input id="file-input" type="file" accept=".obj,.fbx,.stl,.3dppc,application/json" style="display:none" autocomplete="off" />

    <section id="layout-empty" class="page home active">
      <div class="home-card">
        <div class="home-title">3D打印纸艺</div>
        <div class="home-subtitle">选择一个模型文件开始编辑</div>
        <button id="home-start" class="btn primary">打开模型</button>
        <div class="home-meta">支持 OBJ / FBX / STL / 3dppc</div>
      </div>
    </section>

    <section id="layout-workspace" class="page">
      <header class="editor-header">
        <div class="editor-title">
          <span class="editor-title-main">3D打印纸艺</span>
          <span class="editor-title-project" id="project-name-label"></span>
        </div>
        <div class="version-badge">v${VERSION}</div>
      </header>
    <nav class="editor-menu">
        <button class="btn ghost hidden" id="exit-preview-btn">退出预览</button>
        <button class="btn ghost" id="menu-open">打开模型</button>
        <button class="btn ghost" id="export-btn">保存 .3dppc</button>
        <button class="btn ghost" id="export-group-step-btn">导出展开组 STEP</button>
        <button class="btn ghost" id="export-group-stl-btn">导出展开组 STL</button>
        <button class="btn ghost" id="export-ear-clip-btn">导出拼接边固定夹 STL</button>
        <button class="btn ghost" id="preview-group-model-btn">预览展开组模型</button>
        <button class="btn ghost" id="settings-open-btn">项目设置</button>
        <div id="menu-blocker" class="menu-blocker"></div>
      </nav>
  <section class="editor-preview">
    <div class="preview-panel">
      <div class="preview-toolbar">
        <button class="btn sm ghost" id="reset-view-btn">重置视角</button>
        <button class="btn sm toggle active" id="light-toggle">光源：开</button>
        <button class="btn sm toggle" id="edges-toggle">线框：关</button>
        <button class="btn sm toggle" id="seams-toggle">拼接边：关</button>
        <button class="btn sm toggle active" id="faces-toggle">面渲染：开</button>
        <button class="btn sm toggle" id="bbox-toggle">包围盒：关</button>
        <div class="toolbar-spacer"></div>
        <span class="toolbar-stat" id="tri-counter">渲染负载：0</span>
      </div>
      <div class="preview-area" id="viewer">
        <div id="history-panel" class="history-panel hidden">
          <div id="history-list" class="history-list"></div>
        </div>
      </div>
    </div>
    <div class="preview-panel">
          <div class="preview-toolbar">
            <button class="btn sm toggle" id="group-edit-toggle">编辑展开组</button>
            <div class="group-tabs" id="group-tabs"></div>
            <div class="toolbar-spacer"></div>
            <button class="btn sm tab-add" id="group-add">+</button>
          </div>
          <div class="preview-area" id="group-preview">
            <div class="overlay-group-meta">
              <button class="overlay-btn color-swatch" id="group-color-btn" title="选择组颜色"></button>
              <button class="overlay-btn overlay-visibility" id="group-visibility-toggle" title="显示/隐藏展开组">
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
              <span class="overlay-label group-faces-count" id="group-faces-count">面数量 0</span>
            </div>
            <button class="overlay-btn tab-delete" id="group-delete" title="删除展开组">删除组</button>
            <div id="group-preview-empty" class="preview-2d-empty hidden">
              点击【编辑展开组】按钮进行编辑
            </div>
            <input type="color" id="group-color-input" class="color-input" autocomplete="off" />
          </div>
        </div>
      </section>
  </section>
</main>
  <div id="loading-overlay" class="loading-overlay hidden"></div>
  <div id="log-panel" class="log-panel hidden">
    <div id="log-list" class="log-list"></div>
  </div>

  <div id="settings-overlay" class="settings-overlay hidden">
    <div class="settings-modal">
      <div class="settings-header">
        <div class="settings-title">项目设置</div>
      </div>
      <div class="settings-body">
        <div class="settings-nav">
          <button class="settings-nav-item active" id="settings-nav-basic">基础设置</button>
          <button class="settings-nav-item" id="settings-nav-experiment">实验设置</button>
        </div>
        <div class="settings-content">
          <div class="settings-panel active" id="settings-panel-basic">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-scale" class="setting-label">缩放比例</label>
                <span class="setting-desc">模型整体缩放比例，太小会导致打印文件生成失败</span>
              </div>
              <div class="setting-field">
                <input id="setting-scale" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-scale-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-layer-height" class="setting-label">打印层高</label>
                <span class="setting-desc">实际打印时的层高设置，最大${limits.layerHeight.max}，默认${defaultSettings.layerHeight}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-layer-height" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-layer-height-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label">连接层数</span>
                <span class="setting-desc">面之间连接处的层数，${limits.connectionLayers.min}-${limits.connectionLayers.max}，默认${defaultSettings.connectionLayers}</span>
              </div>
              <div class="setting-field">
                <div class="setting-counter-group">
                  <button id="setting-connection-layers-dec" class="btn ghost settings-inline-btn">-</button>
                  <span id="setting-connection-layers-value" class="setting-range-value"></span>
                  <button id="setting-connection-layers-inc" class="btn ghost settings-inline-btn">+</button>
                </div>
                <button id="setting-connection-layers-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label">主体额外层数</span>
                <span class="setting-desc">面主体的额外层数，${limits.bodyLayers.min}-${limits.bodyLayers.max}，默认${defaultSettings.bodyLayers}</span>
              </div>
              <div class="setting-field">
                <div class="setting-counter-group">
                  <button id="setting-body-layers-dec" class="btn ghost settings-inline-btn">-</button>
                  <span id="setting-body-layers-value" class="setting-range-value"></span>
                  <button id="setting-body-layers-inc" class="btn ghost settings-inline-btn">+</button>
                </div>
                <button id="setting-body-layers-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-ear-width" class="setting-label">拼接边耳朵宽度</label>
                <span class="setting-desc">用于拼接边粘接的耳朵宽度，${limits.earWidth.min}-${limits.earWidth.max}，默认${defaultSettings.earWidth}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-ear-width" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-ear-width-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-ear-thickness" class="setting-label">拼接边耳朵厚度</label>
                <span class="setting-desc">用于拼接边粘接的耳朵厚度，${limits.earThickness.min}-${limits.earThickness.max}，默认${defaultSettings.earThickness}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-ear-thickness" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-ear-thickness-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-ear-clip-gap" class="setting-label">夹子配合间隙</label>
                <span class="setting-desc">连接耳朵的夹子松紧程度，值越大越容易安装，${limits.earClipGap.min}-${limits.earClipGap.max}，默认${defaultSettings.earClipGap}</span>
              </div>
              <div class="setting-field">
                <input id="setting-ear-clip-gap" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-ear-clip-gap-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-experiment">
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label">镂空风格</span>
                <span class="setting-desc">去除三角面的中间部分，默认关闭</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-hollow-off" class="btn ghost settings-inline-btn">关闭</button>
                  <button id="setting-hollow-on" class="btn ghost settings-inline-btn">开启</button>
                </div>
                <button id="setting-hollow-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-wireframe-thickness" class="setting-label">线框粗细</label>
                <span class="setting-desc">镂空风格下线框的粗细，单位mm，${limits.wireframeThickness.min}-${limits.wireframeThickness.max}，默认${defaultSettings.wireframeThickness}</span>
              </div>
              <div class="setting-field">
                <input id="setting-wireframe-thickness" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-wireframe-thickness-reset" class="btn ghost settings-inline-btn">恢复默认</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-footer">
        <button id="settings-cancel-btn" class="btn ghost settings-action">取消</button>
        <button id="settings-confirm-btn" class="btn primary settings-action">确定</button>
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
const projectNameLabel = document.getElementById("project-name-label");
const logListEl = document.querySelector<HTMLDivElement>("#log-list");
const logPanelEl = document.querySelector<HTMLDivElement>("#log-panel");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const homeStartBtn = document.querySelector<HTMLButtonElement>("#home-start");
const exitPreviewBtn = document.querySelector<HTMLButtonElement>("#exit-preview-btn");
const menuOpenBtn = document.querySelector<HTMLButtonElement>("#menu-open");
const menuBlocker = document.querySelector<HTMLDivElement>("#menu-blocker");
const editorPreviewEl = document.querySelector<HTMLElement>(".editor-preview");
const resetViewBtn = document.querySelector<HTMLButtonElement>("#reset-view-btn");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const seamsToggle = document.querySelector<HTMLButtonElement>("#seams-toggle");
const facesToggle = document.querySelector<HTMLButtonElement>("#faces-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
const exportGroupStepBtn = document.querySelector<HTMLButtonElement>("#export-group-step-btn");
const exportGroupStlBtn = document.querySelector<HTMLButtonElement>("#export-group-stl-btn");
const exportEarClipBtn = document.querySelector<HTMLButtonElement>("#export-ear-clip-btn");
const previewGroupModelBtn = document.querySelector<HTMLButtonElement>("#preview-group-model-btn");
const settingsOpenBtn = document.querySelector<HTMLButtonElement>("#settings-open-btn");
const triCounter = document.querySelector<HTMLDivElement>("#tri-counter");
const groupTabsEl = document.querySelector<HTMLDivElement>("#group-tabs");
const groupAddBtn = document.querySelector<HTMLButtonElement>("#group-add");
const groupPreview = document.querySelector<HTMLDivElement>("#group-preview");
const groupPreviewEmpty = document.querySelector<HTMLDivElement>("#group-preview-empty");
const groupVisibilityToggle = document.querySelector<HTMLButtonElement>("#group-visibility-toggle");
const settingsOverlay = document.querySelector<HTMLDivElement>("#settings-overlay");
const settingsContent = settingsOverlay?.querySelector<HTMLDivElement>(".settings-content") || null;
const renameOverlay = document.querySelector<HTMLDivElement>("#rename-overlay");
const renameModal = document.querySelector<HTMLDivElement>("#rename-modal");
const renameInput = document.querySelector<HTMLInputElement>("#rename-input");
const renameCancelBtn = document.querySelector<HTMLButtonElement>("#rename-cancel-btn");
const renameConfirmBtn = document.querySelector<HTMLButtonElement>("#rename-confirm-btn");
const loadingOverlay = document.querySelector<HTMLDivElement>("#loading-overlay");

const showLoadingOverlay = () => loadingOverlay?.classList.remove("hidden");
const hideLoadingOverlay = () => loadingOverlay?.classList.add("hidden");
const settingsCancelBtn = document.querySelector<HTMLButtonElement>("#settings-cancel-btn");
const settingsConfirmBtn = document.querySelector<HTMLButtonElement>("#settings-confirm-btn");
const settingScaleInput = document.querySelector<HTMLInputElement>("#setting-scale");
const settingScaleResetBtn = document.querySelector<HTMLButtonElement>("#setting-scale-reset");
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
const settingEarWidthInput = document.querySelector<HTMLInputElement>("#setting-ear-width");
const settingEarWidthResetBtn = document.querySelector<HTMLButtonElement>("#setting-ear-width-reset");
const settingEarThicknessInput = document.querySelector<HTMLInputElement>("#setting-ear-thickness");
const settingEarThicknessResetBtn = document.querySelector<HTMLButtonElement>("#setting-ear-thickness-reset");
const settingEarClipGapInput = document.querySelector<HTMLInputElement>("#setting-ear-clip-gap");
const settingEarClipGapResetBtn = document.querySelector<HTMLButtonElement>("#setting-ear-clip-gap-reset");
const settingHollowOffBtn = document.querySelector<HTMLButtonElement>("#setting-hollow-off");
const settingHollowOnBtn = document.querySelector<HTMLButtonElement>("#setting-hollow-on");
const settingHollowResetBtn = document.querySelector<HTMLButtonElement>("#setting-hollow-reset");
const settingWireframeThicknessInput = document.querySelector<HTMLInputElement>("#setting-wireframe-thickness");
const settingWireframeThicknessResetBtn = document.querySelector<HTMLButtonElement>("#setting-wireframe-thickness-reset");
const settingWireframeRow = settingWireframeThicknessInput?.closest(".setting-row") as HTMLDivElement | null;
const settingNavBasic = document.querySelector<HTMLButtonElement>("#settings-nav-basic");
const settingNavExperiment = document.querySelector<HTMLButtonElement>("#settings-nav-experiment");
const settingPanelBasic = document.querySelector<HTMLDivElement>("#settings-panel-basic");
const settingPanelExperiment = document.querySelector<HTMLDivElement>("#settings-panel-experiment");
const groupPreviewPanel = groupPreview?.closest(".preview-panel") as HTMLDivElement | null;
const groupFacesCountLabel = document.querySelector<HTMLSpanElement>("#group-faces-count");
const groupColorBtn = document.querySelector<HTMLButtonElement>("#group-color-btn");
const groupColorInput = document.querySelector<HTMLInputElement>("#group-color-input");
const groupDeleteBtn = document.querySelector<HTMLButtonElement>("#group-delete");
const groupEditToggle = document.querySelector<HTMLButtonElement>("#group-edit-toggle");
const layoutEmpty = document.querySelector<HTMLElement>("#layout-empty");
const layoutWorkspace = document.querySelector<HTMLElement>("#layout-workspace");
const versionBadgeGlobal = document.querySelector<HTMLDivElement>(".version-badge-global");

if (
  !viewer ||
  !logListEl ||
  !fileInput ||
  !homeStartBtn ||
  !exitPreviewBtn ||
  !editorPreviewEl ||
  !menuOpenBtn ||
  !resetViewBtn ||
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
  !groupFacesCountLabel ||
  !groupColorBtn ||
  !groupColorInput ||
  !groupDeleteBtn ||
  !groupEditToggle ||
  !layoutEmpty ||
  !layoutWorkspace ||
  !settingsOverlay ||
  !renameOverlay ||
  !renameModal ||
  !renameInput ||
  !renameCancelBtn ||
  !renameConfirmBtn ||
  !settingsCancelBtn ||
  !settingsConfirmBtn ||
  !settingScaleInput ||
  !settingScaleResetBtn ||
  !settingEarWidthInput ||
  !settingEarWidthResetBtn ||
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
  !settingEarThicknessInput ||
  !settingEarThicknessResetBtn ||
  !settingEarClipGapInput ||
  !settingEarClipGapResetBtn ||
  !settingHollowOffBtn ||
  !settingHollowOnBtn ||
  !settingHollowResetBtn ||
  !settingWireframeThicknessInput ||
  !settingWireframeThicknessResetBtn ||
  !settingWireframeRow ||
  !settingNavBasic ||
  !settingNavExperiment ||
  !settingPanelBasic ||
  !settingPanelExperiment ||
  !settingsOpenBtn ||
  !settingsContent
) {
  throw new Error("初始化界面失败，缺少必要的元素");
}
// 预加载 workspace 布局，方便渲染器在首帧前完成尺寸初始化
layoutWorkspace.classList.add("preloaded");
// 确保文件选择框只允许支持的模型/3dppc 后缀
fileInput.setAttribute("accept", ".obj,.fbx,.stl,.3dppc");
document.querySelectorAll("input").forEach((inp) => inp.setAttribute("autocomplete", "off"));

const { log } = createLog(logListEl);
const changeWorkspaceState = (state: WorkspaceState) => {
  const previousState = getWorkspaceState();
  if (previousState === state) return;
  setWorkspaceState(state);
  if (state === "loading") {
    showLoadingOverlay();
  } else {
    hideLoadingOverlay();
  }
  if (previousState === "editingGroup") log("已退出展开组编辑模式", "info");
  if (state === "editingGroup") log("已进入展开组编辑模式", "info");
  if (previousState === "previewGroupModel") log("已退出组模型预览", "info");
  if (state === "previewGroupModel") log("展开组预览模型已加载", "info");
  appEventBus.emit("workspaceStateChanged", { previous: previousState, current: state });
};

const clearAppStates = () => {
  changeWorkspaceState("loading");
  previewMeshCache.length = 0;
  historyAbandonJudgeMethods.clear();
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
    scaleInput: settingScaleInput,
    scaleResetBtn: settingScaleResetBtn,
    earWidthInput: settingEarWidthInput,
    earWidthResetBtn: settingEarWidthResetBtn,
    earThicknessInput: settingEarThicknessInput,
    earThicknessResetBtn: settingEarThicknessResetBtn,
    earClipGapInput: settingEarClipGapInput,
    earClipGapResetBtn: settingEarClipGapResetBtn,
    hollowOnBtn: settingHollowOnBtn,
    hollowOffBtn: settingHollowOffBtn,
    hollowResetBtn: settingHollowResetBtn,
    wireframeThicknessInput: settingWireframeThicknessInput,
    wireframeThicknessResetBtn: settingWireframeThicknessResetBtn,
    wireframeRow: settingWireframeRow,
    navBasic: settingNavBasic,
    navExperiment: settingNavExperiment,
    panelBasic: settingPanelBasic,
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

const getCachedPreviewMesh = (groupId: number): { mesh: Mesh, earClipNumTotal: number, angle: number } | null => {
  const currentHistoryUid = historyManager.getCurrentSnapshotUid()?? -1;
  const cached = previewMeshCache.find((c) => c.groupId === groupId && c.historyUidCreated <= currentHistoryUid && c.historyUidAbandoned > currentHistoryUid);
  if (!cached) return null;
  const mesh = cached.mesh.clone();
  const angle = groupController.getGroupPlaceAngle(groupId) ?? 0;
  if (Math.abs(angle) > 1e-8) {
    mesh.applyMatrix4(new Matrix4().makeRotationZ(-angle));
  }
  mesh.updateMatrixWorld(true);
  mesh.geometry?.computeBoundingBox?.();
  mesh.geometry?.computeBoundingSphere?.();
  return { mesh, earClipNumTotal: cached.earClipNumTotal, angle };
};

const addCachedPreviewMesh = (groupId: number, mesh: Mesh, earClipNumTotal: number) => {
  const currentHistoryUid = historyManager.getCurrentSnapshotUid()?? -1;
  previewMeshCache.push({
    mesh,
    earClipNumTotal,
    groupId,
    historyUidCreated: currentHistoryUid,
    historyUidAbandoned: Infinity,
  });
  if (previewMeshCache.length > MAX_PREVIEW_MESH_CACHE_SIZE) {
    previewMeshCache.splice(0, previewMeshCache.length - MAX_PREVIEW_MESH_CACHE_SIZE);
  }
  // console.log("addCachedPreviewMesh", groupId, currentHistoryUid, previewMeshCache.length);
};

const abandonCachedPreviewMesh = (judgeMethod: AbandonCachedPreviewMeshJudgeMethod) => {
  // console.log("abandonCachedPreviewMesh called");
  abandonHistoryCachedPreviewMesh(judgeMethod, historyManager.getCurrentSnapshotUid()?? -1);
};
const abandonHistoryCachedPreviewMesh = (judgeMethod: AbandonCachedPreviewMeshJudgeMethod, historyUid: number) => {
  // console.log("abandonHistoryCachedPreviewMesh", historyUid);
  for (const cache of previewMeshCache) {
    if (cache.historyUidCreated < historyUid && judgeMethod(cache)) {
      // console.log("  abandoned", cache.groupId, cache.historyUidCreated, cache.historyUidAbandoned);
      cache.historyUidAbandoned = historyUid;
    }
  }
};

type AbandonCachedPreviewMeshJudgeMethod = (cache: PreviewMeshCacheItem) => boolean;
const historyAbandonJudgeMethods: Map<number, AbandonCachedPreviewMeshJudgeMethod> = new Map();

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
    log("组名无效，请输入至少一个可见字符", "error");
    closeRenameDialog();
    return;
  }
  groupController.setGroupName(groupController.getPreviewGroupId(), val.trim());
  log("展开组名称修改成功", "success");
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
bboxToggle.addEventListener("click", () => {
  const visible = renderer3d.toggleBBox();
  bboxToggle.classList.toggle("active", visible);
  bboxToggle.textContent = `包围盒：${visible ? "开" : "关"}`;
});
appEventBus.on("workspaceStateChanged", ({ current, previous }) => {
  const isPreview = current === "previewGroupModel";
  bboxToggle.classList.toggle("hidden", isPreview);
  if (isPreview) {
    bboxToggle.classList.remove("active");
    bboxToggle.textContent = "包围盒：关";
  } else {
    const visible = (renderer3d as any).getBBoxVisible?.() ?? false;
    bboxToggle.classList.toggle("active", visible);
    bboxToggle.textContent = `包围盒：${visible ? "开" : "关"}`;
  }
  if (historyPanelUI) {
    const panel = document.getElementById("history-panel");
    panel?.classList.toggle("hidden", isPreview);
  }
});

appEventBus.on("historyApplySnapshot", ({ current, direction, snapPassed} ) => {
  // console.log("historyApplySnapshot", current, direction, snapPassed);
  changeWorkspaceState("normal");
  applyProjectState(current);
  // redo时，需要根据时间线索废弃一些缓存
  if (direction === "redo") {
    for (const uid of snapPassed) {
      const judgeMethod = historyAbandonJudgeMethods.get(uid);
      if (judgeMethod) {
        abandonHistoryCachedPreviewMesh(judgeMethod, uid);
      }
    }
  }
  historyManager.markApplied(current.action);
  log(`已回溯至 [${current.action.description}] (${Math.floor((Date.now() - current.action.timestamp) / 60000)}分钟前)`, "info", false);
  setFileSaved(false);
});

appEventBus.on("historyApplied", (action) => {
  groupUI.render(buildGroupUIState());
  updateGroupEditToggle();
  updateMenuState();
  historyPanelUI?.render();
});

appEventBus.on("historyErased", (erasedHistoryUid) => {
  // 清理 previewMeshCache 中对应的记录
  for (let i = previewMeshCache.length - 1; i >= 0; i--) {
    if (previewMeshCache[i].historyUidAbandoned >= erasedHistoryUid[0]) {
      // console.log(" reopen cached mesh", previewMeshCache[i].groupId, previewMeshCache[i].historyUidCreated, previewMeshCache[i].historyUidAbandoned);
      previewMeshCache[i].historyUidAbandoned = Infinity;
    }
    // 这里是您的删除条件判断
    if (previewMeshCache[i].historyUidCreated >= erasedHistoryUid[0]) {
      // 满足条件，则删除当前元素 (i, 1)
      // console.log(" delete cached mesh", previewMeshCache[i].groupId, previewMeshCache[i].historyUidCreated, previewMeshCache[i].historyUidAbandoned);
      previewMeshCache.splice(i, 1);
    }
  }
  // 清理 abandonJudgeMethods 中对应的记录
  const keysToDelete: number[] = [];
  for (const [historyUid, judgeMethod] of historyAbandonJudgeMethods) {
    if (historyUid >= erasedHistoryUid[0]) keysToDelete.push(historyUid);
  }
  for (const key of keysToDelete) {
    historyAbandonJudgeMethods.delete(key);
  }
});

const projectLoaded = () => {
  if (versionBadgeGlobal) versionBadgeGlobal.style.display = "none";
  logPanelEl?.classList.remove("hidden");
  layoutEmpty.classList.toggle("active", false);
  layoutWorkspace.classList.toggle("active", true);
  layoutWorkspace.classList.remove("preloaded");
  updateMenuState();
  groupUI.render(buildGroupUIState());
  historyManager.reset();
  historyManager.push(captureProjectState(), { name: "载入模型", description: "载入了模型", timestamp: Date.now()});
  historyPanelUI?.render();
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
const handleFileSelected = async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    hideLoadingOverlay();
    return;
  }
  const ext = getExtension(file.name);
  if (!allowedExtensions.includes(ext)) {
    log("不支持的格式，请选择 OBJ / FBX / STL。", "error");
    return;
  }
  try {
    clearAppStates();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { object, importedGroups, importedColorCursor, importedSeting } = await loadRawObject(file, ext);
    const projectInfo = startNewProject(getProjectNameFromFile(file.name));
    await renderer3d.applyObject(object, file.name);
    if (importedGroups && importedGroups.length) {
      groupController.applyImportedGroups(importedGroups, importedColorCursor);
    }
    if (importedSeting) {
      importSettings(importedSeting);
    } else {
      resetSettings();
    }
    appEventBus.emit("projectChanged", projectInfo);
    projectLoaded();
    setProjectNameLabel(projectInfo.name);
  } catch (error) {
    console.error("加载模型失败", error);
    if ((error as Error)?.stack) {
      console.error((error as Error).stack);
    }
    log("加载失败，请检查文件格式是否正确。", "error");
    renderer3d.clearModel();
    resetSettings();
  }
  finally {
    changeWorkspaceState("normal");
  }
  fileInput.value = "";
  hideLoadingOverlay();
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
homeStartBtn.addEventListener("click", () => {
  fileInput.value = "";
  showLoadingOverlay();
  fileInput.click();
});
menuOpenBtn.addEventListener("click", () => {
  fileInput.value = "";
  showLoadingOverlay();
  fileInput.click();
});
resetViewBtn.addEventListener("click", () => renderer3d.resetView());
lightToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleLight();
  lightToggle.classList.toggle("active", enabled);
  lightToggle.textContent = `光源：${enabled ? "开" : "关"}`;
});
edgesToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleEdges();
  edgesToggle.classList.toggle("active", enabled);
  edgesToggle.textContent = `线框：${enabled ? "开" : "关"}`;
});
seamsToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleSeams();
  seamsToggle.classList.toggle("active", enabled);
  seamsToggle.textContent = `拼接边：${enabled ? "开" : "关"}`;
});
facesToggle.addEventListener("click", () => {
  const enabled = renderer3d.toggleFaces();
  facesToggle.classList.toggle("active", enabled);
  facesToggle.textContent = `面渲染：${enabled ? "开" : "关"}`;
});

// 初始化开关状态（renderer 默认全开启）
lightToggle.classList.add("active");
lightToggle.textContent = "光源：开";
edgesToggle.classList.add("active");
edgesToggle.textContent = "线框：开";
seamsToggle.classList.add("active");
seamsToggle.textContent = "拼接边：开";
facesToggle.classList.add("active");
facesToggle.textContent = "面渲染：开";
bboxToggle.classList.add("active");
bboxToggle.textContent = "包围盒：开";

// 三角形计数跟随渲染器
const syncTriCount = () => {
  triCounter.textContent = `渲染负载：${renderer3d.getTriCount()}`;
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
  log,
);
renderer2d.setEdgeQueryProviders({
  getEdges: unfold2d.getEdges2D,
  getBounds: unfold2d.getLastBounds,
  getFaceIdToEdges: () => geometryContext.geometryIndex.getFaceToEdges(),
  getPreviewGroupId: groupController.getPreviewGroupId,
});
const menuButtons = [menuOpenBtn, exportBtn, exportGroupStepBtn, exportGroupStlBtn, exportEarClipBtn, previewGroupModelBtn, settingsOpenBtn];
const updateMenuState = () => {
  const isPreview = getWorkspaceState() === "previewGroupModel";
  menuButtons.forEach((btn) => btn?.classList.toggle("hidden", isPreview));
  exitPreviewBtn.classList.toggle("hidden", !isPreview);
  groupPreviewPanel.classList.toggle("hidden", isPreview);
  settingsOpenBtn.classList.toggle("hidden", isPreview);
  editorPreviewEl.classList.toggle("single-col", isPreview);
  requestAnimationFrame(() => renderer3d.resizeRenderer3D());
};

const buildGroupUIState = () => {
  const groupCount = groupController.getGroupsCount();
  const previewGroupId = groupController.getPreviewGroupId();
  const faces = groupController.getGroupFaces(previewGroupId)?.size ?? 0;
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
    groupDeleteBtn,
    groupVisibilityBtn: groupVisibilityToggle ?? undefined,
  },
  {
    onPreviewSelect: (id) => {
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
  },
);

const updateGroupEditToggle = () => {
  const ws = getWorkspaceState();
  groupEditToggle.classList.toggle("active", ws === "editingGroup");
  groupEditToggle.textContent = ws !== "editingGroup" ? "编辑展开组" : "结束编辑";
};

appEventBus.on("groupAdded", ({ groupId, groupName }) => {
  groupUI.render(buildGroupUIState());
  historyManager.push(captureProjectState(), { name: "新建展开组", description: `新建展开组 ${groupName}`, timestamp: Date.now() });
  historyPanelUI?.render();
  setFileSaved(false);
});
appEventBus.on("groupRemoved", ({ groupId, groupName, faces }) => {
  groupUI.render(buildGroupUIState());
  const pushResult = historyManager.push(captureProjectState(), { name: "删除展开组", description: `删除展开组 ${groupName}`, timestamp: Date.now() });
  if (pushResult > 0) {
    const judgeMethod = (cache: PreviewMeshCacheItem) => {
      return cache.historyUidAbandoned === Infinity;
    };
    abandonCachedPreviewMesh(judgeMethod);
    historyAbandonJudgeMethods.set(pushResult, judgeMethod);
    historyPanelUI?.render();
  }
  setFileSaved(false);
});
appEventBus.on("groupCurrentChanged", (groupId: number) => {
  groupUI.render(buildGroupUIState());
});
appEventBus.on("groupColorChanged", ({ groupId, color }) => {
  groupUI.render(buildGroupUIState());
  setFileSaved(false);
});
appEventBus.on("groupNameChanged", ({ groupId, name }) => {
  groupUI.render(buildGroupUIState());
  const pushResult = historyManager.push(captureProjectState(), { name: "展开组重命名", description: `展开组重命名为 ${name}`, timestamp: Date.now() });
  if (pushResult > 0) {
    historyPanelUI?.render();
  }
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
appEventBus.on("brushOperationDone", ({ facePaintedCnt }) => {
  if (facePaintedCnt === 0) return;
  const currentGroupName = groupController.getGroupName(groupController.getPreviewGroupId()) ?? "???";
  let pushResult = -1;
  if (facePaintedCnt > 0) {
    pushResult = historyManager.push(captureProjectState(), { name: "面增减", description: `添加 ${facePaintedCnt} 个面到 ${currentGroupName}`, timestamp: Date.now() });
  } else if (facePaintedCnt < 0) {
    pushResult = historyManager.push(captureProjectState(), { name: "面增减", description: `从 ${currentGroupName} 移除 ${-facePaintedCnt} 个面`, timestamp: Date.now() });
  }
  // 一个组的拓扑变化可能会影响到其他组拼接边的耳朵角度，所以需要全部清理
  if (pushResult > 0) {
    const judgeMethod = (cache: PreviewMeshCacheItem) => {
      return cache.historyUidAbandoned === Infinity;
    }
    abandonCachedPreviewMesh(judgeMethod);
    historyAbandonJudgeMethods.set(pushResult, judgeMethod);
    historyPanelUI?.render();
  }
});
appEventBus.on("groupPlaceAngleChanged", () => { setFileSaved(false); });

appEventBus.on("groupPlaceAngleRotateDone", ({ deltaAngle }) => {
  historyManager.push(captureProjectState(), { name: "旋转展开组", description: `旋转展开组 ${deltaAngle.toFixed(1)} 度`, timestamp: Date.now(), payload: {
    groupId: groupController.getPreviewGroupId(),
    angle: deltaAngle,
    stack: (actionA: MetaAction, actionB: MetaAction) => {
      if (actionA.payload?.groupId !== actionB.payload?.groupId) return undefined;
      return {name: actionB.name, description: `旋转展开组 ${(actionA.payload.angle + actionB.payload.angle).toFixed(1)} 度`, timestamp: actionB.timestamp,
        payload: { groupId: actionB.payload.groupId, angle: actionA.payload.angle + actionB.payload.angle }};
    }
  }});
  historyPanelUI?.render();

});
appEventBus.on("workspaceStateChanged", ({ previous, current }) =>  {
  if (current !== "loading") groupUI.render(buildGroupUIState());
  updateGroupEditToggle();
  updateMenuState();
});
appEventBus.on("settingsChanged", (changedItemCnt) => {
  const pushResult = historyManager.push(captureProjectState(), { name: "修改设置", description: `修改了 ${changedItemCnt} 个设置项`, timestamp: Date.now() });
  if (pushResult > 0) {
    const judgeMethod = (cache: PreviewMeshCacheItem) => {
      return cache.historyUidAbandoned === Infinity;
    }
    abandonCachedPreviewMesh(judgeMethod);
    historyAbandonJudgeMethods.set(pushResult, judgeMethod);
    historyPanelUI?.render();
  }
  setFileSaved(false);
});

groupUI.render(buildGroupUIState());
updateGroupEditToggle();
updateMenuState();
historyPanelUI = createHistoryPanel(
  {
    panel: document.getElementById("history-panel"),
    list: document.getElementById("history-list"),
  },
  () => historyManager.getSnapshots(),
  () => historyManager.getUndoSteps(),
  (snapUid) => {
    historyManager.applySnapshot(snapUid);
  },
);
historyPanelUI.render();
if (viewer && groupPreview) {
  operationHints = createOperationHints({
    leftMount: viewer,
    rightMount: groupPreview,
    getWorkspaceState,
  });
}
onWorkerBusyChange((busy) => {
  appEventBus.emit("workerBusyChange", busy);
  if (menuBlocker) {
    menuBlocker.classList.toggle("active", busy);
  }
  if (groupEditToggle) {
    groupEditToggle.disabled = busy;
  }
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
groupEditToggle.addEventListener("click", () => {
  // const currentGroupId = groupController.getPreviewGroupId();
  if (getWorkspaceState() === "editingGroup") {
    changeWorkspaceState("normal");
  } else {
    if (isWorkerBusy()) {
      log("正在生成展开组模型，请稍后再编辑", "info");
      return;
    }
    changeWorkspaceState("editingGroup");
  }
});
exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  const model = getModel();
  if (!model) {
    log("没有可导出的模型", "error");
    return;
  }
  try {
    log("正在保存 .3dppc ...", "info");
    const data = await build3dppcData(model);
    const fileName = download3dppc(data);
    log(`3dppc 已保存：下载目录/${fileName}`, "success");
    setFileSaved(true);
  } catch (error) {
    console.error("保存失败", error);
    log("保存失败，请重试。", "error");
  }
  finally {
    exportBtn.disabled = false;
  }
});
exportGroupStepBtn.addEventListener("click", async () => {
  exportGroupStepBtn.disabled = true;
  try {
    const targetGroupId = groupController.getPreviewGroupId();
    if (unfold2d.hasGroupIntersection(targetGroupId)) {
      log("当前展开组存在自交，无法生成模型", "error");
      return;
    }
    const groupName = groupController.getGroupName(targetGroupId) ?? `group-${targetGroupId}`;
    const projectName = getCurrentProject().name || "未命名工程";
    const trisWithAngles = unfold2d.getGroupTrianglesData(targetGroupId);
    if (!trisWithAngles.length) {
      log("当前展开组没有三角面，无法导出。", "error");
      return;
    }
    log("正在导出展开组 STEP...", "info");
    const { blob, earClipNumTotal } = await buildStepInWorker(
      trisWithAngles,
      (progress) => log(progress, "progress"),
      (msg, tone) => log(msg, (tone as any) ?? "error"),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}-${groupName}-${earClipNumTotal}Clips.step`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log(`展开组 STEP 已导出：下载目录/${projectName}-${groupName}-${earClipNumTotal}Clips.step`, "success");
  } catch (error) {
    console.error("展开组 STEP 导出失败", error);
    log("展开组 STEP 导出失败，请查看控制台日志。", "error");
  } finally {
    exportGroupStepBtn.disabled = false;
  }
});
exportGroupStlBtn.addEventListener("click", async () => {
  exportGroupStlBtn.disabled = true;
  const downloadMesh = (groupName: string, mesh: Mesh, earClipNumTotal: number) => {
      const projectName = getCurrentProject().name || "未命名工程";
      const exporter = new STLExporter();
      const stlResult = exporter.parse(mesh, { binary: true });
      const stlArray =
        stlResult instanceof ArrayBuffer
          ? new Uint8Array(stlResult)
          : stlResult instanceof DataView
            ? new Uint8Array(stlResult.buffer)
            : new Uint8Array();
      const stlCopy = new Uint8Array(stlArray); // force into ArrayBuffer-backed copy
      const url = URL.createObjectURL(new Blob([stlCopy.buffer], { type: "model/stl" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}-${groupName}-${earClipNumTotal}Clips.stl`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log(`展开组 STL 已导出：下载目录/${projectName}-${groupName}-${earClipNumTotal}Clips.stl`, "success");
    };
  try {
    const targetGroupId = groupController.getPreviewGroupId();
    if (unfold2d.hasGroupIntersection(targetGroupId)) {
      log("当前展开组存在自交，无法生成模型", "error");
      return;
    }
    const groupName = groupController.getGroupName(targetGroupId) ?? `group-${targetGroupId}`;
    const cached = getCachedPreviewMesh(targetGroupId);
    if (!cached) {
      const trisWithAngles = unfold2d.getGroupTrianglesData(targetGroupId);
      if (!trisWithAngles.length) {
        log("当前展开组没有三角面，无法导出。", "error");
        return;
      }
      log("正在导出展开组 STL...", "info");
      const { blob, earClipNumTotal } = await buildStlInWorker(
        trisWithAngles,
        (progress) => log(progress, "progress"),
        (msg, tone) => log(msg, (tone as any) ?? "error"),
      );
      const buffer = await blob.arrayBuffer();
      const geometry = stlLoader.parse(buffer);
      snapGeometryPositions(geometry);
      const mesh = new Mesh(geometry);
      mesh.name = "Replicad Mesh";
      addCachedPreviewMesh(targetGroupId, mesh, earClipNumTotal);
      const cached = getCachedPreviewMesh(targetGroupId);
      if (cached) downloadMesh(groupName, cached.mesh, cached.earClipNumTotal);
    } else {
      log("使用缓存 mesh 导出展开组 STL...", "info");
      downloadMesh(groupName, cached.mesh, cached.earClipNumTotal);
    }
  } catch (error) {
    console.error("展开组 STL 导出失败", error);
    log("展开组 STL 导出失败，请查看控制台日志。", "error");
  } finally {
    exportGroupStlBtn.disabled = false;
  }
});

previewGroupModelBtn.addEventListener("click", async () => {
  previewGroupModelBtn.disabled = true;
  try {
    const targetGroupId = groupController.getPreviewGroupId();
    if (unfold2d.hasGroupIntersection(targetGroupId)) {
      log("当前展开组存在自交，无法生成模型", "error");
      return;
    }
    const cached = getCachedPreviewMesh(targetGroupId);
    if (cached) {
      renderer3d.loadPreviewModel(cached.mesh, cached.angle);
    } else {
      const trisWithAngles = unfold2d.getGroupTrianglesData(targetGroupId);
      if (!trisWithAngles.length) {
        log("当前展开组没有三角面，无法导出。", "error");
        return;
      }
      // log("正在用 Replicad 生成 mesh...", "info");
      const { mesh, earClipNumTotal } = await buildMeshInWorker(
        trisWithAngles,
        (progress) => log(progress, "progress"),
        (msg, tone) => log(msg, (tone as any) ?? "error"),
      );
      snapGeometryPositions(mesh.geometry);
      addCachedPreviewMesh(targetGroupId, mesh, earClipNumTotal);
      const cached = getCachedPreviewMesh(targetGroupId);
      if (cached) renderer3d.loadPreviewModel(cached.mesh, cached.angle);
    }
    changeWorkspaceState("previewGroupModel");
  } catch (error) {
    console.error("Replicad mesh 生成失败", error);
    log("Replicad mesh 生成失败，请检查控制台日志。", "error");
  } finally {
    previewGroupModelBtn.disabled = false;
  }
});

exportEarClipBtn?.addEventListener("click", async () => {
  if (!exportEarClipBtn) return;
  exportEarClipBtn.disabled = true;
  try {
    log("正在生成拼接边固定夹...", "info");
    const solid = await buildEarClip();
    const blob = solid.blobSTL({ binary: true });
    const buffer = await blob.arrayBuffer();
    const baseName = getCurrentProject().name || "未命名工程";
    const fileName = `${baseName}_earClip.stl`;
    const url = URL.createObjectURL(new Blob([buffer], { type: "model/stl" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log(`拼接边固定夹 STL 已导出：下载目录/${fileName}`, "success");
  } catch (error) {
    console.error("拼接边固定夹导出失败", error);
    log("拼接边固定夹导出失败，请查看控制台日志。", "error");
  } finally {
    exportEarClipBtn.disabled = false;
  }
});

exitPreviewBtn.addEventListener("click", () => {
  changeWorkspaceState("normal");
});
