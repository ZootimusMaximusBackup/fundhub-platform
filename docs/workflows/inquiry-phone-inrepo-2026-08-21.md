# Inquiry phone — in-repo (no external host)

**Mode:** Fixer · owner 2026-08-21 · everything is live  
**Ask:** Kill confusing external BASE/secret proxy. Dial from Fundhub using `vendor/inquiry-remover` prompts + Postgres PII + Bland via `bland-voice`.

## Tasks

| Id | Status | Notes |
|---|---|---|
| W1 rewrite `/api/inquiry` | done | In-repo. No BASE. Staff auth. |
| W2 bureau-call module | done | `src/inquiry-ops/bureau-call.mjs` |
| W3 Specialist Call button | done | Case detail **Call bureau** |
| W4 env | done | Local + Netlify: `FUNDHUB_REP_NUMBER`, `MESSAGING_DRY_RUN=0`, bureau numbers |
| W5 deploy | pending | One prod deploy for code + env |

## Safety

- COMPLIANCE REVIEW REQUIRED — bureau dispute phone path
- SSN reveal logged via `revealSsn`
- Outbound only through `src/messaging/providers/bland-voice.mjs`
- Never mention Vercel as a runtime in this path
