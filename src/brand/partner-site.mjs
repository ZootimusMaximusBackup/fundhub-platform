// Render a published partner_pages row as HTML (no auth). Used by the
// partner-site Netlify function for /sites/:partnerId/:slug and custom domains.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function renderPartnerPageHtml({ page, brand }) {
  const body = typeof page.body_json === "string"
    ? JSON.parse(page.body_json)
    : (page.body_json || {});
  const sections = Array.isArray(body.sections) ? body.sections : [];
  const ink = brand?.ink || "#0a0a0a";
  const paper = brand?.paper || "#f7f4ef";
  const display = brand?.display_face || "Fraunces";
  const mono = brand?.mono_face || "IBM Plex Mono";
  const name = brand?.entity_name || brand?.wordmark || page.title || "Partner";
  const fonts = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(display)}:wght@500;700&family=${encodeURIComponent(mono)}:wght@400;500&display=swap`;

  const ramp = Array.isArray(brand?.ramp) ? brand.ramp.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)) : [];
  const spectrum = ramp.length === 6 ? ramp.join(",") : "";
  const logo = brand?.wordmark_url && /^https:|^data:image\//i.test(brand.wordmark_url)
    ? `<img class="logo" src="${esc(brand.wordmark_url)}" alt="${esc(name)}">`
    : `<div class="wm">${esc(name)}</div>`;

  const sectionHtml = sections.map((s) => {
    if (s.type === "hero") {
      return `<section class="hero"><h1>${esc(s.headline || page.title)}</h1>` +
        `<p>${esc(s.sub || "")}</p></section>`;
    }
    if (s.type === "cta") {
      return `<p><a class="cta" href="${esc(s.href || "#apply")}">${esc(s.label || "Continue")}</a></p>`;
    }
    if (s.type === "legal") {
      return `<section class="legal-block" data-locked="true"><h2>${esc(s.headline || "")}</h2>` +
        `<p>${esc(s.text || "")}</p></section>`;
    }
    return `<section class="block"><h2>${esc(s.headline || "")}</h2>` +
      `<p>${esc(s.text || s.sub || "")}</p></section>`;
  }).join("\n");

  const legalFallback = sections.some((s) => s.type === "legal")
    ? ""
    : `<div class="legal">© ${new Date().getUTCFullYear()} ${esc(name)}. Not a direct lender.
      Financing decisions are made by funding partners.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(page.title)}</title>
  <link rel="stylesheet" href="${fonts}">
  <style>
    :root { --ink:${esc(ink)}; --paper:${esc(paper)};${spectrum ? ` --spectrum:linear-gradient(90deg,${spectrum});` : ""} }
    * { box-sizing: border-box; }
    body { margin:0; font-family:${JSON.stringify(display)}, Georgia, serif;
      background:var(--paper); color:var(--ink); line-height:1.45; }
    .wrap { max-width:720px; margin:0 auto; padding:48px 24px 80px; }
    .wm { font-family:${JSON.stringify(mono)}, monospace; font-size:12px;
      letter-spacing:.08em; text-transform:uppercase; opacity:.7; margin-bottom:28px; }
    .logo { height:40px; width:auto; max-width:220px; margin-bottom:28px; display:block; }
    h1 { font-size:clamp(2rem,5vw,3.2rem); font-weight:700; line-height:1.1; margin:0 0 16px; }
    h2 { font-size:1.25rem; margin:28px 0 8px; }
    .hero p { font-size:1.15rem; opacity:.85; margin:0 0 28px; }
    .cta { display:inline-block; background:var(--ink); color:var(--paper);
      text-decoration:none; padding:14px 22px; font-family:${JSON.stringify(mono)}, monospace;
      font-size:13px; letter-spacing:.04em; }
    .legal, .legal-block { margin-top:48px; font-size:12px; opacity:.7;
      font-family:${JSON.stringify(mono)}, monospace; }
    .hair { height:2px; background:var(--spectrum, var(--ink)); border-radius:1px; margin:24px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    ${logo}
    <div class="hair"></div>
    ${sectionHtml || `<section class="hero"><h1>${esc(page.title)}</h1></section>`}
    ${legalFallback}
  </div>
</body>
</html>`;
}

/**
 * loadPublishedPage(db, { partnerId, slug, host }) → { page, brand } | null
 */
export async function loadPublishedPage(db, { partnerId = null, slug = null, host = null } = {}) {
  if (host) {
    const h = String(host).toLowerCase().split(":")[0];
    const brand = (await db.query(
      `SELECT b.*, p.id AS partner_id
         FROM partner_brand b
         JOIN partners p ON p.id = b.partner_id
        WHERE b.domain_verified = true
          AND lower(b.domain) = $1`,
      [h]
    )).rows[0];
    if (!brand) return null;
    const pageSlug = slug && slug !== "" ? slug : "apply";
    const page = (await db.query(
      `SELECT * FROM partner_pages
        WHERE partner_id = $1 AND slug = $2 AND status = 'published'`,
      [brand.partner_id, pageSlug]
    )).rows[0];
    if (!page) return null;
    return { page, brand };
  }

  if (!partnerId || !slug) return null;
  const page = (await db.query(
    `SELECT * FROM partner_pages
      WHERE partner_id = $1 AND slug = $2 AND status = 'published'`,
    [partnerId, slug]
  )).rows[0];
  if (!page) return null;
  const brand = (await db.query(
    `SELECT * FROM partner_brand WHERE partner_id = $1`,
    [partnerId]
  )).rows[0] || {};
  return { page, brand };
}

export default { renderPartnerPageHtml, loadPublishedPage };
