// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。
import { appEventBus } from "./eventBus.js";

export type Settings = {
  scale: number;
  layerHeight: number;
  connectionLayers: number;
  bodyLayers: number;
  earWidth: number;
  earThickness: number;
};

export const SETTINGS_LIMITS = {
  scale: { min: 0 },
  layerHeight: { min: 0, max: 0.5 },
  connectionLayers: { min: 1, max: 4 },
  bodyLayers: { min: 1, max: 8 },
  earWidth: { min: 0, max: 990 },
  earThickness: { min: 1, max: 2 },
} as const;

const defaultSettings: Settings = {
  scale: 1,
  layerHeight: 0.2,
  connectionLayers: 1,
  bodyLayers: 3,
  earWidth: 4,
  earThickness: 1,
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

export function setEarWidth(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.earWidth.min || val >= SETTINGS_LIMITS.earWidth.max) return;
  current = { ...current, earWidth: val };
}

export function setEarThickness(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.earThickness.min || val > SETTINGS_LIMITS.earThickness.max) return;
  current = { ...current, earThickness: val };
}

export function resetSettings() {
  current = { ...defaultSettings };
}

export function applySettings(next: Partial<Settings>) {
  // 如果没有实际变化则直接返回
  const merged = { ...current, ...next };
  const unchanged =
    merged.scale === current.scale &&
    merged.layerHeight === current.layerHeight &&
    merged.connectionLayers === current.connectionLayers &&
    merged.bodyLayers === current.bodyLayers &&
    merged.earWidth === current.earWidth &&
    merged.earThickness === current.earThickness;
  if (unchanged) return;
  current = { ...current, ...next };
  appEventBus.emit("settingsChanged", next);
}

export function getDefaultSettings(): Settings {
  return { ...defaultSettings };
}
