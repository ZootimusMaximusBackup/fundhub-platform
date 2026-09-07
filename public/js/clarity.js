/* Microsoft Clarity — session recording + heatmaps for the marketing funnel.
   Gated and off by default. Chris has to hand over a real Clarity project ID
   before anything here records a single session.

   TO TURN ON, TWO STEPS, BOTH REQUIRED:
   1. Paste the real project ID (from clarity.microsoft.com, Settings > Setup)
      into CLARITY_PROJECT_ID below. Leave it "" to keep this a no-op.
   2. In the Clarity dashboard, Settings > Masking, set the project-wide mode
      to STRICT before real traffic hits it. This is a dashboard setting —
      there is no JavaScript call that sets it from code. An earlier draft of
      this file called window.clarity("set", "maskTextContent", true), which
      is not a real Clarity API (checked against Microsoft's own masking docs,
      2026-09-07) — it would have done nothing, silently, while this comment
      claimed the site was protected. Removed. Do not add it back.

   This funnel's forms touch income, funding amount and other financial
   details (see optimize.html, education/enroll/index.html,
   affiliates/index.html). Until Strict mode is set in the dashboard, Balanced
   (Clarity's default) only masks numbers and email addresses — a free-text
   answer describing someone's financial situation could still be recorded in
   the clear. Two things narrow that gap at the code level, independent of the
   dashboard setting: the data-clarity-mask="true" attribute added to the
   income-adjacent fields on the pages this script loads on (see those files),
   and this list, kept here as the one place a future page's sensitive field
   gets added to a script that already runs. */

var CLARITY_PROJECT_ID = "";

(function () {
  if (!CLARITY_PROJECT_ID) {
    // No project ID set — do nothing. No network call, no globals, no console noise.
    return;
  }

  // Official Microsoft Clarity bootstrap loader (clarity.microsoft.com > Setup > Manual install).
  (function (c, l, a, r, i, t, y) {
    c[a] =
      c[a] ||
      function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
    t = l.createElement(r);
    t.async = 1;
    t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_PROJECT_ID);
})();
