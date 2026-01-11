// 材质工厂：提供前/背面、线框、hover 等 Three.js 材质实例生成，集中管理颜色与透明度。
import { BackSide, Color, FrontSide, MeshBasicMaterial, MeshStandardMaterial } from "three";

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
