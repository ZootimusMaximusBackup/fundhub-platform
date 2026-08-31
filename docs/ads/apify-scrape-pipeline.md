# The scrape + transcribe pipeline (Apify)

**DECISION 2026-08-31: deferred — start with the free stack below.** Apify is a
convenience, not a requirement. Most of what it sells is reachable free and official;
the one real gap it closes (Instagram/TikTok comments at scale) is not yet proven to
matter for this vertical. Revisit only if the free stack hits that wall.

## The free stack that replaces it (for now)

| Need | Free/official way | Notes |
|---|---|---|
| YouTube comments at scale | YouTube Data API (free key, minutes to create) | The single biggest unlock — full comment threads, official |
| Ads running in the vertical + how long | Meta Ad Library (free, official) | Shows active ads WITH start dates — literally the Winner's Board's longevity column, no scraping, no ToS problem |
| Reddit threads | Reddit's public JSON endpoints | Already partly working via agents |
| Forums, Quora, Trustpilot, BBB | WebSearch + WebFetch agents | Proven: 159 sourced quotes in round 1 |
| Best data of all | FundHub's own GHL calls, SMS, survey answers | First-party, no scraping, already being mapped |
| Instagram / TikTok comments | **The real gap** — no practical official path | This is the only thing Apify uniquely buys |

Original spec below, kept for the day the gap matters.

## The two jobs it does

### Job 1 — Persona mining, round 3 (deeper than web search can go)

Web search only sees what search engines index. Apify actors reach what they don't:
comment sections at scale, full profiles, whole hashtags. For the Brandon avatar and
the client avatar both:

| Source | Apify actor | What we pull |
|---|---|---|
| Instagram | Instagram Scraper / Comments Scraper | Every funding-guru reel + ALL its comments — the market talking back |
| TikTok | TikTok Scraper | credit stacking / business funding videos + comments |
| YouTube | YouTube Comments Scraper | full comment threads on the videos round 2 could only skim |
| Facebook | Ads Library scrapers | every funding ad running, with creative + start date |
| Google/Trustpilot | review scrapers | complete competitor review corpora, not the page-one sample |

Output feeds the Market Language Bank, tagged with Chris's own categories from the
CUSTOMER LANGUAGE MINING SYSTEM: Objections / Goals / Pain Points / Triggers /
Emotional Words / Tone.

### Job 2 — The Winner's Board factory (this is the bigger one)

The $47/mo Winner's Board promises: the ads running in the funding vertical, how long
each has survived, the angle, the hook written out, where it sends people. That is
EXACTLY what this pipeline manufactures:

  Every ad/reel in the vertical
    -> scrape on a schedule (Apify)
    -> transcribe (Whisper) + extract: Hook / First 3 lines / Concept / Structure
    -> save with first-seen and last-seen dates
    -> longevity = last_seen - first_seen  <- the board's ranking column

Run weekly and the product updates itself. The reel Chris saw describes the assembly
line for a product FundHub already priced.

## Pipeline shape

1. **Collect** — scheduled Apify actor runs per source, results to dataset export (JSON)
2. **Transcribe** — video/audio through Whisper; text posts pass straight through
3. **Extract** — per item: hook, first 3 lines, concept, structure, angle, CTA,
   destination URL, plus the language-mining tags
4. **Store** — rows with source, url, author, first_seen, last_seen, extraction
5. **Serve** — refreshes the Language Bank; populates the Winner's Board

## What this needs (and doesn't)

- **An Apify account + API token.** The one thing only Chris can create. Pay-as-you-go;
  actor runs for this volume are typically tens of dollars a month, not hundreds. Token
  goes in as APIFY_TOKEN (secret) once it exists.
- **No new npm dependency** — Apify is a plain REST API; plain fetch.
- **Where it runs:** research agents can call it from any environment whose network
  allows api.apify.com; otherwise a scheduled job. NOT wired into the app's messaging
  paths — this is inbound data collection only.
- Storage starts as JSON/markdown in the research docs; graduates to tables only when
  the Winner's Board goes live as a product.

## Flags (one line each)

- Scraping social platforms sits against those platforms' terms; Apify carries the
  operational risk model, but the account is ours. Owner-accepted 2026-08-31.
- Scraped comments are people's words: research calibration only, never republished as
  testimonials, no PII kept beyond public handle + url.
- Anything lifted into ads still passes the compliance guardrails: no income claims,
  no credit-outcome claims, no lender named.
