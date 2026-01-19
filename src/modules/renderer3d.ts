// 3D 渲染与交互层：负责 Three.js 场景、相机/光源、模型加载展示、拾取/hover/刷子交互，消费外部注入的组/拼缝接口，不持有业务状态。
import {
  Color,
  Vector3,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  MathUtils,
  Spherical,
  PerspectiveCamera,
  OrthographicCamera,
  Vector2,
  Group,
  AxesHelper,
  Scene,
  type Object3D,
  Box3Helper,
  Box3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  BufferAttribute,
  Vector2 as ThreeVector2,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { getModel, setModel, setLastFileName } from "./model";
import { load3dppc, type PPCFile } from "./ppc";
import { applySettings, resetSettings, getSettings } from "./settings";
import { createScene, fitCameraToObject } from "./scene";
import { FACE_DEFAULT_COLOR, createFrontMaterial, createPreviewMaterial, createEdgeMaterial, createHoverLineMaterial } from "./materials";
import {
  createRaycaster,
  initInteractionController,
  type HoverState,
} from "./interactions";
import { type EdgeRecord, generateFunctionalMeshes } from "./model";
import { createFaceColorService } from "./faceColorService";
import { createSeamManager } from "./seamManager";
import { createSpecialEdgeManager } from "./specialEdgeManager";
import { appEventBus } from "./eventBus";
import { type GeometryContext, createGeometryContext } from "./geometry";
import { getWorkspaceState } from "@/types/workspaceState";
import { isSafari } from "./utils";
import { disposeGroupDeep } from "./threeUtils";

export type GroupApi = {
  handleRemoveFace: (faceId: number) => void;
  handleAddFace: (faceId: number) => void;
  getGroupFaces: (groupId: number) => Set<number> | undefined;
  getGroupColor: (groupId: number) => Color | undefined;
  getFaceGroupMap: () => Map<number, number | null>;
  applyImportedGroups: (groups: PPCFile["groups"], groupColorCursor?: number) => void;
};

export function snapGeometryPositions(geometry: THREE.BufferGeometry, decimals = 5) {
  const factor = 10 ** decimals;
  const pos = geometry.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return;
  for (let i = 0; i < pos.count; i += 1) {
    const x = Math.round(pos.getX(i) * factor) / factor;
    const y = Math.round(pos.getY(i) * factor) / factor;
    const z = Math.round(pos.getZ(i) * factor) / factor;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function createRenderer3D(
  log: (msg: string, tone?: "info" | "error" | "success") => void,
  groupApi: GroupApi,
  geometryContext: GeometryContext,
  getViewport: () => { width: number; height: number },
  mountRenderer: (canvas: HTMLElement) => void,
) {
  const BREATH_PERIOD = 300; // ms
  const BREATH_CYCLES = 3; // 呼吸循环次数
  const BREATH_DURATION = BREATH_PERIOD * BREATH_CYCLES;
  const BREATH_SCALE = 0.4; // 呼吸幅度
  let edgesVisible = true;
  let seamsVisible = true;
  let facesVisible = true;
  const geometryIndex = geometryContext.geometryIndex;
  const angleIndex = geometryContext.angleIndex;
  const previewGeometryContext = createGeometryContext();
  let faceAdjacency = geometryIndex.getFaceAdjacency();
  let faceIndexMap = geometryIndex.getFaceIndexMap();
  let meshFaceIdMap = geometryIndex.getMeshFaceIdMap();
  let faceToEdges = geometryIndex.getFaceToEdges();
  let edges: EdgeRecord[] = geometryIndex.getEdgesArray();
  let edgeKeyToId = geometryIndex.getEdgeKeyToId();
  let vertexKeyToPos = geometryIndex.getVertexKeyToPos();
  const { raycaster, pointer } = createRaycaster();
  let breathGroupId: number | null = null;
  let breathStart = 0;
  let breathRaf: number | null = null;
  let gizmosVisible = true;
  let gizmosVisibleBeforePreview = false;
  
  const { scene, camera, renderer, controls, ambient, dir, modelGroup, previewModelGroup, gizmosGroup } = createScene((getViewport().width), getViewport().height);
  mountRenderer(renderer.domElement);
  gizmosGroup.visible = true;
  let bboxHelper: Box3Helper | null = null;
  let bboxBox: Box3 | null = null;
  let bboxLabels: Sprite[] = [];
  const hoverEdgeGeom = new LineSegmentsGeometry();
  hoverEdgeGeom.setPositions(new Float32Array(6));
  const hoverEdgeMat = createHoverLineMaterial({ width: getViewport().width, height: getViewport().height });
  const hoverEdgeLine = new LineSegments2(hoverEdgeGeom, hoverEdgeMat);
  hoverEdgeLine.visible = false;
  scene.add(hoverEdgeLine);

  const interactionController = initInteractionController({
    view: getViewport(),
    scene,
    renderer,
    camera,
    controls,
    raycaster,
    pointer,
    getModel,
    facesVisible: () => facesVisible,
    canEdit: () => getWorkspaceState() === "editingGroup",
    isPointerLocked: () => pointerLocked,
    pickFace,
    onAddFace: groupApi.handleAddFace,
    onRemoveFace: groupApi.handleRemoveFace,
    // hoverState,
    emitFaceHover: (faceId) => {
      if (faceId === null) {
        appEventBus.emit("faceHover3DClear", undefined);
        return;
      }
      appEventBus.emit("faceHover3D", faceId);
    },
  });

  const drawLabelTexture = (text: string, canvas?: HTMLCanvasElement) => {
    const cvs = canvas ?? document.createElement("canvas");
    cvs.width = 256;
    cvs.height = 128;
    const ctx = cvs.getContext("2d")!;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.font = "bold 72px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cvs.width / 2, cvs.height / 2);
    return cvs;
  };

  const createLabelSprite = (text: string) => {
    const canvas = document.createElement("canvas");
    drawLabelTexture(text, canvas);
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new Sprite(material);
    sprite.scale.set(1.5, 0.75, 1);
    return sprite;
  };

  const updateLabelPositions = () => {
    if (!bboxBox || bboxLabels.length !== 3) return;
    const center = bboxBox.getCenter(new Vector3());
    const min = bboxBox.min;
    const max = bboxBox.max;
    const camPos = camera.position;
    const pickNearest = (points: Vector3[]) => {
      let best = points[0];
      let bestDist = Infinity;
      points.forEach((p) => {
        const d = p.distanceTo(camPos);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      });
      return best;
    };
    const midX = (min.x + max.x) * 0.5;
    const midY = (min.y + max.y) * 0.5;
    const midZ = (min.z + max.z) * 0.5;
    const xPoints = [
      new Vector3(midX, min.y, min.z),
      new Vector3(midX, min.y, max.z),
      new Vector3(midX, max.y, min.z),
      new Vector3(midX, max.y, max.z),
    ];
    const yPoints = [
      new Vector3(min.x, midY, min.z),
      new Vector3(min.x, midY, max.z),
      new Vector3(max.x, midY, min.z),
      new Vector3(max.x, midY, max.z),
    ];
    const zPoints = [
      new Vector3(min.x, min.y, midZ),
      new Vector3(min.x, max.y, midZ),
      new Vector3(max.x, min.y, midZ),
      new Vector3(max.x, max.y, midZ),
    ];
    bboxLabels[0].position.copy(pickNearest(xPoints));
    bboxLabels[1].position.copy(pickNearest(yPoints));
    bboxLabels[2].position.copy(pickNearest(zPoints));
    // 让标签大小随相机距离缩放，保持可读性
    const dist = camera.position.distanceTo(controls.target);
    const scaleBase = Math.max(0.2, dist * 0.05);
    bboxLabels.forEach((s) => s.scale.set(scaleBase, scaleBase * 0.5, 1));
  };

  const onControlChanged = () => {
    const dist = camera.position.distanceTo(controls.target);
    const minNear = 0.01;
    const near = Math.max(minNear, dist * 0.002);
    const far = Math.max(near * 50, dist * 100);
    if (Math.abs(camera.near - near) > 1e-4 || Math.abs(camera.far - far) > 1e-2) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    updateLabelPositions();
  };
  controls.addEventListener("change", onControlChanged);
  onControlChanged();

  const seamManager = createSeamManager(
    modelGroup,
    getViewport,
    () => edges,
    () => groupApi.getFaceGroupMap(),
    () => vertexKeyToPos,
    (edgeId: number) => geometryIndex.getEdgeWorldPositions(edgeId),
    () => seamsVisible,
  );

  const specialEdgeManager = createSpecialEdgeManager(modelGroup, getViewport);

  function syncGroupStateFromData(groupId: number) {
    interactionController?.endBrush();
    stopGroupBreath();
    startGroupBreath(groupId);
  }

  const faceColorService = createFaceColorService({
    getFaceIndexMap: () => faceIndexMap,
    getFaceGroupMap: () => groupApi.getFaceGroupMap(),
    getGroupColor: groupApi.getGroupColor,
    defaultColor: FACE_DEFAULT_COLOR,
  });

  const axesScene = new Scene();
  const axesCamera = new PerspectiveCamera(50, 1, 0.1, 10);
  const axesHelper = new AxesHelper(1.2);
  axesScene.add(axesHelper);
  const tempVec = new Vector3();
  controls.panSpeed = 1;
  controls.rotateSpeed = 0.4;
  const el = renderer.domElement;
  previewModelGroup.visible = false;

  
  let previewCameraState: { position: Vector3; target: Vector3 } | null = null;

  function applyFrontMaterialToMeshes(root: Object3D) {
    const mat = createFrontMaterial();
    root.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional) return;
      mesh.material = mat.clone();
    });
  }

  function buildRenderableRoot(object: Object3D, name: string): Group {
    const root = new Group();
    root.name = name;
    root.add(object);
    applyFrontMaterialToMeshes(root);
    generateFunctionalMeshes(root, object);
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
    if (getWorkspaceState() === "editingGroup" && interactionController.getHoveredFaceId() !== null) return false;
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
    return worldPerPixel * panSpeed + 0.4;
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
    // console.debug("[pointer] down", { id: event.pointerId, button: event.button });
    if (!shouldLockPointer(event)) return;
    lockedButton = event.button;
    if (document.pointerLockElement !== el && !isSafari()) {
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
    // console.debug("[pointer] lock change", pointerLocked);
    if (pointerLocked) {
      interactionController.hideHoverLines();
    }
    if (!pointerLocked) {
      lockedButton = null;
      interactionController?.forceHoverCheck();
    }
  };
  const onWindowPointerMove = (event: PointerEvent) => {
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
  renderer.domElement.addEventListener("pointerdown", onCanvasPointerDown);
  renderer.domElement.addEventListener("pointerup", onWindowPointerUp);
  renderer.domElement.addEventListener("pointercancel", onWindowPointerUp);
  renderer.domElement.addEventListener("pointermove", onWindowPointerMove);
  document.addEventListener("pointerlockchange", onPointerLockChange);

  const objLoader = new OBJLoader();
  const fbxLoader = new FBXLoader();
  const stlLoader = new STLLoader();
  
  function clearModel() {
    stopGroupBreath();
    interactionController?.endBrush();
    disposeGroupDeep(modelGroup);
    disposeGroupDeep(previewModelGroup);
    disposeGroupDeep(gizmosGroup);
    previewModelGroup.visible = false;
    setModel(null);
    
    faceAdjacency.clear();
    faceIndexMap.clear();
    meshFaceIdMap.clear();
    geometryContext.reset();
    faceAdjacency = geometryIndex.getFaceAdjacency();
    faceIndexMap = geometryIndex.getFaceIndexMap();
    meshFaceIdMap = geometryIndex.getMeshFaceIdMap();
    faceToEdges = geometryIndex.getFaceToEdges();
    edges = geometryIndex.getEdgesArray();
    edgeKeyToId = geometryIndex.getEdgeKeyToId();
    vertexKeyToPos = geometryIndex.getVertexKeyToPos();
    seamManager?.dispose();
    specialEdgeManager?.dispose();
    interactionController.hideHoverLines();
    appEventBus.emit("modelCleared", undefined);
  }

  function getFaceIdFromIntersection(mesh: Mesh, localFace: number | undefined): number | null {
    return geometryIndex.getFaceId(mesh, localFace);
  }

  function pickFace(event: PointerEvent): number | null {
    if (previewModelGroup.visible) return null;
    const model = getModel();
    if (!model) return null;
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

  function applyFaceVisibility() {
    const model = getWorkspaceState() === "previewGroupModel" ? previewModelGroup : modelGroup;
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
  function resizeRenderer3D() {
    const { width, height } = getViewport();
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    axesCamera.aspect = 1;
    axesCamera.updateProjectionMatrix();
    const mat = hoverEdgeLine.material as any;
    mat.resolution?.set(w, h);
  }

  window.addEventListener("resize", resizeRenderer3D);

  function applyEdgeVisibility() {
    const model = getWorkspaceState() === "previewGroupModel" ? previewModelGroup : modelGroup;
    if (!model) return;
    model.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      if (mesh.userData.functional === "edge") {
        mesh.visible = edgesVisible;
      }
    });
  }

  function setSeamsVisibility(seamsVisible: boolean) {
    if (!getModel()) return;
    seamManager.setVisibility(seamsVisible);
  }

  const resetView = () => {
    const model = getWorkspaceState() === "previewGroupModel" ? previewModelGroup : modelGroup;
    if (!model) return;
    fitCameraToObject(model, camera, controls);
  };

  const toggleLight = () => {
    const enabled = !dir.visible;
    dir.visible = enabled;
    ambient.intensity = enabled ? 0.8 : 5;
    return enabled;
  };

  const toggleEdges = () => {
    edgesVisible = !edgesVisible;
    applyEdgeVisibility();
    return edgesVisible;
  };

  const toggleSeams = () => {
    seamsVisible = !seamsVisible;
    setSeamsVisibility(seamsVisible);
    return seamsVisible;
  };

  const toggleFaces = () => {
    facesVisible = !facesVisible;
    applyFaceVisibility();
    return facesVisible;
  };
  const toggleBBox = () => {
    gizmosVisible = !gizmosVisible;
    gizmosGroup.visible = gizmosVisible;
    return gizmosVisible;
  };
  const getBBoxVisible = () => gizmosVisible;

  let lastTriCount = 0;
  const getTriCount = () => lastTriCount;

  function rebuildSpecialEdges(targetRoot: Group, logSpecialEdges = true): Group {
    const usePreviewData = targetRoot === previewModelGroup;
    const specialEdgeGroup = usePreviewData ? new Group() : targetRoot;
    let openCount = 0;
    let nonManifoldCount = 0;
    if (usePreviewData) {
      const previewIdx = previewGeometryContext.geometryIndex;
      const res = specialEdgeManager.rebuild(
        specialEdgeGroup,
        () => previewIdx.getEdgesArray(),
        (edgeId: number) => previewIdx.getEdgeWorldPositions(edgeId),
        () => previewIdx.getVertexKeyToPos(),
      );
      openCount = res.openCount;
      nonManifoldCount = res.nonManifoldCount;
    } else {
      const res = specialEdgeManager.rebuild(
        specialEdgeGroup,
        () => edges,
        (edgeId: number) => geometryIndex.getEdgeWorldPositions(edgeId),
        () => vertexKeyToPos,
      );
      openCount = res.openCount;
      nonManifoldCount = res.nonManifoldCount;
    }
    if (logSpecialEdges) {
      if (openCount > 0 || nonManifoldCount > 0) {
        if (openCount > 0 && nonManifoldCount === 0) {
          log(`检测到 ${openCount} 条未封闭边`);
        } else if (openCount === 0 && nonManifoldCount > 0) {
          log(`检测到 ${nonManifoldCount} 条非流形边`);
        } else {
          log(`检测到 ${openCount} 条未封闭边，及 ${nonManifoldCount} 条非流形边`);
        }
      }
    }
    return specialEdgeGroup;
  }

  appEventBus.on("workspaceStateChanged", ({previous, current}) => {
    if (current === "normal" && previous === "previewGroupModel") {
      gizmosVisible = gizmosVisibleBeforePreview;
      gizmosGroup.visible = gizmosVisible;
      previewModelGroup.visible = false;
      modelGroup.visible = true;
      camera.position.copy(previewCameraState!.position);
      controls.target.copy(previewCameraState!.target);
      controls.update();
      previewCameraState = null;
      applyFaceVisibility();
      applyEdgeVisibility();
      setSeamsVisibility(seamsVisible);
      rebuildSpecialEdges(modelGroup, false);
    }
    if (current === "previewGroupModel") {
      interactionController.hideHoverLines();
      gizmosVisibleBeforePreview = gizmosVisible;
      gizmosVisible = false;
      gizmosGroup.visible = false;
      applyFaceVisibility();
      applyEdgeVisibility();
    }
  });
  appEventBus.on("groupCurrentChanged", (groupId: number) => syncGroupStateFromData(groupId));
  appEventBus.on("settingsChanged", () => {
    if (!bboxBox || bboxLabels.length !== 3) return;
    const { scale } = getSettings();
    const size = bboxBox.getSize(new Vector3()).multiplyScalar(scale);
    const texts = [`${Math.round(size.x)}`, `${Math.round(size.y)}`, `${Math.round(size.z)}`];
    bboxLabels.forEach((s, i) => {
      const mat = s.material as SpriteMaterial;
      const canvas = drawLabelTexture(texts[i], (mat.map as CanvasTexture).image as HTMLCanvasElement);
      (mat.map as CanvasTexture).image = canvas;
      (mat.map as CanvasTexture).needsUpdate = true;
    });
  });
  appEventBus.on("edgeHover2D", ({ p1, p2 }) => {
    // if (hoverState.hoveredFaceId !== null) return;
    (hoverEdgeLine.geometry as LineSegmentsGeometry).setPositions(
      new Float32Array([p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]]),
    );
    hoverEdgeLine.visible = true;
  });
  appEventBus.on("edgeHover2DClear", () => {
    hoverEdgeLine.visible = false;
  });

  function stopGroupBreath() {
    if (breathRaf !== null) {
      cancelAnimationFrame(breathRaf);
      breathRaf = null;
    }
    const gid = breathGroupId;
    breathGroupId = null;
    if (gid !== null) {
      const faces = groupApi.getGroupFaces(gid);
      faces?.forEach((faceId) => faceColorService.updateFaceColorById(faceId));
    }
  }

  function startGroupBreath(groupId: number) {
    stopGroupBreath();
    breathGroupId = groupId;
    breathStart = performance.now();
    const faces = groupApi.getGroupFaces(groupId);
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
        faces.forEach((faceId) => faceColorService.updateFaceColorById(faceId));
        stopGroupBreath();
        return;
      }
      const factor = (1 + BREATH_SCALE) + BREATH_SCALE * Math.sin((progress + 0.25) * Math.PI * 2 * BREATH_CYCLES);
      const baseColor = groupApi.getGroupColor(groupId)??FACE_DEFAULT_COLOR;
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
            snapGeometryPositions((child as Mesh).geometry);
          }
        });
        object = loaded;
        resetSettings();
      } else if (ext === "fbx") {
        const loaded = await fbxLoader.loadAsync(url);
        const mat = createFrontMaterial();
        loaded.traverse((child) => {
          if ((child as Mesh).isMesh) {
            (child as Mesh).material = mat.clone();
            snapGeometryPositions((child as Mesh).geometry);
          }
        });
        object = loaded;
        resetSettings();
      } else if (ext === "stl") {
        const geometry = await stlLoader.loadAsync(url);
        snapGeometryPositions(geometry);
        const material = createFrontMaterial();
        object = new Mesh(geometry, material);
        resetSettings();
      } else {
        const loaded = await load3dppc(url, createFrontMaterial());
        object = loaded.object;
        importedGroups = loaded.groups;
        importedColorCursor = loaded.colorCursor;
        if (loaded.annotations && typeof loaded.annotations.settings === "object") {
          applySettings(loaded.annotations.settings as Record<string, number>);
        } else {
          resetSettings();
        }
      }
      appEventBus.emit("loadMeshStarted", undefined);
      return { object, importedGroups, importedColorCursor };
    } finally {
      URL.revokeObjectURL(url);
    }
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
    if (importedGroups && importedGroups.length) {
      groupApi.applyImportedGroups(importedGroups, importedColorCursor);
    }
    applyFaceVisibility();
    applyEdgeVisibility();
    modelGroup.add(model);
    fitCameraToObject(model, camera, controls);
    log(`已加载：${name} · 三角面 ${geometryIndex.getTriangleCount()}`, "success");
    appEventBus.emit("modelLoaded", undefined);
    rebuildSpecialEdges(modelGroup);
    bboxBox = new Box3().setFromObject(modelGroup);
    bboxHelper = new Box3Helper(bboxBox, new Color(0x00ff88));
    gizmosGroup.add(bboxHelper);
    const { scale } = getSettings();
    const size = bboxBox.getSize(new Vector3()).multiplyScalar(scale);
    bboxLabels = [
      createLabelSprite(size.x.toFixed(1)),
      createLabelSprite(size.y.toFixed(1)),
      createLabelSprite(size.z.toFixed(1)),
    ];
    bboxLabels.forEach((s) => gizmosGroup.add(s));
    updateLabelPositions();
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

  function loadPreviewModel(mesh: Mesh, angle: number) {
    disposeGroupDeep(previewModelGroup);
    mesh.material = createPreviewMaterial().clone();
    previewModelGroup.add(mesh);
    mesh.updateMatrixWorld(true);
    const geomWireframe = mesh.geometry.clone();
    const meshWireframe = new Mesh(geomWireframe, createEdgeMaterial());
    meshWireframe.position.copy(mesh.position);
    meshWireframe.quaternion.copy(mesh.quaternion);
    meshWireframe.scale.copy(mesh.scale);
    meshWireframe.updateMatrixWorld(true);
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
    previewGeometryContext.rebuildFromModel(previewModelGroup);
    const specialEdgesGroup = rebuildSpecialEdges(previewModelGroup);
    specialEdgesGroup.rotation.set(0,0,-angle);
    previewModelGroup.add(specialEdgesGroup)
  }

  function renderAxesInset() {
    const size = renderer.getSize(new Vector2());
    const inset = 150;
    const padding = 12;
    const left = size.x - inset - padding;
    const bottom = size.y - inset - padding;
    // 相机朝向跟随主相机方向
    tempVec.copy(camera.position).sub(controls.target).normalize().multiplyScalar(3);
    axesCamera.position.copy(tempVec);
    axesCamera.lookAt(axesScene.position);
    axesCamera.up.copy(camera.up);
    axesCamera.updateProjectionMatrix();

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setViewport(left, bottom, inset, inset);
    renderer.setScissor(left, bottom, inset, inset);
    renderer.render(axesScene, axesCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.autoClear = prevAutoClear;
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    const tris = renderer.info.render.triangles;
    renderAxesInset();
    lastTriCount = tris;
  }
  animate();

  return {
    loadPreviewModel,
    resetView,
    toggleLight,
    toggleEdges,
    toggleSeams,
    toggleFaces,
    toggleBBox,
    getBBoxVisible,
    applyLoadedModel,
    getTriCount,
    resizeRenderer3D,
    dispose: () => {
      interactionController?.dispose();
      el.removeEventListener("pointerdown", onCanvasPointerDown);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      window.removeEventListener("pointermove", onWindowPointerMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    },
  };
}
