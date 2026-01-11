// 特殊边管理器：渲染未封闭边与非流形边的线段。
import { Vector2, Vector3, Group } from "three";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { type EdgeRecord } from "./model";

type SpecialType = "open" | "nonmanifold";

export function createSpecialEdgeManager(
  root: Group,
  viewportSizeProvider: () => { width: number; height: number },
) {
  const edgeLines = new Map<number, LineSegments2>();
  let currentRoot = root;

  const colors: Record<SpecialType, number> = {
    open: 0x7700dd, // purple
    nonmanifold: 0x00ffff, // cyan
  };
  const lineWidth: Record<SpecialType, number> = {
    open: 2,
    nonmanifold: 6,
  };
  const offsetUnits: Record<SpecialType, number> = {
    open: -1,
    nonmanifold: -4,
  };

  const disposeAll = () => {
    edgeLines.forEach((line) => {
      line.geometry.dispose();
      (line.material as LineMaterial).dispose();
      line.parent?.remove(line);
    });
    edgeLines.clear();
  };

  const ensureLine = (edgeId: number, type: SpecialType): LineSegments2 => {
    const existing = edgeLines.get(edgeId);
    if (existing) {
      if (existing.parent !== currentRoot) {
        existing.parent?.remove(existing);
        currentRoot.add(existing);
      }
      return existing;
    }
    const geom = new LineSegmentsGeometry();
    const { width, height } = viewportSizeProvider();
    const mat = new LineMaterial({
      color: colors[type],
      linewidth: lineWidth[type],
      resolution: new Vector2(width, height),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: offsetUnits[type],
    });
    const line = new LineSegments2(geom, mat);
    line.userData.specialType = type;
    line.renderOrder = 2;
    edgeLines.set(edgeId, line);
    currentRoot.add(line);
    return line;
  };

  const updateLine = (
    edgeId: number,
    type: SpecialType,
    getEdges: () => EdgeRecord[],
    getEdgeWorldPositions: ((edgeId: number) => [Vector3, Vector3] | null) | null,
    getVertexKeyToPos: () => Map<string, Vector3>,
  ) => {
    const edges = getEdges();
    const edge = edges[edgeId];
    if (!edge) return;
    const res = getEdgeWorldPositions ? getEdgeWorldPositions(edgeId) : null;
    const vertexKeyToPos = getVertexKeyToPos();
    let v1: Vector3 | undefined | null;
    let v2: Vector3 | undefined | null;
    if (res) {
      [v1, v2] = res;
    } else {
      v1 = vertexKeyToPos.get(edge.vertices[0]);
      v2 = vertexKeyToPos.get(edge.vertices[1]);
    }
    if (!v1 || !v2) return;
    const localV1 = v1.clone();
    const localV2 = v2.clone();
    currentRoot.worldToLocal(localV1);
    currentRoot.worldToLocal(localV2);
    const line = ensureLine(edgeId, type);
    const arr = new Float32Array([localV1.x, localV1.y, localV1.z, localV2.x, localV2.y, localV2.z]);
    line.geometry.setPositions(arr);
    line.computeLineDistances();
    line.visible = true;
  };

  const rebuild = (
    root: Group,
    getEdges: () => EdgeRecord[],
    getEdgeWorldPositions: ((edgeId: number) => [Vector3, Vector3] | null) | null,
    getVertexKeyToPos: () => Map<string, Vector3>,
  ) => {
    disposeAll();
    currentRoot = root;
    const edges = getEdges();
    let openCount = 0;
    let nonManifoldCount = 0;
    edges.forEach((edge, edgeId) => {
      const count = edge.faces.size;
      if (count === 1) {
        updateLine(edgeId, "open", getEdges, getEdgeWorldPositions, getVertexKeyToPos);
        openCount += 1;
      } else if (count > 2) {
        updateLine(edgeId, "nonmanifold", getEdges, getEdgeWorldPositions, getVertexKeyToPos);
        nonManifoldCount += 1;
      }
    });
    updateResolution();
    return { openCount, nonManifoldCount };
  };

  const updateResolution = () => {
    const { width, height } = viewportSizeProvider();
    edgeLines.forEach((line) => {
      const mat = line.material as LineMaterial;
      mat.resolution.set(width, height);
    });
  };

  return {
    rebuild,
    updateResolution,
    dispose: disposeAll,
  };
}
