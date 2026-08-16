// Gate: does this client currently authorize Fundhub to PREPARE dispute
// letters and complaint drafts?
//
// Wraps hasValidConsent for kind `dispute_authorization`. Fail-closed: a
// missing org, client, or row is false. Does not mail or file anything.
// Dated/live complaint packs must pass this. DIY undated templates may still
// generate with a "sign the declaration before filing" cover.

import { hasValidConsent } from "../consent/index.mjs";

export async function hasDisputeAuthorization(db, { orgId, clientId } = {}) {
  return hasValidConsent(db, { orgId, clientId, kind: "dispute_authorization" });
}
