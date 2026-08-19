-- 236_partner_brand_effective_address.sql — give the Business address field a
-- way home.
--
-- THE DEFECT. partner_brand.entity_address has existed since 043 and
-- api/partner-brand.mjs has always accepted it (it is in WRITABLE, and validate()
-- caps it at 500 characters). But v_partner_brand_effective — the ONLY thing the
-- GET and the PUT ever select from — never listed the column. So the address a
-- partner typed went into the table and could never come back out: reload the
-- Brand Studio screen and the field was empty again, with no error anywhere to
-- say why. Write-only storage reads to a person as "it did not save".
--
-- WHAT THIS FIELD ACTUALLY DOES TODAY, stated plainly because an earlier draft
-- of this header overstated it. Nothing in this codebase injects entity_address
-- into any template, disclosure, page or email. Migration 043's header says the
-- address is INTENDED for the BS-05 disclosure master template; that intent has
-- never been built. Its only live consumers are WRITABLE in
-- api/partner-brand.mjs, this view, and the Brand Studio box. The reason to fix
-- it is smaller and still real: a partner types an address, is told nothing went
-- wrong, and can never see it again.
--
-- WHY A NEW FILE AND NOT AN EDIT TO 043. db/migrate.mjs records each file in
-- schema_migrations keyed '<dir>/<file>'. 043 is already applied everywhere, so
-- editing it changes nothing on any database that has run it — a silent no-op.
-- A superseding file is the only edit that lands.
--
-- WHY entity_address IS LAST IN THE SELECT LIST. CREATE OR REPLACE VIEW may only
-- APPEND columns; inserting one next to entity_name where it belongs logically
-- would fail with "cannot change name of view column". The rest of the list is
-- copied verbatim from 043, same order, same COALESCE fallbacks.
--
-- NO FALLBACK ON THE NEW COLUMN, on purpose. entity_name coalesces to the
-- partner's name because an unstyled screen still needs something to print.
-- An address has no honest substitute: NULL means "we do not have one", and that
-- is exactly what the screen should show — an empty box the partner can fill,
-- not a guess.

CREATE OR REPLACE VIEW v_partner_brand_effective AS
SELECT p.id AS partner_id,
       p.org_id,
       p.slug,
       COALESCE(b.entity_name, p.brand_name, p.name)      AS entity_name,
       b.wordmark_url,
       COALESCE(b.ink, '#0A0A0A')                          AS ink,
       COALESCE(b.paper, '#FCFCFC')                        AS paper,
       COALESCE(NULLIF(b.ramp, '[]'::jsonb), '[]'::jsonb)  AS ramp,
       b.display_face,
       b.mono_face,
       b.voice,
       b.support_email,
       b.domain,
       b.domain_verified,
       COALESCE(b.selected_funnels, '[]'::jsonb)           AS selected_funnels,
       COALESCE(b.approval_status, 'draft')                AS approval_status,
       b.entity_address                                    AS entity_address
  FROM partners p
  LEFT JOIN partner_brand b ON b.partner_id = p.id;
