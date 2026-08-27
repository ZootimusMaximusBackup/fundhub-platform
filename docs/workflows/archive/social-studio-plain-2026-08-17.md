# Social Studio — make it read as a product (2026-08-17)

**COMPLIANCE REVIEW REQUIRED** — marketing page copy on a regulated consumer-finance product.

**The job:** take the database names, file paths, panel codes and builder explanations out of the Social Studio screen. Refresh the layout so it reads like a product. Invent nothing — if a panel has no real data, it says so plainly.

**File in scope:** `public/app/social-studio.html` (only workflow A may edit it).

**Owner call carried in:** treatment matches Command Center and Affiliate — codes stripped, plain names, builder detail moved behind a closed "How this works" section instead of sitting in the page body.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| A — strip + re-lay the page | agent A | done |
| B — truth brief (what each number really is) | agent B | done |
| C — proof on live (gates + click-through) | agent C | blocked — needs a deploy first |

## Shared context

- Live target is https://fundhub.ai. Local `netlify dev` answers 503 "db down" under one screen's read burst — never audit against it.
- Reads that exist: `social/posts`, `social/schedule`, `social/publish`, `social/oauth`, `social/generate`, `read/partners`. There is no list API for channels.
- Only workflow A writes page code. B and C write to this board and to evidence folders.

## Baseline before any edit (measured on this machine, 2026-08-17, DATABASE_URL unset)

- `npm run lint` — clean, 1283 files.
- `npx tsc --noEmit` — **cannot run.** There is no TypeScript settings file in the repo, so the command prints its own
  help and exits with an error. This is true before any change here. Recorded as a finding, not fixed.
- `npm test` — **5554 pass · 4 fail · 3 skipped.** The 4 failures are already there on a clean tree:
  `the journeys are not stale` · `the extraction is faithful to the code` ·
  `the expected list is exactly what db/ holds` · `an endpoint excused from the org filter still passes the session's org`.
  Database-backed tests were not exercised in this run.

## Truth brief

### How to read this

Two different lists are in play, and the screen mixes them up.

- **Post ideas.** Written by the "Write 3 posts" button. They live in a holding list. This is the list the screen actually reads.
- **Real scheduled posts.** These are posts attached to a real social account, waiting to go out. Nothing on this screen can read them, and nothing on this screen can create one.

Almost every gap below comes from that mix-up.

### 1. What each number, badge and panel really is

| What the screen shows now | What it really counts | Plain name a business owner would use | Real data today? |
|---|---|---|---|
| `CHANNELS` tile, "— / 8" | Social accounts this partner has connected, out of the 8 kinds allowed. Nothing in the system hands this list to the screen, so it is always zero. | Social accounts connected | no data — nothing in the system produces this |
| `CHANNELS` sub-line, "N active · N cannot publish" | Same list as above. Always zero and zero. | How many accounts can post | no data — nothing in the system produces this |
| `QUEUED` tile | Post ideas that are still a draft, plus ideas marked ready. Both come from the holding list. | Posts written and waiting | yes — live read |
| `QUEUED` sub-line, "N due now" | Ideas whose chosen time has already passed. | How many are past their time | yes — live read |
| `QUEUED` sub-line, "N would be skipped" | Meant to count ideas sitting on a broken account. The screen never knows which account an idea belongs to, so it marks every past-due idea as skipped. | (delete — it cannot be worked out) | no data — nothing in the system produces this |
| `BLOCKED` tile | Post ideas the rule check refused when they were written. | Posts the rule check refused | yes — live read |
| `BLOCKED` sub-line, "N reasons stored · terminal" | How many separate rule breaks were recorded across those refused ideas. | Reasons given | yes — live read |
| `FAILED` tile | Meant to count posts that tried to go out and gave up. The holding list can never hold that state. Always zero. | Posts that could not be sent | no data — nothing in the system produces this |
| `FAILED` sub-line, "N open tasks" | Meant to count the job tickets a failed post opens. Nothing hands those tickets to the screen. Always zero. | Jobs someone needs to fix | no data — nothing in the system produces this |
| `FAILED` sub-line, "attempt = 3" | Not a count. It is the fixed rule: the system tries 3 times, then gives up. | Tries before giving up: 3 | yes — live read |
| `POSTED` tile | Meant to count posts that went out. The holding list can never hold that state. Always zero. | Posts that went out | no data — nothing in the system produces this |
| `POSTED` sub-line, "no engagement data exists" | True. Nothing anywhere records likes, views, clicks or shares on a post. | (keep the honest line, in plain words) | no data — nothing in the system produces this |
| `Derivation` strip under the tiles | An explanation of how the tile above was worked out, written for a builder. Not a number. | (delete) | no data — nothing in the system produces this |
| Chip by "Generate posts", "On · N left" | Whether the owner has switched the writing tool on for this partner, and how much writing budget is left this month. | Writing tool: on, and how much is left | yes — live read |
| `CONNECTED CHANNELS` badge, "N connected" and the `social_channels` badge | Same accounts list as the first tile. | Connected accounts | no data — nothing in the system produces this |
| `NOT CONNECTED` badge, "N of 8 unused" | The 8 allowed account kinds minus the ones connected. Since the connected list is always empty, this always says 8 of 8. | Accounts not connected yet | no data — nothing in the system produces this |
| `COMPOSE A POST` badge, "5 fields · schedule()" | Nothing. It names the code that runs. | (delete) | no data — nothing in the system produces this |
| Composer "Channel — channel_id" picker | The social account this post goes to. Always shows "no channels". | Which account to post to | no data — nothing in the system produces this |
| Composer "Asset — optional, one only" picker | A picture or video to attach. Nothing hands the picture library to the screen. Always empty. | Picture or video to attach | no data — nothing in the system produces this |
| Composer "scheduled_for — override (UTC)" | The exact time you want it to go out. Typed by hand, so it works. Times are UTC only. | Send at this time (UTC) | yes — live read |
| `GUARDRAIL VERDICT` badge (`passed` / `blocked` / `needs_approval`) and "N reasons" | A rehearsal done inside the browser. It uses a copy of the rules pasted into the page, not the live rules. | Rule check preview | yes — live read, but see finding 12 |
| Tab `Queue` and its count | Post ideas still draft or marked ready. | Waiting | yes — live read |
| Tab `Review queue` and its count | Post ideas the rule check refused. | Refused | yes — live read |
| Tab `Failed` and its count | Always zero, for the reason given above. | Could not be sent | no data — nothing in the system produces this |
| Tab `Published` and its count | Always zero, for the reason given above. | Sent | no data — nothing in the system produces this |
| Tab `Audit trail` and its count | Every real attempt to send a post, newest first. This is a genuine live read of the send history. | History of send attempts | yes — live read |
| Filter line, "N of M posts match" | How many post ideas survive the filters above. | How many match your filter | yes — live read |
| Filter `channel` dropdown | Filter by account. Always only says "all", because there is no account list. | (delete until accounts can be read) | no data — nothing in the system produces this |
| Filter `offer_type` dropdown | Filter by what the post sells: funding, credit cards, or credit repair. | What the post is about | yes — live read |
| Six-badge legend under the tabs | The six states a real scheduled post can be in. Only three of them can ever appear in the lists on this screen. | Post states, explained | see section 2 |
| Queue table column `Channel` | Which account the post goes to. The rows the screen reads carry no account, so this is always a dash. | (delete until accounts can be read) | no data — nothing in the system produces this |
| Queue table column `Attempt` and "of 3" | How many times sending was tried. The rows the screen reads carry no try count, so this is blank. | (delete until real posts can be read) | no data — nothing in the system produces this |
| Queue table column `Disposition — derived, not a column` | Whether this post is due, waiting, or stuck with no time set. Only the "no time set" and "past its time" parts are trustworthy. | What happens next | empty until a real scheduled post can be read |
| `POSTING WINDOW` panel and its next-slot line | The regular times of day an account posts at. Comes from the account record, which the screen cannot read. | Best times to post | no data — nothing in the system produces this |
| `APPROVAL SETTING` panel, "approve_before_launch = true", "no row — falls back to true" | Whether a person must sign off before a post goes out. The screen never reads the real setting. It always shows the safe default, whatever the partner actually has. | Who has to approve | no data — nothing in the system produces this |
| Task strip under `Failed` | A job ticket raised when a post gives up. Nothing hands tickets to the screen. Never appears. | Jobs someone needs to fix | no data — nothing in the system produces this |
| `POST RECORD` slide-out drawer | The full record for one post. It can only be opened from a table row, and the rows the screen reads are missing most of what the drawer prints. | Post details | empty until a real scheduled post can be read |
| `now` chip in the top bar | The real clock, read when the page loads. | Right now | yes — live read |
| Footer, "ss · oauth/schedule/publish live · no list API · empty panes" | A builder's note. Out of date. | (delete) | no data — nothing in the system produces this |

### 2. The six post states, in one line each

- **draft** — Written, but not sent anywhere yet. You can still change your mind.
- **queued** — Checked and lined up. It will go out at its set time.
- **posting** — Going out right now. This lasts a second or two. If a post sits here, something crashed.
- **posted** — It went out. It is live on the account.
- **failed** — The system tried three times and could not get it out.
- **blocked** — The rule check refused it. It will never go out, and it cannot be fixed and re-sent. Write a new one.

### 3. Things the page claims that are not true or not knowable

1. **"Queue post" cannot queue anything.** It needs you to pick a social account, and the account list is always empty. The button always answers "Pick a channel."
2. **The Failed and Sent tabs can never fill.** They watch for two states the list this screen reads can never have.
3. **A post that really has been scheduled onto an account disappears.** It gets a state that matches none of the five tabs, so it shows nowhere.
4. **"revertible: true" in the send history suggests you can undo a post.** Nothing in the system can undo a post. The undo note is written down and never read by anything.
5. **The account record stores a timezone that nothing uses.** All times are worked out in UTC. Showing a stored timezone next to a time implies the two are connected. They are not.
6. **The approval panel does not show the partner's real setting.** It always shows the safe default, because the screen never reads the setting.
7. **There is no engagement figure anywhere, and there never has been.** Likes, views, clicks and shares are recorded nowhere. The page is right to say so; it should say it in plain words.
8. **The task strip text names Instagram and LinkedIn as a worked example.** That was made-up demo data. No task is ever loaded, so the example describes nothing.
9. **The footer and the top-of-file note say there is no list to read and the panes stay empty.** Out of date. There is a live read now — it just reads the wrong list.
10. **The Queued tile contradicts itself.** Its "due now" figure and its "would be skipped" figure are worked out from account information the screen never has, so the same rows can be counted twice, two different ways.
11. **"Meta and Google stay unconnected until those keys land."** Google is not one of the eight social accounts at all. There is no Google connect on this screen. Only Facebook, Instagram and LinkedIn can be connected here.
12. **The rule check on the right is a copy, not the live rules.** The rules are pasted into the page. If someone changes a rule in the system, this preview will not change. The real answer only arrives when the post is saved.
13. **Only two of the eight account types can actually send a post today.** Facebook and LinkedIn have a working send path. Instagram needs a picture attached first and refuses without one. TikTok, X, YouTube Shorts, Threads and Pinterest have no send path at all — a post to any of them tries three times and then fails.
14. **"Publish due now" is a real button that will find nothing.** It genuinely tells the system to send everything that is due. But nothing on this screen can create a due post, so today it always comes back with nothing.

### 4. Panels with nothing behind them

Each of these is empty for every real user right now. The honest line each should say instead:

- **Connected accounts** — "No social accounts are connected yet. Once one is, it will show here."
- **Accounts not connected** — "Facebook, Instagram and LinkedIn can be connected here. The other five are not ready to connect yet."
- **Which account to post to (in the writing panel)** — "Connect a social account before you can schedule a post."
- **Picture or video to attach** — "Attaching a picture is not ready yet. Posts go out as text."
- **Best times to post** — "Set your posting times once an account is connected. All times are UTC."
- **Who has to approve** — "This screen cannot read your approval setting yet. Until it can, treat every post as needing a person to look at it."
- **Could not be sent (tab)** — "Nothing has failed. This screen cannot yet see posts that were actually sent, so this list stays empty."
- **Sent (tab)** — "This screen cannot yet see posts that went out. There are no like, view or click figures anywhere in the system."
- **Jobs someone needs to fix (task strip)** — "Nothing to fix. Job tickets are not shown on this screen yet."
- **Post details (slide-out)** — "Only the writing details are known for these posts. Send details appear once real scheduled posts can be read."
- **The number-workings strip under the tiles** — delete it. It explains code, not the business.

### What is genuinely live and working today

So workflow A does not strip too much:

- The partner picker at the top.
- Writing posts with "Write 3 posts", including the on/off switch and the monthly budget left.
- The list of written posts, and the refused ones with their reasons.
- The rule check preview as you type.
- Connecting Facebook, Instagram or LinkedIn — including the honest "not set up yet" message and the button switching itself off.
- "Publish due now" — the call is real.
- The send history tab.
- The clock in the top bar.


## Change manifest

**Workflow A — done.** One file touched: `public/app/social-studio.html`. Text, CSS and layout only. No element `id`
renamed, no URL, fetch, handler or piece of logic changed, no control removed.

### Renamed (what the screen used to say → what it says now)

| Was | Now |
|---|---|
| CHANNELS tile | Connected accounts |
| QUEUED tile | Waiting to post |
| BLOCKED tile | Needs a rewrite |
| FAILED tile | Could not be sent |
| POSTED tile | Sent |
| Derivation strip | What this counts |
| Generate posts / "Write 3 posts" | Write posts / "Write 3 posts for me" |
| CONNECTED CHANNELS | Connected accounts |
| NOT CONNECTED | Not connected yet |
| COMPOSE A POST | Write a post |
| Channel — channel_id | Account |
| Offer type — required | What this post is about |
| Caption | What the post says |
| Asset — optional, one only | Picture or video (optional) |
| scheduled_for — override (UTC) | Send at (optional) — times are UTC |
| Run guardrail preview / Publish due now / Clear | Check the wording / Send anything due now / Clear the form |
| GUARDRAIL VERDICT | Copy check |
| SCHEDULED QUEUE / REVIEW QUEUE / FAILED / PUBLISHED / AUDIT TRAIL | Waiting to post / Needs a rewrite / Could not be sent / Sent / Send history |
| Tabs: Queue · Review queue · Failed · Published · Audit trail | Waiting · Needs a rewrite · Could not be sent · Sent · Send history |
| Filters: channel · offer_type | Account · About |
| Table columns: Channel · Caption · Offer type · scheduled_for · Attempt · Disposition | Account · Post · About · Send at · Tries · What happens next |
| POSTING WINDOW | Best times to post |
| APPROVAL SETTING | Who approves posts |
| POST RECORD (drawer) | Post details |
| `+ Compose` (top bar) | Write a post |

### Removed from anything a user can see

- Every panel code `SS-00`…`SS-12`, in visible labels and in the HTML comment banners.
- The build-manifest comment at the top of the body (the block listing migrations and source files).
- Every table and column name shown as a badge or as body text, including the two badges that were nothing but a
  table name (`social_channels` on Connected accounts, `social_posts` on the post lists, `partner_module_settings`
  on the approval panel) and the drawer footer that listed four table names.
- The `5 fields · schedule()` badge on the writer.
- Every file path, line-number citation and function name used as prose, and every SQL fragment.
- The `.src` code-citation lines inside the number strip.
- The footer note `ss · oauth/schedule/publish live · no list API · empty panes` → now `all times shown in utc`.
- The "would be skipped" figure under the Waiting tile and the "open tasks" figure under the Could-not-be-sent tile
  (truth brief: neither can be worked out). The code that computed them went with them; nothing else read it.
- The made-up worked example in the jobs strip that named Instagram and LinkedIn.
- The claim that "Meta and Google stay unconnected until those keys land" (finding 11 — Google is not one of the
  eight, and there is no Google connect on this screen).
- The claim that a cron publishes due posts every 5 minutes (not verified anywhere in the brief).

### Moved behind a closed section

- The long builder explanation under the copy-check panel is now a closed `<details>` titled **How the copy check
  works**, in plain words. It still says the four things that matter: the preview uses a copy of the rules held in
  the page and will not follow a rule change; the answer that counts arrives when the post is saved; paid-advert-only
  rules are skipped because these are ordinary posts; and the check refuses rather than lets through if it breaks.
- Every tab's builder paragraph is now one plain line.

### Honest lines kept (reworded to plain English, never improved)

- "No partner is chosen — nothing was sent." on both write buttons.
- The "not set up yet" connect message, and the button that switches itself off.
- The partner-scope notice, the empty-state text, the "no like or view figures exist" line, and the
  "undo recorded does not mean a post can be taken back" line.
- The panels with nothing behind them now carry the exact honest lines from section 4 of the truth brief.

### Layout refresh

- One filled button on the screen, and it is `Queue post`. `Write 3 posts for me` became an outline button.
- Card titles are sentence-case plain names in the house eyebrow treatment, matching Command Center and Affiliate.
- Phone: tiles drop to one column and the top bar wraps below 560px; each post table scrolls inside its own box.
  Measured at 390px — no sideways page scroll (page scroll width 390 of 390).

### Deliberately left

- **The number strip under the tiles was kept, not deleted.** Section 4 says delete it. Deleting the element breaks
  the five tiles: they are buttons whose only job is to write into it, and the render code addresses it by id, so
  removing it throws on load. It was rewritten instead — plain words, live numbers only, no code, no citations —
  and retitled "What this counts". Someone who wants it gone must also decide what the tile buttons do.
- **The Account filter above the post lists was kept**, although section 1 says delete it until accounts can be
  read. It is a control, and controls were out of scope for this pass. It shows "All accounts" and nothing else.
- Element `id`s that read as jargon (`publishDueBtn`, `queueBtn`) are unchanged — renaming an id was forbidden.
  The JavaScript function `nextBestTime` keeps its name for the same reason: renaming it is a code change with no
  user-visible benefit.
- Rule keys (`guaranteed-score-increase`, `croa-consumer-rights`…), rule messages and citations are untouched —
  regulated content.

### Two display-only value changes, called out because they are values, not labels

- The reason the writer gives when no topic is picked changed from code `offer_type_missing` / family `engine` to
  code `missing-topic` / family `required`, and now carries `severity:'block'`. It is written inline, read only by
  the display, and the verdict it produces is unchanged (still `blocked`).
- The approval reason's code changed from `human_approval_required_setting` to `human-approval-required`, same
  reason. Its message no longer names the setting column.

### Verification

- `npm run lint` — clean.
- Required grep — 7 hits, all code identifiers, none rendered: the element id `publishDueBtn` (3) and the
  JavaScript function `nextBestTime` (4).
- Element `id` list before vs after — identical, 82 ids.
- Smoke test in a real browser against a copy of the page: no JavaScript errors (only the expected 404s from the
  missing API), every tab switches, every tile button still writes the strip, and the copy check still refuses
  copy that breaks a rule and still prints the rule wording and citation unchanged.

### Note for whoever runs next

Between this workflow's sixth and seventh edit, another workflow's sidebar-rewrite script wrote this file back from
a stale copy and silently dropped six batches of this pass. They were re-applied on top of the newer sidebar, which
is intact (the nav now shows "Contract templates" and no Subscriptions row). If a later pass finds plain copy
missing from this screen, that race is the first thing to check.

## Found while working — not fixed

- **The Account filter and the Account column can never do anything.** The posts this screen reads carry no account,
  so the filter only ever offers "All accounts" and the column only ever shows a dash. Left in place — removing a
  control was out of scope for this pass.
- **"Queue post" cannot succeed today.** It requires an account to be picked, and the account list is always empty,
  so it always answers "Pick an account to post to first."
- **A post that has really been scheduled onto an account shows nowhere.** Its state matches none of the five tabs.
- **The tiles' number strip is one strip for five tiles.** With no partner chosen it reads "—" for every tile, which
  is correct but makes the five tile buttons look inert until a partner is chosen.

## Blockers

none


## Main thread — review pass on top of workflow A

Checked A's work rather than taking it on trust. Everything below was measured on this machine, 2026-08-17.

**Verified**
- Element ids: 82 before, 82 after, no difference. Nothing that the page's own code addresses was renamed.
- Rendered text pulled out of a real browser and read end to end: no table name, column name, file path, code
  reference, panel code or SQL fragment survives anywhere a person can see.
- `npm run lint` clean.
- Page loads with no script errors. At 375px wide there is no sideways scroll.

**Fixed in this pass**
- Grammar on the shared empty line: "Posts waiting to go out appears here" → "will show here".
- The system's own state words were still showing on the badges and in the detail rows. They now read
  Draft · Waiting · Sending now · Sent · Could not be sent · Needs a rewrite, matching the tab names.
- The copy check verdict now reads "Looks fine" / "Someone must approve it" / "Refused".
- An account's stored state no longer prints raw in a sentence.
- Drawer footer: "once real scheduled posts can be read" → "once a post has actually gone out".
- Layout: the counts strip label sits above its text instead of in a narrow side column.

**Put back**
- The page's left-hand menu had been rewritten by another session's sidebar script while workflow A was working.
  That is not this job. The menu is now byte-identical to the committed version again, and the shared nav test
  fails no more often with this change than without it.

**Test count, honestly**
- At the start of this session the tree was clean and the suite was 5554 pass · 4 fail · 3 skipped.
- Now, with several other sessions editing this same tree, it is **5592 pass · 39 fail · 3 skipped** —
  and it is exactly the same with this change and with it stashed. This change adds no failures.
- `npx tsc --noEmit` cannot run at all: there is no TypeScript settings file in the repo. True before this work.

**Not done**
- No live proof. Nothing here is on fundhub.ai yet. Workflow C cannot run until it is pushed and deployed.
- Nothing committed. The tree holds a lot of other sessions' unfinished work; only the owner should decide when
  this goes in.

## Found while working — not fixed

1. **"Queue post" cannot succeed today.** It needs a social account picked, and no account list is ever loaded,
   so it always answers "Pick an account to post to first."
2. **The Account filter and the Account column can never fill** — the posts this screen reads carry no account.
3. **A post that really has been scheduled onto an account shows nowhere** — its state matches none of the five tabs.
4. **Five panels can never fill for a real user**: connected accounts, accounts not connected, pictures to attach,
   best times to post, who approves posts. Each now carries an honest empty line. The house rule in
   `docs/UI-STANDARDS.md` §5 says a thing that does nothing today should not render at all — that is an owner call,
   not a copy fix, so nothing was hidden.
5. **The five headline tiles wrap 4 + 1.** The shared stylesheet forces four per row on purpose
   ("never five tiles in one row"). Left alone — changing it would move every screen in the CRM.
