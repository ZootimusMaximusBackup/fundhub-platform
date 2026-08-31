# Repair contract fee mismatch — 2026-08-30

**COMPLIANCE REVIEW REQUIRED — fee timing (CLAUDE.md §7)**

## The defect

`src/config/offers.mjs` prices `REPAIR_DFY` at `priceCents: 100000` — **$1,000, charged once.**

The contract it sends (`CREDIT-REPAIR-AGREEMENT`) says:

> You pay {{field.monthly_fee}} **per month** while services are active, starting on the date above.
>
> This agreement runs for {{field.term_days}} days from the date above unless ended sooner in writing.

`offers.mjs:196` fills `monthly_fee` with the $1,000 price and `term_days` with `"180"`.

So a client who paid $1,000 once has signed a document stating they owe **$1,000 per month for 180 days — $6,000.**

## Owner decision (owner-set 2026-08-30)

**REPAIR_DFY is a ONE-TIME payment of $1,000.** Chris confirmed directly.

The **contract body is wrong.** The price is right. Do not change `priceCents`. Do not change the
checkout. Fix the contract wording and the field name that feeds it.

Decided. Not open for re-litigation.

## Task board

| # | Workflow | Owner | Status |
|---|---|---|---|
| A | Exposure count — how many signed the bad wording | unclaimed | `pending` |
| B | Template versioning mechanics | this session | `done` |
| C | Offer/contract sweep, incl. REPAIR_TRIAL | unclaimed | `pending` |
| D | The fix — migration + offers.mjs + present.js | unclaimed | `pending` — unblocked, read B first |
| E | The guard test | unclaimed | `pending` — unblocked |

---

## Workflow B — Template versioning mechanics — FINDINGS

### B1. Contract templates are NOT versioned. The premise was wrong.

There is **one row per `(org_id, template_key)`** — enforced by the unique index
`contract_templates_org_key_uniq` (`db/migrations/124_contracts.sql:109`). There is no version
column, no history table, no supersede chain. `updateTemplate()`
(`src/contracts/templates.mjs:203`) does a plain in-place `UPDATE ... SET body = $5`.

So "supersede the template" means **UPDATE the existing row.** It does not mean insert a new one.

### B2. Signed agreements are safe. Editing the body cannot reach them.

This is the important one, and it is airtight. Four independent mechanisms:

1. **`contracts.rendered_body` is a frozen snapshot.** At send, the fully rendered words are copied
   into the `contracts` row. It does not reference the template body at read time.
2. **`trg_contracts_frozen`** (`124_contracts.sql:267-307`) raises an exception on any UPDATE that
   changes `rendered_body`, `body_sha`, `merge_values`, `signature_statement`, `template_id`,
   `client_id`, `org_id` or `sent_at` once `status <> 'draft'`. A second clause freezes the
   signature and status once `signed_at IS NOT NULL`.
3. **`trg_contracts_no_delete`** (`124_contracts.sql:236`) blocks DELETE outright — void, never
   delete.
4. **A second immutable copy** lives in `document_versions` with a checksum, and
   `src/contracts/sign.mjs:97-105` recomputes the hash at signature time and refuses to sign on
   mismatch.

The module header at `src/contracts/templates.mjs:21-25` states this by design: *"EDITING COPY DOES
NOT TOUCH ANY CONTRACT ALREADY SENT."*

**Conclusion: Workflow D may safely rewrite the template body. Existing signed contracts keep their
original wording verbatim, which is exactly what the exposure in Workflow A is measuring.**

### B3. The new migration must UPDATE, not INSERT — and must be guarded.

`169_contract_template_placeholders.sql` inserts with
`ON CONFLICT (org_id, template_key) DO NOTHING`.

**A new migration that copies that pattern will do nothing at all.** The row already exists, so the
INSERT conflicts and is discarded. This is the second silent no-op trap in this area, on top of the
"editing an applied migration is a no-op" one.

The superseding migration must:

```sql
UPDATE contract_templates
   SET body = <corrected body>,
       manual_fields = <corrected fields>,
       updated_at = now()
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND body LIKE '%{{field.monthly_fee}} per month%';   -- guard: only the known-bad copy
```

**The guard matters.** Template copy is editable from the CRM screen by an owner or admin
(`api/contracts.mjs` gates the write). If somebody has already hand-corrected the wording, an
unguarded UPDATE would clobber their edit. Match on the known-bad text and touch only that.

Also update `manual_fields` in the same statement — the `monthly_fee` entry (label
`"Monthly fee"`, help `"For example: $1,000"`) drives the blank the staff member fills on the send
screen. Leaving it named `monthly_fee` reproduces the bug the moment somebody sends by hand.

### B4. THE FIELD FILL IS DUPLICATED IN THE BROWSER. Fixing the server alone is not a fix.

`public/app/present.js:174-180` contains a **second copy** of `defaultContractValues`, hardcoded in
browser JavaScript:

```js
if (key === "CREDIT-REPAIR-AGREEMENT") {
  return Object.assign({}, base, {
    monthly_fee: price || "$1,000",
    term_days: "180",
    ...
```

This is the present/close screen — the path a closer actually uses. `src/config/offers.mjs:193` is
the server-side twin. **Both must change together.** Fix one and the other still sends
`monthly_fee`.

Anything touching `public/app/` is governed by `docs/UI-STANDARDS.md` — read it first (CLAUDE.md §3).

### B5. Leads for Workflow C (seen in passing — NOT verified, C owns this)

- `REPAIR_TRIAL` looks **clean**. Body says *"You pay {{field.trial_fee}} for the first
  done-for-you dispute round"* — one-time language, one-time $200 price, no term clause. Verify,
  do not take my word for it.
- `REPAIR-AND-FUNDING-AGREEMENT` states *"Credit repair fees: {{field.repair_fee}}"* with **no
  cadence at all**, filled with `"$1,000"`. Ambiguous rather than wrong — but its `manual_fields`
  help text reads `"For example: $1,000/month or bundled amount"`, which invites the same mistake.
- `FUNDING-MASTERY-AGREEMENT` has a fill branch at `offers.mjs:227` but **no offer names that
  template key** — `FUNDING_MASTERY` has no `contractTemplateKey` at all, so
  `resolveContractTemplateKey()` can never return it. Dead branch. Confirm before removing.

### B6. Notes for whoever runs D

- `body` had its `NOT NULL` dropped by `125_contract_esign.sql:114` (PDF templates have no text
  body). Do not assume `body` is non-null when matching.
- `contract_templates` is org-scoped. `169` seeds only the `fundhub` org. A tenant that created its
  own copy of this template has its own row — decide whether the migration is org-scoped or global,
  and say which in the change manifest.
- Migrations run on the **production deploy only** (CLAUDE.md §11). This is not live until merged.
  Check `/api/health` for `pending`; a green preview proves nothing.

---

## Workflow A — Exposure

_(unclaimed — findings go here)_

## Workflow C — Sweep

_(unclaimed — findings go here)_

## Workflow D — Fix manifest

_(unclaimed — manifest goes here)_

## Workflow E — Guard test manifest

_(unclaimed — manifest goes here)_
