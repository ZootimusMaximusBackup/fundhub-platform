# Portal welcome video — script + feature inventory

Created 2026-09-20. Owner: Chris. One document, copy-paste ready.

Plays in the hero slot at the top of the client portal (`public/app/client-portal.html`,
section 1, `#video-title` — "Welcome to the Fundhub portal"). Every client sees it,
whatever offer they came in from. **The script never names the offer they bought.**

---

## 1. Feature inventory — what a client actually sees

Read from `public/app/client-portal.html` and `netlify/functions/api.mjs` ROUTES on
2026-09-20. In portal order:

| # | What they see | What it does for them | Advisor involved? |
|---|---|---|---|
| 1 | **Welcome video** | This video. Top of the page, first thing. | No |
| 2 | **Sign to authorize dispute letters** | One signature that lets us send letters on their behalf. Only shows if their package needs it. | No |
| 3 | **Wins group** | Link out to the private Facebook group where clients post results. | No |
| 4 | **Your agreements** | Every contract they signed, in one place. | No |
| 5 | **Where your funding is** | A status line plus an 8-step tracker: Booked → Diagnostic Paid → Docs Received → Round Started → Round Submitted → Round Approved → Round Funded → File Finalized. Before their call it shows a simpler "before your call" version. | No |
| 6 | **Pre-qualified for $X** | The dollar amount on their file, when there is one. | No |
| 7 | **Your credit scores** | Their scores, once a pull has run. | No |
| 8 | **Recommended next** | One suggested next step, picked for them. | No |
| 9 | **Send a file** | Three upload doors — ID and personal documents, inquiry documents, bureau responses — each with a dropdown so the file gets filed right. | No |
| 10 | **What You Own** | Everything in their package, downloadable the moment it is built. Nothing expires. | No |
| 11 | **Unlock More** | Locked tiles they can add: soft-pull assessment ($32, fixed), Funding done-for-you, Capital readiness done-for-you, Capital readiness test run, Capital Blueprint, Capital Academy. Everything except the soft pull is priced on a call. | Yes — "Talk to an advisor" on each tile |
| 12 | **Capital Blueprint mini course** | 5 short videos on how to use each deliverable. Unlocks with the Blueprint. | No |
| 13 | **Capital Academy** | 10-module course. | No |
| 14 | **Account & history** | A drawer with five tabs: Payments, Agreements, Documents, Activity, Messages. | No |
| 15 | **Your Funding Advisor** | Named person who looks after their file. Reached through the chat bubble in the corner. No charge, no pitch. | Yes |
| 16 | **Want More Funding?** | Books a 20-minute call on what a bigger approval would take. | Yes |
| 17 | **Phone notifications** | Turn on alerts so they hear about their file without logging in. | No |

### Referral — what exists and what does not

- **The back end is built and live.** `POST /api/affiliates/refer` turns a client into
  a light affiliate and hands back their own share link. One press. No application, no
  approval queue, no second login. It is safe to press twice — same link every time.
- **The commission schedule is owner-set:** 20% on people they send directly, 5% on the
  next level down (`db/migrations/261_affiliate_tier1_20pct_20260824.sql`).
- **FINDING — there is no button.** `client-portal.html` has no referral card, no share
  link, nothing. The endpoint is routed and working; the client cannot reach it.
  The script below asks for referrals, so **a "Refer a friend" card has to be added to
  the portal before this video goes live**, or the ask points at nothing.

---

## 2. The script

**Target: 90–120 seconds.** Spoken, not read. Chris to camera.

> **[0:00 — Thank you]**
>
> Hey — it's Chris. Welcome in, and thank you. I mean that.
>
> I don't know exactly which door you came through to get here, and honestly it doesn't
> matter. You're in. This is your portal now. Let me take sixty seconds and show you
> where everything lives so you're not clicking around guessing.
>
> **[0:15 — The run-down]**
>
> Right under this video is your tracker. That's the whole road — from where you are
> right now, all the way to funded. Whatever step you're on, it's lit up. You never have
> to email somebody and ask "hey, where am I." It's right there.
>
> Under that is **Send a file**. Three doors. ID and personal stuff in one. Inquiry
> paperwork in another. Anything the bureaus mail you goes in the third. Pick the door,
> pick what it is, send it. That's it. Every time you're fast with a document, your file
> moves faster. That's the one thing on this page that's genuinely in your hands.
>
> Then there's **What You Own**. Everything we build for you drops in there the second
> it's ready, and it's yours. It doesn't expire. Download it whenever.
>
> Under that is **Unlock More** — that's the stuff you don't have yet. Take a look or
> don't. No pressure. It's there when you want it.
>
> And down at the bottom is your advisor. Real person. Their name is on the card.
> Hit the chat bubble in the corner and it goes straight to them. Question about your
> round, a document, a payment, anything — that's who you want. It doesn't cost you
> anything and they're not going to pitch you.
>
> **[1:00 — The ask]**
>
> Last thing, and this is the part I actually want you to hear.
>
> You know somebody. You do. Somebody who's stuck on the exact thing you were stuck on
> last week. Maybe they've told you about it. Maybe they haven't and you can just tell.
>
> There's a **Refer a friend** button on this page. Press it, you get your own link,
> and it's done. No application. No waiting on me to approve you.
>
> Then anybody who comes through that link — you get paid on it. Twenty percent. And
> if one of *them* sends somebody, you get five percent off that too. That's not a
> thank-you gift card. That's real money, and it keeps paying.
>
> But forget the money for a second. If any of this has been worth it to you so far —
> send it to two people. Just two. Worst case they say no. Best case you're the reason
> somebody stops being stuck.
>
> That's it. Welcome in. Go look around.
>
> **[END]**

---

## 3. Delivery notes

- **Say nothing about the offer they bought.** No "since you grabbed the blueprint."
  This plays for SLO, affiliate, white-label and direct clients off the same file.
- **No credit-outcome claims.** No scores going up, no negatives coming off, no
  timelines on either. The script above has none — keep it that way in the edit.
- **No income claims.** 20% and 5% are the real commission rates. Do not add
  dollar examples, screenshots of earnings, or "people make $X a month."
- Portal names in the script match the on-screen labels exactly: *Send a file*,
  *What You Own*, *Unlock More*, *Refer a friend*.
- If the referral card is not built yet, cut the section from "There's a **Refer a
  friend** button" through "...five percent off that too" and keep the closing two
  paragraphs. The ask still works; the mechanism is just missing.

---

## 4. Blockers

1. **Refer a friend card does not exist in the portal.** Back end is live and routed.
   Front end has nothing. Needs to be built before this ships as written.
