# T10 unit B — Partner brand save

## What a partner saw before

Open Brand Studio as a white-label partner. Every box looks empty — the grey
text is a placeholder, not a value. Press **Save** and it refuses:

> Legal entity is required — it goes into every disclosure.

The server had the partner's legal name on file the whole time. It was never
asked for it.

## Why

`public/app/data.js` is loaded with `defer`. A deferred script runs *after* the
page is parsed. The plain inline script under it runs *during* the parse. That
inline script called `FHData.wire(FHData.brand(partnerId), …)` with no guard, so
on a partner session `FHData` did not exist yet and the line threw. The throw
killed the rest of the function, so `__fhBrandHydrateFromServer` never ran and
nothing was ever filled in.

Proof it was the timing and not a permission problem: on the same page load,
`/api/partner-pages`, `/api/partner-marketing/usage` and
`/api/partner-marketing/copy-history` all fired. Those are plain `fetch()` calls
in the script *above*. `/api/partner-brand` — the only read that goes through
`FHData` — never appeared in the network log at all.

The server was already correct: `requirePrincipal(["staff","partner"])` admits a
partner, `canAccessBrand` pins them to their own id, and the view always
populates `entity_name`.

## Second problem found in the same screen: the address went nowhere

`entity_address` has been a real column since migration 043 and has always been
on the endpoint's writable list. But:

1. the screen never put it in the save body, and
2. `v_partner_brand_effective` — the only thing the endpoint ever reads from —
   never selected the column.

So the Business address box wrote nothing and could never be read back. Nothing
errored, which is why it lasted.

**Correction to an earlier version of this write-up.** It said the address box
"was the only box that fed the disclosure template". That was wrong, and it made
this fix sound bigger than it is. Nothing in this codebase puts the address into
a disclosure, a page, an email, or any other template. Migration 043 says that
is what the field is *for*; that was never built. The only things reading it
today are the endpoint's writable list, the new view column, and the Brand
Studio box. The real harm was simpler: a partner typed an address, was told
nothing was wrong, and could never see it again.

## What changed

| Layer | Change |
|---|---|
| `public/app/brand-studio.html` | The brand read now happens on `DOMContentLoaded`, the same fix `public/app/affiliate.html` already carries. `defer` was **not** removed. |
| `public/app/brand-studio.html` | Save now sends `entity_address`, and the reply's `entity_address` is mapped back onto the form. |
| `db/migrations/236_partner_brand_effective_address.sql` | `v_partner_brand_effective` now selects `entity_address` (appended last — `CREATE OR REPLACE VIEW` may only append). |
| `public/app/brand-studio.html` | The address box now clears when the server holds no address (second round — see below). |
| `api/partner-brand.mjs` | Comment only. Records that every name on `WRITABLE` must also be selected by the view, and names the test that now enforces it. |

No disclosure wording changed, and no disclosure reads this field — see the
correction above. The address a partner saves is now readable back by the
partner who owns it, which it was not before.

## Second round: the box would not clear

Found by the verifier, fixed here. Delete your address, save, reload — the old
address was still in the box. The browser keeps its own copy of the last save,
and the read-back only overwrote that copy when the server sent something. An
empty answer from the server changed nothing, so the screen showed an address
the server no longer had and the partner had no way to tell.

Now the server's answer wins, including when the answer is "nothing on file".
Two things are deliberately left alone: an address someone is typing at that
moment, and a reply that says nothing at all about the address.

`src/http/brand-studio-screen.test.mjs` grew a small fake browser for this. It
runs the screen's own script with stub elements — nothing is drawn and no
network call is made — then reads the address box. Four new checks:

| Situation | Box must show |
|---|---|
| server holds no address, browser has a leftover one | empty |
| server holds an address, browser has a different one | the server's |
| someone is mid-type when the server answers "none" | what they typed |
| the reply never mentions the address | unchanged |

Proof of failure against the previous mapping: with the old
`if (b.entity_address) D.addr = b.entity_address;` line put back, the first
situation leaves `500 Old Street` in the box instead of clearing it — recorded
in `address-clear-before-fix-FAILS.log`.

## Proof

Measured on a private scratch Postgres, `fundhub_t10_b` (socket `/tmp:5432`),
migrated from this branch on 2026-08-19. Never run against production or CI.

| Log | Result |
|---|---|
| `roundtrip-before-236-FAILS.log` | 3 pass, **4 fail** — view without `entity_address` |
| `roundtrip-after-236.log` | **7 pass, 0 fail** |
| `screen-shape-before-fix-FAILS.log` | 2 pass, **5 fail** — screen at `HEAD` |
| `screen-shape-after-fix.log` | **7 pass, 0 fail** |
| `address-clear-before-fix-FAILS.log` | the stale address stays on screen — the second-round bug, reproduced |
| re-run after the second-round fix, scratch DB `fundhub_t10_rb` | screen **11 pass, 0 fail**; round-trip **7 pass, 0 fail** |
| `neighbours.log` | 73 pass, 0 fail — `partner-brand-gate`, `partner-brand-read-gate`, `routes`, `app-nav-reachability` |

## One thing this unit could not finish

`src/http/calendar-paint.test.mjs` keeps a list of screens known to read their
data at the wrong moment. `brand-studio.html` is on it, and that file's own test
says: when the screen is fixed, delete its line. It is now fixed, so that test
goes red until the line is removed.

That file is not owned by this unit and was deliberately not touched. The
orchestrator needs to delete the `"brand-studio.html"` entry from `KNOWN_UNFIXED`
in `src/http/calendar-paint.test.mjs`.

## Still to check by hand

Sign in as a white-label partner on the live site, open Brand Studio, and
confirm the Legal entity box arrives filled in. Type a business address, press
Save, reload the page, and confirm the address is still there.
