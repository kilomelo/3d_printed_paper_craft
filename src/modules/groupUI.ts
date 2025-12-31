// 展开组 UI 组件：渲染组标签、预览面板、颜色选择与删除按钮，并将用户操作回调给上层。
import { Color } from "three";

export type GroupUIState = {
  groupIds: number[];
  previewGroupId: number;
  editGroupId: number | null;
  getGroupColor: (id: number) => Color;
  getGroupCount: (id: number) => number;
  deletable: boolean;
};

export type GroupUICallbacks = {
  onPreviewSelect: (id: number) => void;
  onEditSelect: (id: number) => void;
  onColorChange: (color: Color) => void;
  onDelete: () => void;
};

export function initGroupUI(
  ui: {
    groupTabsEl: HTMLDivElement;
    groupPreview: HTMLDivElement;
    groupCountLabel: HTMLSpanElement;
    groupColorBtn: HTMLButtonElement;
    groupColorInput: HTMLInputElement;
    groupDeleteBtn: HTMLButtonElement;
  },
  callbacks: GroupUICallbacks,
) {
  const renderTabs = (state: GroupUIState) => {
    if (!ui.groupTabsEl) return;
    ui.groupTabsEl.innerHTML = "";
    state.groupIds.forEach((id) => {
      const btn = document.createElement("button");
      btn.className = `tab-btn ${id === state.previewGroupId ? "active" : ""} ${state.editGroupId === id ? "editing" : ""}`;
      btn.textContent = `${id}`;
      btn.addEventListener("click", () => {
        if (state.editGroupId === null) {
          callbacks.onPreviewSelect(id);
        } else {
          if (state.editGroupId === id) return;
          callbacks.onEditSelect(id);
        }
      });
      ui.groupTabsEl.appendChild(btn);
    });
  };

  const updatePreview = (state: GroupUIState) => {
    if (!ui.groupPreview || !ui.groupColorBtn || !ui.groupColorInput || !ui.groupDeleteBtn || !ui.groupCountLabel) return;
    const color = state.getGroupColor(state.previewGroupId);
    const hex = `#${color.getHexString()}`;
    ui.groupColorBtn.style.background = hex;
    ui.groupColorInput.value = hex;
    const count = state.getGroupCount(state.previewGroupId);
    ui.groupCountLabel.textContent = `面数量 ${count}`;
    ui.groupDeleteBtn.style.display = state.deletable ? "inline-flex" : "none";
  };

  ui.groupColorBtn.addEventListener("click", () => ui.groupColorInput.click());
  ui.groupColorInput.addEventListener("input", (event) => {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    callbacks.onColorChange(new Color(value));
  });
  ui.groupDeleteBtn.addEventListener("click", () => {
    callbacks.onDelete();
  });

  return {
    render: (state: GroupUIState) => {
      renderTabs(state);
      updatePreview(state);
    },
    dispose: () => {
      ui.groupColorBtn.onclick = null;
      ui.groupColorInput.oninput = null;
      ui.groupDeleteBtn.onclick = null;
      ui.groupTabsEl.innerHTML = "";
    },
  };
}
