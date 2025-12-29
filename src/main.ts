// 应用入口与编排层：负责初始化页面结构、事件总线订阅、组/拼缝控制器与渲染器的装配，并绑定 UI 交互。
import "./style.css";
import packageJson from "../package.json";
import { Color } from "three";
import { createStatus } from "./modules/status";
import { initRenderer3D, type GroupUIHooks, type UIRefs } from "./modules/renderer3d";
import { createGroupController } from "./modules/groupController";
import { appEventBus } from "./modules/eventBus";
import { initGroupUI } from "./modules/groupUI";
import { createSeamManager } from "./modules/seamManager";
import {
  getGroupFaces,
  getGroupColor,
  getPreviewGroupId,
  getEditGroupId,
  setPreviewGroupId,
} from "./modules/groups";

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
        <button class="btn ghost" disabled>设置</button>
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
          <div class="preview-area" id="viewer">
            <div class="placeholder" id="placeholder">选择模型以预览</div>
          </div>
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
            <div class="preview-2d-placeholder" id="group-preview-label">展开组1</div>
          </div>
        </div>
      </section>
      <footer class="editor-status">
        <div class="status-text" id="status">尚未加载模型</div>
      </footer>
    </section>
  </main>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const placeholder = document.querySelector<HTMLDivElement>("#placeholder");
const statusEl = document.querySelector<HTMLDivElement>("#status");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const homeStartBtn = document.querySelector<HTMLButtonElement>("#home-start");
const menuOpenBtn = document.querySelector<HTMLButtonElement>("#menu-open");
const resetViewBtn = document.querySelector<HTMLButtonElement>("#reset-view-btn");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const seamsToggle = document.querySelector<HTMLButtonElement>("#seams-toggle");
const facesToggle = document.querySelector<HTMLButtonElement>("#faces-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
const triCounter = document.querySelector<HTMLDivElement>("#tri-counter");
const groupTabsEl = document.querySelector<HTMLDivElement>("#group-tabs");
const groupAddBtn = document.querySelector<HTMLButtonElement>("#group-add");
const groupPreview = document.querySelector<HTMLDivElement>("#group-preview");
const groupPreviewLabel = document.querySelector<HTMLDivElement>("#group-preview-label");
const groupCountLabel = document.querySelector<HTMLSpanElement>("#group-count");
const groupColorBtn = document.querySelector<HTMLButtonElement>("#group-color-btn");
const groupColorInput = document.querySelector<HTMLInputElement>("#group-color-input");
const groupDeleteBtn = document.querySelector<HTMLButtonElement>("#group-delete");
const groupEditToggle = document.querySelector<HTMLButtonElement>("#group-edit-toggle");
const layoutEmpty = document.querySelector<HTMLElement>("#layout-empty");
const layoutWorkspace = document.querySelector<HTMLElement>("#layout-workspace");

if (
  !viewer ||
  !placeholder ||
  !statusEl ||
  !fileInput ||
  !homeStartBtn ||
  !menuOpenBtn ||
  !resetViewBtn ||
  !lightToggle ||
  !edgesToggle ||
  !seamsToggle ||
  !facesToggle ||
  !exportBtn ||
  !triCounter ||
  !groupTabsEl ||
  !groupAddBtn ||
  !groupPreview ||
  !groupPreviewLabel ||
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

const { setStatus } = createStatus(statusEl);

const uiRefs: UIRefs = {
  viewer,
  placeholder,
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

const renderer = initRenderer3D(uiRefs, setStatus, groupUiHooks);
const seamManager = createSeamManager(renderer.getSeamManagerDeps());
renderer.attachSeamManager(seamManager);
const groupController = createGroupController(renderer.getGroupDeps());
renderer.attachGroupApi(groupController);
appEventBus.on("modelLoaded", () => seamManager.rebuildFull());
appEventBus.on("seamsRebuildFull", () => seamManager.rebuildFull());
appEventBus.on("seamsRebuildGroups", (groups) => seamManager.rebuildGroups(groups));
appEventBus.on("seamsRebuildFaces", (faces) => seamManager.rebuildFaces(faces));

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
    groupPreviewLabel,
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
