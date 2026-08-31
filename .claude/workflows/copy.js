export const meta = {
  name: 'copy',
  description: 'Write the ads and emails, then strip the AI tells mechanically. The humanizer pass is a regex in this script, not an instruction an agent can believe it followed. Stage 4 of the flywheel.',
  whenToUse: 'After the offer. Pass {campaign, today, offerSummary, avatarSummary, languageBank?, burnedOutAngles?, ownerNotes?} as args.',
  phases: [
    { title: 'Angles', detail: 'decide the spread once, deliberately, so the writers do not converge' },
    { title: 'Write', detail: 'one agent per angle, three lengths each' },
    { title: 'Humanize', detail: 'scan, attack, rewrite, re-scan. Loop until clean or dropped.' },
    { title: 'Verify', detail: 'promise-vs-terms, voice, and sameness across the whole set' },
  ],
}

// Duplicated on purpose - workflow scripts cannot import anything.
// Date.now(), Math.random() and new Date() all THROW in here.

const A = (typeof args === 'object' && args) || {}
const CAMPAIGN = A.campaign || 'partner'
const TODAY = A.today
if (!TODAY) return { error: 'args.today is required (YYYY-MM-DD). The clock is unavailable inside a workflow.' }

const OFFER = String(A.offerSummary || '')
if (!OFFER) return { error: 'args.offerSummary is required. Copy may not invent an offer.' }
const AVATAR = String(A.avatarSummary || '').slice(0, 7000)
const LANGUAGE_BANK = String(A.languageBank || '').slice(0, 9000)
const BURNED = Array.isArray(A.burnedOutAngles) ? A.burnedOutAngles : []
const OWNER_NOTES = String(A.ownerNotes || '').slice(0, 2000)

// ---------------------------------------------------------------------------
// The ban lists, inlined VERBATIM from ~/.claude/skills/humanizer/SKILL.md.
// Never paraphrase these - the scanner is a literal match and a reworded list
// silently stops catching things. If the skill changes, change this too.
// ---------------------------------------------------------------------------

const BAN_WORDS = ['delve', 'tapestry', 'leverage', 'utilize', 'robust', 'seamless', 'realm',
  'testament', 'beacon', 'underscore', 'showcase', 'pivotal', 'crucial', 'foster', 'elevate',
  'embark', 'unleash', 'navigate', 'landscape', 'boast', 'myriad', 'plethora', 'intricate',
  'vibrant', 'enhance', 'streamline', 'optimize', 'comprehensive', 'empower', 'holistic',
  'cultivate', 'resonate', 'align', 'nestled']

const BAN_PHRASES = ["in today's fast-paced world", 'when it comes to', "it's important to note",
  'plays a crucial role in', 'at the end of the day', 'the world of', 'more than just',
  'unlock the power of', 'elevate your', 'take it to the next level', 'supercharge',
  'move the needle', 'deep dive', 'low-hanging fruit', 'circle back', 'best-in-class',
  'in conclusion', 'a journey', 'treasure trove', 'the possibilities are endless']

const BAN_OPENERS = ['imagine a world where', 'have you ever wondered', 'picture this',
  'so there you have it', "let's dive in", "here's the thing", "here's the kicker",
  "but here's where it gets interesting", 'let that sink in', 'plot twist', 'trust me']

/**
 * The mechanical humanizer pass. Pure string work, run by the script on every
 * returned piece, so no agent can skip it or report a clean pass it did not earn.
 */
function banScan (text) {
  const hits = []
  if (!text) return hits
  const lower = text.toLowerCase()

  for (const w of BAN_WORDS) {
    if (new RegExp(`\\b${w}(s|d|ed|ing|es)?\\b`, 'i').test(text)) hits.push({ kind: 'word', hit: w })
  }
  for (const p of BAN_PHRASES) if (lower.includes(p)) hits.push({ kind: 'phrase', hit: p })
  for (const o of BAN_OPENERS) if (lower.trimStart().startsWith(o)) hits.push({ kind: 'opener', hit: o })

  if (text.includes('—')) hits.push({ kind: 'shape', hit: 'em dash' })
  if (/\b(it'?s|this is|that'?s) not [^.,;]{1,50}, it'?s /i.test(text)) {
    hits.push({ kind: 'shape', hit: "negative parallelism (it's not X, it's Y)" })
  }
  // Three or more consecutive very short sentences, stacked for drama.
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  let run = 0
  for (const s of sentences) {
    run = s.split(/\s+/).length <= 4 ? run + 1 : 0
    if (run >= 3) { hits.push({ kind: 'shape', hit: 'stacked staccato fragments' }); break }
  }
  // Sycophantic openers.
  if (/^\s*(great question|absolutely|certainly|i'?d be happy to)/i.test(text)) {
    hits.push({ kind: 'shape', hit: 'sycophancy' })
  }
  // Ending on a rhetorical question after the point is already made.
  if (sentences.length > 2 && /\?\s*$/.test(text.trim())) {
    hits.push({ kind: 'shape', hit: 'ends on a rhetorical question' })
  }
  return hits
}

/** Did the rewrite sand off the concrete detail that made the piece work? */
function keepsSpecifics (text, tokens) {
  if (!tokens.length) return true
  return tokens.some(t => text.toLowerCase().includes(String(t).toLowerCase()))
}

// ---------------------------------------------------------------------------

phase('Angles')
log(`copy for ${CAMPAIGN} as of ${TODAY}`)

const angleSpread = await agent(`Decide the angle spread BEFORE any copy is written. Deciding
divergence once, deliberately, is what stops twelve writers producing three ideas in twelve hats.

THE OFFER being sold:
${OFFER.slice(0, 7000)}

THE BUYER:
${AVATAR}

${LANGUAGE_BANK ? `THE MARKET'S OWN WORDS - copy is written from these phrases, not from your own vocabulary. This is owner-set:\n${LANGUAGE_BANK}\n` : ''}
${BURNED.length ? `ANGLES THAT ARE WORN OUT. These are FORBIDDEN. Do not assign any of them:\n${BURNED.map(b => '- ' + (b.angle || b)).join('\n')}\n` : ''}
${OWNER_NOTES ? `CORRECTIONS CHRIS HAS ALREADY MADE - these override everything:\n${OWNER_NOTES}\n` : ''}

Produce 12 angle assignments. For each:
- angleId: short kebab-case, reused down the chain
- audience: "in-market" (already believes this category works, just picking who) or
  "needs-convinced" (believes the outcome is possible, unsure this is the way)
- hookType: one of you-already-know, youre-doing-this-but, circumstance, straight-pain,
  aspirational, urgent
- theSpecificPain: the exact avatar pain or market gap this angle attacks, not a general theme
- whyItIsDifferent: one line on how this differs from the other eleven

Lean in-market: they convert cheapest and the offer is already built for them. Mixing the two
messages in one piece is the most common way copy underperforms.`,
  { label: 'angle-spread', phase: 'Angles', effort: 'high',
    schema: { type: 'object', additionalProperties: false, required: ['angles'],
      properties: { angles: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['angleId', 'audience', 'hookType', 'theSpecificPain'],
        properties: {
          angleId: { type: 'string' }, audience: { type: 'string', enum: ['in-market', 'needs-convinced'] },
          hookType: { type: 'string' }, theSpecificPain: { type: 'string' }, whyItIsDifferent: { type: 'string' },
        } } } } } })

const angles = ((angleSpread && angleSpread.angles) || []).slice(0, 12)
if (angles.length < 4) return { error: `Only ${angles.length} angles came back. Too few to write a diverse set from.`, angleSpread }
log(`${angles.length} angles assigned`)

phase('Write')

const PIECE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['pieces'],
  properties: {
    pieces: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['length', 'hook', 'body', 'cta'],
      properties: {
        length: { type: 'string', enum: ['short', 'mid', 'long'] },
        hook: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' },
      } } },
    emailSubjects: { type: 'array', items: { type: 'string' } },
  },
}

const NO_NEW_FACTS = `HARD RULE: copy may not introduce a single new fact. Every number, result,
testimonial and claim must already appear in the offer document above. If a piece needs a proof
point that is not there, rewrite the piece - do not invent the fact. This is stricter than the
offer stage on purpose: copy is the only thing here a stranger reads.`

// Five at a time, per CLAUDE.md section 5.
const written = []
for (let i = 0; i < angles.length; i += 5) {
  const chunk = angles.slice(i, i + 5)
  const batch = await parallel(chunk.map((a, j) => () => agent(
    `Write direct-response copy for ONE angle. Three lengths, all on your assigned angle.

YOUR ANGLE (${a.angleId}): ${a.theSpecificPain}
  audience: ${a.audience}
  hook type: ${a.hookType}
  ${a.whyItIsDifferent ? `what makes it different: ${a.whyItIsDifferent}` : ''}

THE OFFER:
${OFFER.slice(0, 7000)}

THE BUYER:
${AVATAR}

${LANGUAGE_BANK ? `THE MARKET'S OWN WORDS - use these phrases, not your own vocabulary:\n${LANGUAGE_BANK.slice(0, 5000)}\n` : ''}

Structure every piece Hook then Reasons then one CTA:
  short  2-4 lines: call out the pain, introduce the offer, CTA
  mid    5-7 lines: name the belief error, reveal the correction, anchor the offer, CTA
  long   8-12 lines: why most people in this situation stall, establish the offer as the
         blueprint, reframe acting as the smart move rather than the effortful one, CTA

Line breaks between sentences. One CTA, never a menu. Tie the CTA to the payoff, not the click.

Also give 3 email subject lines for this angle.

Write like a confident founder talking to another founder. No filler. Every sentence earns the
next one. Do not use em dashes. Do not write "it's not X, it's Y".

${NO_NEW_FACTS}`,
    { label: `write-${a.angleId}`, phase: 'Write', schema: PIECE_SCHEMA })))

  batch.filter(Boolean).forEach((r, k) => {
    const a = chunk[k]
    for (const p of (r.pieces || [])) {
      written.push({
        pieceId: `${a.angleId}-${p.length}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
        angleId: a.angleId, audience: a.audience, hookType: a.hookType,
        length: p.length, hook: p.hook, body: p.body, cta: p.cta,
      })
    }
    ;(r.emailSubjects || []).forEach((s, n) => written.push({
      pieceId: `${a.angleId}-EMAIL${n + 1}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      angleId: a.angleId, audience: a.audience, hookType: a.hookType,
      length: 'subject', hook: s, body: '', cta: '',
    }))
  })
  log(`written: ${written.length} pieces so far`)
}

phase('Humanize')

// Concrete tokens the rewrite must not sand off. Voice, not vagueness.
const SPECIFIC_TOKENS = (OFFER.match(/\$[\d,]+|\b\d{2,}%|\b\d+ (?:days?|weeks?|months?)\b/g) || []).slice(0, 12)

const cleaned = []
const dropped = []

for (let i = 0; i < written.length; i += 5) {
  const chunk = written.slice(i, i + 5)
  const results = await parallel(chunk.map(piece => async () => {
    let current = { ...piece }
    let pass = 0
    let hits = banScan([current.hook, current.body, current.cta].filter(Boolean).join('\n\n'))

    while (hits.length && pass < 3) {
      pass += 1
      const full = [current.hook, current.body, current.cta].filter(Boolean).join('\n\n')

      // The attacker handles only what a regex cannot see. One agent per piece:
      // one agent reviewing forty gets lazy by piece twenty.
      const attack = await agent(`Attack this copy for the AI tells a regex cannot catch. The
scanner has already found these, so do NOT repeat them: ${hits.map(h => h.hit).join(', ') || 'none'}

You are looking for:
- rule of three everywhere (three benefits, three adjectives, three of anything, repeatedly)
- every paragraph the same length
- staccato fragments stacked for drama
- ending on a rhetorical question when the point was already made
- anything a real person would not say out loud to another person

THE COPY:
${full}

Report only what you actually found. If it reads human, say so and return an empty list.`,
        { label: `attack-${current.pieceId}-p${pass}`, phase: 'Humanize', effort: 'low',
          schema: { type: 'object', additionalProperties: false, required: ['findings'],
            properties: { findings: { type: 'array', items: { type: 'string' } } } } })

      const rewrite = await agent(`Rewrite this copy to remove every problem listed. Keep the
argument, the offer and the specifics exactly as they are - your job is voice, not vagueness.

MUST STAY IN THE COPY, verbatim: ${SPECIFIC_TOKENS.join(', ') || '(no specific figures in this offer)'}

THE SCANNER FOUND:
${hits.map(h => `- ${h.kind}: ${h.hit}`).join('\n')}

A READER ALSO FOUND:
${((attack && attack.findings) || []).map(f => '- ' + f).join('\n') || '- nothing'}

THE COPY:
${full}

Return the rewritten hook, body and cta separately. Vary sentence length. Real sentences, just
fewer of them - do not answer in clipped fragments to save words.`,
        { label: `rewrite-${current.pieceId}-p${pass}`, phase: 'Humanize',
          schema: { type: 'object', additionalProperties: false, required: ['hook'],
            properties: { hook: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' } } } })

      if (!rewrite || !rewrite.hook) break
      current = { ...current, hook: rewrite.hook, body: rewrite.body || '', cta: rewrite.cta || '' }
      // Re-scan: a rewrite introduces new violations of its own.
      hits = banScan([current.hook, current.body, current.cta].filter(Boolean).join('\n\n'))
    }

    const finalText = [current.hook, current.body, current.cta].filter(Boolean).join('\n\n')
    current.humanizePasses = pass

    if (hits.length) {
      return { drop: { ...current, violations: hits.map(h => `${h.kind}: ${h.hit}`), reason: `still had AI tells after ${pass} passes` } }
    }
    if (!keepsSpecifics(finalText, SPECIFIC_TOKENS)) {
      return { drop: { ...current, violations: [], reason: 'the rewrite sanded off every concrete number' } }
    }
    return { keep: current }
  }))

  for (const r of results.filter(Boolean)) {
    if (r.keep) cleaned.push(r.keep); else if (r.drop) dropped.push(r.drop)
  }
  log(`humanized ${Math.min(i + 5, written.length)}/${written.length} | clean ${cleaned.length}, dropped ${dropped.length}`)
}

phase('Verify')

const SET = JSON.stringify(cleaned.map(p => ({ pieceId: p.pieceId, angleId: p.angleId, hook: p.hook, body: p.body, cta: p.cta }))).slice(0, 26000)

const lenses = (await parallel([
  () => agent(`PROMISE VERSUS TERMS. Read the offer, then read every piece of copy. Report any
piece that promises something the offer does not actually deliver, names a term that does not
match, or implies a result the offer never claimed.

THE OFFER:
${OFFER.slice(0, 8000)}

THE COPY:
${SET}`,
    { label: 'verify-promise', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),

  () => agent(`HUMAN VOICE. These pieces have all passed a mechanical check, so they break no
rules. Your job is different: which of them are technically clean and still read like ads?
Read each one out loud in your head. Name the pieceIds that a real person would not say, and
say what is wrong with each.

THE COPY:
${SET}`,
    { label: 'verify-voice', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),

  () => agent(`SAMENESS. Fan-out promises variety. You are the only thing that checks it.

Across this whole set: is this twenty ads, or three ads wearing twenty hats? Look for near
duplicate hooks, the same sentence structure repeating, the same opening word, the same
rhythm. Name the pieceIds that collapse into each other.

THE COPY:
${SET}`,
    { label: 'verify-sameness', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } }, distinctAngles: { type: 'number' } } } }),
])).filter(Boolean)

const issues = lenses.flatMap(l => l.issues || [])
log(`${cleaned.length} pieces clean, ${dropped.length} dropped, ${issues.length} issues raised`)

const document = await agent(`Write the copy document for ${CAMPAIGN}, as of ${TODAY}.

THE PIECES THAT PASSED (${cleaned.length}):
${SET}

DROPPED (${dropped.length}) - these did not ship:
${JSON.stringify(dropped.map(d => ({ pieceId: d.pieceId, reason: d.reason, violations: d.violations }))).slice(0, 4000)}

ISSUES RAISED BY THE REVIEW LENSES:
${issues.map(i => '- ' + i).join('\n').slice(0, 6000)}

Lay it out so Chris can pick what to run:
1. The three hooks you would run first, and why those three.
2. Every piece, grouped by angle, with its pieceId shown. The pieceId matters - the ad in
   Facebook must be named starting with it, or spend data cannot be matched back later.
3. The email subject lines.
4. What was dropped and why.
5. What the review flagged.

Plain words. Do not rewrite the copy itself - print it as it is.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** Read hook #1 out loud - would you say that? · Does any line promise a credit result or an income number? · Which three hooks do we run?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`,
  { label: 'assemble', phase: 'Verify', effort: 'high' })

return {
  campaign: CAMPAIGN, asOf: TODAY,
  angles, pieces: cleaned, dropped, issues,
  counts: {
    hooks: cleaned.filter(p => p.length !== 'subject').length,
    humanizerPassRun: 1,
    droppedForTells: dropped.length,
    anglesUsed: new Set(cleaned.map(p => p.angleId)).size,
  },
  document,
}
