# Contract: GET /api/read/client-progress

**Written by the orchestrator 2026-09-05 so the endpoint and the screen can be built at the same
time.** The endpoint lane builds TO this. The front-end lane builds FROM this. Neither waits.

If a lane believes a field here is wrong or impossible, it does NOT silently change it — it says
so in handoffs and builds the rest. A contract only works if both sides honour it.

## Rules this obeys

* **Facts, not copy.** Every value is a number, a boolean, a date or an identifier. The words a
  client reads live in the front end. This is the rule `api/read/portal-summary.mjs:20` already
  states and it is why that endpoint has survived.
* **Unknown survives as `null`.** Never `0`, never `""`, never a guess. A score that was never
  pulled is `null` and the screen must render that as "not pulled yet", never as a low number.
* **Money is integer cents.**
* **Dates are ISO 8601 strings** in UTC, or `null`.
* **Nothing here says "credit repair".** Owner-set. Front-end copy uses funding-optimisation and
  capital-readiness language.

## Auth

`requirePrincipal(req, res, ["staff", "client"], { db })`, and a client principal is pinned to
itself exactly as `api/read/portal-summary.mjs:43-51` does. Staff may pass a `client_id`; a client
may not.

## Shape

```json
{
  "ok": true,

  "stage": {
    "key": "in_transit",
    "roundCurrent": 2,
    "roundCap": 6,
    "enteredAt": "2026-03-03T00:00:00Z",
    "expectedResponseBy": "2026-04-02T00:00:00Z",
    "waitingOn": "bureaus"
  },

  "scores": {
    "personal": [
      { "bureau": "experian",   "score": 651, "pulledAt": "2026-03-01T00:00:00Z", "reportDocumentId": "uuid|null" },
      { "bureau": "equifax",    "score": 648, "pulledAt": "2026-03-01T00:00:00Z", "reportDocumentId": "uuid|null" },
      { "bureau": "transunion", "score": null, "pulledAt": null,                  "reportDocumentId": null }
    ],
    "business": [
      { "businessId": "uuid", "name": "Sim Five Holdings LLC", "bureau": "experian_business",
        "score": 42, "pulledAt": "2026-03-01T00:00:00Z", "reportDocumentId": "uuid|null" }
    ]
  },

  "movement": {
    "middleScoreNow": 648,
    "middleScoreBaseline": 612,
    "baselineAt": "2026-01-12T00:00:00Z",
    "itemsRemoved": 2,
    "itemsDisputed": 7,
    "series": [
      { "at": "2026-01-12T00:00:00Z", "experian": 615, "equifax": 612, "transunion": 608 },
      { "at": "2026-03-01T00:00:00Z", "experian": 651, "equifax": 648, "transunion": null }
    ]
  },

  "waypoints": [
    {
      "id": "uuid",
      "order": 3,
      "title": "Proof of address",
      "owner": "client",
      "state": "open",
      "dueAt": "2026-02-24T00:00:00Z",
      "overdue": true,
      "completedAt": null,
      "paidAlternative": null
    },
    {
      "id": "uuid",
      "order": 5,
      "title": "Run a round now",
      "owner": "client",
      "state": "available",
      "dueAt": null,
      "overdue": false,
      "completedAt": null,
      "paidAlternative": { "serviceKey": "paid_round", "priceCents": 10000 }
    }
  ],

  "nextStep": {
    "waypointId": "uuid",
    "owner": "client"
  },

  "timeline": [
    { "at": "2026-03-03T00:00:00Z", "text": "Round 2 letters mailed to all three bureaus" },
    { "at": "2026-02-12T00:00:00Z", "text": "Photo ID received" }
  ],

  "deliverables": [
    { "documentId": "uuid", "subtype": "funding_snapshot", "title": "Funding Snapshot", "generatedAt": "2026-03-01T00:00:00Z" }
  ],

  "paidServices": [
    { "serviceKey": "paid_round", "available": true,
      "components": [
        { "key": "base",        "label": "Three bureaus", "priceCents": 10000, "required": true },
        { "key": "creditor",    "label": "Creditor letter", "priceCents": 1000, "required": false },
        { "key": "cfpb_and_ag", "label": "CFPB and state attorney general", "priceCents": 2000, "required": false }
      ],
      "inFlight": false }
  ],

  "referral": { "enrolled": false, "shareUrl": null, "code": null }
}
```

## Field notes that decide correctness

**`stage.roundCurrent` / `roundCap`.** Cap is `repair_programs.rounds_cap` — 2 for the $200 trial,
6 for full. A **paid round does not consume a cap round**, so these two counters are independent
and the paid round must never decrement the cap.

**`stage.expectedResponseBy`.** `dispute_cases.response_due_at`. `src/repair/portal.mjs`
`clientRepairView()` already computes an honest expected date and has zero callers — use it.

**`scores.business` is an ARRAY, one entry per business.** Owner-set: the panel toggles between
businesses, so a single blended number is wrong. `businessId` must be stable across requests.
Before trusting the business numbers, RUN the path — walkthrough finding F44 was business age
never reaching the engine, so that data route has a proven history of being wrong.

**`reportDocumentId`** is how a panel opens that bureau's report. It points at the deliverable
being ported in plan section 2. **Do not build a second report renderer.** Null when no report
exists for that bureau yet.

**`movement.series`.** `api/read/portal-summary.mjs:140-147` already loads **every** `crs_results`
row with no LIMIT and throws all but the newest away. The series costs one mapping function, not a
new query. Note `src/retention/classes.mjs:147` tombstones `result` after a configured
`retainDays`, so the far end of the series can be legitimately empty.

**`waypoints[].overdue`** is computed from `dueAt`, never stored, so it cannot go stale.

**`waypoints[].paidAlternative`** is `null` when no paid option exists. `null` means none; it must
never be rendered as free.

**`nextStep`** names exactly ONE waypoint. Not a list. If nothing is owed by the client, it names
the thing FundHub owes, so the page always answers "whose move is it".

**`timeline`** comes from `repair_decision_log` via `TIMELINE_SQL`
(`src/repair/read-repair-signals.mjs:128`), rendered by the existing `timelineLine()`
(`src/repair/lens.mjs:206`). Both work and are staff-only today. Reuse them.

**`paidServices[].inFlight`** is true when a `paid_service_requests` row is open, so the screen can
refuse a second press rather than relying on a disabled button.

**Rounds 4 and 5 must NEVER appear as filed.** Nothing in this system records whether a CFPB or
state AG complaint was actually submitted — `src/metro2/letters/catalog.mjs:57-65` says so
explicitly. The timeline may say a letter was produced. It must not say a complaint was filed.
