// ============================================================================
// Letter Delivery Service
// Orchestrates: Generate Letters → Upload to Storage → Update GHL
// ============================================================================

const { generateLetters } = require("./letter-generator");
const { uploadAllPdfs } = require("./storage");
const {
  updateLetterUrls,
  updateContactCustomFields,
  createOrUpdateContact
} = require("./ghl-contact-service");
const { logInfo, logError, logWarn } = require("./logger");
const { generateAllSummaryDocuments } = require("./crs/summary-doc-generator");

/**
 * Full letter delivery pipeline
 * 1. Generate all dispute letter PDFs based on path
 * 2. Upload PDFs to Vercel Blob storage
 * 3. Update GHL contact with letter URLs
 *
 * Supports two modes:
 * - Legacy (PDF-upload): bureaus + underwrite → generateLetters()
 * - CRS: crsDocuments.letters[] specs → generateLettersFromCRS()
 *
 * @param {Object} params
 * @param {string} params.contactId - GHL contact ID (if already exists)
 * @param {Object} params.contactData - Contact data for creating/updating contact
 * @param {Object} params.bureaus - Parsed bureau data from analyzer (legacy path)
 * @param {Object} params.underwrite - Underwriting results
 * @param {Object} params.personal - Personal info (name, address, etc.)
 * @param {Object} [params.crsDocuments] - CRS document specs from build-documents.js
 * @param {Object} [params.crsResult] - Full CRS engine result (for summary doc generation)
 * @returns {Promise<Object>} Result with status and URLs
 */
async function deliverLetters({
  contactId,
  contactData,
  bureaus,
  underwrite,
  personal,
  crsDocuments,
  crsResult
}) {
  const startTime = Date.now();
  const isCRS = !!crsDocuments?.letters?.length;
  const path = isCRS
    ? crsDocuments.package === "funding"
      ? "fundable"
      : crsDocuments.package || "repair"
    : underwrite?.fundable
      ? "fundable"
      : "repair";

  logInfo("Letter delivery started", {
    path,
    mode: isCRS ? "crs" : "legacy",
    hasContactId: !!contactId,
    letterCount: isCRS ? crsDocuments.letters.length : undefined
  });

  try {
    // Step 1: Ensure we have a contact ID
    let finalContactId = contactId;

    if (!finalContactId && contactData?.email) {
      logInfo("Creating/updating GHL contact for letter delivery");
      const contactResult = await createOrUpdateContact(contactData);

      if (contactResult.ok) {
        finalContactId = contactResult.contactId;
      } else {
        logWarn("Could not create GHL contact, continuing without GHL sync", {
          error: contactResult.error
        });
      }
    }

    // Step 2: Generate letters
    let letters;
    let fieldKeyMap = null; // CRS: maps filename → GHL field key

    if (isCRS) {
      logInfo("Generating CRS letters", { specs: crsDocuments.letters.length });
      // Renamed from crsResult to avoid shadowing the crsResult PARAMETER (the CRS
      // engine result) that summary-doc generation below reads at line ~102.
      // Same generateLetters item lists as W1 — empty bureau/items → no PDF.
      const letterGenResult = await generateLettersFromCRS(
        crsDocuments.letters,
        personal || {},
        bureaus || bureausFromCrsResult(crsResult) || {}
      );
      letters = letterGenResult.letters;
      fieldKeyMap = letterGenResult.fieldKeyMap;
    } else {
      logInfo("Generating letters", { path });
      letters = await generateLetters({
        path,
        bureaus: bureaus || {},
        personal: personal || {},
        underwrite: underwrite || {}
      });
    }

    logInfo("Letters generated", { count: letters.length });

    // Step 2b: Generate summary documents (CRS path only)
    let summaryDocs = [];
    if (isCRS && crsDocuments.summaryDocuments?.length > 0 && crsResult) {
      try {
        summaryDocs = await generateAllSummaryDocuments(
          crsDocuments.summaryDocuments,
          crsResult,
          personal
        );
        logInfo("Summary documents generated", { count: summaryDocs.length });
        // Map summary doc filenames to GHL field keys (customer-facing docs only)
        if (fieldKeyMap) {
          for (let i = 0; i < crsDocuments.summaryDocuments.length; i++) {
            const spec = crsDocuments.summaryDocuments[i];
            if (spec.fieldKey && summaryDocs[i]) {
              const fileKey = summaryDocs[i].filename.replace(".pdf", "");
              fieldKeyMap[fileKey] = spec.fieldKey;
            }
          }
        }
        // Add summary docs to the upload list
        letters.push(...summaryDocs);
      } catch (err) {
        logWarn("Summary document generation failed", { error: err.message });
      }
    }

    // Step 3: Upload to storage
    logInfo("Uploading letters to storage");

    // Use contact ID or generate a temporary ID for storage
    const storageId = finalContactId || `temp_${Date.now()}`;

    const uploadResult = await uploadAllPdfs(letters, storageId);

    if (!uploadResult.ok) {
      logError("Some letters failed to upload", null, {
        errors: uploadResult.errors
      });
    }

    logInfo("Letters uploaded", {
      uploaded: uploadResult.uploadedCount,
      failed: uploadResult.failedCount
    });

    // Step 4: Update GHL with letter URLs
    let ghlUpdateResult = { ok: false, skipped: true };

    if (finalContactId && uploadResult.uploadedCount > 0) {
      logInfo("Updating GHL with letter URLs", { contactId: finalContactId });

      if (isCRS && fieldKeyMap) {
        // CRS path: map uploaded URLs using fieldKey from document specs
        ghlUpdateResult = await updateLetterUrlsFromCRS(
          finalContactId,
          uploadResult.urls,
          fieldKeyMap,
          path
        );
      } else {
        ghlUpdateResult = await updateLetterUrls(finalContactId, uploadResult.urls, path);
      }

      if (ghlUpdateResult.ok) {
        logInfo("GHL updated with letter URLs", {
          contactId: finalContactId,
          updatedFields: ghlUpdateResult.updatedFields
        });
      } else {
        logWarn("GHL update failed", { error: ghlUpdateResult.error });
      }
    } else if (!finalContactId) {
      logWarn("No contact ID available, skipping GHL update");
    }

    const duration = Date.now() - startTime;

    logInfo("Letter delivery complete", { duration });

    return {
      ok: true,
      path,
      contactId: finalContactId,
      letters: {
        generated: letters.length,
        uploaded: uploadResult.uploadedCount,
        failed: uploadResult.failedCount
      },
      urls: uploadResult.urls,
      uploadErrors: uploadResult.errors, // surface per-file upload failures to callers/ops
      // fieldKeyMap (filename → GHL field key) so callers can translate the
      // filename-keyed urls above into GHL field keys (e.g. for the U-02
      // letters-ready webhook payload, which must carry the field keys 1:1).
      fieldKeyMap,
      ghlUpdated: ghlUpdateResult.ok,
      ghlSkipped: ghlUpdateResult.skipped,
      duration
    };
  } catch (err) {
    logError("Letter delivery failed", err);

    return {
      ok: false,
      error: err.message,
      path,
      duration: Date.now() - startTime
    };
  }
}

// ---------------------------------------------------------------------------
// CRS-specific letter generation (W1 generateLetters item lists — no invent)
// ---------------------------------------------------------------------------

/**
 * Build the same bureaus shape letter-generator expects from a CRS engine result.
 * Specs alone never invent accounts — empty/missing normalized → empty bureaus.
 */
function bureausFromCrsResult(crsResult) {
  const empty = () => ({
    tradelines: [],
    inquiries: 0,
    inquiryList: [],
    names: [],
    addresses: [],
    employers: [],
    ssns: [],
    dobs: []
  });
  const by = { experian: empty(), transunion: empty(), equifax: empty() };
  if (!crsResult?.normalized) return by;

  const tradelines = crsResult.normalized.tradelines || [];
  const inquiries = crsResult.normalized.inquiries || [];
  const identity = crsResult.normalized.identity || {};

  for (const t of tradelines) {
    const key = t.source;
    if (!by[key]) continue;
    by[key].tradelines.push({
      creditor: t.creditorName || t.creditor,
      creditorName: t.creditorName || t.creditor,
      status: t.status,
      is_negative: !!(t.isDerogatory || t.is_negative),
      isDerogatory: !!(t.isDerogatory || t.is_negative),
      balance: t.currentBalance ?? t.balance ?? null,
      currentBalance: t.currentBalance ?? t.balance ?? null,
      pastDue: t.pastDue ?? t.past_due ?? null,
      accountId: t.accountIdentifier || t.accountId || t.accountNumber,
      accountIdentifier: t.accountIdentifier || t.accountId || t.accountNumber,
      dateReported: t.reportedDate || t.dateReported || t.lastReported,
      reportedDate: t.reportedDate || t.dateReported || t.lastReported,
      openedDate: t.openedDate || t.dateOpened || null,
      closedDate: t.closedDate || t.dateClosed || null,
      accountType: t.accountType ?? null,
      currentRatingType: t.currentRatingType || null,
      comments: t.comments || [],
      chargeOffAmount: t.chargeOffAmount ?? null,
      complianceConditionCode: t.complianceConditionCode || null,
      inferredDofd: t.inferredDofd || t.dofd || null,
      ownership: t.ownership || null,
      isAU: !!t.isAU,
      priorOutcome: t.priorOutcome || null
    });
  }

  for (const i of inquiries) {
    if (!by[i.source]) continue;
    by[i.source].inquiries += 1;
    by[i.source].inquiryList.push({
      creditor: i.creditorName || i.creditor || i.subscriber || "Unknown",
      creditorName: i.creditorName || i.creditor || i.subscriber || "Unknown",
      date: i.date || i.inquiryDate || ""
    });
  }

  const idSource = identity.bySource || {};
  const formatIdentityName = n => {
    if (!n || typeof n !== "object") return typeof n === "string" ? n : "";
    return n.full || n.display || [n.first, n.middle, n.last].filter(Boolean).join(" ").trim();
  };
  for (const key of Object.keys(by)) {
    const named = (arr, pick) =>
      (arr || [])
        .filter(row => !row || !row.source || row.source === key)
        .map(pick)
        .filter(Boolean);
    const slice = idSource[key];
    by[key].names = slice
      ? (slice.names || [])
          .map(n => (typeof n === "string" ? n : n.full || n.display || ""))
          .filter(Boolean)
      : named(identity.names, n => (typeof n === "string" ? n : formatIdentityName(n)));
    by[key].addresses = slice
      ? (slice.addresses || [])
          .map(a =>
            typeof a === "string" ? a : [a.line1, a.city, a.state, a.zip].filter(Boolean).join(", ")
          )
          .filter(Boolean)
      : named(identity.addresses, a =>
          typeof a === "string"
            ? a
            : [a.line1 || a.addressLine1, a.city, a.state, a.zip || a.postalCode]
                .filter(Boolean)
                .join(", ")
        );
    by[key].employers = slice
      ? (slice.employers || [])
          .map(e => (typeof e === "string" ? e : e.name || ""))
          .filter(Boolean)
      : named(identity.employers, e =>
          typeof e === "string" ? e : e.name || e.employerName || ""
        );
    by[key].ssns = slice
      ? (slice.ssns || []).map(s => (typeof s === "string" ? s : s.value || "")).filter(Boolean)
      : named(identity.ssns, s => (typeof s === "string" ? s : s.value || s.ssn || ""));
    by[key].dobs = slice
      ? (slice.dobs || []).map(d => (typeof d === "string" ? d : d.value || "")).filter(Boolean)
      : named(identity.dobs, d => (typeof d === "string" ? d : d.value || d.dob || ""));
  }

  return by;
}

function matchCrsSpec(letterSpecs, letter) {
  return (letterSpecs || []).find(spec => {
    if (!spec || spec.bureau !== letter.bureau) return false;
    if (letter.type === "dispute") {
      return spec.type === "dispute" && Number(spec.round) === Number(letter.round);
    }
    if (letter.type === "inquiry_removal") return spec.type === "inquiry_removal";
    if (letter.type === "personal_info") return spec.type === "personal_info";
    return false;
  });
}

/**
 * Generate letters from CRS document specs using W1 generateLetters helpers.
 * Empty item lists → no letter (never a header-only PDF). Specs alone do not invent accounts.
 *
 * @param {Array<{type, bureau, round, fieldKey}>} letterSpecs - From buildDocuments()
 * @param {Object} personal - { name, address }
 * @param {Object} [bureaus] - Parsed bureau data (tradelines / inquiries / identity)
 * @returns {Promise<{ letters: Array<{filename, buffer}>, fieldKeyMap: Object }>}
 */
async function generateLettersFromCRS(letterSpecs, personal, bureaus) {
  const {
    BUREAUS,
    generateDisputeLetters,
    generateInquiryLetters,
    generatePersonalInfoLetters
  } = require("./letter-generator");

  const specs = Array.isArray(letterSpecs) ? letterSpecs : [];
  const who = personal || {};
  const data = bureaus || {};
  const letters = [];
  const fieldKeyMap = {}; // filename (no .pdf) → GHL field key

  const wantDispute = specs.some(s => s.type === "dispute" && BUREAUS[s.bureau]);
  const wantInquiry = specs.some(s => s.type === "inquiry_removal" && BUREAUS[s.bureau]);
  const wantPersonal = specs.some(s => s.type === "personal_info" && BUREAUS[s.bureau]);

  const generated = [];
  if (wantDispute) {
    generated.push(...(await generateDisputeLetters({ bureaus: data, personal: who })));
  }
  if (wantInquiry) {
    generated.push(...(await generateInquiryLetters({ bureaus: data, personal: who })));
  }
  if (wantPersonal) {
    generated.push(...(await generatePersonalInfoLetters({ bureaus: data, personal: who })));
  }

  // Keep only letters that both have real items (W1) and match a requested CRS spec.
  for (const letter of generated) {
    const spec = matchCrsSpec(specs, letter);
    if (!spec) continue;
    letters.push({ filename: letter.filename, buffer: letter.buffer });
    fieldKeyMap[letter.filename.replace(".pdf", "")] = spec.fieldKey;
  }

  return { letters, fieldKeyMap };
}

/**
 * Update GHL with letter URLs using CRS fieldKey mapping.
 *
 * @param {string} contactId - GHL contact ID
 * @param {Object} urls - { filename_key: url }
 * @param {Object} fieldKeyMap - { filename_key: ghl_field_name }
 * @param {string} path - "fundable" or "repair"
 */
async function updateLetterUrlsFromCRS(contactId, urls, fieldKeyMap, path) {
  const fields = {};
  for (const [fileKey, url] of Object.entries(urls)) {
    const ghlField = fieldKeyMap[fileKey];
    if (ghlField) {
      fields[ghlField] = url;
    }
  }
  fields.analyzer_path = path === "fundable" ? "funding" : path;
  fields.letters_ready = "true";
  fields.analyzer_status = "complete";

  // `fields` is ALREADY keyed by final GHL field names (we translated via
  // fieldKeyMap above), so write it straight through. Do NOT route through
  // updateLetterUrls — that function re-maps from shorthand keys (inquiry_ex,
  // personal_info_ex…) and would match none of our translated keys, silently
  // dropping every CRS letter URL and nulling analyzer_path. (Bug found 06-29.)
  return updateContactCustomFields(contactId, fields);
}

/**
 * Fire-and-forget version for non-blocking delivery
 * Returns immediately, processes in background
 */
function deliverLettersAsync(params) {
  // Don't await - let it run in background
  deliverLetters(params)
    .then(result => {
      if (result.ok) {
        logInfo("Async letter delivery completed", {
          path: result.path,
          letters: result.letters,
          ghlUpdated: result.ghlUpdated
        });
      } else {
        logError("Async letter delivery failed", new Error(result.error));
      }
    })
    .catch(err => {
      logError("Async letter delivery exception", err);
    });

  return { ok: true, async: true, message: "Letter delivery started in background" };
}

module.exports = {
  deliverLetters,
  deliverLettersAsync,
  generateLettersFromCRS,
  updateLetterUrlsFromCRS
};
