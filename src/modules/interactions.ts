// 交互辅助：创建 raycaster/hover 线、更新分辨率等低层交互工具函数。
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Vector2, Vector3, Mesh, Raycaster } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { v3 } from "../types/geometryTypes";
import { createHoverLineMaterial } from "./materials";
import { appEventBus } from "./eventBus";
import { getWorkspaceState } from "@/types/workspaceState";

export type HoverState = {
  hoverLines: LineSegments2[];
  hoveredFaceId: number | null;
};

export type InteractionOptions = {
  viewportSizeProvider: () => { width: number; height: number },
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  getModel: () => THREE.Object3D | null;
  mapFaceId: (mesh: Mesh, faceIndex: number | undefined) => number | null;
  isFaceVisible: (faceId: number) => boolean;
  facesVisible: () => boolean;
  canEdit: () => boolean;
  isPointerLocked: () => boolean;
  onAddFace: (faceId: number) => boolean;
  onRemoveFace: (faceId: number) => boolean;
  emitFaceHover?: (faceId: number | null) => void;
};


function createRaycaster() {
  return { raycaster: new Raycaster(), pointer: new Vector2() };
}

function getFaceVertexIndices(geometry: THREE.BufferGeometry, faceIndex: number): number[] {
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

// 交互控制器：统一管理 pointer 事件、刷子状态、拾取与面添加/移除回调，解耦渲染器与 DOM 事件。
export function initInteractionController(opts: InteractionOptions) {
  const { raycaster, pointer } = createRaycaster();
  let brushMode = -1;
  // brush过程中是否有效地修改过组数据
  let brushPaintedCnt: number = 0;
  let lastBrushedFace: number | null = null;
  let controlsEnabledBeforeBrush = true;
  let lastClientPos = { x: 0, y: 0 };
  const hoverState = { hoverLines: [], hoveredFaceId: null } as HoverState;

  const createHoverLines = () => {
    const { width, height } = opts.viewportSizeProvider();
    for (let i = 0; i < 3; i++) {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(new Float32Array(6));
      const mat = createHoverLineMaterial({ width: width, height: height });
      const line = new LineSegments2(geom, mat);
      line.computeLineDistances();
      line.visible = false;
      line.userData.functional = "hover";
      hoverState.hoverLines.push(line);
      opts.scene.add(line);
    }
  }
  createHoverLines();

  const startBrush = (button: number, initialFace: number | null) => {
    if (!opts.canEdit()) return;
    if (initialFace === null) return;
    brushMode = button;
    brushPaintedCnt = 0;
    lastBrushedFace = null;
    controlsEnabledBeforeBrush = opts.controls.enabled;
    opts.controls.enabled = false;
    if (button === 0) {
      if (opts.onAddFace(initialFace)) brushPaintedCnt++;
      appEventBus.emit("userOperation", { side: "left", op: "group-add-face", highlightDuration: 0 });
    } else if (button === 2) {
      if (opts.onRemoveFace(initialFace)) brushPaintedCnt--;
      appEventBus.emit("userOperation", { side: "left", op: "group-remove-face", highlightDuration: 0 });
    }
    lastBrushedFace = initialFace;
  };

  const endBrush = () => {
    if (brushMode === -1) return;
    appEventBus.emit("brushOperationDone", { facePaintedCnt: brushPaintedCnt });
    if (brushMode === 0) {
      appEventBus.emit("userOperationDone", { side: "left", op: "group-add-face" });
    } else if (brushMode === 2) {
      appEventBus.emit("userOperationDone", { side: "left", op: "group-remove-face" });
    }
    brushMode = -1;
    brushPaintedCnt = 0;
    lastBrushedFace = null;
    opts.controls.enabled = controlsEnabledBeforeBrush;
  };

  const disposeHoverLines = () => {
    hoverState.hoverLines.forEach((line) => {
      line.removeFromParent();
      (line.geometry as LineSegmentsGeometry).dispose();
      (line.material as any)?.dispose?.();
    });
    hoverState.hoverLines.length = 0;
  }

  const hideHoverLines = () => {
    if (hoverState.hoveredFaceId !== null) {
      hoverState.hoverLines.forEach((line) => {
        line.visible = false;
      });
      opts.emitFaceHover?.(null);
      hoverState.hoveredFaceId = null;
    }
  }

  const getHoveredFaceId = () => {
    return hoverState.hoveredFaceId;
  }

  const updateHoverLines = (
    mesh: Mesh | null,
    faceIndex: number | null,
    faceId: number | null,
  ) => {
    if (!mesh || faceIndex === null || faceIndex < 0 || faceId === null) {
      hideHoverLines();
      return;
    }
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) {
      hideHoverLines();
      return;
    }
    const indices = getFaceVertexIndices(geometry, faceIndex);
    const verts = indices.map((idx) => v3([position.getX(idx), position.getY(idx), position.getZ(idx)]).applyMatrix4(mesh.matrixWorld));
    const edges = [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const;
    edges.forEach(([a, b], i) => {
      const line = hoverState.hoverLines[i];
      if (!line) return;
      const arr = new Float32Array([
        verts[a].x,
        verts[a].y,
        verts[a].z,
        verts[b].x,
        verts[b].y,
        verts[b].z,
      ]);
      (line.geometry as LineSegmentsGeometry).setPositions(arr);
      line.visible = true;
    });
    hoverState.hoveredFaceId = faceId;
    opts.emitFaceHover?.(faceId);
  }

  const onPointerMove = (event: PointerEvent) => {
    if (opts.isPointerLocked() || getWorkspaceState() === "previewGroupModel") {
      hideHoverLines();
      return;
    }
    const hit = pickFaceAtEvent(event);
    if (!hit) {
      if (brushMode !== -1) lastBrushedFace = null;
      hideHoverLines();
      return;
    }
    const { mesh, faceIndex, faceId } = hit;
    if (faceId === null) {
      hideHoverLines();
      return;
    }
    if (brushMode!== -1) {
      if (faceId !== lastBrushedFace) {
        if (brushMode === 0) { 
          if (opts.onAddFace(faceId)) brushPaintedCnt++; 
        }
        else if (brushMode === 2) {
          if (opts.onRemoveFace(faceId)) brushPaintedCnt--; 
        }
        lastBrushedFace = faceId;
      }
    }
    else if (hoverState.hoveredFaceId !== faceId) {
      updateHoverLines(mesh, faceIndex, faceId);
    }
  };

  const pickFaceAtEvent = (event: PointerEvent): { mesh: Mesh; faceIndex: number; faceId: number | null } | null => {
    const model = opts.getModel();
    if (!model) return null;
    const rect = opts.renderer.domElement.getBoundingClientRect();
    lastClientPos.x = event.clientX;
    lastClientPos.y = event.clientY;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, opts.camera);
    const intersects = raycaster.intersectObject(model, true).filter((i) => {
      const mesh = i.object as Mesh;
      return mesh.isMesh && !mesh.userData.functional;
    });
    if (!intersects.length) return null;

    for (const hit of intersects) {
      const mesh = hit.object as Mesh;
      const faceIndex = hit.faceIndex ?? -1;
      if (faceIndex < 0) continue;
      const faceId = opts.mapFaceId(mesh, faceIndex);
      if (faceId === null) continue;
      if (!opts.isFaceVisible(faceId)) continue;
      return { mesh, faceIndex, faceId };
    }
    return null;
  }

  const updateHoverLinesResolution = () => {
    hoverState.hoverLines.forEach((line) => {
      const material = line.material as LineMaterial;
      const { width, height } = opts.viewportSizeProvider()
      material.resolution.set(width, height);
    });
  };
  const onWheel = (event: WheelEvent) => {
    forceHoverCheck();
  };
  const forceHoverCheck = () => {
    const fakeEvent = new PointerEvent("pointermove", {
      clientX: lastClientPos.x,
      clientY: lastClientPos.y,
    });
    onPointerMove(fakeEvent);
  };

  const onPointerLeave = () => {
    hideHoverLines();
    opts.emitFaceHover?.(null);
  };

  const onPointerDown = (event: PointerEvent) => {
    try {
      opts.renderer.domElement.setPointerCapture(event.pointerId);
    } catch (e) {
      // ignore capture failures
    }
    if (!opts.getModel() || !opts.canEdit()) return;
    const hit = pickFaceAtEvent(event);
    if (!hit) return;
    if (hit.faceId === null) return;
    startBrush(event.button, hit.faceId);
  };

  const onPointerUp = (event: PointerEvent) => {
    try {
      opts.renderer.domElement.releasePointerCapture(event.pointerId);
    } catch (e) {
      // ignore release failures
    }
    if (brushMode !== -1) endBrush();
  };

  opts.renderer.domElement.addEventListener("pointermove", onPointerMove);
  opts.renderer.domElement.addEventListener("wheel", onWheel, { passive: true });
  opts.renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  opts.renderer.domElement.addEventListener("pointerdown", onPointerDown);
  opts.renderer.domElement.addEventListener("pointerup", onPointerUp);
  opts.renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  opts.renderer.domElement.addEventListener("resize", updateHoverLinesResolution);

  return {
    endBrush,
    forceHoverCheck,
    createHoverLines,
    hideHoverLines,
    getHoveredFaceId,
    dispose: () => {
      endBrush();
      opts.renderer.domElement.removeEventListener("pointermove", onPointerMove);
      opts.renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      opts.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      opts.renderer.domElement.removeEventListener("pointerup", onPointerUp);
      opts.renderer.domElement.removeEventListener("pointerup", onPointerUp);
      opts.renderer.domElement.removeEventListener("resize", updateHoverLinesResolution);
      disposeHoverLines();
    },
  };
}
