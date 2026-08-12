/** Build a CF-like page shell. Node helper used by build.mjs */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function wrapFragment(innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Fundhub CF harness</title>
</head>
<body>
<div class="c-wrapper">
  <div class="c-section" data-page-element="SectionContainer/V1">
    <div class="c-row" data-page-element="RowContainer/V1">
      <div class="c-column" data-page-element="ColContainer/V1">
        <div class="inner" data-page-element="CustomHtmlJs/V1">
${innerHtml}
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function loadWidgetShell(kind) {
  const file =
    kind === "scheduler"
      ? join(__dirname, "widgets", "scheduler-shell.html")
      : join(__dirname, "widgets", "survey-shell.html");
  return readFileSync(file, "utf8");
}

/**
 * Sandwich top fragment + real-DOM widget shell + bottom fragment.
 * @param {'scheduler'|'survey'} widgetKind
 */
export function sandwich(topHtml, widgetKind, bottomHtml) {
  const widgetInner = loadWidgetShell(widgetKind);
  // Widget shell already includes data-page-element + data-testid
  const widget = `
<div class="c-section" data-page-element="SectionContainer/V1">
  <div class="c-row" data-page-element="RowContainer/V1">
    <div class="c-column" data-page-element="ColContainer/V1">
${widgetInner}
    </div>
  </div>
</div>`;
  return wrapFragment(`${topHtml}\n${widget}\n${bottomHtml}`);
}
