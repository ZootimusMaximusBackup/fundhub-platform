#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import letterGenMod from "../src/underwrite/vendor/letter-generator.cjs";

const { generateDisputeLetters } = letterGenMod;
const PERSONAL = {
  name: "Jordan Sample",
  address: "5815 Knoll Krest St\nSan Antonio, TX 78242",
  ssn: "111223333",
  dob: "1963-11-12",
  employer: "Current Co"
};
const SIGNET = {
  creditorName: "SIGNET BANK/VIRGINIA",
  accountIdentifier: "1200119007344443",
  status: "closed",
  isDerogatory: true,
  currentBalance: 4798,
  reportedDate: "2021-09-03",
  closedDate: "2021-10-28",
  currentRatingType: "ChargeOff",
  comments: []
};
const letters = await generateDisputeLetters({
  bureaus: { experian: { tradelines: [SIGNET] } },
  personal: PERSONAL
});
const out = path.join("docs/workflows/gold-deliverables-v5/compare", "live-verify-experian-bureau.pdf");
fs.writeFileSync(out, letters[0].buffer);
console.log(JSON.stringify({ file: out, bytes: letters[0].buffer.length, filename: letters[0].filename }));
