// 拼缝管理器：桥接 seamsLogic 与运行态依赖（scene/viewer/geometry 索引等），提供全量/按组/按面重建、可见性与分辨率更新，并负责拼缝资源释放。
import { Scene, Vector3 } from "three";
import {
  applySeamsVisibility,
  rebuildSeamsForFaces,
  rebuildSeamsForGroups,
  rebuildSeamsFull,
  refreshSeamResolution,
  type SeamContext,
} from "./seamsLogic";
import { type EdgeRecord } from "./modelLoader";

export type SeamManagerDeps = {
  viewer: HTMLElement;
  scene: Scene;
  getEdges: () => EdgeRecord[];
  getFaceAdjacency: () => Map<number, Set<number>>;
  getFaceGroupMap: () => Map<number, number | null>;
  getGroupTreeParent: () => Map<number, Map<number, number | null>>;
  getVertexKeyToPos: () => Map<string, Vector3>;
  getGroupFaces: () => Map<number, Set<number>>;
  getEdgeWorldPositions: (edgeId: number) => [Vector3, Vector3] | null;
  isSeamsVisible: () => boolean;
  refreshVertexWorldPositions: () => void;
};

export function createSeamManager(deps: SeamManagerDeps) {
  const seamLines = new Map<number, any>();

  const context = (): SeamContext => ({
    viewer: deps.viewer,
    scene: deps.scene,
    seamLines,
    edges: deps.getEdges(),
    faceAdjacency: deps.getFaceAdjacency(),
    faceGroupMap: deps.getFaceGroupMap(),
    groupTreeParent: deps.getGroupTreeParent(),
    vertexKeyToPos: deps.getVertexKeyToPos(),
    seamsVisible: deps.isSeamsVisible(),
    getEdgeWorldPositions: deps.getEdgeWorldPositions,
  });

  const rebuildFull = () => {
    deps.refreshVertexWorldPositions();
    rebuildSeamsFull(context());
  };

  const rebuildGroups = (groupIds: Set<number>) => {
    if (groupIds.size === 0) return;
    deps.refreshVertexWorldPositions();
    rebuildSeamsForGroups(groupIds, context(), deps.getGroupFaces());
  };

  const rebuildFaces = (faceIds: Set<number>) => {
    if (faceIds.size === 0) return;
    deps.refreshVertexWorldPositions();
    rebuildSeamsForFaces(faceIds, context());
  };

  const applyVisibility = () => applySeamsVisibility(context());

  const refreshResolution = () => refreshSeamResolution(context());

  return {
    rebuildFull,
    rebuildGroups,
    rebuildFaces,
    applyVisibility,
    refreshResolution,
    hasSeams: () => seamLines.size > 0,
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

export type SeamManagerApi = ReturnType<typeof createSeamManager>;
