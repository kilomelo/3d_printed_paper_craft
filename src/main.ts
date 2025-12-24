import "./style.css";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

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
        <span class="formats">支持 OBJ / FBX / STL</span>
        <input id="file-input" type="file" accept=".obj,.fbx,.stl" />
      </label>
      <div class="formats">选择文件后将在下方 3D 视图中预览</div>
    </div>
    <div class="viewer" id="viewer">
      <div class="placeholder" id="placeholder">选择模型以预览</div>
    </div>
    <div class="status" id="status">尚未加载模型</div>
  </main>
`;

const viewer = document.querySelector<HTMLDivElement>("#viewer");
const placeholder = document.querySelector<HTMLDivElement>("#placeholder");
const statusEl = document.querySelector<HTMLDivElement>("#status");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");

if (!viewer || !placeholder || !statusEl || !fileInput) {
  throw new Error("初始化界面失败，缺少必要的元素");
}

const scene = new Scene();
scene.background = new Color("#0b1224");

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
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
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

const allowedExtensions = ["obj", "fbx", "stl"];

function setStatus(message: string, tone: "info" | "error" | "success" = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${tone === "info" ? "" : tone}`;
}

function clearModel() {
  modelGroup.clear();
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
}

window.addEventListener("resize", resizeRenderer);

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
    } else {
      const geometry = await stlLoader.loadAsync(url);
      const material = new MeshStandardMaterial({
        color: 0x7dd3fc,
        metalness: 0.1,
        roughness: 0.65,
      });
      object = new Mesh(geometry, material);
    }

    clearModel();
    modelGroup.add(object);
    fitCameraToObject(object);
    setStatus(`已加载：${file.name}`, "success");
  } catch (error) {
    console.error("加载模型失败", error);
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

resizeRenderer();
animate();
