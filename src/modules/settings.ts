// 设置模块：管理应用内的可配置参数，并支持在 3dppc 中读写。
import { appEventBus } from "./eventBus.js";

export type Settings = {
  scale: number;
  layerHeight: number;
  connectionLayers: number;
  bodyLayers: number;
  joinType: "interlocking" | "clip";
  clawInterlockingAngle: number;
  clawTargetRadius: number;
  clawRadiusAdaptive: "off" | "on";
  clawWidth: number;
  clawFitGap: number;
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
  clawInterlockingAngle: { min: 1, max: 8 },
  clawTargetRadius: { min: 1.5, max: 5 },
  clawRadiusAdaptive: { allowed: ["off", "on"] as const },
  clawWidth: { min: 5, max: 10 },
  clawFitGap: { min: 0.02, max: 0.2 },
  tabWidth: { min: 0, max: 20 },
  tabThickness: { min: 0.8, max: 2 },
  minFoldAngleThreshold: { min: 0.1, max: 5 },
  tabClipGap: { min: 0.1, max: 0.3 },
  clipGapAdjust: { allowed: ["off", "on"] as const },
  wireframeThickness: { min: 4, max: 10 },
} as const;

const defaultSettings: Settings = {
  joinType: "clip",
  scale: 1,
  layerHeight: 0.2,
  connectionLayers: 1,
  bodyLayers: 3,
  clawInterlockingAngle: 4,
  clawTargetRadius: 2.5,
  clawRadiusAdaptive: "on",
  clawWidth: 7,
  clawFitGap: 0.05,
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

export function setClawInterlockingAngle(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawInterlockingAngle.min ||
    val > SETTINGS_LIMITS.clawInterlockingAngle.max
  ) return;
  current = { ...current, clawInterlockingAngle: val };
}

export function setClawTargetRadius(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawTargetRadius.min ||
    val > SETTINGS_LIMITS.clawTargetRadius.max
  ) return;
  current = { ...current, clawTargetRadius: val };
}

export function setClawRadiusAdaptive(val: Settings["clawRadiusAdaptive"]) {
  if (!SETTINGS_LIMITS.clawRadiusAdaptive.allowed.includes(val)) return;
  current = { ...current, clawRadiusAdaptive: val };
}

export function setClawWidth(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawWidth.min ||
    val > SETTINGS_LIMITS.clawWidth.max
  ) return;
  current = { ...current, clawWidth: val };
}

export function setClawFitGap(val: number) {
  if (
    Number.isNaN(val) ||
    val < SETTINGS_LIMITS.clawFitGap.min ||
    val > SETTINGS_LIMITS.clawFitGap.max
  ) return;
  current = { ...current, clawFitGap: val };
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

const clamp = (value: number, min: number, max?: number) => {
  if (max == null) return Math.max(value, min);
  return Math.min(Math.max(value, min), max);
};

const readFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
};

// 3dppc 文件里的 settings 可能来自旧版本，或者带着历史脏值。
// 导入时按字段清洗：
// 1. 缺失字段回退到当前版本默认值；
// 2. 枚举字段只接受白名单；
// 3. 数值字段接受 number 或可解析的数字字符串，并按当前版本约束裁剪；
// 4. 布尔字段接受 boolean 或 "true"/"false"。
const sanitizeImportedSettings = (imported: Partial<Record<keyof Settings, unknown>>): Settings => {
  const next: Settings = { ...defaultSettings };

  if (typeof imported.joinType === "string") {
    const joinType = imported.joinType as Settings["joinType"];
    if (SETTINGS_LIMITS.joinType.allowed.includes(joinType)) {
      next.joinType = joinType;
    }
  }
  if (typeof imported.clawRadiusAdaptive === "string") {
    const clawRadiusAdaptive = imported.clawRadiusAdaptive as Settings["clawRadiusAdaptive"];
    if (SETTINGS_LIMITS.clawRadiusAdaptive.allowed.includes(clawRadiusAdaptive)) {
      next.clawRadiusAdaptive = clawRadiusAdaptive;
    }
  }
  if (typeof imported.clipGapAdjust === "string") {
    const clipGapAdjust = imported.clipGapAdjust as Settings["clipGapAdjust"];
    if (SETTINGS_LIMITS.clipGapAdjust.allowed.includes(clipGapAdjust)) {
      next.clipGapAdjust = clipGapAdjust;
    }
  }
  const hollowStyle = readBoolean(imported.hollowStyle);
  if (hollowStyle != null) {
    next.hollowStyle = hollowStyle;
  }

  const scale = readFiniteNumber(imported.scale);
  if (scale != null) {
    next.scale = clamp(scale, SETTINGS_LIMITS.scale.min);
  }
  const layerHeight = readFiniteNumber(imported.layerHeight);
  if (layerHeight != null) {
    next.layerHeight = clamp(layerHeight, Number.EPSILON, SETTINGS_LIMITS.layerHeight.max);
  }
  const connectionLayers = readFiniteNumber(imported.connectionLayers);
  if (connectionLayers != null) {
    next.connectionLayers = clamp(
      Math.round(connectionLayers),
      SETTINGS_LIMITS.connectionLayers.min,
      SETTINGS_LIMITS.connectionLayers.max,
    );
  }
  const bodyLayers = readFiniteNumber(imported.bodyLayers);
  if (bodyLayers != null) {
    next.bodyLayers = clamp(
      Math.round(bodyLayers),
      SETTINGS_LIMITS.bodyLayers.min,
      SETTINGS_LIMITS.bodyLayers.max,
    );
  }
  const clawInterlockingAngle = readFiniteNumber(imported.clawInterlockingAngle);
  if (clawInterlockingAngle != null) {
    next.clawInterlockingAngle = clamp(
      clawInterlockingAngle,
      SETTINGS_LIMITS.clawInterlockingAngle.min,
      SETTINGS_LIMITS.clawInterlockingAngle.max,
    );
  }
  const clawTargetRadius = readFiniteNumber(imported.clawTargetRadius);
  if (clawTargetRadius != null) {
    next.clawTargetRadius = clamp(
      clawTargetRadius,
      SETTINGS_LIMITS.clawTargetRadius.min,
      SETTINGS_LIMITS.clawTargetRadius.max,
    );
  }
  const clawWidth = readFiniteNumber(imported.clawWidth);
  if (clawWidth != null) {
    next.clawWidth = clamp(clawWidth, SETTINGS_LIMITS.clawWidth.min, SETTINGS_LIMITS.clawWidth.max);
  }
  const clawFitGap = readFiniteNumber(imported.clawFitGap);
  if (clawFitGap != null) {
    next.clawFitGap = clamp(clawFitGap, SETTINGS_LIMITS.clawFitGap.min, SETTINGS_LIMITS.clawFitGap.max);
  }
  const tabWidth = readFiniteNumber(imported.tabWidth);
  if (tabWidth != null) {
    next.tabWidth = clamp(tabWidth, SETTINGS_LIMITS.tabWidth.min, SETTINGS_LIMITS.tabWidth.max - 1e-6);
  }
  const tabThickness = readFiniteNumber(imported.tabThickness);
  if (tabThickness != null) {
    next.tabThickness = clamp(
      tabThickness,
      SETTINGS_LIMITS.tabThickness.min,
      SETTINGS_LIMITS.tabThickness.max,
    );
  }
  const minFoldAngleThreshold = readFiniteNumber(imported.minFoldAngleThreshold);
  if (minFoldAngleThreshold != null) {
    next.minFoldAngleThreshold = clamp(
      minFoldAngleThreshold,
      SETTINGS_LIMITS.minFoldAngleThreshold.min,
      SETTINGS_LIMITS.minFoldAngleThreshold.max,
    );
  }
  const tabClipGap = readFiniteNumber(imported.tabClipGap);
  if (tabClipGap != null) {
    next.tabClipGap = clamp(tabClipGap, SETTINGS_LIMITS.tabClipGap.min, SETTINGS_LIMITS.tabClipGap.max);
  }
  const wireframeThickness = readFiniteNumber(imported.wireframeThickness);
  if (wireframeThickness != null) {
    next.wireframeThickness = clamp(
      wireframeThickness,
      SETTINGS_LIMITS.wireframeThickness.min,
      SETTINGS_LIMITS.wireframeThickness.max,
    );
  }

  return next;
};

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

export function importSettings(imported: Partial<Record<keyof Settings, unknown>>) {
  current = sanitizeImportedSettings(imported);
}

export function getDefaultSettings(): Settings {
  return { ...defaultSettings };
}
