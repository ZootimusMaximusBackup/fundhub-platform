# CRM CHAT WIDGET — BUILD SPEC v1

**Status:** built 2026-08-02 (v1). Messaging + system ask + Company Brain passthrough.
**Depends on:** Company Brain (docs/COMPANY-BRAIN-BUILD-SPEC.md) for the document-query half.
**Owner decisions (this build):** C-1 separate how-to corpus; C-2 any client in org; C-3 staff + client portal only.

---

## 1. What this is

One chat surface, available in **both** the internal CRM and the client portal, that does three things:

1. **Ask the system how to use itself** — "how do I send a contract?", "where do I find a client's soft pull?"
2. **Ask the system about company knowledge** — SOPs, sales scripts, call recordings. This is Company Brain's retrieval layer surfaced through chat instead of a search box.
3. **Message people** — staff-to-staff, staff-to-client, and client-to-staff on the same conversation surface. Agent-to-client uses the same surface later; the data model must allow it from day one.

It is one widget, not three separate features.

## 2. Why it exists

Today there is no way to ask the CRM anything. New staff have no in-product way to learn the system, company knowledge lives in Drive where nobody looks, and staff-to-staff messaging happens outside the platform entirely.

## 3. What already exists and must be reused

**Do not rebuild any of this.**

- **Conversations, threading, send path** — built 2026-08-01 in the staff reply inbox. `messages` and `conversations` tables, `src/messaging/dispatch.mjs`, compliance gate, `POST /api/messages`, `GET /api/read/messages`. Staff-to-staff pinging is a new conversation kind on this existing infrastructure, not a new messaging system.
- **Company Brain retrieval** — tier filtering, ROLE_SETS wiring, chunk store. The chat widget is a second surface on the same retrieval layer as the Company Brain search screen.
- **ROLE_SETS** — the existing permission model. Do not invent a second one.
- **Session auth** — same as the rest of the CRM.

## 4. The three modes

### 4.1 How-to-use-the-system

Answers from documentation about the platform itself: the specs in `docs/`, journey documentation, CLAUDE.md, screen behavior.

This is a distinct corpus from company knowledge. A closer asking "how do I send a contract" should get the product answer, not a sales script.

Open question: whether this corpus is indexed the same way as Company Brain content or maintained separately. See C-1.

### 4.2 Company knowledge

Straight passthrough to Company Brain retrieval. Same tier filtering, same fail-closed rules, same affiliate boundary.

**The affiliate boundary applies here identically.** An affiliate using the chat widget hits only the affiliate allowlist, with no fallback. This is the only externally-visible failure mode in the whole system.

### 4.3 Messaging — staff, clients, and agents

The widget is a general messaging surface, not just staff-to-staff. It appears in **both** the internal CRM and the client portal.

Three participant types:

**Staff → staff.** Internal. Does NOT route through the compliance gate's TCPA/quiet-hours rules, does not count against outbound limits. Visually distinct from client threads so nobody replies to a colleague thinking it's a client.

**Staff → client.** A real client message. MUST route through the existing compliance gate exactly like any other outbound. Quiet hours, opt-out, and consent rules all apply. This is the same path the staff reply inbox already uses — reuse it, do not create a second send path that bypasses compliance.

**Client → staff.** From the portal side. Lands in the staff inbox, threaded to that client's existing conversation, not a separate silo.

**Agent → client (future).** The same conversation surface is intended to become the channel AI agents use to reach clients. That means: conversation records must not assume a human sender, `sender_id` must accommodate an agent identity as well as a staff identity, and the compliance gate must apply to agent-sent messages identically. Build the data model for this now even if agent sending is not turned on in v1 — retrofitting it later means touching every message record.

**Hard rule:** anything going to a client — from a human or an agent — passes the compliance gate. No exceptions, no second path.

## 5. Surface

- Available from every screen (persistent widget or keyboard shortcut).
- Mode is inferred from the question where possible; explicit mode switch available.
- Answers cite sources with links back to the source document or record.
- Honest empty states. If a question can't be answered from available material, say so — never fabricate a product behavior or a policy.
- Same visual language as the rest of the CRM.

## 6. Human decisions required

- **C-1:** Is platform documentation ("how do I use this") indexed in the same store as company knowledge with a separate tier, or maintained as its own corpus?
- **C-2:** Can staff message any client, or only clients assigned to them?
- **C-3:** Do affiliates and white-label partners get the widget in v1, or internal + client only to start?

## 7. Build order

1. Messaging foundation. Agent-ready sender identity in the data model now. Staff → staff first (no compliance gate, visually distinct). Then staff → client on the existing compliance-gated send path — reuse it, no second path. Then client → staff from the portal, threaded into that client's existing conversation.
2. How-to-use-the-system, internal roles only.
3. Company knowledge passthrough, once Company Brain retrieval exists.
4. Affiliate / white-label access, if C-3 says yes. Last, reviewed hardest.

## 8. Explicitly out of scope for v1

- Voice input
- Taking actions on the user's behalf (creating records, sending contracts, moving pipeline cards) — this is a read-and-ask surface plus messaging, not an agent that acts
- Agent-sent messages turned on — data model ships ready; the agent send path stays off until a later release
