// 交互辅助：创建 raycaster/hover 线、更新分辨率等低层交互工具函数。
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Vector2, Vector3, Mesh, Raycaster } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { v3 } from "../types/geometryTypes";

export type HoverState = {
  hoverLines: LineSegments2[];
  hoveredFaceId: number | null;
};

export type InteractionOptions = {
  view: { width: number; height: number },
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  raycaster: Raycaster;
  pointer: Vector2;
  getModel: () => THREE.Object3D | null;
  facesVisible: () => boolean;
  canEdit: () => boolean;
  isPointerLocked: () => boolean;
  pickFace: (event: PointerEvent) => number | null;
  onAddFace: (faceId: number) => void;
  onRemoveFace: (faceId: number) => void;
  // hoverState: HoverState;
  emitFaceHover?: (faceId: number | null) => void;
};


export function createRaycaster() {
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
  let brushMode = false;
  let brushButton: number | null = null;
  let lastBrushedFace: number | null = null;
  let controlsEnabledBeforeBrush = true;
  let lastClientPos = { x: 0, y: 0 };
  const hoverState = { hoverLines: [], hoveredFaceId: null } as HoverState;

  const createHoverLines = () => {
    for (let i = 0; i < 3; i++) {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(new Float32Array(6));
      const mat = new LineMaterial({
        color: 0xffa500,
        linewidth: 5,
        resolution: new Vector2(opts.view.width, opts.view.height),
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -3,
      });
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
    brushMode = true;
    brushButton = button;
    lastBrushedFace = null;
    controlsEnabledBeforeBrush = opts.controls.enabled;
    opts.controls.enabled = false;
    if (button === 0) {
      opts.onAddFace(initialFace);
    } else if (button === 2) {
      opts.onRemoveFace(initialFace);
    }
    lastBrushedFace = initialFace;
  };

  const endBrush = () => {
    if (!brushMode) return;
    brushMode = false;
    brushButton = null;
    lastBrushedFace = null;
    opts.controls.enabled = controlsEnabledBeforeBrush;
  };

  const disposeHoverLines = () => {
    hoverState.hoverLines.forEach((line) => {
      line.removeFromParent();
      (line.geometry as LineSegmentsGeometry).dispose();
      (line.material as LineMaterial).dispose();
    });
    hoverState.hoverLines.length = 0;
  }

  const hideHoverLines = () => {
    hoverState.hoverLines.forEach((line) => {
      line.visible = false;
    });
    if (hoverState.hoveredFaceId !== null) {
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
    if (opts.isPointerLocked()) {
      hideHoverLines();
      return;
    }
    const model = opts.getModel();
    if (!model) return;
    const rect = opts.renderer.domElement.getBoundingClientRect();
    lastClientPos.x = event.clientX;
    lastClientPos.y = event.clientY;
    opts.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    opts.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    opts.raycaster.setFromCamera(opts.pointer, opts.camera);

    const intersects = opts.raycaster.intersectObject(model, true).filter((i) => {
      const mesh = i.object as Mesh;
      return mesh.isMesh && !mesh.userData.functional;
    });

    if (!intersects.length) {
      if (brushMode) lastBrushedFace = null;
      hideHoverLines();
      return;
    }
    const hit = intersects[0];
    const mesh = hit.object as Mesh;
    const faceIndex = hit.faceIndex ?? -1;
    const faceId = opts.pickFace(event);
    if (faceId === null) {
      hideHoverLines();
      return;
    }
    if (brushMode) {
      if (faceId !== lastBrushedFace) {
        if (brushButton === 0) opts.onAddFace(faceId);
        else if (brushButton === 2) opts.onRemoveFace(faceId);
        lastBrushedFace = faceId;
      }
    }
    else if (hoverState.hoveredFaceId !== faceId) {
      updateHoverLines(mesh, faceIndex, faceId);
    }
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
    const faceId = opts.pickFace(event);
    if (faceId === null) return;
    startBrush(event.button, faceId);
  };

  const onPointerUp = (event: PointerEvent) => {
    try {
      opts.renderer.domElement.releasePointerCapture(event.pointerId);
    } catch (e) {
      // ignore release failures
    }
    if (brushMode) endBrush();
  };

  const onWindowPointerUp = () => {
    if (brushMode) endBrush();
  };

  opts.renderer.domElement.addEventListener("pointermove", onPointerMove);
  opts.renderer.domElement.addEventListener("wheel", onWheel, { passive: true });
  opts.renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  opts.renderer.domElement.addEventListener("pointerdown", onPointerDown);
  opts.renderer.domElement.addEventListener("pointerup", onPointerUp);
  opts.renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  window.addEventListener("pointerup", onWindowPointerUp);

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
      window.removeEventListener("pointerup", onWindowPointerUp);
      disposeHoverLines();
    },
  };
}
