# T10-01 — the partner page that 404s (unit C)

Date: 2026-08-19. Scratch database: `fundhub_t10_c` (local Postgres, socket `/tmp:5432`).
No live data was touched. Nothing was published on fundhub.ai.

## What a partner saw before

Home said:

    Your page · https://fundhub.ai/sites/9defaf28-47c5-43a0-8f5e-f41ef90f360a/apply

They clicked it and got a 404 whose whole body was:

    <!doctype html><title>Not found</title><p>This page is not published.</p>

(`../walk/T10-01-site-apply-headers.txt`, request id `01M0CCSCN1Y57EHA8P7GW7A66F`.)

Two separate faults:

1. **Home guessed.** It built that web address out of the sign-in reply alone and
   never asked whether any page was live. The partner's only page was a draft.
2. **The words and the link disagreed.** The words on screen were the `/sites/`
   address; the link underneath went to `brand-studio.html`.

The 404 itself was **correct** and stays. A draft is not public.

## What Home says now

`banner-render-probe.json` — the real `showOwnUrl` block pulled out of
`public/app/partner-galaxy.html` and run against a stubbed browser, one run per
state. `link_goes_to` is the anchor's destination; `reads` is what the partner
sees.

| State | Partner reads | Link goes to |
|---|---|---|
| Draft only (the live partner's actual state) | `Your page · draft, not live yet — publish it in Brand Studio` | Brand Studio |
| Published on fundhub.ai | the `/sites/...` address | the same `/sites/...` address |
| Published on a verified custom domain | `https://money.example.com/apply` | the same address |
| No page at all | `Your page · none made yet — open Brand Studio` | Brand Studio |

Text and destination now come from the same value, so they cannot drift apart
again. No control was added: Publish still lives only in Brand Studio.

Re-run with `node docs/workflows/fix-2026-08-18/evidence/T10/C-partner-page/banner-render-probe.mjs`.

## The public 404, and the thing we deliberately did not do

`T10-01-site-apply-body-AFTER.html` is the new body. It names the draft case and
points at Brand Studio's Publish.

**It is the same body for all three misses** — no such partner, no such page, and
a draft sitting at this exact address. That is a choice, and privacy won it.

`/sites/...` has no sign-in. Anyone can ask it about any id. A reply that said
"there is a draft here" would have told a stranger that this partner id is real —
the same leak as saying "no such partner", only politer. Walking ids would then
hand somebody the list of Fundhub's partners. No extra database lookup is made
either, because a second query for "is it a draft?" leaks the same fact through
how long the answer takes.

So the partner is told **before** they click, on Home, where they are signed in
and it is their own data. The public page gives useful advice to anyone who
happens to own a draft, and gives the internet nothing.

## Tests

`src/http/partner-pages-publish.pg.test.mjs` — 6 pass, 0 fail against
`fundhub_t10_c`:

- a draft page is not served to the public
- the miss page says what a draft is and where Publish lives
- **SECURITY**: a real partner id is byte-identical to a made-up one
- Brand Studio reports `live_path` as NULL while the page is a draft
- pressing Publish makes that exact address live
- **SECURITY**: a made-up id is still a plain miss after a real page goes live

Mutation-checked: reintroducing a draft-specific 404 body made the security test
and the miss-page test fail. The mutation was reverted immediately.
