import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/user/fundhub-platform/public";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".png":"image/png" };

const PROGRESS = {
  ok: true,
  stage: { key:"in_transit", roundCurrent:2, roundCap:6,
           enteredAt:"2026-03-03T00:00:00Z", expectedResponseBy:"2026-04-02T00:00:00Z", waitingOn:"bureaus" },
  scores: {
    personal: [
      { bureau:"experian",   score:651, pulledAt:"2026-03-01T00:00:00Z", reportDocumentId:"11111111-1111-4111-8111-111111111111" },
      { bureau:"equifax",    score:648, pulledAt:"2026-03-01T00:00:00Z", reportDocumentId:null },
      { bureau:"transunion", score:null, pulledAt:null, reportDocumentId:null }
    ],
    business: [
      { businessId:"b1", name:"Sim Five Holdings LLC", bureau:"experian_business",
        score:42, pulledAt:"2026-03-01T00:00:00Z", reportDocumentId:"22222222-2222-4222-8222-222222222222" },
      { businessId:"b2", name:"Second Trade Co", bureau:"experian_business",
        score:null, pulledAt:null, reportDocumentId:null }
    ]
  },
  movement: {
    middleScoreNow:648, middleScoreBaseline:612, baselineAt:"2026-01-12T00:00:00Z",
    itemsRemoved:2, itemsDisputed:7,
    series:[
      { at:"2026-01-12T00:00:00Z", experian:615, equifax:612, transunion:608 },
      { at:"2026-02-10T00:00:00Z", experian:630, equifax:625, transunion:null },
      { at:"2026-03-01T00:00:00Z", experian:651, equifax:648, transunion:null }
    ]
  },
  waypoints: [
    { id:"w1", order:1, title:"Photo ID", owner:"client", state:"done",
      dueAt:null, overdue:false, completedAt:"2026-02-12T00:00:00Z", paidAlternative:null },
    { id:"w2", order:3, title:"Proof of address", owner:"client", state:"open",
      dueAt:"2026-02-24T00:00:00Z", overdue:true, completedAt:null, paidAlternative:null },
    { id:"w3", order:4, title:"We post your round", owner:"fundhub", state:"open",
      dueAt:null, overdue:false, completedAt:null, paidAlternative:null },
    { id:"w4", order:5, title:"Run a round now", owner:"client", state:"available",
      dueAt:null, overdue:false, completedAt:null,
      paidAlternative:{ serviceKey:"paid_round", priceCents:10000 } }
  ],
  nextStep: { waypointId:"w2", owner:"client" },
  timeline: [
    { at:"2026-03-03T00:00:00Z", text:"Round 2 letters mailed to all three bureaus" },
    { at:"2026-02-12T00:00:00Z", text:"Photo ID received" }
  ],
  deliverables: [
    { documentId:"11111111-1111-4111-8111-111111111111", subtype:"funding_snapshot",
      title:"Funding Snapshot", generatedAt:"2026-03-01T00:00:00Z" }
  ],
  paidServices: [
    { serviceKey:"paid_round", available:true, inFlight:false, components:[
      { key:"base", label:"Three bureaus", priceCents:10000, required:true },
      { key:"creditor", label:"Creditor letter", priceCents:1000, required:false },
      { key:"cfpb_and_ag", label:"CFPB and state attorney general", priceCents:2000, required:false }
    ]}
  ],
  referral: { enrolled:false, shareUrl:null, code:null }
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/api/read/client-progress") {
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify(PROGRESS));
  }
  if (p === "/api/documents-download") {
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify({ ok:true, document:{ id:url.searchParams.get("id"),
      download:{ path:"/fake.pdf", url:null } } }));
  }
  if (p === "/api/affiliates/refer") {
    res.writeHead(201, {"content-type":"application/json"});
    return res.end(JSON.stringify({ ok:true, enrolled:true, created:true, code:"AFF-000123",
      shareUrl:"https://fundhub.ai/start.html?ref=AFF-000123" }));
  }
  if (p === "/api/auth/session") {
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify({ ok:true, staff:{ name:"Dana Whitlock", role:"client",
      affiliate_id:"aff-1", client_id:"c-1" }, principal:"client" }));
  }
  if (p === "/api/read/affiliate-portal") {
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify({ ok:true, enrolled:true,
      affiliate:{ id:"aff-1", name:"Dana Whitlock", code:"AFF-000123",
        shareUrl:"https://fundhub.ai/start.html?ref=AFF-000123", status:"active",
        tierLevel:"tier1", payoutMethod:"ach", payoutStatus:"accruing", balanceDue:640 },
      rates:{ direct:{ tier:"direct", percent:20, percentMin:20, percentMax:20,
                rules:[{name:"Affiliate direct funding",product:"Funding",calcMethod:"percent",percent:20,mine:false}] },
              downline:{ tier:"downline", percent:5, percentMin:5, percentMax:5,
                rules:[{name:"Affiliate downline",product:"Funding",calcMethod:"percent",percent:5,mine:false}] } },
      gates:{ license:{ signed:false, signedAt:null, documentRef:"ENV-4471" },
              tax:{ onFile:false, receivedAt:null, documentRef:null } },
      referrals:[
        { id:"r1", tier:"direct", status:"converted", attributedAt:"2026-02-02T00:00:00Z",
          convertedAt:"2026-02-20T00:00:00Z", name:"Marcus Bell", product:"Funding Blueprint",
          basisAmount:3200, commissionDue:640, codeUsed:"AFF-000123" },
        { id:"r2", tier:"direct", status:"converted", attributedAt:"2026-02-11T00:00:00Z",
          convertedAt:"2026-03-01T00:00:00Z", name:"Priya Raman", product:"Capital Readiness",
          basisAmount:1800, commissionDue:null, codeUsed:"AFF-000123" },
        { id:"r3", tier:"direct", status:"attributed", attributedAt:"2026-03-04T00:00:00Z",
          convertedAt:null, name:"Tomas Adeyemi", product:null,
          basisAmount:null, commissionDue:null, codeUsed:"AFF-000123" }
      ],
      payouts:[
        { id:"p1", periodStart:"2026-02-01T00:00:00Z", periodEnd:"2026-02-15T00:00:00Z",
          amount:640, currency:"USD", status:"held", holdReason:"partner license unsigned",
          method:"ach", paidAt:null, lineCount:1 }
      ] }));
  }
  if (p.startsWith("/api/")) {
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify({ ok:true, items:[] }));
  }

  const file = path.join(ROOT, p === "/" ? "index.html" : p.replace(/^\//,""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("nope");
  }
  res.writeHead(200, {"content-type": TYPES[path.extname(file)] || "application/octet-stream"});
  fs.createReadStream(file).pipe(res);
}).listen(8099, () => console.log("up on 8099"));
