/* Monitor inbox address — bank replies go here, then Mailgun webhook → F-11.
   Uses the Mailgun send domain already in the house (mg.fundhub.ai).
   Does not invent @fundhub.ai DNS. That host still sits on Cloudflare. */

export function monitorInboxDomain(env = process.env) {
  const named = String(env.MAILGUN_SEND_DOMAIN || env.MAILGUN_INBOUND_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  return named || "mg.fundhub.ai";
}

export function mintMonitorAddress(clientId, env = process.env) {
  const id = String(clientId || "").trim();
  if (!id) return null;
  return `monitor+${id}@${monitorInboxDomain(env)}`;
}
