/** HTTP verify lender application URLs. */

const APPLY_HINTS = /apply|application|credit.?card|business.?card|learnmore|elancard|fnbo|landing/i;
const BAD_HINTS = /404|not found|page unavailable|access denied/i;

/**
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function verifyApplicationUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20000;
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, status: 0, finalUrl: url, reason: "invalid_url" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "FundhubLenderAudit/1.0 (+https://fundhub.ai)",
        accept: "text/html,application/xhtml+xml"
      }
    });
    const finalUrl = res.url || url;
    const status = res.status;
    let bodySample = "";
    try {
      const text = await res.text();
      bodySample = text.slice(0, 8000).toLowerCase();
    } catch {
      bodySample = "";
    }

    if (status >= 400 && status !== 403) {
      return { ok: false, status, finalUrl, reason: `http_${status}` };
    }
    if (BAD_HINTS.test(bodySample)) {
      return { ok: false, status, finalUrl, reason: "error_page_content" };
    }
    const host = new URL(finalUrl).hostname;
    const genericPortal = /creditcardlearnmore\.com|commonsenselenders\.com|elancard\.com|mycommunitycc\.com/i.test(host);
    if (!genericPortal && !APPLY_HINTS.test(bodySample) && !APPLY_HINTS.test(finalUrl)) {
      return { ok: false, status, finalUrl, reason: "not_apply_page" };
    }
    return { ok: true, status, finalUrl, reason: "verified" };
  } catch (e) {
    const reason = e?.name === "AbortError" ? "timeout" : (e?.message || "fetch_failed");
    return { ok: false, status: 0, finalUrl: url, reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick best URL from candidates (prefer verified apply pages).
 * @param {string[]} urls
 */
export async function pickBestUrl(urls) {
  const uniq = [...new Set(urls.filter(Boolean))];
  if (!uniq.length) return null;
  for (const u of uniq) {
    const v = await verifyApplicationUrl(u);
    if (v.ok) return { url: v.finalUrl || u, verify: v };
  }
  const first = uniq[0];
  return { url: first, verify: await verifyApplicationUrl(first) };
}
