import { appEventBus } from "./eventBus";
import { t, onLanguageChanged } from "./i18n";
import type { WorkspaceState } from "../types/workspaceState";

type Side = "left" | "right";

type HintItem = { key: string; i18n: string };
type HintConfig = { left: HintItem[]; right: HintItem[] };

const hintTable: Record<WorkspaceState, HintConfig> = {
  loading: {
    left: [],
    right: [],
  },
  normal: {
    left: [
      { key: "view-rotate", i18n: "op.view.rotate" },
      { key: "view-zoom", i18n: "op.view.zoom" },
      { key: "view-pan", i18n: "op.view.pan" },
    ],
    right: [
      { key: "view-zoom", i18n: "op.view.zoom" },
      { key: "view-pan", i18n: "op.view.pan" },
      { key: "rename-group", i18n: "op.group.rename" },
    ],
  },
  editingGroup: {
    left: [
      { key: "group-add-face", i18n: "op.group.face.add" },
      { key: "group-remove-face", i18n: "op.group.face.remove" },
      { key: "view-rotate", i18n: "op.view.rotate" },
      { key: "view-zoom", i18n: "op.view.zoom" },
      { key: "view-pan", i18n: "op.view.pan" },
    ],
    right: [
      { key: "group-rotate", i18n: "op.group.rotate" },
      { key: "view-zoom", i18n: "op.view.zoom" },
      { key: "view-pan", i18n: "op.view.pan" },
      { key: "rename-group", i18n: "op.group.rename" },
    ],
  },
  previewGroupModel: {
    left: [
      { key: "view-rotate", i18n: "op.view.rotate" },
      { key: "view-zoom", i18n: "op.view.zoom" },
      { key: "view-pan", i18n: "op.view.pan" },
    ],
    right: [],
  },
};

type DOMRefs = {
  wrap: HTMLDivElement;
  list: HTMLUListElement;
  items: Map<string, HTMLLIElement>;
};

const buildContainer = (mount: HTMLElement): DOMRefs => {
  const wrap = document.createElement("div");
  wrap.className = "op-hints hidden";
  const list = document.createElement("ul");
  list.className = "op-hints-list";
  wrap.appendChild(list);
  mount.appendChild(wrap);
  return { wrap, list, items: new Map() };
};

export function createOperationHints(params: { leftMount: HTMLElement; rightMount: HTMLElement; getWorkspaceState: () => WorkspaceState }) {
  const { leftMount, rightMount, getWorkspaceState } = params;
  const left = buildContainer(leftMount);
  const right = buildContainer(rightMount);

  const renderSide = (side: Side, state: WorkspaceState) => {
    const cfg = hintTable[state];
    if (!cfg) return;
    const target = side === "left" ? left : right;
    target.list.innerHTML = "";
    target.items.clear();
    const hints = cfg[side];
    if (!hints.length) {
      target.wrap.classList.add("hidden");
      return;
    }
    hints.forEach((hint) => {
      const li = document.createElement("li");
      li.className = "op-hints-item";
      li.textContent = t(hint.i18n);
      li.dataset.op = hint.key;
      target.list.appendChild(li);
      target.items.set(hint.key, li);
    });
    target.wrap.classList.remove("hidden");
  };

  const renderAll = (state: WorkspaceState) => {
    renderSide("left", state);
    renderSide("right", state);
  };

  const timers = {
    left: new Map<string, number>(),
    right: new Map<string, number>(),
  };

  const clearHighlight = (side: Side, op: string) => {
    const target = side === "left" ? left : right;
    const item = target.items.get(op);
    if (!item) return;
    item.classList.remove("highlight");
    const tmap = side === "left" ? timers.left : timers.right;
    const tid = tmap.get(op);
    if (tid !== undefined) {
      window.clearTimeout(tid);
      tmap.delete(op);
    }
  };

  const highlight = (side: Side, op: string, duration?: number) => {
    const target = side === "left" ? left : right;
    const item = target.items.get(op);
    if (!item) return;
    clearHighlight(side, op);
    // 强制 reflow 以重触发动画
    void item.offsetWidth;
    item.classList.add("highlight");
    if (duration && duration > 0) {
      const tmap = side === "left" ? timers.left : timers.right;
      const tid = window.setTimeout(() => {
        item.classList.remove("highlight");
        tmap.delete(op);
      }, duration);
      tmap.set(op, tid);
    }
  };

  const stateWatcher = appEventBus.on("workspaceStateChanged", ({ current }) => {
    renderAll(current);
  });

  const opWatcher = appEventBus.on("userOperation", ({ side, op, highlightDuration }) => {
    if (side === "both") {
      highlight("left", op, highlightDuration);
      highlight("right", op, highlightDuration);
    } else {
      highlight(side, op, highlightDuration);
    }
  });

  const opDoneWatcher = appEventBus.on("userOperationDone", ({ side, op }) => {
    if (side === "both") {
      clearHighlight("left", op);
      clearHighlight("right", op);
    } else {
      clearHighlight(side, op);
    }
  });

  const resetHighlights = () => {
    ["left", "right"].forEach((side) => {
      const map = side === "left" ? timers.left : timers.right;
      map.forEach((tid) => window.clearTimeout(tid));
      map.clear();
    });
    [...left.items.values(), ...right.items.values()].forEach((el) => el.classList.remove("highlight"));
  };

  const clearWatcher = appEventBus.on("clearAppStates", () => {
    resetHighlights();
  });
  const langWatcher = onLanguageChanged(() => {
    renderAll(getWorkspaceState());
  });

  // 初始渲染
  renderAll(getWorkspaceState());

  return {
    refresh: () => renderAll(getWorkspaceState()),
    resetHighlights,
    destroy: () => {
      stateWatcher();
      opWatcher();
      opDoneWatcher();
      clearWatcher();
      langWatcher();
      left.wrap.remove();
      right.wrap.remove();
    },
  };
}
