"use strict";

/**
 * airtable-client.js — Airtable REST API Client
 *
 * Thin wrapper for Airtable record operations.
 * Uses personal access token (PAT) authentication.
 */

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

function getConfig() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID not configured");
  return { apiKey, baseId };
}

async function airtableFetch(path, options = {}) {
  const { apiKey } = getConfig();
  const url = `${AIRTABLE_API_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Airtable ${options.method || "GET"} ${path} failed: ${resp.status} ${text.substring(0, 300)}`
    );
  }

  return resp.json();
}

/**
 * Get a single record by ID.
 */
async function getRecord(tableId, recordId) {
  const { baseId } = getConfig();
  return airtableFetch(`/${baseId}/${tableId}/${recordId}`);
}

/**
 * Update fields on a single record (PATCH — merges with existing fields).
 * Uses typecast:true to auto-create single select options.
 */
async function updateRecord(tableId, recordId, fields) {
  const { baseId } = getConfig();
  return airtableFetch(`/${baseId}/${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true })
  });
}

/**
 * List records with optional filter formula.
 *
 * @param {string} tableId
 * @param {Object} [opts]
 * @param {string} [opts.filterByFormula]
 * @param {number} [opts.maxRecords]
 * @param {string[]} [opts.fields]
 */
async function listRecords(tableId, { filterByFormula, maxRecords, fields } = {}) {
  const { baseId } = getConfig();
  const params = new URLSearchParams();
  if (filterByFormula) params.set("filterByFormula", filterByFormula);
  if (maxRecords) params.set("maxRecords", String(maxRecords));
  if (fields) fields.forEach((f) => params.append("fields[]", f));
  const qs = params.toString();
  return airtableFetch(`/${baseId}/${tableId}${qs ? `?${qs}` : ""}`);
}

/**
 * Create a new record in a table.
 *
 * @param {string} tableId - Table name or ID
 * @param {Object} fields - Field values to set
 */
async function createRecord(tableId, fields) {
  const { baseId } = getConfig();
  return airtableFetch(`/${baseId}/${tableId}`, {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true })
  });
}

module.exports = { getRecord, updateRecord, listRecords, createRecord };
