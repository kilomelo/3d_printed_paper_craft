// 设置面板 UI：负责设置窗口的打开/关闭、输入校验、草稿值管理以及日志输出。
import { getSettings, applySettings, getDefaultSettings, SETTINGS_LIMITS } from "./settings";
import { t } from "./i18n";

export type SettingsUIRefs = {
  overlay: HTMLDivElement;
  content: HTMLDivElement;
  openBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
  joinTypeInterlockingBtn: HTMLButtonElement;
  joinTypeClipBtn: HTMLButtonElement;
  joinTypeResetBtn: HTMLButtonElement;
  scaleInput: HTMLInputElement;
  scaleResetBtn: HTMLButtonElement;
  minFoldAngleThresholdInput: HTMLInputElement;
  minFoldAngleThresholdResetBtn: HTMLButtonElement;
  clawInterlockingAngleInput: HTMLInputElement;
  clawInterlockingAngleResetBtn: HTMLButtonElement;
  clawTargetRadiusInput: HTMLInputElement;
  clawTargetRadiusResetBtn: HTMLButtonElement;
  clawRadiusAdaptiveOffBtn: HTMLButtonElement;
  clawRadiusAdaptiveOnBtn: HTMLButtonElement;
  clawRadiusAdaptiveResetBtn: HTMLButtonElement;
  clawWidthInput: HTMLInputElement;
  clawWidthResetBtn: HTMLButtonElement;
  clawFitGapInput: HTMLInputElement;
  clawFitGapResetBtn: HTMLButtonElement;
  tabWidthInput: HTMLInputElement;
  tabWidthResetBtn: HTMLButtonElement;
  tabThicknessInput: HTMLInputElement;
  tabThicknessResetBtn: HTMLButtonElement;
  tabClipGapInput: HTMLInputElement;
  tabClipGapResetBtn: HTMLButtonElement;
  antiSlipClipOffBtn: HTMLButtonElement;
  antiSlipClipWeakBtn: HTMLButtonElement;
  antiSlipClipStrongBtn: HTMLButtonElement;
  antiSlipClipResetBtn: HTMLButtonElement;
  clipGapAdjustNormalBtn: HTMLButtonElement;
  clipGapAdjustNarrowBtn: HTMLButtonElement;
  clipGapAdjustResetBtn: HTMLButtonElement;
  includeTextureInProjectIncludeBtn: HTMLButtonElement;
  includeTextureInProjectExcludeBtn: HTMLButtonElement;
  includeTextureInProjectResetBtn: HTMLButtonElement;
  textureColorSpaceSrgbBtn: HTMLButtonElement;
  textureColorSpaceLinearBtn: HTMLButtonElement;
  textureColorSpaceResetBtn: HTMLButtonElement;
  textureSamplingModeSmoothBtn: HTMLButtonElement;
  textureSamplingModePixelStableBtn: HTMLButtonElement;
  textureSamplingModePixelCrispBtn: HTMLButtonElement;
  textureSamplingModeResetBtn: HTMLButtonElement;
  textureFlipYTrueBtn: HTMLButtonElement;
  textureFlipYFalseBtn: HTMLButtonElement;
  textureFlipYResetBtn: HTMLButtonElement;
  generatedTextureResolution1024Btn: HTMLButtonElement;
  generatedTextureResolution2048Btn: HTMLButtonElement;
  generatedTextureResolution4096Btn: HTMLButtonElement;
  generatedTextureResolutionResetBtn: HTMLButtonElement;
  hollowOnBtn: HTMLButtonElement;
  hollowOffBtn: HTMLButtonElement;
  hollowResetBtn: HTMLButtonElement;
  wireframeThicknessInput: HTMLInputElement;
  wireframeThicknessResetBtn: HTMLButtonElement;
  wireframeRow: HTMLDivElement;
  layerHeight008Btn: HTMLButtonElement;
  layerHeight012Btn: HTMLButtonElement;
  layerHeight016Btn: HTMLButtonElement;
  layerHeight020Btn: HTMLButtonElement;
  layerHeight024Btn: HTMLButtonElement;
  layerHeightResetBtn: HTMLButtonElement;
  luminaLayersTotalHeightInput: HTMLInputElement;
  luminaLayersTotalHeightResetBtn: HTMLButtonElement;
  connectionLayersDecBtn: HTMLButtonElement;
  connectionLayersIncBtn: HTMLButtonElement;
  connectionLayersValue: HTMLSpanElement;
  connectionLayersResetBtn: HTMLButtonElement;
  bodyLayersDecBtn: HTMLButtonElement;
  bodyLayersIncBtn: HTMLButtonElement;
  bodyLayersValue: HTMLSpanElement;
  bodyLayersResetBtn: HTMLButtonElement;
  navBasic: HTMLButtonElement;
  navInterlocking: HTMLButtonElement;
  navClip: HTMLButtonElement;
  navTexture: HTMLButtonElement;
  navLumina: HTMLButtonElement;
  navExperiment: HTMLButtonElement;
  panelBasic: HTMLDivElement;
  panelInterlocking: HTMLDivElement;
  panelClip: HTMLDivElement;
  panelTexture: HTMLDivElement;
  panelLumina: HTMLDivElement;
  panelExperiment: HTMLDivElement;
};

// 获取设置面板的 DOM 元素并进行完整性验证
export function getSettingsUIRefs(): SettingsUIRefs | null {
  const get = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

  const refs: SettingsUIRefs = {
    overlay: get<HTMLDivElement>("#settings-overlay"),
    content: get<HTMLDivElement>(".settings-content"),
    openBtn: get<HTMLButtonElement>("#settings-open-btn"),
    cancelBtn: get<HTMLButtonElement>("#settings-cancel-btn"),
    confirmBtn: get<HTMLButtonElement>("#settings-confirm-btn"),
    joinTypeInterlockingBtn: get<HTMLButtonElement>("#setting-join-type-interlocking"),
    joinTypeClipBtn: get<HTMLButtonElement>("#setting-join-type-clip"),
    joinTypeResetBtn: get<HTMLButtonElement>("#setting-join-type-reset"),
    scaleInput: get<HTMLInputElement>("#setting-scale"),
    scaleResetBtn: get<HTMLButtonElement>("#setting-scale-reset"),
    minFoldAngleThresholdInput: get<HTMLInputElement>("#setting-min-fold-angle-threshold"),
    minFoldAngleThresholdResetBtn: get<HTMLButtonElement>("#setting-min-fold-angle-threshold-reset"),
    clawInterlockingAngleInput: get<HTMLInputElement>("#setting-claw-interlocking-angle"),
    clawInterlockingAngleResetBtn: get<HTMLButtonElement>("#setting-claw-interlocking-angle-reset"),
    clawTargetRadiusInput: get<HTMLInputElement>("#setting-claw-target-radius"),
    clawTargetRadiusResetBtn: get<HTMLButtonElement>("#setting-claw-target-radius-reset"),
    clawRadiusAdaptiveOffBtn: get<HTMLButtonElement>("#setting-claw-radius-adaptive-off"),
    clawRadiusAdaptiveOnBtn: get<HTMLButtonElement>("#setting-claw-radius-adaptive-on"),
    clawRadiusAdaptiveResetBtn: get<HTMLButtonElement>("#setting-claw-radius-adaptive-reset"),
    clawWidthInput: get<HTMLInputElement>("#setting-claw-width"),
    clawWidthResetBtn: get<HTMLButtonElement>("#setting-claw-width-reset"),
    clawFitGapInput: get<HTMLInputElement>("#setting-claw-fit-gap"),
    clawFitGapResetBtn: get<HTMLButtonElement>("#setting-claw-fit-gap-reset"),
    tabWidthInput: get<HTMLInputElement>("#setting-tab-width"),
    tabWidthResetBtn: get<HTMLButtonElement>("#setting-tab-width-reset"),
    tabThicknessInput: get<HTMLInputElement>("#setting-tab-thickness"),
    tabThicknessResetBtn: get<HTMLButtonElement>("#setting-tab-thickness-reset"),
    tabClipGapInput: get<HTMLInputElement>("#setting-tab-clip-gap"),
    tabClipGapResetBtn: get<HTMLButtonElement>("#setting-tab-clip-gap-reset"),
    antiSlipClipOffBtn: get<HTMLButtonElement>("#setting-anti-slip-clip-off"),
    antiSlipClipWeakBtn: get<HTMLButtonElement>("#setting-anti-slip-clip-weak"),
    antiSlipClipStrongBtn: get<HTMLButtonElement>("#setting-anti-slip-clip-strong"),
    antiSlipClipResetBtn: get<HTMLButtonElement>("#setting-anti-slip-clip-reset"),
    clipGapAdjustNormalBtn: get<HTMLButtonElement>("#setting-clip-thickness-normal"),
    clipGapAdjustNarrowBtn: get<HTMLButtonElement>("#setting-clip-thickness-narrow"),
    clipGapAdjustResetBtn: get<HTMLButtonElement>("#setting-clip-thickness-reset"),
    includeTextureInProjectIncludeBtn: get<HTMLButtonElement>("#setting-include-texture-in-project-include"),
    includeTextureInProjectExcludeBtn: get<HTMLButtonElement>("#setting-include-texture-in-project-exclude"),
    includeTextureInProjectResetBtn: get<HTMLButtonElement>("#setting-include-texture-in-project-reset"),
    textureColorSpaceSrgbBtn: get<HTMLButtonElement>("#setting-texture-color-space-srgb"),
    textureColorSpaceLinearBtn: get<HTMLButtonElement>("#setting-texture-color-space-linear"),
    textureColorSpaceResetBtn: get<HTMLButtonElement>("#setting-texture-color-space-reset"),
    textureSamplingModeSmoothBtn: get<HTMLButtonElement>("#setting-texture-sampling-mode-smooth"),
    textureSamplingModePixelStableBtn: get<HTMLButtonElement>("#setting-texture-sampling-mode-pixel-stable"),
    textureSamplingModePixelCrispBtn: get<HTMLButtonElement>("#setting-texture-sampling-mode-pixel-crisp"),
    textureSamplingModeResetBtn: get<HTMLButtonElement>("#setting-texture-sampling-mode-reset"),
    textureFlipYTrueBtn: get<HTMLButtonElement>("#setting-texture-flip-y-true"),
    textureFlipYFalseBtn: get<HTMLButtonElement>("#setting-texture-flip-y-false"),
    textureFlipYResetBtn: get<HTMLButtonElement>("#setting-texture-flip-y-reset"),
    generatedTextureResolution1024Btn: get<HTMLButtonElement>("#setting-generated-texture-resolution-1024"),
    generatedTextureResolution2048Btn: get<HTMLButtonElement>("#setting-generated-texture-resolution-2048"),
    generatedTextureResolution4096Btn: get<HTMLButtonElement>("#setting-generated-texture-resolution-4096"),
    generatedTextureResolutionResetBtn: get<HTMLButtonElement>("#setting-generated-texture-resolution-reset"),
    hollowOnBtn: get<HTMLButtonElement>("#setting-hollow-on"),
    hollowOffBtn: get<HTMLButtonElement>("#setting-hollow-off"),
    hollowResetBtn: get<HTMLButtonElement>("#setting-hollow-reset"),
    wireframeThicknessInput: get<HTMLInputElement>("#setting-wireframe-thickness"),
    wireframeThicknessResetBtn: get<HTMLButtonElement>("#setting-wireframe-thickness-reset"),
    wireframeRow: get<HTMLDivElement>("#setting-wireframe-row"),
    layerHeight008Btn: get<HTMLButtonElement>("#setting-layer-height-008"),
    layerHeight012Btn: get<HTMLButtonElement>("#setting-layer-height-012"),
    layerHeight016Btn: get<HTMLButtonElement>("#setting-layer-height-016"),
    layerHeight020Btn: get<HTMLButtonElement>("#setting-layer-height-020"),
    layerHeight024Btn: get<HTMLButtonElement>("#setting-layer-height-024"),
    layerHeightResetBtn: get<HTMLButtonElement>("#setting-layer-height-reset"),
    luminaLayersTotalHeightInput: get<HTMLInputElement>("#setting-lumina-layers-total-height"),
    luminaLayersTotalHeightResetBtn: get<HTMLButtonElement>("#setting-lumina-layers-total-height-reset"),
    connectionLayersDecBtn: get<HTMLButtonElement>("#setting-connection-layers-dec"),
    connectionLayersIncBtn: get<HTMLButtonElement>("#setting-connection-layers-inc"),
    connectionLayersValue: get<HTMLSpanElement>("#setting-connection-layers-value"),
    connectionLayersResetBtn: get<HTMLButtonElement>("#setting-connection-layers-reset"),
    bodyLayersDecBtn: get<HTMLButtonElement>("#setting-body-layers-dec"),
    bodyLayersIncBtn: get<HTMLButtonElement>("#setting-body-layers-inc"),
    bodyLayersValue: get<HTMLSpanElement>("#setting-body-layers-value"),
    bodyLayersResetBtn: get<HTMLButtonElement>("#setting-body-layers-reset"),
    navBasic: get<HTMLButtonElement>("#settings-nav-basic"),
    navInterlocking: get<HTMLButtonElement>("#settings-nav-interlocking"),
    navClip: get<HTMLButtonElement>("#settings-nav-clip"),
    navTexture: get<HTMLButtonElement>("#settings-nav-texture"),
    navLumina: get<HTMLButtonElement>("#settings-nav-lumina"),
    navExperiment: get<HTMLButtonElement>("#settings-nav-experiment"),
    panelBasic: get<HTMLDivElement>("#settings-panel-basic"),
    panelInterlocking: get<HTMLDivElement>("#settings-panel-interlocking"),
    panelClip: get<HTMLDivElement>("#settings-panel-clip"),
    panelTexture: get<HTMLDivElement>("#settings-panel-texture"),
    panelLumina: get<HTMLDivElement>("#settings-panel-lumina"),
    panelExperiment: get<HTMLDivElement>("#settings-panel-experiment"),
  };

  // 验证所有元素是否存在
  const values = Object.values(refs);
  if (values.some((el) => !el)) {
    console.error("Settings UI: Missing required elements", values.filter((el) => !el));
    return null;
  }

  return refs;
}

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
    refs.overlay.style.visibility = "";
    settingsSnapshot = null;
  };

  const updateHollowButtons = () => {
    refs.hollowOnBtn.classList.toggle("active", settingsDraft.hollowStyle);
    refs.hollowOffBtn.classList.toggle("active", !settingsDraft.hollowStyle);
  };

  const updateJoinTypeButtons = () => {
    refs.joinTypeInterlockingBtn.classList.toggle("active", settingsDraft.joinType === "interlocking");
    refs.joinTypeClipBtn.classList.toggle("active", settingsDraft.joinType === "clip");
  };

  const updateClipGapAdjustButtons = () => {
    refs.clipGapAdjustNormalBtn.classList.toggle("active", settingsDraft.clipGapAdjust === "off");
    refs.clipGapAdjustNarrowBtn.classList.toggle("active", settingsDraft.clipGapAdjust === "on");
  };

  const updateAntiSlipClipButtons = () => {
    refs.antiSlipClipOffBtn.classList.toggle("active", settingsDraft.antiSlipClip === "off");
    refs.antiSlipClipWeakBtn.classList.toggle("active", settingsDraft.antiSlipClip === "weak");
    refs.antiSlipClipStrongBtn.classList.toggle("active", settingsDraft.antiSlipClip === "strong");
  };

  const updateClawRadiusAdaptiveButtons = () => {
    refs.clawRadiusAdaptiveOffBtn.classList.toggle("active", settingsDraft.clawRadiusAdaptive === "off");
    refs.clawRadiusAdaptiveOnBtn.classList.toggle("active", settingsDraft.clawRadiusAdaptive === "on");
  };

  const updateIncludeTextureInProjectButtons = () => {
    refs.includeTextureInProjectIncludeBtn.classList.toggle("active", settingsDraft.includeTextureInProject === "include");
    refs.includeTextureInProjectExcludeBtn.classList.toggle("active", settingsDraft.includeTextureInProject === "exclude");
  };

  const updateTextureColorSpaceButtons = () => {
    refs.textureColorSpaceSrgbBtn.classList.toggle("active", settingsDraft.textureColorSpace === "srgb");
    refs.textureColorSpaceLinearBtn.classList.toggle("active", settingsDraft.textureColorSpace === "linear");
  };

  const updateTextureSamplingModeButtons = () => {
    refs.textureSamplingModeSmoothBtn.classList.toggle("active", settingsDraft.textureSamplingMode === "smooth");
    refs.textureSamplingModePixelStableBtn.classList.toggle("active", settingsDraft.textureSamplingMode === "pixelStable");
    refs.textureSamplingModePixelCrispBtn.classList.toggle("active", settingsDraft.textureSamplingMode === "pixelCrisp");
  };

  const updateTextureFlipYButtons = () => {
    refs.textureFlipYTrueBtn.classList.toggle("active", settingsDraft.textureFlipY);
    refs.textureFlipYFalseBtn.classList.toggle("active", !settingsDraft.textureFlipY);
  };

  const updateGeneratedTextureResolutionButtons = () => {
    refs.generatedTextureResolution1024Btn.classList.toggle("active", settingsDraft.generatedTextureResolution === 1024);
    refs.generatedTextureResolution2048Btn.classList.toggle("active", settingsDraft.generatedTextureResolution === 2048);
    refs.generatedTextureResolution4096Btn.classList.toggle("active", settingsDraft.generatedTextureResolution === 4096);
  };

  const updateLayerHeightButtons = () => {
    refs.layerHeight008Btn.classList.toggle("active", settingsDraft.layerHeight === 0.08);
    refs.layerHeight012Btn.classList.toggle("active", settingsDraft.layerHeight === 0.12);
    refs.layerHeight016Btn.classList.toggle("active", settingsDraft.layerHeight === 0.16);
    refs.layerHeight020Btn.classList.toggle("active", settingsDraft.layerHeight === 0.2);
    refs.layerHeight024Btn.classList.toggle("active", settingsDraft.layerHeight === 0.24);
  };

  const updateWireframeEnabled = () => {
    const enabled = settingsDraft.hollowStyle;
    refs.wireframeThicknessInput.disabled = !enabled;
    refs.wireframeThicknessResetBtn.disabled = !enabled;
    refs.wireframeRow.classList.toggle("disabled", !enabled);
  };

  const setRowModified = (anchor: HTMLElement | null | undefined, modified: boolean) => {
    const row = anchor?.closest(".setting-row");
    if (!row) return;
    row.classList.toggle("modified", modified);
  };

  // 所有“是否为默认值”的高亮逻辑集中在这里，
  // 避免分散在各个控件事件里造成状态不一致。
  const updateModifiedIndicators = () => {
    const defaults = getDefaultSettings();
    setRowModified(refs.scaleInput, settingsDraft.scale !== defaults.scale);
    setRowModified(refs.minFoldAngleThresholdInput, settingsDraft.minFoldAngleThreshold !== defaults.minFoldAngleThreshold);
    setRowModified(refs.clawInterlockingAngleInput, settingsDraft.clawInterlockingAngle !== defaults.clawInterlockingAngle);
    setRowModified(refs.clawTargetRadiusInput, settingsDraft.clawTargetRadius !== defaults.clawTargetRadius);
    setRowModified(refs.clawRadiusAdaptiveOffBtn, settingsDraft.clawRadiusAdaptive !== defaults.clawRadiusAdaptive);
    setRowModified(refs.clawWidthInput, settingsDraft.clawWidth !== defaults.clawWidth);
    setRowModified(refs.clawFitGapInput, settingsDraft.clawFitGap !== defaults.clawFitGap);
    setRowModified(refs.layerHeight008Btn, settingsDraft.layerHeight !== defaults.layerHeight);
    setRowModified(
      refs.luminaLayersTotalHeightInput,
      settingsDraft.luminaLayersTotalHeight !== defaults.luminaLayersTotalHeight,
    );
    setRowModified(refs.connectionLayersValue, settingsDraft.connectionLayers !== defaults.connectionLayers);
    setRowModified(refs.bodyLayersValue, settingsDraft.bodyLayers !== defaults.bodyLayers);
    setRowModified(refs.joinTypeInterlockingBtn, settingsDraft.joinType !== defaults.joinType);
    setRowModified(refs.tabWidthInput, settingsDraft.tabWidth !== defaults.tabWidth);
    setRowModified(refs.tabThicknessInput, settingsDraft.tabThickness !== defaults.tabThickness);
    setRowModified(refs.tabClipGapInput, settingsDraft.tabClipGap !== defaults.tabClipGap);
    setRowModified(refs.antiSlipClipWeakBtn, settingsDraft.antiSlipClip !== defaults.antiSlipClip);
    setRowModified(refs.clipGapAdjustNormalBtn, settingsDraft.clipGapAdjust !== defaults.clipGapAdjust);
    setRowModified(
      refs.includeTextureInProjectIncludeBtn,
      settingsDraft.includeTextureInProject !== defaults.includeTextureInProject,
    );
    setRowModified(refs.textureColorSpaceSrgbBtn, settingsDraft.textureColorSpace !== defaults.textureColorSpace);
    setRowModified(refs.textureSamplingModeSmoothBtn, settingsDraft.textureSamplingMode !== defaults.textureSamplingMode);
    setRowModified(refs.textureFlipYTrueBtn, settingsDraft.textureFlipY !== defaults.textureFlipY);
    setRowModified(
      refs.generatedTextureResolution1024Btn,
      settingsDraft.generatedTextureResolution !== defaults.generatedTextureResolution,
    );
    setRowModified(refs.hollowOnBtn, settingsDraft.hollowStyle !== defaults.hollowStyle);
    setRowModified(refs.wireframeThicknessInput, settingsDraft.wireframeThickness !== defaults.wireframeThickness);
  };

  const activateTab = (tab: "basic" | "interlocking" | "clip" | "texture" | "lumina" | "experiment") => {
    const tabs: Array<{
      key: "basic" | "interlocking" | "clip" | "texture" | "lumina" | "experiment";
      nav: HTMLButtonElement;
      panel: HTMLDivElement;
    }> = [
      { key: "basic", nav: refs.navBasic, panel: refs.panelBasic },
      { key: "interlocking", nav: refs.navInterlocking, panel: refs.panelInterlocking },
      { key: "clip", nav: refs.navClip, panel: refs.panelClip },
      { key: "texture", nav: refs.navTexture, panel: refs.panelTexture },
      { key: "lumina", nav: refs.navLumina, panel: refs.panelLumina },
      { key: "experiment", nav: refs.navExperiment, panel: refs.panelExperiment },
    ];
    tabs.forEach(({ key, nav, panel }) => {
      const active = key === tab;
      nav.classList.toggle("active", active);
      panel.classList.toggle("active", active);
    });
  };

  const measurePanelHeight = (panel: HTMLDivElement) => {
    const prevDisplay = panel.style.display;
    const prevVisibility = panel.style.visibility;
    const prevPosition = panel.style.position;
    const prevWidth = panel.style.width;
    panel.style.visibility = "hidden";
    panel.style.position = "absolute";
    panel.style.display = "flex";
    const contentWidth = refs.content.clientWidth || refs.content.getBoundingClientRect().width;
    if (contentWidth > 0) {
      panel.style.width = `${contentWidth}px`;
    }
    const h = panel.scrollHeight;
    panel.style.display = prevDisplay;
    panel.style.visibility = prevVisibility;
    panel.style.position = prevPosition;
    panel.style.width = prevWidth;
    return h;
  };

  const adjustContentHeight = () => {
    const maxContent = Math.max(
      measurePanelHeight(refs.panelBasic),
      measurePanelHeight(refs.panelInterlocking),
      measurePanelHeight(refs.panelClip),
      measurePanelHeight(refs.panelTexture),
      measurePanelHeight(refs.panelLumina),
      measurePanelHeight(refs.panelExperiment),
    );
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
    minFoldAngleThreshold: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.minFoldAngleThreshold.min &&
      val <= SETTINGS_LIMITS.minFoldAngleThreshold.max,
    clawInterlockingAngle: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawInterlockingAngle.min &&
      val <= SETTINGS_LIMITS.clawInterlockingAngle.max,
    clawTargetRadius: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawTargetRadius.min &&
      val <= SETTINGS_LIMITS.clawTargetRadius.max,
    clawWidth: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawWidth.min &&
      val <= SETTINGS_LIMITS.clawWidth.max,
    clawFitGap: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.clawFitGap.min &&
      val <= SETTINGS_LIMITS.clawFitGap.max,
    tabThickness: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.tabThickness.min && val <= SETTINGS_LIMITS.tabThickness.max,
    layerHeight: (val: number) =>
      !Number.isNaN(val) && SETTINGS_LIMITS.layerHeight.allowed.includes(val as (typeof SETTINGS_LIMITS.layerHeight.allowed)[number]),
    luminaLayersTotalHeight: (val: number) =>
      !Number.isNaN(val) &&
      val >= SETTINGS_LIMITS.luminaLayersTotalHeight.min &&
      val <= SETTINGS_LIMITS.luminaLayersTotalHeight.max,
    connectionLayers: (val: number) =>
      Number.isInteger(val) &&
      val >= SETTINGS_LIMITS.connectionLayers.min &&
      val <= SETTINGS_LIMITS.connectionLayers.max,
    bodyLayers: (val: number) =>
      Number.isInteger(val) && val >= SETTINGS_LIMITS.bodyLayers.min && val <= SETTINGS_LIMITS.bodyLayers.max,
    tabWidth: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.tabWidth.min && val < SETTINGS_LIMITS.tabWidth.max,
    tabClipGap: (val: number) =>
      !Number.isNaN(val) && val >= SETTINGS_LIMITS.tabClipGap.min && val <= SETTINGS_LIMITS.tabClipGap.max,
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
    updateJoinTypeButtons();
    refs.scaleInput.value = String(settingsDraft.scale);
    refs.minFoldAngleThresholdInput.value = String(settingsDraft.minFoldAngleThreshold);
    refs.clawInterlockingAngleInput.value = String(settingsDraft.clawInterlockingAngle);
    refs.clawTargetRadiusInput.value = String(settingsDraft.clawTargetRadius);
    updateClawRadiusAdaptiveButtons();
    refs.clawWidthInput.value = String(settingsDraft.clawWidth);
    refs.clawFitGapInput.value = String(settingsDraft.clawFitGap);
    refs.tabThicknessInput.value = String(settingsDraft.tabThickness);
    updateLayerHeightButtons();
    refs.luminaLayersTotalHeightInput.value = String(settingsDraft.luminaLayersTotalHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    refs.tabWidthInput.value = String(settingsDraft.tabWidth);
    refs.tabThicknessInput.value = String(settingsDraft.tabThickness);
    refs.tabClipGapInput.value = String(settingsDraft.tabClipGap);
    updateAntiSlipClipButtons();
    refs.wireframeThicknessInput.value = String(settingsDraft.wireframeThickness);
    updateClipGapAdjustButtons();
    updateIncludeTextureInProjectButtons();
    updateTextureColorSpaceButtons();
    updateTextureSamplingModeButtons();
    updateTextureFlipYButtons();
    updateGeneratedTextureResolutionButtons();
    updateHollowButtons();
    updateWireframeEnabled();
    [refs.scaleInput, refs.minFoldAngleThresholdInput, refs.clawInterlockingAngleInput, refs.clawTargetRadiusInput, refs.clawWidthInput, refs.clawFitGapInput, refs.luminaLayersTotalHeightInput, refs.tabWidthInput, refs.tabThicknessInput, refs.tabClipGapInput, refs.wireframeThicknessInput].forEach((el) =>
      updateInputColor(el, true),
    );
    updateModifiedIndicators();
    updateWireframeEnabled();
    refs.content.style.minHeight = "";
    refs.content.style.height = "";
    refs.overlay.style.visibility = "hidden";
    refs.overlay.classList.remove("hidden");
    activateTab("basic");
    requestAnimationFrame(() => {
      adjustContentHeight();
      refs.overlay.style.visibility = "";
    });
  });

  refs.joinTypeInterlockingBtn.addEventListener("click", () => {
    settingsDraft.joinType = "interlocking";
    updateJoinTypeButtons();
    updateModifiedIndicators();
  });
  refs.joinTypeClipBtn.addEventListener("click", () => {
    settingsDraft.joinType = "clip";
    updateJoinTypeButtons();
    updateModifiedIndicators();
  });
  refs.joinTypeResetBtn.addEventListener("click", () => {
    settingsDraft.joinType = getDefaultSettings().joinType;
    updateJoinTypeButtons();
    updateModifiedIndicators();
  });

  refs.hollowOnBtn.addEventListener("click", () => {
    settingsDraft.hollowStyle = true;
    updateHollowButtons();
    updateWireframeEnabled();
    updateModifiedIndicators();
  });
  refs.hollowOffBtn.addEventListener("click", () => {
    settingsDraft.hollowStyle = false;
    updateHollowButtons();
    updateWireframeEnabled();
    updateModifiedIndicators();
  });
  refs.hollowResetBtn.addEventListener("click", () => {
    const def = getDefaultSettings().hollowStyle;
    settingsDraft.hollowStyle = def;
    updateHollowButtons();
    updateWireframeEnabled();
    updateModifiedIndicators();
  });
  refs.clipGapAdjustNormalBtn.addEventListener("click", () => {
    settingsDraft.clipGapAdjust = "off";
    updateClipGapAdjustButtons();
    updateModifiedIndicators();
  });
  refs.clipGapAdjustNarrowBtn.addEventListener("click", () => {
    settingsDraft.clipGapAdjust = "on";
    updateClipGapAdjustButtons();
    updateModifiedIndicators();
  });
  refs.clipGapAdjustResetBtn.addEventListener("click", () => {
    settingsDraft.clipGapAdjust = getDefaultSettings().clipGapAdjust;
    updateClipGapAdjustButtons();
    updateModifiedIndicators();
  });
  refs.antiSlipClipOffBtn.addEventListener("click", () => {
    settingsDraft.antiSlipClip = "off";
    updateAntiSlipClipButtons();
    updateModifiedIndicators();
  });
  refs.antiSlipClipWeakBtn.addEventListener("click", () => {
    settingsDraft.antiSlipClip = "weak";
    updateAntiSlipClipButtons();
    updateModifiedIndicators();
  });
  refs.antiSlipClipStrongBtn.addEventListener("click", () => {
    settingsDraft.antiSlipClip = "strong";
    updateAntiSlipClipButtons();
    updateModifiedIndicators();
  });
  refs.antiSlipClipResetBtn.addEventListener("click", () => {
    settingsDraft.antiSlipClip = getDefaultSettings().antiSlipClip;
    updateAntiSlipClipButtons();
    updateModifiedIndicators();
  });
  refs.includeTextureInProjectIncludeBtn.addEventListener("click", () => {
    settingsDraft.includeTextureInProject = "include";
    updateIncludeTextureInProjectButtons();
    updateModifiedIndicators();
  });
  refs.includeTextureInProjectExcludeBtn.addEventListener("click", () => {
    settingsDraft.includeTextureInProject = "exclude";
    updateIncludeTextureInProjectButtons();
    updateModifiedIndicators();
  });
  refs.includeTextureInProjectResetBtn.addEventListener("click", () => {
    settingsDraft.includeTextureInProject = getDefaultSettings().includeTextureInProject;
    updateIncludeTextureInProjectButtons();
    updateModifiedIndicators();
  });
  refs.textureColorSpaceSrgbBtn.addEventListener("click", () => {
    settingsDraft.textureColorSpace = "srgb";
    updateTextureColorSpaceButtons();
    updateModifiedIndicators();
  });
  refs.textureColorSpaceLinearBtn.addEventListener("click", () => {
    settingsDraft.textureColorSpace = "linear";
    updateTextureColorSpaceButtons();
    updateModifiedIndicators();
  });
  refs.textureColorSpaceResetBtn.addEventListener("click", () => {
    settingsDraft.textureColorSpace = getDefaultSettings().textureColorSpace;
    updateTextureColorSpaceButtons();
    updateModifiedIndicators();
  });
  refs.textureSamplingModeSmoothBtn.addEventListener("click", () => {
    settingsDraft.textureSamplingMode = "smooth";
    updateTextureSamplingModeButtons();
    updateModifiedIndicators();
  });
  refs.textureSamplingModePixelStableBtn.addEventListener("click", () => {
    settingsDraft.textureSamplingMode = "pixelStable";
    updateTextureSamplingModeButtons();
    updateModifiedIndicators();
  });
  refs.textureSamplingModePixelCrispBtn.addEventListener("click", () => {
    settingsDraft.textureSamplingMode = "pixelCrisp";
    updateTextureSamplingModeButtons();
    updateModifiedIndicators();
  });
  refs.textureSamplingModeResetBtn.addEventListener("click", () => {
    settingsDraft.textureSamplingMode = getDefaultSettings().textureSamplingMode;
    updateTextureSamplingModeButtons();
    updateModifiedIndicators();
  });
  refs.textureFlipYTrueBtn.addEventListener("click", () => {
    settingsDraft.textureFlipY = true;
    updateTextureFlipYButtons();
    updateModifiedIndicators();
  });
  refs.textureFlipYFalseBtn.addEventListener("click", () => {
    settingsDraft.textureFlipY = false;
    updateTextureFlipYButtons();
    updateModifiedIndicators();
  });
  refs.textureFlipYResetBtn.addEventListener("click", () => {
    settingsDraft.textureFlipY = getDefaultSettings().textureFlipY;
    updateTextureFlipYButtons();
    updateModifiedIndicators();
  });
  refs.generatedTextureResolution1024Btn.addEventListener("click", () => {
    settingsDraft.generatedTextureResolution = 1024;
    updateGeneratedTextureResolutionButtons();
    updateModifiedIndicators();
  });
  refs.generatedTextureResolution2048Btn.addEventListener("click", () => {
    settingsDraft.generatedTextureResolution = 2048;
    updateGeneratedTextureResolutionButtons();
    updateModifiedIndicators();
  });
  refs.generatedTextureResolution4096Btn.addEventListener("click", () => {
    settingsDraft.generatedTextureResolution = 4096;
    updateGeneratedTextureResolutionButtons();
    updateModifiedIndicators();
  });
  refs.generatedTextureResolutionResetBtn.addEventListener("click", () => {
    settingsDraft.generatedTextureResolution = getDefaultSettings().generatedTextureResolution;
    updateGeneratedTextureResolutionButtons();
    updateModifiedIndicators();
  });
  refs.layerHeight008Btn.addEventListener("click", () => {
    settingsDraft.layerHeight = 0.08;
    updateLayerHeightButtons();
    updateModifiedIndicators();
  });
  refs.layerHeight012Btn.addEventListener("click", () => {
    settingsDraft.layerHeight = 0.12;
    updateLayerHeightButtons();
    updateModifiedIndicators();
  });
  refs.layerHeight016Btn.addEventListener("click", () => {
    settingsDraft.layerHeight = 0.16;
    updateLayerHeightButtons();
    updateModifiedIndicators();
  });
  refs.layerHeight020Btn.addEventListener("click", () => {
    settingsDraft.layerHeight = 0.2;
    updateLayerHeightButtons();
    updateModifiedIndicators();
  });
  refs.layerHeight024Btn.addEventListener("click", () => {
    settingsDraft.layerHeight = 0.24;
    updateLayerHeightButtons();
    updateModifiedIndicators();
  });
  refs.layerHeightResetBtn.addEventListener("click", () => {
    settingsDraft.layerHeight = getDefaultSettings().layerHeight;
    updateLayerHeightButtons();
    updateModifiedIndicators();
  });
  refs.clawRadiusAdaptiveOffBtn.addEventListener("click", () => {
    settingsDraft.clawRadiusAdaptive = "off";
    updateClawRadiusAdaptiveButtons();
    updateModifiedIndicators();
  });
  refs.clawRadiusAdaptiveOnBtn.addEventListener("click", () => {
    settingsDraft.clawRadiusAdaptive = "on";
    updateClawRadiusAdaptiveButtons();
    updateModifiedIndicators();
  });
  refs.clawRadiusAdaptiveResetBtn.addEventListener("click", () => {
    settingsDraft.clawRadiusAdaptive = getDefaultSettings().clawRadiusAdaptive;
    updateClawRadiusAdaptiveButtons();
    updateModifiedIndicators();
  });
  refs.navBasic.addEventListener("click", () => {
    activateTab("basic");
  });
  refs.navInterlocking.addEventListener("click", () => {
    activateTab("interlocking");
  });
  refs.navClip.addEventListener("click", () => {
    activateTab("clip");
  });
  refs.navTexture.addEventListener("click", () => {
    activateTab("texture");
  });
  refs.navLumina.addEventListener("click", () => {
    activateTab("lumina");
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
      updateModifiedIndicators();
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
      updateModifiedIndicators();
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
    refs.minFoldAngleThresholdInput,
    refs.minFoldAngleThresholdResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.minFoldAngleThreshold,
    (v) => (settingsDraft.minFoldAngleThreshold = v),
    validators.minFoldAngleThreshold,
    () => getDefaultSettings().minFoldAngleThreshold,
  );
  bindNumericInput(
    refs.clawInterlockingAngleInput,
    refs.clawInterlockingAngleResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawInterlockingAngle,
    (v) => (settingsDraft.clawInterlockingAngle = v),
    validators.clawInterlockingAngle,
    () => getDefaultSettings().clawInterlockingAngle,
  );
  bindNumericInput(
    refs.clawTargetRadiusInput,
    refs.clawTargetRadiusResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawTargetRadius,
    (v) => (settingsDraft.clawTargetRadius = v),
    validators.clawTargetRadius,
    () => getDefaultSettings().clawTargetRadius,
  );
  bindNumericInput(
    refs.clawWidthInput,
    refs.clawWidthResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawWidth,
    (v) => (settingsDraft.clawWidth = v),
    validators.clawWidth,
    () => getDefaultSettings().clawWidth,
  );
  bindNumericInput(
    refs.clawFitGapInput,
    refs.clawFitGapResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.clawFitGap,
    (v) => (settingsDraft.clawFitGap = v),
    validators.clawFitGap,
    () => getDefaultSettings().clawFitGap,
  );
  bindNumericInput(
    refs.luminaLayersTotalHeightInput,
    refs.luminaLayersTotalHeightResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.luminaLayersTotalHeight,
    (v) => (settingsDraft.luminaLayersTotalHeight = v),
    validators.luminaLayersTotalHeight,
    () => getDefaultSettings().luminaLayersTotalHeight,
  );
  bindNumericInput(
    refs.tabWidthInput,
    refs.tabWidthResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.tabWidth,
    (v) => (settingsDraft.tabWidth = v),
    validators.tabWidth,
    () => getDefaultSettings().tabWidth,
  );
  bindNumericInput(
    refs.tabThicknessInput,
    refs.tabThicknessResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.tabThickness,
    (v) => (settingsDraft.tabThickness = v),
    validators.tabThickness,
    () => getDefaultSettings().tabThickness,
  );
  bindNumericInput(
    refs.tabClipGapInput,
    refs.tabClipGapResetBtn,
    (raw) => parseFloat(raw),
    () => settingsDraft.tabClipGap,
    (v) => (settingsDraft.tabClipGap = v),
    validators.tabClipGap,
    () => getDefaultSettings().tabClipGap,
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
    updateModifiedIndicators();
  };
  const updateBodyValue = (val: number) => {
    settingsDraft.bodyLayers = clamp(val, SETTINGS_LIMITS.bodyLayers.min, SETTINGS_LIMITS.bodyLayers.max);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    updateModifiedIndicators();
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
    refs.minFoldAngleThresholdInput.value = String(settingsDraft.minFoldAngleThreshold);
    refs.clawInterlockingAngleInput.value = String(settingsDraft.clawInterlockingAngle);
    refs.clawTargetRadiusInput.value = String(settingsDraft.clawTargetRadius);
    updateClawRadiusAdaptiveButtons();
    refs.clawWidthInput.value = String(settingsDraft.clawWidth);
    refs.clawFitGapInput.value = String(settingsDraft.clawFitGap);
    updateLayerHeightButtons();
    refs.luminaLayersTotalHeightInput.value = String(settingsDraft.luminaLayersTotalHeight);
    refs.connectionLayersValue.textContent = String(settingsDraft.connectionLayers);
    refs.bodyLayersValue.textContent = String(settingsDraft.bodyLayers);
    refs.tabWidthInput.value = String(settingsDraft.tabWidth);
    refs.tabThicknessInput.value = String(settingsDraft.tabThickness);
    refs.tabClipGapInput.value = String(settingsDraft.tabClipGap);
    updateAntiSlipClipButtons();
    refs.wireframeThicknessInput.value = String(settingsDraft.wireframeThickness);
    updateJoinTypeButtons();
    updateClipGapAdjustButtons();
    updateIncludeTextureInProjectButtons();
    updateTextureColorSpaceButtons();
    updateTextureSamplingModeButtons();
    updateTextureFlipYButtons();
    updateGeneratedTextureResolutionButtons();
    updateHollowButtons();
    [refs.scaleInput, refs.minFoldAngleThresholdInput, refs.clawInterlockingAngleInput, refs.clawTargetRadiusInput, refs.clawWidthInput, refs.clawFitGapInput, refs.luminaLayersTotalHeightInput, refs.tabWidthInput, refs.tabThicknessInput, refs.tabClipGapInput, refs.wireframeThicknessInput].forEach((el) =>
      updateInputColor(el, true),
    );
    updateModifiedIndicators();
  });

  refs.confirmBtn.addEventListener("click", () => {
    if (!settingsSnapshot) {
      closeSettings();
      return;
    }
    const changes: string[] = [];
    if (settingsDraft.joinType !== settingsSnapshot.joinType) {
      changes.push(
        t("log.settings.changed", {
          label: t("settings.joinType.label"),
          value: settingsDraft.joinType === "interlocking" ? t("settings.joinType.interlocking") : t("settings.joinType.clip"),
        }),
      );
    }
    if (settingsDraft.scale !== settingsSnapshot.scale) {
      changes.push(t("log.settings.changed", { label: t("settings.scale.label"), value: settingsDraft.scale }));
    }
    if (settingsDraft.minFoldAngleThreshold !== settingsSnapshot.minFoldAngleThreshold) {
      changes.push(t("log.settings.changed", { label: t("settings.minFoldAngleThreshold.label"), value: settingsDraft.minFoldAngleThreshold }));
    }
    if (settingsDraft.clawInterlockingAngle !== settingsSnapshot.clawInterlockingAngle) {
      changes.push(t("log.settings.changed", { label: t("settings.clawInterlockingAngle.label"), value: settingsDraft.clawInterlockingAngle }));
    }
    if (settingsDraft.clawTargetRadius !== settingsSnapshot.clawTargetRadius) {
      changes.push(t("log.settings.changed", { label: t("settings.clawTargetRadius.label"), value: settingsDraft.clawTargetRadius }));
    }
    if (settingsDraft.clawRadiusAdaptive !== settingsSnapshot.clawRadiusAdaptive) {
      const label = settingsDraft.clawRadiusAdaptive === "off" ? t("settings.clawRadiusAdaptive.off") : t("settings.clawRadiusAdaptive.on");
      changes.push(t("log.settings.changed", { label: t("settings.clawRadiusAdaptive.label"), value: label }));
    }
    if (settingsDraft.clawWidth !== settingsSnapshot.clawWidth) {
      changes.push(t("log.settings.changed", { label: t("settings.clawWidth.label"), value: settingsDraft.clawWidth }));
    }
    if (settingsDraft.clawFitGap !== settingsSnapshot.clawFitGap) {
      changes.push(t("log.settings.changed", { label: t("settings.clawFitGap.label"), value: settingsDraft.clawFitGap }));
    }
    if (settingsDraft.tabWidth !== settingsSnapshot.tabWidth) {
      changes.push(t("log.settings.changed", { label: t("settings.tabWidth.label"), value: settingsDraft.tabWidth }));
    }
    if (settingsDraft.layerHeight !== settingsSnapshot.layerHeight) {
      changes.push(t("log.settings.changed", { label: t("settings.layerHeight.label"), value: settingsDraft.layerHeight }));
    }
    if (settingsDraft.luminaLayersTotalHeight !== settingsSnapshot.luminaLayersTotalHeight) {
      changes.push(
        t("log.settings.changed", {
          label: t("settings.luminaLayersTotalHeight.label"),
          value: settingsDraft.luminaLayersTotalHeight,
        }),
      );
    }
    if (settingsDraft.connectionLayers !== settingsSnapshot.connectionLayers) {
      changes.push(t("log.settings.changed", { label: t("settings.connectionLayers.label"), value: settingsDraft.connectionLayers }));
    }
    if (settingsDraft.bodyLayers !== settingsSnapshot.bodyLayers) {
      changes.push(t("log.settings.changed", { label: t("settings.bodyLayers.label"), value: settingsDraft.bodyLayers }));
    }
    if (settingsDraft.tabThickness !== settingsSnapshot.tabThickness) {
      changes.push(t("log.settings.changed", { label: t("settings.tabThickness.label"), value: settingsDraft.tabThickness }));
    }
    if (settingsDraft.tabClipGap !== settingsSnapshot.tabClipGap) {
      changes.push(t("log.settings.changed", { label: t("settings.tabClipGap.label"), value: settingsDraft.tabClipGap }));
    }
    if (settingsDraft.antiSlipClip !== settingsSnapshot.antiSlipClip) {
      const labels = {
        off: t("settings.antiSlipClip.off"),
        weak: t("settings.antiSlipClip.weak"),
        strong: t("settings.antiSlipClip.strong"),
      } satisfies Record<typeof settingsDraft.antiSlipClip, string>;
      changes.push(t("log.settings.changed", { label: t("settings.antiSlipClip.label"), value: labels[settingsDraft.antiSlipClip] }));
    }
    if (settingsDraft.clipGapAdjust !== settingsSnapshot.clipGapAdjust) {
      const label = settingsDraft.clipGapAdjust === "off" ? t("settings.clipGapAdjusts.off") : t("settings.clipGapAdjusts.on");
      changes.push(t("log.settings.changed", { label: t("settings.clipGapAdjusts.label"), value: label }));
    }
    if (settingsDraft.includeTextureInProject !== settingsSnapshot.includeTextureInProject) {
      const label = settingsDraft.includeTextureInProject === "include"
        ? t("settings.includeTextureInProject.include")
        : t("settings.includeTextureInProject.exclude");
      changes.push(t("log.settings.changed", { label: t("settings.includeTextureInProject.label"), value: label }));
    }
    if (settingsDraft.textureColorSpace !== settingsSnapshot.textureColorSpace) {
      const label = settingsDraft.textureColorSpace === "srgb"
        ? t("settings.textureColorSpace.srgb")
        : t("settings.textureColorSpace.linear");
      changes.push(t("log.settings.changed", { label: t("settings.textureColorSpace.label"), value: label }));
    }
    if (settingsDraft.textureSamplingMode !== settingsSnapshot.textureSamplingMode) {
      const labels = {
        smooth: t("settings.textureSamplingMode.smooth"),
        pixelStable: t("settings.textureSamplingMode.pixelStable"),
        pixelCrisp: t("settings.textureSamplingMode.pixelCrisp"),
      } satisfies Record<typeof settingsDraft.textureSamplingMode, string>;
      changes.push(
        t("log.settings.changed", {
          label: t("settings.textureSamplingMode.label"),
          value: labels[settingsDraft.textureSamplingMode],
        }),
      );
    }
    if (settingsDraft.textureFlipY !== settingsSnapshot.textureFlipY) {
      const label = settingsDraft.textureFlipY
        ? t("settings.textureFlipY.true")
        : t("settings.textureFlipY.false");
      changes.push(t("log.settings.changed", { label: t("settings.textureFlipY.label"), value: label }));
    }
    if (settingsDraft.generatedTextureResolution !== settingsSnapshot.generatedTextureResolution) {
      changes.push(
        t("log.settings.changed", {
          label: t("settings.generatedTextureResolution.label"),
          value: settingsDraft.generatedTextureResolution,
        }),
      );
    }
    if (settingsDraft.hollowStyle !== settingsSnapshot.hollowStyle) {
      const hollowValue = settingsDraft.hollowStyle ? t("settings.hollow.on") : t("settings.hollow.off");
      changes.push(t("log.settings.changed", { label: t("settings.hollow.label"), value: hollowValue }));
    }
    if (settingsDraft.wireframeThickness !== settingsSnapshot.wireframeThickness) {
      changes.push(t("log.settings.changed", { label: t("settings.wireframeThickness.label"), value: settingsDraft.wireframeThickness }));
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

// 设置面板的 i18n 文本更新
export function applySettingsI18n() {
  const limits = SETTINGS_LIMITS;

  const updateDesc = (selector: string, key: string, params?: Record<string, string | number>) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.textContent = t(key, params);
    }
  };

  updateDesc('[data-i18n="settings.layerHeight.desc"]', "settings.layerHeight.desc");
  updateDesc('[data-i18n="settings.luminaLayersTotalHeight.desc"]', "settings.luminaLayersTotalHeight.desc");
  updateDesc('[data-i18n="settings.connectionLayers.desc"]', "settings.connectionLayers.desc", { min: limits.connectionLayers.min, max: limits.connectionLayers.max });
  updateDesc('[data-i18n="settings.bodyLayers.desc"]', "settings.bodyLayers.desc", { min: limits.bodyLayers.min, max: limits.bodyLayers.max });
  updateDesc('[data-i18n="settings.joinType.desc"]', "settings.joinType.desc");
  updateDesc('[data-i18n="settings.clawInterlockingAngle.desc"]', "settings.clawInterlockingAngle.desc", { min: limits.clawInterlockingAngle.min, max: limits.clawInterlockingAngle.max });
  updateDesc('[data-i18n="settings.clawTargetRadius.desc"]', "settings.clawTargetRadius.desc", { min: limits.clawTargetRadius.min, max: limits.clawTargetRadius.max });
  updateDesc('[data-i18n="settings.clawRadiusAdaptive.desc"]', "settings.clawRadiusAdaptive.desc");
  updateDesc('[data-i18n="settings.clawWidth.desc"]', "settings.clawWidth.desc", { min: limits.clawWidth.min, max: limits.clawWidth.max });
  updateDesc('[data-i18n="settings.clawFitGap.desc"]', "settings.clawFitGap.desc", { min: limits.clawFitGap.min, max: limits.clawFitGap.max });
  updateDesc('[data-i18n="settings.tabWidth.desc"]', "settings.tabWidth.desc", { min: limits.tabWidth.min, max: limits.tabWidth.max });
  updateDesc('[data-i18n="settings.tabThickness.desc"]', "settings.tabThickness.desc", { min: limits.tabThickness.min, max: limits.tabThickness.max });
  updateDesc('[data-i18n="settings.minFoldAngleThreshold.desc"]', "settings.minFoldAngleThreshold.desc");
  updateDesc('[data-i18n="settings.tabClipGap.desc"]', "settings.tabClipGap.desc", { min: limits.tabClipGap.min, max: limits.tabClipGap.max });
  updateDesc('[data-i18n="settings.antiSlipClip.desc"]', "settings.antiSlipClip.desc");
  updateDesc('[data-i18n="settings.clipGapAdjusts.desc"]', "settings.clipGapAdjusts.desc");
  updateDesc('[data-i18n="settings.includeTextureInProject.desc"]', "settings.includeTextureInProject.desc");
  updateDesc('[data-i18n="settings.textureColorSpace.desc"]', "settings.textureColorSpace.desc");
  updateDesc('[data-i18n="settings.textureSamplingMode.desc"]', "settings.textureSamplingMode.desc");
  updateDesc('[data-i18n="settings.textureFlipY.desc"]', "settings.textureFlipY.desc");
  updateDesc('[data-i18n="settings.generatedTextureResolution.desc"]', "settings.generatedTextureResolution.desc");
  updateDesc('[data-i18n="settings.hollow.desc"]', "settings.hollow.desc");
  updateDesc('[data-i18n="settings.wireframeThickness.desc"]', "settings.wireframeThickness.desc", { min: limits.wireframeThickness.min, max: limits.wireframeThickness.max });
}
