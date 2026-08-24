-- 016_s04_confirm_portal_link.sql
-- Owner 2026-08-23: booking confirm carries portal access. Seed 012 already
-- applied on live, so this file updates the stored body. Copy is the existing
-- portal-login sentence from EMAIL-PORTAL-MAGIC-LINK — no new marketing.

UPDATE message_templates
   SET body = replace(
         body,
         E'<p style="margin:0 0 16px 0;">A member of the Fundhub team will walk you through your file and the options it supports. Nothing to prepare — just be somewhere you can talk.</p>',
         E'<p style="margin:0 0 16px 0;">Here is your link to sign in to your Fundhub portal:</p>\n'
         || E'            <p style="margin:0 0 16px 0;"><a href="{{magic_link.url}}" style="color:#1D4ED8;">{{magic_link.url}}</a></p>\n'
         || E'            <p style="margin:0 0 16px 0;">A member of the Fundhub team will walk you through your file and the options it supports. Nothing to prepare — just be somewhere you can talk.</p>'
       ),
       updated_at = now()
 WHERE template_key = 'EMAIL-S04-01-CONFIRM'
   AND body NOT LIKE '%{{magic_link.url}}%';
