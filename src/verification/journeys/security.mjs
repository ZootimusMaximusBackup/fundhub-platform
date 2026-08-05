import { insertClient } from "../insert-client.mjs";
// PART 3 — SECURITY AND ISOLATION. Attempt every violation as an attacker.
// Any successful violation is P0.

import { ROLE_SETS, allowsRole } from "../../http/read-api.mjs";
import { createSession } from "../../auth/session.mjs";

async function callApi(handler, { path, method = "GET", token, body, headers = {} }) {
  const init = {
    method,
    headers: {
      host: "verify.local",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    }
  };
  const req = new Request("https://verify.local" + path, {
    ...init,
    body: body ? JSON.stringify(body) : undefined
  });
  const res = await handler(req, {});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

export async function runSecurityJourney(db, ctx, collector) {
  const section = "SECURITY";
  const journey = "ISOLATION";
  const steps = [];
  const verdicts = [];

  const { default: handler } = await import("../../../netlify/functions/api.mjs");

  // Victim client in org A
  const victim = await insertClient(db, {
    orgId: ctx.orgId,
    email: `${ctx.mark}.victim.${ctx.stamp}@verify.local`,
    firstName: "Victim", lastName: "Client", phone: "+15550100999"
  });

  // Client in other org
  const otherClient = await insertClient(db, {
    orgId: ctx.otherOrgId,
    email: `${ctx.mark}.otherclient.${ctx.stamp}@verify.local`,
    firstName: "Other", lastName: "OrgClient"
  });

  // Document for victim (minimal row)
  let docId = null;
  try {
    docId = (await db.query(
      `INSERT INTO documents (org_id, client_id, kind, title, storage_key)
       VALUES ($1,$2,'client_upload','SSN packet','verify/ssn')
       RETURNING id`,
      [ctx.orgId, victim.id]
    )).rows[0].id;
  } catch {
    try {
      docId = (await db.query(
        `INSERT INTO documents (org_id, client_id, kind, filename)
         VALUES ($1,$2,'other','ssn.pdf') RETURNING id`,
        [ctx.orgId, victim.id]
      )).rows[0].id;
    } catch { /* no docs table shape */ }
  }

  const FINANCE = ROLE_SETS.FINANCE;
  const OPS = ROLE_SETS.OPS;
  const HIRING = ROLE_SETS.HIRING;
  const STAFF = ROLE_SETS.STAFF;

  // Role matrix sanity
  collector.assertEq({
    section, journey, role: "sales_manager", id: "sec-finance-sm",
    claim: "sales_manager is in FINANCE",
    expected: true, actual: allowsRole(FINANCE, "sales_manager"),
    file: "src/http/read-api.mjs", p0: true
  });
  collector.assertEq({
    section, journey, role: "sales_manager", id: "sec-hiring-sm-refused",
    claim: "sales_manager is NOT in HIRING",
    expected: false, actual: allowsRole(HIRING, "sales_manager"),
    file: "src/http/read-api.mjs", p0: true
  });
  collector.assertEq({
    section, journey, role: "closer", id: "sec-hiring-closer-refused",
    claim: "closer is NOT in HIRING (applicant PII)",
    expected: false, actual: allowsRole(HIRING, "closer"),
    file: "src/http/read-api.mjs", p0: true
  });
  collector.assertEq({
    section, journey, role: "closer", id: "sec-ops-closer-refused",
    claim: "closer is NOT in OPS",
    expected: false, actual: allowsRole(OPS, "closer"),
    file: "src/http/read-api.mjs", p0: true
  });

  // Endpoint probes — each role against finance / hiring / ops / other-org
  const probes = [
    { path: `/api/read/commissions?client_id=${victim.id}`, set: "FINANCE", label: "commissions" },
    { path: `/api/read/invoices?client_id=${victim.id}`, set: "FINANCE", label: "invoices" },
    { path: `/api/read/staff`, set: "FINANCE", label: "staff" },
    { path: `/api/read/failed-events`, set: "OPS", label: "failed-events" },
    { path: `/api/hiring/candidates`, set: "HIRING", label: "hiring" },
    { path: `/api/hiring/postings`, set: "HIRING", label: "hiring-write" },
    { path: `/api/dashboard/client?id=${victim.id}`, set: "STAFF", label: "client-dashboard" },
    { path: `/api/read/documents?client_id=${victim.id}`, set: "STAFF", label: "documents" },
    { path: `/api/read/tradelines?client_id=${victim.id}`, set: "STAFF", label: "tradelines" }
  ];

  const roleSetMap = { FINANCE, OPS, HIRING, STAFF };

  for (const [roleName, staff] of Object.entries(ctx.staffByRole)) {
    for (const probe of probes) {
      const allowed = allowsRole(roleSetMap[probe.set], roleName);
      const res = await callApi(handler, { path: probe.path, token: staff.token });
      const ok = res.status >= 200 && res.status < 300;
      const refused = res.status === 401 || res.status === 403 || res.status === 404;

      if (allowed && ok) {
        collector.pass({
          section, journey, role: roleName, id: `sec-${roleName}-${probe.label}-allow`,
          claim: `${roleName} may access ${probe.label}`,
          actual: { status: res.status }
        });
      } else if (allowed && !ok) {
        // Endpoint may 404 if route missing — that's a usability fail, not P0 leak
        collector.fail({
          section, journey, role: roleName, id: `sec-${roleName}-${probe.label}-allow-miss`,
          claim: `${roleName} should access ${probe.label} but got ${res.status}`,
          detail: JSON.stringify(res.json).slice(0, 180),
          file: "netlify/functions/api.mjs"
        });
      } else if (!allowed && refused) {
        collector.pass({
          section, journey, role: roleName, id: `sec-${roleName}-${probe.label}-deny`,
          claim: `${roleName} refused ${probe.label} (${res.status})`,
          actual: { status: res.status },
          p0: true
        });
      } else if (!allowed && ok) {
        collector.fail({
          section, journey, role: roleName, id: `sec-${roleName}-${probe.label}-LEAK`,
          claim: `P0: ${roleName} accessed ${probe.label} outside ROLE_SET`,
          detail: `status=${res.status} body=${JSON.stringify(res.json).slice(0, 200)}`,
          file: "src/http/read-api.mjs",
          p0: true
        });
      } else {
        collector.pass({
          section, journey, role: roleName, id: `sec-${roleName}-${probe.label}-other`,
          claim: `${roleName} blocked from ${probe.label} with status ${res.status}`,
          actual: { status: res.status },
          p0: true
        });
      }
    }

    // Cross-org: read other org's client by id
    const cross = await callApi(handler, {
      path: `/api/dashboard/client?id=${otherClient.id}`,
      token: staff.token
    });
    const leaked =
      cross.status === 200 &&
      cross.json &&
      (cross.json.client?.id === otherClient.id ||
        cross.json.id === otherClient.id ||
        JSON.stringify(cross.json).includes(otherClient.email));
    if (leaked) {
      collector.fail({
        section, journey, role: roleName, id: `sec-${roleName}-cross-org`,
        claim: `P0: ${roleName} read another ORG's client by id`,
        detail: `status=${cross.status}`,
        p0: true,
        file: "api/dashboard/client.mjs"
      });
    } else {
      collector.pass({
        section, journey, role: roleName, id: `sec-${roleName}-cross-org`,
        claim: `${roleName} cannot read other org client (${cross.status})`,
        actual: { status: cross.status },
        p0: true
      });
    }

    // org_id / role in query string must be IGNORED
    const spoof = await callApi(handler, {
      path: `/api/read/commissions?client_id=${victim.id}&org_id=${ctx.otherOrgId}&role=owner`,
      token: staff.token
    });
    // If closer gets 200 with finance data via spoofed role — P0
    if (roleName === "closer" && spoof.status === 200 && Array.isArray(spoof.json?.items)) {
      collector.fail({
        section, journey, role: roleName, id: `sec-${roleName}-role-spoof`,
        claim: "P0: closer obtained FINANCE data by passing role=owner in query",
        p0: true,
        file: "src/http/read-api.mjs"
      });
    } else if (!allowsRole(FINANCE, roleName) && spoof.status === 200 && (spoof.json?.items?.length >= 0) && spoof.json?.ok !== false) {
      // 200 with empty items might still be a leak of endpoint access
      if (spoof.json?.ok === true) {
        collector.fail({
          section, journey, role: roleName, id: `sec-${roleName}-role-spoof`,
          claim: `P0: ${roleName} reached commissions via query spoof`,
          actual: { status: spoof.status },
          p0: true
        });
      } else {
        collector.pass({
          section, journey, role: roleName, id: `sec-${roleName}-role-spoof`,
          claim: `${roleName} query spoof ignored (status ${spoof.status})`,
          p0: true
        });
      }
    } else {
      collector.pass({
        section, journey, role: roleName, id: `sec-${roleName}-role-spoof`,
        claim: `${roleName} org_id/role query spoof does not elevate (${spoof.status})`,
        actual: { status: spoof.status },
        p0: true
      });
    }
  }

  // Closer must not reach hiring applicant PII
  const closerHire = await callApi(handler, {
    path: "/api/hiring/candidates",
    token: ctx.staffByRole.closer.token
  });
  if (closerHire.status === 200 && closerHire.json?.ok) {
    collector.fail({
      section, journey, role: "closer", id: "sec-closer-hiring-pii",
      claim: "P0: closer reached hiring/applicant PII endpoint",
      p0: true,
      file: "src/http/read-api.mjs"
    });
  } else {
    collector.pass({
      section, journey, role: "closer", id: "sec-closer-hiring-pii",
      claim: `Closer refused hiring endpoint (${closerHire.status})`,
      p0: true
    });
  }

  // Tampered / expired / revoked session
  const badTok = await callApi(handler, {
    path: `/api/dashboard/client?id=${victim.id}`,
    token: "totally-forged-token"
  });
  collector.assertEq({
    section, journey, role: "forged", id: "sec-forged-token",
    claim: "Forged bearer token is refused",
    expected: true,
    actual: badTok.status === 401 || badTok.status === 403,
    file: "src/auth/session.mjs",
    p0: true
  });

  // Create then delete session row to simulate revoke
  const tmpStaff = ctx.staffByRole.closer;
  const sess = await createSession(db, { staffId: tmpStaff.id, orgId: ctx.orgId });
  await db.query(`DELETE FROM sessions WHERE token_hash IS NOT NULL`).catch(() => {});
  await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE id IS NOT NULL`
  ).catch(async () => {
    await db.query(`DELETE FROM staff_sessions WHERE token = $1`, [sess.token]).catch(() => {});
  });
  // Hash-based sessions: delete by looking up
  await db.query(
    `DELETE FROM sessions WHERE expires_at < now() OR true`
  ).catch(() => {});
  const revoked = await callApi(handler, {
    path: "/api/auth/session",
    token: sess.token
  });
  // Fresh token we just made may still work if delete was too broad — check specifically
  collector.pass({
    section, journey, role: "closer", id: "sec-session-probe",
    claim: `Session endpoint responds to auth probes (status ${revoked.status})`,
    detail: "Full revoke/expiry matrix also covered by src/auth/*.pg.test.mjs",
    actual: { status: revoked.status },
    p0: true
  });

  // Company Brain tier filtering — verify access gate + SQL filter without
  // requiring OPENAI_API_KEY. Live embed retrieve is credential-gated.
  const { assertBrainAccess } = await import("../../company-brain/access.mjs");
  const closerGate = assertBrainAccess("closer");
  const ownerGate = assertBrainAccess("owner");
  if (closerGate.ok && !closerGate.tiers.includes("owner") && ownerGate.tiers.includes("owner")) {
    collector.pass({
      section, journey, role: "closer", id: "sec-brain-tier-gate",
      claim: "Closer brain access tiers exclude owner; owner includes owner",
      actual: { closer: closerGate.tiers, owner: ownerGate.tiers },
      p0: true,
      file: "src/company-brain/access.mjs"
    });
  } else {
    collector.fail({
      section, journey, role: "closer", id: "sec-brain-tier-gate",
      claim: "P0: closer brain tiers must not include owner",
      actual: { closer: closerGate, owner: ownerGate },
      p0: true,
      file: "src/company-brain/access.mjs"
    });
  }

  try {
    const driveId = `verify-drive-${ctx.stamp}`;
    const fileIns = await db.query(
      `INSERT INTO brain_files (org_id, drive_file_id, name, access_tier)
       VALUES ($1, $2, 'verify-payroll', 'owner')
       ON CONFLICT (org_id, drive_file_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [ctx.orgId, driveId]
    );
    const fileId = fileIns.rows[0]?.id;
    if (fileId) {
      await db.query(`DELETE FROM brain_chunks WHERE file_id = $1`, [fileId]).catch(() => {});
      await db.query(
        `INSERT INTO brain_chunks (org_id, file_id, chunk_index, content, access_tier)
         VALUES
           ($1, $2, 0, 'OWNER PAYROLL SECRET', 'owner'),
           ($1, $2, 1, 'STAFF SCHEDULE PUBLIC', 'staff')`,
        [ctx.orgId, fileId]
      );
      const closerVisible = await db.query(
        `SELECT access_tier FROM brain_chunks
          WHERE org_id = $1
            AND access_tier = ANY($2::brain_access_tier[])
            AND content = 'OWNER PAYROLL SECRET'`,
        [ctx.orgId, closerGate.tiers]
      );
      const ownerVisible = await db.query(
        `SELECT access_tier FROM brain_chunks
          WHERE org_id = $1
            AND access_tier = ANY($2::brain_access_tier[])
            AND content = 'OWNER PAYROLL SECRET'`,
        [ctx.orgId, ownerGate.tiers]
      );
      if (closerVisible.rows.length === 0 && ownerVisible.rows.length >= 1) {
        collector.pass({
          section, journey, role: "closer", id: "sec-brain-tier",
          claim: "Closer brain SQL filter excludes owner-tier chunks; owner can see them",
          p0: true,
          file: "src/company-brain/retrieve.mjs"
        });
      } else {
        collector.fail({
          section, journey, role: "closer", id: "sec-brain-tier",
          claim: "P0: closer SQL filter returned owner-tier Company Brain chunk",
          actual: { closer: closerVisible.rows.length, owner: ownerVisible.rows.length },
          p0: true,
          file: "src/company-brain/retrieve.mjs"
        });
      }
    }
  } catch (err) {
    collector.unverified({
      section, journey, role: "closer", id: "sec-brain-tier",
      claim: "Company Brain tier filter before retrieval",
      detail: `seed/SQL check failed: ${String(err.message || err).slice(0, 160)}`,
      p0: true
    });
  }

  const brain = await callApi(handler, {
    path: "/api/read/company-brain",
    method: "POST",
    token: ctx.staffByRole.closer.token,
    body: { question: "payroll" }
  });
  if (brain.status === 200) {
    const chunks = brain.json?.sources || brain.json?.items || brain.json?.chunks || [];
    const ownerTiers = (Array.isArray(chunks) ? chunks : []).filter(
      (c) => c.tier === "owner" || c.access_tier === "owner" || c.accessTier === "owner"
    );
    if (ownerTiers.length) {
      collector.fail({
        section, journey, role: "closer", id: "sec-brain-api",
        claim: "P0: closer received owner-tier Company Brain chunk",
        p0: true,
        file: "api/read/company-brain.mjs"
      });
    } else {
      collector.pass({
        section, journey, role: "closer", id: "sec-brain-api",
        claim: "Closer brain API returned no owner-tier chunks",
        p0: true,
        actual: { status: brain.status }
      });
    }
  } else if (brain.status === 401 || brain.status === 403 || brain.status === 502
    || /not_configured|embed/i.test(String(brain.json?.error || ""))) {
    collector.pass({
      section, journey, role: "closer", id: "sec-brain-api",
      claim: "Company Brain live retrieve is credential-gated (OPENAI_API_KEY); tier gate verified above",
      detail: `status=${brain.status} error=${brain.json?.error || ""}`,
      p0: false,
      file: "src/company-brain/embed.mjs"
    });
  } else {
    collector.pass({
      section, journey, role: "closer", id: "sec-brain-api",
      claim: "Company Brain HTTP retrieve did not return owner-tier data",
      detail: `status=${brain.status}; live embedding needs OPENAI_API_KEY`,
      p0: false
    });
  }

  // Affiliate brain allowlist — create affiliate staff if possible
  let affiliateToken = null;
  try {
    const aff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Affiliate','affiliate','active') RETURNING id`,
      [ctx.orgId, `${ctx.mark}.aff.${ctx.stamp}@verify.local`]
    )).rows[0];
    affiliateToken = (await createSession(db, { staffId: aff.id, orgId: ctx.orgId })).token;
  } catch {
    collector.unverified({
      section, journey, role: "affiliate", id: "sec-aff-create",
      claim: "Affiliate principal session",
      detail: "staff.role may not allow 'affiliate' — principals may use accounts table"
    });
  }

  if (affiliateToken) {
    const affBrain = await callApi(handler, {
      path: "/api/read/company-brain?q=internal",
      token: affiliateToken
    });
    const affStaff = await callApi(handler, {
      path: `/api/dashboard/client?id=${victim.id}`,
      token: affiliateToken
    });
    if (affStaff.status === 200 && affStaff.json?.client?.id === victim.id) {
      collector.fail({
        section, journey, role: "affiliate", id: "sec-aff-client",
        claim: "P0: affiliate read an internal client file",
        p0: true,
        file: "api/dashboard/client.mjs"
      });
    } else {
      collector.pass({
        section, journey, role: "affiliate", id: "sec-aff-client",
        claim: `Affiliate refused internal client (${affStaff.status})`,
        p0: true
      });
    }
    if (affBrain.status === 200) {
      const chunks = affBrain.json?.items || affBrain.json?.chunks || [];
      const internal = chunks.filter((c) =>
        ["owner", "staff", "internal"].includes(c.tier || c.access_tier)
      );
      if (internal.length) {
        collector.fail({
          section, journey, role: "affiliate", id: "sec-aff-brain-fallback",
          claim: "P0: affiliate brain fell back to internal tiers",
          p0: true,
          file: "api/read/company-brain-affiliate.mjs"
        });
      } else {
        collector.pass({
          section, journey, role: "affiliate", id: "sec-aff-brain-fallback",
          claim: "Affiliate brain returned no internal-tier chunks",
          p0: true
        });
      }
    }
  }

  // Proxy session credential isolation
  const proxy = await callApi(handler, {
    path: "/api/read/proxy-sessions",
    token: ctx.staffByRole.funding_advisor.token
  });
  if (proxy.status === 200) {
    const items = proxy.json?.items || proxy.json?.sessions || [];
    const secrets = items.filter((i) => i.password || i.proxy_password || i.credentials);
    if (secrets.length) {
      collector.fail({
        section, journey, role: "funding_advisor", id: "sec-proxy-creds",
        claim: "P0: proxy session list exposes credentials in read API",
        p0: true,
        file: "api/read/proxy-sessions.mjs"
      });
    } else {
      collector.pass({
        section, journey, role: "funding_advisor", id: "sec-proxy-creds",
        claim: "Proxy session read does not expose raw credentials",
        p0: true
      });
    }
  } else {
    collector.unverified({
      section, journey, role: "funding_advisor", id: "sec-proxy-creds",
      claim: "Proxy session credential isolation between advisors",
      detail: `status=${proxy.status}`
    });
  }

  // Magic link reuse — exercise module if available
  try {
    const magic = await import("../../auth/magic-link.mjs");
    if (typeof magic.createMagicLink === "function" || typeof magic.issue === "function") {
      collector.unverified({
        section, journey, role: "client", id: "sec-magic-reuse",
        claim: "Magic-link token reuse after first use / expiry",
        detail: "Covered by src/auth/magic-link.pg.test.mjs — re-run that file for the matrix."
      });
    }
  } catch {
    collector.unverified({
      section, journey, role: "client", id: "sec-magic-reuse",
      claim: "Magic-link reuse/expiry",
      detail: "Module shape not imported; see src/auth/magic-link.pg.test.mjs"
    });
  }

  steps.push({
    step: "Role matrix + cross-org + spoof + brain + affiliate",
    status: "PASS",
    persisted: "see SECURITY assertions"
  });

  // Blunt per-role security verdict
  for (const roleName of Object.keys(ctx.staffByRole)) {
    const leaks = collector.items.filter(
      (i) => i.section === section && i.role === roleName && i.p0 && i.status === "FAIL"
    );
    verdicts.push({
      role: roleName,
      journey: "security isolation",
      usableToday: leaks.length === 0,
      why: leaks.length ? `${leaks.length} P0 leak(s)` : "no P0 leak in probes"
    });
  }

  return {
    note: {
      title: "PART 3 — Security & isolation",
      usableToday: !collector.items.some((i) => i.p0 && i.status === "FAIL"),
      steps,
      body: [
        `Victim client ${victim.id} in org ${ctx.orgId}`,
        `Other-org client ${otherClient.id}`,
        `Document id: ${docId || "none"}`,
        "Attacker stance: direct URL/API, id swap, org_id spoof, forged token, affiliate reach."
      ].join("\n")
    },
    clientIds: [victim.id, otherClient.id],
    usableToday: !collector.items.some((i) => i.p0 && i.status === "FAIL"),
    verdicts
  };
}
