import { test } from "node:test";
import assert from "node:assert";
import { suggestCompanyEmail, staffRoleKey, COMPANY_EMAIL_DOMAIN } from "./company-email.mjs";

test("suggestCompanyEmail builds first.last@fundhub.ai", () => {
  assert.equal(suggestCompanyEmail("Sam Rivera"), `sam.rivera@${COMPANY_EMAIL_DOMAIN}`);
});

test("suggestCompanyEmail bumps the number when the login is taken", () => {
  assert.equal(
    suggestCompanyEmail("Sam Rivera", ["sam.rivera@fundhub.ai"]),
    "sam.rivera2@fundhub.ai"
  );
});

test("staffRoleKey folds labels the screen uses", () => {
  assert.equal(staffRoleKey("Funding Advisor"), "funding_advisor");
  assert.equal(staffRoleKey("closer"), "closer");
  assert.equal(staffRoleKey("wizard"), null);
});
