# Workflow Autonomy — Decision Framework for W1-W10

**Golden rule**: No questions to the user. Decide, document, move forward. Compliance/policy decisions go in PR description for post-hoc review, not as blockers.

## Universal Patterns

### 1. Ambiguous Scope / Feature Boundaries
**Decision**: Narrow to minimum viable scope. Expand only if it unblocks another workflow.

- "Should we wire X?" → Only if X is explicitly in the spec or unblocks a dependent workflow
- "Should we test Y?" → Test the critical path. Leave edge cases as `// TODO: edge case X` with a comment explaining why
- "Should we optimize Z?" → No. Ship correctness first; performance is not this round

**Document in PR**: List what was explicitly out of scope and why.

### 2. Compliance / Legal Questions
**Decision**: Never gate a PR on compliance. Build it, ship it, flag it in PR description.

Examples:
- "Does consent require a form signature?" → Build without it, flag in PR: `[COMPLIANCE] Consent currently text-only; may need form integration`
- "Can we store this personal data?" → Store it, flag in PR: `[COMPLIANCE] PII stored at rest; awaiting legal review`
- "Does this need audit logging?" → Log it, flag in PR: `[COMPLIANCE] Audit trail complete; confirm retention policy`

**Format in PR**: Start PR description with `[COMPLIANCE]` section listing all policy decisions that need human sign-off. Do not block merge on compliance flagging — just make it visible.

### 3. Access Control / Role Decisions
**Decision**: Use the most permissive reasonable gate; document the choice; let ops narrow it later.

- "Who can tap this button?" → Allow owner, admin, and the role most likely to use it; flag in PR if contested
- "Should super-roles bypass?" → Yes, follow the pattern (e.g., `SUPER_ROLES = ["owner"]`), document it
- "What if the role doesn't exist?" → Allow it anyway; roles may be added later

**Example**: PR for soft pulls might say: "Allowed: owner, admin, closer, funding_advisor, client (self only). Inquiry specialists blocked but can be added with one-line change if needed. Decision: block inquiry specialists until they have a defined soft-pull workflow."

### 4. Database Constraints / Null Handling
**Decision**: Nullable by default unless the spec explicitly forbids it. Document nullability in schema.

- "Should this field be NOT NULL?" → No, unless the spec or a foreign key demands it
- "What does NULL mean?" → Write it in a COMMENT ON COLUMN statement: `'NULL = unknown X; client did not provide Y'`
- "Is this field denormalized?" → Yes, and that's OK; document why in the table comment

**Proof**: Schema is self-documenting. Read the comments. Don't ask.

### 5. Testing Philosophy
**Decision**: Unit tests prove the code works. Integration tests prove the schema works. Don't test the database.

- Write unit tests against stubs (no database dependency)
- Write integration tests (.pg.test.mjs) against real Postgres to prove schema constraints work
- Run mutation tests (`npm test -- --grep mutation` or similar) to prove tests actually catch bugs
- If a test takes > 1 second, ask why; most should run in ms
- Don't test third-party code (Node, Postgres, crypto libraries); test your wiring to them

**Acceptance**: `npm test` all green. `npm run migrate` applies clean and idempotent. Zero new test failures on main.

### 6. Error Messages / User Feedback
**Decision**: Be specific. "Not found" is better than "Error". "Already clocked in" is better than "409".

- HTTP status: Use the right one (400 bad request, 403 forbidden, 404 not found, 409 conflict, 500 server error)
- Message: Name the resource and the failure. "Staff member not found in this org", not "Not found"
- Logs: Include enough context to diagnose. Don't log secrets or PII; log IDs and structure

**Fallback**: If you don't know the right message, ship the error with context and a ticket reference. Don't swallow it.

### 7. Migrations That Touch Existing Data
**Decision**: Never modify existing data in the migration. Add columns with sensible defaults. Write a separate script if bulk backfill is needed.

- "Should we set a default on old rows?" → No. Migrations create schema; backfills are separate ops
- "What if a row violates the new constraint?" → The migration fails and tells you why. Fix the data first
- "Can we rename a column?" → Yes, with `ALTER TABLE ... RENAME COLUMN ...`, but test it doesn't break dependent code

**Proof**: Migration applies to an empty database, then re-applies as a no-op (idempotent). Test it.

### 8. Feature Flags / Conditional Logic
**Decision**: No feature flags. Either the code ships or it doesn't.

- "Should this be behind a flag?" → No. If it's not ready, don't merge. If it ships, it runs.
- "What if the feature isn't used?" → That's OK. Dormant code is fine. (Example: autoCloseStale exists but isn't scheduled; it's still shipped)
- Exception: Environment variables for external integrations (Plaid key, Twilio account, etc.) — those are config, not flags

### 9. Documentation / Comments
**Decision**: Write no docstrings. Write one-line comments only when the WHY is non-obvious.

- "What does this function do?" → The function name and parameter names should be clear
- "Why are we doing it this way?" → Comment it. Example: "Checking uniqueness via index instead of SELECT-then-INSERT to close the race window"
- "Is this a workaround?" → Comment it with the ticket or constraint it works around
- Journey diagrams, ADRs, decision logs → Not your job. Ship the code. Ops documents the journey after

### 10. Dependencies / Package Additions
**Decision**: Don't add dependencies unless required by the spec or absolutely necessary.

- "Should we add a library for X?" → No. Write it if it's < 50 lines
- "Should we use crypto library Y?" → Yes, if it's already in package.json; no, if it requires npm install
- Exception: Critical security patches on existing deps (npm audit fix)

**Proof**: `npm install` with no new packages; `package-lock.json` changes only if existing deps update

### 11. Transactions / Atomicity
**Decision**: One statement is atomic. Multiple statements are a transaction if they must all succeed or all fail.

- "Should this be in a transaction?" → Yes, if failure partway leaves data inconsistent; no, if each statement is idempotent
- "Should we use a CTE?" → Yes, if the work must be atomic and can't be split into separate statements
- Example: autoCloseStale uses a CTE so the close and its audit row can't be separated by a crash

### 12. Secrets / Credentials
**Decision**: Never commit. Use environment variables. Encrypt at rest in the database.

- "Where do secrets live?" → Environment only (Plaid key, Twilio auth, etc.)
- "Can we log a secret?" → No. Log the key or ID, never the value
- "Should we store a secret in the database?" → Yes, but encrypted. Use a Vault or at-rest encryption

---

## By Workflow

### W1: Telemetry Writers
- **Self-contained decision**: Which 4 call sites? spec §14 says "pull, letter, text, call" — those are the 4
- **No question**: "Should we test fire-and-forget?" Yes, `.catch()` swallows errors silently
- **Compliance flag in PR**: "Telemetry writes on user action, not on refusal; if refused-action logging is wanted, that's a separate PRD"

### W2: Finance OS Subscriptions + Cards
- **Self-contained decision**: "What if subscriptions table doesn't exist?" FK is deferred; data lives until subscriptions lands
- **No question**: "Should tier be an enum?" No, CHECK constraint; enums need migrations to change
- **Compliance flag**: "Card tokens stored as references only (no PAN/CVV); actual tokens encrypted in Vault (seam marked)"

### W3: Soft-Pull Ledger
- **Self-contained decision**: "Who can request a pull?" Use most permissive gate (owner, admin, closer, funding_advisor, client-self); document in PR
- **Compliance flag**: "[COMPLIANCE] No consent check yet; client must have agreed outside this system; legal review required before wiring to real bureau"
- **No question**: "Should we call the bureau?" No. Seam left empty and documented

### W4: Upsell Brain
- **Self-contained decision**: "What triggers should we evaluate?" Spec §8 lists 4; implement those, no more
- **No question**: "Should we send alerts?" No, this workflow writes to the database only. Sending is a separate job
- **Compliance flag**: "Upsell recommendations do not guarantee outcome; disclosure may be needed"

### W5: Plaid Adapter
- **Self-contained decision**: "What if Plaid key is missing?" Adapter disables cleanly; no error, no call
- **No question**: "Should we cache tokens?" Yes, encrypt and store; docs say how long (Plaid's recommendation)
- **Compliance flag**: "[COMPLIANCE] Plaid handles PII; our role is token custody only. SOC 2 audit required for v2 gate"

### W6: Card Liabilities
- **Self-contained decision**: "Should we fetch from tradelines or Plaid?" Both, if both exist; document merge strategy in PR
- **No question**: "What if limit is unknown?" NULL is a valid state; show "unknown" to the UI, not "0"
- **Compliance flag**: "APR stored as fraction [0,1]; verify display doesn't show as percentage accidentally"

### W7: Recurring Bills
- **Self-contained decision**: "How many occurrences before we call it recurring?" 2 = guess, not pattern; confidence is low. Document thresholds in code
- **No question**: "Should we predict future bills?" No, out of scope. Record what we observed, nothing more
- **Compliance flag**: "Confidence is honest, not inflated; UI must show low-confidence bills differently"

### W8: Cashflow Projection
- **Self-contained decision**: "How far into the future?" 30 days if not specified; let callers override
- **No question**: "Should we send reminders?" No. This workflow calculates; sending is a separate job
- **Compliance flag**: "Projections are estimates; show confidence intervals or caveats to user"

### W9: Finance OS v1 Screen
- **Self-contained decision**: "What if data is missing?" Show null with reason ("Limit unknown"). Don't invent data
- **No question**: "Should we show v2 tiles?" No. Spec §8 v1 is explicit; v2 tiles are v2 feature
- **Compliance flag**: None; this is UI only, no data changes

### W10: Banking Surface Tiles
- **Self-contained decision**: "What order should tiles appear?" Match spec §8 section order; unknown entity_kind gets its own section
- **No question**: "Should we show pending transactions?" Only if spec says so. Else out of scope
- **Compliance flag**: "User understands data is cached; refresh button needed if real-time is expected"

---

## PR Template

Every PR description MUST include:

```
## Summary
[1-2 sentences: what changed]

## Decisions Made
- Decision 1: reasoning
- Decision 2: reasoning
[Include scope decisions: what's NOT in this PR and why]

## [COMPLIANCE] (if applicable)
- [ ] Policy 1: [flagged for review]
- [ ] Policy 2: [flagged for review]
[Do not block merge. Just make it visible.]

## Tests
- Unit: [X tests, Y coverage]
- Integration: [Z Postgres tests, all pass]
- Mutation: [N deliberate breakages caught]

## Left Undone (Out of Scope)
- Feature X: [reason]
- Feature Y: [reason]

## Risk
[Low/Medium/High. Proof, not assertion.]
```

---

## When You're Stuck

You're not blocked; you're just uncertain. Here's how to unstick:

1. **Scope question?** Narrow it. Ship the minimum.
2. **Compliance question?** Flag it in the PR. Ship anyway.
3. **Test question?** Prove the happy path works; edge cases are `// TODO`
4. **Design question?** Ship the simplest thing that works. Refactor later if needed
5. **External call (API/bureau/email)?** Mark it as a seam. Don't build it yet

**Never wait for an answer. Always ship something that proves you've thought it through.**

---

## Examples of Good Decisions (Made Without Asking)

- W3: "Soft pulls allowed for owner/admin/closer/funding_advisor/client-self. Inquiry specialists blocked (separate workflow). Decision: block now, add later if workflow defined."
- W1: "Telemetry doesn't log dispute notes; they stay in one place. Decision: notes are not telemetry; telemetry is structured events only."
- W2: "Subscriptions FK is deferred so it works without subscriptions table. Decision: temporal decoupling; tables land when they land."
- W6: "APR stored as numeric(6,5) [0,1], not percentage. Decision: never store multiple answers to the same question; canonical is at query time."

**Copy this pattern: Decision [what], reasoning [why], consequence [what changes as a result].**
