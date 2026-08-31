# Board — partner flywheel

Standing batch, not a dated one. The flywheel keeps running; this file tracks it.

Contract and how to run it: `docs/flywheel/README.md`. Command: `.claude/commands/flywheel.md`.

## Stages

| # | Stage | Owner | Status | Notes |
|---|---|---|---|---|
| 1 | Avatar | `avatar-builder.js` | **done** | Seeded from the existing `docs/avatars/partner/` research rather than re-run. 133 quotes, 203 sourced phrases, measured. Assumed avatar by owner decision. |
| 2 | Ad research | `ad-research.js` | **built, first run in progress** | Ad Library deliberately not used. Reads what competitors sell — funnels, prices, promises — instead of the ads that sell it. |
| 3 | Offer | `offer.js` | **built, not run** | Six candidates from assigned archetypes, four judges with different jobs, winner keeps the best parts of the losers. |
| 4 | Copy | `copy.js` | **built, not run** | The humanizer runs as a regex in the script. A piece still dirty after three passes is dropped, not shipped with a warning. |
| 5 | Ad strategy | `ad-strategy.js` | **built, not run** | Small on purpose. Exists for the checks, not the choosing. |
| 6 | Spend | none needed | **not started** | `META_ACCESS_TOKEN` reads Fundhub's own ad account, so no manual export. |

## Shared context

**The chain.** Each stage reads only the previous stage's handoff file. Stage 4
also reads the language bank, because `COPY-DIRECTIVES.md` is owner-set and
requires copy be written from the market's own recurring phrases.

**Ids travel.** Stage 2 gives each angle an `angleId`. Stage 4 carries it onto
every `pieceId`. Stage 5 names ad sets by `pieceId`. That chain is what lets
spend at stage 6 map back to an avatar pain. If the ids break, stage 6 becomes a
manual reconciliation job forever.

**Staleness is arithmetic.** `npm run flywheel:status`. Re-running a stage
changes its body fingerprint, which marks everything downstream stale
automatically. Nobody has to remember.

## What the platform actually allows — measured 2026-08-31

Worth recording, because two of these contradicted what the plan assumed.

- Workflow scripts **cannot import anything**. No sibling files, no node
  builtins, no `crypto`. The launcher rejects the script outright. Shared code is
  duplicated across the four workflow files on purpose; keep it in sync by hand.
- `Date.now()`, `Math.random()` and `new Date()` **all throw** inside a workflow.
  Every workflow takes `today` as a required argument.
- Agents inside workflows **do have Bash**, and they run on this Mac at
  `/Users/zootimusmaximus/fundhub-platform` — not in a container, no proxy. So
  the deterministic checks work, and the blocking recorded in
  `Market_Language_Bank.md` was a different, hosted environment.
- The **Skill tool cannot see user-level skills** from inside a workflow — it
  answers "Unknown skill: offer". Agents read the SKILL.md files from disk
  instead. Every workflow that needs doctrine loads it that way and stops if it
  cannot find it.

## Open

- [ ] Ad Library API access — blocked on Chris. Identity at https://www.facebook.com/ID,
      then https://www.facebook.com/ads/library/api. May not help: Meta's docs say
      non-EU ads only return if political, though the API does have a
      `FINANCIAL_PRODUCTS_AND_SERVICES_ADS` type. Cannot be settled until the app
      is approved. Nothing waits on it.
- [ ] Stage 6 has no workflow yet. It is arithmetic over ad results plus one
      decision, so it may not need one.

## Decisions

- **2026-08-31 — the avatar is assumed and that is final.** Build offers and
  campaigns straight off it. No "validate first" riders. Spend is the validation.
- **2026-08-31 — no compliance checking in this pipeline.** The product already
  screens ads before they send, in `src/compliance/`. The staleness gate no
  longer requires a compliance marker on any stage.
- **2026-08-31 — competitor spend is not observable.** Ad research ranks by how
  long something has run and how many versions exist, and says so in its own
  output rather than implying it measured money.
