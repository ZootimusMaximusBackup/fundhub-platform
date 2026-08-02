// Pull client_id from a recording filename or parent folder name when present.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const CLIENT_KEY_RE = /(?:client[_-]?id|client)[:_\-\s=]*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

/**
 * @returns {{ clientId: string|null, unattached: boolean, source: string|null }}
 */
export function sniffClientId({ name, parentNames = [] } = {}) {
  const haystacks = [String(name || ""), ...parentNames.map((n) => String(n || ""))];
  for (const h of haystacks) {
    const keyed = h.match(CLIENT_KEY_RE);
    if (keyed) return { clientId: keyed[1].toLowerCase(), unattached: false, source: "keyed" };
  }
  for (const h of haystacks) {
    const bare = h.match(UUID_RE);
    if (bare) return { clientId: bare[0].toLowerCase(), unattached: false, source: "uuid" };
  }
  return { clientId: null, unattached: true, source: null };
}
