// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。

export type Settings = {
  scale: number;
};

const defaultSettings: Settings = {
  scale: 1,
};

let current: Settings = { ...defaultSettings };

export function getSettings(): Settings {
  return { ...current };
}

export function setScale(scale: number) {
  if (Number.isNaN(scale) || scale < 0) return;
  current = { ...current, scale };
}

export function resetSettings() {
  current = { ...defaultSettings };
}

export function applySettings(next: Partial<Settings>) {
  current = { ...current, ...next };
}

export function getDefaultSettings(): Settings {
  return { ...defaultSettings };
}
