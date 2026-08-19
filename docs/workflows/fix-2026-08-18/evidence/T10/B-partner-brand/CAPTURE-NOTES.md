# Browser check — Brand Studio on a partner session

This closes the CLAUDE.md §6 point 4 gap for `public/app/brand-studio.html`. The
other four screens changed on this branch already had browser shots; this one
did not.

Taken 2026-08-19, branch `fix/T10-affiliate-partner`, HEAD `c860b8ce`.

| File | What it is |
|---|---|
| `before-1440-brand-studio.png` | the screen exactly as at `git show HEAD:public/app/brand-studio.html` |
| `after-1440-brand-studio.png` | the screen exactly as it now stands in the working tree |

Both at 1440 wide, 1000 tall, top of page, no scrolling and no clicking. Both
boxes in question sit in the first screenful, so nothing is cropped out.

## How they were taken

**Nothing real was touched.** No live partner login was used and none was asked
for. Nothing was saved to any real system.

A throwaway stub was stood up on this machine and thrown away afterwards. It
lived at `/tmp/t10-stub/server.mjs`, outside the repository, and is deliberately
not checked in. It did two things:

1. served the files in `public/app/` over plain HTTP, and
2. answered the reads this screen makes on load with canned JSON.

Two copies ran at once, on two ports, because the fix is a before/after
comparison and the screen has to sit at the same web address in both. `shell.js`
works out which screen it is from the last part of the address and bounces
anything it does not recognise, so renaming the file was not an option.

* port **8781** served `/tmp/old-brand-studio.html`, which is
  `git show HEAD:public/app/brand-studio.html` written to a throwaway file
  (sha256 `d4844ea4…`). The real file in the checkout was never reverted,
  stashed or checked out — several sessions share this tree.
* port **8782** served the working-tree file.

Everything else — `shell.js`, `data.js`, the stylesheets — was the same file
from the same checkout on both ports. The only difference between the two
pictures is the one HTML file.

Canned answers given:

| Read | Answer |
|---|---|
| `/api/auth/session` | a partner principal: `role: "partner"`, `partner_id: 3f1c6a2e-…` |
| `/api/partner-brand` | one row shaped like `v_partner_brand_effective` (migration 236), with `entity_name: "E2E WL Click17 Co"` and `entity_address: "500 Old Street, Suite 4, Austin, TX 78701"` |
| `/api/org-brand` | no brand |
| `/api/health` | up |
| `/api/partner-pages` | no pages |
| `/api/partner-marketing/usage` | writing suite off |
| `/api/partner-marketing/copy-history` | no history |

Anything the screen asked for that was not on that list would have been logged
as `UNSTUBBED` and answered 501. Nothing was — the list above is everything
the screen asks for on load.

The browser started with an empty store and one item put in it: a fake sign-in
token. No saved draft of any kind, so anything that appears in a box came from
the stub's answer and nowhere else. The address bar was opened **without**
`?partner_id=`, and the screen's own session-adoption step read the partner id
off the session and reloaded itself with it — the same path a real partner
takes.

## What differs between the two pictures

| | before | after |
|---|---|---|
| Legal entity | grey `Meridian Capital Partners LLC` | black **E2E WL Click17 Co** |
| Business address | grey `1200 Main St Suite 400, Phoenix, AZ 85004` | black **500 Old Street, Suite 4, Austin, TX 78701** |
| Brand name | grey `Meridian Capital Partners` | black **E2E WL Click17 Co** |
| Support email | grey `support@meridiancapital.com` | black **help@click17.example** |
| BRAND tile, top left | `—` | `Text mark` |
| FUNNELS SELECTED tile | `1` | `0` |
| Live preview panel, right | `Your Brand` / `© 2026 Your Entity LLC` | `E2E WL Click17 Co` / `© 2026 E2E WL Click17 Co` |
| Green strip along the bottom | absent | `partner brand · E2E WL Click17 Co · draft` |

## Does it match the claim

Yes. Read out of the page rather than off the picture:

| | before | after |
|---|---|---|
| Legal entity box, actual value | `""` | `"E2E WL Click17 Co"` |
| Business address box, actual value | `""` | `"500 Old Street, Suite 4, Austin, TX 78701"` |
| Browser errors | `ReferenceError: FHData is not defined` at line 1302 | none |
| Was `/api/partner-brand` ever asked for? | **no** | **yes** |

The before page did fire `/api/partner-pages`, `/api/partner-marketing/usage`,
`/api/auth/session`, `/api/health` and `/api/org-brand` on the same load. Only
the one read that goes through `FHData` is missing. That is the timing fault,
not a permission fault, and the stub would have answered `/api/partner-brand`
happily if it had been asked — it answers it on port 8782 from the identical
code.

Pressing Save on the before copy printed
`Legal entity is required — it goes into every disclosure.`, the exact refusal
described. That check is inside the page and returns before any request is
sent; the stub's log confirms no write of any kind left the page.

## What these pictures cannot show — read this before you trust your eyes

**The before picture does not look empty, and that is the whole problem.**

The boxes show grey words: `Meridian Capital Partners LLC`,
`1200 Main St Suite 400, Phoenix, AZ 85004`. Those are not a partner's data and
they are not a value. They are the example text a browser prints in an empty box
to show you what to type. Nothing is in the box. But a person looking at the
picture cannot tell the difference between an empty box showing example text and
a filled box, because both look like grey-ish writing in a box.

So the before picture on its own does not prove the boxes were empty. What
proves it is the table above, read straight out of the page: both values were
`""`, the page reported an error, and the request that fills them was never
made. The picture is supporting evidence, not the proof.

The pair read side by side is much stronger than the before shot alone: the
words change, the colour goes from grey to black, and the green strip appears at
the bottom.

Two more things the pictures cannot show:

* **The database is not in these pictures.** The brand values came from a fake
  answer typed into a stub on this machine. This proves the screen now asks for
  the brand and puts the answer on screen. It does not prove any real partner's
  record contains anything. That still needs a human on the live site.
* **Saving is not in these pictures.** Neither shot involved a successful save.
  The address round-trip — type it, save it, reload, still there — was proved by
  the tests recorded in `EVIDENCE.md`, not here.

## One difference worth flagging, because it looks like a regression

The FUNNELS SELECTED tile goes from **1** to **0**.

That is the fix working, not breaking something. Before, the screen drew a
ticked "Application funnel" card from its own built-in default because the
server's answer never arrived. The stub partner has no funnels on file, so once
the answer does arrive the count correctly becomes 0. A real partner who has
chosen funnels will see their own count.

It is still a visible change to a number on screen, so it should not arrive as a
surprise.

## Cleanup

Both stub servers were stopped. The stub itself and the throwaway copy of the
old screen live under `/tmp` and are not in the repository. The only files added
by this check are the two pictures and this note.
