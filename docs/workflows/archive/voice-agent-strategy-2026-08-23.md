# Fundhub — AI Call Agent Strategy
**Research + build plan for Josh (AI setter) and the AR collections agent.**
2026-08-23.

---

## The reframe

The instinct is to write a better prompt and hope the model performs. That is
not what the teams shipping high-volume outbound are doing in 2026.

The current practice splits the call in two:

- **90–95% is deterministic.** Recurring objections are answered word-for-word
  from a branching map written in the founder's voice. The agent reads them
  exactly. No paraphrasing layer.
- **5–10% is escalation.** Anything unmapped does not get improvised. It gets a
  fixed handoff line and a task for a human.

The reason is not caution, it is performance. An agent free to improvise
regresses to the model's defaults — and the model's defaults are polite,
agreeable, and easy to end a call with. That is the exact submissiveness you
are trying to remove. Determinism is what produces persistence.

> "Freedom is not the upgrade. Reliability at scale is."

---

## Why Josh sounds submissive

Three causes, all fixable in the prompt. None of them are tone.

**1. Yes/no questions hand over an exit.**
"Is now a good time?" has a free escape hatch. Every question in the script
should be either/or, where both answers continue the call.

- Kill: *"Is now a good time?"*
- Use: *"Is the bigger holdup right now the funding side or the credit side?"*

**2. Hedges signal the call is optional.**
Search the prompt for: *just, sorry to bother, whenever you get a chance, if
that's okay, I was wondering, real quick.* Delete every one. Each is a small
apology for existing.

**3. No exit condition.**
An agent without a goal it cannot leave without will accept the first soft no.
Josh needs a hard one: **a time on the calendar, or the prospect saying no in
their own words.** "They seemed busy" is not an outcome.

Add a fourth from the research, specific to voice:

**4. Apologizing for being interrupted.**
When a prospect talks over the agent, the wrong move is *"Oh, sorry, go
ahead."* Every source is explicit that apologies here read as robotic and
submissive and kill sales authority. The right move is acknowledge and pivot —
drop the previous sentence, address what they just said, keep moving.

---

## The build: objection map

Pull 50–100 recorded calls from a median closer — not your best one, the
median. Extract the 8–12 objections that actually recur. Write each response
yourself, in your voice, 1–3 sentences. Josh reads them verbatim.

The canonical eight, mapped to Fundhub:

| Branch | Fundhub version |
|---|---|
| Price | "$32 for the soft pull" / "$3,000 deposit" |
| Timing | "I need to think about it" / "call me next month" |
| Authority | "I need to talk to my partner" |
| Doubt about results | "does this actually work" |
| Bad past experience | **"I got burned by a credit repair company"** — your most loaded one |
| Wrong fit | genuinely not fundable yet — exit politely, tag for nurture |
| AI skepticism | "am I talking to a robot" — disclose, reframe, continue |
| Unmapped | fixed escalation line |

Each response is three parts:

1. **Acknowledge** the concern in one line
2. **Reframe** it once — price to outcome, timing to cost of waiting
3. **Return to the path** with a question

Every response ends in a question. That is what keeps the turn with you.

**The escalation line**, used verbatim for anything unmapped:

> "That's a good question and I want to make sure you get the right answer.
> Would it help if [closer] called you back today?"

Tag the lead, notify the closer. No guessing.

Two rules Josh never breaks: **never negotiate price**, and **never improvise
on anything regulated** — credit outcomes, legal, financial advice. Those
escalate, always. In your business that second one is not optional.

---

## Persistence without being a bully

Two attempts per objection, then convert to a specific callback time. Not
"someone will reach out" — a time.

The measured numbers are modest but real: acknowledging an interruption and
pivoting to a qualifying question extends the call past 30 seconds about **22%**
of the time. "Send me an email" converts to a booked meeting at **8–11%** when
you pivot to a qualifying question instead of taking the email.

A hard "not interested" is not a failure — tag it and requeue at six months.
That is persistence at the right timescale.

---

## The technical half — this matters more than the words

Perceived humanness is mostly latency and turn-taking, not vocabulary. The
production reference numbers:

| Setting | Target |
|---|---|
| Response start after prospect stops | 500–800ms (sub-500 with tuned middleware) |
| Turn-taking gap, sales calls (P95) | 250–350ms |
| Barge-in: end-of-speech to TTS stop | under 150ms |
| False barge-in rate | under 2% — above 5% feels broken |
| Speaking rate | 190–200 WPM |
| Talk ratio (agent vs prospect) | under 0.80 — above that reads as domineering |

**Filler words are a latency tool, not a personality tool.** Stream a filler to
speech immediately while the model is still generating, and perceived latency
drops to near zero. Five that work: *"Gotcha." "Hmm…" "Right," "Let me see,"
"Well,"* — "Let me see" specifically before any CRM lookup.

**Sentence rules for voice:**
- Two sentences maximum per turn
- Under 15 words per sentence
- No lists, ever — they do not survive speech
- Write numbers as spoken: *"fifteen hundred dollars"* not *"$1,500"*, *"a p i"*
  not *"API"*

That last one matters for you — Josh will be saying dollar figures and score
ranges constantly.

**Barge-in config, production reference for a US sales agent:** Silero VAD at
−40 dBFS, 0.75 confidence, 250ms minimum sustained voice before triggering.
That minimum-duration guard alone cuts false barge-ins 60–80%. Reported result:
97.8% barge-in success, 1.4% false rate.

---

## How you know it's working

This is what separates a demo from a system. Do not evaluate by listening to
calls — you will listen to five and generalize from noise.

Metrics worth tracking:

- **Time to first token** — dead air makes prospects repeat themselves
- **Stop time after interruption** — good agents resume within two seconds
- **Talk ratio** — the domineering signal, threshold 0.80
- **Instruction following, scored per branch** — not pass/fail on the whole call
- **Hallucination, per node** — binary, per call. Non-negotiable in your vertical
- **Response consistency** — did it contradict itself inside one call

**Build a persona test set** and run it before every prompt change. Not after.
The teams doing this well gate deploys on it — one failure blocks release.
Personas to cover: the interrupter, the fast talker, the skeptic, the person
in a noisy car, the one who says "send me an email," the one who asks if it's
a robot.

Then review a 10% sample weekly and add branches as new objections appear. The
map is never finished.

---

## What to do first

In order, highest leverage first:

1. **Strip the hedges and yes/no questions** from the current Josh prompt.
   Costs an hour, changes the character of every call.
2. **Add the interruption rule** — acknowledge and pivot, never apologize.
3. **Write the eight objection branches** in your own voice. This is the real
   work and only you can do it. Pull the calls first.
4. **Set the hard exit condition** — booked time or explicit no.
5. **Tune barge-in and latency** to the numbers above.
6. **Build the persona test set** before you touch the prompt again.

Steps 1, 2 and 4 are prompt edits you could ship today. Step 3 is the one that
actually decides whether Josh performs, and it is not delegable — the responses
have to be yours.

---

## Sources

- [Prompt Engineering for Voice AI: Interruptions, Filler Words, and Latency](https://www.autointerviewai.com/blog/prompt-engineering-voice-ai-interruptions-latency-2026)
- [Voice AI Barge-In and Turn-Taking: 2026 Implementation Guide](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/)
- [AI Voice Agent Objection Handling: Word-for-Word Branching](https://beavermind.ai/blog/ai-voice-agent-objection-handling)
- [How AI Calling Handles Sales Objections Automatically](https://www.autointerviewai.com/blog/how-ai-calling-handles-objections-automatically-data-driven-2026)
- [A Developer's Guide to Voice AI Evaluation Metrics](https://www.cekura.ai/blogs/voice-ai-evaluation-metrics)
