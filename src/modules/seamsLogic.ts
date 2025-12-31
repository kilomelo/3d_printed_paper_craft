// 拼缝判定与重建：根据面/组关系判断是否为拼缝边，生成/更新线段数据，并支持可见性与分辨率调整。
import { Scene, Vector3 } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { EdgeRecord } from "./modelLoader";
import { createSeamLine, updateSeamResolution } from "./seams";

export type SeamContext = {
  viewer: HTMLDivElement;
  scene: Scene;
  seamLines: Map<number, LineSegments2>;
  edges: EdgeRecord[];
  faceAdjacency: Map<number, Set<number>>;
  faceGroupMap: Map<number, number | null>;
  groupTreeParent: Map<number, Map<number, number | null>>;
  vertexKeyToPos: Map<string, Vector3>;
  seamsVisible: boolean;
  getEdgeWorldPositions?: (edgeId: number) => [Vector3, Vector3] | null;
};

function isParentChildEdge(f1: number, f2: number, ctx: SeamContext): boolean {
  const g1 = ctx.faceGroupMap.get(f1);
  const g2 = ctx.faceGroupMap.get(f2);
  if (g1 === null || g2 === null || g1 !== g2) return false;
  const parentMap = ctx.groupTreeParent.get(g1);
  if (!parentMap) return false;
  return parentMap.get(f1) === f2 || parentMap.get(f2) === f1;
}

function edgeIsSeam(edgeId: number, ctx: SeamContext): boolean {
  const edge = ctx.edges[edgeId];
  if (!edge) return false;
  const faces = Array.from(edge.faces);
  if (faces.length === 1) return false;
  if (faces.length !== 2) return true;
  const [f1, f2] = faces;
  const g1 = ctx.faceGroupMap.get(f1) ?? null;
  const g2 = ctx.faceGroupMap.get(f2) ?? null;
  if (g1 === null && g2 === null) return false;
  if (g1 === null || g2 === null) return true;
  if (g1 !== g2) return true;
  return !isParentChildEdge(f1, f2, ctx);
}

function ensureSeamLine(edgeId: number, ctx: SeamContext): LineSegments2 {
  const existing = ctx.seamLines.get(edgeId);
  if (existing) return existing;
  return createSeamLine(edgeId, ctx.viewer, ctx.scene, ctx.seamLines);
}

function updateSeamLine(edgeId: number, visible: boolean, ctx: SeamContext) {
  const edge = ctx.edges[edgeId];
  if (!edge) return;
  let v1: Vector3 | undefined | null;
  let v2: Vector3 | undefined | null;
  if (ctx.getEdgeWorldPositions) {
    const res = ctx.getEdgeWorldPositions(edgeId);
    if (!res) return;
    [v1, v2] = res;
  } else {
    v1 = ctx.vertexKeyToPos.get(edge.vertices[0]);
    v2 = ctx.vertexKeyToPos.get(edge.vertices[1]);
    if (!v1 || !v2) return;
  }
  const line = ensureSeamLine(edgeId, ctx);
  const arr = new Float32Array([v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
  // @ts-expect-error geometry type from LineSegments2
  line.geometry.setPositions(arr);
  line.computeLineDistances();
  line.visible = visible && ctx.seamsVisible;
  line.userData.isSeam = visible;
}

export function applySeamsVisibility(ctx: SeamContext) {
  ctx.seamLines.forEach((line) => {
    line.visible = ctx.seamsVisible && line.userData.isSeam;
  });
}

export function refreshSeamResolution(ctx: SeamContext) {
  updateSeamResolution(ctx.viewer, ctx.seamLines);
}

export function rebuildSeamsFull(ctx: SeamContext) {
  console.debug("[seam] rebuild full");
  ctx.edges.forEach((_, edgeId) => {
    const isSeam = edgeIsSeam(edgeId, ctx);
    updateSeamLine(edgeId, isSeam, ctx);
  });
  applySeamsVisibility(ctx);
  refreshSeamResolution(ctx);
}

export function rebuildSeamsForGroups(groupIds: Set<number>, ctx: SeamContext, groupFaces: Map<number, Set<number>>) {
  if (groupIds.size === 0) return;
  console.debug("[seam] rebuild partial", { groups: Array.from(groupIds) });
  const faceIds = new Set<number>(Array.from(groupIds).flatMap((gid) => Array.from(groupFaces.get(gid) ?? [])));
  rebuildSeamsForFaces(faceIds, ctx);
}

export function rebuildSeamsForFaces(faceIds: Set<number>, ctx: SeamContext) {
  if (faceIds.size === 0) return;
  console.debug("[seam] rebuild faces", { faces: Array.from(faceIds) });
  ctx.edges.forEach((edge, edgeId) => {
    let related = false;
    edge.faces.forEach((f) => {
      if (faceIds.has(f)) related = true;
    });
    if (!related) return;
    const isSeam = edgeIsSeam(edgeId, ctx);
    updateSeamLine(edgeId, isSeam, ctx);
  });
  applySeamsVisibility(ctx);
  refreshSeamResolution(ctx);
}