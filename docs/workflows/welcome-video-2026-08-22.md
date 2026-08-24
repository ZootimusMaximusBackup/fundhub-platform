# Portal welcome video — 2026-08-22

**Owner:** Chris  
**Worker:** this multitask thread (Composer / Fixer)  
**Audience:** client portal hero only (not staff CRM)  
**Brand:** FundHub  
**Constraint:** zero paid external tokens / APIs.

**Asset home (gitignored):** `credentials/welcome-video-2026-08-22/`  
**Do not commit** MP4 / WAV / AIFF into git.

---

## Owner decision (2026-08-22, interrupt)

Chris will **read the final script himself** and do the **video overlay in Loom / his own edit**.

- Voice cloning = nice-to-have, **not required** → **skipped**.
- **Chris records VO over the silent capture.**
- Agent priorities (locked):
  1. Finish/polish script + timed shot list on this board (**highest value**)
  2. Silent (or free `say` placeholder) screen-capture MP4 as B-roll
  3. Do not block on voice clone

**Owner add-on (same day):** B-roll must be **dynamic** (short beats, cursor clicks, mild zoom). Re-capture after Fix 1 (hide offer prices except $32) with greeting **Welcome back, John** and hero video already playing.

---

## What Chris needs right now

| Item | Path |
|------|------|
| **DONE — VO mux (master)** | `credentials/welcome-video-2026-08-22/welcome-portal-with-vo.mp4` (~1:19 natural) |
| **DONE — live hero** | Content video `bc191d8f-b011-4721-9d6d-320727761d60` mapped default; portal `readyState` 4 / ~79.2s |
| **Script + shot list** | this file → **Final script** (speakability rewrite) + timed shot list |

**Exact next click for Chris:** Open client portal → hit play on the hero → listen once (natural re-clone, not atempo).

---

## Task list

| # | Task | Owner | Status |
|---|------|-------|--------|
| A | Board + claim | worker | **done** |
| B | Final script + timed shot list | worker | **done** (owner-informed speakability rewrite; “tasks” removed) |
| C | Voice clone | worker | **done** — natural re-clone (XTTS engine speed 1.15 + sentence chunks; **not** ffmpeg atempo) |
| C′ | Free `say` placeholder (optional) | worker | **replaced** — first silent loop, then Chris-VO mux live |
| D | Live client-portal screen capture | worker | **done** (dynamic re-capture) |
| E | Silent B-roll MP4 for Chris overlay | worker | **done** (~110s dynamic) |
| F | Upload + prove hero | worker | **done** — VO mux uploaded + mapped; hero `readyState` 4 / ~109.3s |
| G | Fix 1 — hide offer prices except $32 | worker | **done** (live on fundhub.ai) |
| H | Fix 2 — John + video in hero for B-roll | worker | **done** (demo file first_name→John for recording) |

---

## Shared context

- Hero: `GET /api/content/welcome-video` on client portal
- Upload: Content admin → `POST /api/content/upload`
- Capture file: existing filled client `8556bedc-46e1-4d85-b0cd-a24adfee1521` — **first_name set to John for recording** (was TEST). Avery Cobalt still not seeded.
- Staff chrome hidden in capture CSS so the frame reads as client portal.
- Offer tiles on live portal: only **$32** soft pull shows a dollar amount; all other offers say **On your call**.
- Product is live. Do not touch `INNGEST_EVENT_KEY`.

---

## Final script (teleprompter — read this)

**Owner-informed FINAL (speakability rewrite)** (2026-08-22). **Supersedes all prior scripts on this board.**  
Chris flagged **“tasks”** as stiff / bad spoken; rewrite avoids that word and smooths other VO-awkward spots.  
**Title:** Welcome to your FundHub portal  
**Length:** ~90–110s at a natural pace  
**Tone:** warm, confident, one-to-one Loom. Short sentences. No swears. No credit-outcome guarantees.

Welcome to FundHub.

However you got here — you booked a call, you're already in funding, or your repair letters are out — this is your home base. Everything lives here.

Credit changed my life. It's why I could go do things instead of watching other people do them. I've seen it change how people run their business and how things feel at home. That's why this company exists.

Let me walk you through the screen.

Up top is your greeting and where your file is at. Check that first every time you log in.

Under that, the things we need from you. Anything waiting on your end shows up there. Hit those first. How fast you get funded pretty much comes down to how fast you clear them. If nothing's waiting on you, you're waiting on us — and we're already on it.

Middle of the page is your courses and resources. Some are included, some are upgrades. The labels tell you which. Start with whatever's unlocked.

Bottom corner — the chat button. Fastest way to reach us. Ask anything. Get your advisor. Get anyone on the team. Not sure what you have access to? Just ask. We'll point you to it.

Two things before you close this: bookmark this page, and save our number so our calls don't go to spam.

We're updating this portal all the time, so it'll keep getting better. For now, start with what's on your screen, and hit chat if you get stuck.

That's it. Let's get you funded.

**~190 words** → aim ~90–110s speaking. Dynamic B-roll ~110s — fits this read.

### Speakability word changes (owner-informed)

| Old | New | Why |
|-----|-----|-----|
| your tasks | the things we need from you | Chris: “tasks” sounds bad spoken |
| Do those first | Hit those first | more natural VO |
| how fast tasks get handled | how fast you clear them | drop second “tasks”; spoken rhythm |
| If nothing's assigned | If nothing's waiting on you | clearer one-to-one Loom |
| where your file stands | where your file is at | less stiff |
| Some come with what you have | Some are included | shorter; less formal |
| Ask anything — get your advisor, get anyone on the team | Ask anything. Get your advisor. Get anyone on the team. | shorter beats; clones pause cleaner |

---

## Timed shot list (DYNAMIC B-roll — read on your phone)

Picture: `welcome-portal-broll-silent.mp4` / `welcome-portal-broll-dynamic-silent.mp4` (~110s).  
Cuts every ~6–14s. Cursor clicks + mild zoom. Greeting shows **Welcome back, John**. Hero video is **already playing**. Offer prices: **$32 only**.

| t (s) | Say this beat (map to FINAL script) | What is on screen |
|------:|-------------------------------------|-------------------|
| 0–8 | Welcome + home base / however you got here | **Zoom:** “Welcome back, John” greeting — hold |
| 8–22 | Credit changed my life / why company exists | **Cut/zoom:** hero welcome video **playing** |
| 22–30 | “Walk you through” + greeting / file status | Scroll under greeting / start-here status |
| 30–48 | Things we need from you + funding speed | **Click/zoom:** to-dos / action card |
| 48–62 | Courses and resources | **Click:** courses / Unlock More tiles (labels; **$32** soft pull only) |
| 62–78 | Chat / ask anything | **Click:** chat open; type “Where do I start?” (not sent as PII) |
| 78–95 | Bookmark + save number | Back to top; chat button still visible |
| 95–110 | Portal updates + close / get you funded | Greeting + chat hold — freeze if VO finishes early |

---

## Voice (owner path)

**DONE (2026-08-22).** Free local Coqui XTTS-v2 clone — no paid APIs.

| Asset | Path / id |
|-------|-----------|
| Source memo | `~/Downloads/W Hudson Way 8.m4a` (Chris said “9”; only match on disk is **8**) |
| Sample copy | `credentials/welcome-video-2026-08-22/voice-sample.m4a` (+ `.wav`) |
| Cloned VO | `credentials/welcome-video-2026-08-22/welcome-vo-cloned.wav` (~79.1s) |
| Slow backup | `…/welcome-vo-cloned-slow-backup.wav` (~109s prior dirge) |
| Mux master | `credentials/welcome-video-2026-08-22/welcome-portal-with-vo.mp4` (~1:19) |
| Upload compress | `…/welcome-portal-with-vo-upload.mp4` (~2.7MB) |
| Live video id | `bc191d8f-b011-4721-9d6d-320727761d60` (default map) |

| Found | Verdict |
|-------|---------|
| `voice-sample.m4a` / `.wav` | **Chris** — ~34.2s; Whisper ASR portal walkthrough draft |
| Local Whisper ASR | Natural phrasing (“Up top… where you're files at”); no “tasks” |
| `voice.wav` / `voice.aiff` | **Not Chris** — old macOS `say` placeholder |

**Clone path used:** **natural re-clone, not atempo.** Coqui TTS 0.22 / XTTS-v2 on CPU; sentence chunks; engine `speed=1.15` + `temperature=0.85` (XTTS length-scale inside the synthesizer — pitch stays natural). No ffmpeg atempo / rate chipmunk. Mux onto silent B-roll (video trimmed to VO).

### After VO mux is approved

1. Already uploaded + mapped default (worker).
2. Chris: open client portal → play hero → one listen.
3. If clone is not good enough: record your own Loom over `welcome-portal-broll-silent.mp4` and re-upload.

---

## Progress log

| When | Note |
|------|------|
| 2026-08-22 | **Natural re-clone (not atempo):** prior VO was too slow/dirge. Re-ran free local XTTS with engine `speed=1.15` + sentence chunks + temp 0.85 → VO ~79.1s → mux/upload/map `bc191d8f-…` → portal hero readyState 4 / 79.2s. Atempo approach discarded. No paid APIs. |
| 2026-08-22 | **100% DONE (superseded — too slow):** sample `W Hudson Way 8.m4a` → XTTS clone → `welcome-portal-with-vo.mp4` → uploaded/mapped `71b956f0-…` → portal hero readyState 4 / 109.3s. Speakability rewrite kept. No paid APIs. |
| 2026-08-22 | **Sample + speakability:** found `~/Downloads/W Hudson Way 8.m4a` → `voice-sample.m4a`. Whisper ASR ok. FINAL script rewritten (drop “tasks”, etc.). Free local XTTS clone in progress. |
| 2026-08-22 | **Clone pass:** searched credentials/docs/home for Chris voice sample — none. `voice.wav`/`voice.aiff` are macOS-`say` only. **Stopped.** Chris must drop 30–60s memo → `credentials/welcome-video-2026-08-22/voice-sample.wav` (or `.m4a`). No paid APIs. |
| 2026-08-22 | Board + script created |
| 2026-08-22 | Capture + `say` mux + upload + hero proof (readyState 4, ~98.3s) |
| 2026-08-22 | **Owner interrupt:** Chris does VO/Loom; clone skipped; silent B-roll exported |
| 2026-08-22 | **Owner-set FINAL script** landed; shot list re-estimated for longer VO |
| 2026-08-22 | **Fix 1:** client portal hides list prices except **$32**; deployed live |
| 2026-08-22 | **Fix 2:** demo client first_name → **John**; silent hero loop uploaded + mapped; **dynamic** B-roll re-captured (~110s) |
| 2026-08-22 | **Owner-ready FINAL script** (natural Loom read, ~185 words / ~90–110s); supersedes prior; shot list re-timed |

---

## Change manifest

| Path | Change |
|------|--------|
| `public/app/client-portal.html` | Offer tiles/modal: only `$32` visible; others “On your call” |
| `e2e/client-portal-ux.spec.mjs` | Asserts hidden list prices except `$32` |
| `src/http/crm-html.test.mjs` | Unit proof for portal offer price hide |
| `docs/workflows/welcome-video-2026-08-22.md` | Speakability FINAL + **natural re-clone (not atempo)** |
| `credentials/welcome-video-2026-08-22/voice-sample.m4a` | Chris memo (from Downloads `W Hudson Way 8.m4a`) |
| `credentials/welcome-video-2026-08-22/welcome-vo-cloned.wav` | Natural XTTS VO (~79s; engine speed 1.15) |
| `credentials/welcome-video-2026-08-22/welcome-vo-cloned-slow-backup.wav` | Prior slow VO (~109s) |
| `credentials/welcome-video-2026-08-22/welcome-portal-with-vo.mp4` | Mux master (~1:19) |
| `credentials/welcome-video-2026-08-22/welcome-portal-with-vo-upload.mp4` | Compressed upload (~2.7MB) |
| Live content store | Welcome → `bc191d8f-b011-4721-9d6d-320727761d60` mapped default |

COMPLIANCE REVIEW REQUIRED — fee/pricing **display** on client portal offers changed (list prices hidden; soft pull $32 remains).
