# Next stack — 2026-08-16

Owner: Chris. Shared board for this batch.
Prove client: `9af65808-a619-4e65-ae91-239766a006b7` (Chris ProveFunding).
Org: `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`.
TransUnion stays off. Do not delete staff rows. Do not commit `.env`. Do not invent scores.

**COMPLIANCE REVIEW REQUIRED** for LexisNexis (credit-pull type) and any payment / consent screen rewrite.

Standing law for HTML: if a screen still shows sample people (Derek, Marcus, Priya, July 26 furniture, fake dollars), rewrite it when you touch it. Missing live facts stay a dash. Never invent.

## Tasks

| ID | Owner | Status | Notes |
|---|---|---|---|
| 0 crm-honest-ship | this session | done | Live `https://fundhub.ai` deploy `6a817428315c53d633f996b8`. Calendar / CCP / Chris-only roster / contracts-send / Present emails. |
| 2 live-playwright-100 | this session | done | 19/19 = 100/100 (2026-08-16). Does not cover closer-dashboard / my-numbers sample furniture. |
| 3 lexisnexis-full | unclaimed | pending | CRS LexisNexis Comprehensive Business Report. Search → JSON → PDF → store → show. Not a FICO. Not a funding yes/no. |
| 4a demo-html-closer | unclaimed | pending | closer-dashboard, my-numbers, sales-floor leftover Bianca row, pipeline clock |
| 4b demo-html-client | unclaimed | pending | client-portal, documents |
| 4c demo-html-ops | unclaimed | pending | ops-admin, command-center, automations, inquiry-remover clock, products-commissions |
| 4d demo-html-galaxy | unclaimed | pending | galaxy.html, partner-galaxy.html |
| 4e demo-html-other | unclaimed | pending | hiring, campaign-manager, agent-editor, template-editor — only if still sample after live bind |
| 5 fsr-rename | unclaimed | pending | Rename Business FSR copy so a human can read it. From crs-continue unit 4. |

Claim by writing your id before you edit. Write a manifest when done.

## What runs together vs waits

**No code until Chris says go.**

After go:

- **Same time (cap 5):** 0 (ship), 3 (LexisNexis), 4a, 4b, 5
- **Waits:** 2 waits on 0 being live. 4c waits on 4a/4b (same clock/shell patterns). 4d and 4e wait until a slot opens. Playwright loops again after each HTML ship.

LexisNexis UI paint may touch `client-control-panel.html` and `src/http/client-detail.mjs`. Do not also rewrite those in a demo-html workflow.

## Shared brief

### Live Playwright 100 (workflow 2)

- Canonical: `https://fundhub.ai` · funnel `https://apply.fundhub.ai`
- Command: `npm run test:e2e:live`
- Required ids: `docs/workflows/live-playwright-100.md`
- Last 100/100 was 2026-08-15 (19/19). CRM has changed since. Re-score after ship.
- Credentials from `.env` (`STAFF_E2E_PASSWORD`). Never ask Chris to paste. Never rotate keys.
- Chris does no manual click until 100/100.
- Fix product or test until 100. Do not dump a long fail list and stop.

### Full LexisNexis product

CRS account already has **LexisNexis Comprehensive Business Report** on.

Vendor paths (copy through Fundhub CRS client + `crs-softview` fence — do not call CRS from a new folder):

- search `POST /api/top-business-search/top-business-search`
- report JSON `POST /api/top-business-report/top-business-report`
- report PDF `POST /api/top-business-report/pdf/top-business-report`

Reference only: `vendor/underwriteiq-full/api/lite/crs/stitch-credit-client.js` and `vendor/underwriteiq-full/scripts/crs-lexisnexis-test.js`.

This is **company** data (profile, people tied to the business, related companies, bankruptcies, liens, judgments, UCC, property, vehicles, licenses). It is **not** personal FICO. Do not put it on the pipeline as a 300–850 score. Do not use it as the funding yes/no.

`src/messaging/providers/crs-softview.mjs` currently allows login + EX/EQ/TU consumer paths only. New paths must be added to that allow-list or the fence will refuse them. Identity rules for a business search are company name + address, not SSN.

Prove on Chris ProveFunding / ProveFunding. Store on the file. Panel shows real rows or dashes.

TransUnion stays off. Do not add a consumer bureau.

### Demo HTML (when necessary)

Do not rewrite a page that already binds live data (calendar, contracts send, CCP, closer-call Present tab, sales-floor roster filter).

Still sample as of 2026-08-16 (names / July 26 / fake dollars in the HTML):

- closer-dashboard, my-numbers, client-portal, documents, products-commissions
- ops-admin, command-center, automations, inquiry-remover, pipeline (clock)
- galaxy, partner-galaxy
- hiring, campaign-manager, agent-editor, template-editor
- sales-floor still has a Bianca Souza “needs a human” row

`sample-data.html` is the demo switch. Leave it as the demo switch.

Bind the existing API for that screen. If there is no API, dashes + honest empty — do not invent people.

## Change manifests

### Unit 0 — done 2026-08-16

Live: `https://fundhub.ai` deploy `6a817428315c53d633f996b8`.

Shipped from CRM-honest agents (not committed):
- Calendar real dates + dated tasks ([Calendar real data](4b0a9a46-48e7-4e9b-a970-49f42da1bbbd))
- Sales floor Chris-only roster ([Closer roster Chris only](d8a92462-d2b9-486f-9dce-58e0b27d8d62))
- Client file live bind ([Control panel live only](309aa368-93ac-40cb-8bde-bd7d11b9f5ed))
- Contracts send on call/Present ([Contracts make vs send](23620726-ed7f-4a36-bbbc-5833ab16f046)) — COMPLIANCE REVIEW REQUIRED
- Present emails already live (soft-pull / e-book / pay-link `sent`)

Still sample (unit 4): Bianca/Devon panels on sales-floor, closer-dashboard, my-numbers, client-portal, documents, July clocks on other screens.

