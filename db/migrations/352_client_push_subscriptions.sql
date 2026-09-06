-- 352_client_push_subscriptions.sql — where a client's phone lives, encrypted.
--
-- WHAT A PUSH SUBSCRIPTION IS, AND WHY IT IS A CREDENTIAL AND NOT AN ADDRESS.
-- When a browser grants notification permission it hands back three things: an
-- endpoint URL on the push service (Apple, Google, Mozilla), and two keys
-- (`p256dh` and `auth`). Anyone holding all three can send that phone a
-- notification that renders on its lock screen with our name on it. There is no
-- second factor, no signature we hold that they do not, and the push services
-- do not authenticate the sender beyond the VAPID key the subscription was
-- minted against — which the same holder would also have. So this is a stored
-- credential in the same sense as a Plaid access token, and it is stored the
-- same way: AES-256-GCM at rest, the row id as additional authenticated data,
-- key from PUSH_SUB_ENC_KEY. See src/push/store.mjs, which mirrors
-- src/banking/plaid.mjs deliberately rather than inventing a second pattern.
--
-- NO PLAINTEXT ENDPOINT COLUMN, AND THEREFORE NO PLAIN UNIQUE INDEX ON ONE.
-- A unique index needs something stable and comparable, and a GCM ciphertext is
-- neither (a fresh IV every write makes the same endpoint encrypt differently
-- every time). So the table carries `endpoint_hash`, a SHA-256 over the endpoint
-- URL keyed by nothing — it is not secret material, it is an equality token, and
-- it is one-way, so a database dump does not hand a reader a working endpoint.
-- That is what the "one live row per device" index keys on.
--
-- WHY A HASH IS ENOUGH FOR THAT INDEX AND NOT FOR STORAGE. The hash answers
-- "have I seen this device before"; it cannot answer "where do I send". The
-- ciphertext answers the second and nothing else. Neither column alone is
-- useful to an attacker, and the useful one is unreadable without an env var
-- that lives on Netlify and not in this database.
--
-- ONE ROW PER DEVICE PER CLIENT, NOT PER CLIENT. A person has a phone, a work
-- laptop and a tablet, and a notification that lands on one of the three is a
-- notification they may not see. So there is no "one subscription per client"
-- constraint. What is enforced is that the SAME device registered twice does not
-- become two rows that both get sent to — that is how a client ends up with the
-- same alert twice on one screen, and it is the normal outcome of a re-register
-- after a permission reset, which browsers do routinely.
--
-- DEAD IS A STATE, NOT A DELETE. A push service answers 404 or 410 when a
-- subscription is gone for good (app deleted, permission revoked, browser data
-- cleared). src/push/store.mjs stamps `expired_at` on that answer, and the live
-- index skips expired rows so a re-register from the same device is free to take
-- the slot. The row itself stays so "we stopped being able to reach this client
-- on 14 September" is a fact somebody can read later; nothing about a dead
-- endpoint is worth keeping secret from ourselves and worth losing.
--
-- SAFETY. Creates one table and its indexes. Reads nothing, deletes nothing,
-- rewrites no existing row. Fully reversible by dropping the table.

CREATE TABLE IF NOT EXISTS public.client_push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- WHICH LOGIN REGISTERED IT. ON DELETE SET NULL: an account can be closed and
  -- reopened; the phone it registered is still the client's phone. Nullable so a
  -- future staff-assisted registration is possible without a schema change, but
  -- every registration written today carries one — the endpoints refuse a
  -- principal that is not the client themself.
  account_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,

  -- SHA-256 of the endpoint URL, hex. An equality token for the index below.
  -- Not a secret, not reversible, and NOT sufficient to send anything.
  endpoint_hash text NOT NULL
                CONSTRAINT client_push_subscriptions_endpoint_hash_ck
                CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),

  -- The three pieces of the subscription, each AES-256-GCM sealed against this
  -- row's id. Format "v1:<iv>:<tag>:<ct>", base64 parts — identical to
  -- encryptPlaidToken()'s. A ciphertext lifted into another row does not decrypt.
  encrypted_endpoint text NOT NULL,
  encrypted_p256dh   text NOT NULL,
  encrypted_auth     text NOT NULL,

  -- WHAT KIND OF DEVICE, IN ONE WORD WE CHOSE — never the raw user agent.
  -- A full UA string is a fingerprint and it is not needed to answer the only
  -- question anybody asks of this column ("which of my devices is this?").
  device_label  text
                CONSTRAINT client_push_subscriptions_device_label_ck
                CHECK (device_label IS NULL OR device_label IN ('iphone', 'ipad', 'android', 'desktop', 'other')),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- The last time the push service ACCEPTED something for this endpoint. NULL
  -- means we have never successfully sent to it. NULL is not zero and not a
  -- date: it means unknown, and it must survive as NULL.
  last_success_at timestamptz,

  -- Consecutive soft failures (a 500 from the push service, a timeout). Reset to
  -- 0 on the next success. Not a delete trigger — a push service having a bad
  -- hour must not cost a client their notifications.
  failure_count int NOT NULL DEFAULT 0
                CONSTRAINT client_push_subscriptions_failure_count_ck
                CHECK (failure_count >= 0),

  -- The push service said this endpoint is gone for good (404/410). Terminal.
  expired_at    timestamptz,

  -- The client turned notifications off from the portal. Also terminal, and
  -- deliberately a DIFFERENT column from expired_at: "they asked us to stop" and
  -- "the phone went away" are not the same fact and should never be conflated
  -- when somebody asks later why we stopped sending.
  revoked_at    timestamptz
);

-- ONE LIVE ROW PER DEVICE PER ORG. Scoped by org_id as well as the hash because
-- endpoints are globally unique in practice but that is the push service's
-- promise, not ours, and every other unique index in this schema is org-scoped.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_push_subscriptions_live
  ON public.client_push_subscriptions (org_id, endpoint_hash)
  WHERE expired_at IS NULL AND revoked_at IS NULL;

-- The send path's only lookup: "every live subscription for this client".
CREATE INDEX IF NOT EXISTS ix_client_push_subscriptions_live_by_client
  ON public.client_push_subscriptions (org_id, client_id)
  WHERE expired_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE public.client_push_subscriptions IS
  'Web push subscriptions for the client portal, one row per device. The endpoint and both keys are AES-256-GCM ciphertext bound to the row id (src/push/store.mjs, same pattern as src/banking/plaid.mjs) because together they are a credential: anyone holding them can put a notification on that phone''s lock screen. endpoint_hash is a one-way equality token for the live-row index and cannot be sent to.';

COMMENT ON COLUMN public.client_push_subscriptions.expired_at IS
  'Set when the push service answered 404 or 410 — the endpoint is gone for good. Terminal, and distinct from revoked_at, which is the client asking us to stop.';

COMMENT ON COLUMN public.client_push_subscriptions.last_success_at IS
  'Last time the push service accepted a message for this endpoint. NULL means never, and NULL must survive as NULL — it is not a zero date.';

-- ---------------------------------------------------------------------------
-- RLS + grants — the shape every table added since 109 uses.
-- ---------------------------------------------------------------------------
-- Permissive policy, not isolation. Access control for this table is the GRANTs
-- below plus the principal check in api/push/*.mjs, which pins every call to the
-- caller's own client_id. RLS is enabled only so the table can never sit in the
-- bare-RLS deny-all state 109 documents.
ALTER TABLE public.client_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_push_subscriptions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'client_push_subscriptions'
       AND policyname = 'client_push_subscriptions_app_all'
  ) THEN
    CREATE POLICY client_push_subscriptions_app_all ON public.client_push_subscriptions
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_push_subscriptions TO fundhub_app;
  END IF;
END $$;
