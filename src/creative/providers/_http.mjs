// Shared plumbing for provider adapters: the HTTP call, key loading, and the
// asset shape they all return.
//
// THE KEY NEVER APPEARS IN AN ERROR. requireKey throws naming the ENV VAR, and
// callProvider scrubs anything key-shaped out of a failure message before it
// propagates. Provider errors end up in generation_jobs.error, which is
// partner-readable through the job-status endpoint — so a leaked key there would
// be handing a partner fundhub's vendor credentials.
//
// INJECTABLE fetch. ctx.fetch overrides the global, which is how the tests drive
// every provider without a network.

/* requireKey — read a Fundhub-level provider key from env.

   Fundhub-level, never partner-level: partners connect their own AD accounts by
   OAuth (UNIT 2), but generation runs on our vendor accounts and our bill. A
   partner-supplied generation key would be a second, unaudited spend path. */
export function requireKey(envVar, ctx = {}) {
  const key = ctx.env?.[envVar] ?? process.env[envVar];
  if (!key) {
    throw new Error(
      `${envVar} is not set — the generation provider cannot run. ` +
      `Provider keys are Fundhub-level and live in env.`
    );
  }
  return key;
}

/* callProvider — one HTTP call, with the error hygiene every adapter needs.

   Returns the parsed body. Throws on any non-2xx, because a provider error must
   degrade the job to queued for retry rather than resolve as an empty result. */
export async function callProvider({ url, key, body, ctx = {}, method = "POST" }) {
  const doFetch = ctx.fetch || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("no fetch available");

  let res;
  try {
    res = await doFetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    // A network failure is a retryable outage, not a permanent error.
    const e = new Error(`provider unreachable: ${scrub(String(err?.message || err), key)}`);
    e.retryable = true;
    throw e;
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const e = new Error(
      `provider returned ${res.status}: ${scrub(text, key).slice(0, 300)}`
    );
    // 429 and 5xx are transient; 4xx generally is not, and retrying a malformed
    // request just burns the per-partner concurrency slot.
    e.retryable = res.status === 429 || res.status >= 500;
    e.status = res.status;
    throw e;
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("provider returned a body that is not JSON");
  }
}

/* scrub — remove the key from anything about to become an error message.

   Belt and braces: providers sometimes echo the Authorization header back in an
   error body, and that body lands in a partner-readable column. */
export function scrub(text, key) {
  let out = String(text ?? "");
  if (key) out = out.split(key).join("[redacted]");
  // Anything that looks like a bearer token or a long opaque secret, whether or
  // not it is the key we happen to hold.
  return out
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(sk|pk|key|token|secret)[-_][A-Za-z0-9._\-]{12,}\b/gi, "[redacted]");
}

/* assetFrom — the one asset shape every provider returns.

   storageKey is deliberately NOT set here. It is assigned by the service, which
   knows the partner id and can namespace it `partners/{partner_id}/...` — the
   namespace the CHECK constraint in 045 enforces. A provider that invented its
   own key would eventually invent one outside its partner's prefix. */
export function assetFrom({
  kind, format, provider, providerAssetId = null, sourceUrl = null,
  durationSec = null, text = null, aiGenerated = true, syntheticPerformer = false,
  parentAssetId = null, meta = {}
}) {
  return {
    kind, format, provider,
    provider_asset_id: providerAssetId,
    source_url: sourceUrl,
    duration_sec: durationSec,
    text,
    ai_generated: aiGenerated,
    synthetic_performer: syntheticPerformer,
    parent_asset_id: parentAssetId,
    meta
  };
}
