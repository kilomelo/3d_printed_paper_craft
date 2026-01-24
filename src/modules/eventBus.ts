// 全局事件总线：为模型加载、拼缝重建、组数据变更等提供订阅/发布机制，解耦模块间调用。
import { type WorkspaceState } from "../types/workspaceState.js";
import type { Point3D } from "../types/geometryTypes.js";
import type { MetaAction, Snapshot } from "../types/historyTypes.js";
type Handler<T> = (payload: T) => void;

export type EventBus<Events extends Record<string, unknown>> = {
  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

export function createEventBus<Events extends Record<string, unknown>>(): EventBus<Events> {
  const listeners = new Map<keyof Events, Set<Handler<Events[keyof Events]>>>();

  return {
    on(event, handler) {
      // console.trace(`[eventBus] register handler for event: ${String(event)}`);
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler as Handler<Events[keyof Events]>);
      return () => listeners.get(event)?.delete(handler as Handler<Events[keyof Events]>);
    },
    emit(event, payload) {
      // console.trace(`[eventBus] emit event: ${String(event)}`, payload);
      const handlers = listeners.get(event);
      if (!handlers) return;
      handlers.forEach((h) => h(payload));
    },
  };
}

export type AppEvents = {
  workspaceStateChanged: {previous: WorkspaceState, current: WorkspaceState};
  projectChanged: import("./project.js").ProjectInfo;
  clearAppStates: void;
  groupRemoved: { groupId: number; groupName: string; faces: Set<number> };
  groupAdded: { groupId: number; groupName: string };
  groupColorChanged: { groupId: number; color: THREE.Color };
  groupNameChanged: { groupId: number; name: string };
  groupCurrentChanged: number; // 新的当前组ID
  groupFaceAdded: { groupId: number; faceId: number };
  groupFaceRemoved: { groupId: number; faceId: number };
  brushOperationDone: { facePaintedCnt: number };
  groupPlaceAngleRotateDone: { deltaAngle: number };
  groupPlaceAngleChanged: { groupId: number; newAngle: number; oldAngle: number };
  workerBusyChange: boolean; // 是否有正在运行的 worker 任务
  settingsChanged: number; // 被修改的设置项数量
  edgeHover2D: { groupId: number; edgeId: number; p1: Point3D; p2: Point3D };
  edgeHover2DClear: void;
  faceHover3D: number | null; // 被 hover 的面 ID
  faceHover3DClear: void;
  historyApplySnapshot: { current: Snapshot; direction: "undo" | "redo"; snapPassed: number[] };
  historyApplied: MetaAction;
  historyErased: number[]; // 被抹掉的历史记录的uid
  userOperation: { side: "left" | "right" | "both"; op: string; highlightDuration?: number };
  userOperationDone: { side: "left" | "right" | "both"; op: string };
  groupVisibilityChanged: { groupId: number; visible: boolean };
};

export const appEventBus = createEventBus<AppEvents>();
