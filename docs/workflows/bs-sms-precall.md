# BS SMS pre-call — 2026-08-15

**Owner:** SMS back-end selling (thin drip). No video links. Not agentic — scheduled templates like email BS-01. GHL is out.

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | 3 SMS templates + seed (no video) | this chat | done |
| W2 | Wire into `bs-01-precall-launcher` + tests | this chat | done |
| W3 | Journeys / changelog | this chat | done |

## Cadence (locked)

| # | Key | When | Gate |
|---|---|---|---|
| 1 | `SMS-BS01-01-BOOKED` | immediately on `booking.created` | none |
| 2 | `SMS-BS01-02-PRECALL` | +24h | exit if call held |
| 3 | `SMS-BS01-03-DAYOF` | 2h before `startTime` (skip if no start time) | exit if call held |

Same for funding and repair — one SMS set (no path split). Email grid unchanged.

## Agents note (for Chris)

| Job | Platform | GHL? |
|---|---|---|
| Voice (Josh / bureaus) | **Bland** API | No — webhooks to Fundhub |
| Inbound SMS/email bots | **Anthropic** (`ANTHROPIC_API_KEY`) via `src/agents/` | No — GHL agent rows are registry seeds only |
| Outbound SMS/email | **Twilio / Resend** | GHL relay stubbed off |
| Pre-call drip (email + SMS) | **Inngest** workflows | No |

## Manifest

**Files**
- `src/workflows/bs-01-precall-launcher.mjs` — `runSmsDrip` parallel with email
- `src/workflows/bs-01-precall-launcher.test.mjs` — +4 SMS tests (21 pass)
- `src/workflows/templates-seed.mjs` — three SMS keys
- `db/seed/010_bs_sms_precall.sql` — live seed, compliance_passed=true
- `db/expected-migrations.mjs` — regenerated
- `docs/journeys/CHANGELOG.md`

**Routes:** none new  
**Journeys:** client messaging path (Inngest); route actuals unchanged
