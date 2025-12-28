import "./style.css";
import packageJson from "../package.json";
import { createStatus } from "./modules/status";
import { initRenderer3D, type UIRefs } from "./modules/renderer3d";

const VERSION = packageJson.version ?? "0.0.0.0";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

app.innerHTML = `
  <main class="shell">
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
const layoutEmpty = document.querySelector<HTMLElement>("#layout-empty");
const layoutWorkspace = document.querySelector<HTMLElement>("#layout-workspace");

if (
  !viewer ||
  !placeholder ||
  !statusEl ||
  !fileInput ||
  !homeStartBtn ||
  !menuOpenBtn ||
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
  lightToggle,
  edgesToggle,
  seamsToggle,
  facesToggle,
  exportBtn,
  triCounter,
  groupTabsEl,
  groupAddBtn,
  groupPreview,
  groupPreviewLabel,
  groupCountLabel,
  groupColorBtn,
  groupColorInput,
  groupDeleteBtn,
  layoutEmpty,
  layoutWorkspace,
};

initRenderer3D(uiRefs, setStatus);
