-- 004 — dedup index for the comms handlers (replay-safe, Rule 9).
-- A message provider ref (Twilio MessageSid, Bland call_id) is unique per org, so a
-- re-delivered / replayed inbound-SMS or completed-call event can ON CONFLICT DO
-- NOTHING instead of inserting a duplicate messages row.
CREATE UNIQUE INDEX IF NOT EXISTS messages_org_providerref_uniq
  ON messages (org_id, provider_ref)
  WHERE provider_ref IS NOT NULL;
