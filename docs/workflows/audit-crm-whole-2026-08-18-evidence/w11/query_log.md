# W11 query log

All statements were SELECT / catalog reads. No INSERT, UPDATE, DELETE, or ALTER.

Connected as the live `DATABASE_URL` role. Role name only: `fundhub_app`. Connection string not written.

Scripts (read-only):

- `_inventory.mjs` — role flags, public tables, exact `count(*)`, columns, `pg_policies`, first FK attempt, `schema_migrations`, 170/171 existence, PII-shaped column names
- `_orphans.mjs` — namespaces, roles, RLS coverage, views, guessed-parent orphan counts
- `_scan.mjs` — repo INSERT/UPDATE/FROM/JOIN map (no database)
- `_migrations_diff.mjs` — files on disk vs `schema_migrations` (no database)
- `_fk_and_rls.mjs` — `pg_constraint` foreign keys, FK orphan counts, SET NULL null counts, marketing schema probe, other-schema table counts (names only)
- `_confirm_fill.mjs` — 170/171 fill counts (no row payloads)

Evidence JSON in this folder. No client names, emails, phones, SSNs, addresses, or secrets.
