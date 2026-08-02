-- 123_journey_copy_double_brace.sql — backfills any journey step copy already
-- saved with single-brace merge tags ({first_name}) to double-brace
-- ({{first_name}}), the only form src/lib/render-template.mjs's TOKEN_RE
-- actually matches.
--
-- WHY THIS EXISTS. public/app/journeys.html (the Journeys editor) seeded and
-- wrote its sms/email step bodies with single braces from the day the journeys
-- table (113) started accepting writes. A single-brace tag is not a token to
-- the renderer — it is three ordinary characters — so any journey copy saved
-- in that window would, if it were ever rendered the way message_templates
-- copy is, send a client the literal brace characters instead of their name.
-- The editor and api/journeys.mjs's PUT handler are fixed in the same change
-- that adds this file (src/journeys/copy-tags.mjs blocks a new single-brace
-- save outright); this migration is the one-time cleanup for whatever a
-- deployment already has stored.
--
-- IDEMPOTENT ON PURPOSE, same convention as every migration in this
-- directory: the fix only ever touches a lone {tag}, never a correct
-- {{tag}}, so re-running this against already-fixed data is a no-op, not a
-- double-wrap into {{{{tag}}}}. Verified by hand against a real database
-- (not just reasoned about): running the fix twice on the same string
-- returns byte-identical output both times.
--
-- WHY A CHARACTER SCAN INSTEAD OF A REGEX. The first version of this file
-- used a three-pass regexp_replace (protect real {{tag}} tokens behind
-- sentinels, wrap any lone {tag} left, restore the sentinels). Manual testing
-- against this same database turned up cases where that produced inconsistent
-- results for reasons that were never fully run to ground, which is a bad
-- trait for something running once against every row with no chance to
-- review each change before it lands. A single left-to-right scan — is this
-- brace the start of a real {{tag}}, copy it through untouched; is it a lone
-- {tag}, wrap it; anything else, copy it through — has no such ambiguity: it
-- looks at one place in the string at a time and never re-interprets text a
-- previous pass already decided about. Confirmed idempotent and correct
-- against real Postgres, including the em-dash character this app's SMS copy
-- actually uses, spaced tokens ({{ first_name }}), adjacent tags with no
-- separating text, and malformed input (unmatched braces, empty {}, a
-- triple-braced tag) — every malformed case is left exactly as found rather
-- than guessed at.

CREATE OR REPLACE FUNCTION _journey_copy_fix_single_brace(txt text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  result text := '';
  i int := 1;
  n int;
  c1 text;
  c2 text;
  close_pos int;
  tag text;
BEGIN
  IF txt IS NULL THEN
    RETURN NULL;
  END IF;
  n := length(txt);
  WHILE i <= n LOOP
    c1 := substr(txt, i, 1);
    IF c1 = '{' THEN
      c2 := substr(txt, i + 1, 1);
      IF c2 = '{' THEN
        -- Looks like the start of a real {{...}} token (whatever is between
        -- the braces, even malformed) — copy through to its closing "}}"
        -- untouched, so this pass can never re-wrap it.
        close_pos := position('}}' in substr(txt, i));
        IF close_pos = 0 THEN
          result := result || substr(txt, i);
          i := n + 1;
        ELSE
          result := result || substr(txt, i, close_pos + 1);
          i := i + close_pos + 1;
        END IF;
      ELSE
        -- A single '{'. Only wrap it if what follows, up to the next '}', is
        -- a clean tag name — anything else (no closing brace at all, or
        -- punctuation/spaces inside) is left exactly as found rather than
        -- guessed at.
        close_pos := position('}' in substr(txt, i + 1));
        IF close_pos = 0 THEN
          result := result || substr(txt, i);
          i := n + 1;
        ELSE
          tag := substr(txt, i + 1, close_pos - 1);
          IF tag ~ '^[a-zA-Z0-9_]+$' THEN
            result := result || '{{' || tag || '}}';
          ELSE
            result := result || '{' || tag || '}';
          END IF;
          i := i + 1 + close_pos;
        END IF;
      END IF;
    ELSE
      result := result || c1;
      i := i + 1;
    END IF;
  END LOOP;
  RETURN result;
END;
$fn$;

-- One node: fixes cfg.body / cfg.subject if present, and recurses into every
-- condition branch. A journey tree is at most a handful of nodes deep in
-- practice (the editor nests branches one condition at a time), but this
-- walks however deep the stored JSON actually goes rather than assuming it.
CREATE OR REPLACE FUNCTION _journey_node_fix_copy(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  result jsonb := node;
  branch jsonb;
  fixed_branches jsonb := '[]'::jsonb;
  fixed_branch_nodes jsonb;
BEGIN
  IF jsonb_typeof(node->'cfg') = 'object' THEN
    IF jsonb_typeof(node->'cfg'->'body') = 'string' THEN
      result := jsonb_set(result, '{cfg,body}', to_jsonb(_journey_copy_fix_single_brace(node->'cfg'->>'body')));
    END IF;
    IF jsonb_typeof(node->'cfg'->'subject') = 'string' THEN
      result := jsonb_set(result, '{cfg,subject}', to_jsonb(_journey_copy_fix_single_brace(node->'cfg'->>'subject')));
    END IF;
  END IF;

  IF jsonb_typeof(node->'branches') = 'array' THEN
    FOR branch IN SELECT * FROM jsonb_array_elements(node->'branches')
    LOOP
      IF jsonb_typeof(branch->'nodes') = 'array' THEN
        SELECT COALESCE(jsonb_agg(_journey_node_fix_copy(n)), '[]'::jsonb)
          INTO fixed_branch_nodes
          FROM jsonb_array_elements(branch->'nodes') AS n;
      ELSE
        fixed_branch_nodes := '[]'::jsonb;
      END IF;
      fixed_branches := fixed_branches || jsonb_build_array(jsonb_set(branch, '{nodes}', fixed_branch_nodes));
    END LOOP;
    result := jsonb_set(result, '{branches}', fixed_branches);
  END IF;

  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION _journey_nodes_fix_copy(nodes jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(jsonb_agg(_journey_node_fix_copy(n)), '[]'::jsonb)
  FROM jsonb_array_elements(nodes) AS n;
$fn$;

UPDATE journeys SET nodes = _journey_nodes_fix_copy(nodes);

-- One-time backfill helpers, not part of the app's runtime schema — dropped
-- once the UPDATE above has used them. src/journeys/copy-tags.mjs is the
-- version of this logic the app actually runs going forward.
DROP FUNCTION _journey_nodes_fix_copy(jsonb);
DROP FUNCTION _journey_node_fix_copy(jsonb);
DROP FUNCTION _journey_copy_fix_single_brace(text);
