/* Mobile layout check for the CRM screens.
 *
 *   node docs/workflows/mobile-check.mjs                    # all screens
 *   node docs/workflows/mobile-check.mjs pipeline,lenders   # named screens
 *   node docs/workflows/mobile-check.mjs --shots            # also write PNGs
 *
 * Why this exists: loading /app/<screen>.html in a browser bounces you to
 * sign-in, because shell.js is the auth gate and runs before anything paints.
 * A screenshot taken without handling that is a picture of the login page. That
 * already wasted one measurement pass during the ground phase, so the harness
 * is committed rather than left for each workflow to rediscover.
 *
 * How it gets in: shell.js falls back to a demo session in localStorage when
 * /api/auth/session does not answer (shell.js getSession). The static server
 * here answers 404 for /api/*, so seeding fh_demo_staff is enough. The REAL
 * shell.js then runs — real gate, real injected sidebar, real mobile wiring.
 * Nothing about the shell is stubbed, so what you measure is what ships.
 *
 * The bar: zero sideways overflow at 390px. That is the measurable definition
 * of done for the mobile batch. See docs/workflows/mobile-crm.md.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.join(REPO, 'public');
const PORT = 8096;
const PHONE = { width: 390, height: 844 };

const args = process.argv.slice(2);
const wantShots = args.includes('--shots');
const named = args.filter(a => !a.startsWith('--')).join(',');
const SHOTS = path.join(REPO, '.mobile-shots');

const screens = named
  ? named.split(',').map(s => s.trim()).filter(Boolean)
  : fs.readdirSync(path.join(ROOT, 'app'))
      .filter(f => f.endsWith('.html') && !f.includes('.fragment.'))
      .map(f => f.replace(/\.html$/, ''))
      .sort();

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

const exe = process.env.PLAYWRIGHT_CHROMIUM
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('**fonts.g**', r => r.abort());          // CDN unreachable in CI
await ctx.addInitScript(() => {
  localStorage.setItem('fh_demo_staff', JSON.stringify({
    id: 1, name: 'Layout Check', email: 'owner@fundhub.ai', role: 'owner',
  }));
});
if (wantShots) fs.mkdirSync(SHOTS, { recursive: true });

let bad = 0, checked = 0, skipped = 0;
console.log(`\nmobile check @ ${PHONE.width}px — ${screens.length} screen(s)\n`);
console.log('screen'.padEnd(24) + 'overflow'.padEnd(12) + 'rail'.padEnd(8) + 'widest offender');
console.log('-'.repeat(84));

for (const name of screens) {
  const page = await ctx.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1100);

    if (/\/login\.html/.test(page.url())) {   // gate still bounced us
      console.log(name.padEnd(24) + 'SKIP — redirected to sign-in');
      skipped++; await page.close(); continue;
    }

    const m = await page.evaluate(() => {
      const side = document.querySelector('.side');
      const r = side && side.getBoundingClientRect();
      let worstW = 0, worst = '';
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (getComputedStyle(el).position === 'fixed') continue;   // drawers live off-screen by design
        if (b.right > window.innerWidth + 2 && b.width > worstW) {
          worstW = b.width;
          worst = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : '');
        }
      }
      return {
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        // rail must be parked off-canvas until asked for
        railIn: !!(r && r.left > -10 && r.width > 0),
        worst: worstW ? `${worst} ${Math.round(worstW)}px` : '',
      };
    });

    const over = m.docW - m.winW;
    const ok = over <= 2 && !m.worst;
    if (!ok || m.railIn) bad++;
    checked++;
    console.log(
      name.padEnd(24) +
      (ok ? 'ok' : `+${over}px`).padEnd(12) +
      (m.railIn ? 'SHOWING' : 'hidden').padEnd(8) +
      m.worst
    );
    if (wantShots) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  } catch (e) {
    console.log(name.padEnd(24) + 'ERROR — ' + e.message.split('\n')[0]);
    bad++;
  }
  await page.close();
}

console.log('-'.repeat(84));
console.log(`checked ${checked}   failing ${bad}   skipped ${skipped}\n`);
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
