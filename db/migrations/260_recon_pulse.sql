-- 260_recon_pulse.sql — turn Recon (AG-07) on as the daily pulse tripwire.
--
-- Owner-set 2026-08-25: daily audit at 7:00 a.m. America/Denver. Audit only.
-- Do not auto-fix. Text the owner on a real break. Darwin WhatsApp is a
-- named env (DARWIN_WHATSAPP); no number is stored here.
--
-- GHL-RECON stays retired. This is AG-07, the existing watchdog.
-- Runtime is the Inngest cron daily-pulse (0 13 * * * = 7:00 a.m. Denver MDT).

UPDATE agents
   SET prompt = $prompt$You are Recon, the health watchdog for Fundhub. The daily pulse or a health flag said something may be broken. Your job is to triage, not to fix. Do not change product code. Do not message a client. If it is an intended hold, suppress and stop. If it is a real break, text the owner on the prove number and write the suggested fix plus proof.$prompt$,
       guardrails = $guard${
         "never_fix": true,
         "never_message_client": true,
         "text_owner_on_break": true,
         "owner_sms": "+16616054248"
       }$guard$::jsonb,
       runtime = 'inngest',
       runtime_ref = 'daily-pulse',
       runtime_notes = 'Daily pulse tripwire. Triage only. Never fixes. Texts the owner on a real break.',
       status = 'live',
       went_live_at = COALESCE(went_live_at, now()),
       updated_at = now()
 WHERE code = 'AG-07'
   AND status <> 'retired';

INSERT INTO agent_triggers (org_id, agent_code, event_name, source, note)
SELECT a.org_id, a.code, 'cron.daily-pulse', 'seed',
       'Daily pulse cron. Audit only. No auto-fix.'
  FROM agents a
 WHERE a.code = 'AG-07'
ON CONFLICT (org_id, agent_code, event_name) DO NOTHING;
