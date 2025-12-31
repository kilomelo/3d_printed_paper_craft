// 几何上下文：集中管理 GeometryIndex 与 AngleIndex 的实例与生命周期，提供重建/重置入口供上层调度。
import type { Object3D } from "three";
import { GeometryIndex } from "./geometryIndex";
import { AngleIndex } from "./angleIndex";

export type GeometryContext = {
  geometryIndex: GeometryIndex;
  angleIndex: AngleIndex;
  rebuildFromModel: (model: Object3D | null) => void;
  reset: () => void;
};

export function createGeometryContext(): GeometryContext {
  const geometryIndex = new GeometryIndex();
  const angleIndex = new AngleIndex();

  const rebuildFromModel = (model: Object3D | null) => {
    geometryIndex.reset();
    angleIndex.clear();
    if (!model) return;
    geometryIndex.buildFromObject(model);
    angleIndex.setGeometryIndex(geometryIndex);
  };

  const reset = () => {
    geometryIndex.reset();
    angleIndex.clear();
  };

  return { geometryIndex, angleIndex, rebuildFromModel, reset };
}
