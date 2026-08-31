export const meta = {
  name: 'deep-research',
  description: 'Nothing-left-unturned research on any topic: plan, multi-angle sweep until dry, chase citations, critic, adversarial verify, synthesize',
  whenToUse: 'When Chris says research something deeply. Pass the question as args. Scale with a token budget like "+500k".',
  phases: [
    { title: 'Plan', detail: 'break the question into sub-questions and a source map' },
    { title: 'Sweep', detail: 'one agent per sub-question x source family, rounds until two come back dry' },
    { title: 'Chase', detail: 'follow what the best sources cite - one layer deeper than search can see' },
    { title: 'Critic', detail: 'a dedicated agent hunts what everyone missed; its finds become another round' },
    { title: 'Verify', detail: 'attackers try to kill each key claim before it ships' },
    { title: 'Synthesize', detail: 'the report, every claim sourced, plus what could not be reached' },
  ],
}

const QUESTION = typeof args === 'string' && args.trim() ? args.trim() : null
if (!QUESTION) return { error: 'No research question given. Pass it as args.' }

const HONESTY = `HARD RULES: never invent a quote, number, study or expert. Every claim carries
its real source (URL or publication+date). If a source is paywalled or unreachable, record THAT
- "could not reach" is a finding, not a failure. Prefer primary sources over articles about them.`

const FINDINGS = { type: 'object', additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['claim', 'source'],
      properties: {
        claim: { type: 'string' }, source: { type: 'string' },
        quote: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } },
        importance: { type: 'string', enum: ['key', 'supporting', 'minor'] } } } },
    unreachable: { type: 'array', items: { type: 'string' } },
    nothingNew: { type: 'boolean' } } }

phase('Plan')
const plan = await agent(`Research question: ${QUESTION}

Decompose this into the plan for an exhaustive investigation:
- 4-8 sub-questions that together cover the whole question, including the unflattering ones
  (what would prove the premise wrong, who loses, what the skeptics say)
- for each sub-question, which source families matter: forums/communities, review sites and
  complaints, industry reports and data, expert commentary, news/press, academic, competitor
  materials, regulatory/legal, video/podcast transcripts
- search phrasings a naive researcher would NOT try: insider jargon, slang, misspellings,
  adjacent topics, opposite framings
${HONESTY}`,
  { label: 'plan', phase: 'Plan', effort: 'high',
    schema: { type: 'object', additionalProperties: false, required: ['subQuestions'],
      properties: { subQuestions: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['question', 'sources', 'phrasings'],
        properties: { question: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          phrasings: { type: 'array', items: { type: 'string' } } } } } } } })

const subs = (plan && plan.subQuestions ? plan.subQuestions : []).slice(0, 8)
log(`${subs.length} sub-questions planned`)

phase('Sweep')
const seen = new Set()
const all = []
const unreachable = new Set()
let dry = 0, round = 0
const MAXR = 6
while (dry < 2 && round < MAXR && (!budget.total || budget.remaining() > 60000)) {
  round += 1
  const batch = await parallel(subs.map((s, i) => () =>
    agent(`Round ${round} of an exhaustive investigation.\n\nMain question: ${QUESTION}\nYour sub-question: ${s.question}\nSource families to hit: ${s.sources.join('; ')}\nPhrasings to try: ${s.phrasings.join(' | ')}\n\nUse WebSearch and WebFetch (load via ToolSearch if needed). Search MANY phrasings, open the actual pages, read them.\n${round > 1 ? 'Previous rounds already logged findings - report only what is NEW. Try angles and phrasings not yet used. Set nothingNew=true if this vein is exhausted.' : ''}\nFor important sources, list what THEY cite in the cites field.\n${HONESTY}`,
      { label: `sweep-r${round}-q${i + 1}`, phase: 'Sweep', schema: FINDINGS })))
  const fresh = batch.filter(Boolean)
  const novel = fresh.flatMap(b => b.findings || []).filter(f => f.claim && !seen.has(f.claim))
  fresh.flatMap(b => b.unreachable || []).forEach(u => unreachable.add(u))
  if (!novel.length || fresh.every(b => b.nothingNew)) { dry += 1 } else { dry = 0 }
  novel.forEach(f => { seen.add(f.claim); all.push(f) })
  log(`round ${round}: ${novel.length} new findings (${all.length} total, dry=${dry})`)
}
if (round >= MAXR) log(`NOTE: stopped at round cap ${MAXR}, not because the well ran dry`)

phase('Chase')
const citations = [...new Set(all.flatMap(f => f.cites || []))].slice(0, 12)
if (citations.length) {
  log(`chasing ${citations.length} cited sources one layer deeper`)
  const chased = await parallel(citations.map((c, i) => () =>
    agent(`A source found during research on "${QUESTION}" cites this: ${c}\n\nFind and READ the cited thing itself (WebSearch/WebFetch). Report what it actually says about the question - which is often different from how it was summarized. ${HONESTY}`,
      { label: `chase-${i + 1}`, phase: 'Chase', schema: FINDINGS })))
  chased.filter(Boolean).flatMap(b => b.findings || [])
    .filter(f => f.claim && !seen.has(f.claim))
    .forEach(f => { seen.add(f.claim); all.push(f) })
}

phase('Critic')
const critic = await agent(`An investigation of "${QUESTION}" produced these findings (claims only):\n${all.map(f => '- ' + f.claim).join('\n').slice(0, 30000)}\n\nYour only job: what did everyone MISS? Run your own searches now - sources nobody used, framings nobody tried, the question behind the question, contrary evidence, what an insider would check first. Report only findings NOT in the list. ${HONESTY}`,
  { label: 'critic', phase: 'Critic', schema: FINDINGS, effort: 'high' })
if (critic && critic.findings) {
  const extra = critic.findings.filter(f => f.claim && !seen.has(f.claim))
  extra.forEach(f => { seen.add(f.claim); all.push(f) })
  log(`critic added ${extra.length} findings the sweep missed`)
}

phase('Verify')
const keys = all.filter(f => f.importance === 'key').slice(0, 15)
log(`adversarially verifying ${keys.length} key claims`)
const VERDICT = { type: 'object', additionalProperties: false, required: ['survives', 'reason'],
  properties: { survives: { type: 'boolean' }, reason: { type: 'string' } } }
const verified = await pipeline(keys, (f, _o, i) =>
  parallel([
    () => agent(`Try to REFUTE this claim - check the source is real and says this, check the number is current, hunt for contradicting evidence: "${f.claim}" (source: ${f.source}). Default survives=false if uncertain.`,
      { label: `verify-${i + 1}a`, phase: 'Verify', schema: VERDICT }),
    () => agent(`Different lens - is this claim MISLEADING even if literally true (cherry-picked, outdated context, survivorship)? Claim: "${f.claim}" (source: ${f.source}).`,
      { label: `verify-${i + 1}b`, phase: 'Verify', schema: VERDICT }),
  ]).then(v => ({ ...f, survives: v.filter(Boolean).filter(x => x.survives).length >= 2,
                  doubts: v.filter(Boolean).filter(x => !x.survives).map(x => x.reason) })))
const solid = verified.filter(Boolean).filter(f => f.survives)
const killed = verified.filter(Boolean).filter(f => !f.survives)
log(`${solid.length} key claims survived, ${killed.length} killed`)

phase('Synthesize')
const report = await agent(`Write the research report for: ${QUESTION}\n\nVERIFIED key findings (these anchor the report):\n${JSON.stringify(solid).slice(0, 25000)}\n\nSupporting findings (unverified, present as such):\n${JSON.stringify(all.filter(f => f.importance !== 'key')).slice(0, 30000)}\n\nClaims that FAILED verification (mention in a "treat with caution" note, do not present as fact):\n${JSON.stringify(killed.map(k => ({ claim: k.claim, doubts: k.doubts }))).slice(0, 8000)}\n\nSources that could not be reached:\n${[...unreachable].join('; ').slice(0, 3000)}\n\nStructure: lead with the answer, then the evidence by theme, every claim with its source inline, a "what this means" section, a "what failed checking" note, and a final "what we could not reach" section so the reader knows the true edge of the research. Plain language. No filler.`,
  { label: 'report', phase: 'Synthesize', effort: 'high' })

return { question: QUESTION, rounds: round, findings: all.length,
  keyVerified: solid.length, keyKilled: killed.length,
  unreachable: [...unreachable], report }
