// 展开组 UI 组件：渲染组标签、预览面板、颜色选择与删除按钮，并将用户操作回调给上层。
import { Color } from "three";
import { t } from "./i18n";

export type GroupUIState = {
  groupCount: number;
  groupIds: number[];
  previewGroupId: number;
  editGroupState: boolean;
  getGroupColor: (id: number) => Color | undefined;
  getGroupName: (id: number) => string | undefined;
  getGroupFacesCount: (id: number) => number;
  getGroupVisibility: (id: number) => boolean;
  deletable: boolean;
};

export type GroupUICallbacks = {
  onPreviewSelect: (id: number) => void;
  onColorChange: (color: Color) => void;
  onDelete: () => void;
  onRenameRequest?: () => void;
  onVisibilityToggle?: (visible: boolean) => void;
};

export function createGroupUI(
  ui: {
    groupTabsEl: HTMLDivElement;
    groupPreview: HTMLDivElement;
    groupFacesCountLabel: HTMLSpanElement;
    groupColorBtn: HTMLButtonElement;
    groupColorInput: HTMLInputElement;
    groupDeleteBtn?: HTMLButtonElement | null;
    groupVisibilityBtn?: HTMLButtonElement;
  },
  callbacks: GroupUICallbacks,
) {
  type TabMode = "full" | "compact" | "super";
  let tabMode: TabMode = "full";
  let lastState: GroupUIState | null = null;
  const renderTabs = (state: GroupUIState, mode: TabMode = tabMode) => {
    tabMode = mode;
    if (!ui.groupTabsEl) return;
    ui.groupTabsEl.innerHTML = "";
    const applyEllipsis = (el: HTMLButtonElement, txt: string) => {
      el.textContent = txt;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      let content = txt;
      while (content.length > 0 && el.scrollWidth > el.clientWidth + 1) {
        content = content.slice(0, -1);
        el.textContent = `${content}...`;
      }
    };
    state.groupIds.forEach((id, i) => {
      const name = state.getGroupName(id) ?? `展开组 ${i + 1}`;
      const btn = document.createElement("button");
      const isActive = id === state.previewGroupId;
      const btnMode: TabMode = isActive ? "full" : mode;
      btn.className = `tab-btn ${isActive ? "active" : ""}`;
      btn.textContent = btnMode === "full" ? name : btnMode === "compact" ? name : "";
      btn.classList.remove("tab-super", "tab-compact");
      const color = state.getGroupColor?.(id);
      if (btnMode === "super") {
        btn.classList.add("tab-super");
        btn.title = `展开组 ${i}`;
        if (color) {
          btn.style.background = `#${color.getHexString()}`;
        }
      } else if (btnMode === "compact" && !isActive) {
        btn.classList.add("tab-compact");
        btn.title = name;
        btn.textContent = name;
        btn.style.background = "";
      } else {
        btn.title = "";
        btn.style.background = "";
      }
      let longPressTimer: number | null = null;
      const clearTimer = () => {
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };
      btn.addEventListener("pointerdown", () => {
        if (!isActive || !callbacks.onRenameRequest) return;
        clearTimer();
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null;
          callbacks.onRenameRequest?.();
        }, 600);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
        btn.addEventListener(evt, clearTimer),
      );
      btn.addEventListener("click", () => {
        callbacks.onPreviewSelect(id);
      });
      ui.groupTabsEl.appendChild(btn);
      if (btnMode === "compact" && !isActive) {
        applyEllipsis(btn, name);
      }
    });
  };
  const applyBestMode = () => {
    if (!ui.groupTabsEl || !lastState) return;
    const modes: TabMode[] = ["full", "compact", "super"];
    for (const m of modes) {
      renderTabs(lastState, m);
      if (ui.groupTabsEl.scrollWidth <= ui.groupTabsEl.clientWidth + 1) {
        tabMode = m;
        return;
      }
    }
    tabMode = "super";
  };

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          applyBestMode();
        })
      : null;
  if (resizeObserver) {
    resizeObserver.observe(ui.groupTabsEl);
  }

  const updatePreview = (state: GroupUIState) => {
    if (!ui.groupPreview || !ui.groupColorBtn || !ui.groupColorInput || !ui.groupFacesCountLabel) return;
    const color = state.getGroupColor(state.previewGroupId);
    const hex = `#${color?.getHexString()}`;
    ui.groupColorBtn.style.background = hex;
    ui.groupColorInput.value = hex;
    ui.groupFacesCountLabel.textContent = t("preview.right.faceCount.label", { count: state.getGroupFacesCount(state.previewGroupId) });
    if (ui.groupDeleteBtn) {
      ui.groupDeleteBtn.style.display = state.deletable ? "inline-flex" : "none";
      ui.groupDeleteBtn.toggleAttribute("disabled", !state.deletable);
      ui.groupDeleteBtn.style.opacity = state.deletable ? "1" : "0.6";
    }
    if (ui.groupVisibilityBtn) {
      const visible = state.getGroupVisibility(state.previewGroupId);
      const visibleIcon = ui.groupVisibilityBtn.querySelector<SVGElement>(".icon-visible");
      const hiddenIcon = ui.groupVisibilityBtn.querySelector<SVGElement>(".icon-hidden");
      visibleIcon?.classList.toggle("hidden", !visible);
      hiddenIcon?.classList.toggle("hidden", visible);
      ui.groupVisibilityBtn.classList.toggle("inactive", !visible);
    }
  };

  ui.groupColorBtn.addEventListener("click", () => ui.groupColorInput.click());
  ui.groupColorInput.addEventListener("input", (event) => {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    callbacks.onColorChange(new Color(value));
  });
  if (ui.groupDeleteBtn && !ui.groupDeleteBtn.classList.contains("hold-btn")) {
    ui.groupDeleteBtn.addEventListener("click", () => callbacks.onDelete());
  }
  if (ui.groupVisibilityBtn && callbacks.onVisibilityToggle) {
    ui.groupVisibilityBtn.addEventListener("click", () => {
      if (!lastState) return;
      const current = lastState.getGroupVisibility(lastState.previewGroupId);
      callbacks.onVisibilityToggle?.(!current);
    });
  }

  return {
    render: (state: GroupUIState) => {
      lastState = state;
      renderTabs(state);
      requestAnimationFrame(applyBestMode);
      updatePreview(state);
    },
    dispose: () => {
      ui.groupColorBtn.onclick = null;
      ui.groupColorInput.oninput = null;
      if (ui.groupDeleteBtn && !ui.groupDeleteBtn.classList.contains("hold-btn")) {
        ui.groupDeleteBtn.onclick = null;
      }
      ui.groupTabsEl.innerHTML = "";
      resizeObserver?.disconnect();
    },
  };
}
