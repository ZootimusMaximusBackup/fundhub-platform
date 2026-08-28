-- 270_staff_avatar_key.sql — storage key for an employee's own profile photo.
--
-- Nullable: most staff rows will never set one. Opaque string, not a URL —
-- same contract as document_versions.storage_key in src/documents/store.mjs
-- (a bearer credential under some providers), so it is never selected by any
-- read that returns rows to a caller. GET /api/staff/avatar resolves it
-- server-side and streams bytes back; it is never handed out directly.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS avatar_key text;

COMMENT ON COLUMN staff.avatar_key IS
  'Opaque storage key (src/documents/store.mjs provider) for this staff member''s own uploaded profile photo. Null until they upload one. Never return this value in an API response — resolve and stream server-side via GET /api/staff/avatar.';
