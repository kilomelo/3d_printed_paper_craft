export type LogTone = "info" | "error" | "success" | "progress";

type LogEntry = {
  message: string | number;
  tone: LogTone;
  count: number;
};

export type LogController = {
  log: (message: string | number, tone?: LogTone) => void;
};

export function createLog(listEl: HTMLElement): LogController {
  const entries: LogEntry[] = [];

  const formatProgress = (message: string | number) => {
    const value = typeof message === "number" ? message : Number(message.toString().match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const pct = Math.min(100, Math.max(0, value));
    const totalBars = 25;
    const filled = Math.round((pct / 100) * totalBars);
    const bar = `${"█".repeat(filled)}${"-".repeat(totalBars - filled)}`;
    return `工作进度: |${bar}| ${pct}%`;
  };

  const render = () => {
    listEl.innerHTML = "";
    entries.slice(-6).forEach((e) => {
      const div = document.createElement("div");
      div.className = `log-entry ${e.tone === "info" ? "" : e.tone}`;
      const suffix = e.count > 0 ? ` (+${e.count})` : "";
      const message =
        e.tone === "progress" ? formatProgress(e.message) : e.message;
      div.textContent = message + suffix;
      listEl.appendChild(div);
    });
    listEl.scrollTop = listEl.scrollHeight;
  };

  const log = (message: string | number, tone: LogTone = "info") => {
    const last = entries[entries.length - 1];
    if (tone === "progress") {
      const value =
        typeof message === "number"
          ? message
          : Number(message.toString().match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
      if (value !== 0) {
        let foundIdx = -1;
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].tone === "progress") {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx >= 0) {
          const entry = entries.splice(foundIdx, 1)[0];
          entry.message = message;
          entry.count = 0;
          entries.push(entry);
          render();
          return;
        }
      }
      if (last?.tone === "progress") {
        last.message = message;
        last.count = 0;
      } else {
        entries.push({ message, tone, count: 0 });
      }
      render();
      return;
    }
    const targetForStack = last?.tone === "progress" ? entries[entries.length - 2] : last;
    if (targetForStack && targetForStack.message === message && targetForStack.tone === tone) {
      targetForStack.count += 1;
    } else {
      entries.push({ message, tone, count: 0 });
    }
    render();
  };

  return { log };
}
