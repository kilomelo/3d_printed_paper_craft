// 历史面板渲染：根据 HistoryManager 提供的快照列表，生成可视化条目。
import type { Snapshot } from "../types/historyTypes.js";

type HistoryPanelRefs = {
  panel: HTMLElement | null;
  list: HTMLElement | null;
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
      entry.textContent = snap.action.description || snap.action.name || "未命名操作";
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
