"use strict";

/**
 * Keyword-based email classifier for bank funding emails.
 * Classifies incoming emails into one of 7 event types.
 */

const NOISE_FROM_PATTERNS = [
  "noreply",
  "no-reply",
  "newsletter",
  "marketing",
  "unsubscribe",
  "donotreply",
];

const NOISE_SUBJECT_PATTERNS = [
  "unsubscribe",
  "newsletter",
  "promotional",
  "update your preferences",
];

/**
 * Classification rules in priority order.
 * Each rule has an event type and arrays of keyword patterns to match against.
 */
const CLASSIFICATION_RULES = [
  {
    event_type: "APPROVED",
    keywords: [
      "approved",
      "congratulations",
      "approval",
      "funded",
      "you've been approved",
      "credit limit",
    ],
    // Dollar amounts alongside "credit limit" strengthen the match
    dollarAmountBoost: true,
  },
  {
    event_type: "COUNTEROFFER",
    keywords: [
      "counteroffer",
      "counter offer",
      "revised offer",
      "lower amount",
      "reduced",
    ],
  },
  {
    event_type: "DENIED",
    keywords: [
      "denied",
      "declined",
      "unfortunately",
      "not approved",
      "unable to approve",
      "adverse action",
    ],
  },
  {
    event_type: "MISSING_DOCS",
    keywords: [
      "missing document",
      "documents needed",
      "additional documentation",
      "please provide",
      "upload",
      "verify your",
      "identity verification",
    ],
  },
  {
    event_type: "ACTION_REQUIRED",
    keywords: [
      "action required",
      "action needed",
      "please sign",
      "review and sign",
      "accept your offer",
      "log in to",
      "confirm your",
    ],
  },
  {
    event_type: "APP_RECEIVED",
    keywords: [
      "application received",
      "we received your application",
      "thank you for applying",
      "application submitted",
      "application confirmation",
    ],
  },
];

const DOLLAR_PATTERN = /\$[\d,]+(?:\.\d{2})?/;

/**
 * Check if text contains any of the given keywords (case-insensitive).
 * Returns the first matched keyword, or null.
 */
function findKeyword(text, keywords) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

/**
 * Determine if an email is noise based on sender and subject.
 */
function isNoise(from, subject) {
  if (from) {
    const lowerFrom = from.toLowerCase();
    for (const pattern of NOISE_FROM_PATTERNS) {
      if (lowerFrom.includes(pattern)) {
        return pattern;
      }
    }
  }
  if (subject) {
    const lowerSubject = subject.toLowerCase();
    for (const pattern of NOISE_SUBJECT_PATTERNS) {
      if (lowerSubject.includes(pattern)) {
        return pattern;
      }
    }
  }
  return null;
}

/**
 * Classify an email into one of 7 event types.
 *
 * @param {Object} email
 * @param {string} [email.subject] - Email subject line
 * @param {string} [email.from] - Sender address/name
 * @param {string} [email.bodyPlain] - Plain text body
 * @param {string} [email.strippedText] - Body with quotes/signatures stripped
 * @returns {{ event_type: string, confidence: string, matched_rule: string }}
 */
function classifyEmail({ subject, from, bodyPlain, strippedText } = {}) {
  // 1. NOISE filter first
  const noiseMatch = isNoise(from, subject);
  if (noiseMatch) {
    return {
      event_type: "NOISE",
      confidence: "high",
      matched_rule: `noise_filter:${noiseMatch}`,
    };
  }

  // Use strippedText if available, fall back to bodyPlain
  const body = strippedText || bodyPlain || "";

  // 2. Run classification rules in priority order
  const matches = [];

  for (const rule of CLASSIFICATION_RULES) {
    const subjectMatch = findKeyword(subject, rule.keywords);
    const bodyMatch = findKeyword(body, rule.keywords);

    if (subjectMatch || bodyMatch) {
      // Subject matches carry higher weight
      const source = subjectMatch ? "subject" : "body";
      const keyword = subjectMatch || bodyMatch;

      // For APPROVED, check for dollar amounts as a boost signal
      let hasDollarAmount = false;
      if (rule.dollarAmountBoost) {
        hasDollarAmount =
          DOLLAR_PATTERN.test(subject || "") || DOLLAR_PATTERN.test(body);
      }

      matches.push({
        event_type: rule.event_type,
        source,
        keyword,
        hasDollarAmount,
      });
    }
  }

  // No matches -> NOISE fallback
  if (matches.length === 0) {
    return {
      event_type: "NOISE",
      confidence: "low",
      matched_rule: "no_keyword_match",
    };
  }

  // First match wins (priority order preserved)
  const best = matches[0];
  const confidence = matches.length === 1 ? "high" : "medium";
  const dollarNote = best.hasDollarAmount ? "+dollar_amount" : "";

  return {
    event_type: best.event_type,
    confidence,
    matched_rule: `${best.source}:${best.keyword}${dollarNote}`,
  };
}

module.exports = { classifyEmail };
