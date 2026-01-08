// 应用入口与编排层：负责初始化页面结构、事件总线订阅、组/拼缝控制器与渲染器的装配，并绑定 UI 交互。
import "./style.css";
import packageJson from "../package.json";
import { Color, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { type WorkspaceState } from "./types/workspaceState.js";
import { createLog } from "./modules/log";
import { createRenderer3D } from "./modules/renderer3d";
import { createGroupController } from "./modules/groupController";
import { appEventBus } from "./modules/eventBus";
import { createGroupUI } from "./modules/groupUI";
import { createRenderer2D } from "./modules/renderer2d";
import { createUnfold2dManager } from "./modules/unfold2dManager";
import { createGeometryContext } from "./modules/geometry";
import { build3dppcData, download3dppc, load3dppc, type PPCFile } from "./modules/ppc";
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

const VERSION = packageJson.version ?? "0.0.0.0";
const previewMeshCache = new Map<number, Mesh>();
const defaultSettings = getDefaultSettings();
const limits = SETTINGS_LIMITS;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

app.innerHTML = `
  <main class="shell">
    <div class="version-badge version-badge-global">v${VERSION}</div>
    <input id="file-input" type="file" accept=".obj,.fbx,.stl,.3dppc,application/json" style="display:none" autocomplete="off" />

    <section id="layout-empty" class="page home active">
      <div class="home-card">
        <div class="home-title">3D Printed Paper Craft</div>
        <div class="home-subtitle">选择一个模型文件开始编辑</div>
        <button id="home-start" class="btn primary">打开模型</button>
        <div class="home-meta">支持 OBJ / FBX / STL / 3dppc</div>
      </div>
    </section>

    <section id="layout-workspace" class="page">
      <header class="editor-header">
        <div class="editor-title">3D Printed Paper Craft</div>
        <div class="version-badge">v${VERSION}</div>
      </header>
    <nav class="editor-menu">
        <button class="btn ghost hidden" id="exit-preview-btn">退出预览</button>
        <button class="btn ghost" id="menu-open">打开模型</button>
        <button class="btn ghost" id="export-btn">导出 .3dppc</button>
        <button class="btn ghost" id="export-group-step-btn">导出展开组 STEP</button>
        <button class="btn ghost" id="export-group-stl-btn">导出展开组 STL</button>
        <button class="btn ghost" id="preview-group-model-btn">预览展开组模型</button>
        <button class="btn ghost" id="settings-open-btn">设置</button>
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
            <div class="toolbar-spacer"></div>
            <span class="toolbar-stat" id="tri-counter">渲染三角形：0</span>
          </div>
          <div class="preview-area" id="viewer"></div>
        </div>
        <div class="preview-panel">
          <div class="preview-toolbar">
            <button class="btn sm toggle" id="group-edit-toggle">编辑展开组</button>
            <div class="group-tabs" id="group-tabs"></div>
            <button class="btn sm tab-add" id="group-add">+</button>
            <div class="toolbar-spacer"></div>
            <span class="toolbar-stat group-faces-count" id="group-faces-count">面数量 0</span>
          </div>
          <div class="preview-area" id="group-preview">
            <button class="overlay-btn color-swatch" id="group-color-btn" title="选择组颜色"></button>
            <button class="overlay-btn tab-delete" id="group-delete" title="删除展开组">删除组</button>
            <input type="color" id="group-color-input" class="color-input" autocomplete="off" />
          </div>
        </div>
      </section>
  </section>
</main>
  <div id="log-panel" class="log-panel hidden">
    <div id="log-list" class="log-list"></div>
  </div>

  <div id="settings-overlay" class="settings-overlay hidden">
    <div class="settings-modal">
      <div class="settings-header">
        <div class="settings-title">设置</div>
      </div>
      <div class="settings-body">
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
      </div>
      <div class="settings-footer">
        <button id="settings-cancel-btn" class="btn ghost settings-action">取消</button>
        <button id="settings-confirm-btn" class="btn primary settings-action">确定</button>
      </div>
    </div>
  </div>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const logListEl = document.querySelector<HTMLDivElement>("#log-list");
const logPanelEl = document.querySelector<HTMLDivElement>("#log-panel");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const homeStartBtn = document.querySelector<HTMLButtonElement>("#home-start");
const exitPreviewBtn = document.querySelector<HTMLButtonElement>("#exit-preview-btn");
const menuOpenBtn = document.querySelector<HTMLButtonElement>("#menu-open");
const editorPreviewEl = document.querySelector<HTMLElement>(".editor-preview");
const resetViewBtn = document.querySelector<HTMLButtonElement>("#reset-view-btn");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const seamsToggle = document.querySelector<HTMLButtonElement>("#seams-toggle");
const facesToggle = document.querySelector<HTMLButtonElement>("#faces-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
const exportGroupStepBtn = document.querySelector<HTMLButtonElement>("#export-group-step-btn");
const exportGroupStlBtn = document.querySelector<HTMLButtonElement>("#export-group-stl-btn");
const previewGroupModelBtn = document.querySelector<HTMLButtonElement>("#preview-group-model-btn");
const settingsOpenBtn = document.querySelector<HTMLButtonElement>("#settings-open-btn");
const triCounter = document.querySelector<HTMLDivElement>("#tri-counter");
const groupTabsEl = document.querySelector<HTMLDivElement>("#group-tabs");
const groupAddBtn = document.querySelector<HTMLButtonElement>("#group-add");
const groupPreview = document.querySelector<HTMLDivElement>("#group-preview");
const settingsOverlay = document.querySelector<HTMLDivElement>("#settings-overlay");
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
  !groupFacesCountLabel ||
  !groupColorBtn ||
  !groupColorInput ||
  !groupDeleteBtn ||
  !groupEditToggle ||
  !layoutEmpty ||
  !layoutWorkspace ||
  !settingsOverlay ||
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
  !settingsOpenBtn
) {
  throw new Error("初始化界面失败，缺少必要的元素");
}
// 预加载 workspace 布局，方便渲染器在首帧前完成尺寸初始化
layoutWorkspace.classList.add("preloaded");

let workspaceState: WorkspaceState = "normal" as WorkspaceState;
const setWorkspaceState = (state: WorkspaceState) => {
  if (workspaceState === state) return;
  const previousState = workspaceState;
  workspaceState = state;
  if (previousState === "editingGroup") log("已退出展开组编辑模式", "info");      
  if (state === "editingGroup") log("已进入展开组编辑模式", "info");
  if (previousState === "previewGroupModel") log("已退出组模型预览", "info");
  if (state === "previewGroupModel") log("展开组预览模型已加载", "info");

  appEventBus.emit("workspaceStateChanged", {previous: previousState, current: workspaceState});
}
// 确保文件选择框只允许支持的模型/3dppc 后缀
fileInput.setAttribute("accept", ".obj,.fbx,.stl,.3dppc");
document.querySelectorAll("input").forEach((inp) => inp.setAttribute("autocomplete", "off"));

const { log } = createLog(logListEl);
createSettingsUI(
  {
    overlay: settingsOverlay,
    openBtn: settingsOpenBtn,
    cancelBtn: settingsCancelBtn,
    confirmBtn: settingsConfirmBtn,
    scaleInput: settingScaleInput,
    scaleResetBtn: settingScaleResetBtn,
    earWidthInput: settingEarWidthInput,
    earWidthResetBtn: settingEarWidthResetBtn,
    earThicknessInput: settingEarThicknessInput,
    earThicknessResetBtn: settingEarThicknessResetBtn,
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
const renderer3d = createRenderer3D(
  log,
  () => workspaceState,
  {
    handleRemoveFace: (faceId: number) => {
      groupController.removeFace(faceId, groupController.getPreviewGroupId());
    },
    handleAddFace: (faceId: number) => {
      groupController.addFace(faceId, groupController.getPreviewGroupId());
    },
    getGroupColor: groupController.getGroupColor,
    getGroupFaces: groupController.getGroupFaces,
    getFaceGroupMap: groupController.getFaceGroupMap,
    applyImportedGroups: groupController.applyImportedGroups,
  },
  geometryContext,
  () => {
    const rect = viewer.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  },
  (canvas) => viewer.appendChild(canvas),
);
const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];
function getExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}
const handleFileSelected = async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const ext = getExtension(file.name);
  if (!allowedExtensions.includes(ext)) {
    log("不支持的格式，请选择 OBJ / FBX / STL。", "error");
    return;
  }
  await renderer3d.applyLoadedModel(file, ext);
  fileInput.value = "";
};

fileInput.addEventListener("change", handleFileSelected);
homeStartBtn.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});
menuOpenBtn.addEventListener("click", () => {
  fileInput.value = "";
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

// 三角形计数跟随渲染器
const syncTriCount = () => {
  triCounter.textContent = `渲染三角形：${renderer3d.getTriCount()}`;
  requestAnimationFrame(syncTriCount);
};
requestAnimationFrame(syncTriCount);

const renderer2d = createRenderer2D(() => {
    const rect = groupPreview.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  },
  (canvas) => groupPreview.appendChild(canvas),);
const unfold2d = createUnfold2dManager({
  angleIndex: geometryContext.angleIndex,
  renderer2d,
  getGroupIds: groupController.getGroupIds,
  getGroupFaces: groupController.getGroupFaces,
  getPreviewGroupId: groupController.getPreviewGroupId,
  refreshVertexWorldPositions: () => geometryContext.geometryIndex.refreshVertexWorldPositions(getModel()),
  getFaceGroupMap: groupController.getFaceGroupMap,
  getGroupColor: groupController.getGroupColor,
  getGroupTreeParent: groupController.getGroupTreeParent,
  getFaceToEdges: () => geometryContext.geometryIndex.getFaceToEdges(),
  getEdgesArray: () => geometryContext.geometryIndex.getEdgesArray(),
  getVertexKeyToPos: () => geometryContext.geometryIndex.getVertexKeyToPos(),
  getFaceIndexMap: () => geometryContext.geometryIndex.getFaceIndexMap(),
});
const menuButtons = [menuOpenBtn, exportBtn, exportGroupStepBtn, previewGroupModelBtn, settingsOpenBtn];
const updateMenuState = () => {
  const isPreview = workspaceState === "previewGroupModel" as WorkspaceState;
  menuButtons.forEach((btn) => btn.classList.toggle("hidden", isPreview));
  exitPreviewBtn.classList.toggle("hidden", !isPreview);
  groupPreviewPanel.classList.toggle("hidden", isPreview);
  settingsOpenBtn.classList.toggle("hidden", isPreview);
  editorPreviewEl.classList.toggle("single-col", isPreview);
  requestAnimationFrame(() => renderer3d.resizeRenderer3D());
};

const buildGroupUIState = () => {
  const groupCount = groupController.getGroupsCount();
  const previewGroupId = groupController.getPreviewGroupId();
  return {
    groupCount: groupCount,
    groupIds: groupController.getGroupIds(),
    previewGroupId,
    editGroupState: workspaceState === "editingGroup",
    getGroupColor: groupController.getGroupColor,
    getGroupFacesCount: (id: number) => groupController.getGroupFaces(id)?.size ?? 0,
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
  },
  {
    onPreviewSelect: (id) => {
      groupController.setPreviewGroupId(id);
      log(`预览展开组 ${groupController.getGroupIds().indexOf(id) + 1}`, "info");
    },
    onColorChange: (color: Color) => groupController.setGroupColor(groupController.getPreviewGroupId(), color),
    onDelete: () => {
      const previewGroupId = groupController.getPreviewGroupId();
      const ok = confirm(`确定删除展开组 ${previewGroupId} 吗？该组的面将被移出。`);
      if (!ok) return;
      groupController.deleteGroup(previewGroupId);
    },
  },
);

const updateGroupEditToggle = () => {
  groupEditToggle.classList.toggle("active", workspaceState === "editingGroup");
  groupEditToggle.textContent = workspaceState !== "editingGroup" ? "编辑展开组" : "结束编辑";
};

appEventBus.on("modelLoaded", () => {
  if (versionBadgeGlobal) versionBadgeGlobal.style.display = "none";
  logPanelEl?.classList.remove("hidden");
  layoutEmpty.classList.toggle("active", false);
  layoutWorkspace.classList.toggle("active", true);
  layoutWorkspace.classList.remove("preloaded");
  updateMenuState();
  groupUI.render(buildGroupUIState());
});
appEventBus.on("modelCleared", () => {
  if (versionBadgeGlobal) versionBadgeGlobal.style.display = "block";
  logPanelEl?.classList.add("hidden");
  layoutEmpty.classList.toggle("active", true);
  layoutWorkspace.classList.toggle("active", false);
  setWorkspaceState("normal" as WorkspaceState);
  previewMeshCache.clear();
  layoutWorkspace.classList.add("preloaded");
});
appEventBus.on("groupAdded", (groupId: number) => groupUI.render(buildGroupUIState()));
appEventBus.on("groupRemoved", ({ groupId, faces }) => {
  previewMeshCache.delete(groupId);
  groupUI.render(buildGroupUIState());
});
appEventBus.on("groupCurrentChanged", (groupId: number) => groupUI.render(buildGroupUIState()));
appEventBus.on("groupColorChanged", ({ groupId, color }) => groupUI.render(buildGroupUIState()));
appEventBus.on("groupFaceAdded", ({ groupId }) => previewMeshCache.delete(groupId));
appEventBus.on("groupFaceRemoved", ({ groupId }) => previewMeshCache.delete(groupId));
appEventBus.on("workspaceStateChanged", ({previous, current}) => groupUI.render(buildGroupUIState()));
appEventBus.on("workspaceStateChanged", ({previous, current}) => updateGroupEditToggle());
appEventBus.on("workspaceStateChanged", ({previous, current}) => updateMenuState());
appEventBus.on("settingsChanged", (changed) => {previewMeshCache.clear();});

groupUI.render(buildGroupUIState());
updateGroupEditToggle();
updateMenuState();

onWorkerBusyChange((busy) => {
  appEventBus.emit("workerBusyChange", busy);
  if (busy && workspaceState === "editingGroup") {
    setWorkspaceState("normal" as WorkspaceState);
  }
});

groupAddBtn.addEventListener("click", () => {
  groupController.addGroup();
  if (workspaceState !== "editingGroup") {
    setWorkspaceState("editingGroup" as WorkspaceState);
  }
});
groupEditToggle.addEventListener("click", () => {
  const currentGroupId = groupController.getPreviewGroupId();
  if (workspaceState === "editingGroup") {
    setWorkspaceState("normal" as WorkspaceState);
  } else {
    if (isWorkerBusy()) {
      log("正在生成展开组模型，请稍后再编辑", "info");
      return;
    }
    setWorkspaceState("editingGroup" as WorkspaceState);
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
    log("正在导出 .3dppc ...", "info");
    const data = await build3dppcData(model);
    await download3dppc(data);
    log("导出成功", "success");
  } catch (error) {
    console.error("导出失败", error);
    log("导出失败，请重试。", "error");
  }
  finally {
    exportBtn.disabled = false;
  }
});
exportGroupStepBtn.addEventListener("click", async () => {
  exportGroupStepBtn.disabled = true;
  try {
    const targetGroupId = groupController.getPreviewGroupId();
    const trisWithAngles = unfold2d.getGroupTrianglesData(targetGroupId);
    if (!trisWithAngles.length) {
      log("当前展开组没有三角面，无法导出。", "error");
      return;
    }
    log("正在导出展开组 STEP...", "info");
    const blob = await buildStepInWorker(trisWithAngles, (progress) => log(progress, "progress"));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `group-${targetGroupId}.step`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log("展开组 STEP 已导出", "success");
  } catch (error) {
    console.error("展开组 STEP 导出失败", error);
    log("展开组 STEP 导出失败，请查看控制台日志。", "error");
  } finally {
    exportGroupStepBtn.disabled = false;
  }
});
exportGroupStlBtn.addEventListener("click", async () => {
  exportGroupStlBtn.disabled = true;
  try {
    const targetGroupId = groupController.getPreviewGroupId();
    const cached = previewMeshCache.get(targetGroupId);
    if (cached) {
      log("使用缓存 mesh 导出展开组 STL...", "info");
      const exporter = new STLExporter();
      const meshForExport = cached.clone();
      meshForExport.updateMatrixWorld(true);
      const stlResult = exporter.parse(meshForExport, { binary: true });
      const stlArray =
        stlResult instanceof ArrayBuffer
          ? new Uint8Array(stlResult)
          : stlResult instanceof DataView
            ? new Uint8Array(stlResult.buffer)
            : new Uint8Array();
      const stlCopy = new Uint8Array(stlArray); // force into ArrayBuffer-backed copy
      const blob = new Blob([stlCopy.buffer], { type: "model/stl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `group-${targetGroupId}.stl`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log("展开组 STL 已导出", "success");
    } else {
      const trisWithAngles = unfold2d.getGroupTrianglesData(targetGroupId);
      if (!trisWithAngles.length) {
        log("当前展开组没有三角面，无法导出。", "error");
        return;
      }
      log("正在导出展开组 STL...", "info");
      const blob = await buildStlInWorker(trisWithAngles, (progress) => log(progress, "progress"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `group-${targetGroupId}.stl`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log("展开组 STL 已导出", "success");
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
    const cached = previewMeshCache.get(targetGroupId);
    if (cached) {
      renderer3d.loadPreviewModel(cached.clone());
    } else {
      const trisWithAngles = unfold2d.getGroupTrianglesData(targetGroupId);
      if (!trisWithAngles.length) {
        log("当前展开组没有三角面，无法导出。", "error");
        return;
      }
      log("正在用 Replicad 生成 mesh...", "info");
      const mesh = await buildMeshInWorker(trisWithAngles, (progress) => log(progress, "progress"));
      previewMeshCache.set(targetGroupId, mesh.clone());
      renderer3d.loadPreviewModel(mesh);
    }
    setWorkspaceState("previewGroupModel" as WorkspaceState);
  } catch (error) {
    console.error("Replicad mesh 生成失败", error);
    log("Replicad mesh 生成失败，请检查控制台日志。", "error");
  } finally {
    previewGroupModelBtn.disabled = false;
  }
});
exitPreviewBtn.addEventListener("click", () => {
  setWorkspaceState("normal" as WorkspaceState);
});
