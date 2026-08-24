-- 258_staff_notify_booked_call_sms.sql — optional staff text when a call is booked.
--
-- Owner-set 2026-08-23: Chris, the closer, and the sales manager can each get a
-- text when someone books. Off until flipped on Staff & Teams. Phone on the
-- staff row is the destination.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS notify_booked_call_sms boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff.notify_booked_call_sms IS
  'When true, this person gets a text on booking.created. Default off. Flipped on Staff & Teams.';

COMMENT ON COLUMN staff.phone IS
  'Contact phone for roster display and optional staff alerts (booked-call text). Not used for login.';
