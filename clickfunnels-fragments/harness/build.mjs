import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wrapFragment, sandwich } from "./_shell.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = __dirname;

function frag(name) {
  return readFileSync(join(root, name), "utf8");
}

mkdirSync(join(out, "widgets"), { recursive: true });

writeFileSync(join(out, "watch.html"), wrapFragment(frag("01-vsl.html")));

writeFileSync(
  join(out, "apply.html"),
  sandwich(frag("02a-apply-top.html"), "survey", frag("02b-apply-bottom.html")),
);

writeFileSync(
  join(out, "book.html"),
  sandwich(frag("04a-book-top.html"), "scheduler", frag("04b-book-bottom.html")),
);

writeFileSync(join(out, "thank-you.html"), wrapFragment(frag("05-thank-you.html")));

/* Grid A/B: same book page, swap only body::before positioning strategy */
const bookTop = frag("04a-book-top.html");
const bookBottom = frag("04b-book-bottom.html");
const bookSand = sandwich(bookTop, "scheduler", bookBottom);

const gridFixed = bookSand; // fragments already use position:fixed on body::before
const gridAbsolute = bookSand.replace(
  /body::before\{[\s\S]*?background-size:44px 44px;\s*\}/,
  `body::before{
  content:"";position:absolute;left:0;right:0;top:0;z-index:-1;pointer-events:none;
  min-height:100%;
  background-color:#FCFCFC;
  background-image:
    linear-gradient(rgba(10,10,10,.048) 1px,transparent 1px),
    linear-gradient(90deg,rgba(10,10,10,.048) 1px,transparent 1px);
  background-size:44px 44px;
}`,
);

writeFileSync(join(out, "grid-a-fixed.html"), gridFixed);
writeFileSync(join(out, "grid-b-absolute.html"), gridAbsolute);

writeFileSync(
  join(out, "index.html"),
  `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fundhub CF harness</title>
<style>
body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#0A0A0A;background:#FCFCFC}
a{color:#188bf6;display:block;margin:10px 0;font-size:18px}
h1{font-size:28px;letter-spacing:-.03em}
p{color:#52525B}
</style></head><body>
<h1>Fundhub ClickFunnels harness</h1>
<p>Local sandwich pages with real-DOM widget shells (V2).</p>
<a href="./watch.html">/watch — VSL</a>
<a href="./apply.html">/apply — survey sandwich</a>
<a href="./book.html">/funding-book-call — calendar sandwich</a>
<a href="./thank-you.html">/thank-you</a>
<hr style="margin:28px 0;border:none;border-top:1px solid #E4E4E7"/>
<p>Grid A/B (Chris picks — do not auto-choose)</p>
<a href="./grid-a-fixed.html">Grid A — body::before fixed</a>
<a href="./grid-b-absolute.html">Grid B — body::before absolute + min-height:100%</a>
</body></html>`,
);

console.log("harness pages written to", out);
