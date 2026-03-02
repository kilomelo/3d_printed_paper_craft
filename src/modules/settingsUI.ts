// 设置面板 UI：负责设置窗口的打开/关闭、输入校验、草稿值管理以及日志输出。
import { getSettings, applySettings, getDefaultSettings, SETTINGS_LIMITS } from "./settings";
import { t } from "./i18n";

type SettingsUIRefs = {
  overlay: HTMLDivElement;
  content: HTMLDivElement;
  openBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
  joinTypeInterlockingBtn: HTMLButtonElement;
  joinTypeClipBtn: HTMLButtonElement;
  joinTypeResetBtn: HTMLButtonElement;
  scaleInput: HTMLInputElement;
  scaleResetBtn: HTMLButtonElement;
  minFoldAngleThresholdInput: HTMLInputElement;
  minFoldAngleThresholdResetBtn: HTMLButtonElement;
  clawInterlockingAngleInput: HTMLInputElement;
  clawInterlockingAngleResetBtn: HTMLButtonElement;
  clawTargetRadiusInput: HTMLInputElement;
  clawTargetRadiusResetBtn: HTMLButtonElement;
  clawWidthInput: HTMLInputElement;
  clawWidthResetBtn: HTMLButtonElement;
  tabWidthInput: HTMLInputElement;
  tabWidthResetBtn: HTMLButtonElement;
  tabThicknessInput: HTMLInputElement;
  tabThicknessResetBtn: HTMLButtonElement;
  tabClipGapInput: HTMLInputElement;
  tabClipGapResetBtn: HTMLButtonElement;
  clipGapAdjustNormalBtn: HTMLButtonElement;
  clipGapAdjustNarrowBtn: HTMLButtonElement;
  clipGapAdjustResetBtn: HTMLButtonElement;
  hollowOnBtn: HTMLButtonElement;
  hollowOffBtn: HTMLButtonElement;
  hollowResetBtn: HTMLButtonElement;
  wireframeThicknessInput: HTMLInputElement;
  wireframeThicknessResetBtn: HTMLButtonElement;
  wireframeRow: HTMLDivElement;
  layerHeightInput: HTMLInputElement;
  layerHeightResetBtn: HTMLButtonElement;
  connectionLayersDecBtn: HTMLButtonElement;
  connectionLayersIncBtn: HTMLButtonElement;
  connectionLayersValue: HTMLSpanElement;
  connectionLayersResetBtn: HTMLButtonElement;
  bodyLayersDecBtn: HTMLButtonElement;
  bodyLayersIncBtn: HTMLButtonElement;
  bodyLayersValue: HTMLSpanElement;
  bodyLayersResetBtn: HTMLButtonElement;
  navBasic: HTMLButtonElement;
  navInterlocking: HTMLButtonElement;
  navClip: HTMLButtonElement;
  navExperiment: HTMLButtonElement;
  panelBasic: HTMLDivElement;
  panelInterlocking: HTMLDivElement;
  panelClip: HTMLDivElement;
  panelExperiment: HTMLDivElement;
};

type SettingsUIDeps = {
  log: (msg: string, tone?: "info" | "error" | "success" | "progress") => void;
};

export type SettingsUIApi = {
  isOpen: () => boolean;
  close: () => void;
  dispose: () => void;
};

export function createSettingsUI(refs: SettingsUIRefs, deps: SettingsUIDeps): SettingsUIApi {
  let settingsDraft = getSettings();
  let settingsSnapshot: ReturnType<typeof getSettings> | null = null;

  const isOpen = () => !refs.overlay.classList.contains("hidden");

  const closeSettings = () => {
    refs.overlay.classList.add("hidden");
    refs.overlay.style.visibility = "";
    settingsSnapshot = null;
  };

  const updateHollowButtons = () => {
    refs.hollowOnBtn.classList.toggle("active", settingsDraft.hollowStyle);
    refs.hollowOffBtn.classList.toggle("active", !settingsDraft.hollowStyle);
  };

  const updateJoinTypeButtons = () => {
    refs.joinTypeInterlockingBtn.classList.toggle("active", settingsDraft.joinType === "interlocking");
    refs.joinTypeClipBtn.classList.toggle("active", settingsDraft.joinType === "clip");
  };

  const updateClipGapAdjustButtons = () => {
    refs.clipGapAdjustNormalBtn.classList.toggle("active", settingsDraft.clipGapAdjust === "off");
    refs.clipGapAdjustNarrowBtn.classList.toggle("active", settingsDraft.clipGapAdjust === "on");
  };

  const updateWireframeEnabled = () => {
    const enabled = settingsDraft.hollowStyle;
    refs.wireframeThicknessInput.disabled = !enabled;
    refs.wireframeThicknessResetBtn.disabled = !enabled;
    refs.wireframeRow.classList.toggle("disabled", !enabled);
  };

  const setRowModified = (anchor: HTMLElement | null | undefined, modified: boolean) => {
    const row = anchor?.closest(".setting-row");
    if (!row) return;
    row.classList.toggle("modified", modified);
  };

  // 所有“是否为默认值”的高亮逻辑集中在这里，
  // 避免分散在各个控件事件里造成状态不一致。
  const updateModifiedIndicators = () => {
    const defaults = getDefaultSettings();
    setRowModified(refs.scaleInput, settingsDraft.scale !== defaults.scale);
    setRowModified(refs.minFoldAngleThresholdInput, settingsDraft.minFoldAngleThreshold !== defaults.minFoldAngleThreshold);
    setRowModified(refs.clawInterlockingAngleInput, settingsDraft.clawInterlockingAngle !== defaults.clawInterlockingAngle);
    setRowModified(refs.clawTargetRadiusInput, settingsDraft.clawTargetRadius !== defaults.clawTargetRadius);
    setRowModified(refs.clawWidthInput, settingsDraft.clawWidth !== defaults.clawWidth);
    setRowModified(refs.layerHeightInput, settingsDraft.layerHeight !== defaults.layerHeight);
    setRowModified(refs.connectionLayersValue, settingsDraft.connectionLayers !== defaults.connectionLayers);
    setRowModified(refs.bodyLayersValue, settingsDraft.bodyLayers !== defaults.bodyLayers);
    setRowModified(refs.joinTypeInterlockingBtn, settingsDraft.joinType !== defaults.joinType);
    setRowModified(refs.tabWidthInput, settingsDraft.tabWidth !== defaults.tabWidth);
    setRowModified(refs.tabThicknessInput, settingsDraft.tabThickness !== defaults.tabThickness);
    setRowModified(refs.tabClipGapInput, settingsDraft.tabClipGap !== defaults.tabClipGap);
    setRowModified(refs.clipGapAdjustNormalBtn, settingsDraft.clipGapAdjust !== defaults.clipGapAdjust);
    setRowModified(refs.hollowOnBtn, settingsDraft.hollowStyle !== defaults.hollowStyle);
    setRowModified(refs.wireframeThicknessInput, settingsDraft.wireframeThickness !== defaults.wireframeThickness);
  };

  const activateTab = (tab: "basic" | "interlocking" | "clip" | "experiment") => {
    const tabs: Array<{
      key: "basic" | "interlocking" | "clip" | "experiment";
      nav: HTMLButtonElement;
      panel: HTMLDivElement;
    }> = [
      { key: "basic", nav: refs.navBasic, panel: refs.panelBasic },
      { key: "interlocking", nav: refs.navInterlocking, panel: refs.panelInterlocking },
      { key: "clip", nav: refs.navClip, panel: refs.panelClip },
      { key: "experiment", nav: refs.navExperiment, panel: refs.panelExperiment },
    ];
    tabs.forEach(({ key, nav, panel }) => {
      const active = key === tab;
      nav.classList.toggle("active", active);
      panel.classList.toggle("active", active);
    });
  };

  const measurePanelHeight = (panel: HTMLDivElement) => {
    const prevDisplay = panel.style.display;
    const prevVisibility = panel.style.visibility;
    const prevPosition = panel.style.position;
    const prevWidth = panel.style.width;
    panel.style.visibility = "hidden";
    panel.style.position = "absolute";
    panel.style.display = "flex";
    const contentWidth = refs.content.clientWidth || refs.content.getBoundingClientRect().width;
    if (contentWidth > 0) {
      panel.style.width = `${contentWidth}px`;
    }
    const h = panel.scrollHeight;
    panel.style.display = prevDisplay;
    panel.style.visibility = prevVisibility;
    panel.style.position = prevPosition;
    panel.style.width = prevWidth;
    return h;
  };

  const adjustContentHeight = () => {
    const maxContent = Math.max(
      measurePanelHeight(refs.panelBasic),
      measurePanelHeight(refs.panelInterlocking),
      measurePanelHeight(refs.panelClip),
      measurePanelHeight(refs.panelExperiment),
    );
    const maxAllowed = Math.floor(window.innerHeight * 0.8);
    const target = Math.min(maxContent, maxAllowed);
    if (target > 0) {
      refs.content.style.minHeight = `${target}px`;
      refs.content.style.height = `${target}px`;
    }
  };

  const updateInputColor = (el: HTMLInputElement, valid: boolean) => {
    el.style.color = valid ? "" : "red";
  };

  const validators = {
    scale: (val: number) => !Number.isNaN(val) && val > SETTINGS_LIMITS.scale.min,
    minFoldAngleThreshold: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.minFoldAngleThreshold.min &&
      val <= SETTINGS_LIMITS.minFoldAngleThreshold.max,
    clawInterlockingAngle: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawInterlockingAngle.min &&
      val <= SETTINGS_LIMITS.clawInterlockingAngle.max,
    clawTargetRadius: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawTargetRadius.min &&
      val <= SETTINGS_LIMITS.clawTargetRadius.max,
    clawWidth: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawWidth.min &&
      val <= SETTINGS_LIMITS.clawWidth.max,
    tabThickness: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.tabThickness.min && val <= SETTINGS_LIMITS.tabThickness.max,
    layerHeight: (val: number) =>
      !Number.isNaN(val) && val > SETTINGS_LIMITS.layerHeight.min && val <= SETTINGS_LIMITS.layerHeight.max,
    connectionLayers: (val: number) =>
      Number.isInteger(val) &&
      val >= SETTINGS_LIMITS.connectionLayers.min &&
      val <= SETTINGS_LIMITS.connectionLayers.max,
    bodyLayers: (val: number) =>
      Number.isInteger(val) && val >= SETTINGS_LIMITS.bodyLayers.min && val <= SETTINGS_LIMITS.bodyLayers.max,
    tabWidth: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.tabWidth.min && val < SETTINGS_LIMITS.tabWidth.max,
    tabClipGap: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.tabClipGap.min && val <= SETTINGS_LIMITS.tabClipGap.max,
    wireframeThickness: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.wireframeThickness.min &&
      val <= SETTINGS_LIMITS.wireframeThickness.max,
  };

  const blockKeysWhenSettingsOpen = (e: KeyboardEvent) => {
    if (!isOpen()) return;
    const inOverlay = refs.overlay.contains(e.target as Node);
    if (inOverlay && (e.key === "Escape" || e.key === "Enter") && refs.overlay.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    // 阻止传播到应用级快捷键，保留浏览器默认行为
    e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", blockKeysWhenSettingsOpen);

  refs.openBtn.addEventListener("click", () => {
    settingsSnapshot = getSettings();
    settingsDraft = { ...settingsSnapshot };
    updateJoinTypeButtons();
    refs.scaleInput.value = String(settingsDraft.scale);
    refs.minFoldAngleThresholdInput.value = String(settingsDraft.minFoldAngleThreshold);
    refs.clawInterlockingAngleInput.value = String(settingsDraft.clawInterlockingAngle);
    refs.clawTargetRadiusInput.value = String(settingsDraft.clawTargetRadius);
    refs.clawWidthInput.value = String(settingsDraft.clawWidth);
    refs.tabThicknessInput.value = String(settingsDraft.tabThickness);
    refs.layerHeightInput.value = String(settingsDraft.layerHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    refs.tabWidthInput.value = String(settingsDraft.tabWidth);
    refs.tabThicknessInput.value = String(settingsDraft.tabThickness);
    refs.tabClipGapInput.value = String(settingsDraft.tabClipGap);
    refs.wireframeThicknessInput.value = String(settingsDraft.wireframeThickness);
    updateClipGapAdjustButtons();
    updateHollowButtons();
    updateWireframeEnabled();
    [refs.scaleInput, refs.minFoldAngleThresholdInput, refs.clawInterlockingAngleInput, refs.clawTargetRadiusInput, refs.clawWidthInput, refs.layerHeightInput, refs.tabWidthInput, refs.tabThicknessInput, refs.tabClipGapInput, refs.wireframeThicknessInput].forEach((el) =>
      updateInputColor(el, true),
    );
    updateModifiedIndicators();
    updateWireframeEnabled();
    refs.content.style.minHeight = "";
    refs.content.style.height = "";
    refs.overlay.style.visibility = "hidden";
    refs.overlay.classList.remove("hidden");
    activateTab("basic");
    requestAnimationFrame(() => {
      adjustContentHeight();
      refs.overlay.style.visibility = "";
    });
  });

  refs.joinTypeInterlockingBtn.addEventListener("click", () => {
    settingsDraft.joinType = "interlocking";
    updateJoinTypeButtons();
    updateModifiedIndicators();
  });
  refs.joinTypeClipBtn.addEventListener("click", () => {
    settingsDraft.joinType = "clip";
    updateJoinTypeButtons();
    updateModifiedIndicators();
  });
  refs.joinTypeResetBtn.addEventListener("click", () => {
    settingsDraft.joinType = getDefaultSettings().joinType;
    updateJoinTypeButtons();
    updateModifiedIndicators();
  });

  refs.hollowOnBtn.addEventListener("click", () => {
    settingsDraft.hollowStyle = true;
    updateHollowButtons();
    updateWireframeEnabled();
    updateModifiedIndicators();
  });
  refs.hollowOffBtn.addEventListener("click", () => {
    settingsDraft.hollowStyle = false;
    updateHollowButtons();
    updateWireframeEnabled();
    updateModifiedIndicators();
  });
  refs.hollowResetBtn.addEventListener("click", () => {
    const def = getDefaultSettings().hollowStyle;
    settingsDraft.hollowStyle = def;
    updateHollowButtons();
    updateWireframeEnabled();
    updateModifiedIndicators();
  });
  refs.clipGapAdjustNormalBtn.addEventListener("click", () => {
    settingsDraft.clipGapAdjust = "off";
    updateClipGapAdjustButtons();
    updateModifiedIndicators();
  });
  refs.clipGapAdjustNarrowBtn.addEventListener("click", () => {
    settingsDraft.clipGapAdjust = "on";
    updateClipGapAdjustButtons();
    updateModifiedIndicators();
  });
  refs.clipGapAdjustResetBtn.addEventListener("click", () => {
    settingsDraft.clipGapAdjust = getDefaultSettings().clipGapAdjust;
    updateClipGapAdjustButtons();
    updateModifiedIndicators();
  });
  refs.navBasic.addEventListener("click", () => {
    activateTab("basic");
  });
  refs.navInterlocking.addEventListener("click", () => {
    activateTab("interlocking");
  });
  refs.navClip.addEventListener("click", () => {
    activateTab("clip");
  });
  refs.navExperiment.addEventListener("click", () => {
    activateTab("experiment");
  });

  const bindNumericInput = (
    input: HTMLInputElement,
    resetBtn: HTMLButtonElement,
    parse: (raw: string) => number,
    getDraft: () => number,
    setDraft: (v: number) => void,
    validate: (v: number) => boolean,
    getDefault: () => number,
  ) => {
    input.addEventListener("input", (e) => {
      const raw = (e.target as HTMLInputElement).value;
      const val = parse(raw);
      updateInputColor(input, validate(val));
    });

    input.addEventListener("blur", (e) => {
      const raw = (e.target as HTMLInputElement).value;
      const val = parse(raw);
      if (!validate(val)) {
        input.value = String(getDraft());
        updateInputColor(input, true);
        return;
      }
      setDraft(val);
      updateInputColor(input, true);
      updateModifiedIndicators();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        (e.target as HTMLInputElement).blur();
      }
    });

    resetBtn.addEventListener("click", () => {
      const def = getDefault();
      setDraft(def);
      input.value = String(def);
      updateInputColor(input, true);
      updateModifiedIndicators();
    });
  };

  bindNumericInput(
    refs.scaleInput,
    refs.scaleResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.scale,
    (v) => (settingsDraft.scale = v),
    validators.scale,
    () => getDefaultSettings().scale,
  );
  bindNumericInput(
    refs.minFoldAngleThresholdInput,
    refs.minFoldAngleThresholdResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.minFoldAngleThreshold,
    (v) => (settingsDraft.minFoldAngleThreshold = v),
    validators.minFoldAngleThreshold,
    () => getDefaultSettings().minFoldAngleThreshold,
  );
  bindNumericInput(
    refs.clawInterlockingAngleInput,
    refs.clawInterlockingAngleResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawInterlockingAngle,
    (v) => (settingsDraft.clawInterlockingAngle = v),
    validators.clawInterlockingAngle,
    () => getDefaultSettings().clawInterlockingAngle,
  );
  bindNumericInput(
    refs.clawTargetRadiusInput,
    refs.clawTargetRadiusResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawTargetRadius,
    (v) => (settingsDraft.clawTargetRadius = v),
    validators.clawTargetRadius,
    () => getDefaultSettings().clawTargetRadius,
  );
  bindNumericInput(
    refs.clawWidthInput,
    refs.clawWidthResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawWidth,
    (v) => (settingsDraft.clawWidth = v),
    validators.clawWidth,
    () => getDefaultSettings().clawWidth,
  );
  bindNumericInput(
    refs.layerHeightInput,
    refs.layerHeightResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.layerHeight,
    (v) => (settingsDraft.layerHeight = v),
    validators.layerHeight,
    () => getDefaultSettings().layerHeight,
  );
  bindNumericInput(
    refs.tabWidthInput,
    refs.tabWidthResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.tabWidth,
    (v) => (settingsDraft.tabWidth = v),
    validators.tabWidth,
    () => getDefaultSettings().tabWidth,
  );
  bindNumericInput(
    refs.tabThicknessInput,
    refs.tabThicknessResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.tabThickness,
    (v) => (settingsDraft.tabThickness = v),
    validators.tabThickness,
    () => getDefaultSettings().tabThickness,
  );
  bindNumericInput(
    refs.tabClipGapInput,
    refs.tabClipGapResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.tabClipGap,
    (v) => (settingsDraft.tabClipGap = v),
    validators.tabClipGap,
    () => getDefaultSettings().tabClipGap,
  );
  bindNumericInput(
    refs.wireframeThicknessInput,
    refs.wireframeThicknessResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.wireframeThickness,
    (v) => (settingsDraft.wireframeThickness = v),
    validators.wireframeThickness,
    () => getDefaultSettings().wireframeThickness,
  );

  const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
  const updateConnectionValue = (val: number) => {
    settingsDraft.connectionLayers = clamp(
      val,
      SETTINGS_LIMITS.connectionLayers.min,
      SETTINGS_LIMITS.connectionLayers.max,
    );
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    updateModifiedIndicators();
  };
  const updateBodyValue = (val: number) => {
    settingsDraft.bodyLayers = clamp(val, SETTINGS_LIMITS.bodyLayers.min, SETTINGS_LIMITS.bodyLayers.max);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    updateModifiedIndicators();
  };

  refs.connectionLayersDecBtn.addEventListener("click", () => updateConnectionValue(settingsDraft.connectionLayers - 1));
  refs.connectionLayersIncBtn.addEventListener("click", () => updateConnectionValue(settingsDraft.connectionLayers + 1));
  refs.connectionLayersResetBtn.addEventListener("click", () => updateConnectionValue(getDefaultSettings().connectionLayers));
  refs.bodyLayersDecBtn.addEventListener("click", () => updateBodyValue(settingsDraft.bodyLayers - 1));
  refs.bodyLayersIncBtn.addEventListener("click", () => updateBodyValue(settingsDraft.bodyLayers + 1));
  refs.bodyLayersResetBtn.addEventListener("click", () => updateBodyValue(getDefaultSettings().bodyLayers));

  refs.cancelBtn.addEventListener("click", () => {
    closeSettings();
    settingsDraft = getSettings();
    refs.scaleInput.value = String(settingsDraft.scale);
    refs.minFoldAngleThresholdInput.value = String(settingsDraft.minFoldAngleThreshold);
    refs.clawInterlockingAngleInput.value = String(settingsDraft.clawInterlockingAngle);
    refs.clawTargetRadiusInput.value = String(settingsDraft.clawTargetRadius);
    refs.clawWidthInput.value = String(settingsDraft.clawWidth);
    refs.layerHeightInput.value = String(settingsDraft.layerHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    refs.tabWidthInput.value = String(settingsDraft.tabWidth);
    refs.tabThicknessInput.value = String(settingsDraft.tabThickness);
    refs.tabClipGapInput.value = String(settingsDraft.tabClipGap);
    refs.wireframeThicknessInput.value = String(settingsDraft.wireframeThickness);
    updateJoinTypeButtons();
    updateClipGapAdjustButtons();
    updateHollowButtons();
    [refs.scaleInput, refs.minFoldAngleThresholdInput, refs.clawInterlockingAngleInput, refs.clawTargetRadiusInput, refs.clawWidthInput, refs.layerHeightInput, refs.tabWidthInput, refs.tabThicknessInput, refs.tabClipGapInput, refs.wireframeThicknessInput].forEach((el) =>
      updateInputColor(el, true),
    );
    updateModifiedIndicators();
  });

  refs.confirmBtn.addEventListener("click", () => {
    if (!settingsSnapshot) {
      closeSettings();
      return;
    }
    const changes: string[] = [];
    if (settingsDraft.joinType !== settingsSnapshot.joinType) {
      changes.push(
        t("log.settings.changed", {
          label: t("settings.joinType.label"),
          value: settingsDraft.joinType === "interlocking" ? t("settings.joinType.interlocking") : t("settings.joinType.clip"),
        }),
      );
    }
    if (settingsDraft.scale !== settingsSnapshot.scale) {
      changes.push(t("log.settings.changed", { label: t("settings.scale.label"), value: settingsDraft.scale }));
    }
    if (settingsDraft.minFoldAngleThreshold !== settingsSnapshot.minFoldAngleThreshold) {
      changes.push(t("log.settings.changed", { label: t("settings.minFoldAngleThreshold.label"), value: settingsDraft.minFoldAngleThreshold }));
    }
    if (settingsDraft.clawInterlockingAngle !== settingsSnapshot.clawInterlockingAngle) {
      changes.push(t("log.settings.changed", { label: t("settings.clawInterlockingAngle.label"), value: settingsDraft.clawInterlockingAngle }));
    }
    if (settingsDraft.clawTargetRadius !== settingsSnapshot.clawTargetRadius) {
      changes.push(t("log.settings.changed", { label: t("settings.clawTargetRadius.label"), value: settingsDraft.clawTargetRadius }));
    }
    if (settingsDraft.clawWidth !== settingsSnapshot.clawWidth) {
      changes.push(t("log.settings.changed", { label: t("settings.clawWidth.label"), value: settingsDraft.clawWidth }));
    }
    if (settingsDraft.tabWidth !== settingsSnapshot.tabWidth) {
      changes.push(t("log.settings.changed", { label: t("settings.tabWidth.label"), value: settingsDraft.tabWidth }));
    }
    if (settingsDraft.layerHeight !== settingsSnapshot.layerHeight) {
      changes.push(t("log.settings.changed", { label: t("settings.layerHeight.label"), value: settingsDraft.layerHeight }));
    }
    if (settingsDraft.connectionLayers !== settingsSnapshot.connectionLayers) {
      changes.push(t("log.settings.changed", { label: t("settings.connectionLayers.label"), value: settingsDraft.connectionLayers }));
    }
    if (settingsDraft.bodyLayers !== settingsSnapshot.bodyLayers) {
      changes.push(t("log.settings.changed", { label: t("settings.bodyLayers.label"), value: settingsDraft.bodyLayers }));
    }
    if (settingsDraft.tabThickness !== settingsSnapshot.tabThickness) {
      changes.push(t("log.settings.changed", { label: t("settings.tabThickness.label"), value: settingsDraft.tabThickness }));
    }
    if (settingsDraft.tabClipGap !== settingsSnapshot.tabClipGap) {
      changes.push(t("log.settings.changed", { label: t("settings.tabClipGap.label"), value: settingsDraft.tabClipGap }));
    }
    if (settingsDraft.clipGapAdjust !== settingsSnapshot.clipGapAdjust) {
      const label = settingsDraft.clipGapAdjust === "off" ? t("settings.clipGapAdjusts.off") : t("settings.clipGapAdjusts.on");
      changes.push(t("log.settings.changed", { label: t("settings.clipGapAdjusts.label"), value: label }));
    }
    if (settingsDraft.hollowStyle !== settingsSnapshot.hollowStyle) {
      const hollowValue = settingsDraft.hollowStyle ? t("settings.hollow.on") : t("settings.hollow.off");
      changes.push(t("log.settings.changed", { label: t("settings.hollow.label"), value: hollowValue }));
    }
    if (settingsDraft.wireframeThickness !== settingsSnapshot.wireframeThickness) {
      changes.push(t("log.settings.changed", { label: t("settings.wireframeThickness.label"), value: settingsDraft.wireframeThickness }));
    }
    applySettings(settingsDraft);
    closeSettings();
    if (changes.length) {
      changes.forEach((msg) => deps.log(msg, "info"));
    }
  });

  const dispose = () => {
    window.removeEventListener("keydown", blockKeysWhenSettingsOpen);
  };

  return { isOpen, close: closeSettings, dispose };
}
