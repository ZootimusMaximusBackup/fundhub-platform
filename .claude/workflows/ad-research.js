export const meta = {
  name: 'ad-research',
  description: 'What the market is already selling, what it charges, and which angles are worn out. Stage 2 of the flywheel.',
  whenToUse: 'After the avatar, before the offer. Pass {campaign, market, today, avatarSummary?, competitors?, ownerNotes?} as args.',
  phases: [
    { title: 'Reach', detail: 'probe every target domain first, so a thin run reports itself as thin' },
    { title: 'Plan', detail: 'name the advertisers and the surfaces worth hitting' },
    { title: 'Sweep', detail: 'one agent per surface, rounds until two come back dry' },
    { title: 'Teardown', detail: 'open the funnels and read the actual promise, price and guarantee' },
    { title: 'Verify', detail: 'provenance and burnout, adversarially' },
    { title: 'Board', detail: 'assemble, or return a stub if the evidence is too thin to write from' },
  ],
}

// ---------------------------------------------------------------------------
// Workflow scripts cannot import anything - no sibling files, no node builtins.
// So the shared pieces below are duplicated into each flywheel workflow on
// purpose. Keep them in sync by hand; that is the cost of the platform.
//
// Date.now(), Math.random() and new Date() all THROW in here. `today` is passed
// in as args and every date calculation uses it. This is the single easiest
// thing in this file to get wrong.
// ---------------------------------------------------------------------------

const A = (typeof args === 'object' && args) || {}
const CAMPAIGN = A.campaign || 'partner'
const TODAY = A.today
if (!TODAY) return { error: 'args.today is required (YYYY-MM-DD). The clock is unavailable inside a workflow.' }

const MARKET = A.market || 'people who want to start or run their own business-funding company: brokers, ISOs, and would-be funding-company owners'
const AVATAR = String(A.avatarSummary || '').slice(0, 6000)
const OWNER_NOTES = String(A.ownerNotes || '').slice(0, 2000)
const SEED_COMPETITORS = Array.isArray(A.competitors) ? A.competitors : []

// The Ad Library is deliberately NOT a surface here. Chris's own token is
// rejected for ads_archive (code 10 / subcode 2332002), and Meta's docs say ads
// that never reached the EU only come back if they are political. So this stage
// reads what the market SELLS - the funnels, prices and promises - rather than
// the ads that sell it. That is Tier C in the plan, and it is not a consolation
// prize: the landing page carries the promise, the price, the guarantee and the
// call to action, which is most of what the offer and copy stages actually need.
const SURFACES = [
  {
    key: 'competitor-funnels',
    what: `Direct competitors' own sites and funnels. Find the companies selling into this market and open their actual pages: sales pages, VSL pages, application and booking pages, pricing pages, order forms. For each, capture the exact headline, the promise, the price if shown, the guarantee if any, and the call to action. Names to start from if useful: Fund&Grow, Credit Repair Cloud, Jack McColl / Credit Stacking, business loan broker training programs, "broker in a box" and white-label funding programs.`,
  },
  {
    key: 'adjacent-productized',
    what: `Adjacent markets that already productized the same desire, because their language is proven and their pricing is public. Hard-money and real-estate lending "operate under your brand, our capital and back office" programs (Roc Capital, TVC, Unitas and similar), franchise-style business-in-a-box offers, and agency white-label programs. What do they promise, what do they charge, how do they structure the deal?`,
  },
  {
    key: 'organic-angles',
    what: `The angles the market is actually running organically, where reach is visible. YouTube titles and thumbnails aimed at this buyer, and how often the same angle repeats. A title format repeated across many videos and channels is a saturated angle. Note view counts and upload dates where visible, because an angle that stopped being made is a cooling angle.`,
  },
  {
    key: 'complaints-and-burnout',
    what: `Where the market says it has been burned, and which promises have stopped working. Reviews and complaints about competitor programs, refund and chargeback threads, "is X a scam" content, and forum threads where people say they have heard a pitch too many times. This is the evidence for calling an angle worn out.`,
  },
]

// Several hosts in this market serve 403 to any non-browser client - Trustpilot,
// DailyFunder threads, creditstacking.com. Jina Reader is a plain URL prefix that
// renders a page to markdown, needs no key, no login and no install, and was
// measured on 2026-09-01 returning HTTP 200 on all three. It is the fallback,
// not the first move: fetch the page normally first, because the real page is
// always better evidence than a rendering of it.
const READER_FALLBACK = `WHEN A PAGE REFUSES YOU: several hosts here answer 403 to anything that
is not a browser. Before recording one as unreachable, retry it through Jina Reader by putting
this in front of the address:

    https://r.jina.ai/<the full url including https://>

It renders the page to plain text, needs no key and no login. Measured working on trustpilot.com,
creditstacking.com and dailyfunder.com, all of which refuse an ordinary fetch.
Try in this order: normal fetch, then curl with a browser user-agent, then Jina Reader. Only
after all three fail is a host genuinely unreachable - and say which of the three you tried.
Evidence read through the reader is still tier C: you read the page, just not directly.`

const NO_PHANTOM = `HARD RULE ON EVIDENCE: something goes on the board only if you actually
SAW it and can give the URL. Never reconstruct a page, a price or a headline from memory, and
never write "a typical offer in this space says...". If you cannot open a page, say so - a
blocked or dead URL is a result, not a failure, and it belongs in unreachable.
A price goes on the board only if a page stated it. "Around $5,000" without a page saying it
is a GUESS and does not ship.
"Worn out" is an INFERENCE, never a measurement: say exactly what you saw that made you infer
it. Competitor spend and conversion rates are NOT observable - do not imply you measured them.
A phantom competitor sends real money at a strategy nobody is running.`

// ---------------------------------------------------------------------------

phase('Reach')
log(`ad research for ${CAMPAIGN} as of ${TODAY} - ad library skipped, reading what the market sells`)

const REACH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['probes'],
  properties: {
    probes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['target', 'reachable', 'evidence'],
        properties: {
          target: { type: 'string' },
          reachable: { type: 'boolean' },
          evidence: { type: 'string', description: 'status code or exact error' },
        },
      },
    },
  },
}

const reach = await agent(`Before any research runs, find out what is actually reachable from
this machine. For each target below do ONE cheap check - a fetch or a curl - and report the
status code or the exact error. Do not read or analyse the pages, just find out if they answer.

Targets:
- google.com  (a control: if this fails, the network is down and everything else is noise)
- youtube.com
- trustpilot.com
- reddit.com
- dailyfunder.com
- fundandgrow.com
- creditrepaircloud.com

A 403 served by an anti-bot system is DIFFERENT from a connection refused or a proxy denial.
Say which you got. Do not try to defeat any bot check.

For any host that answers 403, ALSO probe it through Jina Reader - curl -s -o /dev/null -w '%{http_code}'
"https://r.jina.ai/<url>" - and mark it reachable if that returns 200. A page that renders through
the reader is not a blocked source, and writing it off early is how a run ends up thin.`,
  { label: 'reach-probe', phase: 'Reach', schema: REACH_SCHEMA, effort: 'low' })

const probes = (reach && reach.probes) || []
const blocked = probes.filter(p => !p.reachable).map(p => p.target)
const reachable = probes.filter(p => p.reachable).map(p => p.target)
log(`reachable: ${reachable.length}/${probes.length}${blocked.length ? ` | blocked: ${blocked.join(', ')}` : ''}`)

const controlUp = probes.some(p => p.target.includes('google') && p.reachable)
if (probes.length && !controlUp) {
  return {
    campaign: CAMPAIGN, asOf: TODAY, confidence: 'unknown',
    reachability: probes,
    error: 'The control target failed, so the network is not usable from here. Nothing was researched. Run this again when the connection is working rather than trusting a thin board.',
  }
}

phase('Plan')

const plan = await agent(`Plan an investigation of what is already being sold into this market.

MARKET: ${MARKET}
${AVATAR ? `\nWHO THE BUYER IS (from the avatar stage):\n${AVATAR}\n` : ''}
${SEED_COMPETITORS.length ? `\nCompetitors already named by Chris: ${SEED_COMPETITORS.join(', ')}` : ''}
${OWNER_NOTES ? `\nCORRECTIONS CHRIS HAS ALREADY MADE - these override anything else:\n${OWNER_NOTES}` : ''}
${blocked.length ? `\nThese hosts did NOT answer and must not be planned against: ${blocked.join(', ')}` : ''}

Return:
- 5 to 10 named companies or programs selling into this market, each with the URL you would open first
- for each of the four surfaces below, the specific search phrasings worth trying, including
  insider jargon a naive researcher would not think of (ISO, MCA, merchant cash advance,
  broker in a box, white label funding, credit stacking, funding company startup)

The four surfaces: ${SURFACES.map(s => s.key).join(', ')}

${NO_PHANTOM}`,
  { label: 'plan', phase: 'Plan', effort: 'high',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['competitors', 'phrasings'],
      properties: {
        competitors: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['name', 'url'],
            properties: { name: { type: 'string' }, url: { type: 'string' }, why: { type: 'string' } },
          },
        },
        phrasings: { type: 'array', items: { type: 'string' } },
      },
    } })

const namedCompetitors = (plan && plan.competitors) || []
const phrasings = (plan && plan.phrasings) || []
log(`${namedCompetitors.length} competitors named, ${phrasings.length} search phrasings`)

phase('Sweep')

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['advertiser', 'headline', 'sourceUrl', 'evidenceTier'],
        properties: {
          advertiser: { type: 'string' },
          headline: { type: 'string', description: 'the exact words on the page, verbatim' },
          promise: { type: 'string' },
          price: { type: 'string', description: 'only if a page stated it; otherwise leave empty' },
          guarantee: { type: 'string' },
          cta: { type: 'string' },
          angleId: { type: 'string', description: 'short kebab-case id for the angle, e.g. own-your-renewals. Reused across the chain, so keep it stable and descriptive.' },
          sourceUrl: { type: 'string' },
          evidenceTier: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: 'A=the ad as served, B=someone else’s copy of it, C=the destination page itself, D=the market talking about it' },
        },
      },
    },
    burnedOut: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['angle', 'whyYouThinkSo'],
        properties: { angle: { type: 'string' }, whyYouThinkSo: { type: 'string' }, sourceUrl: { type: 'string' } },
      },
    },
    unreachable: { type: 'array', items: { type: 'string' } },
    nothingNew: { type: 'boolean' },
  },
}

const seen = new Set()
const findings = []
const burnedOut = []
const unreachable = new Set(blocked)
let dry = 0
let round = 0
const MAX_ROUNDS = 3

while (dry < 2 && round < MAX_ROUNDS) {
  round += 1
  const batch = await parallel(SURFACES.map((s, i) => () => agent(
    `Round ${round} of an investigation into what is already sold to this market.

MARKET: ${MARKET}
YOUR SURFACE: ${s.what}

Competitors already named: ${namedCompetitors.map(c => `${c.name} (${c.url})`).join('; ') || 'none yet - find them'}
Search phrasings worth trying: ${phrasings.join(' | ') || 'use your judgement'}
${unreachable.size ? `\nDo NOT plan against these, they did not answer: ${[...unreachable].join(', ')}` : ''}
${round > 1 ? '\nEarlier rounds already logged findings. Report only what is NEW - different companies, different angles, different pages. Set nothingNew=true if this surface is exhausted.' : ''}

Use WebSearch and WebFetch (load them with ToolSearch if they are not in your tools yet).
OPEN THE ACTUAL PAGES.

${READER_FALLBACK}
 A search snippet is weaker evidence than the page itself - if you only
had the snippet, say so by setting evidenceTier to D.

Give every distinct angle a short kebab-case angleId and reuse it if you see the same angle
again. Those ids travel down the whole chain, so make them descriptive.

${NO_PHANTOM}`,
    { label: `sweep-r${round}-${s.key}`, phase: 'Sweep', schema: FINDING_SCHEMA })))

  const fresh = batch.filter(Boolean)
  const novel = fresh.flatMap(b => b.findings || []).filter(f => {
    const k = `${f.advertiser}|${f.headline}`.toLowerCase()
    if (!f.headline || !f.sourceUrl || seen.has(k)) return false
    seen.add(k)
    return true
  })
  fresh.flatMap(b => b.burnedOut || []).forEach(b => { if (b.angle) burnedOut.push(b) })
  fresh.flatMap(b => b.unreachable || []).forEach(u => unreachable.add(u))

  findings.push(...novel)
  if (!novel.length || fresh.every(b => b.nothingNew)) dry += 1; else dry = 0
  log(`round ${round}: ${novel.length} new (${findings.length} total, dry=${dry})`)
}
if (round >= MAX_ROUNDS && dry < 2) log(`NOTE: stopped at the round cap, not because the well ran dry`)

phase('Teardown')

// The funnels worth opening properly: the ones where a price or a real promise showed up.
const worthOpening = findings
  .filter(f => f.price || f.guarantee || f.evidenceTier === 'C')
  .slice(0, 4)

const teardowns = worthOpening.length
  ? (await parallel(worthOpening.map((f, i) => () => agent(
      `Open this competitor's funnel properly and read what they actually sell.

START: ${f.sourceUrl}  (${f.advertiser})

Walk it as a buyer would: the sales page, then whatever it leads to - the VSL page, the
application, the booking page, the order form, the pricing page. Do not submit anything, do
not enter any personal details, do not book anything.

Report, verbatim where you can: the headline, the core promise, the named mechanism if they
have one, every price and payment term shown, the guarantee, what they ask for at the end,
and how many steps it takes to get there.

If a page needs a login or an application to go further, stop there and say so.

${READER_FALLBACK}

${NO_PHANTOM}`,
      { label: `teardown-${i + 1}`, phase: 'Teardown', schema: {
        type: 'object', additionalProperties: false,
        required: ['advertiser', 'steps'],
        properties: {
          advertiser: { type: 'string' },
          headline: { type: 'string' },
          promise: { type: 'string' },
          mechanism: { type: 'string' },
          prices: { type: 'array', items: { type: 'string' } },
          guarantee: { type: 'string' },
          finalAsk: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          stoppedBecause: { type: 'string' },
        },
      } })))).filter(Boolean)
  : []

log(`${teardowns.length} funnels opened`)

phase('Verify')

const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['survives', 'reason'],
  properties: { survives: { type: 'boolean' }, reason: { type: 'string' } },
}

const keyFindings = findings.filter(f => f.price || f.evidenceTier === 'C').slice(0, 10)

const verified = keyFindings.length
  ? await parallel(keyFindings.map((f, i) => () => parallel([
      () => agent(`PROVENANCE CHECK. Someone reports that ${f.advertiser} runs this, at ${f.sourceUrl}:

  headline: "${f.headline}"
  ${f.price ? `price: ${f.price}` : ''}

Open that URL yourself and check it says this. Try to REFUTE it. Set survives=false if the page
does not exist, does not say this, or says something materially different. Default to
survives=false when you are unsure.`,
        { label: `verify-prov-${i + 1}`, phase: 'Verify', schema: VERDICT }),
      () => agent(`STALENESS CHECK, different lens. This claim about ${f.advertiser} may be
literally true and still misleading: "${f.headline}" ${f.price ? `at ${f.price}` : ''} (${f.sourceUrl}).

Today is ${TODAY}. Is this current, or is it an old page nobody is driving traffic to any more?
Look for a last-updated date, copyright year, dead links, prices that contradict their other
pages, or a newer page that supersedes it. survives=false if this looks stale enough that
building an offer against it would be building against a ghost.`,
        { label: `verify-stale-${i + 1}`, phase: 'Verify', schema: VERDICT }),
    ]).then(vs => {
      const ok = vs.filter(Boolean)
      return { ...f, survives: ok.length > 0 && ok.every(v => v.survives), doubts: ok.filter(v => !v.survives).map(v => v.reason) }
    })))
  : []

const solid = verified.filter(f => f.survives)
const killed = verified.filter(f => !f.survives)
log(`${solid.length} verified, ${killed.length} killed`)

// ---------------------------------------------------------------------------
// Confidence is computed HERE, by the script, not by an agent. When it comes out
// unknown the synthesizer never runs - an `if` is what stops three thousand
// confident words being written on top of nothing.
// ---------------------------------------------------------------------------

const withPrice = findings.filter(f => f.price).length
const tierC = findings.filter(f => f.evidenceTier === 'C').length

let confidence = 'unknown'
if (solid.length >= 6 && teardowns.length >= 2) confidence = 'measured'
else if (findings.length >= 8 && tierC >= 3) confidence = 'indirect'
else if (findings.length >= 3) confidence = 'inferred'

const counts = {
  rowsFound: findings.length,
  rowsVerified: solid.length,
  rowsWithFirstSeen: withPrice, // for this stage, a stated price is the hard datum
  competitorsFound: new Set(findings.map(f => (f.advertiser || '').toLowerCase()).filter(Boolean)).size,
}

log(`confidence: ${confidence} | ${counts.rowsFound} found, ${counts.rowsVerified} verified, ${counts.competitorsFound} competitors`)

if (confidence === 'unknown') {
  return {
    campaign: CAMPAIGN, asOf: TODAY, confidence, counts,
    reachability: probes, unreachable: [...unreachable],
    findings, burnedOut, teardowns,
    document: null,
    stub: `Not enough was reachable to write a board from. ${counts.rowsFound} findings, ${counts.rowsVerified} verified, ${counts.competitorsFound} competitors. Blocked: ${[...unreachable].join(', ') || 'nothing reported blocked'}. Re-run from a machine with working access rather than building an offer on this.`,
  }
}

phase('Board')

const document = await agent(`Write the ad research board for ${CAMPAIGN}, as of ${TODAY}.

You are handed a reliability header that was COMPUTED, not judged. Print it as written near the
top and do not soften it:

  Confidence: ${confidence}
  Findings: ${counts.rowsFound} | verified: ${counts.rowsVerified} | competitors: ${counts.competitorsFound} | with a stated price: ${withPrice}
  Rounds run: ${round}${round >= MAX_ROUNDS && dry < 2 ? ' (stopped at the round cap, not because the well ran dry)' : ' (stopped because two rounds found nothing new)'}
  Could not reach: ${[...unreachable].join(', ') || 'nothing'}
  The Meta Ad Library was NOT used. Competitor ad spend and conversion rates are not observable.

VERIFIED findings, these anchor the board:
${JSON.stringify(solid).slice(0, 18000)}

Other findings, present as weaker:
${JSON.stringify(findings.filter(f => !solid.includes(f))).slice(0, 12000)}

Funnel teardowns:
${JSON.stringify(teardowns).slice(0, 14000)}

Angles that look worn out:
${JSON.stringify(burnedOut).slice(0, 6000)}

Findings that FAILED checking - mention in a "treat with caution" note, never as fact:
${JSON.stringify(killed.map(k => ({ advertiser: k.advertiser, headline: k.headline, doubts: k.doubts }))).slice(0, 5000)}

Structure it as:
1. The one-line answer: what is this market actually being sold, and at what price.
2. What competitors charge - a short table, every price with the page it came from.
3. The angles in play, each with its angleId, and how heavily it is used.
4. Angles that look worn out, each with the specific evidence, clearly marked as inference.
5. What nobody is saying - the gaps. This is the most useful section for the offer stage.
6. What failed checking.
7. What could not be reached.

Write for Chris, who does not read code. Short sentences, plain words, no jargon without a
five-word definition. Every claim carries its URL inline.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** Do you recognise these competitors? · Is this angle really worn out? · Is anyone actually charging this?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`,
  { label: 'board', phase: 'Board', effort: 'high' })

return {
  campaign: CAMPAIGN, asOf: TODAY, confidence, counts,
  reachability: probes, unreachable: [...unreachable],
  findings: solid, weakerFindings: findings.filter(f => !solid.includes(f)),
  burnedOut, teardowns, killed,
  angleIds: [...new Set(findings.map(f => f.angleId).filter(Boolean))],
  document,
}
