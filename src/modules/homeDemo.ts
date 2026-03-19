// 首页演示项目管理模块
import { t } from "./i18n";

export type HomeDemoProject = {
  id: string;
  filePath: string;
  gifPath: string;
  stillPath: string;
  jumpLink?: string;
};

export const ZH_HOME_DEMO_CONFIG_PATH = "/demo/demo_projects.json";

export let homeDemoProjects: HomeDemoProject[] = [];
export let selectedHomeDemoProjectId = "";
export let loadedHomeDemoConfigPath = "";
// 当前加载的项目是否为示例项目
export let isCurrentProjectDemo = false;
export let homeDemoCaptureSizeCache: { width: number; height: number } | null = null;
let homeDemoGifPlayNonce = 0;

// DOM 元素引用（由 main.ts 注入）
let homeDemoOptionsEl: HTMLDivElement | null = null;
let homeDemoEntry: HTMLDivElement | null = null;

export function setHomeDemoElements(optionsEl: HTMLDivElement | null, entryEl: HTMLDivElement | null) {
  homeDemoOptionsEl = optionsEl;
  homeDemoEntry = entryEl;
}

export const getDemoFileName = () => {
  const selected = homeDemoProjects.find((item) => item.id === selectedHomeDemoProjectId) ?? homeDemoProjects[0];
  return selected?.filePath ?? "";
};

export const refreshHomeDemoEntryVisibility = () => {
  if (!homeDemoEntry) return;
  homeDemoEntry.classList.toggle("hidden", homeDemoProjects.length === 0);
};

export const syncHomeDemoCoverDisplaySize = () => {
  if (!homeDemoOptionsEl) return;
  const optionsWidth = Math.round(homeDemoOptionsEl.getBoundingClientRect().width);
  if (optionsWidth <= 0) return;
  const optionsStyle = window.getComputedStyle(homeDemoOptionsEl);
  const columnGap = parseFloat(optionsStyle.columnGap || optionsStyle.gap || "8") || 8;
  const optionOuterWidth = Math.max(1, Math.floor((optionsWidth - columnGap) / 2));
  homeDemoOptionsEl.style.gridTemplateColumns = `repeat(2, ${optionOuterWidth}px)`;
  homeDemoOptionsEl.style.justifyContent = "space-between";
  const sampleOption = homeDemoOptionsEl.querySelector<HTMLElement>(".home-demo-option");
  const sampleOptionStyle = sampleOption ? window.getComputedStyle(sampleOption) : null;
  if (sampleOptionStyle) {
    const inlineHeight = parseFloat(homeDemoOptionsEl.style.getPropertyValue("--home-demo-cover-height") || "0");
    const computedHeight = parseFloat(window.getComputedStyle(homeDemoOptionsEl).getPropertyValue("--home-demo-cover-height") || "0");
    const effectiveHeight = inlineHeight > 0 ? inlineHeight : computedHeight;
    if (!effectiveHeight || effectiveHeight <= 0) {
      homeDemoOptionsEl.style.setProperty("--home-demo-cover-height", "131px");
    }
    const finalHeight = Math.max(1, Math.round(
      parseFloat(window.getComputedStyle(homeDemoOptionsEl).getPropertyValue("--home-demo-cover-height") || "131"),
    ));
    const buttonHorizontalInset = (
      parseFloat(sampleOptionStyle.paddingLeft || "0")
      + parseFloat(sampleOptionStyle.paddingRight || "0")
      + parseFloat(sampleOptionStyle.borderLeftWidth || "0")
      + parseFloat(sampleOptionStyle.borderRightWidth || "0")
    );
    const finalWidth = Math.max(1, Math.round(optionOuterWidth - buttonHorizontalInset));
    homeDemoCaptureSizeCache = { width: finalWidth, height: finalHeight };
  }
};

export const renderHomeDemoOptions = () => {
  const el = homeDemoOptionsEl;
  if (!el) return;
  el.innerHTML = "";
  const withNonce = (url: string, nonce: number) => {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}play=${nonce}`;
  };
  homeDemoProjects.forEach((item) => {
    const isSelected = item.id === selectedHomeDemoProjectId;
    const gifSrc = isSelected ? withNonce(item.gifPath, homeDemoGifPlayNonce) : item.gifPath;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `home-demo-option${isSelected ? " is-selected" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(isSelected));
    button.setAttribute("aria-label", item.id);
    button.innerHTML = `
      <span class="home-demo-option-cover">
        <img class="home-demo-option-still" src="${item.stillPath}" alt="" loading="lazy" />
        <img class="home-demo-option-gif" src="${gifSrc}" alt="" loading="lazy" />
      </span>
    `;
    button.addEventListener("click", () => {
      if (selectedHomeDemoProjectId !== item.id) {
        homeDemoGifPlayNonce += 1;
      }
      selectedHomeDemoProjectId = item.id;
      renderHomeDemoOptions();
    });
    el.appendChild(button);
  });
  syncHomeDemoCoverDisplaySize();
};

const normalizeHomeDemoProjects = (raw: unknown): HomeDemoProject[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is HomeDemoProject =>
      !!item &&
      typeof (item as HomeDemoProject).id === "string" &&
      typeof (item as HomeDemoProject).filePath === "string" &&
      typeof (item as HomeDemoProject).gifPath === "string" &&
      typeof (item as HomeDemoProject).stillPath === "string",
    )
    .map((item) => ({
      id: item.id,
      filePath: item.filePath,
      gifPath: item.gifPath,
      stillPath: item.stillPath,
      jumpLink: (item as HomeDemoProject).jumpLink,
    }));
};

const resolveHomeDemoConfigPath = () => {
  const configuredPath = t("mainpage.demoConfigFile");
  if (configuredPath && configuredPath !== "mainpage.demoConfigFile") return configuredPath;
  return ZH_HOME_DEMO_CONFIG_PATH;
};

export const loadHomeDemoProjects = async () => {
  const primaryConfigPath = resolveHomeDemoConfigPath();
  const candidatePaths = primaryConfigPath === ZH_HOME_DEMO_CONFIG_PATH
    ? [primaryConfigPath]
    : [primaryConfigPath, ZH_HOME_DEMO_CONFIG_PATH];
  if (loadedHomeDemoConfigPath === primaryConfigPath && homeDemoProjects.length > 0) return;

  let loaded = false;
  for (const configPath of candidatePaths) {
    try {
      const res = await fetch(configPath, { cache: "no-cache" });
      if (!res.ok) throw new Error(`failed: ${res.status}`);
      const data = await res.json();
      const parsed = normalizeHomeDemoProjects(data);
      if (parsed.length === 0) throw new Error("empty or invalid demo project config");
      homeDemoProjects = parsed;
      loadedHomeDemoConfigPath = configPath;
      loaded = true;
      break;
    } catch (error) {
      console.warn("[main] loadHomeDemoProjects failed", { configPath, error });
    }
  }
  if (!loaded) {
    homeDemoProjects = [];
    loadedHomeDemoConfigPath = "";
  }
  if (!homeDemoProjects.some((item) => item.id === selectedHomeDemoProjectId)) {
    selectedHomeDemoProjectId = homeDemoProjects[0]?.id ?? "";
  }
  renderHomeDemoOptions();
  refreshHomeDemoEntryVisibility();
};

export const setIsCurrentProjectDemo = (value: boolean) => {
  isCurrentProjectDemo = value;
};

export const getHomeDemoCaptureTargetHeight = (): number => {
  if (homeDemoCaptureSizeCache) return homeDemoCaptureSizeCache.height;

  const coverEl = homeDemoOptionsEl?.querySelector<HTMLElement>(".home-demo-option-cover");
  if (coverEl) {
    const rect = coverEl.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width > 0 && height > 0) {
      homeDemoCaptureSizeCache = { width, height };
      return height;
    }
  }

  const height = homeDemoOptionsEl
    ? parseFloat(window.getComputedStyle(homeDemoOptionsEl).getPropertyValue("--home-demo-cover-height") || "131")
    : 131;
  const fallbackHeight = Math.max(1, Math.round(height));
  if (Number.isFinite(fallbackHeight)) {
    return fallbackHeight;
  }
  return 131;
};
