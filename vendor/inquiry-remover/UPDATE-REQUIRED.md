# Update required before this tree goes live

Do not wire `vendor/inquiry-remover/` into the app until these are handled.

## 1. Bureau flow changed — upload first, then wait, then call

**Owner-set.** Experian (and later Equifax / TransUnion) now require documents uploaded to the bureau portal first, then a wait, then the call.

What that means for this tree:

- Calling stays. The outbound call path is still the product.
- Prompts change. The bureau-agent prompts (`src/agents/experian-prompt.js`, and later Equifax / TransUnion) must describe the upload-first sequence, not a call-first sequence.
- Call scheduling must change. Schedule the call only after the upload wait, not as the first step.

Do not ship a wire-up that still tells the agent to call as if the portal upload already happened when it has not.

## 2. Open question — voice provider (not blocking)

Revisit whether Bland is still the right voice provider, or whether a cheaper stack should replace it.

Not a blocker for wiring. Capture the decision when it is made; until then, leave Bland as the current path in this tree.
