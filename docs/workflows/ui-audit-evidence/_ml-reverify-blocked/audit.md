# ML re-verify blocked — live site paused

Ran 2026-08-17T19:54:31.433196+00:00 against https://fundhub.ai.

Playwright GET /login.html → HTTP 503, title "Site not available".
Body: "This site was paused as it reached its usage limits."

curl -sI https://fundhub.ai/login.html → HTTP/2 503, server Netlify, content-type application/json.

No role could sign in. No screen was re-checked. No board row was restamped.

Evidence: docs/workflows/ui-audit-evidence/_ml-reverify-blocked/fundhub-ai-paused-503.png
