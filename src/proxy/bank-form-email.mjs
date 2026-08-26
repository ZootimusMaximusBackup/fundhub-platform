/* Bank form email — what the bank sees on Apply.
   Never put a Fundhub address (including monitor+) on the bank form. */

const FUNDHUB_HOST = /@([a-z0-9-]+\.)?fundhub\.ai$/i;

export function isFundhubAddress(email) {
  return FUNDHUB_HOST.test(String(email || "").trim());
}

/**
 * Pick the email staff should type on the bank's page.
 * Empty + warning when the file has no client email or only a Fundhub address.
 */
export function pickBankFormEmail(client = {}) {
  const email = String(client.email || "").trim();
  if (!email) {
    return {
      email: "",
      warning: "No client email on the file. Type the client's own email on the bank form — not a fundhub.ai address."
    };
  }
  if (isFundhubAddress(email)) {
    return {
      email: "",
      warning: "The file email is a Fundhub address. Do not put that on the bank form. Type the client's own email."
    };
  }
  return { email, warning: null };
}
