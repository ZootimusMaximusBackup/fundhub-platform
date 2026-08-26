import test from "node:test";
import assert from "node:assert/strict";
import { isFundhubAddress, pickBankFormEmail } from "./bank-form-email.mjs";

test("isFundhubAddress catches fundhub.ai and subdomains", () => {
  assert.equal(isFundhubAddress("chris@fundhub.ai"), true);
  assert.equal(isFundhubAddress("monitor+abc@fundhub.ai"), true);
  assert.equal(isFundhubAddress("x@mg.fundhub.ai"), true);
  assert.equal(isFundhubAddress("ada@client.com"), false);
  assert.equal(isFundhubAddress(""), false);
});

test("pickBankFormEmail uses the client's own email", () => {
  const out = pickBankFormEmail({ email: "ada@client.com" });
  assert.equal(out.email, "ada@client.com");
  assert.equal(out.warning, null);
});

test("pickBankFormEmail refuses a Fundhub address so the bank cannot see Fundhub", () => {
  const out = pickBankFormEmail({ email: "monitor+x@fundhub.ai" });
  assert.equal(out.email, "");
  assert.match(out.warning, /Fundhub address/);
});

test("pickBankFormEmail warns when the file has no email", () => {
  const out = pickBankFormEmail({});
  assert.equal(out.email, "");
  assert.match(out.warning, /No client email/);
});
