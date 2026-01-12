// 全局事件总线：为模型加载、拼缝重建、组数据变更等提供订阅/发布机制，解耦模块间调用。
import { type WorkspaceState } from "../types/workspaceState.js";
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
  loadMeshStarted: void;
  workspaceStateChanged: {previous: WorkspaceState, current: WorkspaceState};
  modelLoaded: void;
  modelCleared: void;
  groupRemoved: { groupId: number; groupName: string; faces: Set<number> };
  groupAdded: { groupId: number; groupName: string };
  groupColorChanged: { groupId: number; color: THREE.Color };
  groupNameChanged: { groupId: number; name: string };
  groupCurrentChanged: number;
  groupFaceAdded: { groupId: number; faceId: number };
  groupFaceRemoved: { groupId: number; faceId: number };
  groupPlaceAngleChanged: { groupId: number; newAngle: number; oldAngle: number };
  workerBusyChange: boolean;
  settingsChanged: Partial<import("./settings.js").Settings>;
};

export const appEventBus = createEventBus<AppEvents>();
