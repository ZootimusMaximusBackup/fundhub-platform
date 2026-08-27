# Repo purge candidates — 2026-08-21

**Status: STOP — waiting for Chris KEEP / KILL on each row. No deletes.**

Read-only inventory. Conservative: prefer **suspect** over **must delete**.  
Only recommend purge of **TRACKED** junk for git size wins, unless noted as local-disk cleanup (already ignored / untracked).

**Do not delete (explicit exclusions — not on the list):** `.env`, `credentials/`, live migrations (`db/`), `src/` app core, `public/app` core screens, Present / closer protected paths.

**How to answer:** mark each row `KEEP` or `KILL` (or `KILL later` / `ASK more`). Agent does nothing until you mark.

---

## Summary (for parent)

| Bucket | Count (approx) |
|---|---|
| SAFE (historical evidence / obvious dead tracked trees) | **28** |
| ASK (maybe useful / wired / ambiguous) | **22** |
| DANGEROUS (do not kill without explicit re-confirm) | **5** |
| Local-only note (not tracked — disk only) | **6** |

**Biggest size wins (tracked):** `docs/workflows/ui-audit-evidence` (~265M) → `perf-audit-evidence` (~127M) → `audit-crm-whole-2026-08-18-evidence` (~97M) → `e2e-verify-run5-evidence` (~82M) → `fix-2026-08-18` (~37M). Combined evidence under `docs/workflows` ≈ **~780M** disk / **~6.3k tracked files**.

---

## Legend

| Risk | Meaning |
|---|---|
| **SAFE** | Looks like finished audit/proof dumps or clearly unwired leftovers. Deleting should not break build/deploy. May lose historical proof. |
| **ASK** | Suspect clutter, but something still references it, or owner may want it. |
| **DANGEROUS** | Live product, vendor runtime, templates/fonts, or gift downloads. |

**Git:** `TRACKED` = in git index. `IGNORED` / `UNTRACKED` = not a git-size win unless you also want local disk cleaned.

---

## A. Top-level / unusual folders (not src, public, api, db, docs, e2e, netlify, .cursor)

| # | Path | Size / count | Why unused-looking | Risk | Depends on? | KEEP/KILL |
|---|---|---|---|---|---|---|
| A1 | `vendor/underwriteiq/` | ~168K disk / 33 tracked | Comment in `src/underwrite/engine.mjs` says tree stays **unwired** after move to `-full`. No runtime imports found. | **ASK** | None for build if true; keep if you want historical vendor snapshot | |
| A2 | `vendor/underwriteiq-crs/` | ~436K / 28 tracked | No `src`/`api`/`netlify` references found. Looks like orphan CRS sandbox dump. | **ASK** | None found | |
| A3 | `vendor/underwriteiq-full/` | ~172M / 247 tracked | **Not junk** — CRS engine, letter delivery, sandbox used by tests and `src/*/vendor/*.cjs` shims. | **DANGEROUS** | Build, underwrite, letter packs, tests | |
| A4 | `vendor/inquiry-remover/` | ~67M / 65 tracked | Partially live: `ai-set-01` imports setter prompt; Bland docs/comments point here. Not fully “dead.” | **DANGEROUS** | Setter AI workflow / Bland agent copy | |
| A5 | `dist/fundhub-frontend.html` | ~2.7M / 1 tracked | Single giant HTML snapshot dated Jul 31. App ships from `public/`, not `dist/`. | **ASK** | None for Netlify deploy if unused | |
| A6 | `wireframes/` | ~916K / 20 tracked | Design-only HTML (noted in workflow docs). Not the live CRM. | **ASK** | Design reference only | |
| A7 | `fundhub-docs/sources/` | ~236K / 3 tracked | Old “canonical” extract copies. README still points at `fundhub-docs`. May be superseded by `docs/`. | **ASK** | Doc provenance / template source of truth claims | |
| A8 | `extension/` | ~32K / 7 tracked | Browser extension tree; unclear if shipped. Small. | **ASK** | Extension install path if any | |
| A9 | `clickfunnels-fragments/` (whole tree) | ~60M disk / 68 tracked (~40M of that is tracked `assets/VSL.mov` + HTML/zips/tests) | Funnel drop-in workshop, not Netlify app root. Live funnel is ClickFunnels hosted. Local `node_modules` (~18M) already gitignored. | **ASK** | Funnel rebuild / apply.fundhub.ai drop-ins | |
| A10 | `assets/gifts/message-blaster.dmg` | ~1.2M / 1 tracked | **Live gift** — `GET /api/gifts/message-blaster` serves this file. | **DANGEROUS** | Affiliate/partner gift download | |
| A11 | `assets/ebooks/fundhub-ebook-placeholder.pdf` | 420B / 1 tracked | Placeholder PDF — name says temporary. | **ASK** | Ebook gift path if wired | |
| A12 | `.serena/` (tracked memories + `project.yml`) | 14 tracked files (~48K); **cache** ~112M is gitignored | Tool memory for Serena MCP, not product. Cache already ignored. | **ASK** | Agent memory only | |

**Not candidates (excluded):** `credentials/` (~19G, **IGNORED**, secrets), `node_modules/`, `.netlify/`, `.fundhub-relay/`, `test-results/`, `.env`.

---

## B. Large / old evidence dumps (`docs/workflows/*-evidence/`)

All below are **TRACKED** unless noted. Risk **SAFE** = finished audit/proof piles; losing them only loses historical screenshots/JSON, not runtime.

| # | Path | Size / tracked files | Why unused-looking | Risk | Depends on? | KEEP/KILL |
|---|---|---|---|---|---|---|
| B1 | `docs/workflows/ui-audit-evidence/` | **~265M** / 1859 | Giant UI audit screenshot dump | **SAFE** | None (docs only) | |
| B2 | `docs/workflows/perf-audit-evidence/` | **~127M** / 413 | Lighthouse/perf JSON + assets | **SAFE** | None | |
| B3 | `docs/workflows/audit-crm-whole-2026-08-18-evidence/` | **~97M** / 865 | Whole-CRM audit day pile | **SAFE** | Board markdown may still cite paths | |
| B4 | `docs/workflows/e2e-verify-run5-evidence/` | **~82M** / 753 | Live verify run5 dumps (incl. live-playwright-100 shots) | **ASK** | May still be cited as score evidence | |
| B5 | `docs/workflows/fix-2026-08-18/` (esp. `evidence/`) | **~37M** / 429 | Fix-batch evidence + `.log.gz` | **SAFE** | Historical fix board | |
| B6 | `docs/workflows/audit-gaps-2026-08-18-evidence/` | ~29M / 223 | Gaps audit screenshots | **SAFE** | None | |
| B7 | `docs/workflows/fulfillment-layer-2026-08-19-evidence/` | ~19M / 123 | Fulfillment layer audit | **SAFE** | None | |
| B8 | `docs/workflows/build-evidence/` | ~15M / 77 | Build prove dumps | **SAFE** | None | |
| B9 | `docs/workflows/audit-untested-2026-08-18-evidence/` | ~13M / 244 | Untested-surface audit | **SAFE** | None | |
| B10 | `docs/workflows/crm-feel-2026-08-17-evidence/` | ~13M / 134 | CRM feel review shots | **SAFE** | None | |
| B11 | `docs/workflows/audit-sixteen-deep-2026-08-18-evidence/` | ~7.7M / 66 | Sixteen deep audit | **SAFE** | None | |
| B12 | `docs/workflows/e2e-verify-run4-evidence/` | ~3.3M / 83 | **Superseded by run5** | **SAFE** | None if run5 kept or also killed | |
| B13 | `docs/workflows/audit-engine-2026-08-18-evidence/` | ~3.1M / 222 | Engine audit JSON/shots | **SAFE** | None | |
| B14 | `docs/workflows/audit-keep-going-2026-08-18-evidence/` | ~5.4M / 96 | Keep-going audit | **SAFE** | None | |
| B15 | `docs/workflows/audit-untested-fire-2026-08-18-evidence/` | ~4.2M / 106 | Fire pass audit | **SAFE** | None | |
| B16 | `docs/workflows/fixer-three-2026-08-17-evidence/` | ~5.6M / 26 | Old fixer prove | **SAFE** | None | |
| B17 | `docs/workflows/contracts-dedup-2026-08-17-evidence/` | ~4.4M / 28 | Contracts dedup prove | **SAFE** | None | |
| B18 | `docs/workflows/campaigns-readable-2026-08-17-evidence/` | ~3.8M / 22 | Campaigns UX prove | **SAFE** | None | |
| B19 | `docs/workflows/bland-agents-prove-evidence/` | ~3.5M / 21 | Bland prove shots | **ASK** | Bland agent prove board | |
| B20 | `docs/workflows/audit-sixteen-*-evidence/` (2026-08-17 + prove4) | ~3.4M + ~2.9M / ~64 | Older sixteen passes | **SAFE** | None | |
| B21 | `docs/workflows/offer-stack-2026-08-17-evidence/` | ~3.0M / 11 | Offer stack prove | **SAFE** | None | |
| B22 | Smaller tracked evidence dirs (~0.5–2M each): `audit-response-loop`, `hiring-repurpose`, `beta-banner-removal`, `launch-proof`, `closer-call-surface`, `client-portal-welcome-video`, `contracts-permission-leak`, `audit-portal-spot`, `lenders-role-lock`, `pipeline-perf-evidence`, `opus-portal-ai-batch`, `ui-polish`, `fulfillment-e2e-2026-08-21`, plus tiny ones under ~300K | ~15–20M combined | Finished task piles | **SAFE** (batch) | Matching workflow `.md` boards | |
| B23 | `docs/workflows/messaging-review-2026-08-21-evidence/` | ~736K / **0 tracked** | Fresh untracked evidence | **SAFE** (local only) | Board for messaging review | |
| B24 | `docs/workflows/button-ux-validation-2026-08-21-evidence/` | ~248K / **0 tracked** | Fresh untracked | **SAFE** (local only) | Button UX board | |

**Batch option:** KILL all **SAFE** rows in section B older than 2026-08-19 ≈ reclaim **~650M+** tracked disk from the biggest four alone.

---

## C. Duplicate / abandoned doc packs

| # | Path | Size / count | Why unused-looking | Risk | Depends on? | KEEP/KILL |
|---|---|---|---|---|---|---|
| C1 | `docs/workflows/gold-deliverables-v5/` | ~4.0M / 53 tracked | Looks like a “pack,” but **letter-generator loads fonts from here**; owner law says these PDFs **are** the templates. | **DANGEROUS** | Letter render / WeasyPrint / gold carbon-copy | |
| C2 | `docs/workflows/gold-deliverables-v5.md` | small | Board for C1 — keep if C1 kept | **DANGEROUS** with C1 | Same | |
| C3 | `docs/workflows/ALL-THREADS-AUDIT-REPORTS.md` | ~989K / 1 tracked | Mega paste of audit reports; redundant with per-workflow boards + evidence | **SAFE** | None | |
| C4 | `clickfunnels-fragments/fundhub-funnel-dropins-v2.zip` + `v3.zip` | ~52K combined tracked | Zips duplicate unpacked `fundhub-funnel-dropins-v2/` HTML already tracked | **ASK** | Funnel handoff convenience | |
| C5 | `clickfunnels-fragments/tests/artifacts-v2/` + `artifacts-v3/` | ~3M of tracked screenshots (part of A9) | Playwright before/after shots for funnel fixes | **ASK** | Funnel visual regression history | |
| C6 | `docs/workflows/simplify-review-2026-08-19-pack/` | ~16K / **0 tracked** | Untracked tiny pack | **SAFE** (local) | Simplify review | |
| C7 | Root historical markdown (all TRACKED): `AUDIT-FINDINGS.md` (~107K), `HANDOFF.md`, `PRODUCT-BACKLOG.md`, `RECOVERY-2026-08-01.md`, `VERIFICATION.md`, `WORKFLOW-AUTONOMY.md`, `workflow-migration-table.md` (~98K), `APPLY-NOTES.md`, `DEPLOY.md`, `TODO.md` | ~250K+ combined | Jul 31 / early-Aug handoff leftovers. Some still **cited in code comments** (`AUDIT-FINDINGS`, migration table). | **ASK** | Human history; a few comment pointers | |
| C8 | Root `fundhub-brand.css` | ~11K tracked | **Different MD5** from live `public/app/fundhub-brand.css`. Looks like stale root copy. | **ASK** | Confirm nothing loads `/fundhub-brand.css` from repo root | |
| C9 | `deno.lock` | ~1K tracked | No `deno.json` / no package scripts reference Deno | **ASK** | None found | |
| C10 | `docs/artifacts/` + `docs/jokes/` | ~20K / **UNTRACKED** | Investor deck joke HTML — not in git yet | **SAFE** (local; do not commit) | None | |

---

## D. Vendor leftovers (detail)

| # | Path | Verdict | Risk | KEEP/KILL |
|---|---|---|---|---|
| D1 | `vendor/underwriteiq-full/` | Active shim target — **keep** | **DANGEROUS** | |
| D2 | `vendor/inquiry-remover/` | Prompt import + Bland reference — **keep unless you retire Josh setter path** | **DANGEROUS** | |
| D3 | `vendor/underwriteiq/` | Declared unwired leftover | **ASK** | |
| D4 | `vendor/underwriteiq-crs/` | No code refs found | **ASK** | |

---

## E. Root clutter / scratch scripts

| # | Path | Size | Why unused-looking | Risk | Depends on? | KEEP/KILL |
|---|---|---|---|---|---|---|
| E1 | `scripts/notion-*.mjs` + `scripts/notion-scrape/` | ~17 tracked files, small | One-off Notion migration scrapers; likely finished | **ASK** | Notion archive pull if you still run them | |
| E2 | `.playwright-mcp/` | ~1.0M / **UNTRACKED** | Console log dumps from MCP browser | **SAFE** (local disk) | None | |
| E3 | `.serena/cache/` | ~112M / **IGNORED** | Tool cache; already not in git | **SAFE** (local disk) | Serena only | |
| E4 | `clickfunnels-fragments/node_modules/` | ~18M / **IGNORED** | Nested install | **SAFE** (local) | Funnel harness npm | |
| E5 | `docs/workflows/fix-2026-08-18/evidence/T10/*.log.gz` | inside B5 | Compressed suite logs | **SAFE** with B5 | None | |

**No root `.zip` / `.dmg` outside `assets/` and `clickfunnels-fragments/`.**

---

## F. Explicit non-candidates (do not mark KILL)

| Path | Why protected |
|---|---|
| `.env`, `.env.example` | Secrets / template |
| `credentials/` | Secrets (~19G ignored) — never commit; not a purge-for-git item |
| `db/schema`, `db/migrations`, `db/seed` | Live schema |
| `src/`, `api/`, `public/app/` core, Present/closer paths | Product |
| `vendor/underwriteiq-full/` | Runtime vendor |
| `docs/workflows/gold-deliverables-v5/` | Letter fonts + gold templates |
| `assets/gifts/message-blaster.dmg` | Live gift download |
| `docs/journeys/` | Journey ground truth |
| `CLAUDE.md`, `README.md`, `package.json`, `netlify.toml` | Repo law / deploy |

---

## Suggested decision order (Chris)

1. Mark **B1–B3 + B5–B22 SAFE batch** first — biggest reclaim, lowest product risk.  
2. Decide **B4** (run5 evidence) separately if you still want live-playwright proof in-repo.  
3. Decide **A1/A2** (unwired vendor) and **C7–C9** (root docs/css/deno).  
4. Leave all **DANGEROUS** rows as KEEP unless you rename the product path first.

---

## Agent stop line

**No deletes performed.** Waiting for KEEP/KILL marks on each row (or a batch line like “KILL all SAFE in B”).
