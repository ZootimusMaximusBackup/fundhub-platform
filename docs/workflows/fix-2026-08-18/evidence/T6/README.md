# T6 — Background jobs & automations · evidence and per-item verdict

Re-walked live on https://fundhub.ai on 2026-08-19 as owner@fundhub.ai.
Worktree /tmp/wt-T6, branch fix/T6-background-jobs, off origin/main d3fb2c7.

## Files here
| File | What it proves |
|---|---|
| `live-read-workflows.json` | Full body of `GET /api/read/workflows?limit=200`, owner session, 2026-08-19. 51 rows, `{"live":49,"never_triggered":2}`, `engine_active:true`. |
| `live-api-inngest-GET.txt` | `GET /api/inngest` → 401 `{"message":"Unauthorized"}`. |
| `live-ghl-probe.json` | Read-only GETs to the GoHighLevel workflow list with both production keys. No POST. |
| `live-inngest-run-detail.json` | Attempt to fetch the Inngest run detail. Returned 401 — the key did not pipe through. Unresolved, see T6-10/11/15. |
| `FINDING-journey-test-leaks-live-events.md` | New defect, not in the audit list. |
| `../../ui-audit-evidence/T6-automations/` | Full screen walk: 1440 + 390 screenshots, DOM read, 12-control click sweep, 0 API failures. |

## The one thing to read if you read nothing else

**The Automations screen counts test pokes as working automations.**

At audit time five events had never happened even once: deposit paid, inquiry removed,
inbound message, mail response, documents received. Auditors then fired those five as a
test. Every one now has a row, all stamped between 20:50 and 21:43 UTC on 2026-08-18 —
the audit window. The screen's "working" count moved from 44 to 49.

Nothing ran. Nothing changed about those jobs. The number went up because someone poked
the system. The screen calls a job "live" when an event with a matching name exists in a
log — it has no record of any job ever finishing.

## Per-item verdict

| Item | Audit said | Verdict now | Evidence |
|---|---|---|---|
| T6-01 | WORKS | **Works, with a correction.** Both Inngest keys are set on production (checked by name). But whether events emitted by the live site actually reach the job service is **unproven** — see T6-15. | `netlify env:list` by name |
| T6-02 | BROKEN | **Reproduced, then fixed.** Both jobs confirmed absent from the live registry. Registered; owner decision 2026-08-19. Guard test added. | `live-read-workflows.json` |
| T6-03 | BROKEN | **Changed, not gone.** The five dead events now have rows — created by the auditors' own test firing. The real defect (the screen cannot tell a real trigger from a test poke, or a dead event from a quiet one) stands and is fixed. | `live-read-workflows.json` vs `g5/db.json` |
| T6-04 | UNCLEAR | **Reproduced and diagnosed exactly.** The only two rows marked "never triggered" are the two clock jobs. They carry no event name, so the lookup can never find one, so they are permanently labelled dead. Fixed. | `live-read-workflows.json` |
| T6-05 | BROKEN | **Reproduced and sharpened.** The relay key is **valid** — it returns "not authorized for this scope", i.e. it is missing one permission. The other key is genuinely invalid. The third key the audit tested is not set on production at all. **Blocked:** fixing it is a settings change inside GoHighLevel. | `live-ghl-probe.json` |
| T6-06 | UNTESTED | **Still blocked** by T6-05. | — |
| T6-07 | UNTESTED | **Investigated.** The old catch-URLs exist only under `vendor/` (UnderwriteIQ, inquiry-remover) — separate apps. Nothing in the Fundhub platform posts to them. Residual risk is whether those vendor apps are still deployed, which is outside this repo. | `grep` over the tree |
| T6-08 | UNTESTED | **Still blocked** by T6-05. | — |
| T6-09 | BROKEN | **Reproduced; real cause found and fixed.** Not the registry, as scouted — that is healthy, 51/51. The run was walking two **demo** journeys, whose keys have no start event, so nothing fired. Their presence also stopped the six real journeys from ever being tested. | recon repro + `w5/owner-jny-05-runcode.png` |
| T6-10 | BROKEN | **Explained, not fixed here.** c-03 has no local handler — it is job-service-only. Combined with unproven forwarding, it cannot run. The emitter and the key are other threads'. | recon |
| T6-11 | BROKEN | **Same root cause** as T6-10. | recon |
| T6-12 | BROKEN | **Confirmed.** Addressed by telling the truth per row — "nothing emits this event" is now a different status from "not triggered yet". Making the events fire belongs to other threads. | emitter index |
| T6-13 | BROKEN | **Not a defect.** The four "silent" handlers listen for booking created, deposit paid, sale closed, round funded, round closeout, payment disputed, payment refunded and inbound message. **Not one of those was among the ten events the audit fired.** They were correctly silent. | `src/register-all.mjs`, `src/handlers/*` |
| T6-14 | BROKEN | **Half misdiagnosed, half real.** The 401 on the job door is **correct security** — the job service requires a signed request and rejects a browser. Not a fault. The real defect (status computed from an event log, never from a run record) is reproduced and fixed. | `live-api-inngest-GET.txt` |
| T6-15 | WORKS | **Narrowed.** Some job service has genuinely executed function bodies. But tying the 21:46 runs to that evening's booking is **not supported** — the job service's own event stream for that window contains none of our events, and the deploy carrying the keys published five minutes *after* those runs. | two independent adversarial reviews |

## Open question I could not close

Whether events emitted by the live site actually reach the job service **today**.
Both keys are set now and the rebuild that carried them published at 21:51:40 UTC on
2026-08-18; nobody has checked since. One read-only call settles it, and it needs the
signing key, which this session could not read:

    GET https://api.inngest.com/v2/runs/<run id>   with the signing key as a bearer token

I attempted it twice; the key would not pipe through and the second attempt was blocked
by this session's permission rules. Stopped there per the repo's two-attempt rule.
