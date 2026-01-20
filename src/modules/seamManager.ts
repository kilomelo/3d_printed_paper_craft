// 拼缝管理器：管理模型中的拼缝线的创建、更新和显示
import { Vector3, Object3D, Group } from "three";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { type EdgeRecord } from "./model";
import { appEventBus } from "./eventBus";
import { sharedEdgeIsSeam  } from "./groups";
import { createSeamLineMaterial } from "./materials";

export function createSeamManager(
  root: Group,
  viewportSizeProvider: () => { width: number; height: number },
  getEdges: () => EdgeRecord[],
  getFaceGroupMap: () => Map<number, number | null>,
  getVertexKeyToPos: () => Map<string, Vector3>,
  getEdgeWorldPositions: (edgeId: number) => [Vector3, Vector3] | null,
  isSeamsVisible: () => boolean,
) {
  const seamLines = new Map<number, LineSegments2>();

  const rebuildFull = () => {
    const edges = getEdges();
    edges.forEach((_, edgeId) => {
      const isSeam = edgeIsSeam(edgeId);
      updateSeamLine(edgeId, edges, isSeam, isSeamsVisible());
    });
  };

  function setVisibility(visible: boolean) {
    seamLines.forEach((line) => {
      line.visible = visible && line.userData.isSeam;
    });
  };

  appEventBus.on("projectChanged", rebuildFull);
  appEventBus.on("groupFaceAdded", ({groupId, faceId}) => rebuildFull());
  appEventBus.on("groupFaceRemoved", ({groupId, faceId}) => rebuildFull());
  appEventBus.on("groupRemoved", ({groupId, faces}) => rebuildFull());

  function edgeIsSeam(
    edgeId: number,
  ): boolean {
    const faceGroupMap = getFaceGroupMap();
    const edges = getEdges();
    const edge = edges[edgeId];
    if (!edge) return false;
    const faces = Array.from(edge.faces);
    if (faces.length === 1) return false;
    if (faces.length !== 2) return true;
    return sharedEdgeIsSeam(faces[0], faces[1]);
  }

  function ensureSeamLine(edgeId: number): LineSegments2 {
    const existing = seamLines.get(edgeId);
    if (existing) return existing;
    return createSeamLine(edgeId);
  }

  function updateSeamLine(edgeId: number, edges: EdgeRecord[], isSeam: boolean, visible: boolean) {
    if (!isSeam && !seamLines.has(edgeId)) return;
    const edge = edges[edgeId];
    if (!edge) return;
    let v1: Vector3 | undefined | null;
    let v2: Vector3 | undefined | null;
    if (getEdgeWorldPositions) {
      const res = getEdgeWorldPositions(edgeId);
      if (!res) return;
      [v1, v2] = res;
    } else {
      const vertexKeyToPos = getVertexKeyToPos();
      v1 = vertexKeyToPos.get(edge.vertices[0]);
      v2 = vertexKeyToPos.get(edge.vertices[1]);
      if (!v1 || !v2) return;
    }
    // 将世界坐标转换为根节点局部坐标，确保与模型根保持对齐
    const localV1 = v1.clone();
    const localV2 = v2.clone();
    root.worldToLocal(localV1);
    root.worldToLocal(localV2);
    const line = ensureSeamLine(edgeId);
    const arr = new Float32Array([localV1.x, localV1.y, localV1.z, localV2.x, localV2.y, localV2.z]);
    line.geometry.setPositions(arr);
    line.computeLineDistances();
    line.visible = visible && isSeam;
    line.userData.isSeam = isSeam;
  }

  function createSeamLine(edgeId: number) {
    const existing = seamLines.get(edgeId);
    if (existing) return existing;
    const geom = new LineSegmentsGeometry();
    const { width, height } = viewportSizeProvider()
    const mat = createSeamLineMaterial({ width, height });
    const line = new LineSegments2(geom, mat);
    line.userData.functional = "seam";
    line.renderOrder = 2;
    seamLines.set(edgeId, line);
    root.add(line);
    return line;
  }
  
  return {
    setVisibility,
    dispose: () => {
      seamLines.forEach((line) => {
        if (line.removeFromParent) line.removeFromParent();
        if (line.geometry?.dispose) line.geometry.dispose();
        if (line.material?.dispose) line.material.dispose();
      });
      seamLines.clear();
    },
  };
}
