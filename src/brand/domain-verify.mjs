// Domain verification token helpers for partner custom domains.
// TXT record at _fundhub.<domain> must equal siteVerifyToken(partnerId).

export function siteVerifyToken(partnerId) {
  return `fundhub-site-verify=${partnerId}`;
}

export function expectedTxtHost(domain) {
  const host = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  return `_fundhub.${host}`;
}

/**
 * checkDomainTxt(domain, expected, { resolveTxt }) → { ok, records, host }
 */
export async function checkDomainTxt(domain, expected, { resolveTxt } = {}) {
  const host = expectedTxtHost(domain);
  if (!host || !expected) return { ok: false, host, records: [], error: "missing_domain_or_token" };
  const resolver = resolveTxt || (await import("node:dns/promises")).resolveTxt;
  let records;
  try {
    records = await resolver(host);
  } catch (err) {
    return {
      ok: false,
      host,
      records: [],
      error: String(err?.code || err?.message || err).slice(0, 200)
    };
  }
  const flat = (records || []).map((r) => (Array.isArray(r) ? r.join("") : String(r)));
  const ok = flat.some((v) => v.includes(expected));
  return { ok, host, records: flat };
}

export default { siteVerifyToken, expectedTxtHost, checkDomainTxt };
