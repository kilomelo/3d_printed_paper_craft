// 交互控制器：统一管理 pointer 事件、刷子状态、拾取与面添加/移除回调，解耦渲染器与 DOM 事件。
import { Mesh, PerspectiveCamera, Raycaster, Vector2, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { HoverState, updateHoverLines, hideHoverLines } from "./interactions";

export type InteractionController = {
  endBrush: () => void;
  forceHoverCheck: () => void;
  dispose: () => void;
};

export type InteractionOptions = {
  renderer: WebGLRenderer;
  viewer: HTMLDivElement;
  camera: PerspectiveCamera;
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
  hoverState: HoverState;
};

export function initInteractionController(opts: InteractionOptions): InteractionController {
  let brushMode = false;
  let brushButton: number | null = null;
  let lastBrushedFace: number | null = null;
  let controlsEnabledBeforeBrush = true;
  let lastClientPos = { x: 0, y: 0 };

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

  const onPointerMove = (event: PointerEvent) => {
    if (opts.isPointerLocked()) {
      hideHoverLines(opts.hoverState);
      return;
    }
    const model = opts.getModel();
    if (!model || !opts.facesVisible()) return;
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

    hideHoverLines(opts.hoverState);

    if (!intersects.length) {
      if (brushMode) lastBrushedFace = null;
      return;
    }
    const hit = intersects[0];
    const mesh = hit.object as Mesh;
    const faceIndex = hit.faceIndex ?? -1;
    const faceId = opts.pickFace(event);
    if (brushMode && faceId !== lastBrushedFace) {
      if (faceId !== null) {
        if (brushButton === 0) opts.onAddFace(faceId);
        else if (brushButton === 2) opts.onRemoveFace(faceId);
      }
      lastBrushedFace = faceId;
    }
    if (faceId === null) return;
    updateHoverLines(mesh, faceIndex, faceId, opts.hoverState);
  };
  const forceHoverCheck = () => {
    const fakeEvent = new PointerEvent("pointermove", {
      clientX: lastClientPos.x,
      clientY: lastClientPos.y,
    });
    onPointerMove(fakeEvent);
  };

  const onPointerLeave = () => {
    hideHoverLines(opts.hoverState);
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
    dispose: () => {
      endBrush();
      opts.renderer.domElement.removeEventListener("pointermove", onPointerMove);
      opts.renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      opts.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      opts.renderer.domElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointerup", onWindowPointerUp);
    },
  };
}
