// 展开组 UI 组件：渲染组标签、预览面板、颜色选择与删除按钮，并将用户操作回调给上层。
import { Color } from "three";

export type GroupUIState = {
  groupCount: number;
  groupIds: number[];
  previewGroupId: number;
  editGroupState: boolean;
  getGroupColor: (id: number) => Color | undefined;
  getGroupFacesCount: (id: number) => number;
  deletable: boolean;
};

export type GroupUICallbacks = {
  onPreviewSelect: (id: number) => void;
  onColorChange: (color: Color) => void;
  onDelete: () => void;
};

export function createGroupUI(
  ui: {
    groupTabsEl: HTMLDivElement;
    groupPreview: HTMLDivElement;
    groupFacesCountLabel: HTMLSpanElement;
    groupColorBtn: HTMLButtonElement;
    groupColorInput: HTMLInputElement;
    groupDeleteBtn: HTMLButtonElement;
  },
  callbacks: GroupUICallbacks,
) {
  const renderTabs = (state: GroupUIState) => {
    if (!ui.groupTabsEl) return;
    ui.groupTabsEl.innerHTML = "";
    let i = 0;
    state.groupIds.forEach((id) => {
      i++;
      const btn = document.createElement("button");
      btn.className = `tab-btn ${id === state.previewGroupId ? "active" : ""}`;
      btn.textContent = `展开组 ${i}`;
      btn.addEventListener("click", () => {
        callbacks.onPreviewSelect(id);
      });
      ui.groupTabsEl.appendChild(btn);
    });
  };

  const updatePreview = (state: GroupUIState) => {
    if (!ui.groupPreview || !ui.groupColorBtn || !ui.groupColorInput || !ui.groupDeleteBtn || !ui.groupFacesCountLabel) return;
    const color = state.getGroupColor(state.previewGroupId);
    const hex = `#${color?.getHexString()}`;
    ui.groupColorBtn.style.background = hex;
    ui.groupColorInput.value = hex;
    const count = state.getGroupFacesCount(state.previewGroupId);
    ui.groupFacesCountLabel.textContent = `面数量 ${count}`;
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
