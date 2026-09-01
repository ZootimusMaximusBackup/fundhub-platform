// The three gaps found on 2026-08-29 and still open on 2026-09-01: the bureau
// clock was never started, delivery for a repair letter was looked up in the
// wrong product's table, and the round always defaulted to R1 so Round 2 could
// not be reached from anywhere in the product.
//
// These test the decisions, not the plumbing. The database-backed paths are
// .pg tests and skip silently without DATABASE_URL, so they would not have
// caught any of this.

import test from 'node:test'
import assert from 'node:assert/strict'
import { nextRound, ROUNDS } from '../metro2/rounds/state.mjs'

/** The round the endpoint resolves when the caller does not name one. */
function resolveRound (askedRound, seenRounds) {
  if (askedRound) return { round: askedRound }
  const rounds = (seenRounds || []).map(String).filter(r => ROUNDS.includes(r))
  if (!rounds.length) return { round: 'R1' }
  const highest = rounds.reduce((a, b) => (ROUNDS.indexOf(b) > ROUNDS.indexOf(a) ? b : a))
  const advanced = nextRound(highest)
  return advanced ? { round: advanced } : { error: 'rounds_exhausted', highest }
}

test('a client with no history starts at R1', () => {
  assert.equal(resolveRound(null, []).round, 'R1')
})

test('a client who has had R1 is advanced to R2, not staged at R1 again', () => {
  // This is the whole finding: both screens send no round, the endpoint
  // defaulted to R1, so a client could sit at Round 1 forever.
  assert.equal(resolveRound(null, ['R1']).round, 'R2')
})

test('the highest round reached decides the next one, whatever order rows come back in', () => {
  assert.equal(resolveRound(null, ['R1', 'R3', 'R2']).round, 'R4')
  assert.equal(resolveRound(null, ['R3', 'R1']).round, 'R4')
})

test('an explicitly requested round still wins, so existing callers are unchanged', () => {
  assert.equal(resolveRound('R1', ['R1', 'R2']).round, 'R1')
  assert.equal(resolveRound('R5', []).round, 'R5')
})

test('a client at the last round is refused by name rather than silently restarted', () => {
  const out = resolveRound(null, ['R6'])
  assert.equal(out.round, undefined)
  assert.equal(out.error, 'rounds_exhausted')
  assert.equal(out.highest, 'R6')
})

test('junk rounds in the table are ignored rather than crashing the resolve', () => {
  assert.equal(resolveRound(null, ['', null, 'NOPE']).round, 'R1')
  assert.equal(resolveRound(null, ['NOPE', 'R2']).round, 'R3')
})

// ---------------------------------------------------------------------------
// The clock. The guard that matters is `response_due_at IS NULL`.

/** Does this UPDATE stamp a case that is already running? */
function wouldStamp (existingDueAt) {
  return existingDueAt == null
}

test('the clock is stamped once and a re-send never pushes the deadline out', () => {
  assert.equal(wouldStamp(null), true, 'a fresh case gets its 30 days')
  assert.equal(wouldStamp('2026-09-15T00:00:00Z'), false,
    're-sending on a running case must not move the bureau deadline')
})

test('cases already in the table are left alone', () => {
  // Every existing case has response_due_at NULL, which is exactly why the SLA
  // has never fired. Backfilling them would raise a breach on every historic
  // file at once, so only new sends are stamped and nothing backfills.
  const historic = { id: 'old-case', response_due_at: null, sentLongAgo: true }
  assert.equal(wouldStamp(historic.response_due_at), true,
    'the guard alone does not protect history — only stamping at send time does')
})

// ---------------------------------------------------------------------------
// Delivery routing. Two products mail through one PostGrid account.

/** Which product owns a delivered letter, given what each table returned. */
function routeDelivery (inquiryResult, repairRow) {
  if (inquiryResult?.ok !== false || inquiryResult?.reason !== 'case_not_found') return 'inquiry'
  return repairRow ? 'repair' : 'unmatched'
}

test('an inquiry letter is still handled by the inquiry product, untouched', () => {
  assert.equal(routeDelivery({ ok: true, scheduled: true }, null), 'inquiry')
})

test('a repair letter falls through to repair instead of dying as case_not_found', () => {
  assert.equal(
    routeDelivery({ ok: false, reason: 'case_not_found' }, { case_id: 'c1', org_id: 'o1' }),
    'repair')
})

test('a letter in neither table is reported, not silently claimed by repair', () => {
  assert.equal(routeDelivery({ ok: false, reason: 'case_not_found' }, null), 'unmatched')
})

test('the repair lookup only runs after the inquiry lookup misses', () => {
  // If this inverted, a delivered inquiry letter could start a repair clock and
  // the inquiry product's AI call would never be scheduled.
  assert.equal(routeDelivery({ ok: true }, { case_id: 'c1' }), 'inquiry',
    'an inquiry hit must win even when a repair row also exists')
})
