# W14 — Finance OS recovery

Read-only. Git history only. Nothing in the app was changed.

Chris’s spec (this audit): Plaid bank links for personal, business, and investment accounts. Subscription tracking as a feature inside the same page. Company money, not client billing.

---

### Answer first: is the original recoverable? which commit? did it match the spec?

**Yes. The original is still in git. Nothing was rewritten with a missing parent.**

The last full Finance OS — the big client money desk — is commit `75ba39afd9eaf76db2ad66060b5e6c1c6c00135d` (2026-08-17, 22:12). That commit is still an ancestor of today’s `HEAD`. The file blob is `99a5b608861f80b0203899364d5db1fea9edf200`.

The commit that **replaced** it is `0f518606fe18f39624f8e86bddb8b1ae80bd222c` (2026-08-17, 22:19, Zooted + Cursor). Message: “Make Finance OS Chris's company money screen, not a client's credit file.” It cut 712 lines and put empty buckets in their place.

**That original does not match Chris’s spec.** It was one client’s credit and cash file. It had no “Connect bank” button. It never opened Plaid. Subscriptions were a **separate** page for what Fundhub bills a client — not company charges inside Finance OS. Checking that commit out would bring back a client desk, not the company Plaid screen.

The first Finance OS file ever (`ac3057e9d80f00df078b30f37602c6bf998d2eb8`, 2026-07-31) also does not match. It was a seven-row **client credit grid**.

No version in git — old or new — ever had a Plaid Link / Connect-bank control. Searches for `Plaid.create`, `link_token`, `Connect bank`, `cdn.plaid.com` across all history returned nothing. `finance-os.js` never existed.

---

### Timeline of replacements

| When | Commit | What happened |
|---|---|---|
| 2026-07-31 | `5d65158` | Plaid tables and empty seams. `linkAccount()` / `getAccounts()` say “not implemented.” No screen. |
| 2026-07-31 | `ac3057e` | **First `finance-os.html`.** Seven rows of one client’s credit. Open with `?client_id=`. No bank. No subscriptions. |
| 2026-07-31 | `e681d05` | **Banking Surface** (separate page). Client bank accounts in Personal / Business / Unclassified. No Investment group. No Plaid button. |
| 2026-07-31 | `f992c13` | Buildout. Adds `finance-os.css`, `bank-accounts.html`, `subscriptions.html`. |
| 2026-08-01 | `26b3c1e` | **First big replace.** Ten finance pages fold into one Finance OS. Client picker, credit, banks, cards, bills, deal math, Ask it. `subscriptions.html` is kept on purpose: “Fundhub billing the client, not the client's money.” |
| 2026-08-01 → 08-17 | many | Shell, demo mode, UI audit. Same client desk. Features stay. |
| 2026-08-17 20:57 | `58adb8a` | **Deletes `subscriptions.html`.** Client billing page is gone. |
| 2026-08-17 22:19 | `0f51860` | **Second big replace.** Client desk wiped. Empty “Company money” page: Personal / Business / Investment / Subscriptions. Says the bank is not linked. No connect button. |
| 2026-08-17 22:40 | `8e89fa5` | Logo/nav only on this file (Command Center dropped). Same empty page. This is today’s file. |

W3 live match: honest empty — “The bank is not linked.” Personal / Business / Investment / Subscriptions all say none. No connect-bank button. `GET /api/finance/bank-accounts` and `/api/finance/bills` return 200. W6: Plaid inbound webhook 404, `plaid_items` 0. History agrees: the page was built to say empty, and Plaid was never wired.

---

### Original vs current feature list

**Original last full desk (`75ba39a`) — one client’s file**

Quoted from that HTML:

> Finance OS — one client's whole money picture, wired to real endpoints.

Controls: pick a client. Soft pull. Load simulated data. Clear simulated data.

Panels:

- Credit — from the latest pull (Experian / Equifax / TransUnion)
- Bank & investment accounts, with **+ Add account** (type it in)
- Cards & credit lines, with **+ Add card**
- Recent transactions
- Where it goes (spend)
- Recurring bills, with **+ Add a bill**
- Funding capacity / What the engine says
- Text me when
- Deal calculator — “what the client walks away with”
- Ask it

Investments was a **number tile**, not a Plaid pile:

> tile("Investments", t.investment_display …)

Bank groups on the old Banking Surface were Personal, Business, Unclassified. Comment in that file:

> Bank accounts on file, grouped by whose money it is.
> Open with a client in the address bar — `banking-surface.html?client_id=<id>`.

**Subscriptions then (separate page, deleted `58adb8a`)**

> The plan this client is on, the price, and the card on file for it.
> Nothing on this page charges anybody.

That is client billing, not company Netflix-style tracking inside Finance OS.

**Current (`8e89fa5` / live) — company labels, empty**

> Finance OS — Chris's company money. Personal, business, and investment
> accounts, plus the recurring charges against those accounts.
> … the Plaid seam is not connected and this screen will not invent a balance.

Hero: “Company money” / “Not connected” / “The bank is not linked. Nothing here is a made-up balance.”

Buckets: Personal, Business, Investment, Subscriptions. All empty. No Soft pull. No Add account. No Deal calculator. No Ask it. No client picker. **No Connect bank.**

Still reads `/api/finance/bank-accounts?client_id=` and `/api/finance/bills?client_id=` when a client id is in the URL. No client id → the empty company page.

| Feature | Last original (`75ba39a`) | Current |
|---|---|---|
| Whose money | One **client** | Labels say **company**; reads still take `client_id` |
| Plaid connect button | No | No |
| Personal / Business bank piles | Yes (client; also Unclassified) | Yes (empty labels) |
| Investment as its own pile | Number tile only | Empty label |
| Subscriptions **inside** the page | Recurring **client** bills | Empty “Subscriptions” bucket |
| Separate client-billing Subscriptions page | Yes, until `58adb8a` | Gone |
| Type in an account / card / bill | Yes | No |
| Soft pull, credit scores, deal math, Ask it | Yes | No |
| Honest “bank not linked” | No (showed a client desk) | Yes |

**Spec score**

| Spec line | Last original | Current |
|---|---|---|
| Plaid links for personal / business / investment | No. Never built. | No. Labels only. |
| Subscriptions as a feature **inside** Finance OS | No. Separate client-billing page. Recurring bills were the client’s. | Label only. Empty. |
| Company money, not client billing | No. Client file. | Words say company. Data path is still client-id. |

So: restore the original and you get the **wrong product**. The spec still needs to be built. The current page is closer in words, not in working bank links.

---

### Recover path (one checkout command — do not run a checkout that changes the working tree; just name it)

To put the last full client Finance OS back on disk:

```
git checkout 75ba39afd9eaf76db2ad66060b5e6c1c6c00135d -- public/app/finance-os.html
```

To only **look** (safe; does not change the tree):

```
git show 75ba39afd9eaf76db2ad66060b5e6c1c6c00135d:public/app/finance-os.html
```

First-ever credit-grid file: `ac3057e9d80f00df078b30f37602c6bf998d2eb8`.

Copies of both, plus the wiped sibling pages, are already in `snapshots/` under this folder.

---

### Stop line

Original recoverable: **yes**, at `75ba39afd9eaf76db2ad66060b5e6c1c6c00135d`.  
What replaced it: **`0f518606fe18f39624f8e86bddb8b1ae80bd222c`**.  
Did that original match the spec: **no**.  
Did any git version ever have Plaid connect: **no**.  
Auditor stop. No app change. Chris names the fix if he wants one.
