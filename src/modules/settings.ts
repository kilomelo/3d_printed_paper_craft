// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。
import { appEventBus } from "./eventBus.js";

export type Settings = {
  scale: number;
  layerHeight: number;
  connectionLayers: number;
  bodyLayers: number;
  joinType: "interlocking" | "clip";
  clawInterclockingAngle: number;
  clawTargetRadius: number;
  clawWidth: number;
  tabWidth: number;
  tabThickness: number;
  minFoldAngleThreshold: number;
  tabClipGap: number;
  clipGapAdjust: "off" | "on";
  hollowStyle: boolean;
  wireframeThickness: number;
};

export const SETTINGS_LIMITS = {
  scale: { min: 0 },
  layerHeight: { min: 0, max: 0.5 },
  connectionLayers: { min: 1, max: 4 },
  bodyLayers: { min: 1, max: 8 },
  joinType: { allowed: ["interlocking", "clip"] as const },
  clawInterclockingAngle: { min: 3, max: 7 },
  clawTargetRadius: { min: 2, max: 5 },
  clawWidth: { min: 5, max: 10 },
  tabWidth: { min: 0, max: 20 },
  tabThickness: { min: 0.8, max: 2 },
  minFoldAngleThreshold: { min: 0.1, max: 5 },
  tabClipGap: { min: 0.1, max: 0.3 },
  clipGapAdjust: { allowed: ["off", "on"] as const },
  wireframeThickness: { min: 4, max: 10 },
} as const;

const defaultSettings: Settings = {
  joinType: "interlocking",
  scale: 1,
  layerHeight: 0.2,
  connectionLayers: 1,
  bodyLayers: 3,
  clawInterclockingAngle: 5,
  clawTargetRadius: 3,
  clawWidth: 7,
  tabWidth: 4,
  tabThickness: 1,
  minFoldAngleThreshold: 1,
  tabClipGap: 0.12,
  clipGapAdjust: "off",
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

export function setJoinType(val: Settings["joinType"]) {
  if (!SETTINGS_LIMITS.joinType.allowed.includes(val)) return;
  current = { ...current, joinType: val };
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

export function setClawInterclockingAngle(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawInterclockingAngle.min ||
    val > SETTINGS_LIMITS.clawInterclockingAngle.max
  ) return;
  current = { ...current, clawInterclockingAngle: val };
}

export function setClawTargetRadius(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawTargetRadius.min ||
    val > SETTINGS_LIMITS.clawTargetRadius.max
  ) return;
  current = { ...current, clawTargetRadius: val };
}

export function setClawWidth(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawWidth.min ||
    val > SETTINGS_LIMITS.clawWidth.max
  ) return;
  current = { ...current, clawWidth: val };
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

export function setTabWidth(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.tabWidth.min || val >= SETTINGS_LIMITS.tabWidth.max) return;
  current = { ...current, tabWidth: val };
}

export function setTabThickness(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.tabThickness.min || val > SETTINGS_LIMITS.tabThickness.max) return;
  current = { ...current, tabThickness: val };
}

export function setMinFoldAngleThreshold(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.minFoldAngleThreshold.min ||
    val > SETTINGS_LIMITS.minFoldAngleThreshold.max
  ) return;
  current = { ...current, minFoldAngleThreshold: val };
}

export function setTabClipGap(val: number) {
  if (Number.isNaN(val) || val < SETTINGS_LIMITS.tabClipGap.min || val > SETTINGS_LIMITS.tabClipGap.max) return;
  current = { ...current, tabClipGap: val };
}

export function setClipGapAdjust(val: Settings["clipGapAdjust"]) {
  if (!SETTINGS_LIMITS.clipGapAdjust.allowed.includes(val)) return;
  current = { ...current, clipGapAdjust: val };
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
