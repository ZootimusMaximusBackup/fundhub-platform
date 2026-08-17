-- 173_specialist_role_name.sql
-- Owner 2026-08-17: inquiry_specialist is named Specialist. Same login.
-- They run inquiry removal and credit repair. No new role key.

UPDATE staff_roles
   SET name = 'Specialist',
       description = 'Inquiry removal and credit repair.'
 WHERE key = 'inquiry_specialist';

UPDATE staff
   SET name = 'DEMO Specialist'
 WHERE is_demo IS TRUE
   AND role = 'inquiry_specialist'
   AND email LIKE 'inquiry@%';
