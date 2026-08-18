# W-WF findings (workflows vs live shape)

Ground truth for this machine is Chris’s 2026-08-18 board. Intended journeys do **not** name these jobs. That gap is **MISSING**.

Inngest (the job service) did **not** run. That is a finding, not a pass. This audit did not turn the key on. Nobody sent a job to that service. Do not invent that it ran.

## Events that actually fired on this file

Ten names. Thirteen rows (eleven with this client id; two money rows with no client id but this email).

| event | who wrote it |
|---|---|
| docs.received | W-DESKS live upload, then W-INB again |
| analysis.completed | W-CRS |
| decision.rendered | W-CRS |
| payment.received | W-PAY (with id, and without id) |
| diagnostic.paid | W-PAY (with id, and without id) |
| contract.sent | W-SIG |
| contract.signed | W-SIG |
| mail.response | W-INB |
| round.approved | W-INB local F-11 leftover |
| inquiry.removed | W-INB (fake; case still Queued) |

W-UW, W-OPT, W-CONSENT, W-CONV, W-INTAKE, W-MSG wrote no event. W-DESKS has no events file, but the upload row is in the table. W-SIG and W-INB folders are complete.

## The 51 registered jobs

Zero ran on the live job service. Zero errored (dead-letter table empty).

**6 local-handle-only** (someone called `handle()` on this machine; the job service still did not):

- c-00 (W-PAY)
- c-06 (W-CRS)
- c-03, f-06, f-09, f-11 (W-INB)

**34 could never fire for this file**

- Two are clocks (contract chaser, message sweeper). The clock is off.
- The rest wait for events this file never had: new lead (`entry.captured`), survey, booking, call done, deposit paid, round started / submitted / funded, inbound text.

**11 had their event, and still did not run** (job service off; nobody called `handle()`): af-02, c-02, dpc-01, ds-02, f-04, f-05, sys-01-client-value, u-02, u-03, u-04, u-05.

Proof the job service stayed off: after `analysis.completed`, the “last progress” field is still empty. The CRS snapshot tag never landed.

Sign events have **no** job and **no** bus listener. That matches W-SIG / W10.

## Bus handlers (not the job service)

These ran when a unit called `emit` on this machine (or the live upload path):

| handler | ran? |
|---|---|
| client-lifecycle | yes — scores merge, money estimate, paid flag |
| money-chain | yes — two $32 rows + one sale |
| diagnostic-soft-pull | yes — same c-00 stop: no portal account |
| comms | yes — one bank inbox row on `mail.response` |
| inquiry-docs | yes — no flip (case was Queued, not Blocked) |
| payment-links | called; zero links |
| customer-insights | silent |
| inquiry-gate | silent |
| commas-disputes | silent |
| agent-runtime | silent |

Two job files exist on disk but are **not** in `src/workflows/index.mjs`: inquiry-call-sweeper, s-02.

Client was not torn down.
