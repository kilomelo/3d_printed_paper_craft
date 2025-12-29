// UI 控制器：绑定基础按钮/键盘事件（文件选择、开关、导出等）并暴露统一的事件回调接口。
export type UIHandlers = {
  onFileSelected: (file: File) => void;
  onLightToggle: () => void;
  onEdgesToggle: () => void;
  onSeamsToggle: () => void;
  onFacesToggle: () => void;
  onResetView: () => void;
  onExport: () => void;
  onHomeStart: () => void;
  onMenuOpen: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

export function initUIController(ui: {
  fileInput: HTMLInputElement;
  homeStartBtn: HTMLButtonElement;
  menuOpenBtn: HTMLButtonElement;
  resetViewBtn: HTMLButtonElement;
  lightToggle: HTMLButtonElement;
  edgesToggle: HTMLButtonElement;
  seamsToggle: HTMLButtonElement;
  facesToggle: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  layoutEmpty: HTMLElement;
  layoutWorkspace: HTMLElement;
  versionBadgeGlobal?: HTMLElement | null;
}, handlers: UIHandlers) {
  const setWorkspaceLoaded = (loaded: boolean) => {
    ui.layoutEmpty.classList.toggle("active", !loaded);
    ui.layoutWorkspace.classList.toggle("active", loaded);
    if (ui.versionBadgeGlobal) {
      ui.versionBadgeGlobal.style.display = loaded ? "none" : "block";
    }
  };

  const onFileChange = async () => {
    const file = ui.fileInput.files?.[0];
    if (!file) return;
    handlers.onFileSelected(file);
  };

  ui.fileInput.addEventListener("change", onFileChange);
  ui.homeStartBtn.addEventListener("click", () => handlers.onHomeStart());
  ui.menuOpenBtn.addEventListener("click", () => handlers.onMenuOpen());
  ui.resetViewBtn.addEventListener("click", () => handlers.onResetView());
  ui.lightToggle.addEventListener("click", () => handlers.onLightToggle());
  ui.edgesToggle.addEventListener("click", () => handlers.onEdgesToggle());
  ui.seamsToggle.addEventListener("click", () => handlers.onSeamsToggle());
  ui.facesToggle.addEventListener("click", () => handlers.onFacesToggle());
  ui.exportBtn.addEventListener("click", () => handlers.onExport());
  const onKeyDown = (event: KeyboardEvent) => handlers.onKeyDown(event);
  window.addEventListener("keydown", onKeyDown);

  return {
    setWorkspaceLoaded,
    dispose: () => {
      ui.fileInput.removeEventListener("change", onFileChange);
      ui.homeStartBtn.onclick = null;
      ui.menuOpenBtn.onclick = null;
      ui.resetViewBtn.onclick = null;
      ui.lightToggle.onclick = null;
      ui.edgesToggle.onclick = null;
      ui.seamsToggle.onclick = null;
      ui.facesToggle.onclick = null;
      ui.exportBtn.onclick = null;
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
