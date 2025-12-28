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
  const scene = new Scene();
  scene.background = new Color("#a8b4c0");

  const camera = new PerspectiveCamera(50, viewer.clientWidth / viewer.clientHeight, 0.1, 5000);
  camera.up.set(0, 0, 1);
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

  return { scene, camera, renderer, controls, ambient, dir, modelGroup };
}
