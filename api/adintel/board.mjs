// GET /api/adintel/board — the Winner's Board read endpoint.
//
// docs/specs/W2-creative-intelligence.md §11.3, §13.
//
//   ?view=movers        (default) this week's top creatives, with a trend arrow
//   ?view=death-watch   what dropped out of the top decile, and when
//   ?view=new-entrants  advertisers first seen this week
//   ?view=saturation    the angle x format x funnel grid
//   ?view=weeks         which weeks have been rolled up
//
//   ?week=2026-W35   defaults to the most recent week that has data
//   ?angle= ?band=hot|warm|cold  ?platform= ?risk=   (movers only)
//   ?limit= ?offset=
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS DOES NOT USE partnerReadHandler
//
// src/http/partner-read-api.mjs is the right shape for a partner's own book and
// it is used unchanged everywhere else in the Creative Factory. It is not used
// here for one specific reason: it returns `page(rows)` and nothing else, and
// every view on this board has to carry CONTEXT alongside the rows — which week
// this is, whether outcome data exists yet, and the stated limitation about what
// the ranks are based on.
//
// That context is not decoration. §10 of the spec is explicit that the board
// must SAY, on the screen, that ranks come from how long ads run rather than
// from measured outcomes — "not a disclaimer in 8pt grey, a stated limitation."
// A response shape with nowhere to put it would push that sentence into
// hand-written HTML, where it can be edited away by someone who does not know
// why it is there.
//
// So the three locks partner-read-api documents are reproduced here explicitly,
// using the same building blocks it uses:
//
//   1. requirePrincipal(["partner","staff"]) — a client or affiliate session is
//      refused. requireAuth is NOT used and could not be: it ignores a `roles`
//      key entirely (CLAUDE.md §12) and it answers a different question.
//   2. withPartnerScope — every query runs inside the scoped transaction, so the
//      RLS policies in 278 apply. On these tables that policy grants READ to a
//      scoped caller and WRITE to nobody but staff.
//   3. redact() — the last pass over the body, whatever the SQL selected.
//
// And a fourth that is specific to this endpoint: every row goes through
// toPartnerRow(), an explicit column allow-list. The raw Winner Score, the
// weights, FundHub's model bill and the vendor payload are not in it, and
// FundHub's own advertisers are filtered out in SQL before any of that.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { redact, pageParams, page } from "../../src/http/read-api.mjs";
import { resolvePartnerId, safeMessage } from "../../src/http/partner-read-api.mjs";
import {
  feedForWeek, deathWatchForWeek, newEntrantsForWeek, saturationForBoard,
  weeksAvailable, RANK_BASIS_NOTE, NO_SPEND_NOTE
} from "../../src/creative-intel/board.mjs";
import { ANGLES, COMPLIANCE_RISKS, OBSERVED_PLATFORMS } from "../../src/creative-intel/taxonomy.mjs";

export const VIEWS = ["movers", "death-watch", "new-entrants", "saturation", "weeks"];
const BANDS = ["hot", "warm", "cold"];
const WEEK_RE = /^\d{4}-W\d{2}$/;

/* resolveWeek — the requested week, or the latest one that has data.

   NOT "this week". On a fresh install this week has no roll-up, and defaulting
   to it would render an empty board that looks like a broken product rather
   than like a job that has not run yet. Returns null when NOTHING has been
   rolled up, and the handler answers with an explicit empty state. */
export async function resolveWeek(tx, orgId, requested) {
  if (requested && WEEK_RE.test(String(requested))) return String(requested);
  const weeks = await weeksAvailable(tx, { orgId, limit: 1 });
  return weeks.length ? weeks[0].iso_week : null;
}

/* fetchView — exported so src/http/adintel-board.pg.test.mjs can execute every
   query for real. An endpoint whose SQL only ever runs behind an HTTP handler is
   one whose column names go unchecked until a subscriber opens the screen. */
export async function fetchView(tx, { view, orgId, week, limit, offset, query = {} }) {
  switch (view) {
    case "death-watch":
      return { items: await deathWatchForWeek(tx, { orgId, week, limit: limit + 1, offset }) };
    case "new-entrants": {
      const r = await newEntrantsForWeek(tx, { orgId, week, limit: limit + 1 });
      return { items: r.entrants, meta: { start: r.start, end: r.end } };
    }
    case "saturation": {
      const s = await saturationForBoard(tx, { orgId, week });
      return {
        items: s.cells,
        meta: { start: s.start, end: s.end, angles: s.angles, totals: s.totals }
      };
    }
    case "weeks":
      return { items: await weeksAvailable(tx, { orgId, limit: limit + 1 }) };
    case "movers":
    default:
      return {
        items: await feedForWeek(tx, {
          orgId, week, limit: limit + 1, offset,
          // An unrecognised filter value is IGNORED rather than 400. These are
          // cosmetic filters on a browsing screen; a stray value should narrow
          // nothing, not blank the board. ?week= is the exception — a bad week
          // would silently show a different week's data, so it is validated.
          angle: ANGLES.includes(String(query.angle)) ? query.angle : null,
          band: BANDS.includes(String(query.band)) ? query.band : null,
          platform: OBSERVED_PLATFORMS.includes(String(query.platform)) ? query.platform : null,
          risk: COMPLIANCE_RISKS.includes(String(query.risk)) ? query.risk : null
        })
      };
  }
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db: database });
  if (!principal) return;

  const query = req.query || {};
  const view = VIEWS.includes(String(query.view)) ? String(query.view) : "movers";

  // Staff must name a partner, exactly as every other partner-facing read does.
  // The board's rows are the same for every partner — it is shared competitor
  // data — but the SCOPE is not cosmetic: it is what opens the transaction the
  // RLS policy reads, and letting staff skip it would make this the one
  // endpoint in the module that runs unscoped.
  const partnerId = resolvePartnerId(principal, query);
  if (!partnerId) {
    return res.status(400).json({
      ok: false, error: "partner_id_required",
      message: "staff sessions must name a partner_id; partner sessions are scoped to their own"
    });
  }

  const orgId = principal.orgId;
  if (!orgId) {
    return res.status(400).json({ ok: false, error: "org_unresolved" });
  }

  try {
    const { limit, offset } = pageParams(query);
    const result = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const week = await resolveWeek(tx, orgId, query.week);
      if (!week) {
        return {
          empty: true,
          body: {
            view, week: null, count: 0, limit, offset, hasMore: false, items: [],
            meta: {
              // An honest empty state. Nothing has been rolled up yet, and
              // saying so is more useful than an empty grid that reads as "no
              // competitor is running anything", which would be false.
              reason: "no_weeks_rolled_up",
              message: "No week has been rolled up yet. The board fills in after the first weekly pull."
            }
          }
        };
      }
      return { week, ...(await fetchView(tx, { view, orgId, week, limit, offset, query })) };
    }, { pool: deps.pool });

    if (result.empty) {
      return res.status(200).json({ ok: true, ...result.body, notes: notes() });
    }

    return res.status(200).json({
      ok: true,
      view,
      week: result.week,
      ...page(result.items, { limit, offset }),
      meta: redact(result.meta || {}),
      notes: notes()
    });
  } catch (err) {
    if (err && err.code === "BAD_REQUEST") {
      return res.status(400).json({ ok: false, error: "bad_request", message: safeMessage(err) });
    }
    return res.status(500).json({ ok: false, error: "query_failed", message: safeMessage(err) });
  }
}

/* The two sentences that must travel with every response.

   They are in the BODY, not in the page's HTML, so that a screen cannot ship
   without them and so the API and the page cannot disagree about the wording.
   Per CLAUDE.md §2, absence is a finding and not a gap to paper over: there are
   zero measured paid closes on record, so the board says what its ranks are
   actually based on. */
function notes() {
  return { rankBasis: RANK_BASIS_NOTE, spend: NO_SPEND_NOTE };
}
