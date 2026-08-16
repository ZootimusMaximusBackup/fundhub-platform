// Company login emails. This is a login name, not a mailbox.
// A real inbox is a later add-on (Google Workspace costs money per seat).

export const COMPANY_EMAIL_DOMAIN = "fundhub.ai";

const ROLE_KEYS = {
  owner: "owner",
  admin: "admin",
  closer: "closer",
  funding_advisor: "funding_advisor",
  inquiry_specialist: "inquiry_specialist",
  setter: "setter",
  sales_manager: "sales_manager"
};

export function staffRoleKey(label) {
  const raw = String(label || "").trim().toLowerCase().replace(/\s+/g, "_");
  return ROLE_KEYS[raw] || null;
}

function slugPart(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

// "Sam Rivera" → sam.rivera@fundhub.ai
// If that login is taken → sam.rivera2@fundhub.ai, then 3, …
export function suggestCompanyEmail(name, taken = []) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const first = slugPart(parts[0] || "");
  const last = slugPart(parts.slice(1).join(" ") || "");
  const base = [first, last].filter(Boolean).join(".") || "staff";
  const used = new Set(
    (taken || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
  );
  let n = 0;
  for (;;) {
    const local = n === 0 ? base : base + String(n + 1);
    const email = `${local}@${COMPANY_EMAIL_DOMAIN}`;
    if (!used.has(email)) return email;
    n += 1;
    if (n > 99) return `${base}.${Date.now()}@${COMPANY_EMAIL_DOMAIN}`;
  }
}
