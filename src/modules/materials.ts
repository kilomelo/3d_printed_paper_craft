// 材质工厂：提供前/背面、线框、hover 等 Three.js 材质实例生成，集中管理颜色与透明度。
import { BackSide, Color, FrontSide, MeshStandardMaterial } from "three";

export const FACE_DEFAULT_COLOR = new Color(0xffffff);

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
    color: new Color(0xa77f7d),
    metalness: 0.05,
    roughness: 0.7,
    flatShading: true,
    side: BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function createEdgeMaterial() {
  return new MeshStandardMaterial({
    color: new Color(0x996600),
    flatShading: true,
    wireframe: true,
  });
}