# Bank logos — what was there, what was wrong, what is there now

Date: 2026-09-05
Branch: `feat/lender-bureaus`
Scope: bank logo pictures only. Nothing to do with bureaus, tiers, or matching.

---

## The short version

The bank list has 278 banks in it. Before today, 243 had a logo picture and 35 had none.

But 21 of the pictures that *were* there did not belong to the bank they were sitting on.
One programming tool's logo was standing in for five different banks. A website
builder's blank starter icon was standing in for eleven more.

Now 257 banks have a picture, and every picture has been looked at by eye.

| | Before | After |
|---|---:|---:|
| Banks with a logo | 243 | **257** |
| Banks with no logo | 35 | **21** |
| Logos that were the wrong company | 21 | **0 introduced; 8 still to solve** |

---

## 1. There was already a logo pipeline. It is here

`scripts/lenders-audit/run.mjs`, written 2026-08-21. It reads the bank list, works out
each bank's website, and downloads a picture into `public/assets/lenders/`. Files are
named after the bank in lowercase with dashes — `bank-of-america.png`, `synovus-bank.png`.
That naming has been kept exactly.

It fetched from two places, in order:

1. **Clearbit**, a company logo service.
2. **Google's favicon service** — the tiny picture in a browser tab.

### Why it produced wrong pictures

**Clearbit is gone.** It shut down after that run. Every request to it now fails outright.
So the old pipeline has been falling all the way through to the tiny tab icon, every time.

**And there is a bug.** The code tries to ignore the shared card-application websites that
many small banks use, then hands back the answer it just decided to ignore:

```
if (fromUrl && !/creditcardlearnmore|commonsenselenders|mycommunitycc|elancard/i.test(fromUrl)) {
  return fromUrl;
}
if (fromUrl) return fromUrl;   // <- returns the excluded one anyway
```

That second line undoes the first. So for every bank whose application link points at a
shared card platform, the pipeline went and got **the card platform's logo** instead of
the bank's.

That single line explains almost every wrong picture.

---

## 2. What was wrong, exactly

Twenty-one banks were showing a picture that was not theirs. They fall into four groups,
and each group is one shared website:

| Picture that was showing | How many banks | Where it actually came from |
|---|---:|---|
| A plain blue grid | 11 | `creditcardlearnmore.com` — a shared card sign-up site |
| The AngularJS logo (a programming tool) | 5 | `mycommunitycc.com` — another shared card sign-up site |
| A navy chevron | 5 | `valley.com` — Valley National Bank |
| PNC Bank's orange mark | 1 | `pnc.com` |

The eleven that were showing a blue grid: Berkshire Bank, Central Pacific Bank, Community
Bank, Exchange State Bank, First American Bank, First Kentucky Bank, Greater Nevada Credit
Union, Idaho First Bank, INTRUST Bank, Premier Bank, TowneBank.

The five that were showing a programming tool's logo: Native American Bank (two rows),
Providence Bank, Shore United Bank, West Bank.

There were also 29 pictures only 16 dots across — too small to read as anything. Blown up
they are coloured smudges.

---

## 3. What is there now

A new fetcher: `scripts/lenders-logos/`.

It goes to the bank's own website and takes the picture the bank publishes for phone home
screens, which is the real brand mark. It falls back to the logo shown at the top of the
bank's page, then to the browser tab icon.

**Everything it saves is checked first:**

- **Did the address forward somewhere else?** A bank site that forwards to a different bank
  has been bought, and the logo there belongs to the buyer. We stop.
- **Does the page say the bank's own name?** Anywhere on the page, including the small print
  at the bottom.
- **Is the picture big enough?** Under 64 dots across is refused.
- **Is it actually a logo?** Award stickers ("Best Bank 2026"), stock photos, page banners,
  and pictures from half-built test copies of a site are all refused.
- **Did it come out blank?** Some banks publish a white logo meant for a dark strip. On a
  white square that is an empty box. Those are thrown away.
- **Is it one of the known-bad pictures?** The blue grid, the programming-tool logo, and the
  smudges are listed by their exact fingerprint and can never be saved again.

Then every single saved picture was put on one sheet and looked at by eye. Five that passed
all the automatic checks were still wrong, and were deleted by hand.

Nothing is fetched when a screen loads. These are files sitting on disk, downloaded once.

### Result

- **28 logos saved**, all eyeballed.
- **6 refused** because the bank had been bought and the picture would have been the buyer's.
- **5 deleted after the eye check** — an award sticker, a stock photo, a mortgage brand, a
  blank, and a picture from a test site.

---

## 4. Two rows need Chris to say what he means

**"First Bank."** There are two rows with this name — one for Kansas, one for Tennessee and
Wyoming — and both send the application to PNC Bank's website. So the picture on that row
today is PNC's. There is also a real, separate "Local First Bank" in North Carolina, which
is a different company. We did not guess. The row was left exactly as it was found.

**"Clear Mountain Bank."** Its website leads with the logo of its mortgage arm, "HelloHome
Mortgage", not a bank mark. Left blank on purpose.

---

## 5. Something the book itself says that looks odd

Five banks all send their application to `valley.com`, which is Valley National Bank:
Cashmere Valley Bank (WA), North Valley Bank (OH), Platte Valley Bank (WY), Premier Valley
Bank (CA), Valley Bank (AL/AZ/FL/LA).

Because of that, all five are still showing Valley National Bank's navy chevron. **This was
not changed**, because the book itself points all five at that one bank. If those five are
genuinely five different banks, both the logos and the application links are wrong. If they
are all really Valley National, the row names are wrong. Either way it is the book that
needs the fix, not the pictures.

The same thing happens with Commerce Bank (KS/MO) and The Bank of Commerce (ID) — two
different banks, one shared application link.

---

## 6. The 21 banks still with no picture

Most of these no longer exist. They were bought, their websites were switched off, and
there is nothing left to fetch.

**Bought — website now forwards to the buyer (8).** Taking a picture here would put the
buyer's logo on the row.

| Bank | Now forwards to |
|---|---|
| First Midwest Bank | Old National Bank |
| TCF Bank | Huntington Bank |
| Evergreen Bank Group | Old Second |
| Exchange State Bank | Thumb Bank and Trust |
| Premier Bank | WesBanco |
| Cashmere Valley Bank | CVB |
| The Bank of Commerce | Bank of Commerce Online |
| East Boston Savings Bank | website switched off |

**Website switched off entirely (7).** These were all part of the same banking group and
were absorbed into one buyer: Bank of Blue Valley, Citywide Banks, Dubuque Bank and Trust,
Illinois Bank and Trust, Minnesota Bank and Trust, Rocky Mountain Bank, Wisconsin Bank and
Trust. Also The First Bank and First Kentucky Bank.

**Website is up but publishes no usable picture (4).** Bank of Utah, Columbia State Bank,
Community Trust Bank, Central Pacific Bank, Cornerstone Bank.

**Not a bank (1).** "Local Bank Options" is a note in the source spreadsheet telling the
advisor to find a bank near the client. It is not a company and will never have a logo.

---

## 7. Three worth a human glance

These saved fine, but their websites block automated visits or draw themselves with code,
so the name could not be read off the page. They were matched on the web address alone:

- Berkshire Bank
- First American Bank
- TowneBank

All three look right on the sheet. Flagged only so nobody assumes they were fully checked.

---

## Files

| Path | What it is |
|---|---|
| `scripts/lenders-logos/fetch-logos.mjs` | The runner |
| `scripts/lenders-logos/sources.mjs` | Where a logo comes from, and how a bad one is refused |
| `scripts/lenders-logos/targets.mjs` | Which banks need a logo, and from which website |
| `scripts/lenders-logos/last-run.json` | Exactly what happened on the last run |
| `public/assets/lenders/*.png` | The pictures themselves (main checkout — a worktree serves nothing) |

To run again:

```
node scripts/lenders-logos/fetch-logos.mjs --all
node scripts/lenders-logos/fetch-logos.mjs --dry-run    # look, save nothing
```

## Left alone on purpose

The old pipeline at `scripts/lenders-audit/` was **not** changed. It also checks application
links, which is not this job, and other sessions may be using it. The bug on its line 60 is
written up above so it can be fixed on its own.
