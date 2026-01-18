// 2D 展开预览渲染器：在右侧区域创建正交相机的 Three.js 场景，用于后续绘制展开组三角面与交互。
import { Group, OrthographicCamera, Scene, WebGLRenderer, Vector3, Vector2 } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { BBoxRuler, createScene2D } from "./scene";
import { appEventBus } from "./eventBus";
import { getWorkspaceState } from "@/types/workspaceState";
import { isSafari } from "./utils";
import { distancePointToSegment2, pointInSegmentRectangle2, rotate2 } from "./mathUtils";
import type { EdgeCache } from "./unfold2dManager";
import { createHoverLineMaterial } from "./materials";
import { disposeGroupDeep } from "./threeUtils";

type EdgeQueryProviders = {
  getEdges: () => Map<number, { edges: Map<number, EdgeCache[]>; medianEdgeLength: number }>;
  getBounds: () => { minX: number; maxX: number; minY: number; maxY: number } | null | undefined;
  getFaceIdToEdges: () => Map<number, [number, number, number]>;
  getPreviewGroupId: () => number;
};

export type Renderer2DContext = {
  scene: Scene;
  camera: OrthographicCamera;
  renderer: WebGLRenderer;
  root: Group;
  bboxRuler: BBoxRuler;
  setEdgeQueryProviders: (providers: EdgeQueryProviders) => void;
  setFaceHoverTargets: (targets: [LineSegments2, LineSegments2, LineSegments2]) => void;
  dispose: () => void;
};

export function createRenderer2D(
  getViewport: () => { width: number; height: number },
  mountRenderer: (canvas: HTMLElement) => void,
  getCurrentGroupPlaceAngle: () => number,
  updateCurrentGroupPlaceAngle: (deltaAngle: number) => void,
): Renderer2DContext {
  const { width, height } = getViewport();
  const { scene, camera, renderer, bboxRuler } = createScene2D(width, height);
  mountRenderer(renderer.domElement);
  const root = new Group();
  scene.add(root);
  const hoverLineGeom = new LineSegmentsGeometry();
  hoverLineGeom.setPositions(new Float32Array(6));
  const hoverLineMat = createHoverLineMaterial({ width, height });
  const hoverLine = new LineSegments2(hoverLineGeom, hoverLineMat);
  hoverLine.visible = false;
  scene.add(hoverLine);

  let isPanning = false;
  let isRotating = false;
  const panStart = { x: 0, y: 0 };
  let hoverFaceLines: [LineSegments2, LineSegments2, LineSegments2] | null = null;
  let edgeQueryProviders: EdgeQueryProviders | null = null;

  const cancelHoverLineState = () => {
    if (hoverLine) hoverLine.visible = false;
    appEventBus.emit("edgeHover2DClear", undefined);
    lastHitEdge = null;
  }
  const resizeRenderer2D = () => {
    const { width, height } = getViewport();
    renderer.setSize(width, height);
    camera.left = -width * 0.5;
    camera.right = width * 0.5;
    camera.top = height * 0.5;
    camera.bottom = -height * 0.5;
    camera.updateProjectionMatrix();
    // const mat = hoverLine.material as any;
    // mat.resolution?.set(width, height);
    // hoverFaceLines?.forEach((line) => {
    //   const m = line.material as any;
    //   m.resolution?.set(width, height);
    // });
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
    onPointerMove(new PointerEvent('pointermove', {
        movementX: 0,
        movementY: 0,
        clientX: event.clientX,
        clientY: event.clientY,
    }));
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

  const screenPosToWorldPos = (sx: number, sy: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((sy - rect.top) / rect.height) * 2 + 1;
    const worldX = camera.position.x + (ndcX * (camera.right - camera.left) * 0.5) / camera.zoom;
    const worldY = camera.position.y + (ndcY * (camera.top - camera.bottom) * 0.5) / camera.zoom;
    return { x: worldX, y: worldY };
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      if (!isSafari()) renderer.domElement.requestPointerLock?.();
      isPanning = true;
      panStart.x = event.clientX;
      panStart.y = event.clientY;
      cancelHoverLineState();
    } else if (event.button === 0 && getWorkspaceState() === "editingGroup") {
      if (!isSafari()) renderer.domElement.requestPointerLock?.();
      isRotating = true;
      cancelHoverLineState();
    }
  };
  let lastHitEdge: { groupId: number; edgeId: number; cache: EdgeCache } | null = null;
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
      const deltaAngle = event.movementX * 0.005;
      updateCurrentGroupPlaceAngle(deltaAngle);
      if (hoverLine && hoverLine.visible) {
        hoverLine.rotateOnAxis(new Vector3(0, 0, 1), deltaAngle);
      }
      return;
    }
    if (!edgeQueryProviders) return;
    const bounds = edgeQueryProviders.getBounds();
    if (!bounds) return;

    let margin = 2;
    const edgeData = edgeQueryProviders.getEdges();
    for (const [, { medianEdgeLength }] of edgeData) {
      if (medianEdgeLength > 0) {
        margin = medianEdgeLength * 0.05;
        break;
      }
    }
    const { x: wx, y: wy } = screenPosToWorldPos(event.clientX, event.clientY);
    const { minX, maxX, minY, maxY } = bounds;
    if (
      wx < minX - margin ||
      wx > maxX + margin ||
      wy < minY - margin ||
      wy > maxY + margin
    ) {
      if (lastHitEdge) {
        cancelHoverLineState();
      }
      lastHitEdge = null;
      return;
    }
    const [ worldX, worldY ] = rotate2([wx, wy], -getCurrentGroupPlaceAngle());
    let hitEdge:
      | { groupId: number; edgeId: number; cache: EdgeCache }
      | null = null;
    let minDist = Infinity;
    for (const [gid, data] of edgeData) {
      for (const [eid, edges] of data.edges) {
        for (const cache of edges) {
          const [p1, p2] = cache.unfoldedPos;

          const minBx = Math.min(p1.x, p2.x) - margin;
          const maxBx = Math.max(p1.x, p2.x) + margin;
          const minBy = Math.min(p1.y, p2.y) - margin;
          const maxBy = Math.max(p1.y, p2.y) + margin;
          if (worldX < minBx || worldX > maxBx || worldY < minBy || worldY > maxBy) continue;

          if (!pointInSegmentRectangle2([worldX, worldY], [p1.x, p1.y], [p2.x, p2.y], margin)) continue;

          const dist = distancePointToSegment2([worldX, worldY], [p1.x, p1.y], [p2.x, p2.y]);
          if (dist < minDist) {
            minDist = dist;
            hitEdge = { groupId: gid, edgeId: eid, cache };
          }
        }
      }
    }

    if (hitEdge) {
      if (lastHitEdge && lastHitEdge.groupId === hitEdge.groupId && lastHitEdge.edgeId === hitEdge.edgeId) return;
      lastHitEdge = hitEdge;
      const [p1, p2] = hitEdge.cache.unfoldedPos;
      const p1Rotated = rotate2([p1.x, p1.y], getCurrentGroupPlaceAngle());
      const p2Rotated = rotate2([p2.x, p2.y], getCurrentGroupPlaceAngle());
      (hoverLine.geometry as LineSegmentsGeometry).setPositions(
        new Float32Array([p1Rotated[0], p1Rotated[1], 1, p2Rotated[0], p2Rotated[1], 1]),
      );
      hoverLine.visible = true;
      hoverLine.rotation.set(0, 0, 0);
      const [o1, o2] = hitEdge.cache.origPos;
      appEventBus.emit("edgeHover2D", {
        groupId: hitEdge.groupId,
        edgeId: hitEdge.edgeId,
        p1: [o1.x, o1.y, o1.z],
        p2: [o2.x, o2.y, o2.z],
      });
    } else if (lastHitEdge) {
      cancelHoverLineState();
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
    onPointerMove(event);
  };

  const onPointerLeave = (event: PointerEvent) => {
    cancelHoverLineState();
  }

  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  const onHoverFace = (faceId: number | null) => {
    if (!hoverFaceLines) return;
    hoverFaceLines.forEach((l) => (l.visible = false));
    if (faceId === null) {
      return;
    }
    if (!edgeQueryProviders) return;
    const previewGroupId = edgeQueryProviders.getPreviewGroupId();
    const faceIdToEdges = edgeQueryProviders.getFaceIdToEdges();
    const cache = edgeQueryProviders.getEdges().get(previewGroupId)?.edges;
    if (!cache) return;

    const edgeIds = faceIdToEdges.get(faceId);
    edgeIds?.forEach((edgeId, idx) => {
      const rec = cache.get(edgeId);
      if (!rec || rec.length === 0) return;
      const [p1, p2] = rec[0].faceId === faceId ? rec[0].unfoldedPos : rec[rec.length - 1].unfoldedPos;
      const line = hoverFaceLines![idx];
      line.visible = true;
      const geom = line.geometry as LineSegmentsGeometry;
      const p1Rotated = rotate2([p1.x, p1.y], getCurrentGroupPlaceAngle());
      const p2Rotated = rotate2([p2.x, p2.y], getCurrentGroupPlaceAngle());
      geom.setPositions(new Float32Array([p1Rotated[0], p1Rotated[1], 1, p2Rotated[0], p2Rotated[1], 1]));
    });
  };
  appEventBus.on("faceHover3D", onHoverFace);
  appEventBus.on("faceHover3DClear", () => {
    hoverFaceLines?.forEach((l) => (l.visible = false));
  });
  let updateHoverFaceByFaceIdNextFrame: number | null = null;
  appEventBus.on("groupFaceAdded", ({ groupId, faceId }) => {
    updateHoverFaceByFaceIdNextFrame = faceId;
  });
  appEventBus.on("groupFaceRemoved", ({ groupId, faceId }) => {
    updateHoverFaceByFaceIdNextFrame = faceId;
  });

  const animate = () => {
    renderer.render(scene, camera);
    if (updateHoverFaceByFaceIdNextFrame !== null) {
      onHoverFace(updateHoverFaceByFaceIdNextFrame);
      updateHoverFaceByFaceIdNextFrame = null;
    }
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
    hoverLine.removeFromParent();
    (hoverLine.geometry as LineSegmentsGeometry).dispose();
    (hoverLine.material as any)?.dispose?.();
    if (hoverFaceLines) {
      hoverFaceLines.forEach((line) => {
        line.removeFromParent();
        (line.geometry as LineSegmentsGeometry).dispose();
        (line.material as any)?.dispose?.();
      });
    }
    hoverFaceLines = null;
    renderer.dispose();
    renderer.domElement.remove();
  };

  appEventBus.on("modelLoaded", resizeRenderer2D);

  const initHoverFaceLines = () => {
    if (hoverFaceLines) return;
    const makeLine = () => {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(new Float32Array(6));
      const mat = createHoverLineMaterial({ width, height });
      const line = new LineSegments2(geom, mat);
      line.visible = false;
      scene.add(line);
      return line;
    };
    hoverFaceLines = [makeLine(), makeLine(), makeLine()];
  };
  initHoverFaceLines();

  return {
    scene,
    camera,
    renderer,
    root,
    bboxRuler,
    setEdgeQueryProviders: (providers: EdgeQueryProviders) => {
      edgeQueryProviders = providers;
    },
    setFaceHoverTargets: (targets: [LineSegments2, LineSegments2, LineSegments2]) => {
      hoverFaceLines = targets;
    },
    dispose,
  };
}
