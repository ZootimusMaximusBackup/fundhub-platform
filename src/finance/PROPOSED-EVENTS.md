# Proposed canonical events — Finance OS alerts and the monthly artifact

**Proposal only. `src/events/canonical.mjs` has not been edited.**

Same treatment as `src/commissions/PROPOSED-EVENTS.md`: `canonical.mjs` is the
spec §4 event spine and adding to it is Darwin's call, so the names that would be
needed are written down here rather than added unilaterally.

Nothing in `db/migrations/078`–`079` or `src/finance/` depends on any of these
existing. The evaluator is pure and takes its inputs as arguments; the alert
store takes a row and writes it. These are what a handler *would* emit if one
were wired.

---

## What already exists and is enough

| Existing event | Why it matters here |
|---|---|
| `analysis.completed` | a fresh pull has landed — the natural moment to re-evaluate |
| `docs.received` | a manually entered tradeline set may have changed |
| `inquiry.removed` | changes the inquiry counts the clean-pull condition reads |

Re-evaluation is fully drivable from the existing spine. Everything below is
about what happens *after* a condition fires.

---

## Proposed: the alert lifecycle

### `alert.raised`

Emitted when an `alerts` row is written or refreshed. This is the notification
surface — an ops queue, the client-control-panel, a staff dashboard count.

```jsonc
{
  "name": "alert.raised",
  "version": 1,
  "idempotency_key": "alert|<org_id>|<client_id>|<kind>|<raised_at>",
  "client_id": "<uuid>",
  "payload": {
    "alert_id": "<uuid>",
    "kind": "utilization_drop_clean_pull",
    "severity": "warning",
    "raised_at": "2026-07-31T00:00:00Z",
    "metrics": { "utilization_bp_before": 5000, "utilization_bp_now": 2500,
                 "headroom_increase_cents": 250000 },
    "rule_snapshot": { "utilization_ceiling_pct": 30 }
  }
}
```

The idempotency key includes `raised_at` rather than being `(client, kind)`
alone, because 078's partial unique index deliberately allows the SAME condition
to be raised again after an acknowledgement. Keying on `(client, kind)` would
make the second, legitimate raise look like a replay of the first.

**Open question for whoever wires this:** the payload above carries the metrics.
It could instead carry only `alert_id` and let a consumer read the row. Carrying
them makes the event self-contained for a consumer that cannot reach the
database; referencing them keeps one copy of the truth. The repository does both
in different places and neither is obviously right here.

### `alert.acknowledged`

`open → closed`. Payload: `alert_id`, `kind`, `acknowledged_at`. This is what a
queue count hangs off.

Note that 078 records **when** an alert was acknowledged and not **by whom**.
That was left out deliberately rather than forgotten — no acknowledgement
endpoint exists yet, and inventing an actor column ahead of the screen that would
fill it is how you get a column nobody writes. If an acknowledgement path is
built, it should add `acknowledged_by` in its own migration and put the actor in
this event.

---

## Proposed: the subscription artifact

### `report.generated`

Emitted when a monthly optimization artifact is produced for a client.

```jsonc
{
  "name": "report.generated",
  "version": 1,
  "idempotency_key": "credit_optimization_roadmap|<client_id>|2026-07",
  "client_id": "<uuid>",
  "payload": {
    "artifact_key": "credit_optimization_roadmap|<client_id>|2026-07",
    "document_kind": "credit_optimization_roadmap",
    "entitlement_code": "credit-optimization-roadmap",
    "cadence": "monthly",
    "period": { "key": "2026-07",
                "start": "2026-07-01T00:00:00Z", "end": "2026-08-01T00:00:00Z" },
    "signal_count": 1,
    "blank_count": 2
  }
}
```

The idempotency key **is** the artifact key, so regenerating July absorbs into
the same event exactly as it absorbs into the same artifact. This is the pattern
`commission.earned` already uses — the ledger row's own key — and it is
replay-safe end to end for the same reason.

### `report.delivered` — deliberately NOT proposed

There is no delivery path in this platform. `sendTemplated` writes `messages`
rows with `status='queued'` and nothing sends them; there is not one outbound
`fetch()` in `src/adapters/` or `src/lib/`. Proposing a delivery event now would
put a name in the spine for a capability that does not exist, and the first
person to see it would reasonably assume something delivers. When a provider is
chosen, delivery gets its own event alongside the rest of the messaging surface,
not here.

---

## Summary for `canonical.mjs`, if approved

```js
// finance os
"alert.raised",
"alert.acknowledged",
"report.generated",
```

Three names. `report.delivered` is deliberately excluded, per the note above.

They belong under a new `// finance os` grouping alongside the existing
`// commission + billing` block — none of them is part of the journey spine.
