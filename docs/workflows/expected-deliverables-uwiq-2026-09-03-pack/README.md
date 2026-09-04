# UnderwriteIQ pack — Sim Five-Academy, 2026-09-03 (SIMULATED DATA)

Everything here is generated from a FAKE credit file written by `scripts/sim/push-credit.mjs`
(profile `academy`). No bureau was called. No real person.

- `sim-five-credit-report.md` / `-raw.json` — the simulated credit file the engine read.
- `Credit-Analysis-Report.pdf`, `Funding-Snapshot.pdf`, `Bank-Lender-Match-List.pdf`,
  `Credit-Optimization-Roadmap.pdf` — the four documents C-06 SHOULD save to the client portal.
- `Capital-Readiness-Summary.pdf` — built by the live code and then dropped by the saver (F46).
- `empty-pack.txt` — what the deck's "Send deliverables package now" button actually produced: nothing.

Built offline with the real `buildLetterPack()` and the Node/pdf-lib printer Netlify uses.
The live system has NEVER produced these for any client (F42). Spec: `../expected-deliverables-uwiq-2026-09-03.md`.
