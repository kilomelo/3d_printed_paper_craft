export type StatusTone = "info" | "error" | "success";

type StatusState = {
  message: string;
  tone: StatusTone;
  count: number;
};

export type StatusController = {
  setStatus: (message: string, tone?: StatusTone) => void;
};

export function createStatus(el: HTMLElement): StatusController {
  let lastStatus: StatusState = { message: "", tone: "info", count: 0 };

  const setStatus = (message: string, tone: StatusTone = "info") => {
    if (message === lastStatus.message && tone === lastStatus.tone) {
      lastStatus.count += 1;
    } else {
      lastStatus = { message, tone, count: 0 };
    }
    const suffix = lastStatus.count > 0 ? ` +${lastStatus.count}` : "";
    el.textContent = `${message}${suffix}`;
    el.className = `status status-text ${tone === "info" ? "" : tone}`;
  };

  return { setStatus };
}
