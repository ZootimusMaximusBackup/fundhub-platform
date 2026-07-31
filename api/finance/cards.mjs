// /api/finance/cards — the payment instrument on file for a client, and which
// one the live subscription charges.
//
//   GET  ?client_id=<uuid>[&include_removed=1]      → { ok, cards }
//   POST { action: "add",    client_id, provider_token, brand?, last4?, exp_month?, exp_year?, provider? }
//   POST { action: "attach", client_id, card_id }   → point the live subscription at a card
//   POST { action: "remove", client_id, card_id }   → retire an instrument
//
// *** SCAFFOLD STUB — TRACK 1 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are the
// contract and are finished. Track 1 replaces the `not_implemented` bodies.
//
// THIS IS NOT A CARD-CAPTURE ENDPOINT AND MUST NOT BECOME ONE. There is no
// "add a card" action here on purpose. src/subscriptions/index.mjs's
// normalizeCardMeta() THROWS on a PAN and on a CVV, and putClientCard() stores a
// provider TOKEN plus brand/last4/expiry and nothing else. Nothing in this
// repository transmits (there is no outbound fetch in src/adapters/ or
// src/lib/), so there is no processor to tokenise a card number against — an
// endpoint that accepted one would be storing raw card data with nowhere to send
// it, which is the worst possible combination. If a token ever arrives from a
// processor, `putClientCard` is the writer and a new action gets added HERE with
// a compliance review attached, not a PAN field bolted onto this one.
//
// *** COMPLIANCE REVIEW REQUIRED — THAT ACTION NOW EXISTS. ***
//
// `action:"add"` was added in the track-1 build, and it is the case the
// paragraph above describes and permits: it takes a processor TOKEN that already
// exists somewhere else, plus brand / last4 / expiry, and it takes nothing else.
// It is NOT a card-capture form and the change does not move the line the
// paragraph draws. Specifically:
//
//   • The only credential it accepts is `provider_token`, which is a REFERENCE
//     to an instrument held by a processor. It cannot be used to charge anything
//     from this repository, because nothing in this repository transmits.
//   • Every write goes through normalizeCardMeta(), which THROWS — loudly, at
//     the boundary, before storage — on `pan`, `card_number`, `number`, `cvv`,
//     `cvc`, `security_code` and ten more spellings (index.mjs:35), on a token
//     shaped like a card number, and on a "last4" longer than four digits. It
//     refuses rather than truncates, deliberately: truncating accepts a full
//     card number, holds it in this process's memory, and reports success, so
//     nobody upstream ever learns they sent one (index.mjs:98).
//   • migration 076 repeats both checks in SQL, so a writer that skips this
//     module still cannot get a PAN in.
//   • It adds no outbound call, no scheduler and no charge. Storing which
//     instrument a client is on is a record; billing against it is a payment-rail
//     change and is still unbuilt and still needs its own review.
//
// The owner enters these by hand today because there is no processor integration
// to receive them from — the same posture as bank accounts and cards elsewhere
// in this build. Whoever reviews this should be reading for one thing: whether
// a hand-typed "token" field can end up holding a real card number. The answer
// is that the shape test refuses 12-19 digits at three layers, and that a token
// that is not a card number is not regulated card data.
//
// REMOVE NEVER DELETES. removeClientCard() stamps removed_at and 076's foreign
// key is ON DELETE RESTRICT, because a card that paid for something has to stay
// resolvable from the subscription that used it. Re-removing keeps the FIRST
// date — that date is the answer to "when did they take it off file", which is a
// question a chargeback turns on.
//
// ORG AND CLIENT COME FROM THE SESSION AND THE CLIENTS TABLE, never from the
// body. See the long note in api/finance/subscriptions.mjs; the reasoning is
// identical and a card is if anything more sensitive than a tier.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import {
  putClientCard, listClientCards, removeClientCard, attachCard
} from "../../src/subscriptions/store.mjs";
import { assertNoCardData } from "../../src/subscriptions/index.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. A payment instrument is the narrowest
   thing this API serves. It shares subscriptions.html, whose row in
   public/app/shell.js OWNER_ADMIN_ONLY mirrors this gate. */
const CARD_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* publicCard — the row minus the one field that must never leave the process.
 *
 * THE TOKEN IS THE CREDENTIAL. `provider_token` is the string a processor
 * accepts as "charge this instrument". No screen needs it: a person identifies a
 * card by brand and last four, and every action here identifies one by its row
 * id. Sending it to a browser puts a chargeable reference into a page, a
 * console, a screenshot and a support ticket, for zero benefit.
 *
 * redact() IN src/http/read-api.mjs DOES NOT CATCH THIS ONE. Its FORBIDDEN_KEY
 * pattern (read-api.mjs:18) matches `token_hash` but not `provider_token`, so
 * `SELECT *` from client_cards passes the live token straight through. That is
 * worth fixing centrally, but read-api.mjs is shared plumbing every read
 * endpoint in the repo runs through and this build is not the place to widen its
 * pattern — so the strip is explicit here, where the column lives, and the gap
 * is named in the track report. Whitelisting the fields rather than deleting one
 * also means a future column on client_cards is absent by default instead of
 * published by default.
 *
 * `token_present` is what replaces it: the screen has to be able to say "this
 * card has a token on file" without holding the token. */
function publicCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    provider: row.provider,
    token_present: row.provider_token != null && String(row.provider_token) !== "",
    brand: row.brand,
    last4: row.last4,
    exp_month: row.exp_month,
    exp_year: row.exp_year,
    removed_at: row.removed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key. See the note
  // in api/finance/subscriptions.mjs.
  if (!requireRole(res, staff, CARD_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      /* Removed cards are readable on purpose — a subscription that charged one
         must stay explainable — so `include_removed=1` is a real parameter, not
         a debugging flag. The screen asks for them every time and renders them
         in a separate, dimmed group with their removal date, because "this card
         paid for the plan you are looking at, and it is off file now" is a
         sentence somebody will need during a chargeback.

         Anything other than the exact string "1"/"true" means off. A truthiness
         test on the raw value would make `?include_removed=0` and
         `?include_removed=false` both mean ON, which is the opposite of what
         whoever typed them meant. */
      const raw = String(q.include_removed ?? "").trim().toLowerCase();
      const includeRemoved = raw === "1" || raw === "true" || raw === "yes";

      const cards = await listClientCards(db, {
        orgId, clientId: String(q.client_id).trim(), includeRemoved
      });
      return res.status(200).json({
        ok: true,
        client_id: String(q.client_id).trim(),
        include_removed: includeRemoved,
        cards: cards.map(publicCard)
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const clientId = String(body.client_id).trim();

      /* THE card_id CHECK MOVED INTO THE ACTIONS THAT HAVE ONE. The scaffold
         asserted `isUuid(body.card_id)` for every POST, which was right while
         both actions took a card id. "add" CREATES the card, so it has no id to
         send, and leaving the check above the switch would have made every add
         a 400 reading "card_id must be a uuid" — an error message about a field
         the caller is not supposed to send. Each branch now states its own
         requirement. */
      const needCardId = () => {
        if (isUuid(body.card_id)) return null;
        return res.status(400).json({ ok: false, error: "card_id must be a uuid" });
      };

      switch (body.action) {
        case "add": {
          /* A REFERENCE TO A CARD, NOT A CARD. See the compliance block at the
             top of this file. Everything dangerous about this call is refused
             inside normalizeCardMeta(), which putClientCard() calls before it
             touches the database — a `pan`, `cvv`, `security_code` or any of
             their other spellings throws TypeError and lands on the 400 below
             carrying the sentence that names the field. This handler adds no
             validation of its own on purpose: a second copy of the rule here
             would be a second place for it to drift.

             ...EXCEPT THIS ONE LINE, AND THE TEST THAT FOUND WHY IT IS NEEDED.
             assertNoCardData has to see the REQUEST BODY, not the object built
             below it. normalizeCardMeta scans the object it is handed, and the
             object handed to putClientCard is assembled here from named fields
             — so a `pan` or a `cvv` in the request was not refused by it, it was
             silently DROPPED on the floor, and the caller got a cheerful 200.
             That is the exact failure mode index.mjs:30 is written against: a
             quiet drop leaves the sender believing the number was stored, so
             nothing upstream ever learns it sent one and the next request sends
             one too. Meanwhile the number was in this process's memory and in
             the request log. The scan runs on `body` first, and it throws. */
          assertNoCardData(body, "add");

          /* `provider` defaults to 'commas' inside normalizeCardMeta, matching
             the column default in 076. It is accepted rather than hardcoded
             because the day a second processor exists, the alternative is a
             column full of the wrong word.

             THIS IS AN UPSERT ON THE TOKEN AND IT DOES NOT UN-REMOVE A CARD.
             Re-adding a token that is on file refreshes brand/last4/expiry and
             leaves removed_at exactly as it was, so a removed instrument cannot
             quietly come back to life through the add form (store.mjs:69). The
             screen has to say that; the endpoint just must not lie about it. */
          const card = await putClientCard(db, {
            orgId,
            clientId,
            provider: body.provider ?? null,
            provider_token: body.provider_token ?? body.token ?? null,
            brand: body.brand ?? null,
            last4: body.last4 ?? null,
            exp_month: body.exp_month ?? null,
            exp_year: body.exp_year ?? null
          });
          return res.status(200).json({ ok: true, action: "add", card: publicCard(card) });
        }

        case "attach": {
          const bad = needCardId();
          if (bad) return bad;
          /* attachCard THROWS A PLAIN Error, WHICH IS A 500 UNLESS IT IS CAUGHT
             HERE. store.mjs:409 raises `new Error("attachCard: no live
             subscription, or that card is removed or belongs to another
             client")` — no `status`, no class — and
             netlify/functions/api.mjs:334 turns any plain Error into HTTP 500
             "internal_error". Every one of those three causes is the caller's
             situation, not a fault: there is nothing to attach to, or the card
             is not attachable. So it is caught by name at the call site.

             Matching on the message prefix is not good and it is the only
             handle the store gives: the fix is a typed error in the store next
             to SubscriptionConflictError, which is named in the track report
             rather than done here, because the store is shared and tested and
             this build does not own it. The prefix is stable — it is the
             function's own name — and the message is passed through verbatim so
             the person reading the screen gets the sentence, not "500". */
          let sub;
          try {
            sub = await attachCard(db, { orgId, clientId, cardId: String(body.card_id).trim() });
          } catch (err) {
            if (err && !(err instanceof TypeError) &&
                String(err.message || "").startsWith("attachCard:")) {
              return res.status(409).json({
                ok: false,
                error: String(err.message).replace(/^attachCard:\s*/, "").slice(0, 200)
              });
            }
            throw err;
          }
          return res.status(200).json({ ok: true, action: "attach", subscription: sub });
        }

        case "remove": {
          const bad = needCardId();
          if (bad) return bad;
          /* REMOVE NEVER DELETES, AND RE-REMOVING NEVER MOVES THE DATE. Both
             rules live in the store; this call just has to not paper over the
             null it returns.

             A null means the UPDATE matched nothing — no such card in this org.
             That is a 404. Answering 200 with an empty body would tell the
             screen "removed" for a card that is still on file and still able to
             be charged, which is the worst possible way to be wrong here. */
          /* THE OWNERSHIP CHECK COMES FIRST, AND IT HAS TO. removeClientCard()
             scopes its UPDATE to the ORG but not to the CLIENT (store.mjs:141
             — it takes no clientId at all). So a request naming client A and a
             card belonging to client B of the same org would stamp B's card
             removed and then get an answer about A. Checking afterwards does not
             help: by then the write has happened. This reads the client's own
             cards first — the removed ones included, so re-removing still
             resolves — and refuses before touching anything. */
          const cardId = String(body.card_id).trim();
          const onFile = await listClientCards(db, { orgId, clientId, includeRemoved: true });
          if (!onFile.some((c) => String(c.id) === cardId)) {
            return res.status(404).json({ ok: false, error: "no such card for this client" });
          }

          const card = await removeClientCard(db, { orgId, id: cardId, at: body.at ?? null });
          if (!card) return res.status(404).json({ ok: false, error: "no such card" });
          return res.status(200).json({ ok: true, action: "remove", card: publicCard(card) });
        }

        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      /* THIS BRANCH IS WHERE A CARD NUMBER STOPS. normalizeCardMeta throws
         TypeError for a `pan`/`cvv`/`security_code` field, for a token shaped
         like a card number, and for a last4 longer than four digits. The message
         is passed through because it names the field that must not have been
         sent — the person who has to fix it is the person reading it, and
         "invalid_parameter" would send them looking at the wrong box.

         The messages are ours, not the database's, so there is nothing in them
         to leak. They do not quote the offending VALUE either: assertNoCardData
         reports the field NAME only (index.mjs:66), which is deliberate — an
         error string containing a card number is a card number in a log. */
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    /* RangeError, NOT TypeError, IS WHAT A BAD EXPIRY THROWS. readExpMonth
       (index.mjs:77) and readExpYear (index.mjs:90) both raise RangeError —
       month outside 1-12, or a two-digit year, which is refused rather than
       expanded because the rule that reads "29" as 2029 reads "99" as 2099.
       Without this branch the throw left the handler and api.mjs:334 rendered it
       as HTTP 500, so typing 13 in the month box said the server broke. */
    if (e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    /* putClientCard's OTHER plain Error — a token already on file for a
       DIFFERENT client (store.mjs:109). The upsert's WHERE guard is what stops
       it handing back somebody else's card row for this client to attach, so the
       refusal is correct and important; only its status was wrong. It is a
       conflict, not a fault, and 409 is what data.js's write() classifies as
       "the backend is fine, the request was not" (data.js:254). Same
       message-prefix caveat as attachCard above: the store gives no type. */
    if (e && !(e instanceof TypeError) &&
        String(e.message || "").startsWith("putClientCard:")) {
      return res.status(409).json({
        ok: false,
        error: String(e.message).replace(/^putClientCard:\s*/, "").slice(0, 200)
      });
    }
    /* 23514 check_violation — 076 repeats the last4 shape, the not-a-PAN test
       and the expiry range in SQL, so a value that somehow got past
       normalizeCardMeta is still refused. The caller's value, so 400. */
    if (e && (e.code === "23514" || e.code === "23503")) {
      return res.status(400).json({ ok: false, error: "the database refused that value" });
    }
    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}
