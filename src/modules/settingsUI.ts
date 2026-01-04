// 设置面板 UI：负责设置窗口的打开/关闭、输入校验、草稿值管理以及日志输出。
import { getSettings, applySettings, getDefaultSettings } from "./settings";

type SettingsUIRefs = {
  overlay: HTMLDivElement;
  openBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
  scaleInput: HTMLInputElement;
  scaleResetBtn: HTMLButtonElement;
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

  const updateInputColor = (valid: boolean) => {
    refs.scaleInput.style.color = valid ? "" : "red";
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
    updateInputColor(true);
    refs.overlay.classList.remove("hidden");
  });

  refs.scaleInput.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    const valid = /^\d*\.?\d*$/.test(target.value) && target.value !== "";
    const val = valid ? parseFloat(target.value) : NaN;
    updateInputColor(!Number.isNaN(val) && val > 0);
  });

  refs.scaleInput.addEventListener("blur", (e) => {
    const raw = (e.target as HTMLInputElement).value;
    if (!/^\d*\.?\d*$/.test(raw) || raw === "") {
      refs.scaleInput.value = String(settingsDraft.scale);
      updateInputColor(true);
      return;
    }
    const val = parseFloat(raw);
    if (Number.isNaN(val) || val < 0) {
      refs.scaleInput.value = String(settingsDraft.scale);
      updateInputColor(true);
      return;
    }
    settingsDraft.scale = val;
    updateInputColor(true);
  });

  refs.scaleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      (e.target as HTMLInputElement).blur();
    }
  });

  refs.scaleResetBtn.addEventListener("click", () => {
    settingsDraft.scale = getDefaultSettings().scale;
    refs.scaleInput.value = String(settingsDraft.scale);
    updateInputColor(true);
  });

  refs.cancelBtn.addEventListener("click", () => {
    closeSettings();
    settingsDraft = getSettings();
    updateInputColor(true);
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
