# T1 — proved on production after merge, 2026-08-19

Merge commit `bc49c29`. Walked as the **real test client**, through a **real emailed sign-in link**,
against **deployed `fundhub.ai`** — no patched files, no interception, nothing simulated.

## The link

`POST /api/auth/magic-link` → 200 for `stanbridgejchris+e2e-fire@gmail.com`, the test client's
plus-tagged address (checked against the protected inbox first — it is not it, and no account
anywhere uses the bare value). Token read from the `messages` row, then opened like a client would.

## What the client sees now

```
greeting : "Welcome back, TEST"
sub      : "Welcome to your Fundhub portal. Your call is next."
fh_account.clientId : 8556bedc-46e1-4d85-b0cd-a24adfee1521
page errors : none
```

Every read the page makes, all answered:

```
POST /api/auth/magic-link-verify                     -> 200
GET  /api/content/welcome-video                      -> 200   <- the new route, live
GET  /api/read/portal-summary?client_id=8556bedc-…   -> 200
GET  /api/read/portal-contracts?client_id=8556bedc-… -> 200
GET  /api/read/entitlements?client_id=8556bedc-…     -> 200
GET  /api/consent/capture?…&kind=dispute_authorization -> 200
GET  /api/auth/session                               -> 200
GET  /api/health, /api/org-brand                     -> 200
```

Before this change the same walk produced **"We could not load your file."** and **zero**
`/api/read/*` requests. Screenshot: `shots/50-PRODUCTION-real-client-magic-link.png`.

## One measurement note, recorded so nobody repeats it

A first production run appeared to fail — "We could not load your file.", zero API calls. It was
**not** a regression: `portal-login.html` finishes with `location.replace()`, so a fixed
`waitForTimeout` after the *login* page can expire before the *portal* page has booted, leaving the
shipped static default text on screen. That default text is the same sentence the failure path
paints, which makes the two states look identical. Wait for the URL and for `networkidle` before
reading anything. The run above does.

## Still true, and expected

`GET /api/content/welcome-video` answers 200 with no video: the library is genuinely empty and
`DOCUMENT_STORE_PROVIDER` is still unset, so the portal keeps its honest
"Welcome video is not available". That is the correct state until the storage setting is switched on
and a video is uploaded and mapped to **Default**.
