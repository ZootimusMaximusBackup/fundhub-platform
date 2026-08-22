/** Discover institution domain + business credit card apply URL. */

const APPLY_PATHS = [
  "/business/credit-cards",
  "/small-business/credit-cards",
  "/business/business-credit-cards",
  "/business/cards/credit-cards",
  "/business-banking/credit-cards",
  "/business/borrow/business-credit-cards",
  "/business-banking/business-credit-cards",
  "/small-business/banking/credit-cards",
  "/business/credit-card",
  "/business/banking/credit-cards"
];

/**
 * @param {string} bankName
 * @returns {Promise<string|null>}
 */
export async function suggestDomain(bankName) {
  const q = String(bankName || "").replace(/\s*\([^)]*\)/g, "").trim();
  if (!q || q.length < 3) return null;
  try {
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`,
      { headers: { "user-agent": "FundhubLenderAudit/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    return hit?.domain || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} domain
 * @returns {Promise<string|null>}
 */
export async function probeApplyUrl(domain) {
  const host = domain.replace(/^www\./, "");
  const bases = [`https://www.${host}`, `https://${host}`];
  for (const base of bases) {
    for (const p of APPLY_PATHS) {
      const url = `${base}${p}`;
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: { "user-agent": "FundhubLenderAudit/1.0", accept: "text/html" }
        });
        if (res.status >= 200 && res.status < 400) {
          const text = (await res.text()).slice(0, 6000).toLowerCase();
          if (/credit.?card|apply|business.?card|learn.?more/i.test(text) || /credit.?card|apply/i.test(url)) {
            return res.url || url;
          }
        }
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/**
 * @param {string} bankName
 */
export async function discoverApplyUrl(bankName) {
  const domain = await suggestDomain(bankName);
  if (!domain) return { domain: null, application_url: null };
  const application_url = await probeApplyUrl(domain);
  return { domain, application_url };
}
