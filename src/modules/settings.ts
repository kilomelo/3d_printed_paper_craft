// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。

export type Settings = {
  scale: number;
  layerHeight: number;
  connectionLayers: number;
  bodyLayers: number;
};

export const SETTINGS_LIMITS = {
  scale: { min: 0 },
  layerHeight: { min: 0, max: 0.5 },
  connectionLayers: { min: 1, max: 4 },
  bodyLayers: { min: 1, max: 8 },
} as const;

const defaultSettings: Settings = {
  scale: 1,
  layerHeight: 0.2,
  connectionLayers: 1,
  bodyLayers: 3,
};

let current: Settings = { ...defaultSettings };

export function getSettings(): Settings {
  return { ...current };
}

export function setScale(scale: number) {
  if (Number.isNaN(scale) || scale < SETTINGS_LIMITS.scale.min) return;
  current = { ...current, scale };
}

export function setLayerHeight(val: number) {
  if (
    Number.isNaN(val) ||
    val <= SETTINGS_LIMITS.layerHeight.min ||
    val > SETTINGS_LIMITS.layerHeight.max
  )
    return;
  current = { ...current, layerHeight: val };
}

export function setConnectionLayers(val: number) {
  if (
    !Number.isInteger(val) ||
    val < SETTINGS_LIMITS.connectionLayers.min ||
    val > SETTINGS_LIMITS.connectionLayers.max
  )
    return;
  current = { ...current, connectionLayers: val };
}

export function setBodyLayers(val: number) {
  if (
    !Number.isInteger(val) ||
    val < SETTINGS_LIMITS.bodyLayers.min ||
    val > SETTINGS_LIMITS.bodyLayers.max
  )
    return;
  current = { ...current, bodyLayers: val };
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
