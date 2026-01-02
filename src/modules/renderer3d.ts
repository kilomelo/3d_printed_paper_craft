// 3D 渲染与交互层：负责 Three.js 场景、相机/光源、模型加载展示、拾取/hover/刷子交互，消费外部注入的组/拼缝接口，不持有业务状态。
import { Color, Vector3, Mesh, MeshStandardMaterial, Quaternion, MathUtils, Spherical, PerspectiveCamera, OrthographicCamera, Group, type Object3D } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { getModel, setModel, setLastFileName } from "./model";
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
import { FACE_DEFAULT_COLOR, createFrontMaterial, createPreviewMaterial, createEdgeMaterial } from "./materials";
import { createHoverLines, disposeHoverLines, hideHoverLines, updateHoverResolution, createRaycaster, type HoverState } from "./interactions";
import { initInteractionController } from "./interactionController";
import {
  EdgeRecord,
  fitCameraToObject,
  generateFunctionalMaterials,
} from "./modelLoader";
import { createFaceColorService } from "./faceColorService";
import { type SeamManagerApi, type SeamManagerDeps } from "./seamManager";
import { initUIController } from "./uiController";
import { appEventBus } from "./eventBus";
import { type GeometryContext } from "./geometryContext";
// group UI 渲染与交互由外部注入，renderer3d 只调用回调

export type UIRefs = {
  viewer: HTMLDivElement;
  fileInput: HTMLInputElement;
  homeStartBtn: HTMLButtonElement;
  menuOpenBtn: HTMLButtonElement;
  resetViewBtn: HTMLButtonElement;
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
  log: (msg: string, tone?: "info" | "error" | "success") => void,
  geometryContext: GeometryContext,
  _groupUiHooks?: GroupUIHooks,
) {
  const {
    viewer,
    fileInput,
    homeStartBtn,
    menuOpenBtn,
    resetViewBtn,
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
  const geometryIndex = geometryContext.geometryIndex;
  const angleIndex = geometryContext.angleIndex;
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
  const hoverState: HoverState = { hoverLines, hoveredFaceId: null };
  let interactionController: ReturnType<typeof initInteractionController> | null = null;
  let breathGroupId: number | null = null;
  let breathStart = 0;
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

  const { scene, camera, renderer, controls, ambient, dir, modelGroup, previewModelGroup } = createScene(viewer);
  controls.panSpeed = 10;
  controls.rotateSpeed = 0.4;
  const el = renderer.domElement;
  previewModelGroup.visible = false;

  type WorkspaceState = "normal" | "editingGroup" | "previewGroupModel";
  let workspaceState: WorkspaceState = "normal";
  let lastNonPreviewState: WorkspaceState = "normal";
  let previewCameraState: { position: Vector3; target: Vector3 } | null = null;

  const setWorkspaceState = (state: WorkspaceState) => {
    workspaceState = state;
    if (state !== "previewGroupModel") {
      lastNonPreviewState = state;
    }
  };

  const getWorkspaceState = () => workspaceState;

  function applyFrontMaterialToMeshes(root: Object3D) {
    const mat = createFrontMaterial();
    root.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      mesh.material = mat.clone();
    });
  }

  function buildRenderableRoot(object: Object3D, name: string) {
    const root = new Group();
    root.name = name;
    root.add(object);
    applyFrontMaterialToMeshes(root);
    generateFunctionalMaterials(root, object);
    return root;
  }

  let pointerLocked = false;
  let lockedButton: number | null = null;
  const yAxisUp = new Vector3(0, 1, 0);
  const offset = new Vector3();
  const spherical = new Spherical();
  // 每次调用时基于当前 camera.up 计算（更稳），也可以缓存但要注意 up 变化
  const quat = new Quaternion();
  const quatInv = new Quaternion();
  const shouldLockPointer = (event: PointerEvent) => {
    const isPrimaryButton = event.button === 0 || event.button === 2;
    if (!isPrimaryButton) return false;
    // 编辑展开组时，若当前 hover 到可刷的面，优先进入刷子逻辑，避免误触发相机控制
    if (editGroupId !== null && hoverState.hoveredFaceId !== null) return false;
    return true;
  };
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const orbitRotate = (dTheta: number, dPhi: number) => {
    const cam = controls.object;

    // 1) offset = position - target
    offset.copy(cam.position).sub(controls.target);

    // 2) 把 camera.up 对齐到世界 y-up（OrbitControls 的关键）
    quat.setFromUnitVectors(cam.up, yAxisUp);
    quatInv.copy(quat).invert();
    offset.applyQuaternion(quat);

    // 3) spherical
    spherical.setFromVector3(offset);

    // 4) 角度增量：注意 OrbitControls 的符号（通常是减号）
    spherical.theta -= dTheta;
    spherical.phi   -= dPhi;

    // 5) 限制角度（如果你要完全一致，需使用 controls 的 min/max）
    spherical.theta = clamp(spherical.theta, controls.minAzimuthAngle, controls.maxAzimuthAngle);
    spherical.phi   = clamp(spherical.phi,   controls.minPolarAngle,   controls.maxPolarAngle);
    spherical.makeSafe();

    // 6) spherical -> offset，再旋回原坐标系
    offset.setFromSpherical(spherical);
    offset.applyQuaternion(quatInv);

    // 7) target + offset
    cam.position.copy(controls.target).add(offset);
    cam.lookAt(controls.target);

    // 如果你仍在使用 OrbitControls 实例，update() 会做它自己的收尾（阻尼/事件等）
    controls.update();
  };
  const getPanPerPixelPerspective = (cam: PerspectiveCamera, el: HTMLElement, panSpeed = 1) => {
    // 相机到 target 的距离决定“这一屏对应多少世界单位”
    const distance = cam.position.distanceTo(controls.target);

    // target 距离处的可视“世界高度”
    const worldHeight = 2 * distance * Math.tan(MathUtils.degToRad(cam.fov * 0.5));

    // 每像素的世界位移（OrbitControls 习惯用 el.clientHeight 来统一 X/Y 的手感）
    const worldPerPixel = worldHeight / el.clientHeight;

    return worldPerPixel * panSpeed;
  }
  const panOffset = new Vector3();
  const panLeftV = new Vector3();
  const panUpV = new Vector3();
  const orbitPan = (deltaX: number, deltaY: number) => {
    const cam = controls.object;
    const el = renderer.domElement;

    // 以“像素”为单位的移动：右拖应当让画面向右移动（即相机/target 向左平移）
    // OrbitControls 里一般会用 -deltaX / -deltaY 的符号体系
    const dx = -deltaX;
    const dy = -deltaY;

    // 相机局部坐标的 X/Y 轴方向（世界空间）
    // X轴：相机右方向；Y轴：相机上方向
    // 从相机矩阵取列向量比用 cross 更稳
    const te = cam.matrix.elements;
    // matrix 的第0列是相机的 X 轴方向
    panLeftV.set(te[0], te[1], te[2]).multiplyScalar(-1); // “left”方向
    // matrix 的第1列是相机的 Y 轴方向
    panUpV.set(te[4], te[5], te[6]);

    panOffset.set(0, 0, 0);

    if ((cam as any).isPerspectiveCamera) {
      const perspectiveCam = cam as PerspectiveCamera;

      // target 到 camera 的距离决定屏幕上同样像素对应的世界单位
      const distance = cam.position.distanceTo(controls.target);

      // 视口高度对应的世界高度（在 target 距离处）
      const worldHeight = 2 * distance * Math.tan((perspectiveCam.fov * Math.PI / 180) / 2);
      const worldPerPixel = worldHeight / el.clientHeight;

      panOffset
        .addScaledVector(panLeftV, dx * worldPerPixel)
        .addScaledVector(panUpV,   dy * worldPerPixel);

    } else if ((cam as any).isOrthographicCamera) {
      const orthoCam = cam as OrthographicCamera;

      // 正交相机：视口范围直接决定单位换算
      const worldPerPixelX = (orthoCam.right - orthoCam.left) / el.clientWidth;
      const worldPerPixelY = (orthoCam.top - orthoCam.bottom) / el.clientHeight;

      panOffset
        .addScaledVector(panLeftV, dx * worldPerPixelX)
        .addScaledVector(panUpV,   dy * worldPerPixelY);

    } else {
      // 其他相机类型：不处理
      return;
    }

    // 平移 target 和 camera（保持相对偏移不变）
    controls.target.add(panOffset);
    cam.position.add(panOffset);

    // 若使用 OrbitControls，本帧收尾
    cam.lookAt(controls.target);
    controls.update();
  };
  const onCanvasPointerDown = (event: PointerEvent) => {
    console.debug("[pointer] down", { id: event.pointerId, button: event.button });
    if (!shouldLockPointer(event)) return;
    lockedButton = event.button;
    if (document.pointerLockElement !== el) {
      el.requestPointerLock();
    }
  };
  const exitPointerLockIfNeeded = () => {
    if (document.pointerLockElement === el) {
      document.exitPointerLock();
    }
  };
  const onWindowPointerUp = (event: PointerEvent) => {
    exitPointerLockIfNeeded();
    lockedButton = null;
  };
  const onPointerLockChange = () => {
    pointerLocked = document.pointerLockElement === el;
    console.debug("[pointer] lock change", pointerLocked);
    if (pointerLocked) {
      hideHoverLines(hoverState);
    }
    if (!pointerLocked) {
      lockedButton = null;
      interactionController?.forceHoverCheck();
    }
  };
  const onGlobalPointerMove = (event: PointerEvent) => {
    if (!pointerLocked) return;
    const anglePerPixel = (2 * Math.PI / el.clientHeight) * controls.rotateSpeed;
    if (lockedButton === 0) {
      orbitRotate(event.movementX * anglePerPixel, event.movementY * anglePerPixel);
    } else if (lockedButton === 2) {
      const cam = controls.object as PerspectiveCamera;
      const panPerPixel = getPanPerPixelPerspective(cam, el, controls.panSpeed ?? 1);
      orbitPan(-event.movementX * panPerPixel, -event.movementY * panPerPixel);
      controls.update();
    }
  };
  el.addEventListener("pointerdown", onCanvasPointerDown);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerUp);
  window.addEventListener("pointermove", onGlobalPointerMove);
  document.addEventListener("pointerlockchange", onPointerLockChange);

  const objLoader = new OBJLoader();
  const fbxLoader = new FBXLoader();
  const stlLoader = new STLLoader();
  const allowedExtensions = ["obj", "fbx", "stl", "3dppc"];

  const uiController = initUIController(
    {
      fileInput,
      homeStartBtn,
      menuOpenBtn,
      resetViewBtn,
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
          log("不支持的格式，请选择 OBJ / FBX / STL。", "error");
          fileInput.value = "";
          return;
        }
        await applyLoadedModel(file, ext);
      },
      onHomeStart: () => fileInput.click(),
      onMenuOpen: () => fileInput.click(),
      onResetView: () => {
        const model = workspaceState === "previewGroupModel" ? previewModelGroup : modelGroup;
        if (!model) return;
        fitCameraToObject(model, camera, controls);
        refreshVertexWorldPositions();
      },
      onLightToggle: () => {
        const enabled = !dir.visible;
        dir.visible = enabled;
        ambient.intensity = enabled ? 0.8 : 5;
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
          log("没有可导出的模型", "error");
          return;
        }
        try {
          log("正在导出 .3dppc ...", "info");
          const data = await build3dppcData(model as Group);
          await download3dppc(data);
          log("导出成功", "success");
        } catch (error) {
          console.error("导出失败", error);
          log("导出失败，请重试。", "error");
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
    previewModelGroup.clear();
    previewModelGroup.visible = false;
    disposeSeams();
    disposeHoverLinesLocal();
    setModel(null);
    exportBtn.disabled = true;
    showWorkspace(false);
    faceAdjacency.clear();
    faceIndexMap.clear();
    meshFaceIdMap.clear();
    resetGroups();
    refreshGroupRefs();
    geometryContext.reset();
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
    seamManager?.dispose();
    hideHoverLines(hoverState);
    setEditGroupId(null);
    editGroupId = null;
    setWorkspaceState("normal");
    appEventBus.emit("modelCleared", undefined);
  }

  function getFaceIdFromIntersection(mesh: Mesh, localFace: number | undefined): number | null {
    return geometryIndex.getFaceId(mesh, localFace);
  }

  function updateFaceColorById(faceId: number) {
    faceColorService.updateFaceColorById(faceId);
  }

  function pickFace(event: PointerEvent): number | null {
    if (workspaceState === "previewGroupModel") return null;
    const model = getModel();
    if (!model || !facesVisible) return null;
    const rect = el.getBoundingClientRect();
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
    if (workspaceState === "previewGroupModel" && groupId !== null) return;
    interactionController?.endBrush();
    if (!groupApi) return;
    const result = groupApi.setEditGroup(groupId, editGroupId, previewGroupId);
    editGroupId = result.editGroupId;
    previewGroupId = result.previewGroupId;
    if (workspaceState !== "previewGroupModel") {
      setWorkspaceState(editGroupId === null ? "normal" : "editingGroup");
    }
  }

  function getGroupDeps() {
    return {
      getFaceAdjacency: () => faceAdjacency,
      refreshGroupRefs,
      repaintAllFaces: () => repaintAllFaces(),
      log,
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
    log(`预览展开组 ${groupId}`, "info");
    startGroupBreath(groupId);
  }

  function changePreviewGroupColor(color: Color) {
    groupApi?.applyGroupColor(previewGroupId, color);
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
    const model = workspaceState === "previewGroupModel" ? previewModelGroup : modelGroup;
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
    const model = workspaceState === "previewGroupModel" ? previewModelGroup : modelGroup;
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

  function setHoverLinesVisible(visible: boolean) {
    hoverLines.forEach((line) => {
      if (line) line.visible = visible;
    });
  }

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
    isPointerLocked: () => pointerLocked,
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
      getModelRoot: () => getModel(),
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

  async function applyObject(object: Object3D, name: string, importedGroups?: PPCFile["groups"], importedColorCursor?: number) {
    clearModel();
    setModel(buildRenderableRoot(object, "model-root"));
    setLastFileName(name);
    const model = getModel();
    if (!model) throw new Error("模型初始化失败");
    geometryContext.rebuildFromModel(model);
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
    fitCameraToObject(model, camera, controls);
    refreshVertexWorldPositions();
    showWorkspace(true);
    setWorkspaceState("normal");
    resizeRenderer(); // 确保从隐藏切换到可见后尺寸正确
    log(`已加载：${name} · 三角面 ${geometryIndex.getTriangleCount()}`, "success");
    exportBtn.disabled = false;
    appEventBus.emit("modelLoaded", undefined);
  }

  async function applyLoadedModel(file: File, ext: string) {
    log("加载中...", "info");

    try {
      const { object, importedGroups, importedColorCursor } = await loadRawObject(file, ext);
      await applyObject(object, file.name, importedGroups, importedColorCursor);
    } catch (error) {
      console.error("加载模型失败", error);
      if ((error as Error)?.stack) {
        console.error((error as Error).stack);
      }
      log("加载失败，请检查文件格式是否正确。", "error");
    }
  }

  function loadPreviewModel(mesh: Mesh) {
    previewModelGroup.clear();
    mesh.material = createPreviewMaterial().clone();
    previewModelGroup.add(mesh);
    const geomWireframe = mesh.geometry.clone();
    const meshWireframe = new Mesh(geomWireframe, createEdgeMaterial());
    meshWireframe.userData.functional = "edge";
    meshWireframe.castShadow = false;
    meshWireframe.receiveShadow = false;
    meshWireframe.name = mesh.name ? `${mesh.name}-wireframe` : "wireframe-only";
    previewModelGroup.add(meshWireframe);
    previewModelGroup.visible = true;
    modelGroup.visible = false;
    previewCameraState = {
      position: camera.position.clone(),
      target: controls.target.clone(),
    };
    fitCameraToObject(previewModelGroup, camera, controls);
    setWorkspaceState("previewGroupModel");
  }

  function clearPreviewModel() {
    previewModelGroup.clear();
    previewModelGroup.visible = false;
    modelGroup.visible = true;
    // setHoverLinesVisible(true);
    if (previewCameraState) {
      camera.position.copy(previewCameraState.position);
      controls.target.copy(previewCameraState.target);
      controls.update();
      previewCameraState = null;
    }
    setWorkspaceState(lastNonPreviewState);
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
    loadPreviewModel,
    clearPreviewModel,
    getWorkspaceState,
    resizeRenderer,
    clearModel,
    applyFaceVisibility,
    applyEdgeVisibility,
    dispose: () => {
      interactionController?.dispose();
      uiController.dispose();
      el.removeEventListener("pointerdown", onCanvasPointerDown);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      window.removeEventListener("pointermove", onGlobalPointerMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
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
