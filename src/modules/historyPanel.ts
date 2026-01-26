// 历史面板渲染：根据 HistoryManager 提供的快照列表，生成可视化条目。
import type { MetaAction, Snapshot } from "../types/historyTypes.js";
import { t } from "./i18n";

type HistoryPanelRefs = {
  panel: HTMLElement | null;
  list: HTMLElement | null;
};

// name 与 i18n key 的映射表
const ACTION_I18N_KEYS: Record<string, string> = {
  loadModel: "history.load.description",
  groupCreate: "history.group.add.description",
  groupDelete: "history.group.remove.description",
  groupRename: "history.group.rename.description",
  faceAdd: "history.face.add.description",
  faceRemove: "history.face.remove.description",
  groupRotate: "history.group.rotate.description",
  settingsChange: "history.settings.change.description",
};

const buildActionParams = (action: MetaAction): Record<string, string | number> => {
  const payload = action.payload ?? {};
  switch (action.name) {
    case "groupCreate":
    case "groupDelete":
    case "groupRename":
      return { name: (payload.name as string) ?? "" };
    case "faceAdd":
    case "faceRemove":
      return { count: (payload.count as number) ?? 0, group: (payload.group as string) ?? "" };
    case "groupRotate":
      return {
        angle: typeof payload.angle === "number" ? payload.angle.toFixed(1) : (payload.angle as string | number) ?? "",
      };
    case "settingsChange":
      return { count: (payload.count as number) ?? 0 };
    default:
      return payload as Record<string, string | number>;
  }
};

export const formatHistoryAction = (action: MetaAction) => {
  const key = ACTION_I18N_KEYS[action.name];
  if (!key) return action.name || "未命名操作";
  const params = buildActionParams(action);
  return t(key, params);
};

export function createHistoryPanel(
  refs: HistoryPanelRefs,
  getSnapshots: () => Snapshot[],
  getUndoSteps?: () => number,
  onEntryClick?: (snapUid: number) => void,
) {
  const render = () => {
    const { panel, list } = refs;
    if (!panel || !list) return;
    const snaps = getSnapshots();
    list.innerHTML = "";
    if (!snaps.length) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const items = [...snaps].reverse();
    const undoSteps = getUndoSteps ? getUndoSteps() ?? 0 : 0;
    const currentIdx = snaps.length - 1 - undoSteps;
    items.forEach((snap) => {
      const entry = document.createElement("div");
      entry.className = "history-entry";
      entry.textContent = formatHistoryAction(snap.action);
      const originalIdx = snaps.findIndex((s) => s.uid === snap.uid);
      if (originalIdx === currentIdx) {
        entry.classList.add("history-entry-current");
      } else if (originalIdx < currentIdx) {
        entry.classList.add("history-entry-past");
      } else if (originalIdx > currentIdx) {
        entry.classList.add("history-entry-future");
      }
      entry.addEventListener("click", () => {
        if (onEntryClick) onEntryClick(snap.uid);
      });
      list.appendChild(entry);
    });
  };

  return { render };
}
