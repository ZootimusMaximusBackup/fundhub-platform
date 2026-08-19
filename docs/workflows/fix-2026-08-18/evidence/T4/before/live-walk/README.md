# Live signed-in walk — the Specialist desk as it stands today

Run 2026-08-19 11:01 UTC against `https://fundhub.ai`, signed in as
`inquiry@fundhub.ai` (role `inquiry_specialist`). Login returned 200 and landed on
`/app/inquiry-remover.html`. Read-only: the harness answers every write request with a
599, so nothing was created, sent, mailed or changed.

## What the screen showed

| Thing | What it said | Item |
|---|---|---|
| Need me tile | `—` | T4-02 |
| Worked tile | `—` | T4-10 |
| Calls tile | `—` | T4-10 |
| Confirmed tile | `—` | T4-10 |
| Work Queue | `Loading inquiry queue…` | T4-03 |
| Bureau chips | `none in queue` | T4-10 |

**No API request failed.** `apiFails` is empty. So this is not the server being slow or
refusing anything — the page simply never asks. That matches the cause found in the code:
the page gives up before it makes the request.

This is the **before** picture. The same six things are checked by
`../../proof-inquiry-desk.mjs`, which fails on this version of the page and passes on the
fixed one.

## Files

- `audit.json` — the full machine record, including `dom.metrics` (the four dashes) and
  `dom.loadingWording` (`["Loading inquiry queue…"]`).
- `audit.md` — the human-readable version.
- `1440-full.png` — full-page screenshot at desktop width.
