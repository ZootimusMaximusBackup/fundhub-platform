# FIXTURE — shaped like fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md
Not real copy. Exercises the header split, duplicate keys (identical and
different), a single-space header, and an empty body.


================================================================================
## EM-01   Plain Template      [folder: (root)]
================================================================================
Subject line one

 Hey {{contact.first_name}},

 Body line with {{sender_name}}.

 Unsubscribe

================================================================================
## EM-02   [folder: T - Series (Testimonials)]
================================================================================
Subject with no name in the header

 Body only.

================================================================================
## EM-DUP   First Of Two      [folder: (root)]
================================================================================
Shared key, different copy A

 Body A.

================================================================================
## EM-DUP   Second Of Two      [folder: F-Series (Funding Round Emails F1–F23)]
================================================================================
Shared key, different copy B

 Body B.

================================================================================
## EM-SAME   Identical Twin      [folder: (root)]
================================================================================
Shared key, identical copy

 Same body.

================================================================================
## EM-SAME   Identical Twin      [folder: (root)]
================================================================================
Shared key, identical copy

 Same body.

================================================================================
## EM-04 Single Space Header   [folder: (root)]
================================================================================
Subject line

 Body line.

================================================================================
## EM-EMPTY   Nothing Below      [folder: (root)]
================================================================================
Only a subject, no body
