// 简易 i18n 管理：按需异步加载语言包，提供占位返回与语言切换。
type Dict = Record<string, string>;

const SUPPORTED = ["en", "zh"];
const DEFAULT_LANG = "zh";
const STORAGE_KEY = "lang";

const normalizeLang = (tag: string | null | undefined) => {
  if (!tag) return null;
  const lower = String(tag).toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("en")) return "en";
  return lower.split("-")[0];
};

const getLangFromUrl = () => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const lang = params.get("lang");
  const norm = normalizeLang(lang);
  return norm && SUPPORTED.includes(norm) ? norm : null;
};

const getLangFromStorage = () => {
  if (typeof localStorage === "undefined") return null;
  const norm = normalizeLang(localStorage.getItem(STORAGE_KEY));
  return norm && SUPPORTED.includes(norm) ? norm : null;
};

const getLangFromSystem = () => {
  if (typeof navigator === "undefined") return null;
  const langs = Array.isArray(navigator.languages) ? navigator.languages : [];
  const candidates = [...langs, navigator.language].filter(Boolean);
  for (const tag of candidates) {
    const norm = normalizeLang(tag);
    if (norm && SUPPORTED.includes(norm)) return norm;
  }
  return null;
};

const detectInitialLang = () => {
  const fromUrl = getLangFromUrl();
  if (fromUrl) return fromUrl;
  const fromStorage = getLangFromStorage();
  if (fromStorage) return fromStorage;
  const fromSystem = getLangFromSystem();
  if (fromSystem) return fromSystem;
  return DEFAULT_LANG;
};

const defaultLang = detectInitialLang();

let currentLang = defaultLang;
let dict: Dict = {};
let loading = false;
const listeners: Array<() => void> = [];

const applyParams = (tmpl: string, params?: Record<string, string | number>) => {
  if (!params) return tmpl;
  return tmpl.replace(/\{(\w+)\}/g, (_, key) => (params[key] ?? "").toString());
};

export const getCurrentLang = () => currentLang;

export const t = (key: string, params?: Record<string, string | number>) => {
  if (loading) return key;
  const val = dict[key] ?? key;
  return applyParams(val, params);
};

export const setLanguage = async (lang: string) => {
  if (!lang) return;
  const finalLang = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  loading = true;
  let loaded = false;
  try {
    const res = await fetch(`/locales/${finalLang}.json`, { cache: "no-cache" });
    if (res.ok) {
      dict = await res.json();
      currentLang = finalLang;
      loaded = true;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, finalLang);
      }
      return;
    }
  } catch (e) {
    console.warn("[i18n] load language failed", e);
  } finally {
    loading = false;
    if (loaded) {
      listeners.forEach((cb) => cb());
    }
  }
};

export const initI18n = async () => {
  await setLanguage(detectInitialLang());
};

export const onLanguageChanged = (cb: () => void) => {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
};
