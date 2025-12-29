// 模型状态：存储当前 Three.js 对象与最近文件名/三角面数量，作为全局数据源。
import type { Object3D } from "three";

type ModelState = {
  current: Object3D | null;
  lastFileName: string;
  lastTriangleCount: number;
};

const state: ModelState = {
  current: null,
  lastFileName: "model",
  lastTriangleCount: 0,
};

export function setModel(object: Object3D | null) {
  state.current = object;
}

export function getModel(): Object3D | null {
  return state.current;
}

export function setLastFileName(name: string) {
  state.lastFileName = name;
}

export function getLastFileName(): string {
  return state.lastFileName;
}

export function setLastTriangleCount(count: number) {
  state.lastTriangleCount = count;
}

export function getLastTriangleCount(): number {
  return state.lastTriangleCount;
}