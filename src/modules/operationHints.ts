import { appEventBus } from "./eventBus";
import type { WorkspaceState } from "../types/workspaceState";

type Side = "left" | "right";

type HintItem = { key: string; label: string };
type HintConfig = { left: HintItem[]; right: HintItem[] };

const hintTable: Record<WorkspaceState, HintConfig> = {
  normal: {
    left: [
      { key: "view-rotate", label: "左键旋转视角" },
      { key: "view-zoom", label: "滚轮缩放视角" },
      { key: "view-pan", label: "右键平移视角" },
    ],
    right: [
      { key: "view-zoom", label: "滚轮缩放视角" },
      { key: "view-pan", label: "右键平移视角" },
      { key: "rename-group", label: "左键长按标签改名" },
    ],
  },
  editingGroup: {
    left: [
      { key: "group-add-face", label: "左键添加面到展开组" },
      { key: "group-remove-face", label: "右键移出展开组三角面" },
      { key: "view-rotate", label: "左键旋转视角" },
      { key: "view-zoom", label: "滚轮缩放视角" },
      { key: "view-pan", label: "右键平移视角" },
    ],
    right: [
      { key: "group-rotate", label: "左键旋转展开组" },
      { key: "view-zoom", label: "滚轮缩放视角" },
      { key: "view-pan", label: "右键平移视角" },
      { key: "rename-group", label: "左键长按标签改名" },
    ],
  },
  previewGroupModel: {
    left: [
      { key: "view-rotate", label: "左键旋转视角" },
      { key: "view-zoom", label: "滚轮缩放视角" },
      { key: "view-pan", label: "右键平移视角" },
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
      li.textContent = hint.label;
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
      left.wrap.remove();
      right.wrap.remove();
    },
  };
}
