The live database is reachable. The site connects as `fundhub_app`, not as a superuser, so row locks are on. Almost every table has a lock that is unlocked (anyone on that connection can see every row). Six credit-dispute tables have a lock with no key — the app can see nothing there. Migrations 170 and 171 did land on Aug 17 and the new pieces exist. No child rows point at a missing parent. Nothing in this repo is a fully dead table.

### WORKS (with evidence path)

- Live login role is `fundhub_app`. Not a superuser. Does not skip row locks. `identity.json`
- Every public table has the row-lock switch on. Zero tables with the switch off. `rls_coverage.json` `orphan_summary.json`
- 170 landed Aug 17, 2026 at 22:14:41 UTC. `call_outcomes.checklist` exists and is jsonb. `confirm_170_171.json` `schema_migrations.json`
- 171 landed Aug 17, 2026 at 22:14:42 UTC. `entitlement_catalog.display_price_cents` exists. `content_videos` and `content_tier_map` exist. `confirm_170_171.json`
- Every migration file on disk is in `schema_migrations`. Nothing sitting unapplied. Latest files through 176 are applied (176 on Aug 18). `migrations_diff.json`
- Foreign keys exist (486). Zero children whose parent id is missing. Zero `client_id` values pointing at a missing client. `foreign_keys_pg.json` `orphans_fk.json` `orphan_summary.json`
- No table in this repo has zero reads and zero writes. `dead_tables.json` `scan_summary.json`
- Exact row counts for all 175 public tables are saved. Full writer/reader list is saved. `row_counts.json` `tables_inventory.json` `table_usage.json`

### BROKEN (capped: journey/area, expected, observed, evidence, built-wrong vs unverified)

**Area: credit-dispute tables (Metro 2)**  
Expected: the app can read and write dispute cases, letters, and furnisher addresses.  
Observed: six tables have row locks on and zero rules. For a normal login role that means deny everything. The app counts 0 rows on all six. Migration 160 tried to seed furnisher addresses. Whether those seed rows are hidden behind the lock is unverified (this role cannot peek).  
Evidence: `orphan_summary.json` `rls_kinds.json` `row_counts.json` `db/migrations/160_metro2_dispute_engine.sql`  
Kind: **built-wrong** (same class as the old login outage: lock on, no key). 160 did not add a rule. Later “no bare lock” files ran before 160, so they did not patch these.

**Area: private client data locks**  
Expected: a lock that actually hides one client’s file from another path, or a clear statement that the app (not the database) does that job.  
Observed: 147 tables use “allow all” rules (`USING true` / `WITH CHECK true`). That includes clients, messages, contracts, documents, credit results, soft pulls, bank rows, consent, and sign-in sessions. Twenty-one partner/ad tables have a real partner check. The rest do not.  
Evidence: `fk_rls_summary.json` `rls_kinds.json` `pii_tables.json`  
Kind: **built-wrong** if you thought the database lock isolates clients. **As designed** if you believed 109 on purpose: most tables were never meant to isolate by row lock. Either way, a stolen `fundhub_app` password sees every client row.

**Area: call save vs migration 170**  
Expected: the new `checklist` box is stored in `call_outcomes.checklist`.  
Observed: the column is there. All 6 live call rows have it empty. The save path writes the boxes into the notes text, not into `checklist`.  
Evidence: `confirm_170_171_fill.json` `column_drift_verified.json`  
Kind: **built-wrong**

**Area: bank money rows**  
Expected: a bank transaction points at a client or a bank account.  
Observed: 18 of 18 bank transaction rows have no client and no bank account (null on a “set null if parent gone” link). Not a broken foreign key. They are unlinked.  
Evidence: `orphans_set_null.json` `row_counts.json`  
Kind: **unverified** leftover vs never-linked.

**Area: marketing warehouse**  
Expected: the app can read `marketing` tables if it needs them.  
Observed: four marketing tables exist. `fundhub_app` is denied.  
Evidence: `marketing_tables.json`  
Kind: **built-wrong** for any live read path; unused by the running app (see dead / unused).

### MISSING

- No written journey named “Supabase as a database.” This pass used the board order, not `docs/journeys/*-intended.md`.
- No `contacts` table. People live on `clients`.
- Auth and storage schemas are visible as names (23 auth tables, 8 storage tables). Row counts were not taken. Those schemas hold sign-in and files. This role was not used to dump them. `other_schemas.json` `namespaces.json`
- Real row counts on the six locked dispute tables, as the table owner: **unverified**.
- Two old migration keys sit in `schema_migrations` with no file on disk (`090_app_role.sql`, `106_journeys.sql`). They were renamed later (`104`, `113`). Not unapplied. `migrations_diff.json`

### 170 / 171 confirmation (applied? columns exist? applied_at?)

| File | Applied? | When (UTC) | What exists on live |
|---|---|---|---|
| `migrations/170_call_outcome_checklist.sql` | yes | 2026-08-17T22:14:41.749Z | `call_outcomes.checklist` jsonb |
| `migrations/171_content.sql` | yes | 2026-08-17T22:14:42.061Z | `entitlement_catalog.display_price_cents` integer; tables `content_videos`, `content_tier_map` |

Fill right now: 0 of 6 call rows have `checklist`. 0 of 5 product tiles have a display price. 0 welcome videos. 0 tier maps. Columns and tables are real. The new fields are unused. `confirm_170_171.json` `confirm_170_171_fill.json`

### Dead tables

None with zero reads and zero writes in `api/`, `src/`, or `db/`.

The running app (`api/` + `src/`, not tests, not migrations) never touches these 11. Migrations or tests still name them:

- `affiliate_payouts`
- `brand_kit_sources`
- `campaign_strategies`
- `creative_billing_rates`
- `creative_usage_events`
- `eeo_responses`
- `eeo_survey_invites`
- `partner_payout_lines`
- `partner_payouts`
- `partner_revenue`
- `product_aliases` (14 seed rows sit here)

`runtime_unused.json`

### Tables without RLS that hold PII

None. Every public table has the lock switch on.

What that does **not** mean: the lock hides client data.

- **No key (deny all):** `dispute_cases`, `dispute_items`, `dispute_letters`, `dispute_responses`, `furnisher_mail_addresses`, `repair_decision_log`. These would hold client credit-dispute data if the feature ran. The app cannot read them now.
- **Key is “allow all”:** clients, accounts, staff, messages, contracts, contract signers, documents, credit results (`crs_results`), tradelines, bank accounts, bank transactions, cards on file, consents, soft pulls, `pii_identity`, session tables, magic links, password resets, webhook captures, payment links, candidates, and the rest in `pii_tables.json`. One shared app login can see every row.
- **Real partner check (21 tables):** ads, campaigns, social, brand kits, and other partner/ad tables only. Not the client file. `rls_kinds.json`

The `postgres` role can skip locks (`rolbypassrls` true). The live app URL does not use it. `identity.json` `roles.json`

### How the site connects

- Live `DATABASE_URL` user prefix: `fundhub_app` through the Supabase pooler. `identity.json`
- `fundhub_app` is not a superuser and cannot skip locks. That is what migration 104 promised.
- Superuser on this project is `supabase_admin`, not `postgres`. `postgres` can still skip locks.

### Busy tables (counts only)

| Table | Rows | What it is |
|---|---:|---|
| `auth_attempts` | 1280 | sign-in tries (emails) |
| `sessions` | 978 | staff sessions |
| `events` | 790 | event log |
| `webhook_captures` | 418 | inbound webhook bodies |
| `message_templates` | 237 | message copy |
| `account_sessions` | 180 | account sessions |
| `messages` | 84 | mail/SMS/chat |
| `pipeline_stages` | 69 | pipeline stages |
| `tasks` | 66 | tasks |
| `staff_events` | 59 | staff clock events |
| `tradelines` | 45 | credit lines |
| `payment_links` | 40 | pay links |
| `clients` | 38 | people |
| `staff` | 23 | staff |
| `cards` | 17 | pipeline cards |
| `crs_results` | 14 | credit reports |
| `soft_pull_requests` | 10 | soft pulls |
| `contracts` | 8 | contracts |
| `call_outcomes` | 6 | saved call results |

Full 175-table list with writers and readers: `tables_inventory.json`

### Column drift

- No production INSERT writes a column that is missing on live. `column_drift_verified.json`
- Live has `call_outcomes.checklist`. The save path does not write it (see BROKEN).
- Lots of unused optional columns exist. That is normal empty fields, not a missing migration. Do not treat `column_drift_unwritten.json` as a punch list.

### Foreign keys and leftovers

- 486 foreign keys. 0 broken parent links.
- 25 “set null if parent gone” columns have nulls. Most look like “never filled” (optional staff, optional document). The one that is all-null on a filled table is bank transactions (18/18). `orphans_set_null.json`

### Stop line: no app/test/config/env edits. no deploy.
