// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。
import { appEventBus } from "./eventBus.js";

export type Settings = {
  scale: number;
  layerHeight: number;
  connectionLayers: number;
  bodyLayers: number;
  earWidth: number;
  earThickness: number;
  earClipGap: number;
  hollowStyle: boolean;
  wireframeThickness: number;
};

export const SETTINGS_LIMITS = {
  scale: { min: 0 },
  layerHeight: { min: 0, max: 0.5 },
  connectionLayers: { min: 1, max: 4 },
  bodyLayers: { min: 1, max: 8 },
  earWidth: { min: 0, max: 20 },
  earThickness: { min: 1, max: 2 },
  earClipGap: { min: 0.1, max: 0.25 },
  wireframeThickness: { min: 4, max: 10 },
} as const;

const defaultSettings: Settings = {
  scale: 1,
  layerHeight: 0.2,
  connectionLayers: 1,
  bodyLayers: 3,
  earWidth: 4,
  earThickness: 1,
  earClipGap: 0.15,
  hollowStyle: false,
  wireframeThickness: 5,
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

export function setEarClipGap(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.earClipGap.min || val > SETTINGS_LIMITS.earClipGap.max) return;
  current = { ...current, earClipGap: val };
}

export function setHollowStyle(val: boolean) {
  current = { ...current, hollowStyle: !!val };
}

export function setWireframeThickness(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.wireframeThickness.min || val > SETTINGS_LIMITS.wireframeThickness.max) return;
  current = { ...current, wireframeThickness: val };
}

export function resetSettings() {
  current = { ...defaultSettings };
}

export function applySettings(next: Partial<Settings>, emitEvent: boolean = true) {
  // 如果没有实际变化则直接返回
  const merged = { ...current, ...next };
  let changedItemCnt = 0;
  (Object.keys(next) as (keyof Settings)[]).forEach((key) => {
    if (current[key] !== merged[key]) {
      changedItemCnt += 1;
    }
  });
  if (changedItemCnt === 0) return;
  current = { ...current, ...next };
  if (emitEvent) appEventBus.emit("settingsChanged", changedItemCnt);
}

export function importSettings(imported: Partial<Settings>) {
  applySettings(imported, false);
}

export function getDefaultSettings(): Settings {
  return { ...defaultSettings };
}
