// Partner scope — the one predicate every partner-facing read passes through.
//
// A partner seeing another partner's client is the worst bug this system can have,
// so this module has one job and takes it literally: turn a caller's identity into
// a SQL fragment that cannot match a row it should not, and make the unsafe call
// impossible to write by accident.
//
// THE DESIGN RULE. There is no "no scope" option. scopeFor() requires a principal
// and throws on anything it does not recognise, because the dangerous failure mode
// is not a wrong filter — it is a MISSING one. A helper that returns "1=1" when it
// is confused will happily hand a partner the whole book, and it will look like it
// worked. So:
//
//   staff            → sees everything (they are fundhub)
//   partner          → sees ONLY clients whose partner_id equals their own
//   client/affiliate → not a book-level reader at all; asking is an error
//   anything else    → throws
//
// A partner with no partnerId throws too. An unscoped partner is the exact shape
// of the leak, and defaulting it to "see nothing" would hide a broken session
// instead of surfacing it.
//
// PARAMETERISED, NEVER INTERPOLATED. scopeFor returns { sql, params } with real
// placeholders, offset by whatever the caller has already bound. A uuid pasted
// into a string is how the second-worst bug gets in.

export const PRINCIPAL_KINDS = new Set(["staff", "partner", "client", "affiliate"]);

// Principals that read a BOOK of clients. client and affiliate read their own
// single record through their own surfaces, not through this predicate.
const BOOK_READERS = new Set(["staff", "partner"]);

/* scopeFor(principal, opts) → { sql, params, unrestricted }

   `sql` is a boolean expression ready to drop into a WHERE, written against
   `opts.alias` (default "c") which must be the clients table or something joined
   to it on client id.

   `startIndex` is the number of parameters the caller has already bound, so the
   placeholder numbering continues rather than colliding. */
export function scopeFor(principal, { alias = "c", startIndex = 0 } = {}) {
  if (!principal || typeof principal !== "object") {
    throw new Error("scopeFor: a principal is required — refusing to build an unscoped query");
  }

  const kind = String(principal.kind || "").trim().toLowerCase();
  if (!PRINCIPAL_KINDS.has(kind)) {
    throw new Error(
      `scopeFor: unknown principal kind "${principal.kind}". ` +
      `Refusing to guess — an unrecognised reader must not default to seeing everything.`
    );
  }
  if (!BOOK_READERS.has(kind)) {
    throw new Error(
      `scopeFor: a "${kind}" principal does not read the client book. ` +
      `Use its own scoped surface instead of filtering the whole table.`
    );
  }

  if (kind === "staff") {
    // fundhub staff see the whole book, direct and partner alike. Deliberate and
    // named, so it is a decision in the code rather than an absent filter.
    return { sql: "TRUE", params: [], unrestricted: true };
  }

  // kind === "partner"
  const partnerId = principal.partnerId || principal.partner_id || null;
  if (!partnerId) {
    throw new Error(
      "scopeFor: partner principal has no partnerId — refusing to build a query that " +
      "would return another partner's clients"
    );
  }

  const q = qualify(alias);
  return {
    sql: `${q}partner_id = $${startIndex + 1}`,
    params: [partnerId],
    unrestricted: false
  };
}

function qualify(alias) {
  if (alias === null || alias === "") return "";
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(alias))) {
    // An alias reaches the SQL string, so it is the one thing that cannot be a
    // parameter. Restrict it to an identifier rather than trusting the caller.
    throw new Error(`scopeFor: "${alias}" is not a valid table alias`);
  }
  return `${alias}.`;
}

/* where(principal, opts) — the convenience form: a full WHERE clause including
   any additional conditions the caller supplies, with numbering handled.

   where(p, { extra: ["c.done = false"], params: [] }) */
export function where(principal, { alias = "c", extra = [], params = [] } = {}) {
  const scope = scopeFor(principal, { alias, startIndex: params.length });
  const clauses = [scope.sql, ...extra].filter((c) => c && c !== "TRUE");
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params: [...params, ...scope.params]
  };
}

/* assertCanReadClient — the point-read guard. A partner fetching one client by id
   must be checked against the row, not against the id they asked for; otherwise
   guessing a uuid is enough. Returns the client row or throws.

   This is deliberately a THROW and not a null: a caller that forgets to branch on
   null renders someone else's client. */
export async function assertCanReadClient(db, principal, clientId) {
  if (!clientId) throw new Error("assertCanReadClient: clientId is required");
  const scope = scopeFor(principal, { alias: "c", startIndex: 1 });
  const { rows } = await db.query(
    `SELECT c.* FROM clients c WHERE c.id = $1 AND (${scope.sql}) LIMIT 1`,
    [clientId, ...scope.params]
  );
  if (!rows[0]) {
    // Deliberately indistinguishable from "does not exist". Telling a partner
    // that a client exists but is not theirs is itself a disclosure.
    const e = new Error("client not found");
    e.code = "NOT_FOUND";
    throw e;
  }
  return rows[0];
}

/* CREATIVE FACTORY TABLES. assertCanReadRow below writes a table name into SQL,
   which is the one thing that cannot be a parameter — so it is an allowlist
   rather than a validated string. A regex would accept `partners` or `accounts`
   and turn a point-read guard into an arbitrary-table read.

   Every table in the creative module carries partner_id and is listed here. If a
   new one is added to 045/046/047 and not added here, its point reads fail loudly
   instead of going unscoped. */
export const PARTNER_SCOPED_TABLES = new Set([
  // 045_creative_factory.sql
  "brand_kits", "brand_kit_sources", "creative_assets",
  "generation_jobs", "generation_job_assets",
  // 046_ad_platforms.sql
  "ad_platform_connections", "campaigns", "ad_sets", "ads",
  "ad_metrics_daily", "action_log", "spend_ceilings",
  "partner_onboarding_tasks", "partner_module_settings",
  "social_channels", "social_posts",
  // 047_creative_metering.sql
  "creative_usage_events"
]);

/* assertCanReadRow — the generic form of assertCanReadClient, for the creative
   module's tables. Same contract, and the same reasons behind it:

   THROWS, never returns null, because a caller that forgets to branch on null
   renders someone else's row.

   "not found" is INDISTINGUISHABLE from "not yours". Telling a partner that a
   campaign exists but belongs to someone else is itself a disclosure — they
   learn a competitor is running one.

   This is the second lock, not the only one: inside withPartnerScope() the RLS
   policy has already filtered the row out. Both run, so a point read is safe
   whether or not the caller remembered to open a scope. */
export async function assertCanReadRow(db, principal, table, id) {
  if (!id) throw new Error("assertCanReadRow: id is required");
  if (!PARTNER_SCOPED_TABLES.has(table)) {
    throw new Error(
      `assertCanReadRow: "${table}" is not a known partner-scoped table. ` +
      `Add it to PARTNER_SCOPED_TABLES rather than widening this check.`
    );
  }
  const scope = scopeFor(principal, { alias: "t", startIndex: 1 });
  const { rows } = await db.query(
    `SELECT t.* FROM ${table} t WHERE t.id = $1 AND (${scope.sql}) LIMIT 1`,
    [id, ...scope.params]
  );
  if (!rows[0]) {
    const e = new Error(`${table.replace(/s$/, "")} not found`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return rows[0];
}

/* clientIdsFor — the id set a principal may see. For callers that must filter a
   table which has client_id but is not joined to clients. */
export async function clientIdsFor(db, principal, { orgId } = {}) {
  const scope = scopeFor(principal, { alias: "c", startIndex: 1 });
  const { rows } = await db.query(
    `SELECT c.id FROM clients c WHERE c.org_id = $1 AND (${scope.sql})`,
    [orgId, ...scope.params]
  );
  return rows.map((r) => r.id);
}

/* partnerPrincipal / staffPrincipal — constructors, so call sites do not hand-roll
   an object shape and typo `partnerID`. */
export const partnerPrincipal = (partnerId) => ({ kind: "partner", partnerId });
export const staffPrincipal = (staffId = null, role = null) =>
  ({ kind: "staff", staffId, role });
