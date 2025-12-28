import { Box3, BufferGeometry, Color, Vector3, Mesh, MeshStandardMaterial, Float32BufferAttribute, type Object3D } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { getModel, setModel, setLastFileName, setLastTriangleCount, getLastFileName } from "./model";
import {
  resetGroups,
  ensureGroup,
  getFaceGroupMap,
  getGroupFaces,
  getGroupColors,
  getGroupTreeParent,
  getPreviewGroupId,
  setPreviewGroupId,
  getEditGroupId,
  setEditGroupId,
  setGroupColorCursor,
  nextGroupId,
  deleteGroup as deleteGroupData,
  applyImportedGroups as applyImportedGroupsData,
  setFaceGroup as assignFaceToGroup,
  shareEdgeWithGroup as shareEdgeWithGroupData,
  canRemoveFace as canRemoveFaceData,
  getGroupColor,
  setGroupColor,
  rebuildGroupTree as rebuildGroupTreeData,
} from "./groups";
import { build3dppcData, download3dppc, load3dppc, type PPCFile } from "./ppc";
import { createScene } from "./scene";
import { FACE_DEFAULT_COLOR, createBackMaterial, createFrontMaterial, createEdgeMaterial } from "./materials";
import { createSeamLine, updateSeamResolution } from "./seams";
import { createHoverLines, disposeHoverLines, hideHoverLines, updateHoverLines, updateHoverResolution, createRaycaster } from "./interactions";

export type UIRefs = {
  viewer: HTMLDivElement;
  placeholder: HTMLDivElement;
  fileInput: HTMLInputElement;
  homeStartBtn: HTMLButtonElement;
  menuOpenBtn: HTMLButtonElement;
  lightToggle: HTMLButtonElement;
  edgesToggle: HTMLButtonElement;
  seamsToggle: HTMLButtonElement;
  facesToggle: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  triCounter: HTMLDivElement;
  groupTabsEl: HTMLDivElement;
  groupAddBtn: HTMLButtonElement;
  groupPreview: HTMLDivElement;
  groupPreviewLabel: HTMLDivElement;
  groupCountLabel: HTMLSpanElement;
  groupColorBtn: HTMLButtonElement;
  groupColorInput: HTMLInputElement;
  groupDeleteBtn: HTMLButtonElement;
  layoutEmpty: HTMLElement;
  layoutWorkspace: HTMLElement;
};

export function initRenderer3D(ui: UIRefs, setStatus: (msg: string, tone?: "info" | "error" | "success") => void) {
  const {
    viewer,
    placeholder,
    fileInput,
    homeStartBtn,
    menuOpenBtn,
    lightToggle,
    edgesToggle,
    seamsToggle,
    facesToggle,
    exportBtn,
    triCounter,
    groupTabsEl,
    groupAddBtn,
    groupPreview,
    groupPreviewLabel,
    groupCountLabel,
    groupColorBtn,
    groupColorInput,
    groupDeleteBtn,
  layoutEmpty,
  layoutWorkspace,
} = ui;

  const BREATH_PERIOD = 300; // ms
  const BREATH_CYCLES = 3; // 呼吸循环次数
  const BREATH_DURATION = BREATH_PERIOD * BREATH_CYCLES;
  const BREATH_SCALE = 0.4; // 呼吸幅度
  let edgesVisible = true;
  let seamsVisible = true;
  let facesVisible = true;
  let seamLines = new Map<number, LineSegments2>();
  let faceColorMap = new Map<number, string>();
  let faceAdjacency = new Map<number, Set<number>>();
  let faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
  let meshFaceIdMap = new Map<string, Map<number, number>>();
  let faceToEdges = new Map<number, [number, number, number]>();
  let edges: { id: number; key: string; faces: Set<number>; vertices: [string, string] }[] = [];
  let edgeKeyToId = new Map<string, number>();
  let groupTreeParent = new Map<number, Map<number, number | null>>();
  let vertexKeyToPos = new Map<string, Vector3>();
  let editGroupId: number | null = null;
  let previewGroupId = 1;
  const { raycaster, pointer } = createRaycaster();
  let brushMode = false;
  let brushButton: number | null = null;
  let lastBrushedFace: number | null = null;
  let controlsEnabledBeforeBrush = true;
  const hoverLines: LineSegments2[] = [];
  let breathGroupId: number | null = null;
  let breathStart = 0;
  let breathEnd = 0;
  let breathRaf: number | null = null;

  let faceGroupMap = getFaceGroupMap();
  let groupFaces = getGroupFaces();
  let groupColors = getGroupColors();

  function refreshGroupRefs() {
    faceGroupMap = getFaceGroupMap();
    groupFaces = getGroupFaces();
    groupColors = getGroupColors();
    groupTreeParent = getGroupTreeParent();
    previewGroupId = getPreviewGroupId();
    editGroupId = getEditGroupId();
  }

  const { scene, camera, renderer, controls, ambient, dir, modelGroup } = createScene(viewer);

  const objLoader = new OBJLoader();
  const fbxLoader = new FBXLoader();
  const stlLoader = new STLLoader();
  const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];

  edgesToggle.classList.toggle("active", edgesVisible);
  edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
  seamsToggle.classList.toggle("active", seamsVisible);
  seamsToggle.textContent = `拼接边：${seamsVisible ? "开" : "关"}`;
  facesToggle.classList.toggle("active", facesVisible);
  facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
  showWorkspace(false);
  renderGroupTabs();
  updateGroupPreview();

  function showWorkspace(loaded: boolean) {
    layoutEmpty.classList.toggle("active", !loaded);
    layoutWorkspace.classList.toggle("active", loaded);
  }

  homeStartBtn.addEventListener("click", () => {
    fileInput.click();
  });

  menuOpenBtn.addEventListener("click", () => {
    fileInput.click();
  });

  function clearModel() {
    stopGroupBreath();
    endBrush();
    modelGroup.clear();
    disposeSeams();
    disposeHoverLinesLocal();
    setModel(null);
    exportBtn.disabled = true;
    setLastTriangleCount(0);
    setStatus("尚未加载模型");
    showWorkspace(false);
    faceColorMap.clear();
    faceAdjacency.clear();
    faceIndexMap.clear();
    meshFaceIdMap.clear();
    resetGroups();
    refreshGroupRefs();
    faceToEdges = new Map<number, [number, number, number]>();
    edges = [];
    edgeKeyToId = new Map<string, number>();
    groupTreeParent = new Map<number, Map<number, number | null>>();
    vertexKeyToPos = new Map<string, Vector3>();
    ensureGroup(1);
    refreshGroupRefs();
    setPreviewGroupId(1);
    updateGroupPreview();
    renderGroupTabs();
    seamLines.clear();
    hideHoverLines(hoverState);
    setEditGroupId(null);
    editGroupId = null;
  }

  function applyDefaultFaceColors(mesh: Mesh) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const vertexCount = position.count;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      FACE_DEFAULT_COLOR.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.attributes.color.needsUpdate = true;
  }

  function getFaceVertexIndices(geometry: BufferGeometry, faceIndex: number): number[] {
    const indexAttr = geometry.index;
    if (indexAttr) {
      return [
        indexAttr.getX(faceIndex * 3),
        indexAttr.getX(faceIndex * 3 + 1),
        indexAttr.getX(faceIndex * 3 + 2),
      ];
    }
    return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
  }

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

  function getFaceIdFromIntersection(mesh: Mesh, localFace: number | undefined): number | null {
    if (localFace === undefined || localFace === null) return null;
    const map = meshFaceIdMap.get(mesh.uuid);
    if (!map) return null;
    return map.get(localFace) ?? null;
  }

  function updateFaceColorById(faceId: number) {
    const mapping = faceIndexMap.get(faceId);
    if (!mapping) return;
    const groupId = faceGroupMap.get(faceId) ?? null;
    const baseColor = groupId !== null ? getGroupColor(groupId) : FACE_DEFAULT_COLOR;
    setFaceColor(mapping.mesh, mapping.localFace, baseColor);
  }

  function applyGroupColor(groupId: number, color: Color) {
    setGroupColor(groupId, color);
    const faces = groupFaces.get(groupId);
    if (faces) {
      faces.forEach((faceId) => updateFaceColorById(faceId));
    }
    updateGroupPreview();
    renderGroupTabs();
  }

  function shareEdgeWithGroup(faceId: number, groupId: number): boolean {
    return shareEdgeWithGroupData(faceId, groupId, faceAdjacency);
  }

  function canRemoveFace(groupId: number, faceId: number): boolean {
    return canRemoveFaceData(groupId, faceId, faceAdjacency);
  }

  function areFacesAdjacent(a: number, b: number): boolean {
    const set = faceAdjacency.get(a);
    return set ? set.has(b) : false;
  }

  function rebuildGroupTree(groupId: number) {
    rebuildGroupTreeData(groupId, faceAdjacency);
    groupTreeParent = getGroupTreeParent();
  }

  function rebuildGroupTrees(groupIds: Set<number>) {
    groupIds.forEach((gid) => rebuildGroupTree(gid));
  }
  function pickFace(event: PointerEvent): number | null {
    const model = getModel();
    if (!model || !facesVisible) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(model, true).filter((i) => {
      const mesh = i.object as Mesh;
      return (mesh as Mesh).isMesh && !(mesh as Mesh).userData.functional;
    });
    if (!intersects.length) return null;
    const hit = intersects[0];
    const faceIndex = hit.faceIndex ?? -1;
    if (faceIndex < 0) return null;
    return getFaceIdFromIntersection(hit.object as Mesh, faceIndex);
  }

  function handleRemoveFace(faceId: number) {
    if (editGroupId === null) return;
    const currentGroup = faceGroupMap.get(faceId);
    if (currentGroup !== editGroupId) return;
    const groupSet = groupFaces.get(editGroupId) ?? new Set<number>();
    const size = groupSet.size;
    console.log("[group] remove attempt", { faceId, groupId: editGroupId, size });
    if (size <= 2 || canRemoveFace(editGroupId, faceId)) {
      assignFaceToGroup(faceId, null);
      updateFaceColorById(faceId);
      rebuildGroupTree(editGroupId);
      const newSize = groupFaces.get(editGroupId)?.size ?? 0;
      console.log("[group] remove success", { faceId, groupId: editGroupId, size: newSize });
      setStatus(`已从组${editGroupId}移除（面数量 ${newSize}）`, "success");
      const facesToUpdate = new Set<number>([faceId]);
      (groupFaces.get(editGroupId) ?? new Set<number>()).forEach((f) => facesToUpdate.add(f));
      rebuildSeamsForFaces(facesToUpdate);
    } else {
      console.log("[group] remove blocked: disconnect", { faceId, groupId: editGroupId });
      setStatus("移除会导致展开组不连通，已取消", "error");
    }
  }

  function handleAddFace(faceId: number) {
    if (editGroupId === null) return;
    const targetGroup = editGroupId;
    const currentGroup = faceGroupMap.get(faceId) ?? null;
    if (currentGroup === targetGroup) return;

    const targetSet = groupFaces.get(targetGroup) ?? new Set<number>();
    console.log("[group] add attempt", { faceId, targetGroup, currentGroup, targetSize: targetSet.size });

    if (currentGroup !== null) {
      if (!canRemoveFace(currentGroup, faceId)) {
        console.log("[group] add blocked: source group disconnect", { faceId, from: currentGroup, to: targetGroup });
        setStatus("该面所在的组移出后会断开，未加入当前组", "error");
        return;
      }
    }

    if (targetSet.size > 0) {
      if (!shareEdgeWithGroup(faceId, targetGroup)) {
        console.log("[group] add blocked: no shared edge", { faceId, targetGroup });
        setStatus("该面与当前组无共边，未加入", "error");
        return;
      }
    }

    if (currentGroup !== null) {
      assignFaceToGroup(faceId, null);
    }
    assignFaceToGroup(faceId, targetGroup);
    updateFaceColorById(faceId);
    const affectedGroups = new Set<number>([targetGroup]);
    if (currentGroup !== null) affectedGroups.add(currentGroup);
    rebuildGroupTrees(affectedGroups);
    const newSize = groupFaces.get(targetGroup)?.size ?? 0;
    console.log("[group] add success", { faceId, targetGroup, size: newSize });
    setStatus(`已加入组${targetGroup}（面数量 ${newSize}）`, "success");
    const groups = new Set<number>();
    groups.add(targetGroup);
    if (currentGroup !== null) groups.add(currentGroup);
    rebuildSeamsForGroups(groups);
  }

  function startBrush(button: number, initialFace: number | null) {
    if (editGroupId === null) return;
    if (initialFace === null) return;
    brushMode = true;
    brushButton = button;
    lastBrushedFace = null;
    controlsEnabledBeforeBrush = controls.enabled;
    controls.enabled = false;
    if (button === 0) {
      handleAddFace(initialFace);
    } else if (button === 2) {
      handleRemoveFace(initialFace);
    }
    lastBrushedFace = initialFace;
  }

  function endBrush() {
    if (!brushMode) return;
    brushMode = false;
    brushButton = null;
    lastBrushedFace = null;
    controls.enabled = controlsEnabledBeforeBrush;
  }

  function setEditGroup(groupId: number | null) {
    if (brushMode) endBrush();
    if (editGroupId !== null && groupId === editGroupId) return;
    editGroupId = groupId;
    setEditGroupId(groupId);
    if (groupId === null) {
      console.log("[group] exit edit mode");
      setStatus("已退出展开组编辑模式");
      stopGroupBreath();
      return;
    }
    if (!groupFaces.has(groupId)) {
      groupFaces.set(groupId, new Set<number>());
    }
    setPreviewGroupId(groupId);
    refreshGroupRefs();
    previewGroupId = groupId;
    updateGroupPreview();
    renderGroupTabs();
    console.log("[group] enter edit mode", { groupId });
    setStatus(`展开组 ${groupId} 编辑模式：左键加入，右键移出`, "info");
    startGroupBreath(groupId);
  }

  function updateGroupPreview() {
    if (!groupPreview || !groupPreviewLabel || !groupColorBtn || !groupColorInput || !groupDeleteBtn || !groupCountLabel)
      return;
    groupPreviewLabel.textContent = `展开组${previewGroupId}`;
    const color = getGroupColor(previewGroupId);
    const hex = `#${color.getHexString()}`;
    groupColorBtn.style.background = hex;
    groupColorInput.value = hex;
    const count = groupFaces.get(previewGroupId)?.size ?? 0;
    groupCountLabel.textContent = `面数量 ${count}`;
    const deletable = groupFaces.size > 1;
    groupDeleteBtn.style.display = deletable ? "inline-flex" : "none";
  }

  function renderGroupTabs() {
    if (!groupTabsEl) return;
    groupTabsEl.innerHTML = "";
    const ids = Array.from(groupFaces.keys()).sort((a, b) => a - b);
    ids.forEach((id) => {
      const btn = document.createElement("button");
      btn.className = `tab-btn ${id === previewGroupId ? "active" : ""} ${editGroupId === id ? "editing" : ""}`;
      btn.textContent = `${id}`;
      btn.addEventListener("click", () => {
        if (editGroupId === null) {
          setPreviewGroupId(id);
          refreshGroupRefs();
          previewGroupId = id;
          updateGroupPreview();
          renderGroupTabs();
          setStatus(`预览展开组 ${id}`, "info");
          startGroupBreath(id);
        } else {
          if (editGroupId === id) return;
          setEditGroup(id);
        }
      });
      groupTabsEl.appendChild(btn);
    });
  }

  function getNextGroupId(): number {
    return nextGroupId();
  }

  function deleteGroup(groupId: number) {
    if (groupFaces.size <= 1) return;
    const ids = Array.from(groupFaces.keys());
    if (!ids.includes(groupId)) return;
    if (breathGroupId === groupId) stopGroupBreath();
    deleteGroupData(groupId, faceAdjacency, (gid) => {
      refreshGroupRefs();
      previewGroupId = gid;
      if (editGroupId !== null) {
        setEditGroup(previewGroupId);
      } else {
        updateGroupPreview();
        renderGroupTabs();
      }
    });
    refreshGroupRefs();
    setStatus(`已删除展开组 ${groupId}`, "success");
  }

  function repaintAllFaces() {
    faceGroupMap.forEach((_, faceId) => updateFaceColorById(faceId));
  }

  function applyImportedGroups(groups: PPCFile["groups"]) {
    if (!groups || !groups.length) return;
    applyImportedGroupsData(groups as NonNullable<PPCFile["groups"]>, faceAdjacency);
    refreshGroupRefs();
    groupFaces.forEach((_, gid) => rebuildGroupTree(gid));
    refreshGroupRefs();
    const pid = Math.min(...Array.from(getGroupFaces().keys()));
    setPreviewGroupId(pid);
    refreshGroupRefs();
    previewGroupId = pid;
    repaintAllFaces();
    updateGroupPreview();
    renderGroupTabs();
  }

  function buildFaceColorMap(object: Object3D) {
    faceColorMap = new Map<number, string>();
    faceAdjacency = new Map<number, Set<number>>();
    faceIndexMap = new Map<number, { mesh: Mesh; localFace: number }>();
    meshFaceIdMap = new Map<string, Map<number, number>>();
    resetGroups();
    refreshGroupRefs();
    faceToEdges = new Map<number, [number, number, number]>();
    edges = [];
    edgeKeyToId = new Map<string, number>();
    groupTreeParent = new Map<number, Map<number, number | null>>();
    vertexKeyToPos = new Map<string, Vector3>();
    ensureGroup(1);
    refreshGroupRefs();
    editGroupId = null;
    previewGroupId = 1;
    renderGroupTabs();
    updateGroupPreview();
    rebuildGroupTree(1);
    let faceId = 0;

    const vertexKey = (pos: any, idx: number) =>
      `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;

    object.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      const geometry = mesh.geometry;
      const indexAttr = geometry.index;
      const position = geometry.getAttribute("position");
      if (!position) return;
      const faceCount = indexAttr ? indexAttr.count / 3 : position.count / 3;

      if (!meshFaceIdMap.has(mesh.uuid)) {
        meshFaceIdMap.set(mesh.uuid, new Map<number, number>());
      }
      const localMap = meshFaceIdMap.get(mesh.uuid)!;

      for (let f = 0; f < faceCount; f++) {
        faceColorMap.set(faceId, FACE_DEFAULT_COLOR.getHexString());
        faceGroupMap.set(faceId, null);
        faceIndexMap.set(faceId, { mesh, localFace: f });
        localMap.set(f, faceId);
        const [a, b, c] = getFaceVertexIndices(geometry, f);
        const va = vertexKey(position, a);
        const vb = vertexKey(position, b);
        const vc = vertexKey(position, c);
        if (!vertexKeyToPos.has(va)) vertexKeyToPos.set(va, new Vector3(position.getX(a), position.getY(a), position.getZ(a)));
        if (!vertexKeyToPos.has(vb)) vertexKeyToPos.set(vb, new Vector3(position.getX(b), position.getY(b), position.getZ(b)));
        if (!vertexKeyToPos.has(vc)) vertexKeyToPos.set(vc, new Vector3(position.getX(c), position.getY(c), position.getZ(c)));
        const faceEdges: number[] = [];
        const edgePairs: [string, string][] = [
          [va, vb],
          [vb, vc],
          [vc, va],
        ];
        edgePairs.forEach(([p1, p2]) => {
          const key = [p1, p2].sort().join("|");
          let edgeId = edgeKeyToId.get(key);
          if (edgeId === undefined) {
            edgeId = edges.length;
            edgeKeyToId.set(key, edgeId);
            edges.push({ id: edgeId, key, faces: new Set<number>(), vertices: [p1, p2] });
          }
          edges[edgeId].faces.add(faceId);
          faceEdges.push(edgeId);
        });
        faceToEdges.set(faceId, faceEdges as [number, number, number]);
        faceId++;
      }
    });

    edges.forEach((edge) => {
      const faces = Array.from(edge.faces);
      if (faces.length < 2) return;
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const a = faces[i];
          const b = faces[j];
          if (!faceAdjacency.has(a)) faceAdjacency.set(a, new Set<number>());
          if (!faceAdjacency.has(b)) faceAdjacency.set(b, new Set<number>());
          faceAdjacency.get(a)!.add(b);
          faceAdjacency.get(b)!.add(a);
        }
      }
    });
    rebuildGroupTree(1);
  }

  function generateFunctionalMaterials(root: Object3D) {
    const replacements: { parent: Object3D; mesh: Mesh }[] = [];
    root.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        if (mesh.userData.functional) return;
        applyDefaultFaceColors(mesh);
        replacements.push({ parent: mesh.parent ? mesh.parent : root, mesh });
      }
    });
    replacements.forEach(({ parent, mesh }) => {
      const geomBack = mesh.geometry.clone();
      const meshBack = new Mesh(geomBack, createBackMaterial());
      meshBack.userData.functional = "back";
      meshBack.castShadow = mesh.castShadow;
      meshBack.receiveShadow = mesh.receiveShadow;
      meshBack.name = mesh.name ? `${mesh.name}-back` : "back-only";
      meshBack.position.copy(mesh.position);
      meshBack.rotation.copy(mesh.rotation);
      meshBack.scale.copy(mesh.scale);
      parent.add(meshBack);

      const geomWireframe = mesh.geometry.clone();
      const meshWireframe = new Mesh(geomWireframe, createEdgeMaterial());
      meshWireframe.userData.functional = "edge";
      meshWireframe.castShadow = false;
      meshWireframe.receiveShadow = false;
      meshWireframe.name = mesh.name ? `${mesh.name}-wireframe` : "wireframe-only";
      meshWireframe.position.copy(mesh.position);
      meshWireframe.rotation.copy(mesh.rotation);
      meshWireframe.scale.copy(mesh.scale);
      parent.add(meshWireframe);
    });
  }

  function applyFaceVisibility() {
    const model = getModel();
    if (!model) return;
    model.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional && mesh.userData.functional !== "back") return;
      if ((mesh.material as MeshStandardMaterial).visible !== undefined) {
        (mesh.material as MeshStandardMaterial).visible = facesVisible;
      }
    });
  }

  function countTrianglesInObject(object: Object3D): number {
    let count = 0;
    object.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      const geometry = (child as Mesh).geometry;
      if (geometry.index) {
        count += geometry.index.count / 3;
      } else {
        const position = geometry.getAttribute("position");
        count += position ? position.count / 3 : 0;
      }
    });
    return count;
  }

  function fitCameraToObject(object: Object3D) {
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    object.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera.fov * Math.PI) / 180;
    const distance = maxDim / (2 * Math.tan(fov / 2));
    const offset = 1.8;

    camera.position.set(-distance * offset * 0.75, -distance * offset, distance * offset * 0.75);
    camera.near = Math.max(0.1, distance / 100);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();

    controls.target.set(0, 0, 0);
    controls.update();
  }

  function resizeRenderer() {
    const { clientWidth, clientHeight } = viewer;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    refreshSeamResolution();
    updateHoverResolution(viewer, hoverLines);
  }

  window.addEventListener("resize", resizeRenderer);

  function disposeSeams() {
    seamLines.forEach((line) => {
      line.removeFromParent();
      (line.geometry as LineSegmentsGeometry).dispose();
      (line.material as LineMaterial).dispose();
    });
    seamLines.clear();
  }

  function applyEdgeVisibility() {
    const model = getModel();
    if (!model) return;
    model.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional === "edge") {
        mesh.visible = edgesVisible;
      }
    });
  }

  function applySeamsVisibility() {
    if (!getModel()) return;
    seamLines.forEach((line) => {
      line.visible = seamsVisible && line.userData.isSeam;
    });
  }

  function refreshSeamResolution() {
    updateSeamResolution(viewer, seamLines);
  }

  function refreshVertexWorldPositions() {
    vertexKeyToPos.clear();
    const model = getModel();
    if (!model) return;
    const vertexKey = (pos: any, idx: number) =>
      `${pos.getX(idx)},${pos.getY(idx)},${pos.getZ(idx)}`;
    model.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      mesh.updateWorldMatrix(true, false);
      const position = mesh.geometry.getAttribute("position");
      if (!position) return;
      const count = position.count;
      for (let i = 0; i < count; i++) {
        const key = vertexKey(position, i);
        const world = new Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(
          mesh.matrixWorld,
        );
        vertexKeyToPos.set(key, world);
      }
    });
  }

  function isParentChildEdge(f1: number, f2: number): boolean {
    const g1 = faceGroupMap.get(f1);
    const g2 = faceGroupMap.get(f2);
    if (g1 === null || g2 === null || g1 !== g2) return false;
    const parentMap = groupTreeParent.get(g1);
    if (!parentMap) return false;
    return parentMap.get(f1) === f2 || parentMap.get(f2) === f1;
  }

  function edgeIsSeam(edgeId: number): boolean {
    const edge = edges[edgeId];
    if (!edge) return false;
    const faces = Array.from(edge.faces);
    if (faces.length === 1) return false;
    if (faces.length !== 2) return true;
    const [f1, f2] = faces;
    const g1 = faceGroupMap.get(f1) ?? null;
    const g2 = faceGroupMap.get(f2) ?? null;
    if (g1 === null && g2 === null) return false;
    if (g1 === null || g2 === null) return true;
    if (g1 !== g2) return true;
    const seam = !isParentChildEdge(f1, f2);
    if (seam) {
      console.log("[seam] edge is seam", { edgeId, faces, groups: [g1, g2] });
    }
    return seam;
  }

  function ensureSeamLine(edgeId: number): LineSegments2 {
    return createSeamLine(edgeId, viewer, scene, seamLines);
  }

  function updateSeamLine(edgeId: number, visible: boolean) {
    const edge = edges[edgeId];
    if (!edge) return;
    const v1 = vertexKeyToPos.get(edge.vertices[0]);
    const v2 = vertexKeyToPos.get(edge.vertices[1]);
    if (!v1 || !v2) return;
    const line = ensureSeamLine(edgeId);
    const arr = new Float32Array([v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
    (line.geometry as LineSegmentsGeometry).setPositions(arr);
    line.computeLineDistances();
    line.visible = visible && seamsVisible;
    line.userData.isSeam = visible;
  }

  function rebuildSeamsFull() {
    if (!getModel()) return;
    console.log("[seam] rebuild full");
    refreshVertexWorldPositions();
    edges.forEach((_, edgeId) => {
      const isSeam = edgeIsSeam(edgeId);
      updateSeamLine(edgeId, isSeam);
    });
    applySeamsVisibility();
    refreshSeamResolution();
  }

  function rebuildSeamsForGroups(groupIds: Set<number>) {
    if (!getModel() || groupIds.size === 0) return;
    console.log("[seam] rebuild partial", { groups: Array.from(groupIds) });
    rebuildSeamsForFaces(new Set(Array.from(groupIds).flatMap((gid) => Array.from(groupFaces.get(gid) ?? []))));
  }

  function rebuildSeamsForFaces(faceIds: Set<number>) {
    if (!getModel() || faceIds.size === 0) return;
    console.log("[seam] rebuild faces", { faces: Array.from(faceIds) });
    refreshVertexWorldPositions();
    edges.forEach((edge, edgeId) => {
      let related = false;
      edge.faces.forEach((f) => {
        if (faceIds.has(f)) related = true;
      });
      if (!related) return;
      const isSeam = edgeIsSeam(edgeId);
      updateSeamLine(edgeId, isSeam);
    });
    applySeamsVisibility();
    refreshSeamResolution();
  }

  function initHoverLinesLocal() {
    createHoverLines(viewer, scene, hoverLines);
  }

  function disposeHoverLinesLocal() {
    disposeHoverLines(hoverLines);
    hoverState.hoveredFaceId = null;
  }

  const hoverState = { hoverLines, hoveredFaceId: null as number | null };

  function stopGroupBreath() {
    if (breathRaf !== null) {
      cancelAnimationFrame(breathRaf);
      breathRaf = null;
    }
    const gid = breathGroupId;
    breathGroupId = null;
    if (gid !== null) {
      const faces = groupFaces.get(gid);
      faces?.forEach((faceId) => updateFaceColorById(faceId));
    }
  }

  function startGroupBreath(groupId: number) {
    stopGroupBreath();
    breathGroupId = groupId;
    breathStart = performance.now();
    breathEnd = breathStart + BREATH_DURATION;
    const faces = groupFaces.get(groupId);
    if (!faces || faces.size === 0) {
      breathGroupId = null;
      return;
    }

    const loop = () => {
      if (breathGroupId !== groupId) return;
      const now = performance.now();
      const elapsed = now - breathStart;
      const progress = Math.min(1, elapsed / BREATH_DURATION);
      if (progress >= 1) {
        faces.forEach((faceId) => updateFaceColorById(faceId));
        stopGroupBreath();
        return;
      }
      const factor = (1 + BREATH_SCALE) + BREATH_SCALE * Math.sin((progress + 0.25) * Math.PI * 2 * BREATH_CYCLES);
      const baseColor = getGroupColor(groupId);
      const scaled = baseColor.clone().multiplyScalar(factor);
      faces.forEach((faceId) => {
        const mapping = faceIndexMap.get(faceId);
        if (!mapping) return;
        setFaceColor(mapping.mesh, mapping.localFace, scaled);
      });
      breathRaf = requestAnimationFrame(loop);
    };
    breathRaf = requestAnimationFrame(loop);
  }

  async function loadModel(file: File, ext: string) {
    const url = URL.createObjectURL(file);
    placeholder.classList.add("hidden");
    setStatus("加载中...", "info");

    try {
      let object: Object3D;
      let importedGroups: PPCFile["groups"] | undefined;
      let importedColorCursor: number | undefined;
      if (ext === "obj") {
        const loaded = await objLoader.loadAsync(url);
        const mat = createFrontMaterial();
        loaded.traverse((child) => {
          if ((child as Mesh).isMesh) {
            (child as Mesh).material = mat.clone();
          }
        });
        object = loaded;
      } else if (ext === "fbx") {
        const loaded = await fbxLoader.loadAsync(url);
        const mat = createFrontMaterial();
        loaded.traverse((child) => {
          if ((child as Mesh).isMesh) {
            (child as Mesh).material = mat.clone();
          }
        });
        object = loaded;
      } else if (ext === "stl") {
        const geometry = await stlLoader.loadAsync(url);
        const material = createFrontMaterial();
        object = new Mesh(geometry, material);
      } else {
        const loaded = await load3dppc(url, createFrontMaterial());
        object = loaded.object;
        importedGroups = loaded.groups;
        importedColorCursor = loaded.colorCursor;
      }

      clearModel();
      setModel(object);
      setLastFileName(file.name);
      const model = getModel();
      if (!model) throw new Error("模型初始化失败");
      generateFunctionalMaterials(model);
      buildFaceColorMap(model);
      if (typeof importedColorCursor === "number") {
        setGroupColorCursor(importedColorCursor);
      }
      if (importedGroups && importedGroups.length) {
        applyImportedGroups(importedGroups);
      }
      applyFaceVisibility();
      applyEdgeVisibility();
      modelGroup.add(model);
      initHoverLinesLocal();
      const triCount = countTrianglesInObject(model);
      setLastTriangleCount(triCount);
      fitCameraToObject(model);
      refreshVertexWorldPositions();
      rebuildSeamsFull();
      showWorkspace(true);
      resizeRenderer(); // 确保从隐藏切换到可见后尺寸正确
      setStatus(`已加载：${file.name} · 三角面 ${triCount}`, "success");
      exportBtn.disabled = false;
    } catch (error) {
      console.error("加载模型失败", error);
      if ((error as Error)?.stack) {
        console.error((error as Error).stack);
      }
      setStatus("加载失败，请检查文件格式是否正确。", "error");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function getExtension(name: string) {
    const parts = name.split(".");
    return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const ext = getExtension(file.name);
    if (!allowedExtensions.includes(ext)) {
      setStatus("不支持的格式，请选择 OBJ / FBX / STL。", "error");
      fileInput.value = "";
      return;
    }

    await loadModel(file, ext);
  });

  lightToggle.addEventListener("click", () => {
    const enabled = !dir.visible;
    dir.visible = enabled;
    ambient.intensity = enabled ? 0.6 : 3;
    lightToggle.classList.toggle("active", enabled);
    lightToggle.textContent = `光源：${enabled ? "开" : "关"}`;
  });

  edgesToggle.addEventListener("click", () => {
    edgesVisible = !edgesVisible;
    edgesToggle.classList.toggle("active", edgesVisible);
    edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
    applyEdgeVisibility();
  });
  seamsToggle.addEventListener("click", () => {
    seamsVisible = !seamsVisible;
    seamsToggle.classList.toggle("active", seamsVisible);
    seamsToggle.textContent = `拼接边：${seamsVisible ? "开" : "关"}`;
    if (seamsVisible && seamLines.size === 0) rebuildSeamsFull();
    applySeamsVisibility();
  });

  facesToggle.addEventListener("click", () => {
    facesVisible = !facesVisible;
    facesToggle.classList.toggle("active", facesVisible);
    facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
    applyFaceVisibility();
  });

  exportBtn.addEventListener("click", async () => {
    const model = getModel();
    if (!model) {
      setStatus("没有可导出的模型", "error");
      return;
    }
    try {
      setStatus("正在导出 .3dppc ...", "info");
      const data = await build3dppcData(model);
      await download3dppc(data);
      setStatus("导出成功", "success");
    } catch (error) {
      console.error("导出失败", error);
      setStatus("导出失败，请重试。", "error");
    }
  });

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    triCounter.textContent = `渲染三角形：${renderer.info.render.triangles}`;
  }

  resizeRenderer();
  animate();

  renderer.domElement.addEventListener("pointermove", (event) => {
    const model = getModel();
    if (!model || !facesVisible) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const intersects = raycaster.intersectObject(model, true).filter((i) => {
      const mesh = i.object as Mesh;
      return (mesh as Mesh).isMesh && !(mesh as Mesh).userData.functional;
    });

    hideHoverLines(hoverState);

    if (!intersects.length) {
      if (brushMode) lastBrushedFace = null;
      return;
    }
    const hit = intersects[0];
    const mesh = hit.object as Mesh;
    const faceIndex = hit.faceIndex ?? -1;
    const faceId = getFaceIdFromIntersection(mesh, faceIndex);
    if (brushMode && faceId !== lastBrushedFace) {
      if (faceId !== null) {
        if (brushButton === 0) handleAddFace(faceId);
        else if (brushButton === 2) handleRemoveFace(faceId);
      }
      lastBrushedFace = faceId;
    }
    if (faceId === null) return;
    updateHoverLines(mesh, faceIndex, faceId, hoverState);
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    hideHoverLines(hoverState);
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch (e) {
      // ignore capture failures
    }
    if (!getModel() || editGroupId === null) return;
    const faceId = pickFace(event);
    if (faceId === null) return;
    startBrush(event.button, faceId);
  });

  renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  renderer.domElement.addEventListener("pointerup", (event) => {
    try {
      renderer.domElement.releasePointerCapture(event.pointerId);
    } catch (e) {
      // ignore release failures
    }
    if (brushMode) endBrush();
  });

  window.addEventListener("pointerup", () => {
    if (brushMode) endBrush();
  });

  groupAddBtn.addEventListener("click", () => {
    const newId = getNextGroupId();
    groupFaces.set(newId, new Set<number>());
    setGroupColor(newId, getGroupColor(newId));
    setPreviewGroupId(newId);
    refreshGroupRefs();
    previewGroupId = newId;
    updateGroupPreview();
    renderGroupTabs();
    setStatus(`已创建展开组 ${newId}`, "success");
    if (editGroupId !== null) {
      setEditGroup(newId);
    }
  });

  groupColorBtn.addEventListener("click", () => {
    groupColorInput.click();
  });

  groupColorInput.addEventListener("input", (event) => {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    const color = new Color(value);
    applyGroupColor(previewGroupId, color);
  });

  groupDeleteBtn.addEventListener("click", () => {
    if (groupFaces.size <= 1) return;
    const ok = confirm(`确定删除展开组 ${previewGroupId} 吗？该组的面将被移出。`);
    if (!ok) return;
    deleteGroup(previewGroupId);
  });

  window.addEventListener("keydown", (event) => {
    if (!getModel()) return;
    if (event.key === "Escape") {
      if (editGroupId !== null) {
        setEditGroup(null);
      }
      return;
    }
    const num = Number(event.key);
    if (!Number.isInteger(num) || num <= 0) return;
    if (groupFaces.has(num)) {
      setEditGroup(num);
    }
  });

  return {
    loadModel,
    clearModel,
    applyFaceVisibility,
    applyEdgeVisibility,
    rebuildSeamsFull,
  };
}
