-- 164: outbound cutover — email → Resend, SMS → Twilio. GHL out.
-- Owner 2026-08-14: canceling GHL. Do not dump the paused outbound queue.
-- Only flips routing rows; leaves messages.* untouched.

UPDATE message_channel_routing
SET provider = 'resend', updated_at = now()
WHERE channel = 'email' AND provider = 'mailgun';

UPDATE message_channel_routing
SET provider = 'twilio', updated_at = now()
WHERE channel = 'sms' AND provider = 'ghl_relay';
