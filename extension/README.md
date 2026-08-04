# Fundhub Proxy Apply (Chrome extension)

One-click residential proxy for the Fundhub **Apply** flow. When a funding advisor clicks Apply on a lender, this extension turns on an Oxylabs residential exit near the client’s home city, opens the bank application URL, and shows an unmissable **ACTIVE** badge with the granted city.

## Install (unpacked — current path)

1. Open Chrome → `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. Pin the extension so the badge stays visible
5. Reload any open Fundhub CRM tabs

The CRM detects the extension automatically. If it is missing, Apply shows the manual proxy string instead and says plainly that routing is **not** active.

## What it does

1. CRM calls `POST /api/proxy/launch` (server builds Oxylabs username with city/sessid, verifies exit IP via `https://ip.oxylabs.io/location`, logs `proxy_sessions`)
2. CRM posts a launch message to this extension (via content script)
3. Extension sets a **PAC** proxy config pointing at `pr.oxylabs.io:7777`
4. Extension answers proxy auth via `webRequest.onAuthRequired` (no password prompt)
5. Extension opens the lender `application_url` in a new tab
6. Badge shows the granted city (e.g. `MESA`) until End / timeout / clear

## Messaging choice

**Content script + `window.postMessage`**, not `externally_connectable`.

Unpacked extensions get a new ID on every machine. `externally_connectable` needs that ID baked into the page or a fixed published ID. The content script bridge works without knowing the ID: the page posts `{ source: "fundhub-proxy-apply", direction: "page-to-extension", type: "ping"|"launch"|"end" }` and the content script forwards to the service worker.

## Permissions rationale

| Permission | Why |
|---|---|
| `proxy` | Set / clear Chrome proxy settings for the Apply session |
| `storage` | Remember the active session in `session` storage |
| `webRequest` + `webRequestAuthProvider` | Supply Oxylabs username/password to the proxy without prompting the advisor |
| Host permissions for CRM origins | Content script on Fundhub pages only |
| `<all_urls>` (added for auth listener) | Proxy auth challenges are not limited to the CRM origin; required for `onAuthRequired` while a session is active |

## Browser-wide proxy limitation (important)

Chrome MV3’s `chrome.proxy` API configures the **whole browser profile**, not a single tab.

Mitigations in this build:

- PAC script sends **only** the lender application host (plus `ip.oxylabs.io` / `pr.oxylabs.io`) through the proxy; everything else is `DIRECT`
- Badge text is the granted city and stays visible while active
- Auto-clear on End from the CRM, session timeout (30 minutes), extension install/startup

Still: another tab that hits the **same lender host** during an active session will also go through the proxy. End the session when the application is submitted.

## End session

- CRM **End proxy session** button
- Automatic timeout (30 minutes)
- Extension reload / browser restart clears settings

## Packaging for Chrome Web Store (later)

Not done in this repo yet. Rough checklist:

1. Create a Chrome Web Store developer account
2. Replace placeholder icons with final brand assets
3. Set a stable extension ID via dashboard; optionally add `externally_connectable` for the production CRM origin as a second channel
4. Narrow `host_permissions` to the production CRM origin(s) if you no longer need localhost / `*.netlify.app`
5. Privacy policy URL (proxy credentials transit the extension; state that passwords are held only in memory / session storage for the active Apply window)
6. Submit ZIP of this folder (without `.git`); pass single-purpose review (“residential proxy for Fundhub Apply”)
7. Distribute to funding advisors via force-install (Google Workspace) or store link

## Credentials

The extension never stores Oxylabs master credentials. Each launch receives a **one-session** username/password from the Fundhub API after server-side verification.
