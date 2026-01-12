// 2D 展开预览渲染器：在右侧区域创建正交相机的 Three.js 场景，用于后续绘制展开组三角面与交互。
import { Group, OrthographicCamera, Scene, WebGLRenderer } from "three";
import { BBoxRuler, createScene2D } from "./scene";
import { appEventBus } from "./eventBus";
import type { Unfold2dManager } from "./unfold2dManager";
import { getWorkspaceState } from "@/types/workspaceState";
import { isSafari } from "./utils";

export type Renderer2DContext = {
  scene: Scene;
  camera: OrthographicCamera;
  renderer: WebGLRenderer;
  root: Group;
  bboxRuler: BBoxRuler;
  dispose: () => void;
};

export function createRenderer2D(
  getViewport: () => { width: number; height: number },
  mountRenderer: (canvas: HTMLElement) => void,
  updateCurrentGroupPlaceAngle: (deltaAngle: number) => void,
): Renderer2DContext {
  const { width, height } = getViewport();
  const { scene, camera, renderer, bboxRuler } = createScene2D(width, height);
  mountRenderer(renderer.domElement);
  const root = new Group();
  scene.add(root);

  let isPanning = false;
  let isRotating = false;
  const panStart = { x: 0, y: 0 };

  const resizeRenderer2D = () => {
    const { width, height } = getViewport();
    renderer.setSize(width, height);
    camera.left = -width * 0.5;
    camera.right = width * 0.5;
    camera.top = height * 0.5;
    camera.bottom = -height * 0.5;
    camera.updateProjectionMatrix();
  };
  
  window.addEventListener("resize", resizeRenderer2D);
  const onContextMenu = (e: Event) => e.preventDefault();
  renderer.domElement.addEventListener("contextmenu", onContextMenu);

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY;
    const scale = delta > 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(0.0001, camera.zoom * scale);
    camera.updateProjectionMatrix();
  };
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  const screenToWorldDelta = (dx: number, dy: number) => {
    // 将屏幕位移转换到相机平面上的位移
    const w = renderer.domElement.clientWidth || renderer.domElement.width || 1;
    const h = renderer.domElement.clientHeight || renderer.domElement.height || 1;
    const worldDx = (dx / w) * (camera.right - camera.left) / camera.zoom;
    const worldDy = (dy / h) * (camera.top - camera.bottom) / camera.zoom;
    return { x: worldDx, y: -worldDy };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      if (!isSafari()) renderer.domElement.requestPointerLock?.();
      isPanning = true;
      panStart.x = event.clientX;
      panStart.y = event.clientY;
    } else if (event.button === 0 && getWorkspaceState() === "editingGroup") {
      if (!isSafari()) renderer.domElement.requestPointerLock?.();
      isRotating = true;
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (isPanning) {
      const locked = document.pointerLockElement === renderer.domElement;
      const dx = locked ? event.movementX : event.clientX - panStart.x;
      const dy = locked ? event.movementY : event.clientY - panStart.y;
      const { x, y } = screenToWorldDelta(dx, dy);
      camera.position.x -= x;
      camera.position.y -= y;
      camera.updateProjectionMatrix();
      if (!locked) {
        panStart.x = event.clientX;
        panStart.y = event.clientY;
      }
      return;
    }
    if (isRotating) {
      updateCurrentGroupPlaceAngle(event.movementX * 0.005);
    }
  };

  const stopPan = () => {
    isPanning = false;
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    }
  };

  const stopRotate = () => {
    isRotating = false;
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    }
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.button === 2) {
      stopPan();
    } else if (event.button === 0) {
      stopRotate();
    }
  };

  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  const animate = () => {
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  animate();

  const dispose = () => {
    window.removeEventListener("resize", resizeRenderer2D);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    renderer.dispose();
    renderer.domElement.remove();
  };

  appEventBus.on("modelLoaded", resizeRenderer2D);

  return {
    scene,
    camera,
    renderer,
    root,
    bboxRuler,
    dispose,
  };
}
