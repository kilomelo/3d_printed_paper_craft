// 场景工厂：创建 Three.js 场景、相机、光照、渲染器及承载模型的容器。
import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  NoToneMapping,
  SRGBColorSpace,
  Color,
  OrthographicCamera,
  Object3D,
  Vector3,
  Box3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const clearColor = new Color("#808592");
const AmbientLightIntensity = 0.8;
const DirectionalLightIntensity = 1;

export type SceneContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  ambient: AmbientLight;
  dir: DirectionalLight;
  modelGroup: Group;
  previewModelGroup: Group;
};

export function createScene(width: number, height: number): SceneContext {
  console.log("createScene with size:", width, height);
  const scene = new Scene();
  scene.background = clearColor.clone();

  const camera = new PerspectiveCamera(50, width / height, 0.1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(4, 3, 6);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);

  const ambient = new AmbientLight(0xffffff, AmbientLightIntensity);
  const dir = new DirectionalLight(0xffffff, DirectionalLightIntensity);
  dir.position.set(4, -6, 8);
  scene.add(ambient, dir);

  const modelGroup = new Group();
  const previewModelGroup = new Group();
  scene.add(modelGroup, previewModelGroup);

  return { scene, camera, renderer, controls, ambient, dir, modelGroup, previewModelGroup };
}

export type Scene2DContext = {
  scene: Scene;
  camera: OrthographicCamera;
  renderer: WebGLRenderer;
};

// 创建 2D 正交场景，用于展开预览
export function createScene2D(width: number, height: number): Scene2DContext {
  console.log("createScene2D with size:", width, height);
  const halfW = width / 2;
  const halfH = height / 2;

  const scene = new Scene();
  scene.background = clearColor.clone();

  const camera = new OrthographicCamera(-halfW, halfW, halfH, -halfH, -1000, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  const canvasStyle = renderer.domElement.style;
  canvasStyle.position = "absolute";
  canvasStyle.inset = "0";
  canvasStyle.display = "block";
  canvasStyle.zIndex = "0";
  canvasStyle.backgroundColor = typeof clearColor === "string" ? (clearColor as string) : `#${Number(clearColor).toString(16)}`;
  return { scene, camera, renderer };
}

export function fitCameraToObject(object: Object3D, camera: PerspectiveCamera, controls: any) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = maxDim / (2 * Math.tan(fov / 2));
  const offset = 1.8;
  controls.target.set(center.x, center.y, center.z);
  camera.position.set(-distance * offset * 0.75 + center.x, -distance * offset + center.y, distance * offset * 0.75 + center.z);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.update();
}
