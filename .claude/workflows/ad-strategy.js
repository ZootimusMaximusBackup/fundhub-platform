export const meta = {
  name: 'ad-strategy',
  description: 'Pick the campaign strategy and check it can actually run at the real budget with the creative that actually exists. Stage 5 of the flywheel.',
  whenToUse: 'After copy. Pass {campaign, today, offerSummary, copySummary, creativeCount, ownerNotes?} as args.',
  phases: [
    { title: 'Ground', detail: 'the real budget and the real creative inventory' },
    { title: 'Doctrine', detail: 'the strategy decision table' },
    { title: 'Build', detail: 'one plan per spend level' },
    { title: 'Check', detail: 'will it run, can we afford it, do we have the creative' },
  ],
}

// Duplicated on purpose - workflow scripts cannot import anything.
// Date.now(), Math.random() and new Date() all THROW in here.
//
// This stage is deliberately SMALL. Choosing between six named strategies is a
// lookup, and one agent reading the decision table gets it right. Six agents
// arguing would be theatre. It is a workflow for the CHECKING, not the thinking:
// a plain session gets three things wrong every time, and those three checks are
// the whole reason this file exists.

const A = (typeof args === 'object' && args) || {}
const CAMPAIGN = A.campaign || 'partner'
const TODAY = A.today
if (!TODAY) return { error: 'args.today is required (YYYY-MM-DD). The clock is unavailable inside a workflow.' }

const OFFER = String(A.offerSummary || '')
if (!OFFER) return { error: 'args.offerSummary is required.' }
const COPY = String(A.copySummary || '').slice(0, 7000)
const CREATIVE_COUNT = Number(A.creativeCount) || 0
const OWNER_NOTES = String(A.ownerNotes || '').slice(0, 2000)

const NO_INVENTED_BENCHMARKS = `HARD RULE ON NUMBERS: every number in the plan - cost per
thousand views, cost per click, cost per booked call, close rate, return on spend, budget split
- is either taken from FundHub's own recorded results with the FILE NAMED, or it is labelled
ASSUMPTION with the reasoning shown. No benchmark numbers from memory. An invented benchmark is
what makes a bad plan look validated.`

// ---------------------------------------------------------------------------

phase('Ground')
log(`ad strategy for ${CAMPAIGN} as of ${TODAY} | ${CREATIVE_COUNT} creative pieces available`)

const ground = await agent(`Read the real operating numbers before any plan is written.

Read and report exactly what they say:
- docs/workflows/ads-waterfall-projections-2026-08-26.md
- docs/workflows/ads-revenue-model-2026-08-24.md if it exists
- src/config/offers.mjs
- docs/ads/ascension-ads.md if it exists

Report:
- the daily ad budget actually being modelled, not an aspirational one
- cost per booked call, close rate, and cash per booked call, with the file each came from
- what the offer being sold costs
- anything already decided about how these campaigns run

A missing file is a finding. Say so rather than filling the gap.

${NO_INVENTED_BENCHMARKS}`,
  { label: 'ground', phase: 'Ground', effort: 'high',
    schema: { type: 'object', additionalProperties: false, required: ['dailyBudget', 'notes'],
      properties: {
        dailyBudget: { type: 'string' }, costPerBookedCall: { type: 'string' },
        closeRate: { type: 'string' }, cashPerBookedCall: { type: 'string' },
        sourceFiles: { type: 'array', items: { type: 'string' } },
        missingFiles: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      } } })

const FACTS = JSON.stringify(ground || {}, null, 1).slice(0, 5000)

phase('Doctrine')

const doctrine = await agent(`Load the ad strategy doctrine from disk. Do NOT use the Skill
tool - it cannot see this one. Find it yourself; it is a synced plugin, so the path has two
random-looking folder names in it:

  find ~/Library/Application\\ Support/Claude -type d -name "jeremy-haynes-ad-system" 2>/dev/null

Read SKILL.md and the reference file covering the named strategies and the scaling framework.
The references are large - read the strategy SELECTION table and the sections for the lowest
spend levels. You do not need the whole thing.

Return, compactly:
- the six named strategies, and the situation each one is for
- what each one REQUIRES to run: how many videos or creative pieces, what daily budget, whether
  a sales team is needed
- the selection rule: given a budget and a creative count, which one is correct

If you cannot find the directory, say so and return found=false.`,
  { label: 'doctrine', phase: 'Doctrine', effort: 'high',
    schema: { type: 'object', additionalProperties: false, required: ['found', 'brief'],
      properties: {
        found: { type: 'boolean' }, brief: { type: 'string' },
        strategies: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['name', 'forWhen'],
          properties: { name: { type: 'string' }, forWhen: { type: 'string' }, requires: { type: 'string' } } } },
      } } })

if (!doctrine || !doctrine.found) {
  return { error: 'The ad strategy doctrine could not be read from disk. Picking a strategy without the decision table would be guessing.', ground }
}
const DOCTRINE = String(doctrine.brief || '').slice(0, 12000)
log(`doctrine loaded: ${((doctrine.strategies) || []).length} strategies`)

phase('Build')

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['strategyName', 'whyThisOne', 'campaignStructure', 'dailyBudget'],
  properties: {
    strategyName: { type: 'string' },
    whyThisOne: { type: 'string' },
    dailyBudget: { type: 'string' },
    campaignStructure: { type: 'string' },
    adSets: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'audience', 'creativeIds'],
      properties: {
        name: { type: 'string' }, audience: { type: 'string' },
        creativeIds: { type: 'array', items: { type: 'string' } },
        dailyBudget: { type: 'string' },
      } } },
    targeting: { type: 'object', additionalProperties: true, description: 'the actual targeting payload as it would be sent to Meta' },
    creativeNeeded: { type: 'number' },
    rotationRule: { type: 'string' },
    whenToScale: { type: 'string' },
    whenToStop: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
}

// The one axis worth running twice: the right strategy genuinely differs by
// spend level, and the doctrine is organised that way.
const SPEND_LEVELS = ['what we can run now, at the budget in the grounded facts', 'the next step up, roughly 2.5x the current daily budget']

const plans = (await parallel(SPEND_LEVELS.map((level, i) => () => agent(
  `Choose the campaign strategy and build the plan. Do not invent a strategy - pick from the
named ones in the doctrine using its own selection rule.

SPEND LEVEL FOR THIS PLAN: ${level}

THE REAL NUMBERS:
${FACTS}

CREATIVE THAT ACTUALLY EXISTS: ${CREATIVE_COUNT} distinct pieces.
${COPY ? `\nWhat the copy stage produced:\n${COPY}` : ''}

THE OFFER:
${OFFER.slice(0, 6000)}

THE DOCTRINE:
${DOCTRINE}
${OWNER_NOTES ? `\nCORRECTIONS CHRIS HAS ALREADY MADE - these override everything:\n${OWNER_NOTES}` : ''}

Two things that will make this plan wrong if you ignore them:

1. The doctrine's lowest scaling chapter assumes a far larger daily budget than this business
   actually spends. If a step only works at ten times the real budget, do not write it - say
   the budget does not reach it.
2. A strategy that needs more creative than the ${CREATIVE_COUNT} pieces that exist is fiction.
   Check the requirement before you choose. And count REASONS, not pieces - Meta's Andromeda
   algorithm wants 15 to 20 genuinely different arguments, each with its own hook, body and
   close. Length variants of one argument do not count toward that floor.

Give the targeting as an actual payload object, the way it would be sent to Meta, because it is
about to be run through a checker.

Name every ad set's creative by the pieceIds from the copy stage. Those ids are how spend gets
matched back to an angle later.

${NO_INVENTED_BENCHMARKS}`,
  { label: `plan-${i + 1}`, phase: 'Build', schema: PLAN_SCHEMA, effort: 'high' })))
).filter(Boolean)

if (!plans.length) return { error: 'No plan came back.', ground }
log(`${plans.length} plans built: ${plans.map(p => p.strategyName).join(', ')}`)

phase('Check')

const ISSUES = { type: 'object', additionalProperties: false, required: ['issues'],
  properties: {
    issues: { type: 'array', items: { type: 'string' } },
    verdicts: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['tactic', 'verdict'],
      properties: { tactic: { type: 'string' }, verdict: { type: 'string' }, substitute: { type: 'string' } } } },
    ok: { type: 'boolean' },
  } }

const checks = (await parallel([
  // Will Meta actually let this run? This is an operational question, not a
  // review: the repo already has a checker and it is free to call.
  () => agent(`WILL META ACCEPT THIS. Credit and lending advertisers sit in a restricted
category on Meta, and several ordinary targeting tactics are simply rejected there. A plan that
uses one does not underperform - it does not run at all.

The repo already has a checker for this. Use it, do not judge by eye:

  node --input-type=module -e "import { screenTargeting } from '/Users/zootimusmaximus/fundhub-platform/src/compliance/targeting.mjs'; console.log(JSON.stringify(screenTargeting(PAYLOAD, {platform:'meta'}), null, 2))"

Run every plan's targeting payload through it and paste the exact output.

TARGETING PAYLOADS:
${JSON.stringify(plans.map(p => ({ strategy: p.strategyName, targeting: p.targeting }))).slice(0, 6000)}

Then read the plans and mark every TACTIC as permitted, rejected, or needs-substitute. Where a
tactic is rejected, name the legal substitute. The playbook these plans came from never mentions
this category, and it recommends lookalike audiences repeatedly, so check for that specifically.

THE PLANS:
${JSON.stringify(plans).slice(0, 12000)}`,
    { label: 'check-will-it-run', phase: 'Check', schema: ISSUES, effort: 'high' }),

  () => agent(`BUDGET REALISM. Does every instruction in these plans actually work at the real
daily budget?

THE REAL NUMBERS:
${FACTS}

Check specifically:
- any step that silently assumes several times the real budget
- a structure with so many ad sets that none of them gets enough spend to learn
- the implied cost to get one customer against what the offer is worth in its first 30 days
- whether the creative rotation rate is affordable at this spend

THE PLANS:
${JSON.stringify(plans).slice(0, 12000)}`,
    { label: 'check-budget', phase: 'Check', schema: ISSUES, effort: 'high' }),

  () => agent(`CREATIVE SUPPLY, AND THE ANDROMEDA FLOOR. ${CREATIVE_COUNT} creative pieces exist.

Two separate questions, and the second one is the one people get wrong.

1. Does each plan need more pieces than exist?

2. How many DISTINCT REASONS do those pieces actually cover? Meta's Andromeda algorithm
   (fully rolled out ~July 2025) rewards messaging range, not piece count. Fifteen ads built
   on one argument are one ad as far as the auction is concerned - the source SOP names those
   subtle variances as the thing currently punishing advertisers, and the floor for a stable
   account is 15 to 20 genuinely different reasons, each filmed end to end with its own hook,
   body and close.

   So: count the reasons, not the files. Short, mid and long cuts of one argument are ONE
   reason. If the set is short of 15 distinct reasons, say so plainly - a plan that runs a
   collapsed set at scale gets expensive fast, and no amount of budget fixes it.

Also check FORMAT, not just count: a plan whose audience-building depends on video views
cannot run on written scripts.

This is the cross-check that makes chaining the copy and strategy stages worth anything: if a
plan needs forty pieces a week and twelve exist, the plan is fiction and should say so instead
of being written as if it will run.

For each plan report what it needs, what exists, and the shortfall.

THE PLANS:
${JSON.stringify(plans).slice(0, 12000)}`,
    { label: 'check-creative-and-andromeda', phase: 'Check', schema: ISSUES, effort: 'high' }),
])).filter(Boolean)

const issues = checks.flatMap(c => c.issues || [])
const verdicts = checks.flatMap(c => c.verdicts || [])
const willRun = checks[0] && checks[0].ok !== false
log(`${issues.length} issues, ${verdicts.length} tactic verdicts${willRun ? '' : ' | targeting was rejected'}`)

// One repair, then stop. The stuck rule: do not try a third time.
let repaired = null
if (issues.length) {
  repaired = await agent(`Fix these problems in the plans. Change only what is named.

If a targeting tactic was rejected, replace it with the named substitute. If a step needs more
budget than exists, remove it and say the budget does not reach it. If a plan needs more
creative than exists, say so plainly rather than quietly reducing the requirement.

ISSUES:
${issues.map(i => '- ' + i).join('\n')}

TACTIC VERDICTS:
${JSON.stringify(verdicts).slice(0, 4000)}

THE PLANS:
${JSON.stringify(plans).slice(0, 12000)}

Return the corrected plans as prose, not JSON.`,
    { label: 'repair', phase: 'Check', effort: 'high' })
}

const document = await agent(`Write the ad strategy document for ${CAMPAIGN}, as of ${TODAY}.

THE PLANS:
${repaired || JSON.stringify(plans, null, 1).slice(0, 14000)}

TACTIC VERDICTS - which tactics Meta will accept in this category:
${JSON.stringify(verdicts).slice(0, 5000)}

ISSUES FOUND AND WHAT WAS DONE:
${issues.map(i => '- ' + i).join('\n').slice(0, 5000)}

THE REAL NUMBERS:
${FACTS}

Write it so Chris can act on it. Sections:
1. Which strategy, and why that one.
2. What it costs on day one, before anything is learned.
3. The campaign structure - what to build, in order.
4. Which creative goes where, by pieceId.
5. Tactics that would get the ads rejected, and what to use instead.
6. When to spend more, when to stop.
7. What this plan assumes, listed plainly, and what it needs that we do not have yet.

Plain words, short sentences. Chris does not read code. Do not use jargon without defining it
in five words on the spot.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** This needs <N> videos and <$X>/day - do we have that? · Day one costs <$Y> before we learn anything - yes? · Where does the traffic land?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`,
  { label: 'assemble', phase: 'Check', effort: 'high' })

return {
  campaign: CAMPAIGN, asOf: TODAY,
  ground, plans, verdicts, issues,
  targetingAccepted: willRun,
  counts: {
    strategyNamed: plans[0] && plans[0].strategyName ? 1 : 0,
    dailyBudgetStated: plans[0] && plans[0].dailyBudget ? 1 : 0,
    plansBuilt: plans.length,
    creativeAvailable: CREATIVE_COUNT,
  },
  document,
}
