// 面色服务：负责根据组颜色/默认色更新 mesh face 的 vertex colors，提供批量重绘与单面更新。
import { Color, Float32BufferAttribute, Mesh } from "three";
import { FACE_DEFAULT_COLOR } from "./materials";
import { getFaceVertexIndices } from "./model";
import { appEventBus } from "./eventBus";

export type FaceColorDeps = {
  getFaceIndexMap: () => Map<number, { mesh: Mesh; localFace: number }>;
  getFaceGroupMap: () => Map<number, number | null>;
  getGroupColor: (id: number) => THREE.Color | undefined;
  getGroupVisibility: (id: number) => boolean;
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

  appEventBus.on("groupVisibilityChanged", ({ groupId }) => {
    deps.getFaceGroupMap().forEach((gid, faceId) => {
      if (gid === groupId) {
        updateFaceColorById(faceId, gid);
      }
    });
  });

  appEventBus.on("groupBreathStart", (groupId) => {
    deps.getFaceIndexMap().forEach((_, faceId) => {
      const gid = deps.getFaceGroupMap().get(faceId) ?? null;
      updateFaceColorWithForceVisibility( gid === groupId, faceId, gid);
    });
  });

  appEventBus.on("groupBreathEnd", repaintAllFaces);

  appEventBus.on("projectChanged", repaintAllFaces);
  appEventBus.on("historyApplied", repaintAllFaces);

  function setFaceColor(mesh: Mesh, localFaceIdx: number, color: Color, alhpa: number = 1) {
    if (!mesh) return;
    const geometry = mesh.geometry;
    const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
    if (!colorsAttr) return;
    const indices = getFaceVertexIndices(geometry, localFaceIdx);
    indices.forEach((idx) => {
      colorsAttr.setXYZW(idx, color.r, color.g, color.b, alhpa);
    });
    colorsAttr.needsUpdate = true;
  }

  function setFaceAlpha(mesh: Mesh, localFaceIdx: number, alpha: number) {
    if (!mesh) return;
    const geometry = mesh.geometry;
    const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
    if (!colorsAttr) return;
    const indices = getFaceVertexIndices(geometry, localFaceIdx);
    indices.forEach((idx) => {
      colorsAttr.setW(idx, alpha);
    });
    colorsAttr.needsUpdate = true;
  }

  function updateFaceColorById(faceId: number, groupId?: number | null) {
    const mapping = deps.getFaceIndexMap().get(faceId);
    if (!mapping) return;
    groupId = groupId??deps.getFaceGroupMap().get(faceId)??null;
    const baseColor = groupId !== null ? deps.getGroupColor(groupId) : defaultColor;
    const visible = groupId !== null ? deps.getGroupVisibility?.(groupId) ?? true : true;
    const finalColor = (baseColor ?? defaultColor).clone();
    setFaceColor(mapping.mesh, mapping.localFace, finalColor, visible ? 1 : 0);
  }

  function updateFaceColorWithForceVisibility(visible: boolean, faceId: number, groupId: number | null) {
    const mapping = deps.getFaceIndexMap().get(faceId);
    if (!mapping) return;
    groupId = groupId??deps.getFaceGroupMap().get(faceId)??null;
    const baseColor = groupId !== null ? deps.getGroupColor(groupId) : defaultColor;
    const finalColor = (baseColor ?? defaultColor).clone();
    setFaceColor(mapping.mesh, mapping.localFace, finalColor, visible ? 1 : 0);
  }

  function repaintAllFaces() {
    deps.getFaceIndexMap().forEach((_, faceId) => {
      const gid = deps.getFaceGroupMap().get(faceId) ?? null;
      updateFaceColorById(faceId, gid);
    });
  }

  return { setFaceColor, setFaceAlpha,  updateFaceColorById, repaintAllFaces };
}
