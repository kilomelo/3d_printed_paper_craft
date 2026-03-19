import { getCurrentLang } from "./i18n";
import { appEventBus } from "./eventBus";

export type AboutDialogDeps = {
  aboutOverlay: HTMLDivElement;
  aboutBackBtn: HTMLButtonElement;
  aboutBtn: HTMLButtonElement;
  aboutContent: HTMLDivElement;
};

export type AboutDialog = ReturnType<typeof createAboutDialog>;

const SELECTORS = {
  aboutOverlay: "#about-overlay",
  aboutBackBtn: "#about-back-btn",
  aboutBtn: "#about-btn",
  aboutContent: "#about-content",
} as const;

export const createAboutDialog = (deps: AboutDialogDeps) => {
  const { aboutOverlay, aboutBackBtn, aboutBtn, aboutContent } = deps;

  const close = () => {
    aboutOverlay?.classList.add("hidden");
  };

  const open = async () => {
    if (!aboutOverlay || !aboutContent) return;
    aboutOverlay.classList.remove("hidden");
    try {
      const lang = getCurrentLang();
      const aboutPath = lang.startsWith("zh") ? "about_cn.html" : "about_en.html";
      const res = await fetch(aboutPath, { cache: "no-cache" });
      if (res.ok) {
        aboutContent.innerHTML = await res.text();
      } else {
        aboutContent.textContent = "加载关于页面失败";
      }
    } catch (err) {
      aboutContent.textContent = "加载关于页面失败";
    }
  };

  // 绑定事件
  aboutBackBtn?.addEventListener("click", close);
  aboutBtn?.addEventListener("click", open);

  // 暴露接口
  return {
    close,
    open,
    aboutBtn,
  };
};

export const initAboutDialog = () => {
  const aboutOverlay = document.querySelector<HTMLDivElement>(SELECTORS.aboutOverlay);
  const aboutBackBtn = document.querySelector<HTMLButtonElement>(SELECTORS.aboutBackBtn);
  const aboutBtn = document.querySelector<HTMLButtonElement>(SELECTORS.aboutBtn);
  const aboutContent = document.querySelector<HTMLDivElement>(SELECTORS.aboutContent);

  if (
    !aboutOverlay ||
    !aboutBackBtn ||
    !aboutBtn ||
    !aboutContent
  ) {
    throw new Error("初始化关于对话框失败，缺少必要的元素");
  }

  return createAboutDialog({
    aboutOverlay,
    aboutBackBtn,
    aboutBtn,
    aboutContent,
  });
};
