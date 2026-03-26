let popupEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;

export function initTransientPopup(element: HTMLDivElement | null) {
  popupEl = element;
}

export function showTransientPopup(message: string, duration = 2000) {
  if (!popupEl) return;
  popupEl.textContent = message;
  popupEl.title = message;
  popupEl.classList.add("is-visible");

  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
  }

  hideTimer = window.setTimeout(() => {
    popupEl?.classList.remove("is-visible");
    hideTimer = null;
  }, Math.max(0, duration));
}
