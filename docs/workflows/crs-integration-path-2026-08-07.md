# CRS integration path — 2026-08-07

Report-only investigation. No product code changes.

## Workflows

- W1 — every `crs_results` writer: done
- W2 — CRS / UnderwriteIQ API and upload path: done
- W3 — soft-pull seam and minimum live diagnostic: done

## Shared context

- Repository: `/Users/zootimusmaximus/fundhub-platform`
- Include `vendor/underwriteiq/`.
- Distinguish code that exists from code that is reachable in production.
- Distinguish CRS API calls, PDF/file upload, webhook delivery, and local database writes.
- Missing evidence is a finding; do not infer an integration.

## Findings

- A real `$32` payment emits `diagnostic.paid`; C-00 only marks the client
  `crs_status=Requested`. It does not create a `soft_pull_requests` row or call
  any provider.
- The Finance OS action calls `requestSoftPull()`. That writes a consent-gated,
  idempotent `soft_pull_requests(status='queued')` row and stops at an explicit
  empty provider seam.
- There is no production caller of `recordPull()`, `fulfilSoftPull()`, or
  `emitCrsResult()`.
- There is no CRS URL, credential, provider client, queue worker, poller, or
  webhook in the merged app. The code cannot establish whether CRS itself
  offers an API.
- Production-capable `crs_results` inserts exist for `analysis.completed` and
  demo/simulation tools, but no real soft-pull path emits the event or calls the
  persistence function.
- The separate vendored UnderwriteIQ Vercel service accepts PDF uploads at
  `/api/lite/parse-report`. `switchboard.js` posts each PDF to
  `PARSE_ENDPOINT`, defaulting to
  `https://underwrite-iq-lite.vercel.app/api/lite/parse-report`.
- The Vercel parser is currently reachable, but it is not routed by Fundhub,
  called by Fundhub, or connected to Fundhub Postgres. The deployed service also
  differs from the checked-in vendor snapshot.
- Fundhub's `/api/read/underwrite` route only reads an existing `crs_results`
  row and runs two copied local engine files. It does not ingest a report.
- Fundhub's generic document upload stores files and emits `docs.received`; it
  does not parse credit reports.
- The vendored parser returns nested bureau data that does not directly match
  the shapes consumed by `recordPull()` / tradeline ingestion. A mapper and one
  result coordinator are missing.
- The two existing result paths are individually incomplete:
  `recordPull()` writes the row, fulfils the request, and ingests tradelines but
  emits no downstream events; `emitCrsResult()` emits events whose handler
  writes another result row but does not fulfil the request or ingest
  tradelines. Calling both unchanged would duplicate `crs_results`.

## Open questions

- Operational fact not present in code: whether staff can run a paid pull in a
  CRS portal and export its PDF.
- Provider contract not present in code: whether CRS offers JSON, PDF, or both,
  and whether automated results arrive by webhook or polling.
- For one manual diagnostic, an already-obtained CRS PDF can be sent to the
  separate Vercel parser without a CRS API. It will not populate Fundhub.
- For one end-to-end Fundhub diagnostic, the minimum missing bridge is:
  PDF parser invocation, payload mapping, one non-duplicating result
  coordinator, and a call to that coordinator.
- For an automated new bureau pull, CRS provider access and its actual delivery
  contract are a hard blocker. An upload parser cannot originate a pull.
