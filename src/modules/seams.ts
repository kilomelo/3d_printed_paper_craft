import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Vector2, Vector3 } from "three";

export type SeamState = {
  seamLines: Map<number, LineSegments2>;
  vertexKeyToPos: Map<string, Vector3>;
  seamsVisible: boolean;
};

export function createSeamLine(edgeId: number, viewer: HTMLDivElement, scene: THREE.Scene, seamLines: Map<number, LineSegments2>) {
  const existing = seamLines.get(edgeId);
  if (existing) return existing;
  const geom = new LineSegmentsGeometry();
  const mat = new LineMaterial({
    color: 0x000000,
    linewidth: 5,
    resolution: new Vector2(viewer.clientWidth, viewer.clientHeight),
  });
  const line = new LineSegments2(geom, mat);
  line.userData.functional = "seam";
  line.renderOrder = 2;
  seamLines.set(edgeId, line);
  scene.add(line);
  return line;
}

export function updateSeamResolution(viewer: HTMLDivElement, seamLines: Map<number, LineSegments2>) {
  const { clientWidth, clientHeight } = viewer;
  seamLines.forEach((line) => {
    const material = line.material as LineMaterial;
    material.resolution.set(clientWidth, clientHeight);
  });
}
// 拼缝线段创建与更新：封装 LineSegments2 的构建、材质配置与分辨率更新。
