export const meta = {
  name: 'avatar-builder',
  description: "Chris's 7-step Avatar Builder SOP, run end to end by agents with deep market research",
  whenToUse: 'When a Core Avatar Profile is needed for an offer. Pass the service description as args.',
  phases: [
    { title: 'Foundation', detail: 'Prompt 1 - the business facts, grounded in repo and Drive' },
    { title: 'Overview', detail: 'Prompt 3 - translate the business into client-centric desires' },
    { title: 'Research', detail: 'Prompts 4-6 - desire research, mechanism, new information. Deep fan-out.' },
    { title: 'Avatar', detail: 'Prompt 7 - synthesize the Core Avatar Profile' },
    { title: 'Verify', detail: 'Adversarial pass - kill fabricated quotes and generic filler' },
  ],
}

// ---------------------------------------------------------------------------
// Source of truth: Chris's AVATAR BUILDER SOP in Google Drive
// (MARKETING / AVATAR / AVATAR BUILDER SOP - files 00 to 07).
// The prompts below are his, condensed only where they were chat-mechanics
// ("paste the file here") that agents do not need. The frameworks, templates
// and section names are verbatim. Do not "improve" them.
// ---------------------------------------------------------------------------

const SERVICE = typeof args === 'string' && args.trim()
  ? args.trim()
  : 'The FundHub $10,000 white-label partnership: brokers run a funding company under their own brand, FundHub does all fulfillment, partner keeps 50% of funding and repair.'

const STRATEGIST = `You are "The Strategist" - a world-class marketing strategist and avatar
specialist, a leading expert in applying Eugene Schwartz's "Breakthrough Advertising" to
modern service-based businesses. Core principles: Desire-First (start with core desires,
never demographics), Service-Centric, Cascading Logic (each stage builds on the previous
documents), Actionable Output. This is Chris Stanbridge's Service Avatar Project SOP for
FundHub, a business-funding company.`

const NO_FABRICATION = `HARD RULE ON QUOTES AND SOURCES: never invent a quote, statistic,
study, or expert opinion. A "Client Voice" quote may only be included with the real place
you found it (URL or platform + thread). If you cannot find real ones, say so and give
fewer. A paraphrase must be labelled [PARAPHRASE]. A made-up quote poisons every
downstream step of this project.`

phase('Foundation')
log(`Building avatar for: ${SERVICE.slice(0, 90)}...`)

const foundation = await agent(`${STRATEGIST}

PROMPT 1 OF 7 - SERVICE BUSINESS FOUNDATION.

Service to profile: ${SERVICE}

You have tool access. Ground every answer in the real business, not guesses:
- Read the repo at /home/user/fundhub-platform - especially public/partner/ (the offer
  pages), docs/ads/ascension-ads.md, docs/compliance/, and CLAUDE.md's locked terms.
- Load Google Drive tools via ToolSearch ("select:mcp__Google_Drive__search_files,mcp__Google_Drive__read_file_content")
  and read FundHub-Copy-Source-of-Truth.md and fundhub-partner-platform-addendum.md if reachable.

Produce Service_Business_Foundation.md with every section of Chris's template, none omitted:
Part 1 Core Service Offering: 1. Primary Service (one sentence) 2. Service Category
3. The Core Problem.
Part 2 Client Profile & Transformation: 4. Ideal Client (specific) 5. The "Before" State
6. The "After" State.
Part 3 Service Delivery & Process: 7. Service Methodology 8. Key Deliverables 9. Pricing Model.
Part 4 Market Landscape & Differentiation: 10. Main Competitors (2-3, direct or indirect)
11. Your Differentiator 12. Client Objections.
Part 5 Client Voice & Evidence: 13. Best Testimonial (only if a real one exists in the
repo or Drive - otherwise write NONE ON FILE) 14. Common Questions (top 3-5)
15. Client Language (words they actually use).

${NO_FABRICATION}
Return only the markdown document.`,
  { label: 'p1:foundation', phase: 'Foundation', effort: 'high' })

phase('Overview')
const overview = await agent(`${STRATEGIST}

PROMPT 3 OF 7 - SERVICE OVERVIEW BUILDER. Translate the foundation into a client-centric
overview. Key transformations Chris's SOP demands: Methodology becomes Process (the
client's journey), Deliverables become Tangible Outcomes, Differentiator becomes the
Unique Mechanism.

--- Service_Business_Foundation.md ---
${foundation}
--- end ---

Produce Service_Overview.md with all seven sections, none omitted:
1. The Core Promise (one clear statement of the result being bought)
2. The Client Journey (The Process) - step by step from the client's side
3. The Transformation (The Outcomes)
4. The Assumed Benefits (what outcomes let them DO or HAVE)
5. The Assumed Desires (what benefits let them FEEL or BECOME - "I want / I need" statements)
6. The Unique Mechanism (the differentiator, NAMED - a memorable proprietary name)
7. The Hidden Mechanisms (the reasons why the mechanism works)

Return only the markdown document.`,
  { label: 'p3:overview', phase: 'Overview', effort: 'high' })

phase('Research')

// -- Prompt 4: desire-based market research. The SOP names the watering holes;
//    one agent per source family, then loop until two rounds find nothing new.
const DESIRE_SOURCES = [
  'Reddit and forums: r/smallbusiness, r/Entrepreneur, r/loanoriginators, r/CommercialLending, broker and MCA forums',
  'Review sites: Google Reviews, Trustpilot, BBB complaints about funding companies, brokers and white-label programs',
  'Social: LinkedIn posts and comments, YouTube comments on business-funding and broker-opportunity videos',
  'Q&A and groups: Quora on becoming a loan broker / starting a funding company, Facebook broker groups',
  'Competitor case studies and testimonials: white-label and broker-in-a-box programs - the language their success stories use',
]

const RESEARCH_NOTE = { type: 'object', additionalProperties: false,
  required: ['findings', 'quotes'],
  properties: {
    findings: { type: 'string' },
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['quote', 'source'],
      properties: { quote: { type: 'string' }, source: { type: 'string' },
        paraphrase: { type: 'boolean' } } } },
    nothingNew: { type: 'boolean' },
  } }

const seenQuotes = new Set()
const desireNotes = []
let dry = 0, round = 0
while (dry < 2 && round < 4) {
  round += 1
  const batch = await parallel(DESIRE_SOURCES.map((src, i) => () =>
    agent(`${STRATEGIST}

PROMPT 4 OF 7 - DESIRE-BASED MARKET RESEARCH, round ${round}, source family: ${src}

North star - the Core Problem from the foundation document:
${String(foundation).slice(0, 2500)}

Use WebSearch (load via ToolSearch if needed) and search MANY different phrasings. You are
listening for the raw, unfiltered voice of the would-be funding-business owner or broker:
their Functional Wants, Emotional Needs, Pains & Frustrations, the Existing Solutions they
use and their complaints about each, and direct Client Voice quotes.
${round > 1 ? 'Earlier rounds already captured a set of quotes - hunt for NEW angles and NEW threads, not repeats. Set nothingNew=true if this source family is exhausted.' : ''}
${NO_FABRICATION}`,
      { label: `p4:desire-r${round}-s${i + 1}`, phase: 'Research', schema: RESEARCH_NOTE })))
  const fresh = batch.filter(Boolean)
  const newQuotes = fresh.flatMap(b => b.quotes || []).filter(q => q.quote && !seenQuotes.has(q.quote))
  if (!newQuotes.length || fresh.every(b => b.nothingNew)) { dry += 1 } else { dry = 0 }
  newQuotes.forEach(q => seenQuotes.add(q.quote))
  desireNotes.push(...fresh)
  log(`desire research round ${round}: ${newQuotes.length} new quotes (${seenQuotes.size} total)`)
}

const desireDoc = await agent(`${STRATEGIST}

Assemble Desire_Market_Research.md from the raw research below, using Chris's exact template:
1. Wants & Needs Analysis (Functional Wants / Emotional Needs)
2. Pains & Frustrations (the big recurring ones)
3. Existing Solutions & Complaints (each current solution + its common complaint)
4. Client Voice Evidence (Direct Quotes) - at least 5-10, each with its real source; this
   is the most important section
5. New Desire Opportunities (untapped or underserved desires - the gaps)

Raw research notes:
${JSON.stringify(desireNotes).slice(0, 60000)}

${NO_FABRICATION} Only quotes present in the notes above may appear.
Return only the markdown document.`,
  { label: 'p4:assemble', phase: 'Research', effort: 'high' })

// -- Prompt 5: new mechanism discovery (works from the overview alone)
const mechanismDoc = await agent(`${STRATEGIST}

PROMPT 5 OF 7 - NEW MECHANISM DISCOVERY. Weaponize the uniqueness. A mechanism for a
service is a framework, proprietary process, diagnostic tool, methodology or contrarian
approach - the answer to "why should I believe you when others failed?"

--- Service_Overview.md ---
${overview}
--- end ---

Produce New_Mechanisms.md with Chris's exact template:
1. The Core Mechanism (Named & Defined) - Mechanism Name + One-Sentence Definition
2. Mechanism Breakdown (The "How It Works") - 3 named Unique Elements
3. Contrarian Viewpoint (The "Why It's Different") - the industry wisdom this rejects
4. Marketing Hook Samples - 3 hooks that leverage the mechanism

Regulated consumer finance: no income claims, no credit-outcome claims, never name a lender.
Return only the markdown document.`,
  { label: 'p5:mechanism', phase: 'Research', effort: 'high' })

// -- Prompt 6: new information research - fan out by source family
const INFO_SOURCES = [
  'Industry reports: SBA lending data, Fed small-business credit surveys, broker-industry reports, alternative-lending market studies',
  'Expert commentary and contrarian takes: fintech and lending thought leaders, recent interviews and LinkedIn essays',
  'Emerging trends and fresh data: HBR, Forbes, deBanked, industry press on broker economics, white-label models, funding demand',
]
const infoNotes = (await parallel(INFO_SOURCES.map((src, i) => () =>
  agent(`${STRATEGIST}

PROMPT 6 OF 7 - NEW INFORMATION RESEARCH. Source family: ${src}
Service: ${SERVICE}

Use WebSearch. Find genuinely NEW information competitors are not using - a trend or
statistic that reframes the problem, a contrarian expert opinion, a recent case study or
data point. For each: Source (publication, author, date), The New Information, Why it's
NEW (the sophistication gap), How to Use Ethically, 3 Marketing Hook Samples.
${NO_FABRICATION}`,
    { label: `p6:info-s${i + 1}`, phase: 'Research', schema: RESEARCH_NOTE })))).filter(Boolean)

const infoDoc = await agent(`${STRATEGIST}

Assemble New_Information.md from the notes below using Chris's template - sections:
1. Emerging Trend/Statistic  2. Contrarian Expert Opinion  3. New Case Study or Data Point
- each with Source / The New Information / Why it's NEW / How to Use Ethically / 3 Marketing
Hook Samples. ${NO_FABRICATION}

Notes:
${JSON.stringify(infoNotes).slice(0, 50000)}

Return only the markdown document.`,
  { label: 'p6:assemble', phase: 'Research', effort: 'high' })

phase('Avatar')
const avatar = await agent(`${STRATEGIST}

PROMPT 7 OF 7 - CORE AVATAR BUILDER. Synthesize everything into the final deliverable.
Not a summary: a multi-dimensional profile of a single, specific avatar, brought to life.

--- Service_Business_Foundation.md ---
${foundation}
--- Service_Overview.md ---
${overview}
--- Desire_Market_Research.md ---
${desireDoc}
--- New_Mechanisms.md ---
${mechanismDoc}
--- New_Information.md ---
${infoDoc}
--- end of inputs ---

Produce Core_Avatar_Profile.md using Chris's exact template:
- Avatar Name (memorable, e.g. "Growth-Stalled Gary" is the existing CLIENT avatar - this
  one must be distinct) and Profile Summary
- The Core 5 Avatar Framework:
  1. DESIRES - Core Desire + Surface-Level Desires in their own words
  2. EXPERIENCES - Situational + Service-Based (with other providers)
  3. EMOTIONS - Primary + Secondary
  4. BEHAVIORS & HABITS
  5. DEMOGRAPHICS - last, never the driver
- Marketing & Messaging Blueprint: Core Message to Resonate, Winning Hooks (using the New
  Information and the New Mechanism), Pain Points to Agitate, Key Belief to Shift (From -> To)

Return only the markdown document.`,
  { label: 'p7:avatar', phase: 'Avatar', effort: 'high' })

phase('Verify')
const VERDICT = { type: 'object', additionalProperties: false,
  required: ['problems', 'fabricatedQuotes', 'passed'],
  properties: {
    problems: { type: 'array', items: { type: 'string' } },
    fabricatedQuotes: { type: 'array', items: { type: 'string' } },
    passed: { type: 'boolean' } } }

const checks = await parallel([
  () => agent(`Adversarially review this avatar profile. Lens: FABRICATION. Every quote,
statistic, study and expert opinion must trace to the research documents and carry a real
source. List anything that looks invented. Default to suspicious.
${avatar}
--- research the quotes must come from ---
${String(desireDoc).slice(0, 20000)}
${String(infoDoc).slice(0, 15000)}`,
    { label: 'verify:fabrication', phase: 'Verify', schema: VERDICT }),
  () => agent(`Adversarially review this avatar profile. Lens: SPECIFICITY. Chris's SOP
demands a single, specific, alive avatar - not a demographic mush. Flag every line that
could describe any business owner anywhere, every hedge, every "may/might/some". Also flag
any violation of: desires-first (demographics must not drive), and the Core 5 structure.
${avatar}`,
    { label: 'verify:specificity', phase: 'Verify', schema: VERDICT }),
  () => agent(`Adversarially review this avatar profile. Lens: COMPLIANCE. This is regulated
consumer finance. Flag any income claim, credit-outcome claim, guaranteed-funding language,
or anything naming/hinting at lenders. Also flag if the Messaging Blueprint's hooks make
promises the offer terms don't back (the real terms: $10,000 once, no monthly fee, 50/50
split on funding and repair, review call decides, financing to 405 FICO is payment not
qualification, 10 funding clients/month floor, marketing is a paid add-on).
${avatar}`,
    { label: 'verify:compliance', phase: 'Verify', schema: VERDICT }),
])

const issues = checks.filter(Boolean).flatMap(c => [...(c.problems || []), ...(c.fabricatedQuotes || []).map(q => 'FABRICATED?: ' + q)])
let finalAvatar = avatar
if (issues.length) {
  log(`${issues.length} issues from verification - one repair pass`)
  finalAvatar = await agent(`${STRATEGIST}

Repair this Core Avatar Profile. Fix every listed issue: delete anything fabricated
(do not replace it with new inventions), sharpen anything generic, remove anything
non-compliant. Keep Chris's template structure intact.

Issues:
${issues.map(i => '- ' + i).join('\n')}

Profile:
${avatar}

Return only the corrected markdown document.`,
    { label: 'repair', phase: 'Verify', effort: 'high' })
}

return {
  service: SERVICE,
  documents: {
    Service_Business_Foundation: foundation,
    Service_Overview: overview,
    Desire_Market_Research: desireDoc,
    New_Mechanisms: mechanismDoc,
    New_Information: infoDoc,
    Core_Avatar_Profile: finalAvatar,
  },
  verificationIssuesFixed: issues.length,
  quotesCollected: seenQuotes.size,
}
