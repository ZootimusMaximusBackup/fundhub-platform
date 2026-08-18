# Client portal — bring back the welcome video

**Batch:** client-portal-welcome-video-2026-08-17
**Owner ask (Chris, 2026-08-17):**

1. The welcome video was removed. It was the hero video at the top. Bring it back.
2. "Sign to authorize dispute letters" was put in its place and it's in a weird spot.
   Move it — welcome leads, the sign card comes after.
3. Strip the staff-facing text visible to clients: "Open this from a client file"
   and "open this page with ?id=<client id>".

**Prove:** lint, relevant tests, live capture signed in as client. Push and deploy.

**Primary file:** `public/app/client-portal.html`
**Evidence folder:** `docs/workflows/client-portal-welcome-video-2026-08-17-evidence/`

---

## Task list

| # | Task | Owner | Status |
|---|------|-------|--------|
| A | Git archaeology — recover the removed welcome video markup, CSS, JS, source | agent-A | done |
| B | Test recon — every assertion on the two staff strings; which go red | agent-B | done |
| C | Live "before" capture on fundhub.ai signed in as a client | agent-C | done (signed-in shot blocked — live sign-in is down, see manifest) |
| D | The edit + lint + tests + "after" capture + push + deploy | Fixer (main) | done (signed-in capture blocked — live sign-in is down) |

---

## Shared context brief

- All three requested changes land in one file: `public/app/client-portal.html`.
- Known hits for the staff strings (pre-recon, main session):
  - `public/app/client-portal.html:370` — `<div class="welcome" id="greeting">Open this from a client file</div>`
  - `public/app/client-portal.html:371` — `<div class="welcome-sub precall-only" id="greeting-sub-pre">Open this from a client file.</div>`
  - `public/app/client-portal.html:1461-1462` — JS `setText(...)` writes both strings
  - `public/app/client-portal.html:1613` — `FHData.banner("sample", "Open this from a client file")`
  - `public/app/client-portal.html:1901` — "Sign in as a client, or open this page with ?id=<client id>, ..."
  - `public/app/client-portal.html:1928` — "Sign in as a client, or open this page with your client id, ..."
  - `src/http/crm-html.test.mjs:39` — asserts the string MUST be present. Goes red when stripped.
- Rules in force: `.cursor/rules/owner-scope-minimal-diff.mdc` (smallest diff, no drive-by edits),
  `.cursor/rules/live-playwright-100-before-manual.mdc`, `.cursor/rules/test-means-human-click.mdc`.
- Never weaken, skip, or delete a test to get green (fixer SKILL.md rule 4).

---

## Workflow A manifest

**Status: done. Read-only. No application file was touched.**

### Headline — two things are not what they look like

1. **There was never a real video.** Every version of this page has had a *fake*
   player: a dark box with a faded logo, a play triangle, and a timer written in
   JavaScript that counted up to 4:12 on its own. No video file. No YouTube or
   Vimeo embed. No web address. No database field. Nothing ever played.
2. **The video card was never deleted.** It is still on the page right now, at
   lines 418–436. Two things happened to it instead: the fake player controls
   were taken out, and the "Sign to authorize dispute letters" card jumped ahead
   of it. That is why it reads as "gone".

---

### 1. The commits

No commit removed the video card. Three commits changed it. Listed oldest first.

| Hash | Date | Author | Subject |
|---|---|---|---|
| `87eaae8` | Wed Jul 29 01:30:49 2026 +0000 | Claude | CRM wireframe suite at /app/, on real field names |
| `a6107b0` | Sat Aug 15 17:35:19 2026 -0700 | Zooted | Show a pre-call portal that does not look like a funded file. |
| `4e09dbc` | Sun Aug 16 03:03:24 2026 -0700 | Zooted | Merge the in-progress CRM stack for company testing. |
| `ae91faa` | Mon Aug 17 13:06:32 2026 -0700 | Zooted | Close the non-sales HIGH audit rows with real pickers and honest empty states. |

- `87eaae8` — created the page. Video card added as a small **compact** card:
  172px thumbnail on the left, text on the right.
- `a6107b0` — promoted it to the full-width **hero** it is today, and dropped the
  `funding-only` class so it shows before the call. Title changed from
  "Welcome to Card Stacking DFY — what happens next" to "Welcome to the Fundhub portal".
- `4e09dbc` — **this is the "removal".** Took out the play button, the scrub bar,
  the 0:00 / 4:12 times, and all the play/pause JavaScript. Put the words
  "Welcome video is not available" in the black box instead. Commit reason, from
  its own comment: *"honest empty. Do not pretend a video played."*
- `ae91faa` — **this is the "it moved".** Moved the sign card from *below* the
  video to *above* it. Nothing was deleted from the video card in this commit.

Also `0923f88` (Thu Aug 6) briefly added `funding-only` to the card, and `bb6c7cf`
swapped hard-coded pixel font sizes for `var(--fs-*)` tokens. Neither removed anything.

---

### 2. The exact HTML, verbatim

**Version A — the original compact card.** From `87eaae8`, file
`public/app/client-portal.html`, **lines 327–347**:

```html
      <!-- ══ 1 · WELCOME VIDEO (compact) ═════════════════════════════════ -->
      <section class="card video-card" aria-labelledby="video-title">
        <div class="player" id="player">
          <div class="ghost"><div class="logo" role="presentation"></div></div>
          <button class="playbtn" id="playbtn" type="button" aria-label="Play welcome video">▶</button>
        </div>
        <div class="video-meta">
          <div class="sec-hd" style="margin-bottom:7px">
            <div class="eyebrow">CP-01 <span class="sep">/</span> START HERE</div>
            <span class="tier-tag" id="tier-tag">Card Stacking DFY</span>
          </div>
          <div class="video-title" id="video-title">Welcome to Card Stacking DFY — what happens next</div>
          <div class="video-copy">Four minutes with Marcus on how your rounds are built, what we need from
            you, and when the money actually lands.</div>
          <div class="vrow">
            <span class="vtime" id="vnow">0:00</span>
            <div class="vtrack" id="vtrack"><i id="vfill"></i></div>
            <span class="vtime">4:12</span>
          </div>
        </div>
      </section>
```

**Version B — the hero, immediately before `4e09dbc` stripped it.** This is the
last state that had working controls. Parent commit `a6107b0`, **lines 388–408**:

```html
      <!-- ══ 1 · WELCOME VIDEO (hero) ════════════════════════════════════ -->
      <section class="card video-card" aria-labelledby="video-title">
        <div class="player" id="player">
          <div class="ghost"><div class="logo" role="presentation"></div></div>
          <button class="playbtn" id="playbtn" type="button" aria-label="Play welcome video">▶</button>
        </div>
        <div class="video-meta">
          <div class="sec-hd" style="margin-bottom:7px">
            <div class="eyebrow">CP-01 <span class="sep">/</span> START HERE</div>
            <span class="tier-tag" id="tier-tag">Fundhub portal</span>
          </div>
          <div class="video-title" id="video-title">Welcome to the Fundhub portal</div>
          <div class="video-copy">A short hello: what this page is, what happens on your call, and how to
            use this portal so you are not guessing.</div>
          <div class="vrow">
            <span class="vtime" id="vnow">0:00</span>
            <div class="vtrack" id="vtrack"><i id="vfill"></i></div>
            <span class="vtime">4:12</span>
          </div>
        </div>
      </section>
```

The only difference between version B and what is on the page today is three lines:

```html
-          <button class="playbtn" id="playbtn" type="button" aria-label="Play welcome video">▶</button>
+          <p class="video-empty" id="video-empty">Welcome video is not available</p>
```

```html
-            <span class="vtime" id="vnow">0:00</span>
-            <div class="vtrack" id="vtrack"><i id="vfill"></i></div>
-            <span class="vtime">4:12</span>
+            <span class="vtime" id="vnow">—</span>
```

It nests directly inside `<div class="page fh-maxw">` inside `<main>`, as a
direct sibling of the other `<section class="card ...">` blocks.

---

### 3. The exact CSS, verbatim — **still present, nothing was deleted**

Every class the video card ever used is still in the current file. `.playbtn`,
`.playbtn:hover`, `.playbtn.playing`, `.player.playing .ghost .logo`, `.vrow`,
`.vtrack`, `.vtrack i`, `.vtime` are all live rules with no markup using them.

Current `public/app/client-portal.html`, **lines 81–100**:

```css
/* ── 1 · welcome video (hero) ──────────────────────────────────────────────
   Full-width welcome to the portal. Always shown — access is granted before
   the call, so this cannot hide behind funding-snapshot. */
.video-card{padding:0;overflow:hidden;display:flex;flex-direction:column}
.player{position:relative;width:100%;aspect-ratio:16/9;max-height:min(420px,52vw);border-radius:0;background:linear-gradient(135deg,#0A0A0A,#1C1C20);display:flex;align-items:center;justify-content:center;overflow:hidden}
.player .ghost{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.player .ghost .logo{width:42%;max-width:280px;aspect-ratio:2698/543;filter:invert(1);opacity:.12}
.playbtn{position:relative;width:64px;height:64px;border-radius:50%;border:0;background:rgba(252,252,252,.94);color:var(--ink);font-size:var(--fs-title);line-height:1;display:flex;align-items:center;justify-content:center;padding-left:4px;transition:transform .14s,background .14s}
.playbtn:hover{transform:scale(1.06);background:#fff}
.playbtn.playing{padding-left:0;font-size:var(--fs-title)}
.player.playing .ghost .logo{opacity:.18}
.video-empty{position:relative;z-index:1;margin:0 24px;max-width:28ch;text-align:center;color:var(--dark-text-dim);font-size:var(--fs-body);font-weight:600}
.vrow{display:flex;align-items:center;gap:10px;margin-top:10px}
.vtrack{flex:1;height:3px;border-radius:2px;background:var(--line);overflow:hidden;cursor:pointer}
.vtrack i{display:block;height:100%;width:0;background:var(--spectrum);border-radius:2px}
.vtime{font-family:var(--mono);font-size:var(--fs-caption);color:var(--text-faint);letter-spacing:.06em;flex:0 0 auto}
.video-meta{padding:18px 22px 16px}
.video-title{font-size:var(--fs-title);font-weight:800;letter-spacing:-.02em;margin-bottom:4px}
.video-copy{font-size:var(--fs-body);color:var(--text-dim);line-height:1.45;max-width:62ch}
```

Plus the mobile rules, current **lines 340–341**, inside the existing media query:

```css
  .player{max-height:min(280px,56vw)}
  .video-title{font-size:var(--fs-title)}
```

**One CSS caveat.** `bb6c7cf` replaced the original pixel sizes with tokens, and
in doing so collapsed three different sizes into one. `.playbtn` was `20px`,
`.playbtn.playing` was `16px`, and the mobile `.video-title` was `17px` — all
three are now `var(--fs-title)`. A pixel-exact restore of the old look would need
those numbers back; the restorer should **not** do that under the minimal-diff
rule unless Chris asks for it.

---

### 4. The exact JavaScript, verbatim — **deleted, and it was a fake**

Removed by `4e09dbc`. It was at **lines 792–836** in `87eaae8` (same code, one
block later, in the version `4e09dbc` deleted):

```javascript
/* ── welcome video: play / pause / scrub ────────────────────────────────── */
(function(){
  var DUR = 252;                                   /* 4:12 */
  var player = document.getElementById('player'),
      btn    = document.getElementById('playbtn'),
      fill   = document.getElementById('vfill'),
      now    = document.getElementById('vnow'),
      track  = document.getElementById('vtrack'),
      t = 0, timer = null;

  function clock(s){
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function paint(){
    fill.style.width = (t / DUR * 100) + '%';
    now.textContent = clock(t);
  }
  function pause(){
    clearInterval(timer); timer = null;
    btn.textContent = '▶'; btn.classList.remove('playing');
    btn.setAttribute('aria-label','Play welcome video');
    player.classList.remove('playing');
  }
  function play(){
    btn.textContent = '❚❚'; btn.classList.add('playing');
    btn.setAttribute('aria-label','Pause welcome video');
    player.classList.add('playing');
    timer = setInterval(function(){
      t += 1;
      if(t >= DUR){ t = DUR; paint(); pause(); return; }
      paint();
    }, 250);                                       /* 4x so the state is walkable */
  }
  btn.addEventListener('click', function(){
    if(t >= DUR) t = 0;
    timer ? pause() : play();
  });
  track.addEventListener('click', function(e){
    var r = track.getBoundingClientRect();
    t = Math.max(0, Math.min(DUR, (e.clientX - r.left) / r.width * DUR));
    paint();
  });
  paint();
})();
```

Read that carefully: `setInterval` ticking a counter every 250ms toward a
hard-coded 252 seconds. It moved a progress bar. **It never loaded or played
anything.** There is no `<video>`, no `play()` on a media element, no network call.

What sits there today, current **lines 981–989**:

```javascript
/* ── welcome video: honest empty. Do not pretend a video played. ── */
(function(){
  var btn = document.getElementById('playbtn');
  if (btn) btn.remove();
  var now = document.getElementById('vnow');
  if (now) now.textContent = '—';
  var empty = document.getElementById('video-empty');
  if (empty) empty.textContent = 'Welcome video is not available';
})();
```

Note this block calls `btn.remove()` — so even if the restorer puts the
`<button class="playbtn">` back in the HTML, **this JavaScript deletes it again
at page load.** It has to go at the same time.

---

### 5. The video source — there isn't one, and never was

Every search came back empty. These pickaxe searches over the whole history of
`public/app/client-portal.html` returned **zero commits**:

| Search | Result |
|---|---|
| `git log -S "<video" -- public/app/client-portal.html` | nothing |
| `git log -S "<iframe" -- public/app/client-portal.html` | nothing |
| `git log -S "youtube" -i -- public/app/client-portal.html` | nothing |
| `git log -S "vimeo" -i -- public/app/client-portal.html` | nothing |
| `git log -S "wistia" / "loom" / "mux" -i` | nothing |
| `git log -S ".mp4" -- public/app/client-portal.html` | nothing |
| `git log -S "poster=" -- public/app/client-portal.html` | nothing |
| `git log -S "api/content" -- public/app/client-portal.html` | nothing |
| `git log -S "content_video" -- public/app/client-portal.html` | nothing |

No video file was ever referenced. Video files that exist in the repo
(`public/funnel/vsl.mp4`, `clickfunnels-fragments/assets/VSL.mov`, and the
`credentials/notion-scrape/**/videos/*.mp4` scrape) all belong to other things —
none was ever linked from the client portal.

**But the plumbing for a real one already exists, unused.** Nobody has connected
it to this page:

- `db/migrations/171_content.sql` creates table **`content_videos`**
  (`id, org_id, title, duration_label, storage_key, mime_type, byte_size,
  uploaded_by, created_at`) and table **`content_tier_map`**
  (`org_id, tier_code, video_id, updated_at`). Its own comment: *"Which welcome
  video a product tier (or default) shows. Empty until someone maps one."*
- `api/content/upload.mjs` — `POST /api/content/upload`. Owner/admin only
  (`ROLE_SETS.OPS`). Accepts MP4 / MOV / WebM, stores the bytes, inserts the row.
- `api/content/tiles.mjs` — `GET/POST /api/content/tiles`. Owner/admin only.
  Returns the video library and the tier→video map.
- `public/app/content-admin.html` — the screen where a welcome video is uploaded
  and mapped to a tier. Its own note: *"A client sees the video mapped to the
  tier they bought."*

**Three gaps stop that from being a five-minute wire-up:**

1. There is **no client-facing read**. Both content routes are owner/admin gated.
   A client hitting them gets refused.
2. There is **no route that serves the video bytes**. `content_videos.storage_key`
   points into the document store, and no download or streaming endpoint exists
   for it anywhere in `api/`, `src/`, or `netlify/functions/api.mjs`.
3. `content_videos` is almost certainly **empty**. The migration seeds nothing,
   and nothing in the repo inserts a row except a live admin upload.

---

### 6. What replaced it in the DOM — **correction to the owner's read**

Chris is right that the sign card is in the wrong place, but the mechanism is
different from what he described. The sign card **did not take the video's
position**. It was moved to a position *above* the video, from `ae91faa`:

- **Before `ae91faa`:** greeting → Facebook wins → **welcome video** → status →
  **sign to authorize** → agreements → …
- **After `ae91faa` (today):** greeting → **sign to authorize** → Facebook wins →
  **welcome video** → agreements → …

The commit says why, in a comment it added to the page itself, current lines 374–377:

```html
      <!-- ══ SIGN TO AUTHORIZE DISPUTE LETTERS — onboarding, above the fold ══
           The welcome video is ~410px. This card sat under it, so a 900px
           fold scan never saw "Sign to authorize". It is the one action this
           screen needs from an unsigned client, so it loads first. -->
```

So it was deliberate, and it was done to beat a fold-scan audit row. Moving the
video back on top will very likely reopen whatever audit row `ae91faa` closed —
worth flagging to Chris before Workflow D swaps them.

That same commit also **deleted** this line from the sign card:

```html
        <a class="sign-auth-link" id="cpSignFullLink" href="consent-capture.html?kind=dispute_authorization">Open the full consent page</a>
```

and replaced it with a comment saying `consent-capture.html?kind=dispute_authorization`
must still appear somewhere in the file for the HTML test. Do not lose that
comment when moving the card.

---

### 7. Current top-of-page structure, in render order

Read from `public/app/client-portal.html` on `main` at `7be91a0`. File is 2004 lines.

| Lines | What renders |
|---|---|
| 355–360 | `.statesw` — staff-only "State" switcher: Before call / In progress / Just funded |
| 361–364 | `.who-pill` — avatar + client name (`#who-av`, `#who-name`) |
| 365 | `</header>` |
| 367–368 | `<main>` → `<div class="page fh-maxw">` — everything below nests here |
| **370** | `<div class="welcome" id="greeting">Open this from a client file</div>` |
| **371** | `<div class="welcome-sub precall-only" id="greeting-sub-pre">Open this from a client file.</div>` |
| 372 | `<div class="welcome-sub funding-only" id="greeting-sub">Here's where things stand on your funding.</div>` |
| 374–377 | HTML comment explaining the sign card's promotion |
| **378–406** | `<section class="card sign-auth-card" id="dispute-auth-card">` — **Sign to authorize dispute letters** |
| 408–416 | `<a class="card fb-wins" id="fb-wins">` — Join the Fundhub wins group |
| **418–436** | `<section class="card video-card">` — **WELCOME VIDEO (hero)**, showing "Welcome video is not available" |
| 438–443 | `<section class="card" id="agreements-card" hidden>` — Your agreements |
| 445–465 | `<section class="card prog-card precall-only">` — Before your call + 8-step stepper |
| 467+ | `<section class="card prog-card funding-only">` — Where your funding is |

**For the restorer:** to make the video lead again, move the block at **418–436**
(with its comment line 418) to sit immediately after line 372, ahead of the sign
card at 378. That is a pure move — no other block needs to change position.

---

### 8. Restoration risk — read this before touching anything

**Risk 1 — the biggest one. A straight revert turns the test suite red.**
`src/http/crm-html.test.mjs`, test `"client-portal.html ships no sample people and
no fake upload or video"`, has three assertions that a revert breaks:

```javascript
  assert.ok(!/setInterval/.test(html), "must not fake progress with setInterval");
  assert.ok(!/var DUR = 252/.test(html), "must not fake a 4:12 welcome video");
```
```javascript
  assert.ok(html.includes("Welcome video is not available"));
```

Restoring the old player brings back `setInterval` and `var DUR = 252`, and
removing the empty-state message drops the third. That test may not be weakened,
skipped, or deleted (fixer SKILL.md rule 4). **A literal revert is not available.**

**Risk 2 — there is nothing to play.** Bringing the play button back with no
video behind it recreates exactly the lie `4e09dbc` was written to remove: a
button a client clicks that fakes a progress bar for four minutes and shows
nothing. That is a customer-facing honesty problem on a regulated product.

**Risk 3 — the current JS deletes the button.** Lines 981–989 call
`btn.remove()` on `#playbtn` at load. HTML alone will not bring it back.

**Risk 4 — CSS is fine.** No renamed or deleted classes. `.playbtn`, `.vtrack`,
`.vfill`, `.vtime`, `.vrow` all still exist and still work. Nothing to rebuild.

**Risk 5 — no asset on disk.** There is no welcome video file anywhere in the
repo, and no route that could serve one.

**Risk 6 — moving the card reopens an audit row.** See section 6.

**Risk 7 — journeys.** `docs/journeys/client-actual.md` and
`client-intended.md` do not mention the welcome video at all. If the card's
position or behaviour changes, `client-actual.md` needs updating and
`docs/journeys/CHANGELOG.md` needs a line, in the same commit (CLAUDE.md §4).

### The one question Chris has to answer

There is no video and there never was. So "bring it back" has two very different
meanings, and Workflow D cannot pick between them:

- **(a) Bring back the empty player box as the top card** — move the existing
  card above the sign card, leave "Welcome video is not available" in it. Small,
  safe, keeps every test green, and the page stops lying. But there is still no
  video to watch.
- **(b) Ship a real video** — Chris uploads one in Content
  (`public/app/content-admin.html`), and someone builds the two missing pieces:
  a client-readable endpoint that says which video this client gets, and a route
  that serves the bytes. Then the player becomes a real `<video>`. That is a
  build, not a restore.

**Recommend asking Chris which one he means before Workflow D edits anything.**

## Workflow B manifest

**Status: done. Read-only recon. No test, no application file, and no config was changed.**

### Headline — three findings

1. **Only ONE real test mentions either string:** `src/http/crm-html.test.mjs:39`. It is a word
   search over the file `public/app/client-portal.html` sitting on disk. It never opens a browser
   and never looks at the screen. It only asks: do these words appear somewhere in that file?
2. **That test does NOT go red if the programmer note on line 1307 stays.** The same words sit in
   a note-to-programmers (a comment) at line 1307. Clear the five places a person can see, leave
   the note alone, and the test still passes. Measured, not guessed — see below.
3. **Everything else that mentions the strings is a one-off evidence script under `docs/`.**
   Nothing runs them. They only write notes into a JSON file. They cannot turn anything red.

### Where the words actually live (all in the one file Chris named)

| file:line | text | who sees it |
|---|---|---|
| `public/app/client-portal.html:370` | `<div class="welcome" id="greeting">Open this from a client file</div>` | everyone, for a blink before the page paints; and permanently when no client id is found |
| `public/app/client-portal.html:371` | `<div class="welcome-sub precall-only" id="greeting-sub-pre">Open this from a client file.</div>` | same — visible in the "no funding" state, which is how a letter-only client sees the page |
| `public/app/client-portal.html:1307` | JS comment: `this page stays empty: "Open this from a client file." It does not invent people.` | nobody — it is a note in the code |
| `public/app/client-portal.html:1461` | `setText("greeting", "Open this from a client file");` inside `paintEmptyIdentity()` | anyone who lands with no client id at all |
| `public/app/client-portal.html:1462` | `setText("greeting-sub-pre", "Open this from a client file.");` inside `paintEmptyIdentity()` | same |
| `public/app/client-portal.html:1613` | `FHData.banner("sample", "Open this from a client file");` — the yellow strip at the bottom | same |
| `public/app/client-portal.html:1901` | `"Sign in as a client, or open this page with ?id=<client id>, to load the legal wording and record a signature."` | anyone with no client id, on the "Sign to authorize dispute letters" card |
| `public/app/client-portal.html:1928` | `say("err", "Sign in as a client, or open this page with your client id, to record a signature.");` | same, after pressing the sign button |

### Every check that touches the strings

| file:line | exact assertion text | needs PRESENT or ABSENT | runs in `npm test`? | what kind of thing is it |
|---|---|---|---|---|
| `src/http/crm-html.test.mjs:39` | `assert.ok(html.includes("Open this from a client file"), "empty state must tell them to open from a client file");` | **PRESENT** | **YES** — under `src/**`, and it also runs in the blocking GitHub job | a real unit test; reads the file as plain text |
| `e2e/client-portal-ux.spec.mjs:66` | `await expect(page.locator("#greeting-sub-pre")).toBeVisible();` | the **box** must exist and be on screen — it never reads the words | no — runs under `npm run test:e2e` (blocking GitHub browser job) | a real browser test |
| `docs/workflows/e2e-verify-run5-evidence/client/reverify/capture-live.mjs:128` and `:142` | `const openFromClientFilePresent = /Open this from a client file/i.test(bodyText);` … `const verdictOk = … && !openFromClientFilePresent && …` | ABSENT | no | one-off evidence script; writes a `"verdict"` word into a JSON file, never fails a build |
| `docs/workflows/e2e-verify-run5-evidence/client/reverify/screen-detail.mjs:55` | `hasOpenFromClientFile: /Open this from a client file/i.test(document.body.innerText),` | records only, asserts nothing | no | one-off evidence script |
| `docs/workflows/e2e-verify-run5-evidence/client/fixed/capture.mjs:154` | `greetingSub: (document.getElementById("greeting-sub-pre") \|\| {}).textContent \|\| "",` | records only | no | one-off evidence script |

**What each command actually runs.** `npm test` walks `src/` and `scripts/` only. `npm run test:e2e`
and `npm run test:e2e:live` both use `testDir: "./e2e"` (the live one further filters to
`live-*.spec.mjs`). `npm run lint` only checks that files can be read by the computer — it never
looks at words. `.github/workflows/tests.yml` runs `npm run lint`, `npm test`, and `npm run test:e2e`.
**Nothing anywhere runs a file under `docs/`.** The three evidence scripts are named only by their
own README and were hand-run once.

### 1. Which tests turn red

**One, and only in one case: `src/http/crm-html.test.mjs:39`.**

- **RED** if the words `Open this from a client file` are taken out of *every* line of
  `public/app/client-portal.html`, the code note on line 1307 included.
- **GREEN** if the five person-visible places (370, 371, 1461, 1462, 1613) are reworded and the
  note on line 1307 is left alone.

Measured, not assumed. I made a copy of the file in memory, blanked those five lines, and ran the
same check the test runs:

```
after stripping the 5 visible occurrences, html.includes(...) = true
after also stripping the code note on line 1307, html.includes(...) = false
```

**Nothing else goes red from changing the words.** `e2e/client-portal-ux.spec.mjs:66` only asks
whether the box `#greeting-sub-pre` is on screen. In that test the page is opened with
`?id=<client id>`, so the page fills that box with "Welcome to your Fundhub portal. Your call is
next." before the check happens. Proven — I ran that spec and line 66 passed. **That test only goes
red if the `<div id="greeting-sub-pre">` box itself is deleted.** Keep the box, change the words,
and it stays green.

**No other test, snapshot, GitHub step, or lint rule mentions either string.** Searched the whole
repo (`node_modules` and `.git` excluded) across `.mjs .js .cjs .ts .tsx .jsx .html .json .yml
.yaml .md .snap` for both strings and for "client file", "open this page with", "?id=<client id>",
"your client id", "greeting-sub-pre", and "greeting".

### Baseline warning for Workflow D — that browser spec is ALREADY red

`npx playwright test e2e/client-portal-ux.spec.mjs` on `main` at `7be91a0`, **before any edit**:
**5 passed, 4 failed.** All four failures are about the unlock tiles, not about our words:

- line 70 — `#own-list` is empty; it expected "Metro 2 Dispute Letter Pack"
- line 97 — the page still carries `no-funding` when it should not
- line 118 — the tile lock row says "🔒 Locked"; it expected "Included"
- line 131 — the `FUNDING_MASTERY` unlock button is not there to click

Reading: the pretend API in that test answers the entitlement calls, and the page is not picking
them up. **Pre-existing. Do not let Workflow D read these four as damage from the copy change.**
The baseline block at the bottom of this board only measured the two unit files; this adds the
browser number.

### 2. What `src/http/crm-html.test.mjs` is really protecting

**In one line: it is a "no made-up people, no made-up progress" guard on the file. It is not a
screen test.**

- **What it loads:** the raw text of `public/app/client-portal.html` from disk
  (`fs.readFileSync`). No browser, no server, no login. No screen is ever drawn.
- **Which page:** the **CLIENT** portal. The file is called `crm-html.test.mjs` and its first test
  is about `public/crm.html`, but the test on line 29 —
  `"client-portal.html ships no sample people and no fake upload or video"` — is squarely about the
  client-facing portal. **The file name is misleading. This assertion is NOT about a staff or CRM
  screen.**
- **What the whole test guards:** the portal must not ship invented people (`Derek Owusu`,
  `Marcus Webb`), invented money (`$46,500`), invented document dates, a fake progress bar
  (`setInterval`), a fake 4:12 welcome video (`var DUR = 252`), or a "files sent" message with no
  upload behind it. Then it checks the honest fallbacks are still there: the empty-state line,
  "No activity recorded on this file yet", "Welcome video is not available", "Uploads are off", and
  that the page still reads the real endpoints.
- **So what line 39 really means:** *when the page has no client to show, it must say something
  instead of inventing a person.* The words it checks for are just the current wording of that
  "nothing to show" line. The test locks the exact sentence, not the idea, so it cannot tell the
  difference between "the honest line was deleted" and "the honest line was reworded".

That is the crux. **Chris is not asking to remove the honest empty state. He is asking for wording a
client can understand.** A different honest sentence keeps the test's intent completely and still
fails the test's letter.

### 3. Options that satisfy Chris and weaken no test

Ranked smallest change first. None of these edits, deletes, skips, or weakens a test.

**Option 1 — Reword the five visible places, leave the code note on line 1307. (Smallest: one file,
five lines.)** Change 370, 371, 1461, 1462, 1613 to client-friendly wording. Leave line 1307 exactly
as it is. `src/http/crm-html.test.mjs:39` stays green because the words still exist in the file.
The `#greeting-sub-pre` box keeps its place, so `e2e/client-portal-ux.spec.mjs:66` stays green.
Lines 1901 and 1928 have no test on them at all, so they can be reworded freely.
*Say this out loud rather than bury it:* after this change, line 39 is only matching a note in the
code. The test still passes, but it is no longer really watching the screen. That is a true
description of the situation, not a trick — and Chris should hear it, because a green test that
watches nothing is exactly the trap this repo keeps falling into.

**Option 2 — Same change as Option 1, then offer Chris the follow-up.** Identical diff. The only
difference is one sentence in the report: "the test that watched this line now only sees a note in
the code — want me to raise a follow-up so it watches the new sentence instead?" Pointing that test
at the *new* honest sentence would make it stronger, not weaker, but `src/http/crm-html.test.mjs`
is a file Chris did not name, so it is a stop-and-ask, never a drive-by.

**Option 3 — Show the staff wording only to staff, and client wording to clients.** The page
already knows who is looking: `roleHint()` (line 1337) reads `fh_role` from the browser,
`STAFF_ROLES` (line 1332) lists the seven staff roles, and `markStaffChrome()` (line 1342) already
puts a `portal-staff` mark on the page for staff. So `paintEmptyIdentity()` (lines 1457–1464) could
say "Open this from a client file" for staff and a client-friendly line for everyone else. The staff
wording then survives in real, running code, so line 39 keeps watching something real.
*Cost:* this is more than a copy change — it adds a branch, and the fixed lines 370 and 371 still
need client wording because they show before the page knows anyone's role. Bigger than what Chris
asked for.

**Option 4 — Change only lines 1901 and 1928 and leave the rest.** No test touches those two sign-card
lines at all, so this is zero risk. It does not finish what Chris asked for, so it is only worth
naming if he wants to split the job.

**Not an option, for the record:** deleting the `<div id="greeting-sub-pre">` box (turns
`e2e/client-portal-ux.spec.mjs:66` red), and editing or removing `src/http/crm-html.test.mjs:39`
(forbidden — fixer SKILL.md rule 4).

### Side notes — written down, not acted on (scope discipline)

- `public/app/client-portal.html` lines 1073, 1079, 1092, 1159, 1183 all say **"Uploads are off
  until this page is opened from a client file."** Same staff-shaped wording, same screen, and Chris
  did **not** name it. `src/http/crm-html.test.mjs:42` only looks for `"Uploads are off"`, so the
  tail of that sentence could be reworded without going red. Flagging, not fixing.
- `public/app/closer-dashboard.html:680` and `src/http/closer-dashboard-view.mjs:100` carry a
  similar line — `"open this screen with ?client_id=<uuid> to load a real client"` — but that is a
  **staff** screen, so the wording is correct there. Out of scope.
- `public/app/client-control-panel.html` and `public/app/consent-capture.html` carry
  `Open with ?id=<client id>` style lines. Both are staff screens. Out of scope.

### Change manifest

- Files touched: **this board file only.** No application file, no test, no config.
- Commands run, all read-only: repo-wide `grep`;
  `node --test src/http/crm-html.test.mjs src/http/consent-sign-pad-html.test.mjs` → **23 pass,
  0 fail**; `npx playwright test e2e/client-portal-ux.spec.mjs` → **5 pass, 4 fail** (pre-existing,
  detailed above). Machine: local macOS, `main` at `7be91a0`, no `DATABASE_URL` set.
- **Honest note on where that browser number was measured.** The working tree was **not clean** when
  I ran it — other workflows had unsaved changes to `public/app/shell.js`, `e2e/sidebar-roles.spec.mjs`
  and about twenty other files. `public/app/client-portal.html` itself was **untouched**, so the
  4 red tests are still about the tile/entitlement wiring and not about our words. But whoever
  picks this up should re-measure on a clean tree before quoting "4 failing" as the number.
  This follows CLAUDE.md §12: record where you ran it, because the environment moves the count.

## Workflow C manifest

**Status: done, with one thing I could not get. Read-only. No application file was touched.**
Evidence: `docs/workflows/client-portal-welcome-video-2026-08-17-evidence/before/`

### Read this first — the live site cannot sign anyone in right now

Nobody can log in to fundhub.ai. Not a client, not the owner, not anybody.

I tried three times. Every time, the sign-in call comes back with a server error:

```
POST https://fundhub.ai/api/auth/login  →  500
{"ok":false,"error":"internal_error","message":"cannot execute INSERT in a read-only transaction"}
```

Tried with `client@fundhub.ai` and with `owner@fundhub.ai`. Same error both times, so it is
not one account and it is not a wrong password. The password came from `STAFF_E2E_PASSWORD`
in the gitignored `.env`, read by the same loader the UI audit harness uses. Its value was
never printed anywhere.

**In plain English:** the site can still READ from the database, but it cannot WRITE to it.
`GET /api/health` answered `200 {"ok":true,"db":"up"}` at the same moment. Signing in has to
write a row to remember you, so signing in fails. The login page tells the client this in so
many words: *"Server error, not a wrong password — cannot execute INSERT in a read-only
transaction."* Screenshot: `before/BLOCKED-login-error-desktop.png`.

**What this means for Workflow D:** the "after" capture signed in as a client cannot be done
either, and neither can the live Playwright 100/100 gate, until sign-in works again. That is a
separate problem from this batch. It is on the live site, not in this branch.

### What I captured instead — and why it is still real

Both live files were downloaded straight from fundhub.ai and are **byte-identical** to this
branch:

| file | sha256 | matches working tree |
|---|---|---|
| `https://fundhub.ai/app/client-portal.html` | `0d2e4327…d23431c7` | yes |
| `https://fundhub.ai/app/fundhub-brand.css` | `45e23097…c140b03a` | yes |

So I rendered those two live files in a browser with JavaScript switched off. That gives the
true shipped layout, the true look, and the true top-to-bottom order — with none of the
JavaScript that later hides cards or fills in a client's name. **What is missing is only the
data-driven part**, and every place that matters is marked `UNVERIFIED` below.

### The answers

**a. Is there a welcome video? NO.** Confidence: high — this does not depend on signing in.
There is no `<video>`, no `<iframe>`, no embed of any kind anywhere in the page. No YouTube,
Vimeo, Wistia, Loom, Mux, `.mp4` or streaming link. No JavaScript builds one either.
What is there is a **thin grey strip, 730px wide and 53px tall**, with grey centred text
reading "Welcome video is not available". Not a big 16:9 box — the CSS asks for one, but
`.video-card` is a column flexbox so the player collapses to the height of its one line of
text. It sits **763px down the page**, two cards below the fold-line. This matches Workflow A:
there was never a real video.

**b. Is there a "Sign to authorize dispute letters" card? YES, and it is the hero.**
`section#dispute-auth-card`, the 4th child of `main .page`, at **94px from the top, 566px
tall**. The 1440x900 first screen shows about 848px, so this card is effectively the whole
first screen. Above it: only the two greeting lines (26px and 51px) plus one hidden `<div>`.
Below it: the Facebook wins row at 676px, then the empty video strip at 763px.

**c. Does the visible text contain "Open this from a client file"? YES.** It is the page
**headline** — the biggest line on the page, top-left at 26px — and the sub-line under it
repeats it with a full stop at 51px. Both sit directly above the sign card. The page reads:
"Open this from a client file" / "Open this from a client file." / "Sign to authorize
dispute letters".
**UNVERIFIED:** whether a signed-in client still reads it. These two lines are the
no-client-id fallback (lines 1589-1616). If the session carries a client id, `paintIdentity()`
runs instead and the headline becomes "Welcome back, <first name>" — or plain "Welcome" when
the session has no name. Sign-in is down, so I could not test which branch a real client hits.
**Workflow D must check this on a real client session.**

**d. Does the visible text contain "open this page with" / "?id=" / "your client id"? YES.**
Two rendered places, both **inside the sign card**:
- line 1901 → replaces the grey legal-wording box, about 200-235px down, between the lede and
  the "Your legal name" input: *"Sign in as a client, or open this page with ?id=<client id>,
  to load the legal wording and record a signature."*
- line 1928 → the message strip at the bottom of the same card, only after pressing the sign
  button: *"Sign in as a client, or open this page with your client id, to record a signature."*

Three more hits (lines 1113, 1306, 1682) are notes in the code and never reach a screen.
**UNVERIFIED for the same reason as (c)** — both are the no-client-id branch. With a client
id the wording is fetched from the server instead. The card ships showing "The legal wording
loads from the server. It is not stored in this page."

**e. What a client sees, top to bottom.** Measured at 1440px wide. This is the record the fix
will be compared against.

| # | What it is | Top | Height |
|---|---|---|---|
| 1 | Headline — "Open this from a client file" | 26px | 21px |
| 2 | Sub-line — "Open this from a client file." | 51px | 21px |
| 3 | **CARD: Sign to authorize dispute letters** — lede, grey legal-wording box, "Your legal name" input, signature pad, Clear, sign button | 94px | 566px |
| 4 | CARD: Join the Fundhub wins group — one-line Facebook row | 676px | 71px |
| 5 | **CARD: Welcome video** — grey strip "Welcome video is not available", then "CP-01 / START HERE", "Welcome to the Fundhub portal", short paragraph, em dash where the running time was | 763px | 222px |
| 6 | CARD: Before your call — black status bar + 8-step stepper (Booked → File Finalized) | 1000px | 201px |
| 7 | CARD: What You Own — "Nothing to download yet" | 1217px | 192px |
| 8 | CARD: Unlock More — six locked tiles, $32 soft pull up to the $5,000 course | 1425px | 600px |
| 9 | Account & history — collapsed drop-down (Payments · Agreements · Documents · Activity · Messages) | 2041px | 53px |
| 10 | Bottom rail — "Your Funding Advisor" (name shows as an em dash) beside "Want more funding? / Ask for a call" | 2110px | 216px |

Hidden in this state, still in the markup: `#greeting-sub.funding-only`, `#agreements-card`
(`hidden`), `.prog-card.funding-only`, `#promo.funding-only`, `#action-card`. The body carries
`no-funding no-docs no-own`, which is what gates them.

Phone (390px wide) is the same order. Sign card 94px→798px, video strip at 920px. No sideways
scrolling. Total page 3766px tall.

**f. Console errors.** On the signed-in page: UNVERIFIED, could not sign in. Visiting
`/app/client-portal.html` with no session throws **`FHData is not defined`** before the shell
redirects to login, plus the expected 401 on `GET /api/auth/session`. The portal's own script
runs before, or without, its data library. Worth a look; it is on the redirect path, so it
proves nothing about the signed-in path.

### What is in the evidence folder

| file | what it is |
|---|---|
| `findings.json` | Every answer above with the raw measurements |
| `client-portal-text.txt` | Full page text. Header at the top states the limits |
| `client-portal-top-dom.txt` | The HTML of the first 6 top-level blocks, in order, with pixel positions |
| `client-portal-STATIC-MARKUP-nojs-desktop-full.png` | Whole page, 1440px wide |
| `client-portal-STATIC-MARKUP-nojs-desktop-fold.png` | First screen only, 1440x900 |
| `client-portal-STATIC-MARKUP-nojs-mobile-full.png` | Whole page, 390px wide |
| `client-portal-STATIC-MARKUP-nojs-mobile-fold.png` | First screen only, 390x844 |
| `BLOCKED-no-session-desktop.png` | What the client portal link actually does with no session — bounces to login |
| `BLOCKED-login-error-desktop.png` | The login page after trying to sign in as the client. The error is on screen |
| `BLOCKED-login-error-mobile.png` | Same on a phone |

**`client-portal-desktop.png` and `client-portal-mobile.png` are deliberately NOT there.**
Those names promise a signed-in client screenshot and no such screenshot exists right now.
Filling them with a picture of the login page would make the before/after comparison lie.
Workflow D should create them once sign-in works.

### Change manifest

- Files touched: **this board file, and `…-evidence/before/` only.** No application file, no
  test, no config, no env var.
- Journeys: none changed. This was capture only.
- Harness reuse: `docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs` was read first and its
  login flow and write-guard were copied. It was not run as-is — it writes to a different
  evidence folder, does a click sweep this job does not want, and produces no page text or
  top-DOM dump. Throwaway scripts stayed in the scratchpad.
- Write safety: every non-GET `/api/**` call except the login POST was intercepted and answered
  599 in the browser. Nothing was written to the live system.
- `?id=` state: also captured. `/app/client-portal.html?id=8556bedc-46e1-4d85-b0cd-a24adfee1521`
  bounces to login exactly the same way — the shell demands a session before any `?id=`
  handling runs.

## Workflow D manifest

**Commit:** `dd79cd1` — "Put the welcome card back on top of the client portal and take the staff wording off it."
**On `origin/main`:** yes. **Live on fundhub.ai:** yes — the served file hashes `e25b54fe…`, identical to the commit.
**Files touched:** `public/app/client-portal.html` only. 33 insertions, 31 deletions.

### Owner decision that shaped this

Workflow A proved there was never a real welcome video — the original was a fake
player driven by a `setInterval` timer, stripped in `4e09dbc`. Asked to choose,
the owner picked: **move the card back to the top now, real video later.** The
card keeps saying "Welcome video is not available" until a video is uploaded.
Logged as owner-set.

### What changed

1. **Welcome card leads again.** The whole `<!-- 1 · WELCOME VIDEO (hero) -->`
   section moved above the sign card. One block moved; nothing inside it edited.
   This reverses the ordering `ae91faa` introduced.
2. **Sign card second**, directly under the welcome, still above the Facebook
   card. Its block comment described the old order and now describes the new one.
3. **Staff wording removed** from five places a client could read:
   - line 370 headline and 371 sub-line
   - `paintEmptyIdentity()` — both `setText` calls
   - the `FHData.banner("sample", …)` call
   - the sign card's disclosure fallback and its submit-error line
   Clients now see "Welcome to your Fundhub portal" and
   "We could not load your file. Use the link we sent you, or sign in again."

### Order, before vs after (measured, 1440px)

| | before | after |
|---|---|---|
| Headline | "Open this from a client file" (26px) | "Welcome to your Fundhub portal" (78px) |
| 1st card | **Sign to authorize** (94px, 566px tall) | **Welcome video** (146px) |
| 2nd card | Facebook wins (676px) | **Sign to authorize** (384px) |
| 3rd card | Welcome video (763px) | Facebook wins (966px) |

### The one test that could have gone red

`src/http/crm-html.test.mjs:39` asserts `"Open this from a client file"` is
present in the file. It still passes — but **only because it now matches the JS
comment on line 1309**, which no client ever sees. No test was edited, weakened,
skipped or deleted. **This is a real weak spot and it is written down, not hidden:**
that assertion no longer guards any user-visible wording. Pointing it at the new
sentence is a one-line change to a file the owner did not name, so it was not made.
Recommended as the next action.

### Proof

- `npm run lint` — clean.
- Unit tests that read this page — `crm-html`, `consent-sign-pad-html`,
  `chat-widget-precall`, `portal-contracts`, `portal-prequal`,
  `app-nav-matches-shell`: **78 pass, 1 fail**. The one failure is
  `company-brain.html: inline sidebar differs from shell.js` — another
  workflow's in-flight edit to `shell.js`/`company-brain.html`, unrelated to
  this change. `client-portal.html` passes that same test.
- Full suite before this change, on this machine with a dirty shared tree:
  **5611 pass, 23 fail, 3 skipped**. The tree holds ~70 files from other
  workflows, so that count is not attributable to `main` alone.
- Live "after" capture: `…-evidence/after/` — same no-JS technique as the
  "before", so the two compare directly. All three staff strings now read
  `false` in `findings.json`.

### What could not be proved, and why

**The signed-in client capture did not happen. Sign-in is down on the whole live
site**, for every role:

```
POST https://fundhub.ai/api/auth/login → 500
{"ok":false,"error":"internal_error","message":"cannot execute INSERT in a read-only transaction"}
```

Confirmed independently by Workflow C and by the main session. `/api/health`
returns `{"ok":true,"db":"up"}` because it only reads — the database is taking
reads and refusing writes, and signing in has to write a session row. This also
blocks the live Playwright 100/100 gate and the human click path. It is a live
outage, not something this change caused, and it predates the change.

### Notes for whoever picks this up

- Two things kept overwriting the working tree mid-edit: a `git reset` (visible
  twice in the reflog) and another session's `git add`, which staged this file
  and made `git diff` look empty. The fix was re-applied and committed straight
  away. The reusable patch is in the session scratchpad.
- The commit reached `origin/main` carried up by another session's push, not by
  a push from this session — a direct push was rejected as non-fast-forward.
  Verified after the fact: `dd79cd1` is an ancestor of `origin/main`, and the
  live file matches it exactly.
- Journeys unchanged: no route, gate, handler or test was modified.
  `npm run journeys:check` reports other files outdated — those belong to other
  workflows' route changes and were deliberately left alone.

### Side findings — written down, not fixed

- `public/app/client-portal.html` lines ~1073/1079/1092/1159/1183 say "Uploads
  are off until this page is opened from a client file" — same staff-shaped
  wording, not named by the owner. `crm-html.test.mjs:42` only checks for
  "Uploads are off", so the tail could be reworded safely.
- The welcome player collapses to a thin strip because `.video-card` is a column
  flexbox and the empty state has no aspect ratio. It will need a real 16:9 box
  when an actual video lands.

---

## Blockers and open questions

- **OPEN (raised by main session before start):** `src/http/crm-html.test.mjs:39` requires the
  string "Open this from a client file" to be present in the client portal HTML. Chris asked for
  that string to be stripped. Deleting or weakening the test is not allowed. Workflow B scopes the
  full blast radius; options go to Chris before any edit.

- **OPEN (raised by Workflow C, 2026-08-17):** **nobody can sign in to fundhub.ai.**
  `POST /api/auth/login` answers `500 {"ok":false,"error":"internal_error","message":"cannot
  execute INSERT in a read-only transaction"}` for every role tried (`client@`, `owner@`).
  `GET /api/health` says `200 {"ok":true,"db":"up"}` at the same moment, so the database can be
  read but not written. Three attempts, same result each time.
  **Blocks:** the signed-in "before" capture (worked around — see Workflow C manifest), the
  signed-in "after" capture, the live Playwright 100/100 gate, and the human click path. All of
  those need a working login.
  **Not caused by this batch.** It is on the live site, not in this branch — the live
  `client-portal.html` and `fundhub-brand.css` are byte-identical to this tree.
  One more data point for whoever chases it: `/api/health` reports `migrations 159, expected
  156`, so the live database is three migrations ahead of the deployed code.

---

## Baseline before any edit (main session, 2026-08-17)

Measured on `main` at `7be91a0`, working tree clean apart from untracked workflow docs.

- `npm run lint` — **clean**. `lint: 1283 file(s) and inline script(s) parse clean`
- `node --test src/http/crm-html.test.mjs src/http/consent-sign-pad-html.test.mjs` — **23 pass, 0 fail**

So anything red after the edit is caused by the edit. No pre-existing failures in the
two test files that touch this page.
