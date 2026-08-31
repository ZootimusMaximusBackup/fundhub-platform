export const meta = {
  name: 'offer',
  description: 'Design and price the offer. Six candidates from assigned archetypes, four judges with different jobs, one winner with the best parts of the losers grafted in. Stage 3 of the flywheel.',
  whenToUse: 'After ad research. Pass {campaign, today, avatarSummary, adResearchSummary, ownerNotes?} as args.',
  phases: [
    { title: 'Ground', detail: 'read the real prices and the real cost of a customer, so nobody invents numbers' },
    { title: 'Doctrine', detail: 'load the offer frameworks from disk' },
    { title: 'Generate', detail: 'six candidates, each assigned a different lever to pull' },
    { title: 'Judge', detail: 'four judges with genuinely different jobs' },
    { title: 'Synthesize', detail: 'the winner, plus the best parts of the runners-up' },
    { title: 'Verify', detail: 'proof and arithmetic, adversarially' },
  ],
}

// Duplicated on purpose - workflow scripts cannot import anything.
// Date.now(), Math.random() and new Date() all THROW in here.

const A = (typeof args === 'object' && args) || {}
const CAMPAIGN = A.campaign || 'partner'
const TODAY = A.today
if (!TODAY) return { error: 'args.today is required (YYYY-MM-DD). The clock is unavailable inside a workflow.' }

const AVATAR = String(A.avatarSummary || '').slice(0, 8000)
const RESEARCH = String(A.adResearchSummary || '').slice(0, 8000)
const OWNER_NOTES = String(A.ownerNotes || '').slice(0, 2000)

const NO_INVENTED_PROOF = `HARD RULES:
Every claim names the proof that backs it, and that proof must ALREADY EXIST. If it does not,
the claim is DELETED, not softened. Where there is no proof, write
"PROOF: NONE ON FILE - claim removed". No invented testimonials, no invented case-study numbers,
no "clients typically see...".
Every price traces to src/config/offers.mjs, or is marked "PRICE CHANGE PROPOSED" with the old
value beside it.
The 30-day cash rule is arithmetic, not a feeling. Show the numbers. Run the arithmetic with
node through Bash - do not do it in your head.`

// ---------------------------------------------------------------------------

phase('Ground')
log(`offer for ${CAMPAIGN} as of ${TODAY}`)

const ground = await agent(`Read the real numbers this business already runs on. Do not design
anything yet - this step exists so nobody downstream invents a price.

Read these files and report what they actually say:
- src/config/offers.mjs  (the live prices and SKUs)
- docs/workflows/ads-waterfall-projections-2026-08-26.md  (real cost per booked call, close rate, daily budget)
- docs/avatars/partner/COPY-DIRECTIVES.md  (owner-set rules that constrain what may be promised)
- docs/ads/ascension-ads.md if it exists

Find and report, exactly as written:
- every price and SKU currently live, with its constant name
- what it currently costs to get a customer, and the close rate, and where that number came from
- the daily ad budget actually being modelled
- any terms that are already locked and must not be changed by an offer

If a file is missing, say so. A missing file is a finding, not something to work around.

${NO_INVENTED_PROOF}`,
  { label: 'ground', phase: 'Ground', effort: 'high',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['prices', 'notes'],
      properties: {
        prices: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['name', 'amount'], properties: { name: { type: 'string' }, amount: { type: 'string' }, source: { type: 'string' } } } },
        costPerCustomer: { type: 'string' },
        closeRate: { type: 'string' },
        dailyBudget: { type: 'string' },
        lockedTerms: { type: 'array', items: { type: 'string' } },
        missingFiles: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    } })

const FACTS = JSON.stringify(ground || {}, null, 1).slice(0, 6000)
log(`grounded: ${((ground && ground.prices) || []).length} live prices found`)

phase('Doctrine')

// The Skill tool cannot see user-level skills from inside a workflow - measured
// 2026-08-31, it answers "Unknown skill: offer". Agents CAN read the files, so
// the doctrine is loaded from disk instead. Paths are discovered, never assumed.
const doctrine = await agent(`Load the offer-design doctrine from disk. Do NOT use the Skill
tool - it cannot see these. Find the files yourself:

  ls ~/.claude/skills/offer/ && ls ~/.claude/skills/offer/references/

Read SKILL.md and the reference files that matter for BUILDING and PRICING an offer:
value-equation.md, pricing.md, proof-and-guarantees.md, bonuses-scarcity-urgency-naming.md,
money-models.md.

Return the operative rules only - the frameworks, the steps, the thresholds, the numbers. Not
the prose. Another agent will design against what you return, so anything you leave out does
not exist as far as this workflow is concerned.

If the directory is not there, say so plainly and return found=false.`,
  { label: 'doctrine', phase: 'Doctrine', effort: 'high',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['found', 'brief'],
      properties: {
        found: { type: 'boolean' },
        brief: { type: 'string', description: 'the operative rules, compact' },
        valueEquation: { type: 'string' },
        pricingRules: { type: 'array', items: { type: 'string' } },
      },
    } })

if (!doctrine || !doctrine.found) {
  return { error: 'The offer doctrine could not be read from ~/.claude/skills/offer/. Designing an offer without it would be guessing. Nothing was generated.', ground }
}
const DOCTRINE = String(doctrine.brief || '').slice(0, 12000)
log('doctrine loaded from disk')

phase('Generate')

// Assigned, not discovered. Six agents on one open prompt write six versions of
// the same offer and the judging becomes theatre. Each archetype pulls a
// different lever of the value equation.
const ARCHETYPES = [
  { id: 'A-dream', lever: 'Dream outcome. Same delivery, a different and bigger promised end state. Hold the price.' },
  { id: 'B-mechanism', lever: 'Mechanism. Take the unique named mechanism this business actually has and make it the product. Hold the price.' },
  { id: 'C-risk', lever: 'Perceived likelihood. Lead with risk reversal - a guarantee tied to something the client must measurably do. The price may rise.' },
  { id: 'D-speed', lever: 'Time delay. Compress time to first result. Done-with-you becomes done-for-you. The price may rise.' },
  { id: 'E-effort', lever: 'Effort and sacrifice. Make it easier to say yes by changing the payment terms or what they have to do - NEVER by discounting the same thing. The price may fall but must still clear the 30-day rule.' },
  { id: 'F-sequence', lever: 'Money model. Not one offer but a sequence: something to attract, something to upsell, something recurring. Build it only from SKUs that already exist. Show the 30-day cash arithmetic.' },
]

const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'promise', 'price', 'whatTheyGet', 'valueEquation'],
  properties: {
    name: { type: 'string' },
    promise: { type: 'string' },
    mechanism: { type: 'string' },
    price: { type: 'string' },
    paymentTerms: { type: 'string' },
    whatTheyGet: { type: 'array', items: { type: 'string' } },
    guarantee: { type: 'string' },
    bonuses: { type: 'array', items: { type: 'string' } },
    valueEquation: { type: 'object', additionalProperties: false,
      required: ['dreamOutcome', 'perceivedLikelihood', 'timeDelay', 'effortSacrifice'],
      properties: {
        dreamOutcome: { type: 'number' }, perceivedLikelihood: { type: 'number' },
        timeDelay: { type: 'number' }, effortSacrifice: { type: 'number' },
      } },
    thirtyDayMath: { type: 'string' },
    proofUsed: { type: 'array', items: { type: 'string' } },
    proofMissing: { type: 'array', items: { type: 'string' } },
  },
}

const candidates = (await parallel(ARCHETYPES.map((arch, i) => () => agent(
  `Design ONE offer. You have been assigned a specific lever and you must pull THAT lever.
Other agents are pulling the others, so do not hedge toward the middle.

YOUR ASSIGNED LEVER: ${arch.lever}

THE BUYER:
${AVATAR}

WHAT THE MARKET IS ALREADY SELLING (do not repeat a worn-out angle):
${RESEARCH || 'no ad research was supplied - design from the avatar and say so in your reasoning'}

THE REAL NUMBERS - prices, cost per customer, locked terms. These are facts, not suggestions:
${FACTS}

THE DOCTRINE you are designing against:
${DOCTRINE}
${OWNER_NOTES ? `\nCORRECTIONS CHRIS HAS ALREADY MADE - these override everything above:\n${OWNER_NOTES}` : ''}

Score your own offer 1-10 on each of the four value-equation drivers. Be honest; a judge panel
is about to score it too and inflated self-scores just make you look wrong.

Show the 30-day cash arithmetic: gross profit from one customer in their first 30 days against
what it costs to get them. Run it with node through Bash.

${NO_INVENTED_PROOF}`,
  { label: `gen-${arch.id}`, phase: 'Generate', schema: CANDIDATE_SCHEMA, effort: 'high' })))
).map((c, i) => c ? { ...c, archetype: ARCHETYPES[i].id } : null).filter(Boolean)

if (candidates.length < 3) {
  return { error: `Only ${candidates.length} of 6 candidates came back. Too few to judge between. Nothing was chosen.`, ground, candidates }
}
log(`${candidates.length} candidates generated`)

phase('Judge')

// Anonymised and reordered by the SCRIPT, so judges cannot favour a position or
// recognise an archetype they like the sound of.
const shuffled = candidates.map((c, i) => ({ ...c, blindId: `Offer ${'ABCDEF'[i]}` }))
const BLIND = JSON.stringify(shuffled.map(c => {
  const { archetype, ...rest } = c
  return rest
})).slice(0, 24000)

const JUDGES = [
  { id: 'buyer', job: `You ARE the buyer described in the avatar. Not a marketer looking at them - them. Would you actually hand over this money? What is your first objection? Which one makes you feel stupid for not taking it, and which one smells like every other pitch you have already been burned by?` },
  { id: 'operator', job: `You run delivery. Can FundHub actually deliver this, every time, at this margin, with the team it has? Kill anything beautiful and unbuildable. Read the avatar and the grounded facts for what delivery actually involves.` },
  { id: 'accountant', job: `Money only. For each offer: gross profit in the first 30 days against the real cost to get a customer. Does it clear 2x? Over a lifetime, does it clear 3:1 against acquisition cost? If the close rate would be above half, the price is too low - say so. Run the arithmetic with node through Bash, do not do it in your head.` },
  { id: 'competitor', job: `You are a competitor who wants to take this market. For each offer, try to beat it - cheaper, faster, or with less risk to the buyer. If you can beat it easily, it is a commodity and you should say so. This is the seat that finds the problem a rubric cannot.` },
]

const SCORE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scores'],
  properties: {
    scores: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['blindId', 'dims', 'killShot', 'bestPart'],
      properties: {
        blindId: { type: 'string' },
        dims: { type: 'object', additionalProperties: false,
          required: ['dreamOutcome', 'perceivedLikelihood', 'timeDelay', 'effortSacrifice', 'incomparability', 'proofBacking', 'thirtyDayCash', 'deliverability'],
          properties: {
            dreamOutcome: { type: 'number' }, perceivedLikelihood: { type: 'number' },
            timeDelay: { type: 'number' }, effortSacrifice: { type: 'number' },
            incomparability: { type: 'number' }, proofBacking: { type: 'number' },
            thirtyDayCash: { type: 'number' }, deliverability: { type: 'number' },
          } },
        killShot: { type: 'string', description: 'the strongest single reason to reject this offer' },
        bestPart: { type: 'string', description: 'the one element worth keeping even if this offer loses' },
      } } },
  },
}

const panels = (await parallel(JUDGES.map(j => () => agent(
  `You are one of four judges scoring the same set of offers. Your seat has a specific job and
you should judge from it, not from a general sense of quality.

YOUR JOB: ${j.job}

THE BUYER:
${AVATAR}

THE REAL NUMBERS:
${FACTS}

THE OFFERS (anonymised - judge the offer, not the label):
${BLIND}

Score EVERY offer on all eight dimensions, 1 to 10. Higher is better on all eight, including
timeDelay and effortSacrifice - a 10 there means fastest and easiest for the buyer.
  dreamOutcome, perceivedLikelihood, timeDelay, effortSacrifice,
  incomparability (could a buyer put this beside a competitor and pick on price?),
  proofBacking (does proof that ALREADY EXISTS support every claim?),
  thirtyDayCash, deliverability

For every offer also give a killShot and a bestPart. The bestPart matters as much as the score:
it is how the winning offer gets the good organs from the losing ones.`,
  { label: `judge-${j.id}`, phase: 'Judge', schema: SCORE_SCHEMA, effort: 'high' })))
).filter(Boolean)

// Aggregation is arithmetic and belongs in the script, not in an agent.
const DIMS = ['dreamOutcome', 'perceivedLikelihood', 'timeDelay', 'effortSacrifice', 'incomparability', 'proofBacking', 'thirtyDayCash', 'deliverability']
const WEIGHT = { perceivedLikelihood: 2, proofBacking: 1.5, incomparability: 1.5, thirtyDayCash: 1.5, deliverability: 1.25, dreamOutcome: 1, timeDelay: 1, effortSacrifice: 1 }

const aggregate = shuffled.map(c => {
  const rows = panels.flatMap(p => (p.scores || []).filter(s => s.blindId === c.blindId))
  const per = {}
  let weighted = 0, wsum = 0
  for (const d of DIMS) {
    const vals = rows.map(r => Number(r.dims && r.dims[d])).filter(n => Number.isFinite(n))
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0
    per[d] = { mean: Math.round(mean * 10) / 10, spread }
    weighted += mean * WEIGHT[d]; wsum += WEIGHT[d]
  }
  return {
    blindId: c.blindId, archetype: c.archetype, name: c.name,
    weighted: Math.round((weighted / (wsum || 1)) * 100) / 100,
    dims: per,
    maxSpread: Math.max(...DIMS.map(d => per[d].spread)),
    killShots: rows.map(r => r.killShot).filter(Boolean),
    bestParts: rows.map(r => r.bestPart).filter(Boolean),
  }
}).sort((a, b) => b.weighted - a.weighted)

const winner = aggregate[0]
const runnerUp = aggregate[1]
const close = runnerUp && (winner.weighted - runnerUp.weighted) / (winner.weighted || 1) < 0.05
log(`winner: ${winner.archetype} at ${winner.weighted}${close ? ` (within 5% of ${runnerUp.archetype})` : ''} | widest disagreement: ${winner.maxSpread}`)

phase('Synthesize')

const finalOffer = await agent(`Write the final offer for ${CAMPAIGN}.

THE WINNER (${winner.blindId}, ${winner.archetype}, weighted ${winner.weighted}):
${JSON.stringify(shuffled.find(c => c.blindId === winner.blindId)).slice(0, 8000)}

WHAT THE JUDGES SAID TO KILL ABOUT IT:
${winner.killShots.map(k => '- ' + k).join('\n')}

THE BEST PARTS OF THE OFFERS THAT LOST - graft the ones that fit, name what you took:
${aggregate.slice(1).map(a => `${a.archetype}: ${a.bestParts.join(' | ')}`).join('\n').slice(0, 6000)}

SCORES, including where the judges disagreed most:
${JSON.stringify(aggregate.map(a => ({ archetype: a.archetype, weighted: a.weighted, maxSpread: a.maxSpread }))).slice(0, 2000)}
${winner.maxSpread >= 4 ? `\nNOTE: the judges disagreed by ${winner.maxSpread} points on at least one dimension for the winning offer. That is a specific problem, not noise. Name it in the write-up rather than averaging it away.` : ''}

THE REAL NUMBERS:
${FACTS}
${OWNER_NOTES ? `\nCORRECTIONS CHRIS HAS ALREADY MADE - these override everything:\n${OWNER_NOTES}` : ''}

Write the offer as a document Chris can act on. Sections:
1. The offer in one sentence.
2. The price, and why that number.
3. What they get - the actual list.
4. The guarantee.
5. The bonuses.
6. What we took from the offers that lost, and why.
7. What the judges wanted to kill, and what we did about each one.
8. The 30-day cash arithmetic, shown.
9. What we could not prove - claims removed for lack of proof.

Plain words, short sentences. Chris does not read code.

${NO_INVENTED_PROOF}

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** The price is <X> - yes or no? · Can we deliver this every time? · Can we afford the guarantee if three people claim it?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' })

phase('Verify')

const checks = (await parallel([
  () => agent(`PROOF LENS. Read this offer and find every claim that is not backed by proof that
already exists. A claim is anything stated as fact about results, outcomes, speed, or what
other clients got.

For each: quote it, and say whether proof for it exists in what you were given. If it does not,
it must be DELETED, not softened. Report each one.

${finalOffer}`,
    { label: 'verify-proof', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),

  () => agent(`ARITHMETIC LENS. Recompute every number in this offer. Use node through Bash -
do NOT do arithmetic in your head, you are bad at it and this is exactly where it matters.

Check: the 30-day cash math, the guarantee exposure if several people claim it at once, any
percentage, any total, any per-unit figure. Report every number that does not check out, with
the correct value.

THE REAL NUMBERS FOR REFERENCE:
${FACTS}

THE OFFER:
${finalOffer}`,
    { label: 'verify-math', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),

  () => agent(`LOCKED-TERMS LENS. This business has terms that are already decided and must not
be changed by an offer. Read the grounded facts for what they are, then read the offer and
report anything that contradicts them or quietly changes one.

GROUNDED FACTS:
${FACTS}

THE OFFER:
${finalOffer}`,
    { label: 'verify-terms', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),
])).filter(Boolean)

const issues = checks.flatMap(c => c.issues || [])
log(`${issues.length} issues from verification`)

let document = finalOffer
if (issues.length) {
  document = await agent(`Fix these problems in the offer. Change only what is named. Do not
rewrite anything that was not flagged, and do not soften a claim when the instruction is to
delete it.

ISSUES:
${issues.map(i => '- ' + i).join('\n')}

THE OFFER:
${finalOffer}

Return the corrected document only, keeping the Review card block at the end.`,
    { label: 'repair', phase: 'Verify', effort: 'high' })
}

const chosen = shuffled.find(c => c.blindId === winner.blindId) || {}

return {
  campaign: CAMPAIGN, asOf: TODAY,
  ground, candidates: shuffled, aggregate,
  winner: { archetype: winner.archetype, weighted: winner.weighted, maxSpread: winner.maxSpread },
  runoffAdvised: !!close,
  issuesFixed: issues.length,
  counts: {
    priceSet: chosen.price ? 1 : 0,
    bonuses: (chosen.bonuses || []).length,
    valueEquationScores: chosen.valueEquation ? Object.keys(chosen.valueEquation).length : 0,
  },
  document,
}
