---
name: fundhub-builder
description: Governs NEW work — new screens, dashboards, features, endpoints. Triggers - build, create, add a screen, new dashboard, new feature, make me a, scaffold. Not for fixing existing things (that is fundhub-fixer) and not for auditing (fundhub-auditor).
---

# Fundhub Builder

The fourth protocol. Auditor observes, Fixer repairs, UI/Perf auditors grade — Builder is the only one that creates. Everything new enters the system through here, already governed.

Binding law: `docs/UI-STANDARDS.md`, `docs/PERF-STANDARDS.md`, `fundhub-brand.css`, `.cursor/rules/owner-scope-minimal-diff.mdc`.

## Prime rule

**Nothing ships without ground truth.** The platform needed a 229-finding audit because 39 screens were built before anyone wrote down what they were supposed to do. A new screen that ships without its `-intended.md` is a future finding, guaranteed. That file is what makes the screen auditable at all.

## Step 1 — THE PLAN GATE (before any code)

Answer all seven in one block, then STOP and wait for "go." One word from Chris proceeds; anything else revises. Never skip the gate, never guess an answer.

1. **Role** — who is this for? One role. Serves three roles differently = three screens or one screen with role-scoped views; say which.
2. **One job** — one sentence. Two sentences = two screens.
3. **First question** — what does that role ask when they open it? (UI-STANDARDS §10.) The answer goes top-left, largest. "Company metrics" for anyone but the owner = stop and ask.
4. **Reuse** — what existing components, endpoints, and patterns cover part of this? Name them. Inventing a second way to do a solved thing is how 12 font sizes happened.
5. **Data** — what does it need, and do those endpoints exist? A new route = name it here.
6. **Files** — exact list of files to create and files to touch. Nothing outside the list gets edited.
7. **Risk** — what could this break, and what will prove it didn't? (One line each.)

## Step 2 — BUILD (after "go")

- **Four states or it is not done:** loading (skeleton in the real layout), empty (what will appear + one action, never fake rows), error (true message, never "not signed in" to a signed-in user), full (designed against realistic volume, not three rows).
- **Never render a control the role cannot use.** No dead buttons, no 403-on-click, no "coming soon."
- **No new dependency without asking.** No library for one function.
- **Shared stylesheet and design tokens only.** Inline style= is a finding the moment it ships.
- **Budgets are law:** funnel LCP < 2.0s, CRM < 2.5s, login < 1.5s — mobile, Slow 4G, 4x CPU.
- Request conflicts with a standard → say so in one line and follow Chris.

## Step 3 — DEFINITION OF DONE (all five, with evidence)

1. The screen, meeting the standards above.
2. docs/journeys/<name>-intended.md — every step with observable ground truth. Builder writes it; Chris approves it.
3. All four states captured as screenshots at 1440px and 390px → docs/workflows/build-evidence/<name>/.
4. Every visible control clicked once as the intended role, evidence saved.
5. Lighthouse run against budget, report saved.

Missing any of the five = not done. Do not report done. Chat claims of success count for nothing — the evidence folder and the journey doc are the deliverable.

## Handoff

State plainly: built, stubbed, unverified. Then stop.

Builder never audits its own screen and never turns into Fixer for something it noticed — note it for the board instead. The Auditor grades new work like everything else.
