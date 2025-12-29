// 3D 渲染与交互层：负责 Three.js 场景、相机/光源、模型加载展示、拾取/hover/刷子交互，消费外部注入的组/拼缝接口，不持有业务状态。
import { Color, Vector3, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { getModel, setModel, setLastFileName, setLastTriangleCount, getLastFileName } from "./model";
import {
  resetGroups,
  ensureGroup,
  getFaceGroupMap,
  getGroupFaces,
  getGroupTreeParent,
  getPreviewGroupId,
  setPreviewGroupId,
  getEditGroupId,
  setEditGroupId,
  setGroupColorCursor,
  getGroupColor,
} from "./groups";
import { build3dppcData, download3dppc, load3dppc, type PPCFile } from "./ppc";
import { createScene } from "./scene";
import { FACE_DEFAULT_COLOR, createFrontMaterial } from "./materials";
import { createHoverLines, disposeHoverLines, hideHoverLines, updateHoverLines, updateHoverResolution, createRaycaster } from "./interactions";
import { initInteractionController } from "./interactionController";
import {
  EdgeRecord,
  fitCameraToObject,
  generateFunctionalMaterials,
} from "./modelLoader";
import { createFaceColorService } from "./faceColorService";
import { GeometryIndex } from "./geometryIndex";
import { type SeamManagerApi, type SeamManagerDeps } from "./seamManager";
import { initUIController } from "./uiController";
import { appEventBus } from "./eventBus";
// group UI 渲染与交互由外部注入，renderer3d 只调用回调

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
  layoutEmpty: HTMLElement;
  layoutWorkspace: HTMLElement;
};

export type GroupUIRenderState = {
  groupIds: number[];
  previewGroupId: number;
  editGroupId: number | null;
  deletable: boolean;
  getGroupColor: (id: number) => Color;
  getGroupCount: (id: number) => number;
};

export type GroupUIHooks = {
  renderGroupUI?: (state: GroupUIRenderState) => void;
  confirmDeleteGroup?: (id: number) => boolean;
};

export type GroupApi = {
  applyGroupColor: (groupId: number, color: Color) => void;
  handleRemoveFace: (faceId: number, editGroupId: number | null) => void;
  handleAddFace: (faceId: number, editGroupId: number | null) => void;
  setEditGroup: (groupId: number | null, currentEdit: number | null, previewGroupId: number) => {
    editGroupId: number | null;
    previewGroupId: number;
  };
  deleteGroup: (groupId: number, editGroupId: number | null) => { editGroupId: number | null; previewGroupId: number };
  applyImportedGroups: (groups: PPCFile["groups"]) => void;
  createGroup: (currentEditGroupId: number | null) => { groupId: number; previewGroupId: number; editGroupId: number | null };
};

export function initRenderer3D(
  ui: UIRefs,
  setStatus: (msg: string, tone?: "info" | "error" | "success") => void,
  groupUiHooks: GroupUIHooks = {},
) {
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
  const geometryIndex = new GeometryIndex();
  let faceAdjacency = geometryIndex.getFaceAdjacency();
  let faceIndexMap = geometryIndex.getFaceIndexMap();
  let meshFaceIdMap = geometryIndex.getMeshFaceIdMap();
  let faceToEdges = geometryIndex.getFaceToEdges();
  let edges: EdgeRecord[] = geometryIndex.getEdgesArray();
  let edgeKeyToId = geometryIndex.getEdgeKeyToId();
  let groupTreeParent = getGroupTreeParent();
  let vertexKeyToPos = geometryIndex.getVertexKeyToPos();
  let vertexPositionsDirty = false;
  let editGroupId: number | null = null;
  let previewGroupId = 1;
  const { raycaster, pointer } = createRaycaster();
  const hoverLines: LineSegments2[] = [];
  let interactionController: ReturnType<typeof initInteractionController> | null = null;
  let breathGroupId: number | null = null;
  let breathStart = 0;
  let breathEnd = 0;
  let breathRaf: number | null = null;
  let seamManager: SeamManagerApi | null = null;
  let groupApi: GroupApi | null = null;

  let faceGroupMap = getFaceGroupMap();
  let groupFaces = getGroupFaces();
  let lastEditGroupId: number | null = editGroupId;

  function refreshGroupRefs() {
    faceGroupMap = getFaceGroupMap();
    groupFaces = getGroupFaces();
    groupTreeParent = getGroupTreeParent();
    previewGroupId = getPreviewGroupId();
    editGroupId = getEditGroupId();
  }

  function syncGroupStateFromData() {
    const prevEdit = editGroupId;
    refreshGroupRefs();
    if (prevEdit !== editGroupId) {
      interactionController?.endBrush();
      stopGroupBreath();
      if (editGroupId !== null) {
        startGroupBreath(editGroupId);
      }
    }
    lastEditGroupId = editGroupId;
  }

  function markVertexPositionsDirty() {
    vertexPositionsDirty = true;
  }

  const faceColorService = createFaceColorService({
    getFaceIndexMap: () => faceIndexMap,
    getFaceGroupMap: () => faceGroupMap,
    getGroupColor,
    defaultColor: FACE_DEFAULT_COLOR,
  });

  const { scene, camera, renderer, controls, ambient, dir, modelGroup } = createScene(viewer);

  const objLoader = new OBJLoader();
  const fbxLoader = new FBXLoader();
  const stlLoader = new STLLoader();
  const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];

  const uiController = initUIController(
    {
      fileInput,
      homeStartBtn,
      menuOpenBtn,
      lightToggle,
      edgesToggle,
      seamsToggle,
      facesToggle,
      exportBtn,
      layoutEmpty,
      layoutWorkspace,
      versionBadgeGlobal: document.querySelector<HTMLDivElement>(".version-badge-global"),
    },
    {
      onFileSelected: async (file) => {
        const ext = getExtension(file.name);
        if (!allowedExtensions.includes(ext)) {
          setStatus("不支持的格式，请选择 OBJ / FBX / STL。", "error");
          fileInput.value = "";
          return;
        }
        await loadModel(file, ext);
      },
      onHomeStart: () => fileInput.click(),
      onMenuOpen: () => fileInput.click(),
      onLightToggle: () => {
        const enabled = !dir.visible;
        dir.visible = enabled;
        ambient.intensity = enabled ? 0.6 : 3;
        lightToggle.classList.toggle("active", enabled);
        lightToggle.textContent = `光源：${enabled ? "开" : "关"}`;
      },
      onEdgesToggle: () => {
        edgesVisible = !edgesVisible;
        edgesToggle.classList.toggle("active", edgesVisible);
        edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
        applyEdgeVisibility();
      },
      onSeamsToggle: () => {
        seamsVisible = !seamsVisible;
        seamsToggle.classList.toggle("active", seamsVisible);
        seamsToggle.textContent = `拼接边：${seamsVisible ? "开" : "关"}`;
        applySeamsVisibility();
      },
      onFacesToggle: () => {
        facesVisible = !facesVisible;
        facesToggle.classList.toggle("active", facesVisible);
        facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
        applyFaceVisibility();
      },
      onExport: async () => {
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
      },
      onKeyDown: (event) => {
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
      },
    },
  );

  edgesToggle.classList.toggle("active", edgesVisible);
  edgesToggle.textContent = `线框：${edgesVisible ? "开" : "关"}`;
  seamsToggle.classList.toggle("active", seamsVisible);
  seamsToggle.textContent = `拼接边：${seamsVisible ? "开" : "关"}`;
  facesToggle.classList.toggle("active", facesVisible);
  facesToggle.textContent = `面渲染：${facesVisible ? "开" : "关"}`;
  showWorkspace(false);

  function showWorkspace(loaded: boolean) {
    uiController.setWorkspaceLoaded(loaded);
  }

  function clearModel() {
    stopGroupBreath();
    interactionController?.endBrush();
    modelGroup.clear();
    disposeSeams();
    disposeHoverLinesLocal();
    setModel(null);
    exportBtn.disabled = true;
    setLastTriangleCount(0);
    setStatus("尚未加载模型");
    showWorkspace(false);
    faceAdjacency.clear();
    faceIndexMap.clear();
    meshFaceIdMap.clear();
    resetGroups();
    refreshGroupRefs();
    geometryIndex.reset();
    faceAdjacency = geometryIndex.getFaceAdjacency();
    faceIndexMap = geometryIndex.getFaceIndexMap();
    meshFaceIdMap = geometryIndex.getMeshFaceIdMap();
    faceToEdges = geometryIndex.getFaceToEdges();
    edges = geometryIndex.getEdgesArray();
    edgeKeyToId = geometryIndex.getEdgeKeyToId();
    groupTreeParent = getGroupTreeParent();
    vertexKeyToPos = geometryIndex.getVertexKeyToPos();
    markVertexPositionsDirty();
    ensureGroup(1);
    refreshGroupRefs();
    setPreviewGroupId(1);
    seamManager.dispose();
    hideHoverLines(hoverState);
    setEditGroupId(null);
    editGroupId = null;
  }

  function getFaceIdFromIntersection(mesh: Mesh, localFace: number | undefined): number | null {
    return geometryIndex.getFaceId(mesh, localFace);
  }

  function updateFaceColorById(faceId: number) {
    faceColorService.updateFaceColorById(faceId);
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

  const handleRemoveFace = (faceId: number) => groupApi?.handleRemoveFace(faceId, editGroupId);

  const handleAddFace = (faceId: number) => groupApi?.handleAddFace(faceId, editGroupId);

  function setEditGroup(groupId: number | null) {
    interactionController?.endBrush();
    if (!groupApi) return;
    const result = groupApi.setEditGroup(groupId, editGroupId, previewGroupId);
    editGroupId = result.editGroupId;
    previewGroupId = result.previewGroupId;
  }

  function getGroupDeps() {
    return {
      getFaceAdjacency: () => faceAdjacency,
      refreshGroupRefs,
      repaintAllFaces: () => repaintAllFaces(),
      setStatus,
      startGroupBreath: (gid: number) => startGroupBreath(gid),
      stopGroupBreath: () => stopGroupBreath(),
      faceColorService,
    };
  }

  function setPreviewGroup(groupId: number) {
    if (editGroupId !== null) return;
    if (!groupFaces.has(groupId)) return;
    setPreviewGroupId(groupId);
    refreshGroupRefs();
    previewGroupId = groupId;
    setStatus(`预览展开组 ${groupId}`, "info");
    startGroupBreath(groupId);
  }

  function changePreviewGroupColor(color: Color) {
    groupApi?.applyGroupColor(previewGroupId, color);
  }

  function addGroup(): number {
    if (!groupApi) return previewGroupId;
    const result = groupApi.createGroup(editGroupId);
    refreshGroupRefs();
    previewGroupId = result.previewGroupId;
    editGroupId = result.editGroupId;
    return result.groupId;
  }

  function deleteGroup(groupId: number) {
    if (!groupApi) return;
    const result = groupApi.deleteGroup(groupId, editGroupId);
    editGroupId = result.editGroupId;
    previewGroupId = result.previewGroupId;
  }

  function applyImportedGroups(groups: PPCFile["groups"]) {
    if (!groups || !groups.length) return;
    if (!groupApi) return;
    groupApi.applyImportedGroups(groups);
    refreshGroupRefs();
    previewGroupId = getPreviewGroupId();
  }

  function repaintAllFaces() {
    faceColorService.repaintAllFaces();
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
    seamManager?.dispose();
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
    seamManager?.applyVisibility();
  }

  function refreshSeamResolution() {
    seamManager?.refreshResolution();
  }

  function refreshVertexWorldPositions() {
    if (!vertexPositionsDirty) return;
    geometryIndex.refreshVertexWorldPositions(getModel());
    vertexKeyToPos = geometryIndex.getVertexKeyToPos();
    vertexPositionsDirty = false;
  }

  function initHoverLinesLocal() {
    createHoverLines(viewer, scene, hoverLines);
  }

  function disposeHoverLinesLocal() {
    disposeHoverLines(hoverLines);
    hoverState.hoveredFaceId = null;
  }

  const hoverState = { hoverLines, hoveredFaceId: null as number | null };
  appEventBus.on("groupDataChanged", () => syncGroupStateFromData());

  interactionController = initInteractionController({
    renderer,
    viewer,
    camera,
    controls,
    raycaster,
    pointer,
    getModel,
    facesVisible: () => facesVisible,
    canEdit: () => editGroupId !== null,
    pickFace,
    onAddFace: handleAddFace,
    onRemoveFace: handleRemoveFace,
    hoverState,
  });

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
        faceColorService.setFaceColor(mapping.mesh, mapping.localFace, scaled);
      });
      breathRaf = requestAnimationFrame(loop);
    };
    breathRaf = requestAnimationFrame(loop);
  }

  async function loadRawObject(file: File, ext: string) {
    const url = URL.createObjectURL(file);
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
      return { object, importedGroups, importedColorCursor };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function attachGroupApi(api: GroupApi) {
    groupApi = api;
  }

  function getSeamManagerDeps(): SeamManagerDeps {
    return {
      viewer,
      scene,
      getEdges: () => edges,
      getFaceAdjacency: () => faceAdjacency,
      getFaceGroupMap: () => faceGroupMap,
      getGroupTreeParent: () => groupTreeParent,
      getVertexKeyToPos: () => vertexKeyToPos,
      getGroupFaces: () => groupFaces,
      getEdgeWorldPositions: (edgeId) => geometryIndex.getEdgeWorldPositions(edgeId),
      isSeamsVisible: () => seamsVisible,
      refreshVertexWorldPositions: () => refreshVertexWorldPositions(),
    };
  }

  function attachSeamManager(manager: SeamManagerApi) {
    seamManager = manager;
  }

  async function applyLoadedModel(file: File, ext: string) {
    placeholder.classList.add("hidden");
    setStatus("加载中...", "info");

    try {
      const { object, importedGroups, importedColorCursor } = await loadRawObject(file, ext);

      clearModel();
      setModel(object);
      setLastFileName(file.name);
      const model = getModel();
      if (!model) throw new Error("模型初始化失败");
      generateFunctionalMaterials(model);
      geometryIndex.buildFromObject(model);
      faceAdjacency = geometryIndex.getFaceAdjacency();
      faceIndexMap = geometryIndex.getFaceIndexMap();
      meshFaceIdMap = geometryIndex.getMeshFaceIdMap();
      faceToEdges = geometryIndex.getFaceToEdges();
      edges = geometryIndex.getEdgesArray();
      edgeKeyToId = geometryIndex.getEdgeKeyToId();
      vertexKeyToPos = geometryIndex.getVertexKeyToPos();
      groupTreeParent = getGroupTreeParent();
      refreshGroupRefs();
      markVertexPositionsDirty();
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
      setLastTriangleCount(geometryIndex.getTriangleCount());
      fitCameraToObject(model, camera, controls);
      refreshVertexWorldPositions();
      showWorkspace(true);
      resizeRenderer(); // 确保从隐藏切换到可见后尺寸正确
      setStatus(`已加载：${file.name} · 三角面 ${geometryIndex.getTriangleCount()}`, "success");
      exportBtn.disabled = false;
      appEventBus.emit("modelLoaded", undefined);
    } catch (error) {
      console.error("加载模型失败", error);
      if ((error as Error)?.stack) {
        console.error((error as Error).stack);
      }
      setStatus("加载失败，请检查文件格式是否正确。", "error");
    }
  }

  async function loadModel(file: File, ext: string) {
    await applyLoadedModel(file, ext);
  }

  function getExtension(name: string) {
    const parts = name.split(".");
    return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    triCounter.textContent = `渲染三角形：${renderer.info.render.triangles}`;
  }

  resizeRenderer();
  animate();

  return {
    loadModel,
    clearModel,
    applyFaceVisibility,
    applyEdgeVisibility,
    dispose: () => {
      interactionController?.dispose();
      uiController.dispose();
    },
    setPreviewGroup,
    setEditGroup,
    changePreviewGroupColor,
    attachGroupApi,
    getGroupDeps,
    getSeamManagerDeps,
    attachSeamManager,
  };
}
