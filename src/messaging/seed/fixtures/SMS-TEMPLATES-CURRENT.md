# FIXTURE — shaped like fundhub-docs/sources/SMS-TEMPLATES-CURRENT.md

Not real copy. Exercises `## KEY` headings, plain-text bodies, and an empty body.

## SMS-FIX-01-PLAIN

Hey {{contact.first_name}}, line one.
Line two with {{custom_values.booking_link}}. Reply STOP to opt out.

## SMS-FIX-02-SINGLE

Single line body. Reply STOP to opt out.

## SMS-CLEAN-01-PLAIN

Body sits directly under the header. Reply STOP to opt out.

## SMS-BROKEN-01-EMPTY

## SMS-F03-01-ROUND-SUBMITTED

Fundhub update, {{contact.first_name}}: Round {{custom_fields.funding_round_number}} has been submitted. Partner banks usually review within 24 to 72 hours, sometimes longer. We'll text you the moment there's movement. What happens next: {{custom_values.funding_round_next_steps_video_link}} Reply STOP to opt out.
