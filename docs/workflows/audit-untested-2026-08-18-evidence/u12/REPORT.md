# WAVE E rollup

| id | Claim | Result |
|---|---|---|
| U11 | Pipeline MOVE / archive (test card only) | **PASS** on MOVE. Archive not tried. |
| U12 | Hire / Reject does what the button says | **BROKEN.** Drawer is read-only. No write API. Did not press. |

U11 evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u11/`  
U12 evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u12/`

---

# U12 findings — Hire or reject (demo only)

Walked 2026-08-18 on `https://fundhub.ai`. Owner `chris@fundhub.ai`. Opened Hiring. Opened one **DEMO** application. Did not press Hire or Reject. Did not email anyone. Did not reset a password. Did not revoke a login. Never opened the live credit file.

Ground truth: owner **can open** Hiring (6 routes) in `role-owner-intended.md`. There is **no** intended step that Hire / Reject writes. Scored Chris’s claim on the board.

Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u12/`  
Logs: `db.json` `walk.json` `drawer.json`  
Shots: `00-owner-login.png` `u12-hiring.png` `u12-board-scroll.png` `u12-drawer-demo.png`

## What I did

- Counted `candidates`. There are **3**. All three are demo (`is_demo`, `platform_demo`, name starts with DEMO, email on `demo.fundhub.local`).
- Opened Owner Hiring. Footer: `hiring · read-only · candidates: loaded`.
- Live `GET /api/hiring/candidates` → **200**, 3 rows, all demo.
- Demo mode is off, so the board paints **0** cards. The three demo rows are hidden.
- Opened the DEMO application that is still in Applied. Drawer says the panel cannot be changed. The only button is close.
- Tried `POST` on all six `/api/hiring/*` doors. All six returned **405** `method_not_allowed`.
- `hiring_decisions` before and after: **0**.

## Score

| Ask | Result |
|---|---|
| Is the drawer read-only? | **Yes.** “Nothing in this panel can be changed — it only shows what was recorded.” Shot: `u12-drawer-demo.png`. |
| Is there a hire/reject API? | **No.** All six hiring routes refuse POST (**405**). `src/hiring/pipeline.mjs` has `reject()`, but nothing on the live site calls it. |
| Demo candidate + write path → press Reject | **No write path.** Did not press. Did not email. |
| Chris’s claim | **BROKEN.** There is no Hire or Reject button that writes. |

## BROKEN

- Journey step for Hire / Reject write: **MISSING.**
- Expected (board): Hire / Reject does what the button says, on a demo row only.
- Observed: 3 demo people exist. Board hides them (demo mode off). Drawer is read-only. POST hire/reject does not exist. Decision rows still **0**.
- Evidence: `u12-drawer-demo.png` `walk.json` `db.json`

## What I did not do

- No Hire. No Reject.
- No email to an applicant.
- No password reset. No login revoke.
- No live credit file.
- Did not call the internal `reject()` helper. That is not a site button.
- No deploy. No app, test, config, env, or intended-journey edits.

## Stop

Chris names what to fix.
