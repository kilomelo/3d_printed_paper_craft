export type PercentVisibility = "never" | "holding" | "always";

export type HoldButtonOptions = {
  label: string;
  onConfirm: () => void;

  holdMs?: number;                 // default 1000
  disabled?: boolean;              // default false
  lockOnConfirm?: boolean;         // default true (confirm后锁定，避免二次触发)
  showPercent?: boolean;           // default false
  percentVisibility?: PercentVisibility; // default "holding"
  percentFormatter?: (p: number) => string; // default "xx%"

  onProgress?: (p: number) => void; // optional
  onCancel?: () => void;            // optional (release early / pointer cancel)
};

export function createHoldButton(opts: HoldButtonOptions) {
  // NOTE: holdMs needs to be mutable if you want setHoldMs() to work.
  let holdMs = Math.max(1, opts.holdMs ?? 1000);

  const lockOnConfirm = opts.lockOnConfirm ?? true;
  const showPercent = opts.showPercent ?? false;
  const percentVisibility: PercentVisibility = opts.percentVisibility ?? "holding";
  const percentFormatter = opts.percentFormatter ?? ((p) => `${Math.round(p * 100)}%`);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hold-btn";
  btn.disabled = !!opts.disabled;

  // Base layer + Fill layer (same layout, different color via CSS)
  btn.innerHTML = `
    <span class="hold-btn__content hold-btn__base">
      <span class="hold-btn__label"></span>
      ${showPercent ? `<span class="hold-btn__pct" aria-hidden="true"></span>` : ``}
    </span>

    <span class="hold-btn__layer" aria-hidden="true">
      <span class="hold-btn__content">
        <span class="hold-btn__label"></span>
        ${showPercent ? `<span class="hold-btn__pct"></span>` : ``}
      </span>
    </span>
  `;

  const baseLabel = btn.querySelectorAll<HTMLSpanElement>(".hold-btn__label")[0]!;
  const fillLabel = btn.querySelectorAll<HTMLSpanElement>(".hold-btn__label")[1]!;
  baseLabel.textContent = opts.label;
  fillLabel.textContent = opts.label;

  const basePct = showPercent ? btn.querySelectorAll<HTMLSpanElement>(".hold-btn__pct")[0]! : null;
  const fillPct = showPercent ? btn.querySelectorAll<HTMLSpanElement>(".hold-btn__pct")[1]! : null;

  let holding = false;
  let done = false;
  let startTs = 0;
  let raf: number | 0 = 0;
  let pointerId: number | null = null;

  const setProgress = (p: number) => {
    const clamped = Math.max(0, Math.min(1, p));
    btn.style.setProperty("--p", clamped.toFixed(4));
    opts.onProgress?.(clamped);

    if (!showPercent) return;

    const txt = percentFormatter(clamped);
    const shouldShow =
      percentVisibility === "always" ||
      (percentVisibility === "holding" && holding);

    if (basePct) basePct.textContent = shouldShow ? txt : "";
    if (fillPct) fillPct.textContent = shouldShow ? txt : "";
  };

  // ---------- Global (window/document) fallback listeners ----------
  const onWindowPointerUp = (e: PointerEvent) => {
    if (!holding || done) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    cancel(true);
  };

  const onWindowPointerCancel = (e: PointerEvent) => {
    if (!holding || done) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    cancel(true);
  };

  const onWindowBlur = () => {
    if (!holding || done) return;
    cancel(true);
  };

  const onVisibilityChange = () => {
    if (!holding || done) return;
    if (document.visibilityState !== "visible") cancel(true);
  };

  const addGlobalListeners = () => {
    // use capture phase for robustness
    window.addEventListener("pointerup", onWindowPointerUp, true);
    window.addEventListener("pointercancel", onWindowPointerCancel, true);
    window.addEventListener("blur", onWindowBlur, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);
  };

  const removeGlobalListeners = () => {
    window.removeEventListener("pointerup", onWindowPointerUp, true);
    window.removeEventListener("pointercancel", onWindowPointerCancel, true);
    window.removeEventListener("blur", onWindowBlur, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
  };
  // ---------------------------------------------------------------

  const cancel = (callHook: boolean) => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;

    holding = false;
    pointerId = null;

    removeGlobalListeners();

    setProgress(0);
    if (callHook) opts.onCancel?.();
  };

  const trigger = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;

    holding = false;
    pointerId = null;

    removeGlobalListeners();

    setProgress(1);

    if (lockOnConfirm) {
      done = true;
      btn.disabled = true;
    }

    opts.onConfirm();
  };

  btn.addEventListener("contextmenu", (e) => e.preventDefault());

  btn.addEventListener("pointerdown", (e) => {
    if ((e as PointerEvent).button !== 0) return;
    if (btn.disabled || done || holding) return;

    holding = true;
    pointerId = (e as PointerEvent).pointerId;
    startTs = performance.now();
    setProgress(0);

    // ✅ Ensure we always receive "release" even if pointerup doesn't hit the button
    addGlobalListeners();

    // best-effort capture (helps too)
    try { btn.setPointerCapture(pointerId); } catch {}

    const tick = (ts: number) => {
      if (!holding || done) return;

      const p = (ts - startTs) / holdMs;
      setProgress(p);

      if (p >= 1) {
        trigger();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
  });

  // normal path: release on element
  btn.addEventListener("pointerup", (e) => {
    if (!holding || done) return;
    if ((e as PointerEvent).pointerId !== pointerId) return;
    cancel(true);
  });

  btn.addEventListener("pointercancel", (e) => {
    if (!holding || done) return;
    if ((e as PointerEvent).pointerId !== pointerId) return;
    cancel(true);
  });

  // init percent visibility
  setProgress(0);

  return {
    el: btn,

    reset() {
      done = false;
      btn.disabled = !!opts.disabled;
      // don't call onCancel on reset
      cancel(false);
    },

    setLabel(next: string) {
      baseLabel.textContent = next;
      fillLabel.textContent = next;
    },

    setDisabled(v: boolean) {
      btn.disabled = v;
      if (v) cancel(false);
    },

    setHoldMs(ms: number) {
      holdMs = Math.max(1, ms);
    },

    /** set tokens inline (optional helper) */
    setToken(name: string, value: string) {
      btn.style.setProperty(name, value);
    },

    /** if you want confirm to be usable again without full reset */
    unlock() {
      done = false;
      btn.disabled = false;
      setProgress(0);
    }
  };
}
