// 应用入口与编排层：负责初始化页面结构、事件总线订阅、组/拼缝控制器与渲染器的装配，并绑定 UI 交互。
import "./style.css";
import packageJson from "../package.json";
import { Color } from "three";
import { createLog } from "./modules/log";
import { initRenderer3D, type GroupUIHooks, type UIRefs } from "./modules/renderer3d";
import { createGroupController } from "./modules/groupController";
import { appEventBus } from "./modules/eventBus";
import { initGroupUI } from "./modules/groupUI";
import { createSeamManager } from "./modules/seamManager";
import { initRenderer2D } from "./modules/renderer2d";
import { createUnfold2dManager } from "./modules/unfold2dManager";
import { createGeometryContext } from "./modules/geometryContext";
import {
  getGroupFaces,
  getGroupColor,
  getPreviewGroupId,
  getEditGroupId,
  setPreviewGroupId,
  getFaceGroupMap,
  getGroupTreeParent,
} from "./modules/groups";
import { getModel } from "./modules/model";
import {
  buildStepInWorker,
  buildStlInWorker,
  buildMeshInWorker,
  onWorkerBusyChange,
  isWorkerBusy,
} from "./modules/replicadWorkerClient";

const VERSION = packageJson.version ?? "0.0.0.0";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

app.innerHTML = `
  <main class="shell">
    <div class="version-badge version-badge-global">v${VERSION}</div>
    <input id="file-input" type="file" accept=".obj,.fbx,.stl,.3dppc,application/json" style="display:none" />

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
        <button class="btn ghost" id="menu-open">打开模型</button>
        <button class="btn ghost" id="export-btn" disabled>导出 .3dppc</button>
        <button class="btn ghost" id="export-group-step-btn" disabled>导出展开组 STEP</button>
        <button class="btn ghost" id="export-group-stl-btn" disabled>导出展开组 STL</button>
        <button class="btn ghost" id="setting-btn">设置</button>
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
            <span class="toolbar-stat group-count" id="group-count">面数量 0</span>
          </div>
          <div class="preview-area" id="group-preview">
            <button class="overlay-btn color-swatch" id="group-color-btn" title="选择组颜色"></button>
            <button class="overlay-btn tab-delete" id="group-delete" title="删除展开组">删除组</button>
            <input type="color" id="group-color-input" class="color-input" />
          </div>
        </div>
      </section>
  </section>
</main>
  <div id="log-panel" class="log-panel hidden">
    <div id="log-list" class="log-list"></div>
  </div>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const logListEl = document.querySelector<HTMLDivElement>("#log-list");
const logPanelEl = document.querySelector<HTMLDivElement>("#log-panel");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const homeStartBtn = document.querySelector<HTMLButtonElement>("#home-start");
const menuOpenBtn = document.querySelector<HTMLButtonElement>("#menu-open");
const resetViewBtn = document.querySelector<HTMLButtonElement>("#reset-view-btn");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const seamsToggle = document.querySelector<HTMLButtonElement>("#seams-toggle");
const facesToggle = document.querySelector<HTMLButtonElement>("#faces-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
const exportGroupStepBtn = document.querySelector<HTMLButtonElement>("#export-group-step-btn");
const exportGroupStlBtn = document.querySelector<HTMLButtonElement>("#export-group-stl-btn");
const settingBtn = document.querySelector<HTMLButtonElement>("#setting-btn");
const triCounter = document.querySelector<HTMLDivElement>("#tri-counter");
const groupTabsEl = document.querySelector<HTMLDivElement>("#group-tabs");
const groupAddBtn = document.querySelector<HTMLButtonElement>("#group-add");
const groupPreview = document.querySelector<HTMLDivElement>("#group-preview");
const groupCountLabel = document.querySelector<HTMLSpanElement>("#group-count");
const groupColorBtn = document.querySelector<HTMLButtonElement>("#group-color-btn");
const groupColorInput = document.querySelector<HTMLInputElement>("#group-color-input");
const groupDeleteBtn = document.querySelector<HTMLButtonElement>("#group-delete");
const groupEditToggle = document.querySelector<HTMLButtonElement>("#group-edit-toggle");
const layoutEmpty = document.querySelector<HTMLElement>("#layout-empty");
const layoutWorkspace = document.querySelector<HTMLElement>("#layout-workspace");

if (
  !viewer ||
  !logListEl ||
  !fileInput ||
  !homeStartBtn ||
  !menuOpenBtn ||
  !resetViewBtn ||
  !lightToggle ||
  !edgesToggle ||
  !seamsToggle ||
  !facesToggle ||
  !exportBtn ||
  !exportGroupStepBtn ||
  !exportGroupStlBtn ||
  !settingBtn ||
  !triCounter ||
  !groupTabsEl ||
  !groupAddBtn ||
  !groupPreview ||
  !groupCountLabel ||
  !groupColorBtn ||
  !groupColorInput ||
  !groupDeleteBtn ||
  !groupEditToggle ||
  !layoutEmpty ||
  !layoutWorkspace
) {
  throw new Error("初始化界面失败，缺少必要的元素");
}

// 确保文件选择框只允许支持的模型/3dppc 后缀
fileInput.setAttribute("accept", ".obj,.fbx,.stl,.3dppc");

const { setStatus } = createLog(logListEl);

const uiRefs: UIRefs = {
  viewer,
  fileInput,
  homeStartBtn,
  menuOpenBtn,
  resetViewBtn,
  lightToggle,
  edgesToggle,
  seamsToggle,
  facesToggle,
  exportBtn,
  triCounter,
  layoutEmpty,
  layoutWorkspace,
};

const groupUiHooks: GroupUIHooks = {};

const geometryContext = createGeometryContext();
const renderer = initRenderer3D(uiRefs, setStatus, geometryContext, groupUiHooks);
const seamManager = createSeamManager(renderer.getSeamManagerDeps());
renderer.attachSeamManager(seamManager);
const groupController = createGroupController(renderer.getGroupDeps());
renderer.attachGroupApi(groupController);
const renderer2d = initRenderer2D(groupPreview);
const unfold2d = createUnfold2dManager({
  angleIndex: geometryContext.angleIndex,
  renderer2d,
  getGroupFaces,
  getPreviewGroupId,
  refreshVertexWorldPositions: () => geometryContext.geometryIndex.refreshVertexWorldPositions(getModel()),
  getFaceGroupMap,
  getGroupColor,
  getGroupTreeParent,
  getFaceToEdges: () => geometryContext.geometryIndex.getFaceToEdges(),
  getEdgesArray: () => geometryContext.geometryIndex.getEdgesArray(),
  getVertexKeyToPos: () => geometryContext.geometryIndex.getVertexKeyToPos(),
  getFaceIndexMap: () => geometryContext.geometryIndex.getFaceIndexMap(),
});
appEventBus.on("modelLoaded", () => renderer2d.resize());
appEventBus.on("modelLoaded", () => seamManager.rebuildFull());
appEventBus.on("seamsRebuildFull", () => seamManager.rebuildFull());
appEventBus.on("seamsRebuildGroups", (groups) => seamManager.rebuildGroups(groups));
appEventBus.on("seamsRebuildFaces", (faces) => seamManager.rebuildFaces(faces));
appEventBus.on("modelLoaded", () => {
  exportGroupStepBtn.disabled = false;
  exportGroupStlBtn.disabled = false;
  logPanelEl?.classList.remove("hidden");
});
appEventBus.on("modelCleared", () => {
  logPanelEl?.classList.add("hidden");
});

const buildGroupUIState = () => {
  const groupFaces = getGroupFaces();
  const ids = Array.from(groupFaces.keys()).sort((a, b) => a - b);
  const previewGroupId = getPreviewGroupId();
  const editGroupId = getEditGroupId();
  return {
    groupIds: ids,
    previewGroupId,
    editGroupId,
    getGroupColor,
    getGroupCount: (id: number) => groupFaces.get(id)?.size ?? 0,
    deletable: groupFaces.size > 1,
  };
};

const groupUI = initGroupUI(
  {
    groupTabsEl,
    groupPreview,
    groupCountLabel,
    groupColorBtn,
    groupColorInput,
    groupDeleteBtn,
  },
  {
    onPreviewSelect: (id) => {
      if (getEditGroupId() !== null) return;
      setPreviewGroupId(id);
    },
    onEditSelect: (id) => {
      groupController.setEditGroup(id, getEditGroupId(), getPreviewGroupId());
    },
    onColorChange: (color: Color) => groupController.applyGroupColor(getPreviewGroupId(), color),
    onDelete: () => {
      const state = buildGroupUIState();
      const ok = confirm(`确定删除展开组 ${state.previewGroupId} 吗？该组的面将被移出。`);
      if (!ok) return;
      groupController.deleteGroup(state.previewGroupId, getEditGroupId());
    },
  },
);

groupUiHooks.renderGroupUI = (state) => groupUI.render(state);
appEventBus.on("groupDataChanged", () => groupUI.render(buildGroupUIState()));

groupAddBtn.addEventListener("click", () => {
  const result = groupController.createGroup(getEditGroupId());
  setPreviewGroupId(result.previewGroupId);
});

const updateGroupEditToggle = () => {
  const editId = getEditGroupId();
  groupEditToggle.classList.toggle("active", editId !== null);
  groupEditToggle.textContent = editId === null ? "编辑展开组" : "结束编辑";
};

groupEditToggle.addEventListener("click", () => {
  if (isWorkerBusy()) {
    setStatus("正在生成展开组模型，请稍后再编辑", "info");
    return;
  }
  const currentEdit = getEditGroupId();
  if (currentEdit === null) {
    groupController.setEditGroup(getPreviewGroupId(), null, getPreviewGroupId());
  } else {
    groupController.setEditGroup(null, currentEdit, getPreviewGroupId());
  }
  updateGroupEditToggle();
});

appEventBus.on("groupDataChanged", () => updateGroupEditToggle());

groupUI.render(buildGroupUIState());
updateGroupEditToggle();

onWorkerBusyChange((busy) => {
  if (busy && getEditGroupId() !== null) {
    groupController.setEditGroup(null, getEditGroupId(), getPreviewGroupId());
    updateGroupEditToggle();
  }
});

exportGroupStepBtn.addEventListener("click", async () => {
  exportGroupStepBtn.disabled = true;
  try {
    const targetGroupId = getEditGroupId() ?? getPreviewGroupId();
    const tris = unfold2d.getGroupTriangles2D(targetGroupId);
    if (!tris.length) {
      setStatus("当前展开组没有三角面，无法导出。", "error");
      return;
    }
    setStatus("正在导出展开组 STEP...", "info");
    const blob = await buildStepInWorker(tris);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `group-${targetGroupId}.step`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("展开组 STEP 已导出", "success");
  } catch (error) {
    console.error("展开组 STEP 导出失败", error);
    setStatus("展开组 STEP 导出失败，请查看控制台日志。", "error");
  } finally {
    exportGroupStepBtn.disabled = false;
  }
});

exportGroupStlBtn.addEventListener("click", async () => {
  exportGroupStlBtn.disabled = true;
  try {
    const targetGroupId = getEditGroupId() ?? getPreviewGroupId();
    const tris = unfold2d.getGroupTriangles2D(targetGroupId);
    if (!tris.length) {
      setStatus("当前展开组没有三角面，无法导出。", "error");
      return;
    }
    setStatus("正在导出展开组 STL...", "info");
    const blob = await buildStlInWorker(tris);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `group-${targetGroupId}.stl`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("展开组 STL 已导出", "success");
  } catch (error) {
    console.error("展开组 STL 导出失败", error);
    setStatus("展开组 STL 导出失败，请查看控制台日志。", "error");
  } finally {
    exportGroupStlBtn.disabled = false;
  }
});

settingBtn.addEventListener("click", async () => {
    settingBtn.disabled = true;
    try {
      const targetGroupId = getEditGroupId() ?? getPreviewGroupId();
      const trisWithAngles = unfold2d.getGroupTrianglesWithEdgeInfo(targetGroupId);
      if (!trisWithAngles.length) {
        setStatus("当前展开组没有三角面，无法导出。", "error");
        return;
      }
      setStatus("正在用 Replicad 生成 mesh...", "info");
      const mesh = await buildMeshInWorker(trisWithAngles);
      await renderer.loadGeneratedModel(mesh, "Replicad 示例");
    } catch (error) {
      console.error("Replicad 示例生成失败", error);
      setStatus("Replicad 示例生成失败，请检查控制台日志。", "error");
    } finally {
      settingBtn.disabled = false;
    }
})
