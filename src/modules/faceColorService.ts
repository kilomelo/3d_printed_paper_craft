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
  isTextureEnabled?: () => boolean;
  getWorkspaceState?: () => string;
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
    deps.getFaceIndexMap().forEach((mapping, faceId) => {
      const gid = deps.getFaceGroupMap().get(faceId) ?? null;
      const isHoveredGroup = gid === groupId;
      const color = getEffectiveColor(gid);
      const alpha = isHoveredGroup ? 1 : 0;
      setFaceColor(mapping.mesh, mapping.localFace, color, alpha);
    });
  });

  appEventBus.on("groupBreathEnd", () => {
      repaintAllFaces();
  });

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

  // 获取有效的默认颜色：根据工作状态调整 HSL
  function getEffectiveDefaultColor(): Color {
    const baseColor = new Color(1, 1, 1); // 白色
    return applySeamFading(baseColor);
  }

  // 根据 editingSeam 状态调整颜色 HSL
  function applySeamFading(color: Color): Color {
    const workspaceState = deps.getWorkspaceState?.() ?? "normal";
    if (workspaceState !== "editingSeam") {
      return color.clone();
    }
    const faded = color.clone();
    const hsl = { h: 0, s: 0, l: 0 };
    faded.getHSL(hsl);
    faded.setHSL(hsl.h, hsl.s * 0.6, hsl.l * 0.1);
    return faded;
  }

  // 获取有效的颜色：贴图模式时返回白色，否则返回组颜色，并根据工作状态调整 HSL
  function getEffectiveColor(groupId: number | null): Color {
    const textureEnabled = deps.isTextureEnabled?.() ?? false;
    if (textureEnabled) {
      return getEffectiveDefaultColor();
    }
    if (groupId !== null) {
      const groupColor = deps.getGroupColor(groupId);
      if (groupColor) return applySeamFading(groupColor);
    }
    return applySeamFading(defaultColor);
  }

  function updateFaceColorById(faceId: number, groupId?: number | null) {
    const mapping = deps.getFaceIndexMap().get(faceId);
    if (!mapping) return;
    groupId = groupId??deps.getFaceGroupMap().get(faceId)??null;
    const finalColor = getEffectiveColor(groupId);
    const visible = groupId !== null ? deps.getGroupVisibility?.(groupId) ?? true : true;
    setFaceColor(mapping.mesh, mapping.localFace, finalColor, visible ? 1 : 0);
  }

  function updateFaceColorWithForceVisibility(visible: boolean, faceId: number, groupId: number | null) {
    const mapping = deps.getFaceIndexMap().get(faceId);
    if (!mapping) return;
    groupId = groupId??deps.getFaceGroupMap().get(faceId)??null;
    const finalColor = getEffectiveColor(groupId);
    setFaceColor(mapping.mesh, mapping.localFace, finalColor, visible ? 1 : 0);
  }

  function repaintAllFaces() {
    deps.getFaceIndexMap().forEach((_, faceId) => {
      const gid = deps.getFaceGroupMap().get(faceId) ?? null;
      updateFaceColorById(faceId, gid);
    });
  }

  // 将所有顶点颜色设置为白色（用于贴图模式）
  function setAllVerticesWhite() {
    const whiteColor = getEffectiveDefaultColor();
    deps.getFaceIndexMap().forEach((mapping) => {
      const geometry = mapping.mesh.geometry;
      const colorsAttr = geometry.getAttribute("color") as Float32BufferAttribute;
      if (!colorsAttr) return;
      const count = colorsAttr.count;
      for (let i = 0; i < count; i++) {
        colorsAttr.setXYZ(i, whiteColor.r, whiteColor.g, whiteColor.b);
      }
      colorsAttr.needsUpdate = true;
    });
  }

  return { setFaceColor, setFaceAlpha, updateFaceColorById, repaintAllFaces, setAllVerticesWhite };
}
