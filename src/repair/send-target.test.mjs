import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendRepairLetters, RepairSendError } from "../repair/send.mjs";

describe("WS-B target-aware send", () => {
  it("passes furnisher routing to mailSender", async () => {
    const calls = [];
    const db = {
      async query(sql) {
        if (String(sql).includes("FROM dispute_letters")) {
          return {
            rows: [{
              target: "furnisher",
              furnisher_address_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              bureau: "EX"
            }]
          };
        }
        if (String(sql).includes("FROM furnisher_mail_addresses")) {
          return {
            rows: [{
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "Midland Credit Management",
              address_line1: "P.O. Box 509176",
              city: "San Diego",
              state: "CA",
              zip: "92150",
              country: "US"
            }]
          };
        }
        return { rows: [] };
      }
    };

    const result = await sendRepairLetters(db, {
      orgId: "22222222-2222-4222-8222-222222222222",
      clientId: "33333333-3333-4333-8333-333333333333",
      staffId: "44444444-4444-4444-8444-444444444444",
      mail: true,
      from: {
        first_name: "Pat",
        last_name: "Client",
        address_line1: "12 Oak St",
        address_city: "Dallas",
        address_state: "TX",
        address_zip: "75201"
      },
      letters: [{
        bureau: "EX",
        html: "<html>x</html>",
        letterId: "55555555-5555-4555-8555-555555555555"
      }],
      mailSender: async (letter) => {
        calls.push(letter);
        return { ok: true, providerId: "ltr_f1", outcome: "sent" };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, "furnisher");
    assert.equal(calls[0].furnisherName, "Midland Credit Management");
    assert.equal(calls[0].to.address_line1, "P.O. Box 509176");
  });

  it("still refuses when mail is false", async () => {
    await assert.rejects(
      () => sendRepairLetters({ query: async () => ({ rows: [] }) }, {
        orgId: "22222222-2222-4222-8222-222222222222",
        clientId: "33333333-3333-4333-8333-333333333333",
        staffId: "44444444-4444-4444-8444-444444444444",
        mail: false,
        letters: [{ bureau: "EX", html: "<html>x</html>" }]
      }),
      (err) => err instanceof RepairSendError && err.code === "no_channel"
    );
  });
});
