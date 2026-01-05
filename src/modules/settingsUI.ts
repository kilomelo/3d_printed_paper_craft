// 设置面板 UI：负责设置窗口的打开/关闭、输入校验、草稿值管理以及日志输出。
import { getSettings, applySettings, getDefaultSettings } from "./settings";

type SettingsUIRefs = {
  overlay: HTMLDivElement;
  openBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
  scaleInput: HTMLInputElement;
  scaleResetBtn: HTMLButtonElement;
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

  const updateInputColor = (el: HTMLInputElement, valid: boolean) => {
    el.style.color = valid ? "" : "red";
  };

  const validators = {
    scale: (val: number) => !Number.isNaN(val) && val > 0,
    layerHeight: (val: number) => !Number.isNaN(val) && val > 0 && val <= 0.5,
    connectionLayers: (val: number) => Number.isInteger(val) && val >= 1 && val <= 5,
    bodyLayers: (val: number) => Number.isInteger(val) && val >= 2 && val <= 10,
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
    refs.layerHeightInput.value = String(settingsDraft.layerHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    [refs.scaleInput, refs.layerHeightInput].forEach((el) => updateInputColor(el, true));
    refs.overlay.classList.remove("hidden");
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

  const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
  const updateConnectionValue = (val: number) => {
    settingsDraft.connectionLayers = clamp(val, 1, 5);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
  };
  const updateBodyValue = (val: number) => {
    settingsDraft.bodyLayers = clamp(val, 2, 10);
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
    [refs.scaleInput, refs.layerHeightInput].forEach((el) => updateInputColor(el, true));
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
    if (settingsDraft.layerHeight !== settingsSnapshot.layerHeight) {
      changes.push(`设置值 [打印层高] 已修改为 ${settingsDraft.layerHeight}`);
    }
    if (settingsDraft.connectionLayers !== settingsSnapshot.connectionLayers) {
      changes.push(`设置值 [连接层数] 已修改为 ${settingsDraft.connectionLayers}`);
    }
    if (settingsDraft.bodyLayers !== settingsSnapshot.bodyLayers) {
      changes.push(`设置值 [主体层数] 已修改为 ${settingsDraft.bodyLayers}`);
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
