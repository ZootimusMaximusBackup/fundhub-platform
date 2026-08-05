# Demo Mode
Toggle orgs.demo_mode_enabled. On seeds+shows. Off hides. Wipe deletes.
Money always excludes is_demo. Banner via shell.js data-fh-demo-banner.

UI coverage seed (`src/demo/seed-ui-coverage.mjs`): bank/entities/bills,
tasks, documents, subscriptions/cards, staff_targets, events, hiring
candidates, journeys. Client-scoped screens auto-open Avery Cobalt via
`public/app/demo-client-bootstrap.js` when Demo Mode is on and no id is set.
