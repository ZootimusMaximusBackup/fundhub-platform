// Shared HTTP for the ad platform adapters.
//
// THE PLATFORM'S OWN MESSAGE SURVIVES. Every error carries `platformMessage`
// holding what the platform actually said, extracted from whichever envelope it
// used. That string goes into last_error and onto the dashboard, because a policy
// rejection reworded by us is a policy rejection the partner cannot act on — and
// "campaign creation failed" is exactly that rewording.
//
// THE TOKEN NEVER SURVIVES. It is scrubbed from every message before it can reach
// last_error, which the read APIs project.

/* callPlatform → parsed body, or throws an Error carrying:
     platformMessage — the platform's own words
     platformCode    — its error code, when it gives one
     retryable       — rate limits and 5xx
     status          — the HTTP status */
export async function callPlatform({ url, token, body, ctx = {}, method = "POST" }) {
  const doFetch = ctx.fetch || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("no fetch available");

  let res;
  try {
    res = await doFetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    const e = new Error(`platform unreachable: ${scrub(String(err?.message || err), token)}`);
    e.platformMessage = "The platform could not be reached.";
    e.retryable = true;
    throw e;
  }

  const text = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* keep the raw text */ }

  if (!res.ok) {
    const { message, code, subcode } = extractError(parsed, text);
    const e = new Error(scrub(`platform ${res.status}: ${message}`, token));
    // The verbatim message, for last_error and the dashboard.
    e.platformMessage = scrub(message, token);
    e.platformCode = code ?? null;
    e.platformSubcode = subcode ?? null;
    e.status = res.status;
    // Meta uses 613 and 17 for throttling, TikTok 40100. 4xx otherwise is a real
    // rejection and retrying it just repeats the same failure.
    e.retryable = res.status === 429 || res.status >= 500 ||
                  code === 613 || code === 17 || code === 40100;
    throw e;
  }

  // TikTok returns 200 with a non-zero `code` on failure — an HTTP-status-only
  // check would read a policy rejection as a success.
  if (parsed && typeof parsed.code === "number" && parsed.code !== 0) {
    const e = new Error(scrub(`platform error ${parsed.code}: ${parsed.message}`, token));
    e.platformMessage = scrub(parsed.message || "unknown platform error", token);
    e.platformCode = parsed.code;
    e.retryable = parsed.code === 40100;
    throw e;
  }

  return parsed ?? {};
}

/* extractError — pull the human-readable message out of whichever envelope the
   platform used. Falls back to the raw body rather than to a generic string:
   an unrecognised shape is still more useful to a partner than "request failed". */
export function extractError(parsed, rawText) {
  if (parsed?.error) {
    return {
      message: parsed.error.error_user_msg || parsed.error.message || JSON.stringify(parsed.error),
      code: parsed.error.code,
      subcode: parsed.error.error_subcode
    };
  }
  if (parsed?.message) return { message: parsed.message, code: parsed.code };
  return { message: String(rawText || "unknown platform error").slice(0, 1000) };
}

export function scrub(text, token) {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s"']+/gi, "access_token=[redacted]");
}
