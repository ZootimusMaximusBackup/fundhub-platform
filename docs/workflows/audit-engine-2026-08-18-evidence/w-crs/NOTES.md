# W-CRS findings

Ground truth for this machine is missing. Intended journeys do not name emit → events → desks. The Client Control Panel spec file is also missing. These checks follow Chris’s 2026-08-18 board only.

## What worked

- The simulated credit file is real. Scores 718 / 724 / 731. Utilization 18. Estimate $125,000. Four cards.
- `emitCrsResult()` wrote two events: analysis.completed and decision.rendered. Not duplicates.
- Only one listener on the live bus ran: client-lifecycle. It wrote the scores onto the credit-result row. It wrote the $125,000 estimate onto the client. It moved the pipeline card from new lead to decision rendered.
- The live Client Control Panel shows the three scores and $125,000 for this person.

## What is broken

1. **Simulate left the client blank.** The tier said FULL_FUNDING before emit. Scores, utilization, and the money estimate were all empty on the client. After emit the money estimate landed. Scores and utilization still do not live on the client row. They only live on the credit-result blob.
2. **Utilization does not show on Client Control Panel.** The API has 18% (good). The screen has no utilization box.
3. **Closer dashboard does not paint this file.** The tradeline API returns four cards and $37,150 available. The live closer page stays on dashes. It also never shows 718 / 724 / 731 or $125,000.
4. **c-06 did not run on the live site.** Inngest is off (owner rule). A local run of its handle() would take the funding path and tag `path:funding`. It would not write funding letters — the letter pack said there are no bureau reports to score.

## Not ours

- A `docs.received` event is already on this client from another unit (FTC upload). We did not emit it.
- We did not turn on Inngest. We did not call a bureau. We did not tear down the simulated client.
