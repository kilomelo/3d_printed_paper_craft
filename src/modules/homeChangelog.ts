type ChangelogItem = { version: string; date: string; points: string[] };

const parseChangelogText = (text: string): ChangelogItem[] => {
  const lines = text.split(/\r?\n/);
  const result: ChangelogItem[] = [];
  let current: ChangelogItem | null = null;

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;

    const header = line.match(/^##\s*v?([0-9A-Za-z._-]+)\s*\|\s*(\d{4}-\d{2}-\d{2})$/);
    if (header) {
      if (current) result.push(current);
      current = { version: header[1], date: header[2], points: [] };
      return;
    }

    if (line.startsWith("- ") && current) {
      current.points.push(line.slice(2).trim());
    }
  });

  if (current) result.push(current);
  return result;
};

const renderHomeChangelog = (homeChangelogList: HTMLDivElement, items: ChangelogItem[]) => {
  const allItemsHtml = !items.length
    ? `<div class="home-changelog-item">No changelog data.</div>`
    : items.map((item) => `
      <article class="home-changelog-item">
        <header class="home-changelog-head">
          <span class="home-changelog-version">v${item.version}</span>
          <span class="home-changelog-date">${item.date}</span>
        </header>
        <ul class="home-changelog-points">
          ${item.points.map((point) => `<li>${point}</li>`).join("")}
        </ul>
      </article>
    `).join("");
  homeChangelogList.innerHTML = allItemsHtml;
};

export const loadHomeChangelog = async (
  homeChangelogList: HTMLDivElement | null,
  t: (key: string) => string,
) => {
  if (!homeChangelogList) return;
  try {
    const changelogPath = t("mainpage.changelogFile");
    const path = changelogPath && changelogPath !== "mainpage.changelogFile" ? changelogPath : "/changelog.md";
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`failed: ${res.status}`);
    const content = await res.text();
    renderHomeChangelog(homeChangelogList, parseChangelogText(content));
  } catch {
    homeChangelogList.innerHTML = `<div class="home-changelog-item">Load changelog failed.</div>`;
  }
};
