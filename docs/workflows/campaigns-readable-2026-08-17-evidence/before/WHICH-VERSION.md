# These pictures are the OLD screen. Proof.

The capture ran at **04:00:22 UTC on 2026-08-18**. W1's new version was already
committed (`6805f75`) and on its way to the live site at that moment, so it is
fair to ask which one the camera actually got.

It got the old one. Two proofs:

1. `1440-visible-text.txt` line 73 reads `SCOPE & SOURCES` and line 83 reads
   `DID EACH PANEL LOAD?`. That card and that table are exactly what W1 removed.
2. `capture.json` lists six rows read out of `srcRows` — the table's row holder.
   The new file has no `srcRows` in it at all.

**It was close.** The AFTER capture, run from the same script at **04:01:57 UTC** — 95
seconds later — already got the new version: 7 grey blocks instead of 16, and a page
2,568 pixels tall instead of 3,628. So the live site swapped over somewhere inside that
95-second gap.

Later, the live site was confirmed as serving W1's new version:

```
sha256 of https://fundhub.ai/app/campaign-manager.html   = 9a715bf4…95e8c1ef
sha256 of the file at commit 6805f75                     = 9a715bf4…95e8c1ef   (same)
sha256 of the file at the commit before it               = c827b08c…0d840b8    (different)
```

So the BEFORE was caught with about a minute and a half to spare.
