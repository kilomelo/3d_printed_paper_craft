// 历史面板渲染：根据 HistoryManager 提供的快照列表，生成可视化条目。
import type { Snapshot } from "../types/historyTypes.js";

type HistoryPanelRefs = {
  panel: HTMLElement | null;
  list: HTMLElement | null;
};

export function createHistoryPanel(refs: HistoryPanelRefs, getSnapshots: () => Snapshot[]) {
  const render = () => {
    console.log("[HistoryPanel] render");
    const { panel, list } = refs;
    console.log("[HistoryPanel] refs:", panel, list);
    if (!panel || !list) return;
    const snaps = getSnapshots();
    console.log("[HistoryPanel] snapshots:", snaps.length);
    list.innerHTML = "";
    if (!snaps.length) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const items = [...snaps].reverse();
    items.forEach((snap) => {
      const entry = document.createElement("div");
      entry.className = "history-entry";
      entry.textContent = snap.action.name || "未命名操作";
      list.appendChild(entry);
    });
  };

  return { render };
}
