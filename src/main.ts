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
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

const VERSION = "1.0.0.21";
const FORMAT_VERSION = "1.0";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("未找到应用容器 #app");
}

app.innerHTML = `
  <main class="card">
    <header>
      <h1>3D Printed Paper Craft</h1>
      <p>
        将低多边形 3D 模型展开为可打印纸艺平面的工具。
        当前支持上传 OBJ / FBX / STL，并提供基础预览能力。
      </p>
    </header>
    <div class="controls">
      <label class="upload">
        <span>上传模型</span>
        <span class="formats">支持 OBJ / FBX / STL / 3dppc</span>
        <input id="file-input" type="file" accept=".obj,.fbx,.stl,.3dppc,application/json" />
      </label>
      <div class="formats">选择文件后将在下方 3D 视图中预览</div>
    </div>
    <div class="toolbar">
      <button class="btn active" id="light-toggle">主光源：开</button>
      <button class="btn" id="edges-toggle">可见边：关</button>
      <button class="btn" id="export-btn" disabled>导出 .3dppc</button>
    </div>
    <div class="viewer" id="viewer">
      <div class="placeholder" id="placeholder">选择模型以预览</div>
    </div>
    <div class="status" id="status">尚未加载模型</div>
  </main>
  <div class="version-tag">v${VERSION}</div>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const placeholder = document.querySelector<HTMLDivElement>("#placeholder");
const statusEl = document.querySelector<HTMLDivElement>("#status");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const lightToggle = document.querySelector<HTMLButtonElement>("#light-toggle");
const edgesToggle = document.querySelector<HTMLButtonElement>("#edges-toggle");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");

if (
  !viewer ||
  !placeholder ||
  !statusEl ||
  !fileInput ||
  !lightToggle ||
  !edgesToggle ||
  !exportBtn
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
let edgesVisible = true;
let currentModel: Object3D | null = null;
let edgeLines: LineSegments2[] = [];
let lastFileName = "model";
let lastTriangleCount = 0;

edgesToggle.classList.toggle("active", edgesVisible);
edgesToggle.textContent = `可见边：${edgesVisible ? "开" : "关"}`;

function setStatus(message: string, tone: "info" | "error" | "success" = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${tone === "info" ? "" : tone}`;
}

function clearModel() {
  modelGroup.clear();
  disposeEdges();
  currentModel = null;
  exportBtn.disabled = true;
  lastTriangleCount = 0;
  setStatus("尚未加载模型");
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

  const triVerticesMap = new Map<number, number[]>();
  triangles.forEach((tri, idx) => {
    tri.forEach((v) => {
      const list = triVerticesMap.get(v) ?? [];
      list.push(idx);
      triVerticesMap.set(v, list);
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

      [a, b, c].forEach((v) => {
        (triVerticesMap.get(v) ?? []).forEach((n) => {
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

function countTrianglesInObject(object: Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
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

  const material = new MeshStandardMaterial({
    color: 0x9ad6ff,
    metalness: 0.05,
    roughness: 0.7,
    flatShading: true,
  });
  const mesh = new Mesh(geometry, material);
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
  updateEdgeResolution();
}

window.addEventListener("resize", resizeRenderer);

function disposeEdges() {
  edgeLines.forEach((line) => {
    line.removeFromParent();
    (line.geometry as LineSegmentsGeometry).dispose();
    (line.material as LineMaterial).dispose();
    if (line.userData.edgesGeometry) {
      (line.userData.edgesGeometry as EdgesGeometry).dispose();
    }
  });
  edgeLines = [];
}

function rebuildEdges() {
  disposeEdges();
  if (!edgesVisible || !currentModel) {
    console.log("[edges] skipped", { edgesVisible, hasModel: !!currentModel });
    return;
  }

  console.log("[edges] rebuild start");
  const meshes: Mesh[] = [];
  currentModel.traverse((child) => {
    if ((child as Mesh).isMesh) {
      meshes.push(child as Mesh);
    }
  });

  let linesCount = 0;
  meshes.forEach((mesh) => {
    const edges = new EdgesGeometry(mesh.geometry);
    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.fromEdgesGeometry(edges);
    const lineMaterial = new LineMaterial({
      color: 0x000000,
      linewidth: 5, // 相对于场景尺度的线宽，LineSegments2 支持粗线
      resolution: new Vector2(viewer.clientWidth, viewer.clientHeight),
    });
    const line = new LineSegments2(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.userData.edgesGeometry = edges;
    line.renderOrder = 1;
    mesh.add(line);
    edgeLines.push(line);
    linesCount += 1;
  });
  updateEdgeResolution();
  console.log("[edges] rebuild done", { meshCount: meshes.length, linesCount, edgesVisible });
}

function updateEdgeResolution() {
  const { clientWidth, clientHeight } = viewer;
  edgeLines.forEach((line) => {
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
      object = await objLoader.loadAsync(url);
    } else if (ext === "fbx") {
      object = await fbxLoader.loadAsync(url);
    } else if (ext === "stl") {
      const geometry = await stlLoader.loadAsync(url);
      const material = new MeshStandardMaterial({
        color: 0x7dd3fc,
        metalness: 0.1,
        roughness: 0.65,
      });
      object = new Mesh(geometry, material);
    } else {
      object = await load3dppc(url);
    }

    clearModel();
    currentModel = object;
    lastFileName = file.name;
    modelGroup.add(currentModel);
    lastTriangleCount = countTrianglesInObject(currentModel);
    rebuildEdges();
    fitCameraToObject(currentModel);
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
  edgesToggle.textContent = `可见边：${edgesVisible ? "开" : "关"}`;
  rebuildEdges();
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
}

resizeRenderer();
animate();
