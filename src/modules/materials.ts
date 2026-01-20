// 材质工厂：提供前/背面、线框、hover 等 Three.js 材质实例生成，集中管理颜色与透明度。
import { BackSide, Color, FrontSide, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { Vector2 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export const FACE_DEFAULT_COLOR = new Color(0xffffff);
const BACK_DEFAULT_COLOR = new Color(0xa77f7d);
const EDGE_DEFAULT_COLOR = new Color(0x774400);

export function createFrontMaterial(baseColor?: Color) {
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

export function createBackMaterial() {
  return new MeshStandardMaterial({
    color: BACK_DEFAULT_COLOR.clone(),
    metalness: 0.05,
    roughness: 0.7,
    flatShading: true,
    side: BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
}

export function createEdgeMaterial() {
  return new MeshBasicMaterial({
    color: EDGE_DEFAULT_COLOR.clone(),
    // flatShading: true,
    wireframe: true,
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
    color: 0xffa500,
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
    color: 0x000000,
    linewidth: 4,
    resolution,
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
    color: 0x00ff88,
    linewidth: 2,
    resolution: new Vector2(resolution.width, resolution.height),
  });
}
