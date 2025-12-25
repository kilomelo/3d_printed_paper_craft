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
  DoubleSide,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
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

const VERSION = "1.0.1.27";
const FORMAT_VERSION = "1.0";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

app.innerHTML = `
  <main class="card">
    <header>
      <h1>3D Printed Paper Craft</h1>
    </header>
    <input id="file-input" type="file" accept=".obj,.fbx,.stl,.3dppc,application/json" style="display:none" />

    <section id="layout-empty" class="layout active">
      <div class="empty-state">
        <h2>上传模型开始编辑</h2>
        <p class="empty-lead">支持 OBJ / FBX / STL / 3dppc</p>
        <label class="empty-upload" for="file-input">
          <span>选择模型文件</span>
        </label>
      </div>
    </section>

    <section id="layout-workspace" class="layout">
      <div class="workspace">
        <div class="panel">
          <div class="toolbar">
            <label class="upload" for="file-input">
              <span>打开模型</span>
            </label>
            <button class="btn active" id="light-toggle">主光源：开</button>
            <button class="btn" id="edges-toggle">线框：关</button>
            <button class="btn" id="seams-toggle">接缝：关</button>
            <button class="btn active" id="faces-toggle">面渲染：开</button>
            <button class="btn" id="export-btn" disabled>导出 .3dppc</button>
          </div>
          <div class="viewer" id="viewer">
            <div class="placeholder" id="placeholder">选择模型以预览</div>
            <div class="tri-counter" id="tri-counter">渲染三角形：0</div>
          </div>
          <div class="status" id="status">尚未加载模型</div>
        </div>
        <div class="panel right-panel">
          <h2>展开组预览</h2>
          <div class="placeholder-card">展开面片组预览区域（待开发）</div>
        </div>
      </div>
    </section>
  </main>
  <div class="version-tag">v${VERSION}</div>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const placeholder = document.querySelector<HTMLDivElement>("#placeholder");
const statusEl = document.querySelector<HTMLDivElement>("#status");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const seamsToggle = document.querySelector<HTMLButtonElement>("#seams-toggle");
const facesToggle = document.querySelector<HTMLButtonElement>("#faces-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
const triCounter = document.querySelector<HTMLDivElement>("#tri-counter");
const layoutEmpty = document.querySelector<HTMLElement>("#layout-empty");
const layoutWorkspace = document.querySelector<HTMLElement>("#layout-workspace");

let lastStatus = { message: "", tone: "info" as "info" | "error" | "success", count: 0 };

if (
  !viewer ||
  !placeholder ||
  !statusEl ||
  !fileInput ||
  !lightToggle ||
  !edgesToggle ||
  !seamsToggle ||
  !facesToggle ||
  !exportBtn ||
  !triCounter ||
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
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);

const ambient = new AmbientLight(0xffffff, 0.6);
const dir = new DirectionalLight(0xffffff, 0.8);
dir.position.set(4, 6, 8);
scene.add(ambient, dir);

const modelGroup = new Group();
scene.add(modelGroup);

const objLoader = new OBJLoader();
const fbxLoader = new FBXLoader();
const stlLoader = new STLLoader();

const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];
const FACE_DEFAULT_COLOR = new Color(0x9ad6ff);
const HIGHLIGHT_SCALE = 1.2;
const GROUP_COLORS: Record<number, Color> = {
  1: new Color(0x22c55e),
};
let edgesVisible = true;
let seamsVisible = false;
let facesVisible = true;
let currentModel: Object3D | null = null;
let seamLines: LineSegments2[] = [];
let lastFileName = "model";
let lastTriangleCount = 0;
let faceColorMap = new Map<number, string>();
let faceAdjacency = new Map<number, Set<number>>();
let faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
let meshFaceIdMap = new Map<string, Map<number, number>>();
let faceGroupMap = new Map<number, number | null>();
let groupFaces = new Map<number, Set<number>>();
let editGroupId: number | null = null;
const raycaster = new Raycaster();
const pointer = new Vector2();
let hovered: {
  mesh: Mesh | null;
  indices: number[];
  original: number[];
  faceId: number | null;
} = { mesh: null, indices: [], original: [], faceId: null };

edgesToggle.classList.toggle("active", edgesVisible);
edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
seamsToggle.classList.toggle("active", seamsVisible);
seamsToggle.textContent = `接缝：${seamsVisible ? "开" : "关"}`;
facesToggle.classList.toggle("active", facesVisible);
facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
showWorkspace(false);

function setStatus(message: string, tone: "info" | "error" | "success" = "info") {
  if (message === lastStatus.message && tone === lastStatus.tone) {
    lastStatus.count += 1;
  } else {
    lastStatus = { message, tone, count: 0 };
  }
  const suffix = lastStatus.count > 0 ? ` +${lastStatus.count}` : "";
  statusEl.textContent = `${message}${suffix}`;
  statusEl.className = `status ${tone === "info" ? "" : tone}`;
}

function clearHover() {
  if (!hovered.mesh || !hovered.original.length) return;
  const geometry = hovered.mesh.geometry;
  const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
  if (colorsAttr) {
    hovered.indices.forEach((idx, i) => {
      colorsAttr.array[idx * 3] = hovered.original[i * 3];
      colorsAttr.array[idx * 3 + 1] = hovered.original[i * 3 + 1];
      colorsAttr.array[idx * 3 + 2] = hovered.original[i * 3 + 2];
    });
    colorsAttr.needsUpdate = true;
  }
  hovered = { mesh: null, indices: [], original: [], faceId: null };
}

function showWorkspace(loaded: boolean) {
  layoutEmpty.classList.toggle("active", !loaded);
  layoutWorkspace.classList.toggle("active", loaded);
}

function clearModel() {
  modelGroup.clear();
  disposeSeams();
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
  groupFaces.clear();
  clearHover();
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

function filterLargestComponent(geom: PPCGeometry): PPCGeometry {
  const { vertices, triangles } = geom;
  if (triangles.length === 0) return geom;

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

  return { vertices: newVertices, triangles: newTriangles };
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

function updateFaceColorById(faceId: number) {
  const mapping = faceIndexMap.get(faceId);
  if (!mapping) return;
  const groupId = faceGroupMap.get(faceId) ?? null;
  const baseColor = groupId && GROUP_COLORS[groupId] ? GROUP_COLORS[groupId] : FACE_DEFAULT_COLOR;
  setFaceColor(mapping.mesh, mapping.localFace, baseColor);

  const colorsAttr = mapping.mesh.geometry.getAttribute("color") as Float32BufferAttribute | null;
  if (hovered.faceId === faceId && hovered.mesh === mapping.mesh && colorsAttr) {
    const indices = getFaceVertexIndices(mapping.mesh.geometry, mapping.localFace);
    hovered.indices = indices;
    hovered.original = [];
    indices.forEach((idx) => {
      hovered.original.push(
        colorsAttr.array[idx * 3],
        colorsAttr.array[idx * 3 + 1],
        colorsAttr.array[idx * 3 + 2],
      );
    });
    // 重新应用悬停高亮
    const base = new Color().fromArray(colorsAttr.array as Float32Array, indices[0] * 3);
    const highlight = base.clone();
    highlight.r = Math.min(1, highlight.r * HIGHLIGHT_SCALE);
    highlight.g = Math.min(1, highlight.g * HIGHLIGHT_SCALE);
    highlight.b = Math.min(1, highlight.b * HIGHLIGHT_SCALE);
    setFaceColor(mapping.mesh, mapping.localFace, highlight);
  }
}

function setFaceGroup(faceId: number, groupId: number | null) {
  const prev = faceGroupMap.get(faceId) ?? null;
  if (prev === groupId) return;

  if (prev !== null) {
    groupFaces.get(prev)?.delete(faceId);
  }

  faceGroupMap.set(faceId, groupId);

  if (groupId !== null) {
    if (!groupFaces.has(groupId)) groupFaces.set(groupId, new Set<number>());
    groupFaces.get(groupId)!.add(faceId);
  }

  updateFaceColorById(faceId);
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
    setStatus(`已从组 ${editGroupId} 移除`, "success");
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
  setStatus(`已加入组 ${targetGroup}`, "success");
}

function setEditGroup(groupId: number | null) {
  editGroupId = groupId;
  if (groupId === null) {
    console.log("[group] exit edit mode");
    setStatus("已退出展开组编辑模式");
    return;
  }
  if (!groupFaces.has(groupId)) {
    groupFaces.set(groupId, new Set<number>());
  }
  console.log("[group] enter edit mode", { groupId });
  setStatus(`展开组 ${groupId} 编辑模式：左键加入，右键移出`, "info");
}

function buildFaceColorMap(object: Object3D) {
  faceColorMap = new Map<number, string>();
  faceAdjacency = new Map<number, Set<number>>();
  faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
  meshFaceIdMap = new Map<string, Map<number, number>>();
  faceGroupMap = new Map<number, number | null>();
  groupFaces = new Map<number, Set<number>>();
  groupFaces.set(1, new Set<number>());
  editGroupId = null;
  const edgeMap = new Map<string, number[]>();
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
      const edges = [
        [va, vb],
        [vb, vc],
        [vc, va],
      ];
      edges.forEach(([p1, p2]) => {
        const key = [p1, p2].sort().join("|");
        const faces = edgeMap.get(key) ?? [];
        faces.push(faceId);
        edgeMap.set(key, faces);
      });
      faceId++;
    }
  });

  edgeMap.forEach((faces) => {
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
      color: new Color(0x000000),
      flatShading: true,
      side: DoubleSide,
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

  const checksum = await computeChecksum({
    vertices: exportVertices,
    triangles: exportTriangles,
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

async function load3dppc(url: string): Promise<Object3D> {
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
  return group;
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

  camera.position.set(distance * offset, distance * 0.9, distance * offset);
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
}

window.addEventListener("resize", resizeRenderer);

function disposeSeams() {
  seamLines.forEach((line) => {
    line.removeFromParent();
    (line.geometry as LineSegmentsGeometry).dispose();
    (line.material as LineMaterial).dispose();
    if (line.userData.edgesGeometry) {
      (line.userData.edgesGeometry as EdgesGeometry).dispose();
    }
  });
  seamLines = [];
}

function rebuildSeams() {
  disposeSeams();
  if (!seamsVisible || !currentModel) {
    console.log("[seams] skipped", { seamsVisible, hasModel: !!currentModel });
    return;
  }

  console.log("[seams] rebuild start");
  const meshes: Mesh[] = [];
  currentModel.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      meshes.push(mesh);
      console.log("[seams] found mesh")
    }
  });

  let linesCount = 0;
  meshes.forEach((mesh) => {
    const seams = new EdgesGeometry(mesh.geometry);
    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.fromEdgesGeometry(seams);
    const lineMaterial = new LineMaterial({
      color: 0x000000,
      linewidth: 5, // 相对于场景尺度的线宽，LineSegments2 支持粗线
      resolution: new Vector2(viewer.clientWidth, viewer.clientHeight),
    });
    const line = new LineSegments2(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.userData.edgesGeometry = seams;
    line.userData.functional = "seam";
    line.renderOrder = 1;
    mesh.add(line);
    seamLines.push(line);
    linesCount += 1;
  });
  updateSeamResolution();
  console.log("[seams] rebuild done", { meshCount: meshes.length, linesCount, edgesVisible });
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
    line.visible = seamsVisible;
  });
}

function updateSeamResolution() {
  const { clientWidth, clientHeight } = viewer;
  seamLines.forEach((line) => {
    const material = line.material as LineMaterial;
    material.resolution.set(clientWidth, clientHeight);
  });
}

async function loadModel(file: File, ext: string) {
  const url = URL.createObjectURL(file);
  placeholder.classList.add("hidden");
  setStatus("加载中...", "info");

  try {
    let object: Object3D;
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
      object = await load3dppc(url);
    }

    clearModel();
    currentModel = object;
    lastFileName = file.name;
    generateFunctionalMaterials(currentModel);
    buildFaceColorMap(currentModel);
    applyFaceVisibility();
    modelGroup.add(currentModel);
    lastTriangleCount = countTrianglesInObject(currentModel);
    rebuildSeams();
    fitCameraToObject(currentModel);
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
  lightToggle.classList.toggle("active", enabled);
  lightToggle.textContent = `主光源：${enabled ? "开" : "关"}`;
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
  seamsToggle.textContent = `接缝：${seamsVisible ? "开" : "关"}`;
  if (seamsVisible && !seamLines.length) rebuildSeams();
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

// Hover highlight
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

  clearHover();

  if (!intersects.length) return;
  const hit = intersects[0];
  const mesh = hit.object as Mesh;
  const faceIndex = hit.faceIndex ?? -1;
  const faceId = getFaceIdFromIntersection(mesh, faceIndex);
  if (faceId === null) return;
  const geometry = mesh.geometry;
  const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
  if (faceIndex < 0 || !colorsAttr) return;

  const indices = getFaceVertexIndices(geometry, faceIndex);
  const original: number[] = [];
  indices.forEach((idx) => {
    original.push(colorsAttr.array[idx * 3], colorsAttr.array[idx * 3 + 1], colorsAttr.array[idx * 3 + 2]);
  });

  const baseColor = new Color().fromArray(colorsAttr.array as Float32Array, indices[0] * 3);
  const highlight = baseColor.clone();
  highlight.r = Math.min(1, highlight.r * HIGHLIGHT_SCALE);
  highlight.g = Math.min(1, highlight.g * HIGHLIGHT_SCALE);
  highlight.b = Math.min(1, highlight.b * HIGHLIGHT_SCALE);
  setFaceColor(mesh, faceIndex, highlight);
  hovered = { mesh, indices, original, faceId };
});

renderer.domElement.addEventListener("pointerleave", () => {
  clearHover();
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!currentModel || editGroupId === null) return;
  const faceId = pickFace(event);
  if (faceId === null) return;
  if (event.button === 0) {
    handleAddFace(faceId);
  } else if (event.button === 2) {
    handleRemoveFace(faceId);
  }
});

renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (!currentModel) return;
  if (event.key === "Escape") {
    setEditGroup(null);
    return;
  }
  const num = Number(event.key);
  if (!Number.isInteger(num) || num <= 0) return;
  if (groupFaces.has(num)) {
    setEditGroup(num);
  }
});
