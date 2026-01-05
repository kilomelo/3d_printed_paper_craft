// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。

export type Settings = {
  scale: number;
  layerHeight: number;
  connectionLayers: number;
  bodyLayers: number;
};

const defaultSettings: Settings = {
  scale: 1,
  layerHeight: 0.2,
  connectionLayers: 2,
  bodyLayers: 4,
};

let current: Settings = { ...defaultSettings };

export function getSettings(): Settings {
  return { ...current };
}

export function setScale(scale: number) {
  if (Number.isNaN(scale) || scale < 0) return;
  current = { ...current, scale };
}

export function setLayerHeight(val: number) {
  if (Number.isNaN(val) || val <= 0 || val > 0.5) return;
  current = { ...current, layerHeight: val };
}

export function setConnectionLayers(val: number) {
  if (!Number.isInteger(val) || val < 1 || val > 5) return;
  current = { ...current, connectionLayers: val };
}

export function setBodyLayers(val: number) {
  if (!Number.isInteger(val) || val < 2 || val > 10) return;
  current = { ...current, bodyLayers: val };
}

export function resetSettings() {
  current = { ...defaultSettings };
}

export function applySettings(next: Partial<Settings>) {
  current = { ...current, ...next };
  console.debug("[Settings] applied settings:", current);
}

export function getDefaultSettings(): Settings {
  return { ...defaultSettings };
}
