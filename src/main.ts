import "./style.css";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  Vector3,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  BackSide,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
  NoToneMapping,
  SRGBColorSpace,
  Raycaster,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

const VERSION = "1.0.2.1";
const FORMAT_VERSION = "1.0";

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

let lastStatus = { message: "", tone: "info" as "info" | "error" | "success", count: 0 };

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

const scene = new Scene();
scene.background = new Color("#a8b4c0");

const camera = new PerspectiveCamera(
  50,
  viewer.clientWidth / viewer.clientHeight,
  0.1,
  5000,
);
camera.up.set(0, 0, 1); // 将世界上方向设为 Z 轴，使水平拖动绕 Z 轴旋转
camera.position.set(4, 3, 6);

const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
renderer.setClearColor("#a8b4c0", 1);
renderer.toneMapping = NoToneMapping;
// @ts-expect-error three typings may differ by version
renderer.outputColorSpace = SRGBColorSpace;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);

const ambient = new AmbientLight(0xffffff, 0.6);
const dir = new DirectionalLight(0xffffff, 0.8);
dir.position.set(4, -6, 8);
scene.add(ambient, dir);

const modelGroup = new Group();
scene.add(modelGroup);

const objLoader = new OBJLoader();
const fbxLoader = new FBXLoader();
const stlLoader = new STLLoader();

const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];
const FACE_DEFAULT_COLOR = new Color(0xffffff);
const GROUP_COLOR_PALETTE = [0x759fff, 0xff5757, 0xffff00, 0x00ee00, 0x00ffff, 0xff70ff];
const BREATH_PERIOD = 300; // ms
const BREATH_CYCLES = 3; // 呼吸循环次数
const BREATH_DURATION = BREATH_PERIOD * BREATH_CYCLES;
const BREATH_SCALE = 0.4; // 呼吸幅度
let edgesVisible = true;
let seamsVisible = true;
let facesVisible = true;
let currentModel: Object3D | null = null;
let seamLines = new Map<number, LineSegments2>();
let lastFileName = "model";
let lastTriangleCount = 0;
let faceColorMap = new Map<number, string>();
let faceAdjacency = new Map<number, Set<number>>();
let faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
let meshFaceIdMap = new Map<string, Map<number, number>>();
let faceGroupMap = new Map<number, number | null>();
let groupFaces = new Map<number, Set<number>>();
let faceToEdges = new Map<number, [number, number, number]>();
let edges: { id: number; key: string; faces: Set<number>; vertices: [string, string] }[] = [];
let edgeKeyToId = new Map<string, number>();
let groupTreeParent = new Map<number, Map<number, number | null>>();
let vertexKeyToPos = new Map<string, Vector3>();
let editGroupId: number | null = null;
let previewGroupId = 1;
let groupColors = new Map<number, Color>();
let groupColorCursor = 0;
const raycaster = new Raycaster();
const pointer = new Vector2();
let brushMode = false;
let brushButton: number | null = null;
let lastBrushedFace: number | null = null;
let controlsEnabledBeforeBrush = true;
const hoverLines: LineSegments2[] = [];
let hoveredFaceId: number | null = null;
let breathGroupId: number | null = null;
let breathStart = 0;
let breathEnd = 0;
let breathRaf: number | null = null;

edgesToggle.classList.toggle("active", edgesVisible);
edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
seamsToggle.classList.toggle("active", seamsVisible);
seamsToggle.textContent = `拼接边：${seamsVisible ? "开" : "关"}`;
facesToggle.classList.toggle("active", facesVisible);
facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
showWorkspace(false);
renderGroupTabs();
updateGroupPreview();

function setStatus(message: string, tone: "info" | "error" | "success" = "info") {
  if (message === lastStatus.message && tone === lastStatus.tone) {
    lastStatus.count += 1;
  } else {
    lastStatus = { message, tone, count: 0 };
  }
  const suffix = lastStatus.count > 0 ? ` +${lastStatus.count}` : "";
  statusEl.textContent = `${message}${suffix}`;
  statusEl.className = `status status-text ${tone === "info" ? "" : tone}`;
}

function showWorkspace(loaded: boolean) {
  layoutEmpty.classList.toggle("active", !loaded);
  layoutWorkspace.classList.toggle("active", loaded);
}

homeStartBtn.addEventListener("click", () => {
  fileInput.click();
});

menuOpenBtn.addEventListener("click", () => {
  fileInput.click();
});

function clearModel() {
  stopGroupBreath();
  endBrush();
  modelGroup.clear();
  disposeSeams();
  disposeHoverLines();
  currentModel = null;
  exportBtn.disabled = true;
  lastTriangleCount = 0;
  setStatus("尚未加载模型");
  showWorkspace(false);
  faceColorMap.clear();
  faceAdjacency.clear();
  faceIndexMap.clear();
  meshFaceIdMap.clear();
  faceGroupMap.clear();
  groupFaces = new Map<number, Set<number>>();
  faceToEdges = new Map<number, [number, number, number]>();
  edges = [];
  edgeKeyToId = new Map<string, number>();
  groupTreeParent = new Map<number, Map<number, number | null>>();
  vertexKeyToPos = new Map<string, Vector3>();
  groupColors = new Map<number, Color>();
  groupColorCursor = 0;
  groupFaces.set(1, new Set<number>());
  getGroupColor(1);
  previewGroupId = 1;
  updateGroupPreview();
  renderGroupTabs();
  seamLines.clear();
  hideHoverLines();
  editGroupId = null;
}

type PPCGeometry = {
  vertices: number[][];
  triangles: number[][];
};

type PPCFile = {
  version: string;
  meta: {
    generator: string;
    createdAt: string;
    source: string;
    units: string;
    checksum: {
      algorithm: string;
      value: string;
      scope: string;
    };
  };
  vertices: number[][];
  triangles: number[][];
  groups?: {
    id: number;
    color: string;
    faces: number[];
  }[];
  groupColorCursor?: number;
  annotations?: Record<string, unknown>;
};

function collectGeometry(object: Object3D): PPCGeometry {
  const vertices: number[][] = [];
  const triangles: number[][] = [];

  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const indexAttr = geometry.index;
    const indices: number[] = [];
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        indices.push(i);
      }
    }

    // 不去重顶点，保持硬边
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const vaIdx = vertices.length;
      vertices.push([position.getX(a), position.getY(a), position.getZ(a)]);
      const vbIdx = vertices.length;
      vertices.push([position.getX(b), position.getY(b), position.getZ(b)]);
      const vcIdx = vertices.length;
      vertices.push([position.getX(c), position.getY(c), position.getZ(c)]);
      triangles.push([vaIdx, vbIdx, vcIdx]);
    }
  });
  return { vertices, triangles };
}

function triangleArea(a: number[], b: number[], c: number[]): number {
  const va = new Vector3().fromArray(a);
  const vb = new Vector3().fromArray(b);
  const vc = new Vector3().fromArray(c);
  const ab = new Vector3().subVectors(vb, va);
  const ac = new Vector3().subVectors(vc, va);
  return ab.cross(ac).length() * 0.5;
}

function filterLargestComponent(geom: PPCGeometry): { vertices: number[][]; triangles: number[][]; mapping: number[] } {
  const { vertices, triangles } = geom;
  if (triangles.length === 0) return { ...geom, mapping: [] };

  // collectGeometry 为硬边模式，每个三角的三个顶点都是独立的。
  // 建连通性时按坐标匹配顶点来判断三角是否相邻。
  const posKeys = vertices.map((v) => `${v[0]},${v[1]},${v[2]}`);
  const keyToTris = new Map<string, number[]>();
  triangles.forEach((tri, idx) => {
    tri.forEach((vIdx) => {
      const key = posKeys[vIdx];
      const list = keyToTris.get(key) ?? [];
      list.push(idx);
      keyToTris.set(key, list);
    });
  });

  const visited = new Array(triangles.length).fill(false);
  let best: { triIdx: number[]; area: number } = { triIdx: [], area: -Infinity };

  for (let i = 0; i < triangles.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = true;
    const comp: number[] = [];
    let area = 0;

    while (queue.length) {
      const tIdx = queue.pop()!;
      comp.push(tIdx);
      const [a, b, c] = triangles[tIdx];
      area += triangleArea(vertices[a], vertices[b], vertices[c]);

      [a, b, c].forEach((vIdx) => {
        const key = posKeys[vIdx];
        (keyToTris.get(key) ?? []).forEach((n) => {
          if (!visited[n]) {
            visited[n] = true;
            queue.push(n);
          }
        });
      });
    }

    if (area > best.area) {
      best = { triIdx: comp, area };
    }
  }

  const usedVertexSet = new Set<number>();
  best.triIdx.forEach((t) => {
    triangles[t].forEach((v) => usedVertexSet.add(v));
  });

  const oldToNew = new Map<number, number>();
  const newVertices: number[][] = [];
  Array.from(usedVertexSet).forEach((vIdx) => {
    oldToNew.set(vIdx, newVertices.length);
    newVertices.push(vertices[vIdx]);
  });

  const newTriangles = best.triIdx.map((tIdx) => {
    const [a, b, c] = triangles[tIdx];
    return [oldToNew.get(a)!, oldToNew.get(b)!, oldToNew.get(c)!];
  });

  const mapping = new Array(triangles.length).fill(-1);
  best.triIdx.forEach((oldIdx, newIdx) => {
    mapping[oldIdx] = newIdx;
  });

  return { vertices: newVertices, triangles: newTriangles, mapping };
}

function createFrontMaterial(baseColor?: Color) {
  return new MeshStandardMaterial({
    color: baseColor ?? FACE_DEFAULT_COLOR.clone(),
    metalness: 0.05,
    roughness: 0.7,
    flatShading: true,
    side: FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    vertexColors: true,
  });
}

function createBackMaterial() {
  return new MeshStandardMaterial({
    color: new Color(0xa77f7d),
    metalness: 0.05,
    roughness: 0.7,
    flatShading: true,
    side: BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function applyDefaultFaceColors(mesh: Mesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return;
  const vertexCount = position.count;
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    FACE_DEFAULT_COLOR.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.attributes.color.needsUpdate = true;
}

function getFaceVertexIndices(geometry: BufferGeometry, faceIndex: number): number[] {
  const indexAttr = geometry.index;
  if (indexAttr) {
    return [
      indexAttr.getX(faceIndex * 3),
      indexAttr.getX(faceIndex * 3 + 1),
      indexAttr.getX(faceIndex * 3 + 2),
    ];
  }
  return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
}

function setFaceColor(mesh: Mesh, faceIndex: number, color: Color) {
  const geometry = mesh.geometry;
  const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
  if (!colorsAttr) return;
  const indices = getFaceVertexIndices(geometry, faceIndex);
  indices.forEach((idx) => {
    color.toArray(colorsAttr.array as Float32Array, idx * 3);
  });
  colorsAttr.needsUpdate = true;
}

function getFaceIdFromIntersection(mesh: Mesh, localFace: number | undefined): number | null {
  if (localFace === undefined || localFace === null) return null;
  const map = meshFaceIdMap.get(mesh.uuid);
  if (!map) return null;
  return map.get(localFace) ?? null;
}

function nextPaletteColor(): Color {
  const color = new Color(GROUP_COLOR_PALETTE[groupColorCursor % GROUP_COLOR_PALETTE.length]);
  groupColorCursor = (groupColorCursor + 1) % GROUP_COLOR_PALETTE.length;
  return color;
}

function getGroupColor(id: number): Color {
  if (!groupColors.has(id)) {
    groupColors.set(id, nextPaletteColor());
  }
  return groupColors.get(id)!.clone();
}

function setGroupColor(groupId: number, color: Color) {
  groupColors.set(groupId, color);
  const faces = groupFaces.get(groupId);
  if (faces) {
    faces.forEach((faceId) => updateFaceColorById(faceId));
  }
  updateGroupPreview();
  renderGroupTabs();
}

function updateFaceColorById(faceId: number) {
  const mapping = faceIndexMap.get(faceId);
  if (!mapping) return;
  const groupId = faceGroupMap.get(faceId) ?? null;
  const baseColor = groupId !== null ? getGroupColor(groupId) : FACE_DEFAULT_COLOR;
  setFaceColor(mapping.mesh, mapping.localFace, baseColor);
}

function setFaceGroup(faceId: number, groupId: number | null) {
  const hasPrev = faceGroupMap.has(faceId);
  const prev = faceGroupMap.get(faceId) ?? null;
  if (hasPrev && prev === groupId) return;

  const affected = new Set<number>();
  if (prev !== null) affected.add(prev);
  if (groupId !== null) affected.add(groupId);

  if (prev !== null) {
    groupFaces.get(prev)?.delete(faceId);
  }

  faceGroupMap.set(faceId, groupId);

  if (groupId !== null) {
    if (!groupFaces.has(groupId)) groupFaces.set(groupId, new Set<number>());
    groupFaces.get(groupId)!.add(faceId);
  }

  updateFaceColorById(faceId);
  if (affected.has(previewGroupId)) {
    updateGroupPreview();
  }
  affected.forEach((gid) => rebuildGroupTree(gid));
  if (groupId !== null && !affected.has(groupId)) {
    rebuildGroupTree(groupId);
  }
}

function shareEdgeWithGroup(faceId: number, groupId: number): boolean {
  const neighbors = faceAdjacency.get(faceId);
  if (!neighbors) return false;
  const groupSet = groupFaces.get(groupId);
  if (!groupSet || groupSet.size === 0) return false;
  for (const n of neighbors) {
    if (groupSet.has(n)) return true;
  }
  return false;
}

function canRemoveFace(groupId: number, faceId: number): boolean {
  const faces = groupFaces.get(groupId);
  if (!faces || faces.size <= 1) return true;
  if (!faces.has(faceId)) return true;

  const remaining = new Set(faces);
  remaining.delete(faceId);
  if (remaining.size === 0) return true;

  const start = remaining.values().next().value as number;
  const visited = new Set<number>();
  const queue = [start];
  visited.add(start);

  while (queue.length) {
    const cur = queue.pop()!;
    const neighbors = faceAdjacency.get(cur);
    if (!neighbors) continue;
    neighbors.forEach((n) => {
      if (!remaining.has(n)) return;
      if (visited.has(n)) return;
      visited.add(n);
      queue.push(n);
    });
  }

  return visited.size === remaining.size;
}

function areFacesAdjacent(a: number, b: number): boolean {
  const set = faceAdjacency.get(a);
  return set ? set.has(b) : false;
}

function logGroupTree(groupId: number, parentMap: Map<number, number | null>) {
  if (!parentMap.size) {
    console.log("[tree] group empty", { groupId });
    return;
  }
  const children = new Map<number, number[]>();
  parentMap.forEach((parent, face) => {
    if (parent === null) return;
    const list = children.get(parent) ?? [];
    list.push(face);
    children.set(parent, list);
  });

  const roots = Array.from(parentMap.entries())
    .filter(([, parent]) => parent === null)
    .map(([face]) => face);

  const pairs: string[] = [];
  const queue = [...roots];
  while (queue.length) {
    const node = queue.shift()!;
    (children.get(node) ?? []).forEach((child) => {
      pairs.push(`${node}-${child}`);
      queue.push(child);
    });
  }
  console.log("[tree] group", { groupId, pairs: pairs.join(" / ") });
}

function rebuildGroupTree(groupId: number) {
  const faces = groupFaces.get(groupId);
  const parentMap = new Map<number, number | null>();
  if (!faces || faces.size === 0) {
    groupTreeParent.set(groupId, parentMap);
    logGroupTree(groupId, parentMap);
    return;
  }
  const order = Array.from(faces); // 按加入顺序
  const assigned = new Set<number>();
  const assignedOrder: number[] = [];

  const assign = (face: number, parent: number | null) => {
    parentMap.set(face, parent);
    assigned.add(face);
    assignedOrder.push(face);
  };

  assign(order[0], null);

  while (assigned.size < order.length) {
    let progressed = false;
    for (let i = 1; i < order.length; i++) {
      const face = order[i];
      if (assigned.has(face)) continue;
      // 在已分配的面中寻找最近的相邻面作为父节点（按已分配顺序从后往前找）
      let parent: number | null = null;
      for (let j = assignedOrder.length - 1; j >= 0; j--) {
        const candidate = assignedOrder[j];
        if (areFacesAdjacent(face, candidate)) {
          parent = candidate;
          break;
        }
      }
      if (parent !== null) {
        assign(face, parent);
        progressed = true;
      }
    }
    if (!progressed) {
      // 理论上不会发生（因连通性保证），若发生记录错误并挂到根
      const remaining = order.find((f) => !assigned.has(f))!;
      console.error("[tree] rebuild invariant violated: no parent found", { groupId, remaining, order });
      assign(remaining, assignedOrder[0]);
    }
  }

  groupTreeParent.set(groupId, parentMap);
  logGroupTree(groupId, parentMap);
}

function pickFace(event: PointerEvent): number | null {
  if (!currentModel || !facesVisible) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(currentModel, true).filter((i) => {
    const mesh = i.object as Mesh;
    return (mesh as Mesh).isMesh && !(mesh as Mesh).userData.functional;
  });
  if (!intersects.length) return null;
  const hit = intersects[0];
  const faceIndex = hit.faceIndex ?? -1;
  if (faceIndex < 0) return null;
  return getFaceIdFromIntersection(hit.object as Mesh, faceIndex);
}

function handleRemoveFace(faceId: number) {
  if (editGroupId === null) return;
  const currentGroup = faceGroupMap.get(faceId);
  if (currentGroup !== editGroupId) return;
  const groupSet = groupFaces.get(editGroupId) ?? new Set<number>();
  const size = groupSet.size;
  console.log("[group] remove attempt", { faceId, groupId: editGroupId, size });
  if (size <= 2 || canRemoveFace(editGroupId, faceId)) {
    setFaceGroup(faceId, null);
    const newSize = groupFaces.get(editGroupId)?.size ?? 0;
    console.log("[group] remove success", { faceId, groupId: editGroupId, size: newSize });
    setStatus(`已从组${editGroupId}移除（面数量 ${newSize}）`, "success");
    const facesToUpdate = new Set<number>([faceId]);
    (groupFaces.get(editGroupId) ?? new Set<number>()).forEach((f) => facesToUpdate.add(f));
    rebuildSeamsForFaces(facesToUpdate);
  } else {
    console.log("[group] remove blocked: disconnect", { faceId, groupId: editGroupId });
    setStatus("移除会导致展开组不连通，已取消", "error");
  }
}

function handleAddFace(faceId: number) {
  if (editGroupId === null) return;
  const targetGroup = editGroupId;
  const currentGroup = faceGroupMap.get(faceId) ?? null;
  if (currentGroup === targetGroup) return;

  const targetSet = groupFaces.get(targetGroup) ?? new Set<number>();
  console.log("[group] add attempt", { faceId, targetGroup, currentGroup, targetSize: targetSet.size });

  // 若面已在其他组，先检查能否移出
  if (currentGroup !== null) {
    if (!canRemoveFace(currentGroup, faceId)) {
      console.log("[group] add blocked: source group disconnect", { faceId, from: currentGroup, to: targetGroup });
      setStatus("该面所在的组移出后会断开，未加入当前组", "error");
      return;
    }
  }

  // 连通性要求：当前组已有面时需共边
  if (targetSet.size > 0) {
    if (!shareEdgeWithGroup(faceId, targetGroup)) {
      console.log("[group] add blocked: no shared edge", { faceId, targetGroup });
      setStatus("该面与当前组无共边，未加入", "error");
      return;
    }
  }

  if (currentGroup !== null) {
    setFaceGroup(faceId, null);
  }
  setFaceGroup(faceId, targetGroup);
  const newSize = groupFaces.get(targetGroup)?.size ?? 0;
  console.log("[group] add success", { faceId, targetGroup, size: newSize });
  setStatus(`已加入组${targetGroup}（面数量 ${newSize}）`, "success");
  const groups = new Set<number>();
  groups.add(targetGroup);
  if (currentGroup !== null) groups.add(currentGroup);
  rebuildSeamsForGroups(groups);
}

function startBrush(button: number, initialFace: number | null) {
  if (editGroupId === null) return;
  if (initialFace === null) return;
  brushMode = true;
  brushButton = button;
  lastBrushedFace = null;
  controlsEnabledBeforeBrush = controls.enabled;
  controls.enabled = false;
  if (button === 0) {
    handleAddFace(initialFace);
  } else if (button === 2) {
    handleRemoveFace(initialFace);
  }
  lastBrushedFace = initialFace;
}

function endBrush() {
  if (!brushMode) return;
  brushMode = false;
  brushButton = null;
  lastBrushedFace = null;
  controls.enabled = controlsEnabledBeforeBrush;
}

function setEditGroup(groupId: number | null) {
  if (brushMode) endBrush();
  if (editGroupId !== null && groupId === editGroupId) return;
  editGroupId = groupId;
  if (groupId === null) {
    console.log("[group] exit edit mode");
    setStatus("已退出展开组编辑模式");
    stopGroupBreath();
    return;
  }
  if (!groupFaces.has(groupId)) {
    groupFaces.set(groupId, new Set<number>());
  }
  previewGroupId = groupId;
  updateGroupPreview();
  renderGroupTabs();
  console.log("[group] enter edit mode", { groupId });
  setStatus(`展开组 ${groupId} 编辑模式：左键加入，右键移出`, "info");
  startGroupBreath(groupId);
}

function updateGroupPreview() {
  if (!groupPreview || !groupPreviewLabel || !groupColorBtn || !groupColorInput || !groupDeleteBtn || !groupCountLabel)
    return;
  groupPreviewLabel.textContent = `展开组${previewGroupId}`;
  const color = getGroupColor(previewGroupId);
  const hex = `#${color.getHexString()}`;
  groupColorBtn.style.background = hex;
  groupColorInput.value = hex;
  const count = groupFaces.get(previewGroupId)?.size ?? 0;
  groupCountLabel.textContent = `面数量 ${count}`;
  const deletable = groupFaces.size > 1;
  groupDeleteBtn.style.display = deletable ? "inline-flex" : "none";
}

function renderGroupTabs() {
  if (!groupTabsEl) return;
  groupTabsEl.innerHTML = "";
  const ids = Array.from(groupFaces.keys()).sort((a, b) => a - b);
  ids.forEach((id) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${id === previewGroupId ? "active" : ""} ${editGroupId === id ? "editing" : ""}`;
    btn.textContent = `${id}`;
    btn.addEventListener("click", () => {
      if (editGroupId === null) {
        previewGroupId = id;
        updateGroupPreview();
        renderGroupTabs();
        setStatus(`预览展开组 ${id}`, "info");
        startGroupBreath(id);
      } else {
        if (editGroupId === id) return;
        setEditGroup(id);
      }
    });
    groupTabsEl.appendChild(btn);
  });
}

function getNextGroupId(): number {
  let id = 1;
  while (groupFaces.has(id)) id += 1;
  return id;
}

function deleteGroup(groupId: number) {
  if (groupFaces.size <= 1) return;
  const ids = Array.from(groupFaces.keys());
  if (!ids.includes(groupId)) return;

  if (breathGroupId === groupId) {
    stopGroupBreath();
  }
  const newColors = new Map<number, Color>();
  groupColors.forEach((c, id) => {
    if (id === groupId) return;
    const newId = id > groupId ? id - 1 : id;
    newColors.set(newId, c);
  });

  const assignments: Array<{ faceId: number; groupId: number | null }> = [];
  faceGroupMap.forEach((gid, faceId) => {
    if (gid === null) {
      assignments.push({ faceId, groupId: null });
    } else if (gid === groupId) {
      assignments.push({ faceId, groupId: null });
    } else {
      assignments.push({ faceId, groupId: gid > groupId ? gid - 1 : gid });
    }
  });

  faceGroupMap.clear();
  groupColors = newColors;
  groupFaces = new Map<number, Set<number>>();
  groupColors.forEach((_, id) => {
    groupFaces.set(id, new Set<number>());
  });
  groupTreeParent = new Map<number, Map<number, number | null>>();
  if (groupFaces.size === 0) {
    const color = getGroupColor(1);
    groupFaces.set(1, new Set<number>());
  }

  assignments.forEach(({ faceId, groupId }) => {
    setFaceGroup(faceId, groupId);
  });
  groupFaces.forEach((_, gid) => rebuildGroupTree(gid));

  let candidates = Array.from(groupFaces.keys()).sort((a, b) => a - b);
  if (!candidates.length) {
    const color = getGroupColor(1);
    groupFaces.set(1, new Set<number>());
    groupColors.set(1, color);
    groupTreeParent.set(1, new Map<number, number | null>());
    candidates = [1];
  }
  const maxId = candidates[candidates.length - 1];
  let target = groupId - 1;
  if (target < 1) target = 1;
  if (target > maxId) target = maxId;
  previewGroupId = target;
  if (editGroupId !== null) {
    setEditGroup(previewGroupId);
  } else {
    updateGroupPreview();
    renderGroupTabs();
  }
  setStatus(`已删除展开组 ${groupId}`, "success");
}

function applyImportedGroups(groups: PPCFile["groups"]) {
  if (!groups || !groups.length) return;
  // 重置
  groupFaces = new Map<number, Set<number>>();
  groupColors = new Map<number, Color>();
  // groupColorCursor 已在导入流程按文件设置（若包含）
  groups
    .sort((a, b) => a.id - b.id)
    .forEach((g) => {
      const id = g.id;
      groupFaces.set(id, new Set<number>());
      const color = new Color(g.color);
      groupColors.set(id, color);
      g.faces.forEach((faceId) => {
        setFaceGroup(faceId, id);
      });
      rebuildGroupTree(id);
    });
  const ids = Array.from(groupFaces.keys());
  if (!ids.includes(1)) {
    groupFaces.set(1, new Set<number>());
    groupColors.set(1, getGroupColor(1));
  }
  previewGroupId = Math.min(...Array.from(groupFaces.keys()));
  updateGroupPreview();
  renderGroupTabs();
}

function buildFaceColorMap(object: Object3D) {
  faceColorMap = new Map<number, string>();
  faceAdjacency = new Map<number, Set<number>>();
  faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
  meshFaceIdMap = new Map<string, Map<number, number>>();
  faceGroupMap = new Map<number, number | null>();
  groupFaces = new Map<number, Set<number>>();
  groupColors = new Map<number, Color>();
  groupColorCursor = 0;
  faceToEdges = new Map<number, [number, number, number]>();
  edges = [];
  edgeKeyToId = new Map<string, number>();
  groupTreeParent = new Map<number, Map<number, number | null>>();
  vertexKeyToPos = new Map<string, Vector3>();
  groupFaces.set(1, new Set<number>());
  getGroupColor(1);
  editGroupId = null;
  previewGroupId = 1;
  renderGroupTabs();
  updateGroupPreview();
  groupTreeParent.set(1, new Map<number, number | null>());
  rebuildGroupTree(1);
  let faceId = 0;

  const vertexKey = (pos: any, idx: number) =>
    `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;

  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    const indexAttr = geometry.index;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const faceCount = indexAttr ? indexAttr.count / 3 : position.count / 3;

    if (!meshFaceIdMap.has(mesh.uuid)) {
      meshFaceIdMap.set(mesh.uuid, new Map<number, number>());
    }
    const localMap = meshFaceIdMap.get(mesh.uuid)!;

    for (let f = 0; f < faceCount; f++) {
      faceColorMap.set(faceId, FACE_DEFAULT_COLOR.getHexString());
      faceGroupMap.set(faceId, null);
      faceIndexMap.set(faceId, { mesh, localFace: f });
      localMap.set(f, faceId);
      const [a, b, c] = getFaceVertexIndices(geometry, f);
      const va = vertexKey(position, a);
      const vb = vertexKey(position, b);
      const vc = vertexKey(position, c);
      if (!vertexKeyToPos.has(va)) vertexKeyToPos.set(va, new Vector3(position.getX(a), position.getY(a), position.getZ(a)));
      if (!vertexKeyToPos.has(vb)) vertexKeyToPos.set(vb, new Vector3(position.getX(b), position.getY(b), position.getZ(b)));
      if (!vertexKeyToPos.has(vc)) vertexKeyToPos.set(vc, new Vector3(position.getX(c), position.getY(c), position.getZ(c)));
      const faceEdges: number[] = [];
      const edgePairs: [string, string][] = [
        [va, vb],
        [vb, vc],
        [vc, va],
      ];
      edgePairs.forEach(([p1, p2]) => {
        const key = [p1, p2].sort().join("|");
        let edgeId = edgeKeyToId.get(key);
        if (edgeId === undefined) {
          edgeId = edges.length;
          edgeKeyToId.set(key, edgeId);
          edges.push({ id: edgeId, key, faces: new Set<number>(), vertices: [p1, p2] });
        }
        edges[edgeId].faces.add(faceId);
        faceEdges.push(edgeId);
      });
      faceToEdges.set(faceId, faceEdges as [number, number, number]);
      faceId++;
    }
  });

  edges.forEach((edge) => {
    const faces = Array.from(edge.faces);
    if (faces.length < 2) return;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const a = faces[i];
        const b = faces[j];
        if (!faceAdjacency.has(a)) faceAdjacency.set(a, new Set<number>());
        if (!faceAdjacency.has(b)) faceAdjacency.set(b, new Set<number>());
        faceAdjacency.get(a)!.add(b);
        faceAdjacency.get(b)!.add(a);
      }
    }
  });
  // 初始化默认组树
  rebuildGroupTree(1);
}

function generateFunctionalMaterials(root: Object3D) {
  const replacements: { parent: Object3D; mesh: Mesh }[] = [];
  root.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      applyDefaultFaceColors(mesh);
      replacements.push({ parent: mesh.parent ? mesh.parent : root, mesh });
    }
  });
  replacements.forEach(({ parent, mesh }) => {
    const geomBack = mesh.geometry.clone();
    const meshBack = new Mesh(geomBack, createBackMaterial());
    meshBack.userData.functional = "back";
    meshBack.castShadow = mesh.castShadow;
    meshBack.receiveShadow = mesh.receiveShadow;
    meshBack.name = mesh.name ? `${mesh.name}-back` : "back-only";
    meshBack.position.copy(mesh.position);
    meshBack.rotation.copy(mesh.rotation);
    meshBack.scale.copy(mesh.scale);
    parent.add(meshBack);

    const geomWireframe = mesh.geometry.clone();
    const meshWireframe = new Mesh(geomWireframe, new MeshStandardMaterial({
      color: new Color(0x996600),
      flatShading: true,
      wireframe: true,
    }));
    meshWireframe.userData.functional = "edge";
    meshWireframe.castShadow = false;
    meshWireframe.receiveShadow = false;
    meshWireframe.name = mesh.name ? `${mesh.name}-wireframe` : "wireframe-only";
    meshWireframe.position.copy(mesh.position);
    meshWireframe.rotation.copy(mesh.rotation);
    meshWireframe.scale.copy(mesh.scale);
    parent.add(meshWireframe);
  });
}

function applyFaceVisibility() {
  if (!currentModel) return;
  currentModel.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional && mesh.userData.functional !== "back") return;
    if ((mesh.material as MeshStandardMaterial).visible !== undefined) {
      (mesh.material as MeshStandardMaterial).visible = facesVisible;
    }
  });
}

function countTrianglesInObject(object: Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = (child as Mesh).geometry;
    if (geometry.index) {
      count += geometry.index.count / 3;
    } else {
      const position = geometry.getAttribute("position");
      count += position ? position.count / 3 : 0;
    }
  });
  return count;
}

async function computeChecksum(payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  if (crypto?.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback 简单 hash（非安全）
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 5) - hash + data[i];
    hash |= 0;
  }
  return hash.toString(16);
}

async function build3dppcData(object: Object3D): Promise<PPCFile> {
  const collected = collectGeometry(object);
  const filtered = filterLargestComponent(collected);
  const exportVertices = filtered.vertices;
  const exportTriangles = filtered.triangles;
  const mapping = filtered.mapping;

  const checksum = await computeChecksum({
    vertices: exportVertices,
    triangles: exportTriangles,
  });

  const groupsData: NonNullable<PPCFile["groups"]> = [];
  groupFaces.forEach((faces, groupId) => {
    const facesSet = faces ?? new Set<number>();
    const filteredFaces: number[] = [];
    facesSet.forEach((faceId) => {
      const mapped = mapping[faceId];
      if (mapped !== undefined && mapped >= 0) filteredFaces.push(mapped);
    });
    const colorHex = `#${getGroupColor(groupId).getHexString()}`;
    groupsData.push({
      id: groupId,
      color: colorHex,
      faces: filteredFaces,
    });
  });

  return {
    version: FORMAT_VERSION,
    meta: {
      generator: "3D Printed Paper Craft",
      createdAt: new Date().toISOString(),
      source: lastFileName,
      units: "meter",
      checksum: {
        algorithm: "SHA-256",
        value: checksum,
        scope: "geometry",
      },
    },
    vertices: exportVertices,
    triangles: exportTriangles,
    groupColorCursor,
    groups: groupsData,
    annotations: {},
  };
}

async function download3dppc(data: PPCFile) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const base = lastFileName.replace(/\.[^.]+$/, "");
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const name = `${base}_${stamp}.3dppc`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function load3dppc(
  url: string,
): Promise<{ object: Object3D; groups?: PPCFile["groups"]; colorCursor?: number }> {
  const res = await fetch(url);
  const json = (await res.json()) as PPCFile;
  if (!Array.isArray(json.vertices) || !Array.isArray(json.triangles)) {
    throw new Error("3dppc 格式缺少 vertices/triangles");
  }
  const group = new Group();

  const vertices = json.vertices;
  const triangles = json.triangles;
  lastTriangleCount = triangles.length;

  const positions: number[] = [];
  const indices: number[] = [];

  vertices.forEach(([x, y, z]) => {
    positions.push(x, y, z);
  });
  triangles.forEach(([a, b, c], i) => {
    indices.push(a, b, c);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, createFrontMaterial());
  group.add(mesh);
  if (typeof json.groupColorCursor === "number") {
    groupColorCursor = json.groupColorCursor % GROUP_COLOR_PALETTE.length;
  }

  const colorCursor =
    typeof json.groupColorCursor === "number"
      ? json.groupColorCursor % GROUP_COLOR_PALETTE.length
      : undefined;

  return { object: group, groups: json.groups, colorCursor };
}

function fitCameraToObject(object: Object3D) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = maxDim / (2 * Math.tan(fov / 2));
  const offset = 1.8;

  camera.position.set(-distance * offset * 0.75, -distance * offset, distance * offset * 0.75);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = viewer;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  updateSeamResolution();
  updateHoverResolution();
}

window.addEventListener("resize", resizeRenderer);

function disposeSeams() {
  seamLines.forEach((line) => {
    line.removeFromParent();
    (line.geometry as LineSegmentsGeometry).dispose();
    (line.material as LineMaterial).dispose();
  });
  seamLines.clear();
}

function applyEdgeVisibility() {
  if (!currentModel) return;
  currentModel.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional === "edge") {
      mesh.visible = edgesVisible;
    }
  });
}

function applySeamsVisibility() {
  if (!currentModel) return;
  seamLines.forEach((line) => {
    line.visible = seamsVisible && line.userData.isSeam;
  });
}

function updateSeamResolution() {
  const { clientWidth, clientHeight } = viewer;
  seamLines.forEach((line) => {
    const material = line.material as LineMaterial;
    material.resolution.set(clientWidth, clientHeight);
  });
}

function refreshVertexWorldPositions() {
  vertexKeyToPos.clear();
  if (!currentModel) return;
  const vertexKey = (pos: any, idx: number) =>
    `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;
  currentModel.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const count = position.count;
    for (let i = 0; i < count; i++) {
      const key = vertexKey(position, i);
      const world = new Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(
        mesh.matrixWorld,
      );
      vertexKeyToPos.set(key, world);
    }
  });
}

function isParentChildEdge(f1: number, f2: number): boolean {
  const g1 = faceGroupMap.get(f1);
  const g2 = faceGroupMap.get(f2);
  if (g1 === null || g2 === null || g1 !== g2) return false;
  const parentMap = groupTreeParent.get(g1);
  if (!parentMap) return false;
  return parentMap.get(f1) === f2 || parentMap.get(f2) === f1;
}

function edgeIsSeam(edgeId: number): boolean {
  const edge = edges[edgeId];
  if (!edge) return false;
  const faces = Array.from(edge.faces);
  if (faces.length === 1) return false;
  if (faces.length !== 2) return true;
  const [f1, f2] = faces;
  const g1 = faceGroupMap.get(f1) ?? null;
  const g2 = faceGroupMap.get(f2) ?? null;
  if (g1 === null && g2 === null) return false;
  if (g1 === null || g2 === null) return true;
  if (g1 !== g2) return true;
  const seam = !isParentChildEdge(f1, f2);
  if (seam) {
    console.log("[seam] edge is seam", { edgeId, faces, groups: [g1, g2] });
  }
  return seam;
}

function ensureSeamLine(edgeId: number): LineSegments2 {
  const existing = seamLines.get(edgeId);
  if (existing) return existing;
  const geom = new LineSegmentsGeometry();
  const mat = new LineMaterial({
    color: 0x000000,
    linewidth: 5,
    resolution: new Vector2(viewer.clientWidth, viewer.clientHeight),
  });
  const line = new LineSegments2(geom, mat);
  line.userData.functional = "seam";
  line.renderOrder = 2;
  seamLines.set(edgeId, line);
  scene.add(line);
  return line;
}

function updateSeamLine(edgeId: number, visible: boolean) {
  const edge = edges[edgeId];
  if (!edge) return;
  const v1 = vertexKeyToPos.get(edge.vertices[0]);
  const v2 = vertexKeyToPos.get(edge.vertices[1]);
  if (!v1 || !v2) return;
  const line = ensureSeamLine(edgeId);
  const arr = new Float32Array([v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
  (line.geometry as LineSegmentsGeometry).setPositions(arr);
  line.computeLineDistances();
  line.visible = visible && seamsVisible;
  line.userData.isSeam = visible;
}

function rebuildSeamsFull() {
  if (!currentModel) return;
  console.log("[seam] rebuild full");
  refreshVertexWorldPositions();
  edges.forEach((_, edgeId) => {
    const isSeam = edgeIsSeam(edgeId);
    updateSeamLine(edgeId, isSeam);
  });
  applySeamsVisibility();
  updateSeamResolution();
}

function rebuildSeamsForGroups(groupIds: Set<number>) {
  if (!currentModel || groupIds.size === 0) return;
  console.log("[seam] rebuild partial", { groups: Array.from(groupIds) });
  rebuildSeamsForFaces(new Set(Array.from(groupIds).flatMap((gid) => Array.from(groupFaces.get(gid) ?? []))));
}

function rebuildSeamsForFaces(faceIds: Set<number>) {
  if (!currentModel || faceIds.size === 0) return;
  console.log("[seam] rebuild faces", { faces: Array.from(faceIds) });
  refreshVertexWorldPositions();
  edges.forEach((edge, edgeId) => {
    let related = false;
    edge.faces.forEach((f) => {
      if (faceIds.has(f)) related = true;
    });
    if (!related) return;
    const isSeam = edgeIsSeam(edgeId);
    updateSeamLine(edgeId, isSeam);
  });
  applySeamsVisibility();
  updateSeamResolution();
}

function initHoverLines() {
  if (hoverLines.length) return;
  for (let i = 0; i < 3; i++) {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(new Float32Array(6));
    const mat = new LineMaterial({
      color: 0xffa500,
      linewidth: 5,
      resolution: new Vector2(viewer.clientWidth, viewer.clientHeight),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 2,
    });
    const line = new LineSegments2(geom, mat);
    line.computeLineDistances();
    line.visible = false;
    line.userData.functional = "hover";
    hoverLines.push(line);
    scene.add(line);
  }
}

function disposeHoverLines() {
  hoverLines.forEach((line) => {
    line.removeFromParent();
    (line.geometry as LineSegmentsGeometry).dispose();
    (line.material as LineMaterial).dispose();
  });
  hoverLines.length = 0;
  hoveredFaceId = null;
}

function updateHoverResolution() {
  const { clientWidth, clientHeight } = viewer;
  hoverLines.forEach((line) => {
    const mat = line.material as LineMaterial;
    mat.resolution.set(clientWidth, clientHeight);
  });
}

function hideHoverLines() {
  hoverLines.forEach((line) => {
    line.visible = false;
  });
  hoveredFaceId = null;
}

function updateHoverLines(mesh: Mesh | null, faceIndex: number | null, faceId: number | null) {
  if (!mesh || faceIndex === null || faceIndex < 0 || faceId === null) {
    hideHoverLines();
    return;
  }
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) {
    hideHoverLines();
    return;
  }
  const indices = getFaceVertexIndices(geometry, faceIndex);
  const verts = indices.map((idx) =>
    new Vector3(position.getX(idx), position.getY(idx), position.getZ(idx)).applyMatrix4(mesh.matrixWorld),
  );
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const;
  edges.forEach(([a, b], i) => {
    const line = hoverLines[i];
    if (!line) return;
    const arr = new Float32Array([
      verts[a].x,
      verts[a].y,
      verts[a].z,
      verts[b].x,
      verts[b].y,
      verts[b].z,
    ]);
    (line.geometry as LineSegmentsGeometry).setPositions(arr);
    line.visible = true;
  });
  hoveredFaceId = faceId;
}

function stopGroupBreath() {
  if (breathRaf !== null) {
    cancelAnimationFrame(breathRaf);
    breathRaf = null;
  }
  const gid = breathGroupId;
  breathGroupId = null;
  if (gid !== null) {
    const faces = groupFaces.get(gid);
    faces?.forEach((faceId) => updateFaceColorById(faceId));
  }
}

function startGroupBreath(groupId: number) {
  stopGroupBreath();
  breathGroupId = groupId;
  breathStart = performance.now();
  breathEnd = breathStart + BREATH_DURATION;
  const faces = groupFaces.get(groupId);
  if (!faces || faces.size === 0) {
    breathGroupId = null;
    return;
  }

  const loop = () => {
    if (breathGroupId !== groupId) return;
    const now = performance.now();
    const elapsed = now - breathStart;
    const progress = Math.min(1, elapsed / BREATH_DURATION);
    if (progress >= 1) {
      faces.forEach((faceId) => updateFaceColorById(faceId));
      stopGroupBreath();
      return;
    }
    const factor = (1 + BREATH_SCALE) + BREATH_SCALE * Math.sin((progress + 0.25) * Math.PI * 2 * BREATH_CYCLES);
    const baseColor = getGroupColor(groupId);
    const scaled = baseColor.clone().multiplyScalar(factor);
    faces.forEach((faceId) => {
      const mapping = faceIndexMap.get(faceId);
      if (!mapping) return;
      setFaceColor(mapping.mesh, mapping.localFace, scaled);
    });
    breathRaf = requestAnimationFrame(loop);
  };
  breathRaf = requestAnimationFrame(loop);
}

async function loadModel(file: File, ext: string) {
  const url = URL.createObjectURL(file);
  placeholder.classList.add("hidden");
  setStatus("加载中...", "info");

  try {
    let object: Object3D;
    let importedGroups: PPCFile["groups"] | undefined;
    let importedColorCursor: number | undefined;
    if (ext === "obj") {
      const loaded = await objLoader.loadAsync(url);
      // 将所有 mesh 材质替换为 frontMaterial
      const mat = createFrontMaterial();
      loaded.traverse((child) => {
        if ((child as Mesh).isMesh) {
          (child as Mesh).material = mat.clone();
        }
      });
      object = loaded;
    } else if (ext === "fbx") {
      const loaded = await fbxLoader.loadAsync(url);
      const mat = createFrontMaterial();
      loaded.traverse((child) => {
        if ((child as Mesh).isMesh) {
          (child as Mesh).material = mat.clone();
        }
      });
      object = loaded;
    } else if (ext === "stl") {
      const geometry = await stlLoader.loadAsync(url);
      const material = createFrontMaterial();
      object = new Mesh(geometry, material);
    } else {
      const loaded = await load3dppc(url);
      object = loaded.object;
      importedGroups = loaded.groups;
      importedColorCursor = loaded.colorCursor;
    }

    clearModel();
    currentModel = object;
    lastFileName = file.name;
    generateFunctionalMaterials(currentModel);
    buildFaceColorMap(currentModel);
    if (typeof importedColorCursor === "number") {
      groupColorCursor = importedColorCursor % GROUP_COLOR_PALETTE.length;
    }
    if (importedGroups && importedGroups.length) {
      applyImportedGroups(importedGroups);
    }
    applyFaceVisibility();
    applyEdgeVisibility();
    modelGroup.add(currentModel);
    initHoverLines();
    lastTriangleCount = countTrianglesInObject(currentModel);
    fitCameraToObject(currentModel);
    refreshVertexWorldPositions();
    rebuildSeamsFull();
    showWorkspace(true);
    resizeRenderer(); // 确保从隐藏切换到可见后尺寸正确
    setStatus(`已加载：${file.name} · 三角面 ${lastTriangleCount}`, "success");
    exportBtn.disabled = false;
  } catch (error) {
    console.error("加载模型失败", error);
    if ((error as Error)?.stack) {
      console.error((error as Error).stack);
    }
    setStatus("加载失败，请检查文件格式是否正确。", "error");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const ext = getExtension(file.name);
  if (!allowedExtensions.includes(ext)) {
    setStatus("不支持的格式，请选择 OBJ / FBX / STL。", "error");
    fileInput.value = "";
    return;
  }

  await loadModel(file, ext);
});

lightToggle.addEventListener("click", () => {
  const enabled = !dir.visible;
  dir.visible = enabled;
  ambient.intensity = enabled ? 0.6 : 3;
  lightToggle.classList.toggle("active", enabled);
  lightToggle.textContent = `光源：${enabled ? "开" : "关"}`;
});

edgesToggle.addEventListener("click", () => {
  edgesVisible = !edgesVisible;
  edgesToggle.classList.toggle("active", edgesVisible);
  edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
  applyEdgeVisibility();
});
seamsToggle.addEventListener("click", () => {
  seamsVisible = !seamsVisible;
  seamsToggle.classList.toggle("active", seamsVisible);
  seamsToggle.textContent = `拼接边：${seamsVisible ? "开" : "关"}`;
  if (seamsVisible && seamLines.size === 0) rebuildSeamsFull();
  applySeamsVisibility();
})

facesToggle.addEventListener("click", () => {
  facesVisible = !facesVisible;
  facesToggle.classList.toggle("active", facesVisible);
  facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
  applyFaceVisibility();
});

exportBtn.addEventListener("click", async () => {
  if (!currentModel) {
    setStatus("没有可导出的模型", "error");
    return;
  }
  try {
    setStatus("正在导出 .3dppc ...", "info");
    const data = await build3dppcData(currentModel);
    await download3dppc(data);
    setStatus("导出成功", "success");
  } catch (error) {
    console.error("导出失败", error);
    setStatus("导出失败，请重试。", "error");
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  triCounter.textContent = `渲染三角形：${renderer.info.render.triangles}`;
}

resizeRenderer();
animate();

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!currentModel || !facesVisible) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObject(currentModel, true).filter((i) => {
    const mesh = i.object as Mesh;
    return (mesh as Mesh).isMesh && !(mesh as Mesh).userData.functional;
  });

  hideHoverLines();

  if (!intersects.length) {
    if (brushMode) lastBrushedFace = null;
    return;
  }
  const hit = intersects[0];
  const mesh = hit.object as Mesh;
  const faceIndex = hit.faceIndex ?? -1;
  const faceId = getFaceIdFromIntersection(mesh, faceIndex);
  if (brushMode && faceId !== lastBrushedFace) {
    if (faceId !== null) {
      if (brushButton === 0) handleAddFace(faceId);
      else if (brushButton === 2) handleRemoveFace(faceId);
    }
    lastBrushedFace = faceId;
  }
  if (faceId === null) return;
  updateHoverLines(mesh, faceIndex, faceId);
});

renderer.domElement.addEventListener("pointerleave", () => {
  hideHoverLines();
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  // 捕获指针，确保离开画布也能收到 pointerup，避免摄像机拖拽状态悬挂
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch (e) {
    // ignore capture failures
  }
  if (!currentModel || editGroupId === null) return;
  const faceId = pickFace(event);
  if (faceId === null) return;
  startBrush(event.button, faceId);
});

renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

renderer.domElement.addEventListener("pointerup", (event) => {
  try {
    renderer.domElement.releasePointerCapture(event.pointerId);
  } catch (e) {
    // ignore release failures
  }
  if (brushMode) endBrush();
});

window.addEventListener("pointerup", () => {
  if (brushMode) endBrush();
});

groupAddBtn.addEventListener("click", () => {
  const newId = getNextGroupId();
  groupFaces.set(newId, new Set<number>());
  setGroupColor(newId, getGroupColor(newId));
  previewGroupId = newId;
  updateGroupPreview();
  renderGroupTabs();
  setStatus(`已创建展开组 ${newId}`, "success");
  if (editGroupId !== null) {
    setEditGroup(newId);
  }
});

groupColorBtn.addEventListener("click", () => {
  groupColorInput.click();
});

groupColorInput.addEventListener("input", (event) => {
  const value = (event.target as HTMLInputElement).value;
  if (!value) return;
  const color = new Color(value);
  setGroupColor(previewGroupId, color);
});

groupDeleteBtn.addEventListener("click", () => {
  if (groupFaces.size <= 1) return;
  const ok = confirm(`确定删除展开组 ${previewGroupId} 吗？该组的面将被移出。`);
  if (!ok) return;
  deleteGroup(previewGroupId);
});

window.addEventListener("keydown", (event) => {
  if (!currentModel) return;
  if (event.key === "Escape") {
    if (editGroupId !== null) {
      setEditGroup(null);
    }
    return;
  }
  const num = Number(event.key);
  if (!Number.isInteger(num) || num <= 0) return;
  if (groupFaces.has(num)) {
    setEditGroup(num);
  }
});
