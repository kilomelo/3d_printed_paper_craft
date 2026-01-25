// 材质工厂：提供前/背面、线框、hover 等 Three.js 材质实例生成，集中管理颜色与透明度。
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export const FACE_DEFAULT_COLOR = new THREE.Color(0xffffff);
const BACK_DEFAULT_COLOR = new THREE.Color(0x666666);
const SILHOUETTE_COLOR = new THREE.Color(0xffffff);
const EDGE_DEFAULT_COLOR = new THREE.Color(0x442200);
const SEAMEDGE_DEFAULT_COLOR = new THREE.Color(0x222222);
const HOVERLINE_DEFAULT_COLOR = new THREE.Color(0xffa500);
const SEAM_CONNECT_LINE_COLOR = new THREE.Color(0x00ff88);

export function createFrontMaterial(baseColor?: THREE.Color) {
  return new THREE.MeshStandardMaterial({
    color: baseColor ?? FACE_DEFAULT_COLOR.clone(),
    metalness: 0.02,
    roughness: 0.7,
    flatShading: true,
    transparent: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    vertexColors: true,
  });
}

export function createBackMaterial() {
  return new THREE.MeshStandardMaterial({
    color: BACK_DEFAULT_COLOR.clone(),
    metalness: 0,
    roughness: 0.7,
    flatShading: true,
    vertexColors: true,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
}

export function createDepthMaterial() {
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.BasicDepthPacking,
  });
  depthMat.depthWrite = true;
  depthMat.depthTest = true;
  depthMat.colorWrite = false;          // 关键：不输出颜色
  depthMat.side = THREE.DoubleSide;     // 关键：平面无论翻转都能写深度
  depthMat.transparent = false;
  return depthMat;
}

export function createSilhouetteMaterial() {
  return new THREE.MeshBasicMaterial({
    color: SILHOUETTE_COLOR.clone(),
    depthWrite: false,
    depthTest: true,
    transparent: true,
    forceSinglePass: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
  });
}

export function createEdgeMaterial() {
  return new THREE.MeshBasicMaterial({
    color: EDGE_DEFAULT_COLOR.clone(),
    depthWrite: false,
    depthTest: true,
    wireframe: true,
    vertexColors: true,
  });
}

export function createUnfoldFaceMaterial(baseColor?: THREE.Color) {
  return new THREE.MeshBasicMaterial({
    color: baseColor ?? FACE_DEFAULT_COLOR.clone(),
    vertexColors: true,
  });
}

export function createUnfoldEdgeMaterial(baseColor?: THREE.Color) {
  return createEdgeMaterial();
}

export function createPreviewMaterial() {
  return new THREE.MeshStandardMaterial({
    color: FACE_DEFAULT_COLOR.clone(),
    metalness: 0.05,
    roughness: 0.7,
    side: THREE.FrontSide,
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
    resolution: new THREE.Vector2(resolution.width, resolution.height),
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
    linewidth: 3,
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
  return new LineMaterial({
        color: SEAM_CONNECT_LINE_COLOR.getHex(),
        linewidth: 2,
        dashed: true,
        dashSize: 0.1,
        gapSize: 0.1,
        dashScale: 1,
        dashOffset: 0,
        transparent: true,
        opacity: 0.8,
        resolution: new THREE.Vector2(resolution.width, resolution.height),
      });
}

export function createUnfoldEdgeLineFoldinMaterial(resolution: { width: number; height: number }) {
  return new LineMaterial({
        color: SEAMEDGE_DEFAULT_COLOR.getHex(),
        linewidth: 1.5,
        dashed: true,
        dashSize: 0.3,
        gapSize: 0.1,
        dashScale: 1,
        dashOffset: 0,
        resolution: new THREE.Vector2(resolution.width, resolution.height),
      });
}

export function createUnfoldEdgeLineFoldoutMaterial(resolution: { width: number; height: number }) {
  return new LineMaterial({
        color: SEAMEDGE_DEFAULT_COLOR.getHex(),
        linewidth: 1.5,
        resolution: new THREE.Vector2(resolution.width, resolution.height),
      });
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

function makeCheckerMaskTexture(size = 256, cells = 8) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const cell = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const on = (x + y) % 2 === 0;
      ctx.fillStyle = on ? "#ffffff" : "#000000"; // white=1 black=0
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // 作为 mask，不要用 sRGB（保持默认 NoColorSpace 更合适）:contentReference[oaicite:1]{index=1}
  tex.needsUpdate = true;
  return tex;
}

/**
 * 可平铺的斑马线 mask（白=1，黑=0）。
 * - 纹理内容始终是竖向条纹（可平铺）
 * - 通过 texture.rotation 在 UV 空间旋转，从而在 repeat 时仍然对齐
 *
 * @param size   纹理尺寸（正方形）
 * @param stripes 条纹周期数（一个周期=白+黑）
 * @param options
 *  - angleRad: 纹理旋转角度（0=竖条纹，Math.PI/2=横条纹，Math.PI/4=45°）
 *  - duty: 白色占比（0~1），0.5 表示白/黑等宽
 *  - invert: 反转黑白
 */
export function makeZebraMaskTextureTileable(
  size = 256,
  stripes = 16,
  options?: { angleRad?: number; duty?: number; invert?: boolean }
) {
  const angleRad = options?.angleRad ?? 0;
  const duty = options?.duty ?? 0.5;
  const invert = options?.invert ?? false;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  // 竖向条纹：x 方向周期
  const period = size / stripes;           // 白+黑的周期宽度（像素）
  const whiteW = period * duty;
  const blackW = period - whiteW;

  const white = invert ? "#000000" : "#ffffff";
  const black = invert ? "#ffffff" : "#000000";

  for (let x = 0; x < size + 0.0001; x += period) {
    ctx.fillStyle = white;
    ctx.fillRect(x, 0, whiteW, size);

    ctx.fillStyle = black;
    ctx.fillRect(x + whiteW, 0, blackW, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

  // 关键：通过 UV 变换旋转纹理，而不是旋转画布内容
  tex.center.set(0.5, 0.5);
  tex.rotation = angleRad;

  // 如果你自己手动管理 matrix，可打开下面两行：
  // tex.matrixAutoUpdate = false;
  // tex.updateMatrix();

  tex.needsUpdate = true;
  return tex;
}


export function createWarnningMaterial(cellsInTexture = 8, angleRed = 0, duty = 0.5) {
  // const tex = makeCheckerMaskTexture(256, cellsInTexture);
  const tex = makeZebraMaskTextureTileable(256, cellsInTexture, { angleRad: angleRed, duty: duty });

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,        // 必须白色，否则“反色”不是基于纯顶点色
    map: tex,               // 用作 mask
    vertexColors: true,     // 需要 RGBA 顶点色
    transparent: true,      // 顶点 alpha 生效
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  mat.onBeforeCompile = (shader) => {
    // 1) 把 map_fragment 改成只采样 mask，不乘到 diffuseColor 上
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      float checkerMask = 0.0;
      #ifdef USE_MAP
        vec4 maskSample = texture2D( map, vMapUv );
        checkerMask = maskSample.r; // 0..1（黑白）
      #endif
      `
    );

    // 2) 在 color_fragment 后，用 checkerMask 在 vColor 与 1-vColor 间切换
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>

      #ifdef USE_COLOR
        vec3 vc = vColor.rgb;
      #else
        vec3 vc = vec3(1.0);
      #endif

      vec3 inv = vec3(1.0) - vc;
      vec3 mixed = mix(vc, inv, checkerMask);

      // diffuse 是 material.color（这里设为白色）
      diffuseColor.rgb = diffuse * mixed;
      `
    );
  };

  mat.needsUpdate = true;
  return mat;
}

export function createScreenCheckerMaterial(
  renderer: THREE.WebGLRenderer,
  cellCssPx = 20,
  originCssPx: [number, number] = [0, 0],
) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,   // 需要你的 color=vec4（含 alpha）
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });

  // uniforms：把 gl_FragCoord(以buffer像素)换算成CSS像素
  const uInvDpr = { value: 1 / renderer.getPixelRatio() };
  const uCell = { value: cellCssPx };
  const uOrigin = { value: new THREE.Vector2(originCssPx[0], originCssPx[1]) };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInvDpr = uInvDpr;
    shader.uniforms.uCell = uCell;
    shader.uniforms.uOrigin = uOrigin;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
uniform float uInvDpr;
uniform float uCell;
uniform vec2 uOrigin;`
    );

    // 在 color_fragment 之后改 RGB（保留 alpha）
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>

vec2 pCss = gl_FragCoord.xy * uInvDpr;        // 转为 CSS 像素
vec2 g = floor((pCss - uOrigin) / uCell);
float m = mod(g.x + g.y, 2.0);               // 0/1 棋盘格

#ifdef USE_COLOR
  vec3 base = vColor.rgb;
  vec3 inv  = vec3(1.0) - base;
  diffuseColor.rgb = diffuse * mix(base, inv, m);
#endif
`
    );
  };

  // 当 DPR 变化时更新（可选）
  (mat as any).__updateDpr = () => { uInvDpr.value = 1 / renderer.getPixelRatio(); };
  return mat;
}

export function ensurePlanarUVWorldScale(
  geometry: THREE.BufferGeometry,
  cellSize: number,
  axes: "xy" | "xz" | "yz" = "xy",
  origin?: THREE.Vector3
) {
  if (geometry.getAttribute("uv")) return;

  if (!origin) {
    geometry.computeBoundingBox();
    origin = geometry.boundingBox!.min.clone(); // 用 bbox.min 做对齐原点（也可以用 [0,0,0]）
  }

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - origin.x;
    const y = pos.getY(i) - origin.y;
    const z = pos.getZ(i) - origin.z;

    let u = 0, v = 0;
    if (axes === "xy") { u = x / cellSize; v = y / cellSize; }
    else if (axes === "xz") { u = x / cellSize; v = z / cellSize; }
    else { u = y / cellSize; v = z / cellSize; }

    uv[i * 2 + 0] = u;
    uv[i * 2 + 1] = v;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * 基于屏幕空间（像素）生成 UV：
 *  - 把每个顶点投影到屏幕像素坐标 (sx, sy)
 *  - uv = (sx / cellPx, sy / cellPx)
 *
 * 适合：正交相机渲染近似平面几何；想让格子始终保持固定像素大小
 *
 * 注意：相机/物体/viewport 变化后，需要重新调用该函数更新 UV。
 */
export function ensurePlanarUVScreenSpaceCSS(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  cellCssPx: number,
  opts?: { force?: boolean; originPx?: [number, number] }
) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const force = opts?.force ?? true;
  if (!force && geometry.getAttribute("uv")) return;

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const viewport = new THREE.Vector2();
  renderer.getSize(viewport); // CSS pixels

  const [ox, oy] = opts?.originPx ?? [0, 0];

  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();

  // 确保 matrixWorld 最新
  mesh.updateMatrixWorld(true);

  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
      .applyMatrix4(mesh.matrixWorld)
      .project(camera);

    const sx = (v.x * 0.5 + 0.5) * viewport.x;
    const sy = (-v.y * 0.5 + 0.5) * viewport.y;

    uv[i * 2 + 0] = (sx - ox) / cellCssPx;
    uv[i * 2 + 1] = (sy - oy) / cellCssPx;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}