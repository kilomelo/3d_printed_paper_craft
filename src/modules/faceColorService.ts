// 面色服务：负责根据组颜色/默认色更新 mesh face 的 vertex colors，提供批量重绘与单面更新。
import { Color, Float32BufferAttribute, Mesh } from "three";
import { FACE_DEFAULT_COLOR } from "./materials";
import { getFaceVertexIndices } from "./modelLoader";

export type FaceColorDeps = {
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>;
  getFaceGroupMap: () => Map<number, number | null>;
  getGroupColor: (groupId: number) => Color;
  defaultColor?: Color;
};

export type FaceColorService = ReturnType<typeof createFaceColorService>;

export function createFaceColorService(deps: FaceColorDeps) {
  const defaultColor = deps.defaultColor ?? FACE_DEFAULT_COLOR;

  function setFaceColor(mesh: Mesh, faceIndex: number, color: Color) {
    const geometry = mesh.geometry;
    const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
    if (!colorsAttr) return;
    const indices = getFaceVertexIndices(geometry, faceIndex);
    indices.forEach((idx) => {
      color.toArray(colorsAttr.array as Float32Array, idx * 3);
    });
    colorsAttr.needsUpdate = true;
  }

  function updateFaceColorById(faceId: number) {
    const mapping = deps.getFaceIndexMap().get(faceId);
    if (!mapping) return;
    const groupId = deps.getFaceGroupMap().get(faceId) ?? null;
    const baseColor = groupId !== null ? deps.getGroupColor(groupId) : defaultColor;
    setFaceColor(mapping.mesh, mapping.localFace, baseColor);
  }

  function repaintAllFaces() {
    deps.getFaceGroupMap().forEach((_, faceId) => updateFaceColorById(faceId));
  }

  return { setFaceColor, updateFaceColorById, repaintAllFaces };
}