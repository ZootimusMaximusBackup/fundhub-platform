# gate-relay — actual

What the code does today. Traced from `scripts/gate-relay/`, not from the spec.

```mermaid
flowchart TD
    MAIN["index.mjs main()"] --> CMD{Command}
    CMD -->|write| WG[writeGateFile → gates/id.json]
    CMD -->|wait| WD[waitForDecision needs a gate file then polls decisions/id.json]
    CMD -->|ask| ASK[write then wait]
    CMD -->|watch| WATCH[loadUnanswered then startWatch on gates/]
    WATCH --> INGEST[ingestGateFile]
    INGEST --> PARSE{parseGate}
    PARSE -->|malformed / missing fields| SKIP[skipped: true. process stays up]
    PARSE -->|ok| HANDLED{alreadyHandled?}
    HANDLED -->|yes| SKIP
    HANDLED -->|no| FMT[formatDecisionMessage names the thread and uses context when question is a stub]
    FMT --> SEND["channel.send with buttons tied to that id"]
    SEND --> OUTBOX[outbox/id.json]
    SEND --> PEND[pending Map]
    REMIND[remindUnanswered every 15 min] --> SEND
    POLL["channel.onReply / getUpdates"] --> HU[handleUpdate]
    HU --> WHO{isAllowedSender}
    WHO -->|no| IGN[ignored. no send. no decision]
    WHO -->|yes| MATCH{matchPending: button, reply-to, or only one open}
    MATCH -->|none| IGN
    MATCH -->|two open and a bare yes| WHICH["send I have more than one question open"]
    MATCH -->|voice| DL[downloadVoice]
    DL --> WHISPER[transcribe Whisper]
    WHISPER -->|fail| HEAR["send Couldn't hear that. Reply in text?"]
    WHISPER -->|ok| PFY[promptify]
    MATCH -->|text or tap| PFY
    PFY --> LIGHT{one-word option?}
    LIGHT -->|yes| DEC[writeDecisionFile]
    LIGHT -->|no| CLAUDE[callModel Anthropic]
    CLAUDE --> DEC
```

## Entry

- Process: `node scripts/gate-relay/index.mjs` (npm script `gate-relay`)
- Loads `.env` only when started as the main file, via `scripts/load-env.mjs`
- Commands: `watch` (default), `write`, `wait`, `ask` (write then wait), `watchdog` (detached; texts if the watcher pid is dead)
- `wait` throws `wait needs a question file first` if `gates/<id>.json` is missing
- `formatDecisionMessage` sends `context` when `question` is a short stub (e.g. "Build?"). It prefixes `This is for <thread>.` from `session` or `id` when that name is not already in the text.
- A reply is matched to one open question by button tap (`id|ANSWER`), by reply-to the Telegram message, or because only one question is open. A bare yes with two open questions sends `COPY.whichOne` and writes no decision.
- `remindUnanswered` sends the same question again 15 minutes after the last send if there is still no decision.
- Heartbeat file `heartbeat.json` is written every 15s with the watcher's pid. A detached watchdog texts `COPY.wentDown` if that pid is dead. The watcher texts `COPY.cameBack` after a 90s gap (Mac sleep) or on start after a down text. A clean stop (SIGTERM) texts `COPY.wentDown`. While the Mac is still asleep, nothing on this Mac can send.

## Files on disk

All under `.fundhub-relay/` (gitignored):

| Path | Writer | Reader |
|---|---|---|
| `gates/<id>.json` | a skill, or `write` | `ingestGateFile` |
| `outbox/<id>.json` | `markSent` after a send or remind | `alreadyHandled` — blocks a second first-send. `messageIds` route a reply-to |
| `decisions/<id>.json` | `handleUpdate` after a good reply | `wait` / `readDecisionFile` |
| `telegram-offset` | watch loop | next `getUpdates` offset |
| `heartbeat.json` | watch loop | watchdog — pid dead means the messenger went down |

The relay does not write anything under `src/`, `public/`, `api/`, or `netlify/`.

## Channel

- `createChannel()` in `scripts/gate-relay/channel.mjs`
- Default kind: `telegram` (`GATE_RELAY_CHANNEL` can select `sms`)
- Telegram: `sendMessage`, `getUpdates` (long poll, `message` + `callback_query`), `getFile` for voice notes, `answerCallbackQuery`
- Buttons under a named question use `inline_keyboard` with `callback_data` `<id>|<option>`
- SMS / Twilio: `createSmsChannel()` — `send` and `onReply` throw "not wired"
- Sender check: `isAllowedSender` compares `message.from.id` to `TELEGRAM_USER_ID` as strings

## Clean-up

- `scripts/gate-relay/promptify.mjs`
- One-word match against `options` skips the model (`lightPass`)
- Otherwise `callModel` from `src/agents/model.mjs` (existing Anthropic helper)
- Voice: OpenAI Whisper at `https://api.openai.com/v1/audio/transcriptions`
- Whisper failure: Telegram text `Couldn't hear that. Reply in text?` (`COPY.transcribeFail`). No decision file.

## Proven live (2026-08-17)

- Gate `live-prove-1` → Telegram message at 11:01 → voice note → Whisper raw `Go` → decision `GO` written at 11:02. Evidence: `docs/workflows/build-evidence/gate-relay/live-prove-1-decision.json`.

## Still stubbed

- SMS: stub only, by design.
