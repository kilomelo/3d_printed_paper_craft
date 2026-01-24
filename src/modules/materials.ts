// 材质工厂：提供前/背面、线框、hover 等 Three.js 材质实例生成，集中管理颜色与透明度。
import { Color, Vector2,
  BackSide, DoubleSide, FrontSide, 
  LessDepth, LessEqualDepth, GreaterEqualDepth, EqualDepth, BasicDepthPacking,
  MeshBasicMaterial, MeshStandardMaterial, MeshDepthMaterial } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export const FACE_DEFAULT_COLOR = new Color(0xffffff);
const BACK_DEFAULT_COLOR = new Color(0x666666);
const SILHOUETTE_COLOR = new Color(0xffffff);
const EDGE_DEFAULT_COLOR = new Color(0x442200);
const SEAMEDGE_DEFAULT_COLOR = new Color(0x222222);
const HOVERLINE_DEFAULT_COLOR = new Color(0xffa500);
const SEAM_CONNECT_LINE_COLOR = new Color(0x00ff88);

export function createFrontMaterial(baseColor?: Color) {
  return new MeshStandardMaterial({
    color: baseColor ?? FACE_DEFAULT_COLOR.clone(),
    metalness: 0.02,
    roughness: 0.7,
    flatShading: true,
    transparent: true,
    side: FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    vertexColors: true,
  });
}

export function createBackMaterial() {
  return new MeshStandardMaterial({
    color: BACK_DEFAULT_COLOR.clone(),
    metalness: 0,
    roughness: 0.7,
    flatShading: true,
    vertexColors: true,
    side: BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
}

export function createDepthMaterial() {
  const depthMat = new MeshDepthMaterial({
    depthPacking: BasicDepthPacking,
  });
  depthMat.depthWrite = true;
  depthMat.depthTest = true;
  depthMat.colorWrite = false;          // 关键：不输出颜色
  depthMat.side = DoubleSide;     // 关键：平面无论翻转都能写深度
  depthMat.transparent = false;
  return depthMat;
}

export function createSilhouetteMaterial() {
  return new MeshBasicMaterial({
    color: SILHOUETTE_COLOR.clone(),
    depthWrite: false,
    depthTest: true,
    transparent: true,
    forceSinglePass: true,
    opacity: 0.1,
    side: DoubleSide,
  });
}

export function createEdgeMaterial() {
  return new MeshBasicMaterial({
    color: EDGE_DEFAULT_COLOR.clone(),
    depthWrite: false,
    depthTest: true,
    wireframe: true,
    vertexColors: true,
  });
}

export function createUnfoldFaceMaterial(baseColor?: Color) {
  return new MeshBasicMaterial({
    color: baseColor ?? FACE_DEFAULT_COLOR.clone(),
    vertexColors: true,
  });
}

export function createUnfoldEdgeMaterial(baseColor?: Color) {
  return createEdgeMaterial();
}

export function createPreviewMaterial() {
  return new MeshStandardMaterial({
    color: FACE_DEFAULT_COLOR.clone(),
    metalness: 0.05,
    roughness: 0.7,
    side: FrontSide,
  });
}

// 通用线材质工厂（用于 hover/拼缝/特殊边）
export function createLineMaterial(options: {
  color: number;
  linewidth: number;
  resolution: { width: number; height: number };
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
}) {
  const {
    color,
    linewidth,
    resolution,
    polygonOffset = false,
    polygonOffsetFactor = 0,
    polygonOffsetUnits = 0,
  } = options;
  return new LineMaterial({
    color,
    linewidth,
    resolution: new Vector2(resolution.width, resolution.height),
    polygonOffset,
    polygonOffsetFactor,
    polygonOffsetUnits,
  });
}

// Hover 线材质（与 3D hover 使用一致）
export function createHoverLineMaterial(resolution: { width: number; height: number }) {
  return createLineMaterial({
    color: HOVERLINE_DEFAULT_COLOR.getHex(),
    linewidth: 4,
    resolution,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -3,
  });
}

// 拼缝线材质
export function createSeamLineMaterial(resolution: { width: number; height: number }) {
  return createLineMaterial({
    color: SEAMEDGE_DEFAULT_COLOR.getHex(),
    linewidth: 4,
    resolution,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}

// 特殊边材质
export function createSpecialEdgeMaterial(options: {
  color: number;
  linewidth: number;
  resolution: { width: number; height: number };
  offsetUnits: number;
}) {
  const { color, linewidth, resolution, offsetUnits } = options;
  return createLineMaterial({
    color,
    linewidth,
    resolution,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: offsetUnits,
  });
}

// 2D 视图显示拼接边拼接关系的线的材质
export function createSeamConnectLineMaterial(resolution: { width: number; height: number }) {
  const mat = new LineMaterial({
        color: SEAM_CONNECT_LINE_COLOR.getHex(),
        linewidth: 2,
        dashed: true,
        dashSize: 0.2,
        gapSize: 0.1,
        dashScale: 1,
        dashOffset: 0,
        transparent: true,
        opacity: 0.8,
        // resolution: new Vector2(resolution.width, resolution.height),
      });
  mat.resolution.set(resolution.width, resolution.height);
  return mat;
}


// 两遍渲染（最接近你想要的正确效果，工程上最常用）
// 把同一几何绘制两次：
// Pass A（不透明 pass）：只画 alpha≈1 的片元；transparent=false，depthWrite=true
// Pass B（半透明 pass）：只画 0<alpha<1 的片元；transparent=true，depthWrite=false（否则透明仍会挡住后面的片元）
// 这样同一 mesh 内部至少能做到：先把不透明部分写入深度，再叠加半透明部分。
export function patchOpaquePass(mat: THREE.Material) {
  mat.transparent = false;
  (mat as any).depthWrite = true;

  mat.onBeforeCompile = (shader) => {
    const snippet = `
      // vertex alpha in vColor.a (color attribute itemSize=4)
      if (diffuseColor.a < 0.999) discard;
    `;

    // 1) 优先：在 <color_fragment> 之后插入（Standard/Phong/Lambert 常见）
    if (shader.fragmentShader.includes("#include <color_fragment>")) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${snippet}`
      );
      return;
    }

    // 2) 兜底：在 gl_FragColor 输出前插入（Basic 也常见）
    // 需要注意：不同版本可能是 gl_FragColor = ... 或 gl_FragColor.xyz = ...
    // 我们找最常见的那句
    if (shader.fragmentShader.includes("gl_FragColor")) {
      shader.fragmentShader = shader.fragmentShader.replace(
        /gl_FragColor\s*=\s*/g,
        `${snippet}\n  gl_FragColor = `
      );
      return;
    }

    // 3) 再兜底：直接在 main() 开头插入（极端情况）
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `void main() {\n${snippet}\n`
    );
  };

  mat.needsUpdate = true;
}

export function patchTranslucentPass(mat: THREE.MeshStandardMaterial) {
  mat.transparent = true;
  mat.depthWrite = false; // 关键：避免透明写深度挡后面 :contentReference[oaicite:2]{index=2}
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       if (diffuseColor.a >= 0.999) discard;`
    );
  };
  mat.needsUpdate = true;
}