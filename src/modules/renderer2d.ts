// 2D 展开预览渲染器：在右侧区域创建正交相机的 Three.js 场景，用于后续绘制展开组三角面与交互。
import { Group } from "three";
import { createScene2D } from "./scene";

export type Renderer2DContext = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  root: Group;
  resize: () => void;
  dispose: () => void;
};

export function initRenderer2D(container: HTMLElement): Renderer2DContext {
  const { scene, camera, renderer } = createScene2D(container);
  const root = new Group();
  scene.add(root);

  let isPanning = false;
  const panStart = { x: 0, y: 0 };

  const resize = () => {
    const w = Math.max(1, container.clientWidth || container.offsetWidth || 1);
    const h = Math.max(1, container.clientHeight || container.offsetHeight || 1);
    renderer.setSize(w, h);
    camera.left = -w * 0.5;
    camera.right = w * 0.5;
    camera.top = h * 0.5;
    camera.bottom = -h * 0.5;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
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
    if (event.button !== 2) return;
    renderer.domElement.requestPointerLock?.();
    isPanning = true;
    panStart.x = event.clientX;
    panStart.y = event.clientY;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isPanning) return;
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
  };

  const stopPan = () => {
    isPanning = false;
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.button !== 2) return;
    stopPan();
  };

  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  const animate = () => {
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  animate();

  const dispose = () => {
    window.removeEventListener("resize", resize);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { scene, camera, renderer, root, resize, dispose };
}
