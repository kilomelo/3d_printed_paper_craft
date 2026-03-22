// 导出对话框 UI：负责导出窗口的打开/关闭，以及导出操作。
export type ExportUIRefs = {
  overlay: HTMLDivElement;
  groupNameLabel: HTMLSpanElement;
  faceCountLabel: HTMLSpanElement;
  stlCheckbox: HTMLInputElement;
  stepCheckbox: HTMLInputElement;
  pngCheckbox: HTMLInputElement;
  stlOption: HTMLDivElement;
  stepOption: HTMLDivElement;
  pngOption: HTMLDivElement;
  stlFileNameLabel: HTMLSpanElement;
  stepFileNameLabel: HTMLSpanElement;
  pngFileNameLabel: HTMLSpanElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
};

// 获取导出对话框的 DOM 元素并进行完整性验证
export function getExportUIRefs(): ExportUIRefs | null {
  const get = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

  const refs: ExportUIRefs = {
    overlay: get<HTMLDivElement>("#export-overlay"),
    groupNameLabel: get<HTMLSpanElement>("#export-group-name"),
    faceCountLabel: get<HTMLSpanElement>("#export-face-count"),
    stlCheckbox: get<HTMLInputElement>("#export-stl-checkbox"),
    stepCheckbox: get<HTMLInputElement>("#export-step-checkbox"),
    pngCheckbox: get<HTMLInputElement>("#export-png-checkbox"),
    stlOption: get<HTMLDivElement>("#export-stl-option"),
    stepOption: get<HTMLDivElement>("#export-step-option"),
    pngOption: get<HTMLDivElement>("#export-png-option"),
    stlFileNameLabel: get<HTMLSpanElement>("#export-stl-filename"),
    stepFileNameLabel: get<HTMLSpanElement>("#export-step-filename"),
    pngFileNameLabel: get<HTMLSpanElement>("#export-png-filename"),
    cancelBtn: get<HTMLButtonElement>("#export-cancel-btn"),
    confirmBtn: get<HTMLButtonElement>("#export-confirm-btn"),
  };

  // 验证所有元素是否存在
  const values = Object.values(refs);
  if (values.some((el) => !el)) {
    console.error("导出对话框 DOM 元素缺失:", values.map((el) => (el ? "ok" : "missing")));
    return null;
  }

  return refs;
}

export type ExportOptions = {
  exportStl: boolean;
  exportStep: boolean;
  exportPng: boolean;
  pngFlipY?: boolean;
};

export type ExportUIDeps = {
  onExport: (options: ExportOptions) => void;
};

export type ExportUIApi = {
  isOpen: () => boolean;
  open: (groupName: string, faceCount: number, projectName: string) => void;
  close: () => void;
  dispose: () => void;
};

export function createExportUI(refs: ExportUIRefs, deps: ExportUIDeps): ExportUIApi {
  const syncOptionState = () => {
    refs.stlOption.classList.toggle("is-selected", refs.stlCheckbox.checked);
    refs.stepOption.classList.toggle("is-selected", refs.stepCheckbox.checked);
    refs.pngOption.classList.toggle("is-selected", refs.pngCheckbox.checked);
  };

  const setTextWithTooltip = (el: HTMLElement, text: string) => {
    el.textContent = text;
    el.title = text;
  };

  const updateConfirmButton = () => {
    const hasSelection = refs.stlCheckbox.checked || refs.stepCheckbox.checked || refs.pngCheckbox.checked;
    refs.confirmBtn.disabled = !hasSelection;
    syncOptionState();
  };

  const isOpen = () => !refs.overlay.classList.contains("hidden");

  const openExport = (groupName: string, faceCount: number, projectName: string) => {
    setTextWithTooltip(refs.groupNameLabel, groupName);
    setTextWithTooltip(refs.faceCountLabel, faceCount.toString());
    // 设置文件名
    const safeGroupName = groupName.replace(/[^a-zA-Z0-9一-龥]/g, "_");
    setTextWithTooltip(refs.stlFileNameLabel, `${projectName}-${safeGroupName}.stl`);
    setTextWithTooltip(refs.stepFileNameLabel, `${projectName}-${safeGroupName}.step`);
    setTextWithTooltip(refs.pngFileNameLabel, `${projectName}-${safeGroupName}.png`);
    // 重置勾选框状态
    refs.stlCheckbox.checked = true;
    refs.stepCheckbox.checked = false;
    refs.pngCheckbox.checked = false;
    updateConfirmButton();
    refs.overlay.classList.remove("hidden");
  };

  const closeExport = () => {
    refs.overlay.classList.add("hidden");
  };

  const handleCancel = () => {
    closeExport();
  };

  const handleExport = () => {
    const options: ExportOptions = {
      exportStl: refs.stlCheckbox.checked,
      exportStep: refs.stepCheckbox.checked,
      exportPng: refs.pngCheckbox.checked,
    };
    deps.onExport(options);
    closeExport();
  };

  const handleCheckboxChange = () => {
    updateConfirmButton();
  };

  const handleOverlayMouseDown = (event: MouseEvent) => {
    if (event.target === refs.overlay) {
      closeExport();
    }
  };

  // 绑定事件
  refs.cancelBtn.addEventListener("click", handleCancel);
  refs.confirmBtn.addEventListener("click", handleExport);
  refs.stlCheckbox.addEventListener("change", handleCheckboxChange);
  refs.stepCheckbox.addEventListener("change", handleCheckboxChange);
  refs.pngCheckbox.addEventListener("change", handleCheckboxChange);
  refs.overlay.addEventListener("mousedown", handleOverlayMouseDown);

  return {
    isOpen,
    open: openExport,
    close: closeExport,
    dispose: () => {
      refs.cancelBtn.removeEventListener("click", handleCancel);
      refs.confirmBtn.removeEventListener("click", handleExport);
      refs.stlCheckbox.removeEventListener("change", handleCheckboxChange);
      refs.stepCheckbox.removeEventListener("change", handleCheckboxChange);
      refs.pngCheckbox.removeEventListener("change", handleCheckboxChange);
      refs.overlay.removeEventListener("mousedown", handleOverlayMouseDown);
    },
  };
}
