# The exact contracts a builder needs, and what is still missing

Written 2026-09-07. Read-only pass. Nothing in the repo was changed except this file.

**Who this is for.** Another model will be handed a build spec for the ad-script
generator. It must not guess any of the shapes below. Every block here is copied out of
the real file, with the line numbers, so it can be checked.

**The one thing to know first.** The half-finished build of 2026-09-06 is better than it
looks. The database change is exactly the one column the plan asked for, and `filmed_at`
was correctly left out. Most of it should be KEPT. Two things were never made at all, and
one thing was made in a shape a builder cannot use.

---

## Verdicts, one line each

| File | Verdict | Why |
|---|---|---|
| `db/migrations/301_creative_copy_text.sql` | **KEEP** | One nullable column plus one blank-string guard. No `filmed_at`. Exactly the spec. |
| `src/creative/generate.mjs` (the `copy_text` change) | **KEEP** | Writes the words in the same insert as the row, before the screen runs, so blocked ads keep their text. |
| `api/creative/library.mjs` (the `copy_text` select) | **KEEP** | Selects the words, never selects the file key. The header explains why the two are different. |
| `public/app/creative-factory.html` (offer picker) | **KEEP** | Adds the missing "what is being sold" box and puts it inside `spec`, which is the only place the screen can read it from. |
| `api/creative/generate.mjs` | **FIX** | Its own fallback spec still has no offer type. See §4. This is the same bug the screen fix was meant to close, one layer down. |
| `scripts/ads/check-script.mjs` | **FIX** | Good checks, but it exports nothing and calls `process.exit` at the bottom of the file, so no test can ever import it. See §8. |
| `docs/ads/RULES.md` | **KEEP** | 562 lines, three ad types, the word-count bands and the cause-first test that existed nowhere before. |
| `docs/ads/VOICE.md` | **NEVER MADE** | See §7. |
| `.cursor/skills/fundhub-ad-writer/SKILL.md` | **NEVER MADE** | See §7. |

---

## 1. `api/read/partners.mjs` — the company picker

### What calls it

`public/app/creative-factory.html:1030`

```js
FHData.partners({ limit: 200 }).then(function(res){
```

`public/app/data.js:301` turns that into the request:

```js
partners:        function (p) { return this.read("partners", p); },
```

So the wire request is `GET /api/read/partners?limit=200`, with the sign-in token in the
`Authorization` header.

### The exact request shape

* Method must be `GET`. Anything else is `405 {"ok":false,"error":"method_not_allowed"}`.
* `?limit=` — default 50, ceiling 200. Over 200 is quietly cut to 200, not an error.
* `?offset=` — default 0.
* `?status=` — optional. Passed straight to `v.status`.
* `?partner_id=` — **ignored here.** This endpoint is not partner-scoped by query
  string. (That is `partner-read-api.mjs`, a different file.)

### The exact response shape

The envelope comes from `page()` in `src/http/read-api.mjs:114-118`:

```js
export function page(rows, { limit, offset }) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { count: items.length, limit, offset, hasMore, items: redact(items) };
}
```

and `readHandler` wraps it at line 266:

```js
return res.status(200).json({ ok: true, ...page(rows, { limit, offset }) });
```

So the body is:

```json
{ "ok": true, "count": 3, "limit": 200, "offset": 0, "hasMore": false, "items": [ … ] }
```

Each item is exactly the nine columns in the SELECT, `api/read/partners.mjs:52-53`:

```sql
SELECT v.partner_id AS id, v.slug, v.name, v.status, v.revenue_share_pct,
       v.agreement_signed, v.balance_accrued, v.total_paid, v.open_accruals
```

Note `id` is the partner id, aliased. That is the value the picker stores and sends back
as `partner_id` on the generate call (`creative-factory.html:2302`).

### Owner login versus partner login

Two different people reach this and they get two different answers.

**An owner (or `admin`, or `sales_manager`).** The role gate is `ROLE_SETS.FINANCE`,
`src/http/read-api.mjs:137`:

```js
FINANCE: new Set(["owner", "admin", "sales_manager"]),
```

For staff, `scopeFor` returns no filter at all — `src/partners/scope.mjs:60-63`:

```js
if (kind === "staff") {
  // fundhub staff see the whole book, direct and partner alike.
  return { sql: "TRUE", params: [], unrestricted: true };
}
```

So an owner gets **every partner in their own company**, filtered only by the org check at
line 55:

```sql
WHERE (${orgHole}::boolean OR v.org_id = ${orgIdHole}::uuid)
```

`orgIdHole` is bound from the session at line 49:

```js
params.push(isPartner ? null : ((staff && staff.org_id) || null));
```

**Watch this one.** A staff session with no company on it binds `NULL`, and `v.org_id =
NULL` matches nothing. The owner then sees an empty list with a `200 OK` and no error
message anywhere. The file says this is on purpose ("it fails CLOSED", line 43). A builder
must not read an empty list as "there are no partners".

**A partner login.** `principal.kind === "partner"`, so line 47 pushes `true` into the org
hole, which short-circuits the org check, and the scope predicate does all the work:

```js
const scope = scopeFor(principal, { alias: "v", startIndex: 2 });
```

which becomes `v.partner_id = $3`. A partner gets **their own single row and nothing
else** — one item, or zero.

**Everyone else.** A `closer`, `funding_advisor`, `setter` or `inquiry_specialist` gets
`403`:

```json
{"ok":false,"error":"forbidden","message":"this endpoint is limited to owner, admin, sales_manager"}
```

A client or affiliate session gets `403 {"ok":false,"error":"forbidden","message":"this endpoint serves staff, partner"}`.
No token at all is `401 {"ok":false,"error":"unauthorized"}`. Database unreachable is
`503 {"ok":false,"error":"auth_unavailable","db":"down"}`.

### When there are none

**It is a 200, never a 404.** The body is:

```json
{ "ok": true, "count": 0, "limit": 200, "offset": 0, "hasMore": false, "items": [] }
```

The picker already handles that, `creative-factory.html:1042-1048`: it prints
`No partners on file`, greys the box out, and issues no creative request.

---

## 2. `src/compliance/screen.mjs` — the gate

### The exact signature

`src/compliance/screen.mjs:83`

```js
export async function screen(db, subject = {}) {
```

`db` may be a plain connection or a scoped transaction. `src/creative/generate.mjs:252`
hands it the RLS transaction `tx`.

### What it expects in the subject

The file documents it itself, lines 70-82:

```js
/* screen(db, subject) → { state, reasons[] }

   subject: {
     orgId, partnerId,          — required
     kind,                      — 'creative_asset' | 'campaign' | 'ad' | 'social_post'
     offerType,                 — funding | credit_cards | credit_repair
     platform,                  — meta | tiktok | google | null for an unplaced asset
     text,                      — the copy to screen
     targeting,                 — campaign payloads only
     hasDisclosureAsset,        — credit_repair funnels
     aiGenerated, syntheticPerformer,
     approveBeforeLaunch        — the partner setting; defaults ON
   } */
```

Defaults, from lines 103-110: `kind = "creative_asset"`, `platform = null`, `text = ""`,
`hasDisclosureAsset = false`, `aiGenerated = false`, `syntheticPerformer = false`,
`approveBeforeLaunch = true`.

`orgId` and `partnerId` **throw** if missing (lines 112-113), and the throw is caught and
turned into a block.

### The exact allowed offerType values

`src/compliance/screen.mjs:248-249`

```js
export const OFFER_TYPES = new Set(["funding", "credit_cards", "credit_repair"]);
export const PLATFORMS = new Set(["meta", "tiktok", "google"]);
```

Three values, underscores, lower case. `platform` may also be `null`.

### The exact shape when it blocks

Return is always `{ state, reasons }`. `state` is one of `"passed"`, `"blocked"`,
`"needs_approval"`.

An engine block is built by the helper at line 252:

```js
const blocked = (code, rule_set, message) => ({ state: "blocked", reasons: [r(code, rule_set, message)] });
```

so a missing offer type comes back as, verbatim from lines 118-121:

```json
{
  "state": "blocked",
  "reasons": [{
    "code": "offer_type_missing",
    "rule_set": "engine",
    "message": "offer_type must be one of funding, credit_cards, credit_repair; got undefined."
  }]
}
```

A block from a configured rule row has two more fields, lines 254-260:

```js
const fromRule = (rule) => ({
  code: rule.rule_key,
  rule_set: rule.rule_set,
  message: rule.message,
  citation: rule.citation || undefined,
  severity: rule.severity
});
```

An error of any kind — database down, bad regex — returns this, lines 90-98:

```json
{
  "state": "blocked",
  "reasons": [{
    "code": "screen_error",
    "rule_set": "engine",
    "message": "Compliance screening could not complete, so this is blocked. Try again; if it persists this is a platform fault, not your copy.",
    "detail": "…first 300 characters of the error…"
  }]
}
```

**`needs_approval` is not a pass.** Header, lines 33-36: it is separate from `blocked`
"only so the dashboard can tell 'a human must look at this' apart from 'this can never
run'." Credit repair always returns it (line 207), and so does any partner with
`approve_before_launch` on (line 215).

### The other export a builder may want

`src/compliance/screen.mjs:231`

```js
export async function screenAndRecord(db, subject) {
```

Same result, plus one row written to `compliance_screenings`. It reads `subject.subjectId`
for the row, which is **not** in the documented subject list above. Pass it.

---

## 3. `src/creative/generate.mjs` — `storeAsset`

### The exact signature

`src/creative/generate.mjs:215`

```js
async function storeAsset(tx, job, a, ctx) {
```

**It is not exported.** `export default { enqueue, claim, run };` at line 326 lists three
functions and `storeAsset` is not one of them. A builder who wants to test the copy-text
path directly cannot import it. Reach it through `run()`.

### The asset object `a`

Read straight off the insert at lines 216-237, `a` carries: `kind`, `format`, `provider`,
`provider_asset_id`, `text`, `duration_sec`, `ai_generated`, `synthetic_performer`,
`parent_asset_id`.

`src/creative/providers/copy.mjs:70-80` is what actually fills it for a script:

```js
assets: variantsOut.map((t) => assetFrom({
  kind: "copy",
  format: spec.format || "1x1",
  provider: PROVIDER_KEY,
  text: t,
  aiGenerated: true,
  syntheticPerformer: false
})),
```

### The spec object it receives

The spec is **not** an argument. It is read back off the stored job, twice — line 148 in
`run()` and again at line 246 inside `storeAsset`:

```js
const spec = typeof job.spec === "string" ? JSON.parse(job.spec) : (job.spec || {});
```

The job's spec was written by `enqueue` at line 95:

```js
JSON.stringify({ ...spec, assetKind })
```

So whatever the caller put in `spec`, plus an `assetKind` key.

### Every field the generate path passes today

`storeAsset` builds the screen call at lines 252-266. This is the complete list:

```js
const verdict = await screen(tx, {
  orgId: job.org_id,
  partnerId: job.partner_id,
  subjectId: asset.id,
  kind: "creative_asset",
  offerType: spec.offerType,
  platform: spec.platform ?? null,
  text: a.text || spec.prompt || "",
  aiGenerated: a.ai_generated !== false,
  syntheticPerformer: Boolean(a.synthetic_performer),
  hasDisclosureAsset: Boolean(spec.hasDisclosureAsset),
  approveBeforeLaunch: settings.rows[0]?.approve_before_launch ?? true
});
```

**Three spec keys are read and only three:** `spec.offerType`, `spec.platform`,
`spec.hasDisclosureAsset`. Plus `spec.prompt` as a fallback for the text. Anything else a
builder puts in the spec is stored on the job but never reaches the screen.

Note what is missing: `targeting` is never passed from this path. That is fine — targeting
is for campaign payloads, not assets.

### What the words do

The `copy_text` write is the 2026-09-06 change and it is right. Lines 228-234:

```js
// The words, saved with the row. A picture has none, and storageKeyFor()
// returns null for copy, so exactly one of these two columns is filled.
// Written HERE, in the insert, and not after the screen: a copy asset that
// gets blocked keeps its text like every other one.
copyTextFor(a),
```

and the helper, lines 313-316:

```js
function copyTextFor(a) {
  const text = typeof a.text === "string" ? a.text.trim() : "";
  return text === "" ? null : text;
}
```

Blank becomes `NULL` because the database check refuses an empty string —
`db/migrations/301_creative_copy_text.sql:76`:

```sql
CHECK (copy_text IS NULL OR btrim(copy_text) <> '')
```

That is the whole schema change: one nullable column, one guard, one comment. No
`filmed_at`. **KEEP it.**

---

## 4. `api/creative/generate.mjs` — the HTTP door

### The exact request body

Method `POST`. Sign-in required — `requirePrincipal(req, res, ["partner", "staff"], { db })`.

```
partner_id           staff must send it; a partner login ignores it and uses their own
asset_kind           or assetKind. Default "static". Values: static | video | copy
idempotency_key      or idempotencyKey. REQUIRED. No default is generated on purpose
brand_kit_id         optional
spec                 optional object, passed straight through to enqueue
prompt               only used if spec is absent
formats              only used if spec is absent
variants             only used if spec is absent
```

### The bug that is still there

Lines 114-118:

```js
spec: body.spec || {
  prompt: body.prompt || "",
  formats: body.formats || ["1x1"],
  variants: body.variants || 1
}
```

**There is no `offerType` in that fallback.** Any caller that posts `prompt` without a
full `spec` gets a job whose stored spec cannot be screened, and every asset it makes comes
back blocked with `offer_type_missing`. The screen where a person clicks was fixed on
2026-09-06 — `creative-factory.html:2339` now sends
`spec: { prompt: prompt, formats: ['1x1'], variants: 1, assetKind: kind, offerType: offer }`
— but the endpoint underneath it was not. Any other caller, and the ad-script skill will be
one, walks straight into it.

**FIX:** either refuse the request with a `400 offer_type_required` when neither
`body.spec.offerType` nor a top-level offer type is present, or read `body.offer_type` into
the fallback spec. Refusing is the better half, because it matches what the form now does
(`creative-factory.html:2319`: `if (!offer) { msg.textContent = 'Say what is being sold first.'; return; }`).
**COMPLIANCE REVIEW REQUIRED** — this field picks which body of law an ad is screened
under.

### The exact success response

Lines 139-145:

```js
return res.status(200).json({
  ok: true,
  created: result.created,
  job: result.job,
  provider_ready: readiness.ready,
  note: readiness.note
});
```

`job` is the whole `generation_jobs` row. `created` is `false` when the idempotency key
already existed. `provider_ready` is **three-valued**: `true`, `false`, or `null` meaning
"the check itself failed, we do not know" (lines 45-47).

### The exact failures

| Code | Body |
|---|---|
| 405 | `{"ok":false,"error":"method_not_allowed"}` |
| 401 / 403 / 503 | from `requirePrincipal`, same as §1 |
| 400 | `{"ok":false,"error":"partner_id_required"}` |
| 400 | `{"ok":false,"error":"idempotency_key_required","message":"Pass a stable idempotency_key so retries do not double-bill."}` |
| 403 | `{"ok":false,"error":"suite_off","message":"The owner has not turned this on for this partner."}` |
| 404 | `{"ok":false,"error":"partner not found"}` |
| 500 | `{"ok":false,"error":"…safeError(err)…"}` |

### One more thing a builder will trip on

`src/creative/providers/copy.mjs:26-28`:

```js
if (!env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set — the copy provider cannot run.");
}
```

But `src/agents/model.mjs` prefers OpenAI when an OpenAI key is set (owner decision,
2026-08-25). A machine holding only `OPENAI_API_KEY` is turned away for a key it does not
need. Named in the 2026-09-06 audit and still unfixed.

---

## 5. `src/agents/model.mjs` — the model call

### The exact signature

`src/agents/model.mjs:70-74`

```js
export async function callModel({
  system, user, env = process.env, fetchImpl = globalThis.fetch,
  model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS,
  media = []
} = {}) {
```

### The options

| Option | Default | What it does |
|---|---|---|
| `system` | `""` | the rules handed to the model |
| `user` | `""` | the ask |
| `env` | `process.env` | where the keys are read from |
| `fetchImpl` | `globalThis.fetch` | swap it in a test |
| `model` | `DEFAULT_MODEL` | see below |
| `maxTokens` | `DEFAULT_MAX_TOKENS` = 600 | **raise this for scripts.** 600 tokens is roughly 450 words, and one short-form ad is 150-225 words. The copy provider already raises it to 2000. |
| `media` | `[]` | images or PDFs |

The three constants, lines 13-15:

```js
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_MAX_TOKENS = 600;
```

Also exported: `liveModelProvider(env)` at line 26, which returns `"openai"`,
`"anthropic"` or `null`.

### The documented return shape

Lines 60-69:

```js
/**
 * callModel({ system, user, env?, fetchImpl?, model?, maxTokens? })
 * → {
 *     mode: 'live' | 'shadow',
 *     text: string | null,          // assistant reply (synthetic marker when keyless)
 *     raw: object | null,
 *     request: { model, system, user, max_tokens },
 *     error: string | null
 *   }
 */
```

Every real return also carries `usage: { input_tokens, output_tokens }`.

### What it returns when no key is set

Lines 86-99, verbatim:

```js
if (!provider) {
  const inbound = String(user || "").slice(0, 280);
  return {
    mode: "shadow",
    text: `[SHADOW — no API key] Model was not called. Inbound: ${inbound || "(empty)"}`,
    raw: null,
    request,
    error: null,
    detail: "no live model key — shadow mode, no model call",
    usage: { input_tokens: 0, output_tokens: 0 }
  };
}
```

**Three traps in that block.**

1. It does **not** throw. A caller that only checks `error` sees `null` and treats the
   shadow string as a finished ad script.
2. `text` is **not** null. It is a real string starting with `[SHADOW — no API key]`.
3. The only honest test is `if (result.mode !== "live")`. `src/creative/providers/copy.mjs:61`
   already does it right and is the pattern to copy:

```js
if (model.mode === "shadow" || model.error || !model.text) {
  throw new Error(model.error || "copy provider returned no text");
}
```

---

## 6. `docs/ads/registry.json` — the vocabulary

Quoted whole, from `docs/ads/registry.json:5-11`:

```json
"vocabulary": {
  "lane": ["funding600", "premium", "sorting", "uwiq", "wl"],
  "gate": ["600", "720", "780", "none"],
  "entry": ["direct", "sorting"],
  "offer": ["funding_dfy", "credit_optimization", "capital_blueprint", "capital_academy", "white_label", "none"],
  "variant": ["sun", "nosun", "sedona"]
}
```

Five lanes. Four gates. Two entries. Six offers. Three variants. **Nothing outside those
lists is legal.**

The seeding rules that go with them, lines 12-18:

```json
"rules": {
  "funding600": { "gate": "600", "entry": "direct", "primary_offer": "funding_dfy", "secondary_offers": [] },
  "premium":    { "gate": "720", "entry": "direct", "primary_offer": "funding_dfy", "secondary_offers": [] },
  "sorting":    { "gate": "none", "entry": "sorting", "primary_offer": "none", "secondary_offers": "all" },
  "uwiq":       { "gate": "none", "entry": "sorting", "primary_offer": "capital_blueprint", "secondary_offers": "all" },
  "wl":         { "gate": "none", "entry": "direct", "primary_offer": "white_label", "secondary_offers": [] }
}
```

`secondary_offers` is either an empty array or the literal string `"all"` — not a list.
A builder must handle both types.

Two more facts a builder needs:

* `"gate": "780"` is in the vocabulary but **no lane uses it** and no ad carries it. It is
  legal and unused. Do not treat its absence as a bug.
* `"title": null` is normal and correct. Owner decision 2026-09-06: ads are identified by
  id, not by name. Never invent a title, and never call an untitled ad a defect.

---

## 7. The two things that were NEVER CREATED

### 7a. `docs/ads/VOICE.md`

It does not exist. `ls docs/ads/` returns: `ANGLE-GENERATOR.md`, `ASSET-BANK.md`,
`CONCEPTS.md`, `CONTROLS.md`, `NEXT.md`, `POST-BOOKING-15.md`, `README.md`, `RULES.md`,
`apify-scrape-pipeline.md`, `ascension-ads.md`, `build/`, `registry.json`, `scripts/`.

This is the file the plan calls the important one. Without it the generator forgets every
fix Chris makes and has to be re-taught every week.

**The only seed allowed is `docs/ads/CONTROLS.md`.** Owner decision, Correction 3: the 83
chat scripts are not the seed, because seeding from everything teaches the model the
average, and the average is what sounds fake.

**What `CONTROLS.md` gives us to copy.** Its lines are plain spoken paragraphs, one idea
each, no camera directions inside the words. Line 19 is the whole style in one sentence:

> "If your business got denied for funding, you didn't lose because of your credit. You
> lost because nobody looked at your file the way a bank actually looks at it."

That is a cause-first hook. Short sentence, then the cause. No adjectives, no build-up.

**The shape a pair must take.** A model matches examples, so each pair has to show the
same line twice — once wrong, once right — plus the one-line reason and where it came
from. Proposed, and a builder should use exactly this so a regex can count the pairs:

````markdown
## Pair 12 — hook
- **Lane:** funding600
- **Model wrote:** Unlock the power of business funding and elevate your company today.
- **Chris wrote:** If your business got denied for funding, you didn't lose because of your credit.
- **Why:** The first one is a promise with no cause. The second hands them the reason in the first breath.
- **Source:** CONTROLS.md Ad 1 — Denial Angle
````

Four rules for the file, all of which fall out of decisions already made:

1. **Every pair is tagged by part** — `hook`, `body`, `cta`, `close` — because
   `docs/ads/RULES.md:338-341` (the locked HOOK / BODY / CTA / CLOSE block) locks the script into exactly those four parts.
2. **Every pair names its lane** from the §6 vocabulary, because a `wl` ad and a
   `funding600` ad do not sound the same.
3. **The seed pairs cite `CONTROLS.md` by ad name.** `CONTROLS.md:1` says
   `# LIVE — DO NOT EDIT`, so `VOICE.md` quotes it and never edits it.
4. **The file starts almost empty and only Chris's own edits grow it.** Nothing an agent
   wrote may be added as an "after" line.

**One seed pair can be written today with no input from Chris**, because `RULES.md:288`
already grades a real line against the cause-first test:

> **Script 8 — Stop Before You Apply Again** (`CONTROLS.md`) · *"Stop. Before you fill out
> another funding application… watch this."* · **Check 2 — it asks.** Two asks in twelve
> words, and no cause anywhere in the hook.

### 7b. `.cursor/skills/fundhub-ad-writer/SKILL.md`

It does not exist. The ten skills that do exist are: `fundhub-agent-tester`,
`fundhub-auditor`, `fundhub-builder`, `fundhub-fixer`, `fundhub-orchestrator`,
`fundhub-perf-auditor`, `fundhub-repo-hygiene`, `fundhub-system-map`, `fundhub-ui-auditor`,
`fundhub-version-control`.

**The exact frontmatter.** Only two fields, both required, between `---` fences at the very
top of the file. Two real examples.

Short form, `.cursor/skills/fundhub-perf-auditor/SKILL.md:1-4`:

```yaml
---
name: fundhub-perf-auditor
description: Read-only performance audit against docs/PERF-STANDARDS.md. Triggers - perf audit, speed audit, why is this slow, load time, lighthouse, page speed, core web vitals.
---
```

Folded form for a longer description, `.cursor/skills/fundhub-fixer/SKILL.md:1-8`:

```yaml
---
name: fundhub-fixer
description: >-
  Named Fundhub repair only — smallest diff for what Chris asked, then prove
  it. Use when Chris says fix, ship, repair, wire, "make X work", or unblock.
  Enforces owner-scope-minimal-diff, live Playwright 100/100, and human click
  before claiming done. Never audits-and-fixes in one pass; never weakens tests.
---
```

Rules that hold across all ten, and a new one must match:

* `name` equals the folder name, exactly.
* `description` ends with the trigger words Chris would actually type. Every one of the ten
  does this — "Triggers - …" or "Use when Chris says …".
* Several say what the skill is **not**, to stop the wrong one loading. Copy that.

**The section structure.** One `#` title matching the skill name, then `##` sections.
Every skill has a prime-rules block and a done-bar block. The two closest models:

`fundhub-perf-auditor` — `# Fundhub Perf Auditor` · `## Prime rules` ·
`## Per-page capture` · `## Finding format` · `## Priority order` · `## Workflow`

`fundhub-fixer` — `# Fundhub Fixer` · `## How you write to Chris` · `## Prime rules` ·
`## Before you write code` · `## Prove path (required before "done")` · `## Deploy` ·
`## Outbound / compliance` · `## Done report (plain language)` ·
`## Language — never a refusal` · `## What reaches Chris's phone` · `## Never`

So a new `fundhub-ad-writer` should be:

```
# Fundhub Ad Writer
## How you write to Chris        (fifth-grade, per CLAUDE.md §10)
## Prime rules                   (RULES.md is law; VOICE.md is the voice; never invent a title)
## What you read before writing  (RULES.md, VOICE.md, CONTROLS.md, CONCEPTS.md, registry.json)
## The format per ad type        (cold DR / VSL / evergreen — RULES.md Part 3)
## The checker (required)        (run scripts/ads/check-script.mjs; fix and re-run; never skip)
## Where the output goes         (docs/ads/scripts/<date>.md)
## The correction loop           (Chris's rewrites become VOICE.md pairs, same session)
## Never
```

One design rule from the plan that must survive into the skill: **the generator never
reads a file directly.** It takes the rules text and the voice pairs as inputs from a thin
loader. Today the loader reads the two files. Later it reads a `brand_kits` row instead,
and only the loader changes.

---

## 8. Every test that covers any of this

| Test file | What it actually proves |
|---|---|
| `src/compliance/screen.test.mjs` | **The strongest file here.** 40-odd cases across five groups: CROA rules, claims rules, disclosure rules, platform rules, approval gates, fails-closed. Line 394 checks every seeded rule was parsed out of migration 047; line 403 checks every rule key has a blocked case; line 413 checks every offer type is exercised. Lines 357-373 cover a missing offer type, an unknown one, an unknown platform and a missing partner id. Line 378: "there is no override argument that produces a pass on banned copy." |
| `src/compliance/targeting.test.mjs` | Targeting-only rules. Not on the script path. |
| `src/compliance/invariants.pg.test.mjs`, `rls-bypass.pg.test.mjs` | Database-level guards: a blocked asset with no reasons is refused, and row-level security is not bypassable. |
| `src/creative/generate.pg.test.mjs` | The whole job path against real Postgres: idempotency, per-partner isolation, the concurrency cap, a provider outage leaving the job `queued`, zero assets counting as a failure, blocked copy kept with its reasons, an audit row per screen, no hard deletes. **See the flag below.** |
| `src/http/creative-generate.pg.test.mjs` | The HTTP door: who is recorded as the requester, the same batch name twice makes one job, no session is refused before anything is written, a batch with no name is refused, and the answer says whether anything can run. **None of its ten cases posts a body without an offer type**, which is why §4's bug is still live. |
| `src/http/principal-reads.pg.test.mjs` | `/api/read/partners` specifically: partner A sees only their own row (line 112), a `partner_id` in the query string is ignored (line 132), staff see across partners (line 139), a client gets 403 (line 155). This is good coverage of §1. |
| `src/agents/model.test.mjs` | Five cases. OpenAI wins when both keys are set; with no key `callModel` stays shadow and **fetches nothing**; each provider posts to the right address. Proves §5's shadow return. |
| `src/ads/registry.test.mjs` | Every ad obeys its lane's seeding rule; an unknown id falls back to the sorting default; the JS mirrors of the SQL in migration 286 agree. Carries `UNTITLED_ALLOW_LIST` of 21 ids so the suite stays green — and now that names are optional forever, that list should be relaxed rather than grown. |
| `src/http/read-endpoints-org-scope.test.mjs:165` | Names `api/read/partners.mjs` directly, on the org-scope fix. |
| `src/http/ad-attribution.pg.test.mjs:156` | `utm_content=43` with no slug resolves to ad 43. This is the proof that titles are optional. |
| `src/messaging/gate.test.mjs` | Uses `appliesTo` and `toRegex` from `screen.mjs`, so it pins those two exports' behaviour too. |
| **`scripts/ads/check-script.mjs`** | **No test at all.** Nothing imports it, no npm script runs it, and CI never calls it. |

### The flagged one: `src/creative/generate.pg.test.mjs`

**It passes `offerType` by hand on every single case.** Every spec in the file:

* line 66 and 69 — `spec: { prompt: "x", offerType: "funding" }`
* line 81 and 84 — `spec: { offerType: "funding" }`
* line 99 — `spec: { offerType: "funding" }`
* line 159 — `spec: { … offerType: "funding", formats: ["1x1"], variants: 1 }`
* line 184 — `spec: { prompt: "x", offerType: "funding", formats: ["1x1"] }`
* line 198 — `spec: { prompt: "x", offerType: "funding", formats: ["1x1"] }`
* line 207 — `spec: { prompt: "x", offerType: "funding", variants: 1 }`
* line 241 — `spec: { offerType: "funding" }`

**This is why green tests hid a broken screen.** The tests build the spec object
themselves, so they never walk the path a real caller walks: post a `prompt`, get the
endpoint's fallback spec at `api/creative/generate.mjs:114-118`, and have every asset come
back blocked with `offer_type must be one of funding, credit_cards, credit_repair; got
undefined.` Nothing was wrong with the assertions. The fixture was doing the endpoint's
job for it.

**The test a builder must add:** post to the endpoint with a `prompt` and no `spec`, and
assert the request is refused with a clear message — not that the job is created. One case,
in `src/http/creative-generate.pg.test.mjs`, where the missing coverage actually is.

### Two more coverage holes worth naming

1. **`scripts/ads/check-script.mjs` cannot be tested in its current shape.** Line 509 is
   `process.exit(main(process.argv.slice(2)));` at the top level of the module, and the
   file has **zero `export` statements**. Any test that imports it runs it and kills the
   test runner. **FIX:** export `checkOneScript`, `loadRules` and `main`, and guard the
   exit so it only fires when the file is run directly. Then add an npm script
   (`"ads:check": "node scripts/ads/check-script.mjs"`) so a person and CI call it the same
   way. Until then, `CLAUDE.md` §3c's "a regex cannot lie about having run" is only half
   true here — nothing makes it run.
2. **`copy_text` has no test of its own.** Migration 301 landed, `storeAsset` writes the
   column, and `api/creative/library.mjs` selects it, but no case asserts that a generated
   copy asset comes back out of the library with its words in it, or that a **blocked** one
   does too — which is the behaviour the migration comment specifically promises.

---

## What a builder should do first, in order

1. Fix `api/creative/generate.mjs`'s fallback spec (§4). One endpoint, one guard, one test.
   **COMPLIANCE REVIEW REQUIRED.**
2. Make `scripts/ads/check-script.mjs` importable and give it an npm script (§8).
3. Write `docs/ads/VOICE.md` seeded from `CONTROLS.md` only, in the pair shape in §7a.
4. Write `.cursor/skills/fundhub-ad-writer/SKILL.md` to the frontmatter and section shape
   in §7b.
5. Add the two missing tests: the no-offer-type endpoint refusal, and copy text surviving
   into the library for both a passed and a blocked asset.

Nothing on that list needs a new table, a new page, or a new package.
