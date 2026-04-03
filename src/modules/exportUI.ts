// 导出对话框 UI：负责导出窗口的打开/关闭，以及导出操作。
export type ExportUIRefs = {
  overlay: HTMLDivElement;
  title: HTMLDivElement;
  currentModeBtn: HTMLButtonElement;
  allModeBtn: HTMLButtonElement;
  groupNameRow: HTMLDivElement;
  faceCountRow: HTMLDivElement;
  validGroupCountRow: HTMLDivElement;
  groupNameLabel: HTMLSpanElement;
  faceCountLabel: HTMLSpanElement;
  validGroupCountLabel: HTMLSpanElement;
  stlCheckbox: HTMLInputElement;
  stepCheckbox: HTMLInputElement;
  pngCheckbox: HTMLInputElement;
  stlOption: HTMLDivElement;
  stepOption: HTMLDivElement;
  pngOption: HTMLDivElement;
  stlFileTitle: HTMLSpanElement;
  stepFileTitle: HTMLSpanElement;
  pngFileTitle: HTMLSpanElement;
  stlFileNameLabel: HTMLSpanElement;
  stepFileNameLabel: HTMLSpanElement;
  pngFileNameLabel: HTMLSpanElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
};

export type ExportOptions = {
  exportStl: boolean;
  exportStep: boolean;
  exportPng: boolean;
  exportAllGroups: boolean;
};

export type ExportOpenPayload = {
  groupName: string;
  faceCount: number;
  projectName: string;
  validGroupCount: number;
  currentGroupValid: boolean;
  forceExportAll?: boolean;
};

export type ExportUIDeps = {
  onExport: (options: ExportOptions) => void | Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export type ExportUIApi = {
  isOpen: () => boolean;
  open: (payload: ExportOpenPayload) => void;
  close: () => void;
  dispose: () => void;
};

// 获取导出对话框的 DOM 元素并进行完整性验证
export function getExportUIRefs(): ExportUIRefs | null {
  const get = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

  const refs: ExportUIRefs = {
    overlay: get<HTMLDivElement>("#export-overlay"),
    title: get<HTMLDivElement>("#export-title"),
    currentModeBtn: get<HTMLButtonElement>("#export-current-mode-btn"),
    allModeBtn: get<HTMLButtonElement>("#export-all-mode-btn"),
    groupNameRow: get<HTMLDivElement>("#export-group-name-row"),
    faceCountRow: get<HTMLDivElement>("#export-face-count-row"),
    validGroupCountRow: get<HTMLDivElement>("#export-valid-group-count-row"),
    groupNameLabel: get<HTMLSpanElement>("#export-group-name"),
    faceCountLabel: get<HTMLSpanElement>("#export-face-count"),
    validGroupCountLabel: get<HTMLSpanElement>("#export-valid-group-count"),
    stlCheckbox: get<HTMLInputElement>("#export-stl-checkbox"),
    stepCheckbox: get<HTMLInputElement>("#export-step-checkbox"),
    pngCheckbox: get<HTMLInputElement>("#export-png-checkbox"),
    stlOption: get<HTMLDivElement>("#export-stl-option"),
    stepOption: get<HTMLDivElement>("#export-step-option"),
    pngOption: get<HTMLDivElement>("#export-png-option"),
    stlFileTitle: get<HTMLSpanElement>("#export-stl-file-title"),
    stepFileTitle: get<HTMLSpanElement>("#export-step-file-title"),
    pngFileTitle: get<HTMLSpanElement>("#export-png-file-title"),
    stlFileNameLabel: get<HTMLSpanElement>("#export-stl-filename"),
    stepFileNameLabel: get<HTMLSpanElement>("#export-step-filename"),
    pngFileNameLabel: get<HTMLSpanElement>("#export-png-filename"),
    cancelBtn: get<HTMLButtonElement>("#export-cancel-btn"),
    confirmBtn: get<HTMLButtonElement>("#export-confirm-btn"),
  };

  const values = Object.values(refs);
  if (values.some((el) => !el)) {
    console.error("导出对话框 DOM 元素缺失:", values.map((el) => (el ? "ok" : "missing")));
    return null;
  }

  return refs;
}

const EXPORT_OPTIONS_STORAGE_KEY = "export_ui_options";
const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  exportStl: true,
  exportStep: false,
  exportPng: false,
  exportAllGroups: false,
};

export function createExportUI(refs: ExportUIRefs, deps: ExportUIDeps): ExportUIApi {
  let openPayload: ExportOpenPayload | null = null;
  let exportAllGroups = false;

  const readStoredOptions = (): ExportOptions => {
    if (typeof localStorage === "undefined") return { ...DEFAULT_EXPORT_OPTIONS };
    try {
      const raw = localStorage.getItem(EXPORT_OPTIONS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_EXPORT_OPTIONS };
      const parsed = JSON.parse(raw) as Partial<ExportOptions>;
      return {
        exportStl: typeof parsed.exportStl === "boolean" ? parsed.exportStl : DEFAULT_EXPORT_OPTIONS.exportStl,
        exportStep: typeof parsed.exportStep === "boolean" ? parsed.exportStep : DEFAULT_EXPORT_OPTIONS.exportStep,
        exportPng: typeof parsed.exportPng === "boolean" ? parsed.exportPng : DEFAULT_EXPORT_OPTIONS.exportPng,
        exportAllGroups: DEFAULT_EXPORT_OPTIONS.exportAllGroups,
      };
    } catch (error) {
      console.warn("读取导出选项缓存失败", error);
      return { ...DEFAULT_EXPORT_OPTIONS };
    }
  };

  const writeStoredOptions = (options: ExportOptions) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch (error) {
      console.warn("保存导出选项缓存失败", error);
    }
  };

  const setTextWithTooltip = (el: HTMLElement, text: string) => {
    el.textContent = text;
    el.title = text;
  };

  const getSafeGroupName = (groupName: string) => groupName.replace(/[^a-zA-Z0-9一-龥]/g, "_");

  const getCurrentOptions = (): ExportOptions => ({
    exportStl: refs.stlCheckbox.checked,
    exportStep: refs.stepCheckbox.checked,
    exportPng: refs.pngCheckbox.checked,
    exportAllGroups,
  });

  const applyOptions = (options: ExportOptions) => {
    refs.stlCheckbox.checked = options.exportStl;
    refs.stepCheckbox.checked = options.exportStep;
    refs.pngCheckbox.checked = options.exportPng;
  };

  const syncOptionState = () => {
    refs.stlOption.classList.toggle("is-selected", refs.stlCheckbox.checked);
    refs.stepOption.classList.toggle("is-selected", refs.stepCheckbox.checked);
    refs.pngOption.classList.toggle("is-selected", refs.pngCheckbox.checked);
  };

  const syncModeState = () => {
    if (!openPayload) return;
    const exportAll = exportAllGroups;
    refs.title.textContent = deps.t(exportAll ? "export.title.all" : "export.title.current");
    refs.groupNameRow.classList.toggle("hidden", exportAll);
    refs.faceCountRow.classList.toggle("hidden", exportAll);
    refs.validGroupCountRow.classList.toggle("hidden", !exportAll);
    refs.currentModeBtn.classList.toggle("is-active", !exportAll);
    refs.allModeBtn.classList.toggle("is-active", exportAll);
    refs.currentModeBtn.disabled = !openPayload.currentGroupValid && openPayload.validGroupCount > 0;
    refs.allModeBtn.disabled = openPayload.validGroupCount <= 0;

    if (exportAll) {
      setTextWithTooltip(refs.validGroupCountLabel, String(openPayload.validGroupCount));
      setTextWithTooltip(refs.stlFileTitle, deps.t("export.outputInfo"));
      setTextWithTooltip(refs.stepFileTitle, deps.t("export.outputInfo"));
      setTextWithTooltip(refs.pngFileTitle, deps.t("export.outputInfo"));
      setTextWithTooltip(refs.stlFileNameLabel, deps.t("export.batchFileHint.stl", { count: openPayload.validGroupCount }));
      setTextWithTooltip(refs.stepFileNameLabel, deps.t("export.batchFileHint.step", { count: openPayload.validGroupCount }));
      setTextWithTooltip(refs.pngFileNameLabel, deps.t("export.batchFileHint.png", { count: openPayload.validGroupCount }));
      refs.confirmBtn.textContent = deps.t("export.confirmAll.btn");
    } else {
      setTextWithTooltip(refs.groupNameLabel, openPayload.groupName);
      setTextWithTooltip(refs.faceCountLabel, String(openPayload.faceCount));
      const safeGroupName = getSafeGroupName(openPayload.groupName);
      setTextWithTooltip(refs.stlFileTitle, deps.t("export.stlFileName"));
      setTextWithTooltip(refs.stepFileTitle, deps.t("export.stepFileName"));
      setTextWithTooltip(refs.pngFileTitle, deps.t("export.pngFileName"));
      setTextWithTooltip(refs.stlFileNameLabel, `${openPayload.projectName}-${safeGroupName}.stl`);
      setTextWithTooltip(refs.stepFileNameLabel, `${openPayload.projectName}-${safeGroupName}.step`);
      setTextWithTooltip(refs.pngFileNameLabel, `${openPayload.projectName}-${safeGroupName}.png`);
      refs.confirmBtn.textContent = deps.t("export.confirm.btn");
    }
  };

  const updateConfirmButton = () => {
    if (!openPayload) return;
    const hasSelection = refs.stlCheckbox.checked || refs.stepCheckbox.checked || refs.pngCheckbox.checked;
    const canExportTarget = exportAllGroups || openPayload.currentGroupValid;
    refs.confirmBtn.disabled = !hasSelection || !canExportTarget;
    syncOptionState();
    syncModeState();
  };

  const isOpen = () => !refs.overlay.classList.contains("hidden");

  const openExport = (payload: ExportOpenPayload) => {
    openPayload = payload;
    const stored = readStoredOptions();
    const forceExportAll = !!payload.forceExportAll || (!payload.currentGroupValid && payload.validGroupCount > 0);
    exportAllGroups = forceExportAll ? true : false;
    applyOptions(stored);
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
    deps.onExport(getCurrentOptions());
    closeExport();
  };

  const handleCheckboxChange = () => {
    const { exportAllGroups: _, ...storedLike } = getCurrentOptions();
    writeStoredOptions({ ...storedLike, exportAllGroups: false });
    updateConfirmButton();
  };

  const handleCurrentModeClick = () => {
    if (!openPayload) return;
    if (!openPayload.currentGroupValid && openPayload.validGroupCount > 0) return;
    exportAllGroups = false;
    updateConfirmButton();
  };

  const handleAllModeClick = () => {
    if (!openPayload) return;
    if (openPayload.validGroupCount <= 0) return;
    exportAllGroups = true;
    updateConfirmButton();
  };

  const handleOverlayMouseDown = (event: MouseEvent) => {
    if (event.target === refs.overlay) {
      closeExport();
    }
  };

  refs.cancelBtn.addEventListener("click", handleCancel);
  refs.confirmBtn.addEventListener("click", handleExport);
  refs.stlCheckbox.addEventListener("change", handleCheckboxChange);
  refs.stepCheckbox.addEventListener("change", handleCheckboxChange);
  refs.pngCheckbox.addEventListener("change", handleCheckboxChange);
  refs.currentModeBtn.addEventListener("click", handleCurrentModeClick);
  refs.allModeBtn.addEventListener("click", handleAllModeClick);
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
      refs.currentModeBtn.removeEventListener("click", handleCurrentModeClick);
      refs.allModeBtn.removeEventListener("click", handleAllModeClick);
      refs.overlay.removeEventListener("mousedown", handleOverlayMouseDown);
    },
  };
}
