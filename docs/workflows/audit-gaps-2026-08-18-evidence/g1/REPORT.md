# G1 — Partner walk (white-label)

Date: 2026-08-18  
Who: signed in as `partner@fundhub.ai` (partner), not the owner.  
Live site: https://fundhub.ai  
Ground truth: `docs/journeys/white-label-intended.md`  
Evidence: this folder (`proofs.json`, `follow.json`, `shots/`)  
Did not: turn marketing on, connect Facebook/Instagram/LinkedIn, send a post, run a paid creative job, open the live credit file.

Marketing is **already on** for this partner. The screen says On / Writing on. The “owner has not turned this on” line is hidden — that matches an on switch. I did not press Turn on.

Partner id from the session: `9defaf28-47c5-43a0-8f5e-f41ef90f360a`.

---

## What worked

**Sign in.** They land on Home (`/app/partner-galaxy.html`). Title: “Your Galaxy — Partner View.” Shot: `shots/02-landing.png`. HTTP 200.

**Left menu (after opening the groups).** Four rows. Each one opens. No bounce.

| Row | Result | Shot |
|---|---|---|
| Home | OPEN · 200 | `shots/81-partner-galaxy.html.png` |
| Social Studio | OPEN · 200 | `shots/82-social-studio.html.png` |
| Creative Factory | OPEN · 200 | `shots/83-creative-factory.html.png` |
| Brand Studio | OPEN · 200 | `shots/84-brand-studio.html.png` |

Expanded menu: `shots/80-nav-expanded.png`. No Content row.

**Content Admin.** No Content row in the menu. Typing `/app/content-admin.html` sends them back to Home. Shot: `shots/50-content-admin.png`.

**Keep-out pages.** Typing these URLs sends them back to Home (bounce). Shots 70–74.

| Page | Typed | Landed |
|---|---|---|
| Pipeline | `/app/pipeline.html` | Home |
| Finance OS | `/app/finance-os.html` | Home |
| Staff | `/app/staff-teams.html` | Home |
| Hiring | `/app/hiring.html` | Home |
| Client Control Panel | `/app/client-control-panel.html` | Home |

**Connect buttons.** Partner does **not** see Connect Facebook / Instagram / LinkedIn. The box says connecting is for the owner. Shot: `shots/90-social-after-queue.png`. That matches intended.

**Usage card.** Creative Factory shows tokens this month vs the 250,000 cap: used 1,458 · left 248,542 · cap 250,000. Shot: `shots/40-creative-factory.png`. HTTP 200 on `/api/partner-marketing/usage`.

**Turn-on switch.** Partner does not see “Turn on for this partner.” Hidden. Did not POST enable.

---

## FAIL

### 1. Partner cannot save colors or logo

- **Journey:** white-label · Brand Studio
- **Step:** Even with marketing on (and intended says colors/logo stay saveable when it is off), they should be able to save colors and a logo.
- **Expected:** Save writes the brand. Fields show the saved name.
- **Observed:** Name, legal entity, address, email, and domain are empty. The gray sample text looks filled in, but it is only placeholder text. Save says “Legal entity is required — it goes into every disclosure.” No save call went out. The same partner’s brand **does** exist on the server (legal name “E2E WL Click17 Co”, HTTP 200). The screen never loaded it.
- **Evidence:** `shots/21-brand-after-save.png`, `shots/85-brand-save-retry.png`, `follow.json` (empty fields + save message + partner-brand HTTP 200)
- **Kind:** built-wrong

### 2. Partner cannot put a new post in the queue, set a time, or throw one away

- **Journey:** white-label · Social Studio (marketing is on)
- **Step:** Write a post into a queue, set a time, or throw one away. Partner must not see a Connect button that will refuse them.
- **Expected:** They can queue, set a time, and discard. No dead Connect button.
- **Observed:** Connect buttons are gone (good). Queue post is still live. There are 0 connected accounts. Queue says “Pick an account to post to first.” The empty list still says “Connect Facebook, Instagram or LinkedIn just below” — and there is no button there. Three old drafts sit in Waiting. There is no Throw away / Discard control. Time box exists; nothing saved because queue never ran.
- **Evidence:** `shots/30-social-studio-full.png`, `shots/90-social-after-queue.png`, `follow.json`
- **Kind:** built-wrong

### 3. Creative “Enqueue” is on in the page but hidden

- **Journey:** white-label · Creative Factory (marketing is on)
- **Step:** Ads still generate through the factory. Usage card vs 250,000 cap.
- **Expected:** Partner can see the usage card. If enqueue is the queue write (not a Meta/Google send), they can reach it.
- **Observed:** Usage card is visible and correct (PASS above). The “Generate and decide” card is `display: none` (width and height 0). Enqueue generation is in the page, not on screen, and marked as if it were live. I did not click it. It would call the generate job, which can later hit a vendor.
- **Evidence:** `shots/40-creative-factory-full.png`, `shots/92-creative-enqueue.png`, `follow.json` (`cardDisplay: "none"`)
- **Kind:** built-wrong

### 4. Home shows a public page that is not live

- **Journey:** white-label · live public page
- **Step:** When marketing is on, live pages sit at `/sites/{partnerId}/{slug}`. Open that URL if a published page exists.
- **Expected:** A published page answers 200, or the screen does not call a draft “your page.”
- **Observed:** One page on file: slug `apply`, status **draft**. Pages live = 0. GET `https://fundhub.ai/sites/9defaf28-47c5-43a0-8f5e-f41ef90f360a/apply` is **404**. The page text is “This page is not published.” Home still shows that URL as “Your page.” No custom domain is connected. The domain box is empty (sample text only). Publish is on in Brand Studio; I did not press it.
- **Evidence:** `shots/02-landing.png`, `shots/60-public-_sites_9defaf28-47c5-43a0-8f5e-f41ef90f360a_apply.png`, `proofs.json` (`pagesHttp` 200, `liveGets` 404)
- **Kind:** built-wrong

---

## MISSING ground truth

Intended does not name the Home HTML screen. We recorded where they land. We did not score the star sky on Home (sales, inquiry, cash today). That picture may be staff-shaped. No written rule for what a partner should see there.

Intended lists Campaigns as API routes a partner can reach. The partner menu has no Campaigns row. No written rule for that HTML row. Not scored.

---

## What I did not click

- Turn on / Turn off marketing
- Connect Facebook / Instagram / LinkedIn
- Write page copy / Make a wordmark (writing robot)
- Publish
- Enqueue generation / Run queued jobs now
- Send anything due now

---

## Score (board items only)

| Board item | Result |
|---|---|
| Sign in + where they land | PASS (Home) |
| Every visible menu row OPEN vs BOUNCE | PASS (4 OPEN) |
| Brand save colors/logo | FAIL |
| Write copy / wordmark / publish on or off | Observed **on** (marketing is on). Off-message hidden. |
| Social queue / time / throw away | FAIL |
| No Connect button that will refuse them | PASS |
| Creative usage card vs 250000 | PASS |
| Enqueue | Hidden. Did not click. FAIL as a usable control |
| No Content row | PASS (missing + bounce) |
| Live `/sites/{id}/{slug}` | 404 · draft · FAIL as “your page” |
| Stay out of Pipeline / Finance OS / Staff / Hiring / Client Control Panel | PASS (all bounce) |
