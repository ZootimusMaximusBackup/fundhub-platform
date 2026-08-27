# Message Blaster gift

Owner: Chris. Plan GO: 2026-08-17.
Shared board for this batch. Agents claim a row before editing.

## Owner-set (do not re-raise)

Gift Darwin's Message Blaster to **affiliates** and **white-label partners**.

Do **not** give it to the $20k do-it-yourself brokerage.

It stays Darwin's Mac app. It is not rebuilt as a Fundhub texting tool.

## Task list

| id | unit | owner | status |
|---|---|---|---|
| 1 | Locked download (file + who can fetch it) | this session | done |
| 2 | Affiliate home — gift card + download | this session | done |
| 3 | White-label Galaxy — gift card + download | this session | done |

Protocol: claim (`claimed`) before you start. Never work an unclaimed or already-claimed task. Write your manifest here when done.

## Shared context brief

Written before GO, 2026-08-17. Facts only.

### What the tool is

Darwin's Message Blaster lives on this Mac:

- App: `/Users/zootimusmaximus/Downloads/MessageBlaster/MessageBlaster.app`
- Newest disk image: `/Users/zootimusmaximus/Downloads/MessageBlaster.dmg` (2026-08-13)
- How-to: `/Users/zootimusmaximus/Downloads/MessageBlaster/QUICK-START.txt`

It runs on **their Mac**, not on Fundhub. They pick a Contacts group, type a message (`{name}` becomes first name), see the list, then send iMessages with a pause between each. Nobody outside that group is texted.

### Who gets it

- Affiliate login → gift card on `public/app/affiliate.html` (their only screen / home).
- White-label partner login → gift card on `public/app/partner-galaxy.html` (their home).
- Not staff CRM. Not clients. Not the $20k DIY brokerage.

### How the gift is delivered

- One locked download door. Agreed name: `GET /api/gifts/message-blaster`
- Only `affiliate` and `partner` sessions may fetch it. Everyone else is refused.
- File is **not** under `public/` (a public file would be a free link for anyone).
- No new sidebar row. No charge. Not the white-label marketing suite board (`docs/workflows/wl-marketing-suite.md`).

### Journeys

On-disk `affiliate-intended.md` and `white-label-intended.md` are old route lists, not this product. Do not edit `*-intended.md`. Update `*-actual.md` in the same commit as the code. Report the intended-file gap.

## Change manifests

### Unit 1 — locked download (this session)

- `assets/gifts/message-blaster.dmg` — Darwin's Mac disk image (1.2 MB)
- `src/gifts/message-blaster.mjs` — path resolver
- `api/gifts/message-blaster.mjs` — `GET /api/gifts/message-blaster`, affiliate + partner only
- `netlify/functions/api.mjs` — route wired
- `netlify.toml` — bundle the dmg with the function
- `src/http/message-blaster-gift.test.mjs` — auth + missing-file tests

### Unit 2 — affiliate card (this session)

- `public/app/affiliate.html` — partner gift card + authenticated download button

### Unit 3 — white-label card (this session)

- `public/app/partner-galaxy.html` — gift strip + authenticated download button

### Journeys

- `docs/journeys/affiliate-actual.md` — regen includes gifts route
- `docs/journeys/white-label-actual.md` — regen includes gifts route
- `docs/journeys/CHANGELOG.md` — one line added

## Blockers

none
