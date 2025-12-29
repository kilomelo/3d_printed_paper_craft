import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Vector2, Vector3, Mesh, Raycaster } from "three";

export type HoverState = {
  hoverLines: LineSegments2[];
  hoveredFaceId: number | null;
};

export function createHoverLines(viewer: HTMLDivElement, scene: THREE.Scene, hoverLines: LineSegments2[]) {
  if (hoverLines.length) return;
  for (let i = 0; i < 3; i++) {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(new Float32Array(6));
    const mat = new LineMaterial({
      color: 0xffa500,
      linewidth: 5,
      resolution: new Vector2(viewer.clientWidth, viewer.clientHeight),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 2,
    });
    const line = new LineSegments2(geom, mat);
    line.computeLineDistances();
    line.visible = false;
    line.userData.functional = "hover";
    hoverLines.push(line);
    scene.add(line);
  }
}

export function disposeHoverLines(hoverLines: LineSegments2[]) {
  hoverLines.forEach((line) => {
    line.removeFromParent();
    (line.geometry as LineSegmentsGeometry).dispose();
    (line.material as LineMaterial).dispose();
  });
  hoverLines.length = 0;
}

export function updateHoverResolution(viewer: HTMLDivElement, hoverLines: LineSegments2[]) {
  const { clientWidth, clientHeight } = viewer;
  hoverLines.forEach((line) => {
    const mat = line.material as LineMaterial;
    mat.resolution.set(clientWidth, clientHeight);
  });
}

export function hideHoverLines(state: HoverState) {
  state.hoverLines.forEach((line) => {
    line.visible = false;
  });
  state.hoveredFaceId = null;
}

export function updateHoverLines(mesh: Mesh | null, faceIndex: number | null, faceId: number | null, state: HoverState) {
  if (!mesh || faceIndex === null || faceIndex < 0 || faceId === null) {
    hideHoverLines(state);
    return;
  }
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) {
    hideHoverLines(state);
    return;
  }
  const indices = getFaceVertexIndices(geometry, faceIndex);
  const verts = indices.map((idx) =>
    new Vector3(position.getX(idx), position.getY(idx), position.getZ(idx)).applyMatrix4(mesh.matrixWorld),
  );
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const;
  edges.forEach(([a, b], i) => {
    const line = state.hoverLines[i];
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
  state.hoveredFaceId = faceId;
}

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
// 交互辅助：创建 raycaster/hover 线、更新分辨率等低层交互工具函数。
