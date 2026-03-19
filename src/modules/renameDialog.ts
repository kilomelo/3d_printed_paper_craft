import { appEventBus } from "./eventBus";
import { t, onLanguageChanged } from "./i18n";
import type { GroupControllerApi } from "./groupController";
import type { LogController } from "./log";

export type RenameDialogRefs = {
  renameOverlay: HTMLDivElement;
  renameInput: HTMLInputElement;
  renameCancelBtn: HTMLButtonElement;
  renameConfirmBtn: HTMLButtonElement;
};

export type RenameDialogDeps = {
  groupController: GroupControllerApi;
  settingsUI: { isOpen: () => boolean };
  log: LogController["log"];
};

export const createRenameDialog = (refs: RenameDialogRefs, deps: RenameDialogDeps) => {
  const { renameOverlay, renameInput, renameCancelBtn, renameConfirmBtn } = refs;
  const { groupController, settingsUI, log } = deps;

  const isValidGroupName = (val: string) => !!val && /\S/.test(val);

  const updateI18nText = () => {
    renameCancelBtn.textContent = t("settings.cancel.btn");
    renameConfirmBtn.textContent = t("settings.confirm.btn");
    renameInput.placeholder = t("rename.placeholder");
    // 标题可能不存在，需要检查
    const titleEl = renameOverlay.querySelector<HTMLElement>(".settings-title");
    if (titleEl) {
      titleEl.textContent = t("rename.title");
    }
  };

  const open = () => {
    if (settingsUI.isOpen()) return;
    const previewId = groupController.getPreviewGroupId();
    const currentName = groupController.getGroupName(previewId) ?? t("rename.groupN", { n: previewId });
    renameInput.value = currentName;
    renameOverlay.classList.remove("hidden");
    renameInput.focus();
    renameInput.select();
    requestAnimationFrame(() => renameInput.setSelectionRange(0, renameInput.value.length));
    updateI18nText();
    appEventBus.emit("userOperation", { side: "right", op: "rename-group", highlightDuration: 0 });
  };

  const close = () => {
    if (!renameOverlay) return;
    renameOverlay.classList.add("hidden");
    appEventBus.emit("userOperationDone", { side: "right", op: "rename-group" });
  };

  const handleConfirm = () => {
    const val = renameInput.value ?? "";
    if (!isValidGroupName(val)) {
      log(t("log.group.rename.invalid"), "error");
      close();
      return;
    }
    groupController.setGroupName(groupController.getPreviewGroupId(), val.trim());
    log(t("log.group.rename.success"), "success");
    close();
  };

  // 绑定事件
  renameCancelBtn.addEventListener("click", close);
  renameConfirmBtn.addEventListener("click", handleConfirm);
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  // 监听语言切换
  onLanguageChanged(updateI18nText);

  // 暴露接口
  return {
    open,
    close,
  };
};

const SELECTORS = {
  renameOverlay: "#rename-overlay",
  renameInput: "#rename-input",
  renameCancelBtn: "#rename-cancel-btn",
  renameConfirmBtn: "#rename-confirm-btn",
} as const;

export const initRenameDialog = (deps: RenameDialogDeps) => {
  const renameOverlay = document.querySelector<HTMLDivElement>(SELECTORS.renameOverlay);
  const renameInput = document.querySelector<HTMLInputElement>(SELECTORS.renameInput);
  const renameCancelBtn = document.querySelector<HTMLButtonElement>(SELECTORS.renameCancelBtn);
  const renameConfirmBtn = document.querySelector<HTMLButtonElement>(SELECTORS.renameConfirmBtn);

  if (
    !renameOverlay ||
    !renameInput ||
    !renameCancelBtn ||
    !renameConfirmBtn
  ) {
    throw new Error("初始化重命名对话框失败，缺少必要的元素");
  }

  return createRenameDialog({
    renameOverlay,
    renameInput,
    renameCancelBtn,
    renameConfirmBtn,
  }, deps);
};
