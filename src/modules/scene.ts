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
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type SceneContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  ambient: AmbientLight;
  dir: DirectionalLight;
  modelGroup: Group;
};

export function createScene(viewer: HTMLDivElement): SceneContext {
  const width = Math.max(1, viewer.clientWidth || viewer.offsetWidth || 0);
  const height = Math.max(1, viewer.clientHeight || viewer.offsetHeight || 0);
  const scene = new Scene();
  scene.background = new Color("#a8b4c0");

  const camera = new PerspectiveCamera(50, width / height, 0.1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(4, 3, 6);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
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

  return { scene, camera, renderer, controls, ambient, dir, modelGroup };
}

export type Scene2DContext = {
  scene: Scene;
  camera: OrthographicCamera;
  renderer: WebGLRenderer;
};

// 创建 2D 正交场景，用于展开预览
export function createScene2D(
  viewer: HTMLElement,
  options?: { clearColor?: string | number; alpha?: boolean },
): Scene2DContext {
  const width = Math.max(1, viewer.clientWidth || viewer.offsetWidth || 1);
  const height = Math.max(1, viewer.clientHeight || viewer.offsetHeight || 1);
  const halfW = width / 2;
  const halfH = height / 2;

  const scene = new Scene();
  const clearColor = options?.clearColor ?? "#ff0000";
  scene.background = new Color(clearColor as any);

  const camera = new OrthographicCamera(-halfW, halfW, halfH, -halfH, -1000, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({ antialias: true, alpha: options?.alpha ?? false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(clearColor, 1);
  renderer.toneMapping = NoToneMapping;
  // @ts-expect-error three typings may differ by version
  renderer.outputColorSpace = SRGBColorSpace;
  const canvasStyle = renderer.domElement.style;
  canvasStyle.position = "absolute";
  canvasStyle.inset = "0";
  canvasStyle.display = "block";
  canvasStyle.zIndex = "0";
  canvasStyle.backgroundColor = typeof clearColor === "string" ? (clearColor as string) : `#${Number(clearColor).toString(16)}`;
  viewer.appendChild(renderer.domElement);

  return { scene, camera, renderer };
}
