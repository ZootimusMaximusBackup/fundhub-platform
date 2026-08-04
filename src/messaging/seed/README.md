# message_templates seeder

Parses the copy source-of-truth docs in `fundhub-docs/sources` and upserts one
`message_templates` row per template.

```bash
npm run migrate                                  # needs db/seed/006_… for source_doc
DATABASE_URL=postgres://… node src/messaging/seed/seed.mjs
                              node src/messaging/seed/seed.mjs --dry-run
                              node src/messaging/seed/seed.mjs --docs=/path/to/fundhub-docs/sources
```

It is a **parser, not a transcription**. Edit the copy in a doc, re-run, and the
rows follow — nobody edits a hardcoded list. Copy is taken **verbatim**: no
rewording, no reflowing, no typo fixes, emoji and en-dashes intact.

Idempotent via `ON CONFLICT (org_id, template_key) DO UPDATE`. Re-running is safe
and converges the rows on whatever the docs currently say.

## Sources

| Doc | Channel | Notes |
|---|---|---|
| `SMS-Compliant-Rewrites.md` | sms | audited + reworded |
| `Workflow-SMS-Fixes-Ready-to-Paste.md` | sms | audited + reworded |
| `EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md` | email | never compliance-audited |

**`compliance_passed` is always written `false`.** Owner decision 2026-08-04:
nothing sends until a human approves in the template editor (migration 116).

Workflow keys (`EMAIL-F03-ROUND-SUBMITTED`, etc.) often differ from doc IDs.
`workflow-keys.mjs` aliases them to doc copy, falls back to
`src/workflows/templates-seed.mjs`, or seeds a clearly marked `[DRAFT — NO
SOURCE COPY]` body.

## Keys

Snippet-library SMS and GHL emails keep their existing IDs verbatim
(`SMS-F03-01-ROUND-SUBMITTED`, `AR-PP1`). Workflow-inline SMS have no ID of their
own, so one is derived from the section header and is stable across re-seeds:

```
## AI-SET-03 — No-Answer SMS Cadence  (3 messages)
  → SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-01 / -02 / -03
```

## Layout

| File | |
|---|---|
| `seed.mjs` | CLI + the upsert |
| `collect.mjs` | source manifest, doc-dir resolution, validation |
| `parse-sms.mjs` / `parse-email.mjs` | the parsers |
| `merge-tags.mjs` | distinct merge tags across all seeded copy |
| `workflow-audit.mjs` | dangling keys + copy still hardcoded in workflow files |
| `report.mjs` | the report both `--dry-run` and a real run print |
| `fixtures/` | miniature docs so the tests need neither `fundhub-docs` nor Postgres |

## Tests

```bash
node --test src/messaging/seed/*.test.mjs                  # 52, no Postgres needed
DATABASE_URL=… node --test src/messaging/seed/*.test.mjs   # +7 live-Postgres
```

`npm test`'s glob (`src/**/*.test.mjs`) runs under `/bin/sh` → dash, where `**`
collapses to `*` — so it only reaches `src/*/*.test.mjs` and does **not** pick up
this directory. Changing the script to plain `node --test` discovers all of them
(verified: 186 pass). `package.json` is outside this task's ownership boundary,
so that change is left to whoever owns it.
