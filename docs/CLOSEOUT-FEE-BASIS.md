# Closeout fee basis — owner decision

Date: 2026-08-04
Source: `docs/END-TO-END-VERIFICATION.md` operational finding

## Decision

The 10% success fee is calculated from `funding_rounds.funded_amount` — the
amount the client was funded / is billed against.

Approved application rows are a **lender breakdown only**. They must not gate
or replace the fee.

## Why

A round can be marked funded without every lender application sitting in
`Approved` status. Using Approved apps as the fee basis produced a silent $0
invoice — verified live in the end-to-end harness.

## Column note

`funding_closeout.total_approved_amount` keeps its historical name. Its value
is now the fee basis (the round's funded amount). Screens already read this
column; renaming requires a migration and is out of scope for the fix.

## Code

`src/funding/closeout.mjs` — `createFundingCloseout`.
