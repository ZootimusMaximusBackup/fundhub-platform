# Wave 3 browser checks — run these, do not read them

These drive a real Chromium over the three screens wave 3 touched and assert what is on them.
Written 2026-09-05, all passing on that date.

**They live here and not in `docs/workflows/wave-3-evidence/` on purpose.** `.gitignore:29-30`
keeps every `*-evidence/` folder out of the repository, which is right for screenshot dumps and
wrong for the code that produced them — an evidence folder in an ephemeral container is a set of
checks nobody can re-run. The PNGs stayed ignored. These did not.

## Running them

```bash
node docs/workflows/wave-3-checks/fixture-server.mjs &     # serves public/ on :8099
node docs/workflows/wave-3-checks/check-progress.mjs
node docs/workflows/wave-3-checks/check-affiliate.mjs
node docs/workflows/wave-3-checks/check-portal.mjs
```

## check-progress-live.mjs — the same page, against the REAL endpoints

The three above run anywhere, because a fixture answers for the server. This one
does not: it needs a Postgres with the migrations applied, a seeded client, and a
server running the real `netlify/functions/api.mjs` in front of `public/`. What it
buys is the difference between "the screen renders this shape" and "the whole path
works" — and it earned that on the run it was written for, catching two pieces of
wrong copy that no fixture could have.

Set it up with the seed script here, which prints the token on its last line:

```bash
DATABASE_URL=<scratch db> node docs/workflows/wave-3-checks/seed-live-client.mjs
```

Then run the check with that token in `TOK`:

```bash
TOK=<a client account session token> node docs/workflows/wave-3-checks/check-progress-live.mjs
```

Every field must be `true` and `errors` empty, except `startedFrom` and
`postOutcome`, which report which path the run took rather than pass or fail.

TWO OUTCOMES OF THE ROUND BUTTON ARE BOTH CORRECT and the check accepts either.
A first press whose checkout cannot be minted answers 502 with the server's own
refusal sentence; a repeat press answers ok:true with `checkout_pending`, which is
the losing side of a race where the winning press is minting the link right then.
What is asserted in both: the client is told no money moved, the page never claims
a payment succeeded, and the reassurance is not printed twice. Without a payment
key configured the first branch is what you will see, and that is not a failure of
the page.

Each prints one JSON object. **`missing`, `banned` and `errors` must be empty arrays, and every
other field must be `true`.** There is no field where `false` is the pass — the names were written
so that reading the output needs no key.

`errors` deliberately ignores a blocked request to `fonts.googleapis.com`. These pages link that
stylesheet, and a sandbox with no outbound network logs a resource error for it that says nothing
about the code under test. Any other console error or page error is collected and fails the run.

They import `playwright` and resolve `public/` relative to their own location, so they work from
any checkout. Run them from the repository root.

## THE DATA IS A FIXTURE. READ THIS BEFORE QUOTING A PASS.

`fixture-server.mjs` answers `/api/read/client-progress` and `/api/read/affiliate-portal` with
hand-written JSON in the shapes `docs/workflows/portal-progress-contract.md` and
`api/read/affiliate-portal.mjs` describe. It has to, because the progress endpoint is built by a
different lane and is not in this checkout.

So a pass here proves the SCREENS render those shapes correctly, including every case where a value
is unknown. It proves NOTHING about whether a real endpoint returns them for a real client. That is
a walkthrough on a scratch database once wave 2 lands, and it is not this.

## What each one covers

**check-progress.mjs** — the stage sentence, the bureau deadline, both movement lines, a bureau
that reads "not pulled yet", exactly one next step and whose move it is, the business toggle
switching rather than blending, the round price, the "does not use one of your included rounds"
line, the timeline, the referral button. Then: neither banned phrase appears, no zero appears in
the score panels, the business panel actually changes when toggled, the first dialog itemises the
price and says nothing is charged, and the second dialog repeats the amount and says a human sends
the round.

**check-affiliate.mjs** — the table no longer says "No referrals on file", a referral appears, a
commission the ledger has not calculated stays a dash, the real 20% and 5% rates are shown, the
"60d" cookie tile is gone and the honest attribution line replaced it, both payout gates appear,
the affiliate's code is shown, and the banned phrase does not appear.

**check-portal.mjs** — the eight-tick stepper is gone from the DOM, the honest pre-call stepper is
still there, the progress-page link is present, and the Activity tab paints real rows instead of
"No activity recorded".
