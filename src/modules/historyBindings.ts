// 历史系统相关的事件绑定与面板创建：收口会推入历史、回放历史、刷新历史 UI 的编排逻辑。
import { appEventBus } from "./eventBus";
import { historyManager } from "./history";
import { createHistoryPanel, formatHistoryAction } from "./historyPanel";
import type { ProjectState, Snapshot } from "../types/historyTypes.js";
import type { MetaAction } from "../types/historyTypes.js";
import type { createPreviewMeshCacheManager } from "./previewMeshCache";
import type { EdgeJoinType } from "../types/geometryTypes.js";

type HistoryPanelUI = ReturnType<typeof createHistoryPanel>;

type BindHistorySystemOptions = {
  panel: HTMLElement | null;
  list: HTMLElement | null;
  renderGroupUI: () => void;
  captureProjectState: () => ProjectState;
  setFileSaved: (value: boolean) => void;
  previewMeshCacheManager: ReturnType<typeof createPreviewMeshCacheManager>;
  getPreviewGroupId: () => number;
  getPreviewGroupName: () => string;
  changeWorkspaceState: (state: "normal") => void;
  applyProjectState: (snapshot: Snapshot) => void;
  updateMenuState: () => void;
  onPreviewMeshCacheMutated?: () => void;
  log: (msg: string, tone?: "info" | "success" | "error" | "progress", persist?: boolean) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export const bindHistorySystem = (opts: BindHistorySystemOptions): HistoryPanelUI => {
  const renderHistoryPanel = () => historyPanelUI.render();

  appEventBus.on("groupAdded", ({ groupName }) => {
    opts.renderGroupUI();
    historyManager.push(opts.captureProjectState(), { name: "groupCreate", timestamp: Date.now(), payload: { name: groupName } });
    renderHistoryPanel();
    opts.setFileSaved(false);
  });

  appEventBus.on("groupRemoved", ({ groupName }) => {
    opts.renderGroupUI();
    const pushResult = historyManager.push(opts.captureProjectState(), { name: "groupDelete", timestamp: Date.now(), payload: { name: groupName } });
    if (pushResult) {
      opts.previewMeshCacheManager.abandonCurrentActiveCaches(historyManager.getCurrentSnapshotUid() ?? -1);
      opts.previewMeshCacheManager.rememberAbandonRule(pushResult.uid);
      opts.onPreviewMeshCacheMutated?.();
      renderHistoryPanel();
    }
    opts.setFileSaved(false);
  });

  appEventBus.on("groupNameChanged", ({ name }) => {
    opts.renderGroupUI();
    const pushResult = historyManager.push(opts.captureProjectState(), { name: "groupRename", timestamp: Date.now(), payload: { name } });
    if (pushResult) {
      renderHistoryPanel();
    }
    opts.setFileSaved(false);
  });

  appEventBus.on("brushOperationDone", ({ facePaintedCnt }) => {
    if (facePaintedCnt === 0) return;
    let pushResult: ReturnType<typeof historyManager.push> = null;
    if (facePaintedCnt > 0) {
      pushResult = historyManager.push(opts.captureProjectState(), {
        name: "faceAdd",
        timestamp: Date.now(),
        payload: { count: facePaintedCnt, group: opts.getPreviewGroupName() },
      });
    } else if (facePaintedCnt < 0) {
      pushResult = historyManager.push(opts.captureProjectState(), {
        name: "faceRemove",
        timestamp: Date.now(),
        payload: { count: -facePaintedCnt, group: opts.getPreviewGroupName() },
      });
    }
    // 一个组的拓扑变化可能会影响到其他组拼接边的舌片角度，所以需要全部清理。
    if (pushResult) {
      opts.previewMeshCacheManager.abandonCurrentActiveCaches(historyManager.getCurrentSnapshotUid() ?? -1);
      opts.previewMeshCacheManager.rememberAbandonRule(pushResult.uid);
      opts.onPreviewMeshCacheMutated?.();
      renderHistoryPanel();
    }
  });

  appEventBus.on("groupPlaceAngleRotateDone", ({ deltaAngle }) => {
    historyManager.push(opts.captureProjectState(), {
      name: "groupRotate",
      timestamp: Date.now(),
      payload: {
        angle: deltaAngle,
        stack: (actionA: MetaAction, actionB: MetaAction) => {
          if (!actionA.payload || !actionB.payload) return undefined;
          if (actionA.payload.groupId !== actionB.payload.groupId) return undefined;
          const angle = (actionA.payload.angle as number) + (actionB.payload.angle as number);
          return {
            name: actionB.name,
            timestamp: actionB.timestamp,
            payload: { groupId: actionB.payload.groupId, angle, stack: actionA.payload.stack },
          };
        },
        groupId: opts.getPreviewGroupId(),
      },
    });
    renderHistoryPanel();
  });

  appEventBus.on("settingsChanged", (changedItemCnt) => {
    const pushResult = historyManager.push(opts.captureProjectState(), { name: "settingsChange", timestamp: Date.now(), payload: { count: changedItemCnt } });
    if (pushResult) {
      opts.previewMeshCacheManager.abandonCurrentActiveCaches(historyManager.getCurrentSnapshotUid() ?? -1);
      opts.previewMeshCacheManager.rememberAbandonRule(pushResult.uid);
      opts.onPreviewMeshCacheMutated?.();
      renderHistoryPanel();
    }
    opts.setFileSaved(false);
  });

  appEventBus.on("seamJoinTypeChanged", ({ edgeKey, previous, current, affectedGroupIds }) => {
    // seam 编辑支持历史堆叠。
    // 这里按 edgeKey 做“最终态覆盖”合并：
    // - 同一条边在连续操作里被改多次时，保留最早 previous，更新最新 current；
    // - 不追求“改回原值则消除记录”，因为当前策略明确接受“有改动则该边变脏”。
    const pushResult = historyManager.push(opts.captureProjectState(), {
      name: "seamJoinTypeChange",
      timestamp: Date.now(),
      payload: {
        count: 1,
        changes: [{ edgeKey, previous, current }],
        affectedGroupIds: Array.from(new Set(affectedGroupIds)),
        stack: (actionA: MetaAction, actionB: MetaAction) => {
          const prevChanges = readSeamChanges(actionA.payload?.changes);
          const nextChanges = readSeamChanges(actionB.payload?.changes);
          if (prevChanges.length === 0 || nextChanges.length === 0) return undefined;

          const mergedByEdgeKey = new Map<string, { edgeKey: string; previous: EdgeJoinType; current: EdgeJoinType }>();
          prevChanges.forEach((change) => {
            mergedByEdgeKey.set(change.edgeKey, { ...change });
          });
          nextChanges.forEach((change) => {
            const existing = mergedByEdgeKey.get(change.edgeKey);
            if (!existing) {
              mergedByEdgeKey.set(change.edgeKey, { ...change });
              return;
            }
            existing.current = change.current;
          });

          const affectedGroupIds = new Set<number>();
          readAffectedGroupIds(actionA.payload?.affectedGroupIds).forEach((groupId) => affectedGroupIds.add(groupId));
          readAffectedGroupIds(actionB.payload?.affectedGroupIds).forEach((groupId) => affectedGroupIds.add(groupId));

          return {
            name: actionB.name,
            timestamp: actionB.timestamp,
            payload: {
              count: mergedByEdgeKey.size,
              changes: Array.from(mergedByEdgeKey.values()),
              affectedGroupIds: Array.from(affectedGroupIds),
              stack: actionA.payload?.stack,
            },
          };
        },
      },
    });

    if (!pushResult) return;

    // 先记录本次点击新增的“脏组”，再把被 stack 吞掉的旧 uid 规则迁移过来。
    // 这样最终 surviving uid 上会保留整个堆叠链的受影响组并集，redo 才能正确重放失效。
    opts.previewMeshCacheManager.abandonCurrentActiveCaches(pushResult.uid, affectedGroupIds);
    opts.previewMeshCacheManager.rememberAbandonRule(pushResult.uid, affectedGroupIds);
    if (pushResult.stackedFromUid) {
      opts.previewMeshCacheManager.moveAbandonRule(pushResult.stackedFromUid, pushResult.uid);
    }
    opts.onPreviewMeshCacheMutated?.();
    renderHistoryPanel();
    opts.setFileSaved(false);
  });

  appEventBus.on("historyApplySnapshot", ({ current, direction, snapPassed }) => {
    opts.changeWorkspaceState("normal");
    opts.applyProjectState(current);
    if (direction === "redo") {
      opts.previewMeshCacheManager.applyRedoPassedHistory(snapPassed);
    }
    opts.onPreviewMeshCacheMutated?.();
    historyManager.markApplied(current.action);
    const desc = formatHistoryAction(current.action);
    const minutesAgo = Math.floor((Date.now() - current.action.timestamp) / 60000);
    opts.log(opts.t("log.history.rewind", { desc, minutes: minutesAgo }), "info", false);
    opts.setFileSaved(false);
  });

  appEventBus.on("historyApplied", () => {
    opts.renderGroupUI();
    opts.updateMenuState();
    renderHistoryPanel();
  });

  appEventBus.on("historyErased", (erasedHistoryUid) => {
    opts.previewMeshCacheManager.eraseHistory(erasedHistoryUid);
    opts.onPreviewMeshCacheMutated?.();
  });

  const historyPanelUI = createHistoryPanel(
    { panel: opts.panel, list: opts.list },
    () => historyManager.getSnapshots(),
    () => historyManager.getUndoSteps(),
    (snapUid) => {
      historyManager.applySnapshot(snapUid);
    },
  );

  historyPanelUI.render();
  return historyPanelUI;
};

function readSeamChanges(raw: unknown): { edgeKey: string; previous: EdgeJoinType; current: EdgeJoinType }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { edgeKey, previous, current } = item as Record<string, unknown>;
    if (typeof edgeKey !== "string") return [];
    if (!isEdgeJoinType(previous) || !isEdgeJoinType(current)) return [];
    return [{ edgeKey, previous, current }];
  });
}

function readAffectedGroupIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is number => Number.isFinite(item));
}

function isEdgeJoinType(value: unknown): value is EdgeJoinType {
  return value === "default" || value === "clip" || value === "interlocking";
}
