# W-MSG

Messaging on the simulated file. Findings only. No send.

Ground truth for “send a message” is **MISSING** from intended journeys. This unit used Chris’s 2026-08-18 order. W1 / W6 / G3 sent on the old test file and failed (no phone, or compose said no email). This file has both.

## What I proved

1. Simulate did plant an email and a phone on this file. Email is `sim+1787079946953@demo.fundhub.local`. Phone is a fake +1555… number (11 digits). Demo flag is on.

2. Live Messaging opens this person. The right side shows that same demo email (it is cut off a bit) and the +1555… phone. Channel is Text. There is no “To” box. Staff cannot type the test inbox or the test phone. The send path only uses the stored email / phone.

3. `FUNDHUB_TEST_INBOX` is set: **yes**. It is **not** this demo address. `FUNDHUB_TEST_PHONE` is set: **yes**. It is **not** this +1555… number. I did not send. A send would have gone to the fake demo email or the fake 555 phone — not a watched inbox, and not a real person. The demo address is not a real mailbox.

4. Inbox landing: **not proven**. No row was written. I did not invent a landing.

5. SMS: **not tried**. The stored phone is not the test phone. A2P was not reached.

6. `message.*` events on this file: **0**.

## vs the old test file

W1 / W6 / G3: old file had no phone, or compose said no email, and Send failed.

This file: email and phone are there. Send would run. The destination is still the fake demo address / 555 number, not the test inbox or test phone.

W-TEAR: this unit wrote **no** new rows.
