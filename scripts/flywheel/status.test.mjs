import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { splitFrontMatter, bodyHash, parseFrontMatter, evaluate } from './status.mjs'

function stageFile ({ stage = 1, status = 'draft', inputs = {}, counts = {}, body = 'content\n' }) {
  const lines = ['---', `stage: ${stage}`, 'version: 1', `status: ${status}`]
  lines.push('inputs:')
  for (const [k, v] of Object.entries(inputs)) lines.push(`  ${k}: ${v}`)
  lines.push('counts:')
  for (const [k, v] of Object.entries(counts)) lines.push(`  ${k}: ${v}`)
  lines.push('---', '')
  return lines.join('\n') + body + '\n## Review card\n**What this decided:** a thing\n'
}

function scratch () {
  const dir = mkdtempSync(join(tmpdir(), 'flywheel-'))
  mkdirSync(join(dir, '01-avatar'), { recursive: true })
  return dir
}

test('the hash covers the body only, so approving a file does not invalidate it', () => {
  const draft = stageFile({ status: 'draft', body: 'same body\n' })
  const approved = stageFile({ status: 'approved', body: 'same body\n' })
  assert.notEqual(draft, approved, 'the two files really are different on disk')
  assert.equal(bodyHash(draft), bodyHash(approved),
    'flipping status must not change the hash, or approving stage 2 would mark 3, 4 and 5 stale')

  const edited = stageFile({ status: 'draft', body: 'different body\n' })
  assert.notEqual(bodyHash(draft), bodyHash(edited), 'a real content change must change the hash')
})

test('front matter parses into top-level values, inputs and counts', () => {
  const { frontMatter } = splitFrontMatter(stageFile({
    stage: 3, inputs: { '01-avatar.md': 'aabbccdd' }, counts: { priceSet: 1, bonuses: 3 },
  }))
  const meta = parseFrontMatter(frontMatter)
  assert.equal(meta.stage, 3)
  assert.equal(meta.status, 'draft')
  assert.equal(meta.inputs['01-avatar.md'], 'aabbccdd')
  assert.equal(meta.counts.priceSet, 1)
  assert.equal(meta.counts.bonuses, 3)
})

test('changing an upstream stage marks the ones built on it stale, and blocks the rest', () => {
  const dir = scratch()
  const avatar = stageFile({ stage: 1, counts: { quotes: 159, languageEntries: 455 } })
  writeFileSync(join(dir, '01-avatar.md'), avatar)

  const bank = '# language bank\n'
  writeFileSync(join(dir, '01-avatar', 'Market_Language_Bank.md'), bank)

  const research = stageFile({
    stage: 2, inputs: { '01-avatar.md': bodyHash(avatar) },
    counts: { rowsVerified: 14, rowsWithFirstSeen: 10, competitorsFound: 5 },
  })
  writeFileSync(join(dir, '02-ad-research.md'), research)

  const offer = stageFile({
    stage: 3,
    inputs: { '01-avatar.md': bodyHash(avatar), '02-ad-research.md': bodyHash(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 3 },
    body: 'COMPLIANCE REVIEW REQUIRED\n',
  })
  writeFileSync(join(dir, '03-offer.md'), offer)

  let rows = evaluate(dir)
  assert.equal(rows.find(r => r.n === 3).state, 'READY', 'everything lines up to start with')

  // Rerun stage 2: its body changes, so stage 3 was built on the old one.
  writeFileSync(join(dir, '02-ad-research.md'), stageFile({
    stage: 2, inputs: { '01-avatar.md': bodyHash(avatar) },
    counts: { rowsVerified: 20, rowsWithFirstSeen: 15, competitorsFound: 6 },
    body: 'a completely new board\n',
  }))

  rows = evaluate(dir)
  const offerRow = rows.find(r => r.n === 3)
  assert.equal(offerRow.state, 'STALE')
  assert.match(offerRow.reasons.join(' '), /old ad research/)

  // And stage 4, which never recorded anything, is blocked behind it.
  assert.equal(rows.find(r => r.n === 4).state, 'MISSING')

  rmSync(dir, { recursive: true, force: true })
})

test('a stage that has not been run reports missing, not ready', () => {
  const dir = scratch()
  const rows = evaluate(dir)
  assert.ok(rows.every(r => r.state === 'MISSING'), 'an empty flywheel is all missing')
  assert.match(rows[0].reasons.join(' '), /has not been run/)
  rmSync(dir, { recursive: true, force: true })
})

test('a thin run fails its count gate instead of becoming the next stage input', () => {
  // This is the failure that already happened once: a stage returned an almost
  // empty document and the run carried on.
  const dir = scratch()
  writeFileSync(join(dir, '01-avatar.md'), stageFile({ stage: 1, counts: { quotes: 3, languageEntries: 5 } }))
  const row = evaluate(dir).find(r => r.n === 1)
  assert.equal(row.state, 'FAILED')
  assert.match(row.reasons.join(' '), /quotes is 3, needs at least 20/)
  rmSync(dir, { recursive: true, force: true })
})

test('a board where most ads have no start date fails, because longevity is the whole ranking', () => {
  const dir = scratch()
  const avatar = stageFile({ stage: 1, counts: { quotes: 159, languageEntries: 455 } })
  writeFileSync(join(dir, '01-avatar.md'), avatar)
  writeFileSync(join(dir, '02-ad-research.md'), stageFile({
    stage: 2, inputs: { '01-avatar.md': bodyHash(avatar) },
    counts: { rowsVerified: 12, rowsWithFirstSeen: 2, competitorsFound: 4 },
  }))
  const row = evaluate(dir).find(r => r.n === 2)
  assert.equal(row.state, 'FAILED')
  assert.match(row.reasons.join(' '), /only 2 of 12/)
  rmSync(dir, { recursive: true, force: true })
})

test('placeholder text left in a stage fails it', () => {
  const dir = scratch()
  const avatar = stageFile({ stage: 1, counts: { quotes: 159, languageEntries: 455 } })
  const research = stageFile({
    stage: 2, inputs: { '01-avatar.md': bodyHash(avatar) },
    counts: { rowsVerified: 14, rowsWithFirstSeen: 10, competitorsFound: 5 },
  })
  writeFileSync(join(dir, '01-avatar.md'), avatar)
  writeFileSync(join(dir, '02-ad-research.md'), research)

  // An offer with a TODO still in it is not finished, whatever its counts say.
  writeFileSync(join(dir, '03-offer.md'), stageFile({
    stage: 3,
    inputs: { '01-avatar.md': bodyHash(avatar), '02-ad-research.md': bodyHash(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 3 },
    body: 'TODO: decide the guarantee\n',
  }))
  let row = evaluate(dir).find(r => r.n === 3)
  assert.equal(row.state, 'FAILED')
  assert.match(row.reasons.join(' '), /still contains TODO/)

  // Same offer, clean body, passes.
  writeFileSync(join(dir, '03-offer.md'), stageFile({
    stage: 3,
    inputs: { '01-avatar.md': bodyHash(avatar), '02-ad-research.md': bodyHash(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 3 },
    body: 'a clean offer\n',
  }))
  row = evaluate(dir).find(r => r.n === 3)
  assert.equal(row.state, 'READY')

  rmSync(dir, { recursive: true, force: true })
})

test('stage 2 may run without the avatar, but stage 3 may not', () => {
  // This is what lets stages 1 and 2 run at the same time on a cold start.
  const dir = scratch()
  writeFileSync(join(dir, '02-ad-research.md'), stageFile({
    stage: 2, counts: { rowsVerified: 14, rowsWithFirstSeen: 10, competitorsFound: 5 },
  }))
  const rows = evaluate(dir)
  assert.equal(rows.find(r => r.n === 2).state, 'READY', 'the avatar is optional for ad research')
  assert.equal(rows.find(r => r.n === 1).state, 'MISSING')
  rmSync(dir, { recursive: true, force: true })
})

test('an offer with one guarantee fails — a stack is the point', () => {
  const dir = scratch()
  const avatar = stageFile({ stage: 1, counts: { quotes: 159, languageEntries: 455 } })
  const research = stageFile({
    stage: 2, inputs: { '01-avatar.md': bodyHash(avatar) },
    counts: { rowsVerified: 14, rowsWithFirstSeen: 10, competitorsFound: 5 },
  })
  writeFileSync(join(dir, '01-avatar.md'), avatar)
  writeFileSync(join(dir, '02-ad-research.md'), research)
  writeFileSync(join(dir, '03-offer.md'), stageFile({
    stage: 3,
    inputs: { '01-avatar.md': bodyHash(avatar), '02-ad-research.md': bodyHash(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 1 },
  }))
  const row = evaluate(dir).find(r => r.n === 3)
  assert.equal(row.state, 'FAILED')
  assert.match(row.reasons.join(' '), /only 1 guarantee/)
  rmSync(dir, { recursive: true, force: true })
})

test('copy that collapses to a few reasons fails the Andromeda floor', () => {
  // One argument restated many ways is still one argument, and Meta prices it
  // that way. Plenty of hooks is not the same as plenty of reasons.
  const dir = scratch()
  const offer = stageFile({ stage: 3, counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 3 } })
  const bank = '# language bank\n'
  writeFileSync(join(dir, '03-offer.md'), offer)
  writeFileSync(join(dir, '01-avatar', 'Market_Language_Bank.md'), bank)
  writeFileSync(join(dir, '04-copy.md'), stageFile({
    stage: 4,
    inputs: { '03-offer.md': bodyHash(offer), '01-avatar/Market_Language_Bank.md': bodyHash(bank) },
    counts: { hooks: 31, humanizerPassRun: 1, distinctReasons: 4 },
  }))
  const row = evaluate(dir).find(r => r.n === 4)
  assert.equal(row.state, 'FAILED')
  assert.match(row.reasons.join(' '), /4 distinct reasons, below Meta's Andromeda floor of 15/)
  rmSync(dir, { recursive: true, force: true })
})
