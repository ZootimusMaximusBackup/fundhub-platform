# T11 — live re-walk on https://fundhub.ai (2026-08-19, 10:46–10:52 UTC)

Read-mostly walk. Every non-GET `/api/**` was refused by the driver except the two writes the
task allowed: Brand Studio **Save** and Social Studio **Write 3 posts for me**.
Not done: no Creative "Enqueue"/"Generate" click, no social publish, no
`POST /api/partner-marketing/enable` (the owner flip was **not** performed).

Accounts used: `partner@fundhub.ai` (partner id `9defaf28-47c5-43a0-8f5e-f41ef90f360a`,
"TEST — White-Label Partner Role") and `owner@fundhub.ai`. One login per role, no 429 seen.

| ITEM | VERDICT | One-line proof | Artefact |
|---|---|---|---|
| T11-01 Brand Studio fields never fill; Save refuses | **STILL BROKEN** | All five boxes are `value:""` with only a grey placeholder, the page throws `FHData is not defined`, **no `/api/partner-brand` GET is ever made**, and Save answers "Legal entity is required" with **zero network writes** — while the server holds `entity_name: "E2E WL Click17 Co"` | `01-brand-result.json`, `01-brand-network.json`, `01-brand-api-direct.json`, `01-brand-fields-before.png`, `01-brand-fields-after-save.png` |
| T11-02 Social Studio unusable for a partner | **STILL BROKEN (in part)** | 0 of 8 accounts connected, `#cChannel` holds one option `— connect an account first —`, a partner sees **no Connect button at all**, and 6 drafts sit in "Waiting to post" with **no discard control** and a literal `undefined` in the TRIES column | `02-social-result.json`, `02-social-full.png`, `02-social-queue-post.json` |
| T11-02b "Write 3 posts for me" hangs / never produces a draft | **ALREADY FIXED** | As partner it returned `200` in **9.5 s**, wrote 3 drafts and said "Wrote 3 posts. They are in the waiting list below." | `02-social-generate.json`, `02-social-after-generate.png` |
| T11-03 Creative Factory "Generate and decide" card invisible to a partner | **STILL BROKEN** | The card is `display:none` with `data-fh-gated="1"`; it contains a prose link `<a href="campaign-manager.html">Campaigns</a>` (`public/app/creative-factory.html:463`) and `public/app/shell.js:1201-1204` hides `a.closest('.card')` for any screen the role may not open — the whole primary-action card goes with it. The writing-budget card is visible and `CF_SUITE.enabled === true` | `03-creative-card-computed.json`, `03-creative-why-hidden.json`, `03-creative-full.png` |
| T11-04 Same screens as owner | **owner is fine** | Owner's Enqueue card is `display:block`, 189×40 button, `CF_SUITE.enabled true`; owner also sees Connect Facebook / Instagram / LinkedIn, which the partner does not | `04-owner-creative-computed.json`, `04-owner-creative-full.png`, `04-owner-social-result.json`, `04-owner-social-full.png` |
| T11-04b Facebook OAuth start | **STILL BLOCKED (expected, honest)** | `GET /api/social/oauth?action=start&channel=facebook&partner_id=…` → **503** `{"error":"not_configured","missing":["META_APP_ID"]}` | `04-oauth-facebook.json` |
| EXTRA Campaign Manager boot | **ALREADY FIXED / not broken** | Loads clean as owner; after picking a partner it reports **"5 of 5 panels loaded"** and all six campaign reads answer 200 | `05-campaigns-after-pick.json`, `05-campaigns-after-pick.png`, `05-campaigns-full.png` |

---

## T11-01 detail — Brand Studio as partner

`https://fundhub.ai/app/brand-studio.html`

Page state read live:

* `window.__fhBrandMode` = `"partner"`
* `window.__fhBrandPartnerId` = `"9defaf28-47c5-43a0-8f5e-f41ef90f360a"` (correct)
* `window.D` = `{name:"", entity:"", addr:"", email:"", domain:"", …}` — the draft is empty
* Uncaught page error: **`FHData is not defined`** (one, at load)

Fields (id · value · placeholder):

| id | value | placeholder |
|---|---|---|
| `bName` | `""` | Meridian Capital Partners |
| `bEntity` | `""` | Meridian Capital Partners LLC |
| `bAddr` | `""` | 1200 Main St Suite 400, Phoenix, AZ 85004 |
| `bEmail` | `""` | support@meridiancapital.com |
| `bDomain` | `""` | meridiancapital.com |

So the boxes only *look* filled — every one is genuinely empty and what shows is placeholder text.

Network on load: **no `/api/partner-brand` call is made at all.** The only brand call is
`GET /api/org-brand 200` (fired twice, by data.js, not by this screen).

The data exists. Fetched directly with the same partner token:

```
GET /api/partner-brand?partner_id=9defaf28-… -> 200
{"ok":true,"brand":{"entity_name":"E2E WL Click17 Co", "ink":"#0A0A0A", "paper":"#FCFCFC", …}}
GET /api/partner-brand (no id)               -> 400 {"error":"partner_id_required"}
```

Pressing **Save & apply**: message shown is

> `Legal entity is required — it goes into every disclosure.`

and **no network request left the browser** (`01-brand-save-network.json` is `[]`, and the
driver's blocked-write list is empty too — nothing was even attempted).

Cause, from the code: the persistence IIFE is an inline `<script>` that runs during parsing,
before the `<script defer src="data.js">` above it has executed, so `FHData` is not defined when
`FHData.wire(FHData.brand(partnerId), …)` runs at `public/app/brand-studio.html:1302`. The throw
kills hydration; the fields stay empty; the Save validator then correctly refuses an empty entity.

Side observation (not in the task list): the BS-06 chip reads **"On"** while the paragraph under
it still reads *"The owner has not turned this on yet."* — `/api/partner-marketing/usage` says
`enabled:true`. Two answers to one question on the same card.

## T11-02 detail — Social Studio as partner

* Connected-accounts tile: **"0 of 8 · 0 can post · 0 cannot"**.
* `#cChannel` options: exactly one — `{value:"", label:"— connect an account first —"}`.
* Connect buttons: **none visible to a partner.** `#oauthFb`/`#oauthIg`/`#oauthLi` are not in the
  partner's visible-button inventory. The screen's own words contradict each other:
  * empty state says *"Nothing can be written or queued until there is one. Connect Facebook,
    Instagram or LinkedIn just below."*
  * and just below: *"Connecting Facebook, Instagram, or LinkedIn is for the owner once those
    apps are set up. You can still write and queue posts here."*
* Waiting list: 6 drafts, all status `draft`, table says "6 OF 6 POSTS MATCH YOUR FILTER".
  **No discard / delete / archive control exists on any row** — the only row control is the `▸`
  expander. Page-level buttons are: Write 3 posts for me, Check the wording, Queue post,
  Send anything due now, Clear the form.
* The TRIES column renders the literal word **`undefined`** ("no time set / undefined / of 3").
* Approval card: shows **"SETTING NOT READ"** — confirmed present (`settingNotRead: true`), for
  the partner *and* for the owner.
* **Queue post** with topic chosen and 64 characters typed → message
  `Pick an account to post to first.` and **no network call**. Honest refusal, correct behaviour
  given zero accounts.
* **Write 3 posts for me** → `POST /api/social/generate 200` in **9.5 s**, three drafts returned,
  message `Wrote 3 posts. They are in the waiting list below.`, list grew from 6 to 9.
  This does **not** reproduce as a hang.

## T11-03 detail — Creative Factory as partner

Ancestor chain of `#genBtn` ("Enqueue generation"), computed live:

| # | element | display | visibility | offsetW×H |
|---|---|---|---|---|
| 0 | `button#genBtn.btn.dark.mono.fh-tap` | block | visible | 0 × 0 |
| 1 | `div` (flex row) | flex | visible | 0 × 0 |
| 2 | `div.card-bd` | block | visible | 0 × 0 |
| 3 | **`div.card`** | **none** | visible | 0 × 0 |
| 4 | `div.content.fh-maxw` | block | visible | 1212 × 2527 |
| 5 | `div.main` | flex | visible | 1212 × 2637 |
| 6 | `div.app` | flex | visible | 1440 × 2637 |
| 7 | `body` | block | visible | 1440 × 1000 |

The hidden element is ancestor **#3, the whole "Generate and decide" card**, and it carries
`data-fh-gated="1"` — the stamp `public/app/shell.js:1201-1204` puts on a box it hides:

```js
var box = a.closest("li") || a.closest(".card") || a;
if (!allowed) { box.style.display = "none"; box.setAttribute("data-fh-gated", "1"); }
```

The anchor that triggered it is inside that card, in prose:
`public/app/creative-factory.html:463` — *"Spend and fatigue live on
[Campaigns](campaign-manager.html)."* A partner may not open `campaign-manager.html`, so the link
is gated, and the gate takes the entire card — including the screen's primary action — with it.

The same card also holds the "Decide on one creative" row (Approve / Reject / Archive,
`creative-factory.html:453-457`), so a partner loses those three controls too. The screenshot
`03-creative-full.png` shows "Writing budget" running straight into "Generation jobs" with
nothing between them.

Also read live:

* `#genBtn` is present and `disabled: false` — it is not disabled, it is unreachable.
* Writing-budget card **is visible**: "WRITING BUDGET · ON · USED 1933 · LEFT 248067 · CAP 250000".
* `window.CF_SUITE` = `{enabled:true, remaining:248067, cap:250000, used:1933, loaded:true, error:null}`.
* `GET /api/partner-marketing/usage?partner_id=9defaf28-…` → `200`
  `{"ok":true,"enabled":true,"cap":250000,"used":1933,"remaining":248297}`.

Enqueue and Generate were **not** clicked.

## T11-04 detail — owner

* **Creative Factory**: the same `div.card` is `display:block`, the button measures 189×40 and is
  enabled. `CF_SUITE.enabled true`, budget 244 used of 250000. The card renders for owner.
* **Social Studio**: owner sees `#oauthFb` "Connect Facebook", `#oauthIg` "Connect Instagram",
  `#oauthLi` "Connect LinkedIn" plus the LinkedIn organisation-id box. `#cChannel` still has the
  single `— connect an account first —` option; connected accounts 0 of 8. Approval card still
  reads **SETTING NOT READ**.
* **OAuth start** (`04-oauth-facebook.json`):

```
GET /api/social/oauth?action=start&channel=facebook&partner_id=9defaf28-… -> 503
{"ok":false,"error":"not_configured","missing":["META_APP_ID"],"message":"META_APP_ID unset — see docs/STILL-MISSING.md"}
```

This is the honest, expected refusal. No code change fixes it — `META_APP_ID` is unset.

## EXTRA — Campaign Manager as owner

Loads clean. With no partner picked it says *"No partner selected — pick a partner from the list
to see their ads"* and every tile reads `—` with the same reason. After picking
"DEMO Partner — Northlight Capital":

* footer reads **"5 of 5 panels loaded"**
* `GET /api/campaigns/{spend,list,connections,fatigue,action-log}` → all `200`
* no console errors, no page errors

The screen is **not** dead. It shows zeros because that partner has no campaign rows, and it says
so in words rather than inventing any. The "boot block is broken" line in the bug table does not
reproduce on live.

## Writes performed during this walk

1. `POST /api/social/generate` (partner) — created 3 draft social posts for
   `9defaf28-47c5-43a0-8f5e-f41ef90f360a`. Task-authorised. 230 tokens of that partner's monthly
   allowance were consumed (1703 → 1933).
2. Brand Studio Save — **no write actually went out**; the screen refused before calling.

Nothing else was written. `POST /api/partner-marketing/enable` was **not** called.
