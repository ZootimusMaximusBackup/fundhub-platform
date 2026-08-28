# Copy refine + backhand selling (2026-08-26)

**Do not start tonight.** Chris named this for **9:00 a.m. America/Denver** (Wednesday 2026-08-26). He said MST; Denver keeps daylight time honest.

**COMPLIANCE REVIEW REQUIRED** on the one ops reminder SMS.

**Dest:** env `PULSE_SMS_TO` (alias `CHRIS_PULSE_SMS`). Last four `0865`. Personal cell. Not a sim. No full number on this board.

**Leave alone:** deliverables / aff-wl / sim-rule agents. Do not pause outbound.

---

## Todo (board only)

| # | Work | Status | Note |
|---|---|---|---|
| 1 | Refine AI agent copy | pending | Not tonight |
| 2 | Refine SMS + email copy | pending | Chris will edit in Claude |
| 3 | Turn on backhand selling | pending | After copy is fixed |

He wanted to fix copy first. Then turn on backhand selling.

---

## Reminder SMS (one only)

- **When:** 2026-08-26 09:00 America/Denver (`2026-08-26T15:00:00.000Z`). That is 11:00 Eastern, so quiet hours are open.
- **How:** one queued staff row on the live outbound path. `sender_staff_id` set so the existing staff sweeper can send it. `scheduled_at` set so it does not leave tonight.
- **Dest:** `PULSE_SMS_TO` last four `0865`. Did not put this number on a sim client. Did not change any phone.
- **Body:** `Zootimus: 9am reminder. Refine AI agent + SMS + email copy, then turn on backhand selling. You wanted to fix copy first.`
- **Blast:** no. One row. Idempotency key `staff:copy-refine-reminder-2026-08-26`.

### Queue result

| Field | Value |
|---|---|
| queued | yes |
| send_at | 2026-08-26T15:00:00.000Z (9:00 a.m. America/Denver / 11:00 Eastern) |
| todo path | `docs/workflows/copy-refine-2026-08-26.md` |
| dest last four | 0865 |
| message id | `10b3d25e-1731-4b72-9354-d689cd254bd7` |
| send path | existing staff sweeper (`sender_staff_id` set; `MESSAGING_DRY_RUN=0`; outbound left on) |
