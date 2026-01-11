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
  BufferGeometry,
  BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  CanvasTexture,
  SpriteMaterial,
  Sprite,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const clearColor = new Color("#808592");
const AmbientLightIntensity = 0.8;
const DirectionalLightIntensity = 1;
const rulerColor = 0x00ff88;

export class BBoxRuler {
  group: Group;
  lineX: LineSegments;
  lineY: LineSegments;
  lineXEndA: LineSegments;
  lineXEndB: LineSegments;
  lineYEndA: LineSegments;
  lineYEndB: LineSegments;
  labelX: Sprite;
  labelY: Sprite;

  constructor(scene: Scene) {
    const makeLine = () => {
      const geom = new BufferGeometry();
      const mat = new LineBasicMaterial({ color: rulerColor });
      return new LineSegments(geom, mat);
    };
    const makeLabel = (text: string) => {
      const tex = this.makeLabelTexture(text);
      const mat = new SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
      const sprite = new Sprite(mat);
      sprite.scale.set(1, 1, 1);
      return sprite;
    };
    this.group = new Group();
    this.lineX = makeLine();
    this.lineY = makeLine();
    this.lineXEndA = makeLine();
    this.lineXEndB = makeLine();
    this.lineYEndA = makeLine();
    this.lineYEndB = makeLine();
    this.labelX = makeLabel("");
    this.labelY = makeLabel("");
    this.group.add(
      this.lineX,
      this.lineY,
      this.lineXEndA,
      this.lineXEndB,
      this.lineYEndA,
      this.lineYEndB,
      this.labelX,
      this.labelY,
    );
    this.group.visible = false;
    scene.add(this.group);
  }

  private setLine(line: LineSegments, pts: [number, number, number][]) {
    const arr = new Float32Array(pts.flat());
    line.geometry.dispose();
    line.geometry = new BufferGeometry();
    line.geometry.setAttribute("position", new BufferAttribute(arr, 3));
  }

  private scaleLabel(sprite: Sprite, base: number) {
    const mat = sprite.material as SpriteMaterial;
    const tex = mat.map as CanvasTexture;
    const img = tex.image as HTMLCanvasElement;
    const aspect = img.width / img.height || 1;
    sprite.scale.set(base * aspect, base, 1);
  }

  private makeLabelTexture(text: string): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 32px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    return new CanvasTexture(canvas);
  }

  update(minX: number, maxX: number, minY: number, maxY: number, scale = 1) {
    const width = maxX - minX;
    const height = maxY - minY;
    const margin = Math.max(width, height) * 0.025;
    const len = margin * 0.8;
    const yDimY = minY - margin;
    const xDimX = maxX + margin;
    this.setLine(this.lineX, [
      [minX, yDimY, 0],
      [maxX, yDimY, 0],
    ]);
    this.setLine(this.lineY, [
      [xDimX, maxY, 0],
      [xDimX, minY, 0],
    ]);
    this.setLine(this.lineXEndA, [
      [minX, yDimY - len * 0.5, 0],
      [minX, yDimY + len * 0.5, 0],
    ]);
    this.setLine(this.lineXEndB, [
      [maxX, yDimY - len * 0.5, 0],
      [maxX, yDimY + len * 0.5, 0],
    ]);
    this.setLine(this.lineYEndA, [
      [xDimX - len * 0.5, maxY, 0],
      [xDimX + len * 0.5, maxY, 0],
    ]);
    this.setLine(this.lineYEndB, [
      [xDimX - len * 0.5, minY, 0],
      [xDimX + len * 0.5, minY, 0],
    ]);
    const labelXText = `${Math.round(width * scale)}`;
    const labelYText = `${Math.round(height * scale)}`;
    const refreshLabel = (sprite: Sprite, text: string) => {
      const mat = sprite.material as SpriteMaterial;
      const tex = mat.map as CanvasTexture;
      const newTex = this.makeLabelTexture(text);
      tex.image = newTex.image;
      tex.needsUpdate = true;
    };
    refreshLabel(this.labelX, labelXText);
    refreshLabel(this.labelY, labelYText);
    const labelScale = Math.max(width, height) * 0.1;
    this.scaleLabel(this.labelX, labelScale);
    this.scaleLabel(this.labelY, labelScale);
    this.labelX.position.set((minX + maxX) * 0.5, yDimY, 0);
    this.labelY.position.set(xDimX, (minY + maxY) * 0.5, 0);
    this.labelY.material.rotation = -Math.PI / 2;
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }
}

export type SceneContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  ambient: AmbientLight;
  dir: DirectionalLight;
  modelGroup: Group;
  previewModelGroup: Group;
  gizmosGroup: Group;
};

export function createScene(width: number, height: number): SceneContext {
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
  const gizmosGroup = new Group();
  scene.add(modelGroup, previewModelGroup, gizmosGroup);

  return { scene, camera, renderer, controls, ambient, dir, modelGroup, previewModelGroup, gizmosGroup };
}

export type Scene2DContext = {
  scene: Scene;
  camera: OrthographicCamera;
  renderer: WebGLRenderer;
  bboxRuler: BBoxRuler;
};

// 创建 2D 正交场景，用于展开预览
export function createScene2D(width: number, height: number): Scene2DContext {
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

  const bboxRuler = new BBoxRuler(scene);

  return {
    scene,
    camera,
    renderer,
    bboxRuler,
  };
}

export function fitCameraToObject(object: Object3D, camera: PerspectiveCamera, controls: any) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = maxDim / (2 * Math.tan(fov / 2));
  const offset = 1.5;
  controls.target.set(center.x, center.y, center.z);
  camera.position.set(-distance * offset * 0.75 + center.x, -distance * offset + center.y, distance * offset * 0.75 + center.z);
  camera.near = Math.max(0.01, distance / 500);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.update();
}
