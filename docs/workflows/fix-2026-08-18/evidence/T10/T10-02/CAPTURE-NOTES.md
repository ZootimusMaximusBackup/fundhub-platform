# T10-02 — how these pictures were taken

Screen: `public/app/partner-galaxy.html`, the partner Home screen.
Date: 2026-08-19. Branch: `fix/T10-affiliate-partner`.

## The two pictures

| File | What it shows |
|---|---|
| `before-1440-partner-galaxy.png` | the screen as it stands in the last commit (`git show HEAD:public/app/partner-galaxy.html`) |
| `after-1440-partner-galaxy.png` | the screen after this change |

Both taken in a real browser (Playwright), window 1440 wide.

## What changed in the picture

Before: six labelled boxes along the bottom — CASH COLLECTED TODAY, FUNDED
TODAY, CLOSE RATE, SHOW RATE, MOVEMENT TODAY, COST / FUNDED CLIENT. The caption
strip along the top ended with "flare = money landing".

After: the six boxes are gone, the sky fills the space they left, and the
caption strip no longer mentions money.

The only dollar figure left anywhere on the screen is in the green data badge at
the very bottom: "1 partner(s) · $1,250 accrued". That figure is read from the
server (`/api/read/partners`, the partner's own row only) — it is not invented,
and it is deliberately kept.

## Honest note about the "before" picture

In the before picture the six boxes read as dashes, not as dollar amounts. That
is because an earlier change had already emptied the list of pretend workers the
screen used to animate, and the dice-roll that produced the dollar figures only
fires when that list has something in it.

**The dice-roll itself was still in the shipped file.** Put one worker back and
the screen starts printing "+$11,000 ROUND FUNDED" over the sky again and adding
it to a box. So the picture shows the boxes being removed; the source change and
`src/http/partner-galaxy-tiles.test.mjs` are what prove the invented money was
removed. `test-red-against-old-file.txt` in this folder is that test run against
the old file — it names the exact lines, including
`amt = 8500 + Math.round(Math.random()*7)*2500`.

## Sign-in

No live partner account was used. The screen was served from a local copy with
stand-in answers for `/api/auth/session`, `/api/read/partners`, `/api/health`,
`/api/org-brand` and `/api/partner-pages`. The stand-in partner is
`11111111-1111-4111-8111-111111111111` with an accrued balance of 1250.00 — that
is where the $1,250 in the picture comes from. Nothing touched the live site.

## Do-not-break check (T10-07)

* Signed in as a partner: the screen opens and stays open. Zero errors in the
  browser console.
* Signed in as a closer: still bounced away to `closer-dashboard.html`.
