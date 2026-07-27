# FIXTURE — shaped like fundhub-docs/sources/Workflow-SMS-Fixes-Ready-to-Paste.md

Not real copy. Exercises a multi-message cadence, a header with a ⚠️ annotation,
and a header with no ID prefix.

---

## WF-TEST-01 — Two Message Cadence  (2 messages)

**Message 1:**
> Hey {{contact.first_name}}, first message. Reply STOP to opt out.

**Message 2:**
> Hey {{contact.first_name}}, second message. Reply STOP to opt out.

---

## WF-TEST-02 — Needs A Link  ⚠️ needs your real link

> Hi {{contact.first_name}}, here is the link: [PASTE LINK]. Reply STOP to opt out.

(a parenthetical note that is not part of the body.)

---

## Round Started | Client Notify

> Hi {{contact.first_name}}, your round is underway. Reply STOP to opt out.
