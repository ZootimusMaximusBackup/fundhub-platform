-- 288_real_contract_text.sql — Chris's executed agreement text replaces the
-- placeholder bodies for Capital Academy and Capital Blueprint.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): customer-facing contract copy on a
-- regulated consumer-finance product — fee timing, refund and cancellation terms.
-- Marker only.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHERE THIS TEXT CAME FROM, AND WHY NOT ONE WORD OF IT WAS WRITTEN HERE.
--
-- 287 left each agreement one marked block reading "THIS IS NOT THE REAL
-- AGREEMENT TEXT. DO NOT SEND THIS.", because the executed copy was not in the
-- repository and agents never draft legal language (F30, owner-set 2026-09-03).
--
-- Chris put the source documents in the repo on 2026-09-03 at
-- docs/contracts/source-2026-08-28/. The two bodies below are those documents
-- COPIED VERBATIM out of the .docx — every section, in order, unedited. The
-- extraction is reproducible: unzip the .docx, read word/document.xml, take the
-- text of each <w:p> in order. Nothing was summarised, reordered, softened or
-- improved. If a sentence here reads oddly, it reads that way in Chris's file
-- and the fix belongs in the file, not here.
--
--   Fundhub-Capital-Academy-Enrollment-Agreement.docx  -> FUNDING-MASTERY-AGREEMENT
--   Fundhub-Capital-Blueprint-Service-Agreement.docx   -> CAPITAL-BLUEPRINT-AGREEMENT
--
-- NOT SUPPLIED, so NOT touched by this file — both still carry 287's placeholder
-- and both still refuse to be sent by accident:
--   FUNDING-AGREEMENT       ($3,000 deposit)
--   CREDIT-REPAIR-AGREEMENT ($1,000)
-- The Fundhub-Service-Agreements-Packet.pdf in that folder holds Capital Academy
-- (pages 1-4), Capital Blueprint (5-8) and the White Label Partner Agreement
-- (9-19). It does not contain either of the two above. Checked page by page.
--
-- WHITE LABEL IS DELIBERATELY UNTOUCHED. Its real text exists both in that packet
-- and already in the repo at 283_partner_license_template.sql. White label is last
-- in the owner's ecosystem order, so reconciling those two is its own task.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE ONE THING THAT NEEDS CHRIS, AND IT IS A MONEY TERM.
--
-- The Capital Blueprint agreement states its own price twice, in sections 1.3 and
-- 5.1, as five thousand United States dollars. The product prices Capital
-- Blueprint at one thousand (src/config/offers.mjs, UWIQ_DELIVERABLES), and the
-- whole 2026-09-03 batch treated it as the thousand-dollar rung.
--
-- The text is seeded EXACTLY AS WRITTEN. Editing a dollar amount inside an
-- executed consumer agreement is not a formatting fix and is not an agent's call
-- (CLAUDE.md §2, never invent). Either the document is right and the catalogue is
-- wrong, or the reverse. Until Chris says which, a Blueprint contract quotes a
-- figure the catalogue does not charge. Stated here rather than quietly resolved.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT THE REAL TEXT ALREADY DOES, so nothing is bolted on top of it.
--
-- F28 (the seller) — solved by the words themselves. Both documents name
-- "Fundhub LLC, a Florida limited liability company doing business as Fundhub
-- Education" as "we" in their first sentence, and neither contains a
-- staff-typed company blank anywhere, so a client's own company can never become
-- the seller again. 287 removed that blank; this text never needed it.
--
-- F29 (the signature block) — solved by the words themselves. Both end in an
-- Acknowledgement plus STUDENT and FUNDHUB EDUCATION blocks with signature, print
-- name and date lines. 287's synthesised SIGNATURES section is therefore replaced
-- rather than stacked underneath, which would have put two signature blocks on
-- one page.
--
-- F27 (one-click send) — manual_fields becomes an empty list for both. The old
-- program_fee / package_fee blanks existed to be typed at send time; the real
-- documents state their own price in their own words, so there is nothing left to
-- type and nothing left to get wrong. That is what makes send one click.
--
-- THE MERGE HEADER. Three lines sit above the document's own title: the date, the
-- client's name and the client's email. They are how this system addresses a
-- contract to a person, and the documents say "you, the person enrolling" without
-- naming them. Nothing inside the agreement is changed by them, and the first
-- words of the agreement proper are still Chris's.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY THE TEXT IS ENCODED AS ESCAPE-STRING CHUNKS RATHER THAN DOLLAR QUOTED.
--
-- The first cut used Postgres dollar quoting, which the database reads perfectly
-- — and which src/contracts/offer-fee-language.test.mjs cannot see at all. That
-- guard reads contract copy straight out of db/ by pulling every escape-string
-- literal out of the statement (bodyFrom(), around line 118). A dollar-quoted
-- body therefore reached the database correctly while the guard read an EMPTY
-- string, and every assertion about the seller, the signature block and the fee
-- passed over nothing. The guard's own comment names that failure: "a guard that
-- silently stopped finding anything is worse than no guard." So the text is
-- emitted one source line per chunk. Verbatim either way; only the encoding
-- changed.
--
-- ══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENT. Each UPDATE is guarded on the placeholder sentence 287 wrote, so
-- running this twice is a no-op, and a row somebody has already edited by hand in
-- the Contracts screen is left alone.
--
-- BOTH HALVES ARE NEEDED, same as 287 says. The runner applies migrations/ and
-- THEN seed/. On a FRESH database db/seed/021 creates FUNDING-MASTERY-AGREEMENT
-- after this file has already run, so the UPDATE below matches nothing and the
-- seed's own copy is what lands; on an EXISTING database the row is already there
-- and the UPDATE is what lands. db/seed/021_funding_mastery_agreement.sql carries
-- the identical text for that reason. Change one without the other and a new
-- environment silently keeps the placeholder.
--
-- Migrations run on the PRODUCTION deploy only (CLAUDE.md §11). Editing THIS file
-- after it has run changes nothing — supersede it with a new one.

BEGIN;

-- ── CAPITAL ACADEMY — Enrollment and Service Agreement ──
UPDATE contract_templates
   SET body =
         E'Date: {{today}}\n' ||
         E'Prepared for: {{contact.full_name}}\n' ||
         E'Email: {{contact.email}}\n\n' ||
    E'CAPITAL ACADEMY\n' ||
    E'Enrollment and Service Agreement\n' ||
    E'Fundhub Education — a program of Fundhub LLC\n' ||
    E'\n' ||
    E'This Agreement is between you, the person enrolling (“you” or “Student”), and Fundhub LLC, a Florida limited liability company doing business as Fundhub Education, of 218 Bostick Rd 64, Bowling Green, FL 33834 (“Fundhub Education,” “we,” or “us”).\n' ||
    E'By signing below or by purchasing the program, you agree to these terms. Please read Section 3 and Section 7 carefully.\n' ||
    E'At a glance\n' ||
    E'What you get\n' ||
    E'• Ten modules of self-paced video lessons, released in full on enrollment\n' ||
    E'• Downloadable workbooks and worksheets for every module\n' ||
    E'• Document and letter templates for your own personal use\n' ||
    E'• Reference materials on lender criteria and underwriting basics\n' ||
    E'• Student portal access for the lifetime of the program\n' ||
    E'• All future updates to the curriculum at no additional charge\n' ||
    E'What this is not\n' ||
    E'• We do not contact any credit bureau, creditor, or lender for you\n' ||
    E'• We do not prepare, sign, or submit any document on your behalf\n' ||
    E'• We do not apply for funding for you or broker any loan\n' ||
    E'• We are not your financial advisor, accountant, or attorney\n' ||
    E'• No credit score, dispute result, or funding approval is promised\n' ||
    E'• No income or business result is promised\n' ||
    E'This box is a plain-language summary. The numbered sections below are the actual terms and control if there is any difference.\n' ||
    E'1. What this program is\n' ||
    E'1.1 Capital Academy is Fundhub Education’s full financial education suite: a self-paced, ten-module video curriculum covering personal and business credit fundamentals, business entity and banking setup, financial statement literacy, lender criteria, and funding readiness, together with the templates and workbooks that accompany each module.\n' ||
    E'1.2 Capital Academy teaches you how to do the work. You do the work. Every letter, application, or other document you prepare using our materials is drafted, reviewed, signed, and submitted by you, in your own name, at your own discretion.\n' ||
    E'1.3 The tuition for this program is five thousand United States dollars ($5,000).\n' ||
    E'2. What we are not\n' ||
    E'2.1 Fundhub Education is not a lender, loan broker, financing company, financial advisor, investment advisor, accountant, law firm, or credit repair organization. Nothing in this program is lending, brokering, financial advice, legal advice, tax advice, or credit repair services.\n' ||
    E'2.2 We do not contact credit bureaus, creditors, lenders, or any other third party on your behalf, and we do not act as your agent with any of them.\n' ||
    E'2.3 Because we perform no service on your behalf with any third party, we do not hold ourselves out as, and do not act as, a credit repair organization.\n' ||
    E'3. No guarantees\n' ||
    E'3.1 We make no representation or guarantee about credit scores, score increases, dispute outcomes, the removal of any information from a credit report, lending or credit approval, funding amounts, income, or business results.\n' ||
    E'3.2 Results depend entirely on your own circumstances and your own actions. Any example, figure, or case used in the materials illustrates a concept. It is not a promise of a result, and it is not typical.\n' ||
    E'3.3 Accurate and timely information cannot be removed from a credit report. Any material that appears to suggest otherwise is superseded by this section.\n' ||
    E'4. Eligibility and your account\n' ||
    E'4.1 You must be at least 18 years old and able to enter a binding contract.\n' ||
    E'4.2 You are responsible for keeping your login credentials confidential and for all activity under your account.\n' ||
    E'4.3 Your access is personal to you. It may not be shared, resold, or transferred, and it may not be used to provide services to anyone else.\n' ||
    E'5. Tuition and payment\n' ||
    E'5.1 Tuition is five thousand dollars ($5,000), charged one time. There is no recurring billing and no subscription.\n' ||
    E'5.2 Payments are processed by independent third-party payment providers.\n' ||
    E'5.3 If an installment or financing option is offered at checkout, that option comes from an independent third-party provider under its own terms and its own approval criteria. Fundhub Education is not the lender and is not a party to that financing agreement. If that provider approves you, your obligation to repay it is separate from this Agreement and continues even if this Agreement ends.\n' ||
    E'6. Delivery\n' ||
    E'6.1 Program access is delivered digitally. On successful payment, student portal credentials are issued and every module, video lesson, template, and workbook included in Capital Academy is made available immediately. Access is self-paced and continues for the lifetime of the program, including future curriculum updates, subject to this Agreement.\n' ||
    E'7. Your right to cancel\n' ||
    E'7.1 You may cancel this Agreement for any reason, without penalty and without giving a reason, by notifying us in writing at any time before midnight of the third business day after the date you signed it. If you cancel within that period, we will refund everything you have paid within fifteen (15) days of receiving your notice.\n' ||
    E'7.2 To cancel, send written notice to support@tryfundhub.com, or by mail to Fundhub Education, 218 Bostick Rd 64, Bowling Green, FL 33834. Your notice is effective on the date you send it. Keep a copy.\n' ||
    E'7.3 You do not have to give a reason and we will not ask you to complete any form or speak to anyone to exercise this right.\n' ||
    E'8. Refunds after the cancellation period\n' ||
    E'8.1 After the period in Section 7.1 ends, tuition is non-refundable, because the program is delivered in full at that point and its materials can be copied and retained.\n' ||
    E'8.2 Section 8.1 does not limit any right you have under applicable law, and it does not apply where we fail to deliver the program.\n' ||
    E'8.3 We may suspend or end your access without refund if you breach Section 10, and only for that reason.\n' ||
    E'9. Intellectual property\n' ||
    E'9.1 All videos, curriculum, templates, workbooks, text, and design elements are owned by Fundhub LLC or its licensors and are protected by copyright and other laws.\n' ||
    E'9.2 You receive a limited, personal, non-exclusive, non-transferable licence to use the materials for your own education.\n' ||
    E'9.3 You may not copy, distribute, resell, publish, or create derivative works from the materials, or use them to provide services to anyone else.\n' ||
    E'10. Acceptable use\n' ||
    E'10.1 You will use the program only for lawful purposes.\n' ||
    E'10.2 You will not use any template or material to submit information you know to be false or inaccurate to any credit bureau, creditor, lender, or other party, and you will not misrepresent your identity or engage in any deceptive practice. Doing so may be a crime. It is also a breach of this Agreement.\n' ||
    E'11. Your information\n' ||
    E'11.1 We handle the information you give us in line with applicable privacy law and our published privacy notice.\n' ||
    E'11.2 We collect what we need to deliver the program and support you. We do not sell your personal information.\n' ||
    E'11.3 You choose what you share with us. If you decline to provide information we ask for, we may be unable to deliver part of the program.\n' ||
    E'12. Disclaimers\n' ||
    E'12.1 The program is provided “as is” and “as available,” without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.\n' ||
    E'12.2 Laws, credit reporting practices, and lending criteria change. We work to keep the curriculum current, but we do not warrant that every material is error-free or up to date at all times.\n' ||
    E'13. Limitation of liability\n' ||
    E'13.1 To the maximum extent permitted by law, Fundhub LLC and its members, managers, employees, and contractors will not be liable for indirect, incidental, consequential, special, or punitive damages, or for lost profits, revenue, or data, arising from or related to the program.\n' ||
    E'13.2 Our total aggregate liability arising out of or relating to this Agreement will not exceed the tuition you actually paid.\n' ||
    E'13.3 Nothing in this Agreement limits liability that cannot be limited by law, including liability for fraud.\n' ||
    E'14. Governing law and disputes\n' ||
    E'14.1 This Agreement is governed by the laws of the State of Florida, without regard to its conflict of laws rules.\n' ||
    E'14.2 We will first try to resolve any dispute informally. Contact us at support@tryfundhub.com and we will work with you in good faith for thirty (30) days.\n' ||
    E'14.3 If we cannot resolve it, the dispute will be settled by binding arbitration before a single arbitrator administered by the American Arbitration Association under its Consumer Arbitration Rules. Either of us may instead bring an individual claim in small claims court if it qualifies.\n' ||
    E'14.4 Arbitration is on an individual basis. Class and representative proceedings are not permitted.\n' ||
    E'15. General\n' ||
    E'15.1 This Agreement is the entire agreement between us about this program and replaces any prior discussion, proposal, or statement, including anything said on a sales call that is not written here.\n' ||
    E'15.2 Any change must be in writing and signed by both of us.\n' ||
    E'15.3 If a provision is held unenforceable, it is modified to the least extent needed to be enforceable, or severed, and the rest stays in effect.\n' ||
    E'15.4 You may not assign this Agreement. We may assign it to a successor in a merger or sale of substantially all assets.\n' ||
    E'15.5 Sections 3, 8, 9, 12, 13, 14, and 15 survive the end of this Agreement.\n' ||
    E'15.6 This Agreement may be signed in counterparts and by electronic signature.\n' ||
    E'Acknowledgement\n' ||
    E'By signing, you confirm that you have read this Agreement, that you understand this program is educational, that no credit, funding, or financial result has been promised to you, and that you have received a copy of it.\n' ||
    E'STUDENT\n' ||
    E'\n' ||
    E'Signature\n' ||
    E'\n' ||
    E'Print name\n' ||
    E'\n' ||
    E'Date\n' ||
    E'FUNDHUB EDUCATION\n' ||
    E'\n' ||
    E'Signature\n' ||
    E'\n' ||
    E'Print name and title\n' ||
    E'\n' ||
    E'Date\n' ||
    E'Fundhub Education is a program of Fundhub LLC  |  tryfundhub.com  |  support@tryfundhub.com',
       manual_fields = '[]'::jsonb,
       updated_at = now()
 WHERE template_key = 'FUNDING-MASTERY-AGREEMENT'
   AND body LIKE '%THIS IS NOT THE REAL AGREEMENT TEXT%';

-- ── CAPITAL BLUEPRINT — Service Agreement ──
UPDATE contract_templates
   SET body =
         E'Date: {{today}}\n' ||
         E'Prepared for: {{contact.full_name}}\n' ||
         E'Email: {{contact.email}}\n\n' ||
    E'CAPITAL BLUEPRINT\n' ||
    E'Service Agreement\n' ||
    E'Fundhub Education — a program of Fundhub LLC\n' ||
    E'\n' ||
    E'This Agreement is between you, the person enrolling (“you” or “Student”), and Fundhub LLC, a Florida limited liability company doing business as Fundhub Education, of 218 Bostick Rd 64, Bowling Green, FL 33834 (“Fundhub Education,” “we,” or “us”).\n' ||
    E'By signing below or by purchasing the program, you agree to these terms. Please read Section 3 and Section 7 carefully.\n' ||
    E'At a glance\n' ||
    E'What you get\n' ||
    E'• A structured intake covering your business and credit position\n' ||
    E'• A written Blueprint document prepared for your situation\n' ||
    E'• A plain-English explanation of common lender criteria and where you sit against them\n' ||
    E'• A suggested sequence of steps, with the reasoning for the order\n' ||
    E'• One round of written clarification questions after delivery\n' ||
    E'• The delivered Blueprint is yours to keep\n' ||
    E'What this is not\n' ||
    E'• This is educational. It is not financial, legal, tax, or investment advice\n' ||
    E'• We do not contact any credit bureau, creditor, or lender for you\n' ||
    E'• We do not prepare, sign, or submit any document on your behalf\n' ||
    E'• We do not apply for funding for you or broker any loan\n' ||
    E'• It is not a guarantee that any lender will approve you\n' ||
    E'• No credit score, dispute result, or funding amount is promised\n' ||
    E'This box is a plain-language summary. The numbered sections below are the actual terms and control if there is any difference.\n' ||
    E'1. What this program is\n' ||
    E'1.1 Capital Blueprint is a one-time educational assessment and written plan. Fundhub Education reviews the information you provide about your situation, and produces a written document that explains where you currently stand against common lender criteria, what the gaps appear to be, and the sequence of steps you may choose to work through to close them.\n' ||
    E'1.2 The Blueprint describes options and explains reasoning. It does not tell you what to do, and it is not a recommendation that you take any particular financial action. Every decision, document, and application arising from it is yours, made at your own discretion, in your own name.\n' ||
    E'1.3 The tuition for this program is five thousand United States dollars ($5,000).\n' ||
    E'2. What we are not\n' ||
    E'2.1 Fundhub Education is not a lender, loan broker, financing company, financial advisor, investment advisor, accountant, law firm, or credit repair organization. Nothing in this program is lending, brokering, financial advice, legal advice, tax advice, or credit repair services.\n' ||
    E'2.2 We do not contact credit bureaus, creditors, lenders, or any other third party on your behalf, and we do not act as your agent with any of them.\n' ||
    E'2.3 Because we perform no service on your behalf with any third party, we do not hold ourselves out as, and do not act as, a credit repair organization.\n' ||
    E'3. No guarantees\n' ||
    E'3.1 We make no representation or guarantee about credit scores, score increases, dispute outcomes, the removal of any information from a credit report, lending or credit approval, funding amounts, income, or business results.\n' ||
    E'3.2 Results depend entirely on your own circumstances and your own actions. Any example, figure, or case used in the materials illustrates a concept. It is not a promise of a result, and it is not typical.\n' ||
    E'3.3 Accurate and timely information cannot be removed from a credit report. Any material that appears to suggest otherwise is superseded by this section.\n' ||
    E'4. Eligibility and your account\n' ||
    E'4.1 You must be at least 18 years old and able to enter a binding contract.\n' ||
    E'4.2 You are responsible for keeping your login credentials confidential and for all activity under your account.\n' ||
    E'4.3 Your access is personal to you. It may not be shared, resold, or transferred, and it may not be used to provide services to anyone else.\n' ||
    E'5. Tuition and payment\n' ||
    E'5.1 Tuition is five thousand dollars ($5,000), charged one time. There is no recurring billing and no subscription.\n' ||
    E'5.2 Payments are processed by independent third-party payment providers.\n' ||
    E'5.3 If an installment or financing option is offered at checkout, that option comes from an independent third-party provider under its own terms and its own approval criteria. Fundhub Education is not the lender and is not a party to that financing agreement. If that provider approves you, your obligation to repay it is separate from this Agreement and continues even if this Agreement ends.\n' ||
    E'6. Delivery\n' ||
    E'6.1 The Blueprint is delivered digitally within fifteen (15) business days after Fundhub Education receives your completed intake and every item of information it requests from you. If you do not return requested information, that period is extended day for day. You may submit written clarification questions once within thirty (30) days after delivery, and Fundhub Education will respond in writing.\n' ||
    E'7. Your right to cancel\n' ||
    E'7.1 You may cancel this Agreement for any reason, without penalty and without giving a reason, by notifying us in writing at any time before midnight of the third business day after the date you signed it. If you cancel within that period, we will refund everything you have paid within fifteen (15) days of receiving your notice.\n' ||
    E'7.2 To cancel, send written notice to support@tryfundhub.com, or by mail to Fundhub Education, 218 Bostick Rd 64, Bowling Green, FL 33834. Your notice is effective on the date you send it. Keep a copy.\n' ||
    E'7.3 You do not have to give a reason and we will not ask you to complete any form or speak to anyone to exercise this right.\n' ||
    E'8. Refunds after the cancellation period\n' ||
    E'8.1 After the period in Section 7.1 ends, tuition is refundable only if we have not yet delivered the Blueprint. Once the Blueprint is delivered, tuition is non-refundable, because the written plan can be copied and retained.\n' ||
    E'8.2 Section 8.1 does not limit any right you have under applicable law, and it does not apply where we fail to deliver the program.\n' ||
    E'8.3 We may suspend or end your access without refund if you breach Section 10, and only for that reason.\n' ||
    E'9. Intellectual property\n' ||
    E'9.1 All videos, curriculum, templates, workbooks, text, and design elements are owned by Fundhub LLC or its licensors and are protected by copyright and other laws.\n' ||
    E'9.2 You receive a limited, personal, non-exclusive, non-transferable licence to use the materials for your own education.\n' ||
    E'9.3 You may not copy, distribute, resell, publish, or create derivative works from the materials, or use them to provide services to anyone else.\n' ||
    E'10. Acceptable use\n' ||
    E'10.1 You will use the program only for lawful purposes.\n' ||
    E'10.2 You will not use any template or material to submit information you know to be false or inaccurate to any credit bureau, creditor, lender, or other party, and you will not misrepresent your identity or engage in any deceptive practice. Doing so may be a crime. It is also a breach of this Agreement.\n' ||
    E'11. Your information\n' ||
    E'11.1 We handle the information you give us in line with applicable privacy law and our published privacy notice.\n' ||
    E'11.2 We collect what we need to deliver the program and support you. We do not sell your personal information.\n' ||
    E'11.3 You choose what you share with us. If you decline to provide information we ask for, we may be unable to deliver part of the program.\n' ||
    E'12. Disclaimers\n' ||
    E'12.1 The program is provided “as is” and “as available,” without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.\n' ||
    E'12.2 Laws, credit reporting practices, and lending criteria change. We work to keep the curriculum current, but we do not warrant that every material is error-free or up to date at all times.\n' ||
    E'13. Limitation of liability\n' ||
    E'13.1 To the maximum extent permitted by law, Fundhub LLC and its members, managers, employees, and contractors will not be liable for indirect, incidental, consequential, special, or punitive damages, or for lost profits, revenue, or data, arising from or related to the program.\n' ||
    E'13.2 Our total aggregate liability arising out of or relating to this Agreement will not exceed the tuition you actually paid.\n' ||
    E'13.3 Nothing in this Agreement limits liability that cannot be limited by law, including liability for fraud.\n' ||
    E'14. Governing law and disputes\n' ||
    E'14.1 This Agreement is governed by the laws of the State of Florida, without regard to its conflict of laws rules.\n' ||
    E'14.2 We will first try to resolve any dispute informally. Contact us at support@tryfundhub.com and we will work with you in good faith for thirty (30) days.\n' ||
    E'14.3 If we cannot resolve it, the dispute will be settled by binding arbitration before a single arbitrator administered by the American Arbitration Association under its Consumer Arbitration Rules. Either of us may instead bring an individual claim in small claims court if it qualifies.\n' ||
    E'14.4 Arbitration is on an individual basis. Class and representative proceedings are not permitted.\n' ||
    E'15. General\n' ||
    E'15.1 This Agreement is the entire agreement between us about this program and replaces any prior discussion, proposal, or statement, including anything said on a sales call that is not written here.\n' ||
    E'15.2 Any change must be in writing and signed by both of us.\n' ||
    E'15.3 If a provision is held unenforceable, it is modified to the least extent needed to be enforceable, or severed, and the rest stays in effect.\n' ||
    E'15.4 You may not assign this Agreement. We may assign it to a successor in a merger or sale of substantially all assets.\n' ||
    E'15.5 Sections 3, 8, 9, 12, 13, 14, and 15 survive the end of this Agreement.\n' ||
    E'15.6 This Agreement may be signed in counterparts and by electronic signature.\n' ||
    E'Acknowledgement\n' ||
    E'By signing, you confirm that you have read this Agreement, that you understand this program is educational, that no credit, funding, or financial result has been promised to you, and that you have received a copy of it.\n' ||
    E'STUDENT\n' ||
    E'\n' ||
    E'Signature\n' ||
    E'\n' ||
    E'Print name\n' ||
    E'\n' ||
    E'Date\n' ||
    E'FUNDHUB EDUCATION\n' ||
    E'\n' ||
    E'Signature\n' ||
    E'\n' ||
    E'Print name and title\n' ||
    E'\n' ||
    E'Date\n' ||
    E'Fundhub Education is a program of Fundhub LLC  |  tryfundhub.com  |  support@tryfundhub.com',
       manual_fields = '[]'::jsonb,
       updated_at = now()
 WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'
   AND body LIKE '%THIS IS NOT THE REAL AGREEMENT TEXT%';

-- A loud, harmless record of what is still waiting on Chris. Shows in the deploy
-- log; changes no row.
DO $notice$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM contract_templates
   WHERE body LIKE '%THIS IS NOT THE REAL AGREEMENT TEXT%';
  IF n > 0 THEN
    RAISE NOTICE 'STILL PLACEHOLDER, do not send: % template(s) - FUNDING-AGREEMENT and CREDIT-REPAIR-AGREEMENT have no supplied text', n;
  END IF;
END $notice$;

COMMIT;
