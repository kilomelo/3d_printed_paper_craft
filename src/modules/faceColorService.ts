// 面色服务：负责根据组颜色/默认色更新 mesh face 的 vertex colors，提供批量重绘与单面更新。
import { Color, Float32BufferAttribute, Mesh } from "three";
import { FACE_DEFAULT_COLOR } from "./materials";
import { getFaceVertexIndices } from "./model";
import { appEventBus } from "./eventBus";

export type FaceColorDeps = {
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>;
  getFaceGroupMap: () => Map<number, number | null>;
  getGroupColor: (id: number) => THREE.Color | undefined;
  defaultColor?: Color;
};

export type FaceColorService = ReturnType<typeof createFaceColorService>;

export function createFaceColorService(deps: FaceColorDeps) {
  const defaultColor = deps.defaultColor ?? FACE_DEFAULT_COLOR;
  
  appEventBus.on("groupFaceAdded", ({ groupId, faceId }) => {
    updateFaceColorById(faceId, groupId);
  });

  appEventBus.on("groupFaceRemoved", ({ groupId, faceId }) => {
    updateFaceColorById(faceId);
  });

  appEventBus.on("groupColorChanged", ({ groupId }) => {
    deps.getFaceGroupMap().forEach((group, faceId) => {
      if (group === groupId) {
        updateFaceColorById(faceId, groupId);
      }
    });
  })

  appEventBus.on("groupRemoved", ({ groupId, faces }) => {
    faces.forEach((faceId) => {
      updateFaceColorById(faceId);
    });
  });

  appEventBus.on("modelLoaded", () => {
    repaintAllFaces();
  });

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

  function updateFaceColorById(faceId: number, groupId?: number | null) {
    const mapping = deps.getFaceIndexMap().get(faceId);
    if (!mapping) return;
    groupId = groupId??deps.getFaceGroupMap().get(faceId)??null;
    const baseColor = groupId !== null ? deps.getGroupColor(groupId) : defaultColor;
    setFaceColor(mapping.mesh, mapping.localFace, baseColor??defaultColor);
  }

  function repaintAllFaces() {
    deps.getFaceGroupMap().forEach((_, faceId) => updateFaceColorById(faceId));
  }

  return { setFaceColor, updateFaceColorById };
}
