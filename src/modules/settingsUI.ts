// 设置面板 UI：负责设置窗口的打开/关闭、输入校验、草稿值管理以及日志输出。
import { getSettings, applySettings, getDefaultSettings, SETTINGS_LIMITS } from "./settings";

type SettingsUIRefs = {
  overlay: HTMLDivElement;
  content: HTMLDivElement;
  openBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
  scaleInput: HTMLInputElement;
  scaleResetBtn: HTMLButtonElement;
  earWidthInput: HTMLInputElement;
  earWidthResetBtn: HTMLButtonElement;
  earThicknessInput: HTMLInputElement;
  earThicknessResetBtn: HTMLButtonElement;
  earClipGapInput: HTMLInputElement;
  earClipGapResetBtn: HTMLButtonElement;
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
  navExperiment: HTMLButtonElement;
  panelBasic: HTMLDivElement;
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
    settingsSnapshot = null;
  };

  const updateHollowButtons = () => {
    refs.hollowOnBtn.classList.toggle("active", settingsDraft.hollowStyle);
    refs.hollowOffBtn.classList.toggle("active", !settingsDraft.hollowStyle);
  };

  const updateWireframeEnabled = () => {
    const enabled = settingsDraft.hollowStyle;
    refs.wireframeThicknessInput.disabled = !enabled;
    refs.wireframeThicknessResetBtn.disabled = !enabled;
    refs.wireframeRow.classList.toggle("disabled", !enabled);
  };

  const activateTab = (tab: "basic" | "experiment") => {
    const isBasic = tab === "basic";
    refs.navBasic.classList.toggle("active", isBasic);
    refs.navExperiment.classList.toggle("active", !isBasic);
    refs.panelBasic.classList.toggle("active", isBasic);
    refs.panelExperiment.classList.toggle("active", !isBasic);
  };

  const measurePanelHeight = (panel: HTMLDivElement) => {
    const prevDisplay = panel.style.display;
    const prevVisibility = panel.style.visibility;
    const prevPosition = panel.style.position;
    panel.style.visibility = "hidden";
    panel.style.position = "absolute";
    panel.style.display = "block";
    const h = panel.scrollHeight;
    panel.style.display = prevDisplay;
    panel.style.visibility = prevVisibility;
    panel.style.position = prevPosition;
    return h;
  };

  const adjustContentHeight = () => {
    const basicH = measurePanelHeight(refs.panelBasic);
    const expH = measurePanelHeight(refs.panelExperiment);
    const maxContent = Math.max(basicH, expH);
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
    earThickness: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.earThickness.min && val <= SETTINGS_LIMITS.earThickness.max,
    layerHeight: (val: number) =>
      !Number.isNaN(val) && val > SETTINGS_LIMITS.layerHeight.min && val <= SETTINGS_LIMITS.layerHeight.max,
    connectionLayers: (val: number) =>
      Number.isInteger(val) &&
      val >= SETTINGS_LIMITS.connectionLayers.min &&
      val <= SETTINGS_LIMITS.connectionLayers.max,
    bodyLayers: (val: number) =>
      Number.isInteger(val) && val >= SETTINGS_LIMITS.bodyLayers.min && val <= SETTINGS_LIMITS.bodyLayers.max,
    earWidth: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.earWidth.min && val < SETTINGS_LIMITS.earWidth.max,
    earClipGap: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.earClipGap.min && val <= SETTINGS_LIMITS.earClipGap.max,
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
    refs.scaleInput.value = String(settingsDraft.scale);
    refs.earThicknessInput.value = String(settingsDraft.earThickness);
    refs.layerHeightInput.value = String(settingsDraft.layerHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    refs.earWidthInput.value = String(settingsDraft.earWidth);
    refs.earThicknessInput.value = String(settingsDraft.earThickness);
    refs.earClipGapInput.value = String(settingsDraft.earClipGap);
    refs.wireframeThicknessInput.value = String(settingsDraft.wireframeThickness);
    updateHollowButtons();
    updateWireframeEnabled();
    [refs.scaleInput, refs.layerHeightInput, refs.earWidthInput, refs.earThicknessInput, refs.earClipGapInput, refs.wireframeThicknessInput].forEach((el) =>
      updateInputColor(el, true),
    );
    updateWireframeEnabled();
    activateTab("basic");
    adjustContentHeight();
    refs.overlay.classList.remove("hidden");
  });

  refs.hollowOnBtn.addEventListener("click", () => {
    settingsDraft.hollowStyle = true;
    updateHollowButtons();
    updateWireframeEnabled();
  });
  refs.hollowOffBtn.addEventListener("click", () => {
    settingsDraft.hollowStyle = false;
    updateHollowButtons();
    updateWireframeEnabled();
  });
  refs.hollowResetBtn.addEventListener("click", () => {
    const def = getDefaultSettings().hollowStyle;
    settingsDraft.hollowStyle = def;
    updateHollowButtons();
    updateWireframeEnabled();
  });
  refs.navBasic.addEventListener("click", () => {
    activateTab("basic");
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
    refs.layerHeightInput,
    refs.layerHeightResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.layerHeight,
    (v) => (settingsDraft.layerHeight = v),
    validators.layerHeight,
    () => getDefaultSettings().layerHeight,
  );
  bindNumericInput(
    refs.earWidthInput,
    refs.earWidthResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.earWidth,
    (v) => (settingsDraft.earWidth = v),
    validators.earWidth,
    () => getDefaultSettings().earWidth,
  );
  bindNumericInput(
    refs.earThicknessInput,
    refs.earThicknessResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.earThickness,
    (v) => (settingsDraft.earThickness = v),
    validators.earThickness,
    () => getDefaultSettings().earThickness,
  );
  bindNumericInput(
    refs.earClipGapInput,
    refs.earClipGapResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.earClipGap,
    (v) => (settingsDraft.earClipGap = v),
    validators.earClipGap,
    () => getDefaultSettings().earClipGap,
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
  };
  const updateBodyValue = (val: number) => {
    settingsDraft.bodyLayers = clamp(val, SETTINGS_LIMITS.bodyLayers.min, SETTINGS_LIMITS.bodyLayers.max);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
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
    refs.layerHeightInput.value = String(settingsDraft.layerHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    refs.earWidthInput.value = String(settingsDraft.earWidth);
    refs.earThicknessInput.value = String(settingsDraft.earThickness);
    refs.earClipGapInput.value = String(settingsDraft.earClipGap);
    refs.wireframeThicknessInput.value = String(settingsDraft.wireframeThickness);
    updateHollowButtons();
    [refs.scaleInput, refs.layerHeightInput, refs.earWidthInput, refs.earThicknessInput, refs.earClipGapInput, refs.wireframeThicknessInput].forEach((el) =>
      updateInputColor(el, true),
    );
  });

  refs.confirmBtn.addEventListener("click", () => {
    if (!settingsSnapshot) {
      closeSettings();
      return;
    }
    const changes: string[] = [];
    if (settingsDraft.scale !== settingsSnapshot.scale) {
      changes.push(`设置值 [缩放比例] 已修改为 ${settingsDraft.scale}`);
    }
    if (settingsDraft.earWidth !== settingsSnapshot.earWidth) {
      changes.push(`设置值 [拼接边耳朵宽度] 已修改为 ${settingsDraft.earWidth}`);
    }
    if (settingsDraft.layerHeight !== settingsSnapshot.layerHeight) {
      changes.push(`设置值 [打印层高] 已修改为 ${settingsDraft.layerHeight}`);
    }
    if (settingsDraft.connectionLayers !== settingsSnapshot.connectionLayers) {
      changes.push(`设置值 [连接层数] 已修改为 ${settingsDraft.connectionLayers}`);
    }
    if (settingsDraft.bodyLayers !== settingsSnapshot.bodyLayers) {
      changes.push(`设置值 [主体层数] 已修改为 ${settingsDraft.bodyLayers}`);
    }
    if (settingsDraft.earThickness !== settingsSnapshot.earThickness) {
      changes.push(`设置值 [拼接边耳朵厚度] 已修改为 ${settingsDraft.earThickness}`);
    }
    if (settingsDraft.earClipGap !== settingsSnapshot.earClipGap) {
      changes.push(`设置值 [夹子配合间隙] 已修改为 ${settingsDraft.earClipGap}`);
    }
    if (settingsDraft.hollowStyle !== settingsSnapshot.hollowStyle) {
      changes.push(`设置值 [镂空风格] 已修改为 ${settingsDraft.hollowStyle ? "开启" : "关闭"}`);
    }
    if (settingsDraft.wireframeThickness !== settingsSnapshot.wireframeThickness) {
      changes.push(`设置值 [线框粗细] 已修改为 ${settingsDraft.wireframeThickness}`);
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
