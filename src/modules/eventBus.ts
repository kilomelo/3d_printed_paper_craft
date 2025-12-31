// 全局事件总线：为模型加载、拼缝重建、组数据变更等提供订阅/发布机制，解耦模块间调用。
type Handler<T> = (payload: T) => void;

export type EventBus<Events extends Record<string, unknown>> = {
  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

export function createEventBus<Events extends Record<string, unknown>>(): EventBus<Events> {
  const listeners = new Map<keyof Events, Set<Handler<Events[keyof Events]>>>();

  return {
    on(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler as Handler<Events[keyof Events]>);
      return () => listeners.get(event)?.delete(handler as Handler<Events[keyof Events]>);
    },
    emit(event, payload) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      handlers.forEach((h) => h(payload));
    },
  };
}

export type AppEvents = {
  modelLoaded: void;
  seamsRebuildFull: void;
  seamsRebuildGroups: Set<number>;
  seamsRebuildFaces: Set<number>;
  groupDataChanged: void;
  group2dFaceAdded: { groupId: number; faceId: number };
  group2dFaceRemoved: { groupId: number; faceId: number };
};

export const appEventBus = createEventBus<AppEvents>();
