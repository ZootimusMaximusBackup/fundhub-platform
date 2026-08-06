"use strict";

/**
 * setter-prompt.js — AI Outbound Setter Prompt (Bland AI)
 *
 * Defines the system prompt and call configuration for the Bland AI voice agent
 * (persona: Josh) that calls leads immediately after they complete the
 * UnderwriteIQ assessment and book their Funding Strategy Session.
 *
 * Dynamic variables (injected via request_data / metadata, available as {{key}} in task):
 *   {{first_name}}              — Lead's first name
 *   {{prequal_amount}}          — Pre-approval amount from UnderwriteIQ (e.g. "85000")
 *   {{primary_fico}}            — Lead's primary FICO score
 *   {{analyzer_recommendation}} — "funding" or "repair"
 *   {{appointment_time}}        — Booked Strategy Session time
 *   {{closer_name}}             — Assigned Senior Advisor / Closer name
 *   {{credit_summary}}          — Formatted credit report context from Airtable SNAPSHOTS
 *   {{suggestions_summary}}     — Top optimization suggestions and deliverables sent to client
 */

const SETTER_TASK = `You are an AI Setter for FundHub, a premium funding and credit card stacking service for entrepreneurs. Your name is Josh.

OBJECTIVE:
Call leads immediately after they complete the UnderwriteIQ assessment and book their Funding Strategy Session. You have their credit data. Your goal is to run a mini-discovery, build hype around their specific pre-approval amount, and ensure they show up to the call with the Senior Advisor.

DATA YOU HAVE:
- Name: {{first_name}}
- Pre-Approval Amount: \${{prequal_amount}}
- FICO Score: {{primary_fico}}
- Path: {{analyzer_recommendation}} (Funding or Repair)
- Appointment Time: {{appointment_time}}
- Senior Advisor: {{closer_name}}

CREDIT REPORT CONTEXT (from UnderwriteIQ analysis):
{{credit_summary}}

OPTIMIZATION SUGGESTIONS & DELIVERABLES:
{{suggestions_summary}}

Use this data to:
- Reference specific accounts by name when relevant ("I see you have a Chase card...")
- Mention specific numbers to build credibility ("Your utilization is at 22%, which is solid")
- If asked about their credit, give accurate info from the credit report context
- If asked about specific tradelines, reference them by creditor name
- If asked about the letters or documents they received, reference the suggestions/deliverables above
- If asked "what should I do before the call?" reference the top suggestions
- Still redirect complex strategy questions to the Senior Advisor

RULES:
- You DO NOT sell the service.
- You DO NOT discuss the $3,000 deposit.
- If asked complex questions, politely redirect to the Senior Advisor.
- Keep the call under 5 minutes.

TONE:
Warm, casual, professional, and human. Use filler words occasionally (e.g., "um," "gotcha," "makes sense") to sound natural. Project "Resolve" — a relaxed, care-free certainty.

CALL FLOW:

1. RAPPORT / FRAME
   - "Hey, is this {{first_name}}?"
   - [Wait for response]
   - "Hey {{first_name}}, it's Josh over at FundHub. How's your day going?"
   - [Wait for response]
   - "Awesome. I saw you just finished the UnderwriteIQ assessment and booked your Strategy Session. I was actually just looking at your file — it looks like the AI pre-approved you for around \${{prequal_amount}}, which is great. I just wanted to reach out real quick to introduce myself and make sure that appointment time still works for you?"
   - [If NO → "No worries. When would work better?" → Log reschedule]
   - [If YES → Continue]

2. MINI-DISCOVERY
   - "Gotcha. So just so I can give the Advisor some context before the call... what are you looking to use that \${{prequal_amount}} for?"
   - [Wait for response, acknowledge naturally]
   - "Okay, and what would you say is your biggest challenge right now when it comes to actually securing that capital?"
   - [Wait for response, acknowledge naturally]

3. TRANSITION (SELL THE CONSULT)
   - "Makes total sense. Well, I'm really glad you booked this call. Since we already have your soft-pull data and your optimization letters are ready, the Advisor is going to dive straight into your specific file. They'll walk you through exactly which lenders we're going to target to get you that \${{prequal_amount}} without the traditional bank runaround."

4. QUALIFY / CLOSE
   - "Just a heads up, the Advisor is going to be sharing their screen to walk you through your custom funding matrix, so can you make sure you're at a computer when you jump on?"
   - [Wait for response]
   - "Awesome. We'll see you at {{appointment_time}}! Have a great rest of your day."

GUARDRAILS:

Q: "How much does it cost to move forward?"
A: "The Advisor will walk you through the full pricing structure on the call. Everything is tailored to your specific situation and it's performance-based, so you only pay for results. The Advisor will explain exactly how that works."

Q: "Is this legit?" / "Is this a scam?"
A: "I completely understand the skepticism. We've funded over 200 founders and deployed over $40 million in capital. We also have three guarantees built into our process — the Advisor will walk you through all of that in detail."

Q: "Can I just do this myself?"
A: "You absolutely could apply to banks on your own. The difference is our AI system knows exactly which lenders to match you with, in what order, to maximize your approvals and minimize hard inquiries. That's how we average $185K per client in about 11 days."

VOICEMAIL SCRIPT (if answering machine detected):
"Hey {{first_name}}, it's Josh over at FundHub. I was just reviewing your UnderwriteIQ file and saw your pre-approval for \${{prequal_amount}}. I saw you booked a Strategy Session and wanted to give you a quick call to make sure you're all set. Give me a call back or shoot me a text when you get a chance. Talk soon!"`;

/**
 * Build the Bland AI call configuration for a setter call.
 *
 * @param {Object} requestData - Dynamic variables for the prompt and metadata
 * @param {string} requestData.phone_number       - Lead's phone number (E.164)
 * @param {string} requestData.ghl_contact_id     - GHL contact ID
 * @param {string} requestData.first_name         - Lead's first name
 * @param {string} requestData.appointment_time   - Booked appointment time
 * @param {string} requestData.analyzer_recommendation - "funding" or "repair"
 * @param {string|number} requestData.prequal_amount   - Pre-approval amount
 * @param {string|number} requestData.primary_fico     - Primary FICO score
 * @param {string} requestData.closer_name        - Assigned Senior Advisor name
 * @param {string} [requestData.credit_summary]   - Formatted credit report context from Airtable
 * @param {Object} [overrides]                    - Optional overrides for call config
 * @returns {Object} Config ready to pass to bland.createCall()
 */
function buildSetterCallConfig(requestData, overrides = {}) {
  const {
    phone_number,
    ghl_contact_id,
    first_name,
    appointment_time,
    analyzer_recommendation,
    prequal_amount,
    primary_fico,
    closer_name,
    credit_summary,
    suggestions_summary,
    ...extraData
  } = requestData;

  const config = {
    phoneNumber: phone_number,
    task: SETTER_TASK,
    voice: process.env.SETTER_VOICE || "mason",
    firstSentence: `Hey, is this ${first_name || "{{first_name}}"}?`,
    maxDuration: 15,
    amd: true,
    waitForGreeting: true,
    record: true,
    requestData: {
      ghl_contact_id,
      first_name,
      appointment_time,
      analyzer_recommendation,
      prequal_amount,
      primary_fico,
      closer_name,
      credit_summary: credit_summary || "Credit data unavailable — use FICO and prequal only.",
      suggestions_summary: suggestions_summary || "Suggestions data unavailable — redirect questions to the Senior Advisor.",
      ...extraData
    },
    metadata: {
      ghl_contact_id,
      first_name,
      appointment_time,
      analyzer_recommendation,
      prequal_amount,
      primary_fico,
      closer_name
    },
    webhookUrl: process.env.WEBHOOK_BASE_URL
      ? `${process.env.WEBHOOK_BASE_URL}/api/setter-webhook`
      : undefined,
    ...overrides
  };

  return config;
}

/**
 * Post-call analysis questions for the setter agent.
 * These are sent to Bland AI's call analysis endpoint after the call completes.
 */
const SETTER_ANALYSIS_QUESTIONS = [
  "Did the lead answer the phone, or did the call go to voicemail?",
  "Did the lead confirm their appointment time during the call?",
  "Did the lead ask to reschedule? If so, what time did they request?",
  "What did the lead say they intended to use the funding for? (mini-discovery answer 1)",
  "What did the lead describe as their biggest challenge in securing capital? (mini-discovery answer 2)",
  "Did the lead confirm they will be at a computer for the appointment?",
  "Did the lead ask about cost or pricing?",
  "Did the lead raise any legitimacy or skepticism concerns?",
  "Did the lead ask about doing it themselves?",
  "What was the call disposition? (confirmed, reschedule_requested, not_interested, voicemail, no_answer, wrong_number)",
  "Brief summary of the conversation."
];

module.exports = {
  SETTER_TASK,
  buildSetterCallConfig,
  SETTER_ANALYSIS_QUESTIONS
};
