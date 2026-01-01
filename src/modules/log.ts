export type LogTone = "info" | "error" | "success";

type LogEntry = {
  message: string;
  tone: LogTone;
  count: number;
};

export type LogController = {
  setStatus: (message: string, tone?: LogTone) => void;
};

export function createLog(listEl: HTMLElement): LogController {
  const entries: LogEntry[] = [];
  const render = () => {
    listEl.innerHTML = "";
    entries.slice(-6).forEach((e) => {
      const div = document.createElement("div");
      div.className = `log-entry ${e.tone === "info" ? "" : e.tone}`;
      const suffix = e.count > 0 ? ` (+${e.count})` : "";
      div.textContent = e.message + suffix;
      listEl.appendChild(div);
    });
    listEl.scrollTop = listEl.scrollHeight;
  };

  const setStatus = (message: string, tone: LogTone = "info") => {
    const last = entries[entries.length - 1];
    if (last && last.message === message && last.tone === tone) {
      last.count += 1;
    } else {
      entries.push({ message, tone, count: 0 });
    }
    render();
  };

  return { setStatus };
}
