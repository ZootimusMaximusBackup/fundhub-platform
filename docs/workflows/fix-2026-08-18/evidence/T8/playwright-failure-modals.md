# T8 — browser check of the Apply failure box (CLAUDE.md §6 item 4)

Run 2026-08-19 with Playwright against the real `public/app/proxy-apply.js` from this branch,
served locally with a stubbed `/api/proxy/launch`. A stub is used because the live site has zero
lenders, so there is no Apply button to press there — stated plainly rather than skipped.

Screenshot: `t8-modal-1-server-refusal.png`.

All three failure paths now carry (a) the real reason, (b) a plain next step, and (c) the
"routing is NOT active" warning. Captured `innerText` of `#fh-proxy-body`:

## 1. Server refusal — 503, proxy login missing
> Oxylabs credentials are not set (OXYLABS_USERNAME, OXYLABS_PASSWORD). See docs/STILL-MISSING.md.
>
> What to do next: The proxy account is not set up yet. Ask the owner to add the proxy login before applying.
>
> Browser routing is NOT active and the bank application was not opened. Do not apply from your
> normal internet connection — the bank will see the wrong location.

## 2. Expired sign-in — 401, response carries no next_step
> unauthorized
>
> What to do next: Your sign-in has expired or your role cannot use Apply. Sign in again, then try Apply.
>
> Browser routing is NOT active and the bank application was not opened. ...

Before this fix the box showed the single word "unauthorized" and nothing else.

## 3. Connection dropped — fetch throws
> Failed to fetch
>
> What to do next: Check your internet connection, then try Apply again.
>
> Browser routing is NOT active and the bank application was not opened. ...

Before this fix this box showed "Failed to fetch" alone, with no warning at all — the one
sentence that stops somebody applying from the office IP address was missing.
