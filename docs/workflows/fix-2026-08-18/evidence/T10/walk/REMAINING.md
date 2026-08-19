# T10 — live re-walk, remaining items

Target: **https://fundhub.ai** (live). Not localhost.
Walked 2026-08-19, ~10:50–11:02 UTC, branch `fix/T10-affiliate-partner` (worktree `/tmp/wt-T10`).

**Read-only.** Every non-GET `/api/**` request was intercepted in the browser and answered `599`
before it left the machine. Nothing was published, connected, saved, sent, charged or pulled.
Confirm dialogs were dismissed, never accepted. The only POST allowed through was `/api/auth/login`.

Paths below are relative to the repo root.

---

## Verdict table

| Item | What was checked | Artefact | Verdict |
|---|---|---|---|
| T10-01 | Partner Home advertises a 404 apply URL | `…/T10-01-site-apply-headers.txt`, `-body.html` | **STILL BROKEN** (proved by the earlier run, not redone) |
| T10-02 | Partner Home makes no money read | `…/T10-02-partner-galaxy-tiles.json` | **STILL BROKEN** (earlier run, not redone) |
| T10-03 | `/start?ref=AFF-000001` still resolves | `…/T10-03-start-ref-headers.txt` | **PASS** (earlier run, not redone) |
| T10-04 | Affiliate tiles + funnel, both roles, em dashes | `…/T10-04-affiliate-as-owner.json`, `…/T10-05-affiliate-as-affiliate.json` + PNGs | **STILL BROKEN** — em dashes reproduce for both roles |
| T10-05 | Full affiliate walk **as an affiliate** (never done before) | `…/T10-05-affiliate-as-affiliate.*`, `docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/` | **STILL BROKEN** — 3 new defects recorded below |
| T10-06a | Social Studio as partner, zero connected accounts | `…/T10-06a-social-studio-interact.json`, `…/T10-06a-social-studio-partner.*` | **STILL BROKEN** — the screen contradicts itself and there is no way out |
| T10-06b | Creative Factory "Generate and decide" card invisible | `…/T10-06b-creative-factory-hide.json`, `…/T10-06b-cf-gated-confirm.json` | **STILL BROKEN — cause found, see below** |
| T10-07 | Galaxy opens and stays open for owner; closer bounced | `…/T10-07-galaxy-dwell-owner.json`, `…/T10-07-galaxy-dwell-closer.json` | **PASS** (do-not-break item intact) |

---

## T10-06b — THE HIDDEN CARD. Cause found.

**It is not a CSS rule. Nothing in any stylesheet hides it.** The earlier code-scouting pass
searched for the wrong thing, which is why it came back empty.

The card carries an **inline `style="display: none;"` that JavaScript writes at runtime.**

Measured live as `partner@fundhub.ai` (`T10-06b-creative-factory-hide.json`):

- the `.card` ancestor of `#genBtn` has `inlineStyleAttr: "display: none;"`, computed `display: none`, height 0
- all 379 CSS rules across all 7 stylesheets were enumerated and tested with `el.matches()`
- **`cardMatchesSettingDisplay: []`** — not one CSS rule that matches this element sets `display`
- the served `public/app/creative-factory.html` is byte-identical to HEAD
  (`sha256 5c4f50f0…632029` both live and in the worktree), so the attribute is not in the markup

### The exact rule and file

**`public/app/shell.js`, function `gateLinks()`, lines 1200–1204:**

```js
var box = a.closest("li") || a.closest(".card") || a;
if (!allowed) {
  box.style.display = "none";
  box.setAttribute("data-fh-gated", "1");
}
```

`gateLinks()` loops over **`document.querySelectorAll("a[href]")` — every anchor on the page**, not
just sidebar nav rows. For any anchor pointing at a screen this role may not open, it hides the
anchor's nearest `li` **or `.card`**. It cannot tell a nav row from a paragraph of body copy.

### The anchor that trips it

`public/app/creative-factory.html` line 463, inside the "Generate and decide" card
(the card spans lines 420–465):

```html
fatigue live on <a href="campaign-manager.html" style="text-decoration:underline">Campaigns</a>.
```

That is one prose cross-reference in a caption. It is the card's only anchor.

`campaign-manager.html` is deliberately **not** in `ROLE_TABS.partner`
(`shell.js:369` — `["partner-galaxy.html", "brand-studio.html", "social-studio.html",
"creative-factory.html"]`), an owner-set decision recorded at `shell.js:340–368`.

So: a deliberate nav decision silently deletes the screen's primary action.

### Confirmed live, end to end

`T10-06b-cf-gated-confirm.json` — the only non-nav element carrying `data-fh-gated` on the whole
screen:

```json
{ "tag": "div", "class": "card", "eyebrow": "Generate and decide",
  "culpritHref": "campaign-manager.html", "culpritText": "Campaigns",
  "inlineDisplay": "none" }
```

### Why it matters

The same run shows this partner's writing budget is **on**: `On? Yes`, `Used this month 1933`,
`Left 248067`, and `#genBtn.disabled === false`. Everything is switched on and working. The partner
simply cannot see the controls. There is no error, no explanation, no empty state — the card is
just gone.

### Blast radius — checked, and it is small

Walked all four partner tabs as `partner@`. `creative-factory.html` is the **only** screen with a
gated content card:

| Screen | Gated content cards | Artefact |
|---|---|---|
| `creative-factory.html` | **1 — "Generate and decide"** | `T10-06b-cf-gated-confirm.json` |
| `social-studio.html` | 0 | `T10-06a-social-studio-partner.json` |
| `brand-studio.html` | 0 | `T10-06-blast-brand-studio.json` |
| `partner-galaxy.html` | 0 | `T10-06-blast-partner-galaxy.json` |

The latent trap remains for every role: any prose link inside a `.card` pointing at a screen that
role cannot open takes the whole card down.

**No fix was written.** This run was a walk; CLAUDE.md §3 wants a plan approved before code.

---

## T10-06a — Social Studio as partner, zero connected accounts

`T10-06a-social-studio-interact.json` records five steps. Exact strings as shown on screen.

**Connected accounts: `0 of 8` · `0 can post · 0 cannot`. Waiting to post: `9`.**

### Is a Connect button visible? **No. There is none.**

`#oauthFb`, `#oauthIg`, `#oauthLi`, `#liOrg` and `#oauthMsg` are **absent from the live DOM** —
queried at every one of the five steps, all `null`. They are in the markup
(`social-studio.html:461–463`) but `social-studio.html:2004–2007` deletes them for this role:

```js
var box = document.getElementById('oauthConnectBox');
if (box && role === 'partner') {
  box.innerHTML = 'Connecting Facebook, Instagram, or LinkedIn is for the owner once those apps are set up. You can still write and queue posts here.';
}
```

### The screen contradicts itself in two places, one directly above the other

Empty state, "Connected accounts" card:

> No social accounts are connected yet. Once one is, it will show here.
> Nothing can be written or queued until there is one. **Connect Facebook, Instagram or LinkedIn just below.**

Immediately below it, "Not connected yet" card:

> Connecting Facebook, Instagram, or LinkedIn is for the owner once those apps are set up. **You can still write and queue posts here.**

One tells the partner to connect an account just below; there is no control below to do it.
The other says they can still queue; they cannot.

### Trying to queue a post

Clicked "Write a post", typed a caption, set "Send at" to `2026-09-01T10:00`, clicked **Queue post**.

- **Exact refusal: `Pick an account to post to first.`**
- Zero network requests. Nothing was intercepted, because the handler returns before it fetches.
- The account dropdown has exactly one option: `— connect an account first —`
- **"Queue post" is enabled the whole time** (`disabled: false`, 117×42) even though it can never
  succeed in this state.
- The refusal names a step the partner has no way to perform.

### Discarding

**Clear the form** — no dialog, no request, form cleared. Fine.

### "Send anything due now"

Confirm dialog (**dismissed, nothing sent**):

> Publish every post that is already due for TEST — White-Label Partner Role?
>
> They go out on that partner's connected social accounts right away, in public. Posting cannot be undone from this screen.

Good confirm — it names the consequence. After dismissal: `Nothing was published.`
It is still offered on a partner with zero connected accounts and 9 posts waiting.

### Other empty-state wording captured

- `Set your posting times once an account is connected. All times are UTC.`
- `No post has been refused for this partner and filter.`
- `Nothing has failed. This screen cannot yet see posts that were actually sent, so this list stays empty.`
- `This screen cannot yet see posts that went out. There are no like, view or click figures anywhere in the system.`
- `No send attempts have been recorded for this partner yet.`

---

## T10-04 — affiliate tiles and funnel, both roles

Em dashes **still reproduce**, identically for both roles.

| Tile | as `affiliate@` | as `owner@` | Sub-label (identical both roles) |
|---|---|---|---|
| CLICKS 30D | `—` | `—` | (in the referral-link card) |
| REFERRED | `—` | `—` | `lifetime leads · comes from your referral tracking, not connected to this page yet` |
| CONVERTED | `—` | `—` | `comes from your referral tracking, not connected to this page yet` |
| OWED | `$0.00` | `$0` | `accrued, not yet paid` |
| PAID | `—` | `—` | `lifetime · comes from past payout runs, not connected to this page yet` |

Note: the fourth tile is **OWED**, not CLICKS. CLICKS 30D is a separate tile (`#affClicks`) in the
referral-link card above. So four of the five numbers on this screen are em dashes.

Funnel, headed `LIFETIME · CLICK TO FUNDED`:

> Nothing to show yet. Clicks, sign-ups and funded deals are not connected to this page, so it cannot count them.

Leads table: `No referrals on file`. Total row: `—`.

**OWED differs by role** — `$0.00` as the affiliate, `$0` as the owner. The owner is seeing the
hardcoded markup default because no affiliate resolves for an owner session; the affiliate is seeing
a real loaded value. Two different strings for the same tile.

---

## T10-05 — the affiliate area walked **as an affiliate** (first time ever)

`T10-05-affiliate-as-affiliate.json` plus a full click sweep in
`docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/`.

Login lands directly on `/app/affiliate.html`. Role `affiliate`. HTTP 200, no failed reads, no
console errors. Nav is correctly reduced to a single row (`Affiliate`); 31 rows and 8 groups hidden.

Click sweep: 8 controls, 7 `OK`, 1 `NOOP`. No forbidden control, no failed call, no dead control.

### What a real affiliate actually sees

- Badge `LICENSE UNSIGNED`, and: `Payouts are held — your partner license is not signed` /
  `Accrued payouts stay on file until the license is signed.`
- Referral code `AFF-000001`, `RATE Per agreement`, `COOKIE 60d`
- Four of five numbers are `—` (above)
- Company Brain card with an `Ask` box, Partner gift download, three tabs
  (Referred leads / Payouts / Terms)

### New defects, not recorded anywhere before

**1. The screen is almost entirely dashes and disclaimers.** Every number that would tell an
affiliate whether they earned anything is `—`, and three separate sub-labels say the page is "not
connected". A referral link that works (T10-03: `/start?ref=AFF-000001` → 200) feeds a page that
can never show a result. The affiliate has no way to tell a real zero from a broken pipe.

**2. There is no way to sign the license from the screen that blocks on it.** The page says payouts
are held until the license is signed, then offers no control to sign it. Every visible control
(Copy link, Copy code, Ask, Download Message Blaster, three tabs) is unrelated. Dead end.

**3. `Referred leads` tab is a NOOP.** It is the already-active tab and clicking it changes nothing
(`clicks/06-NOOP-Referred_leads.png`). Low severity — it renders as selected — but it is the only
NOOP in the sweep.

### Checked and clean

- **`Ask` (Company Brain) is correctly gated, not a forbidden control.**
  It POSTs `/api/read/company-brain-affiliate`. That handler
  (`api/read/company-brain-affiliate.mjs:28–34`) calls
  `requirePrincipal(req, res, ["affiliate", "partner"])` then
  `requireRole(res, { role }, new Set(["affiliate","partner"]))` — the affiliate is admitted.
  With an empty box it answers `Type a question first.` and sends nothing. Wired and allowed.
- `Download Message Blaster` → `GET /api/gifts/message-blaster` → 200.
- No horizontal overflow at 390 px.

---

## T10-07 — do-not-break check. **PASS.**

`/app/galaxy.html` sampled at five points over ~20 s after network idle.

- **`owner@`** — HTTP 200, stays on `/app/galaxy.html` for all five samples, title
  `Fundhub — Galaxy`, no failed reads. `stayedOnGalaxy: true`.
- **`closer@`** — bounced to `/app/closer-dashboard.html`, title `Fundhub — Closer Dashboard`, and
  stays there for all five samples. `stayedOnGalaxy: false`.

Both behave as intended. Nothing here regressed.

---

## State of the tree at hand-off — READ THIS BEFORE CHECKING LINE NUMBERS

**Every line number in this document points at `HEAD` (`origin/main` c860b8c), not at the current
working tree.** That is deliberate: `HEAD` is what was live while I walked, proved by hash —

| File | `HEAD` sha256 | live fundhub.ai sha256 | |
|---|---|---|---|
| `public/app/creative-factory.html` | `5c4f50f0…632029` | `5c4f50f0…632029` | identical |
| `public/app/social-studio.html` | `888e22bc…38f0a7` | `888e22bc…38f0a7` | identical |

**While this walk was running, another session edited this same worktree.** I did not make those
edits and I did not revert them. Nine tracked files are now modified and several new files added
(migrations `235`/`236`, `api/public/affiliate-click.mjs`, four tests). My own writes were confined
to `docs/workflows/fix-2026-08-18/evidence/T10/` and
`docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/`.

Two of those concurrent edits land on findings above:

- **T10-06b symptom fixed, root cause NOT.** `creative-factory.html:463` no longer carries the
  anchor — it now reads `fatigue live on the Campaigns screen.` as plain text. That makes the
  "Generate and decide" card visible again. But **`public/app/shell.js` is unmodified** and
  `shell.js:1201` still reads `var box = a.closest("li") || a.closest(".card") || a;`. The trap is
  intact: the next prose link dropped into any `.card` pointing at a screen the current role cannot
  open will silently delete that whole card again, with no error and no empty state.
- **T10-06a contradiction fixed.** The connected-accounts empty state was rewritten and is now
  role-aware and truthful (`Posts can still be written, given a send time and thrown away without
  one… Connecting Facebook, Instagram or LinkedIn is the owner's job, once those apps are set up.`).
  It no longer points at a Connect button that is not there.

Neither fix has been verified live — they are uncommitted and undeployed. The verdicts in the table
above describe **the live site as walked**, which is the honest answer to "does this still
reproduce".

---

## Incidental — noted, not acted on

`brand-studio.html` as `partner@` throws a console error on load:
**`pageerror: FHData is not defined`** (`T10-06-blast-brand-studio.json`). Outside T10's scope;
recorded so it is not lost.
