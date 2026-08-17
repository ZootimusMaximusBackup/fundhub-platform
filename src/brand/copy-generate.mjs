// Write unlocked funnel-section copy from brand tokens via Anthropic.
// Locked sections are never sent. The compliance screen is the control.

import { callModel, DEFAULT_MODEL } from "../agents/model.mjs";
import { screen } from "../compliance/screen.mjs";
import { isLockedSection } from "./templates.mjs";
import { assertSuiteEnabled, assertUnderCap, recordUsage } from "./meter.mjs";

const SYSTEM = [
  "You write short website copy for a regulated funding-review firm.",
  "Return ONLY a JSON object. No markdown.",
  "Hard rules:",
  "- Never guarantee approval, a funding amount, a credit score change, or a timeline.",
  "- Never say the reader is approved, rich, broke, or distressed.",
  "- Never invent testimonials or typical results.",
  "- The company is not a direct lender. Lenders decide.",
  "- Use 'up to' with conditions if you name any amount."
].join("\n");

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function applyFields(section, parsed) {
  const next = { ...section };
  for (const key of ["headline", "sub", "text", "label"]) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) {
      next[key] = parsed[key].trim().slice(0, 800);
    }
  }
  return next;
}

function screenText(section) {
  return [section.headline, section.sub, section.text, section.label]
    .filter(Boolean)
    .join("\n");
}

export async function generateSectionCopy({
  db, orgId, partnerId, page, brand, sectionId = null, env, fetchImpl
} = {}) {
  await assertSuiteEnabled(db, partnerId);
  await assertUnderCap(db, partnerId);

  const body = typeof page.body_json === "string"
    ? JSON.parse(page.body_json)
    : (page.body_json || {});
  const sections = Array.isArray(body.sections) ? body.sections.map((s, i) => ({
    ...s,
    id: s.id || `s${i}`
  })) : [];

  const targets = sectionId
    ? sections.filter((s) => s.id === sectionId)
    : sections.filter((s) => !isLockedSection(s));

  if (sectionId && !targets.length) {
    const e = new Error("section not found");
    e.code = "NOT_FOUND";
    throw e;
  }
  if (targets.some(isLockedSection)) {
    const e = new Error("that block is locked");
    e.code = "locked_section";
    throw e;
  }

  const name = brand?.entity_name || brand?.wordmark || page.title || "the brand";
  const voice = brand?.voice || "plain";
  const results = [];

  for (const section of targets) {
    await assertUnderCap(db, partnerId);
    const user = [
      `Brand name: ${name}`,
      `Voice: ${voice}`,
      `Ink: ${brand?.ink || ""}; paper: ${brand?.paper || ""}; display face: ${brand?.display_face || ""}`,
      `Funnel: ${page.funnel_key || body.template || ""}`,
      `Section id: ${section.id}; type: ${section.type}`,
      `Current JSON: ${JSON.stringify({
        headline: section.headline, sub: section.sub, text: section.text, label: section.label
      })}`,
      "Rewrite the unlocked fields. Keep the same JSON keys. Stay under 40 words per field."
    ].join("\n");

    const model = await callModel({
      system: SYSTEM,
      user,
      env,
      fetchImpl,
      model: DEFAULT_MODEL,
      maxTokens: 800
    });

    await recordUsage(db, {
      orgId,
      partnerId,
      purpose: "copy",
      sourceId: page.id,
      inputTokens: model.usage?.input_tokens,
      outputTokens: model.usage?.output_tokens,
      model: model.request?.model
    });

    if (model.mode === "shadow" || model.error || !model.text) {
      const e = new Error(model.error || "the writing robot is not set on this site");
      e.code = "no_model";
      throw e;
    }

    const parsed = parseJsonObject(model.text);
    if (!parsed) {
      const e = new Error("the writer returned copy we could not use");
      e.code = "bad_model";
      throw e;
    }

    const next = applyFields(section, parsed);
    const verdict = await screen(db, {
      orgId,
      partnerId,
      subjectId: page.id,
      kind: "creative_asset",
      offerType: "funding",
      platform: null,
      text: screenText(next),
      aiGenerated: true,
      approveBeforeLaunch: true
    });

    if (verdict.state === "blocked") {
      results.push({
        section_id: section.id,
        state: "blocked",
        reasons: verdict.reasons,
        section
      });
      continue;
    }

    await db.query(
      `INSERT INTO partner_page_section_versions
         (org_id, partner_id, page_id, section_id, section_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [orgId, partnerId, page.id, section.id, JSON.stringify(section)]
    );

    const idx = sections.findIndex((s) => s.id === section.id);
    if (idx >= 0) sections[idx] = next;
    results.push({ section_id: section.id, state: verdict.state, section: next });
  }

  const nextBody = { ...body, sections };
  await db.query(
    `UPDATE partner_pages SET body_json = $2::jsonb, updated_at = now() WHERE id = $1`,
    [page.id, JSON.stringify(nextBody)]
  );

  return { body: nextBody, results };
}

export async function listSectionHistory(db, { pageId, sectionId, limit = 20 }) {
  const r = await db.query(
    `SELECT id, section_id, section_json, created_at
       FROM partner_page_section_versions
      WHERE page_id = $1 AND ($2::text IS NULL OR section_id = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [pageId, sectionId || null, Math.min(50, Math.max(1, Number(limit) || 20))]
  );
  return r.rows;
}

export async function restoreSection({ db, orgId, partnerId, page, versionId }) {
  await assertSuiteEnabled(db, partnerId);
  const ver = (await db.query(
    `SELECT * FROM partner_page_section_versions
      WHERE id = $1 AND page_id = $2 AND partner_id = $3`,
    [versionId, page.id, partnerId]
  )).rows[0];
  if (!ver) {
    const e = new Error("version not found");
    e.code = "NOT_FOUND";
    throw e;
  }
  if (isLockedSection(ver.section_json)) {
    const e = new Error("that block is locked");
    e.code = "locked_section";
    throw e;
  }
  const body = typeof page.body_json === "string"
    ? JSON.parse(page.body_json)
    : (page.body_json || {});
  const sections = Array.isArray(body.sections) ? body.sections.slice() : [];
  const idx = sections.findIndex((s) => s.id === ver.section_id);
  const restored = ver.section_json;
  if (idx >= 0) {
    await db.query(
      `INSERT INTO partner_page_section_versions
         (org_id, partner_id, page_id, section_id, section_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [orgId, partnerId, page.id, ver.section_id, JSON.stringify(sections[idx])]
    );
    sections[idx] = restored;
  } else {
    sections.push(restored);
  }
  const nextBody = { ...body, sections };
  await db.query(
    `UPDATE partner_pages SET body_json = $2::jsonb, updated_at = now() WHERE id = $1`,
    [page.id, JSON.stringify(nextBody)]
  );
  return { body: nextBody, section: restored };
}

export default { generateSectionCopy, listSectionHistory, restoreSection };
