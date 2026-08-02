import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPartnerPageHtml } from "./partner-site.mjs";

test("renderPartnerPageHtml includes title, brand colors, and sections", () => {
  const html = renderPartnerPageHtml({
    page: {
      title: "Apply now",
      body_json: {
        sections: [
          { type: "hero", headline: "Get funded", sub: "Soft pull only" },
          { type: "cta", label: "Start", href: "#go" }
        ]
      }
    },
    brand: {
      ink: "#112233",
      paper: "#fefefe",
      entity_name: "Acme Capital LLC",
      display_face: "Fraunces",
      mono_face: "IBM Plex Mono"
    }
  });
  assert.match(html, /Get funded/);
  assert.match(html, /#112233/);
  assert.match(html, /Acme Capital LLC/);
  assert.match(html, /Start/);
});
