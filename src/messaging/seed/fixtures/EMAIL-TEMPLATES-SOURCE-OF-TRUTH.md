# FIXTURE — shaped like fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md
Not real copy. Exercises the header split, duplicate keys (identical and
different), a single-space header, and an empty body.

EM-EMPTY deliberately has NO body and NO signature block. The 2026-08-21 footer
sweep pasted the Josh signature onto it too, which made the empty case non-empty
and silently deleted the only test of a subject with nothing under it. Leave that
block without a footer.


================================================================================
## EM-01   Plain Template      [folder: (root)]
================================================================================
Subject line one

 Hey {{contact.first_name}},

 Body line with {{sender_name}}.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-02   [folder: T - Series (Testimonials)]
================================================================================
Subject with no name in the header

 Body only.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-DUP   First Of Two      [folder: (root)]
================================================================================
Shared key, different copy A

 Body A.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-DUP   Second Of Two      [folder: F-Series (Funding Round Emails F1–F23)]
================================================================================
Shared key, different copy B

 Body B.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-SAME   Identical Twin      [folder: (root)]
================================================================================
Shared key, identical copy

 Same body.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-SAME   Identical Twin      [folder: (root)]
================================================================================
Shared key, identical copy

 Same body.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-04 Single Space Header   [folder: (root)]
================================================================================
Subject line

 Body line.

– Josh
FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

================================================================================
## EM-EMPTY   Nothing Below      [folder: (root)]
================================================================================
Only a subject, no body


