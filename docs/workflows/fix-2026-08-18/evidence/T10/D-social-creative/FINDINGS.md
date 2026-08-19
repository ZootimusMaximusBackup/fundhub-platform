# T10-06 unit D — evidence

Measured 2026-08-19 against this branch, in a real browser, with a stub server that
answers `/api/auth/session` as a **partner** and serves the real files from
`public/app/`. Every number below was read off the page, not reasoned about.

## Part 2 — why the "Generate and decide" card was invisible

**Root cause, found empirically. It is not a CSS rule.**

The card carried an **inline `style="display: none;"` and a `data-fh-gated="1"`
attribute**. Both are written by `public/app/shell.js` `gateLinks()`:

```
var box = a.closest("li") || a.closest(".card") || a;
if (!allowed) { box.style.display = "none"; box.setAttribute("data-fh-gated", "1"); }
```

`gateLinks()` hides the **nearest enclosing `.card`** around any link the signed-in
role may not follow. The Generate card's last caption contained one incidental
cross-reference:

```html
Spend and fatigue live on <a href="campaign-manager.html">Campaigns</a>.
```

A partner may not open `campaign-manager.html`. So that one link hid the whole card
— the picker, the prompt box, the batch name, **Enqueue generation**, **Run queued
jobs now**, and Approve / Reject / Archive.

Proof, in order:

| measurement | result |
| --- | --- |
| page rendered with **all scripts stripped** (CSS only) | card height **460.5px** — visible. Not a stylesheet. |
| walk of every `document.styleSheets` rule matching the card and setting `display` | **zero matches** |
| page rendered **with scripts** as a partner | card `display: none`, height **0**, `#genBtn` 0×0 |
| `card.getAttribute('style')` | `"display: none;"` |
| `card.attributes` | `class="card"`, **`data-fh-gated="1"`**, `style="display: none;"` |
| every `[data-fh-gated]` element on the page | 28 nav rows + **exactly one card**, and its only gated link is `campaign-manager.html` |

**Fix (in `public/app/creative-factory.html`, the file this unit owns):** the word
"Campaigns" is now plain text, not a link, with a comment naming the mechanism so it
is not put back. `shell.js` is untouched.

After the fix, same conditions: card `display: block`, height **461px**,
`data-fh-gated` **absent**, `#genBtn` **189×40**.

## Part 2b — `setWriteControls()` now has a visibility contract

Before, it only flipped `disabled` and the chip text. The live audit caught
`#genBtn` at `disabled: false` while its box measured 0×0 — the page believed the
writer was on at the moment nobody could see it, and a scripted click would still
have posted to `/api/creative/generate`.

Now every write control is disabled unless it is **actually drawn**, re-checked
whenever the card's own attributes change (`MutationObserver`), because the shell
gates links on `DOMContentLoaded` — after this script runs.

Verified by forcing the old condition back:

| state | `#genBtn.disabled` | chip | message |
| --- | --- | --- | --- |
| card visible, `setWriteControls(true)` | `false` | Writes on | (cleared) |
| card hidden, `setWriteControls(true)` | **`true`** | Read only | "The buttons that ask for new creative are not on this screen right now, so they stay switched off." |

## Part 1 — the post queue now works with zero connected accounts

`POST /api/social/posts` was routed (`netlify/functions/api.mjs:511`), handled a
partner principal, and **nothing in the browser ever called it**. Social Studio
referenced that path exactly once, as a GET.

Recorded request bodies after clicking the new row controls:

```
POST /api/social/posts  {"partner_id":"…","id":"…","scheduled_for":"2026-09-01T09:15:00.000Z"}
POST /api/social/posts  {"partner_id":"…","id":"…","action":"discard"}
```

On-screen results: `Saved. That post is waiting and set for Sep 01 09:15Z.` and
`Thrown away. It has left the list and can never be sent.`

The time box round-trips as **UTC**, matching every other time this screen prints.

Empty state now reads (as a partner):

> No social accounts are connected yet. Once one is, it will show here. Posts can
> still be written, given a send time and thrown away without one. They wait in the
> list below until there is an account to send them on. Connecting Facebook,
> Instagram or LinkedIn is the owner's job, once those apps are set up. There is no
> Connect button on this screen for you.

The hidden Connect buttons stay hidden. That is what
`docs/journeys/white-label-intended.md` "Marketing suite (beta)" item 4 asks for.

## The one gap left — reported, not invented

**A hand-typed post still cannot be saved with zero accounts.** Traced, not guessed:

* `api/social/schedule.mjs:32` — `if (!channelId) return res.status(400) …
  channel_id_required`. It is the only route that stores a caption typed on screen.
* `api/social/posts.mjs:42` — `if (!isUuid(body.id)) return 400 id_required`. Every
  branch loads an existing `marketing_content_queue` row. There is **no create
  branch**.
* The only writer of new queue rows is `api/social/generate.mjs:107`, which writes
  captions from the model.

So with no account, the composer's caption has nowhere to go. Rather than invent a
create endpoint (not this unit's file, and not traced anywhere), the button now says
what is true and points at "Write 3 posts for me", which does put posts in the list
with no account. Closing the gap needs a create branch in `api/social/posts.mjs`,
which this unit does not own.

## Tests

`src/http/social-posts-write.pg.test.mjs` — 12 tests, all passing against a scratch
Postgres (`fundhub_t10_d`). The fixture has **zero** `social_channels` rows and one
test asserts that directly, so no test here depends on a connected Facebook,
Instagram or LinkedIn account.
