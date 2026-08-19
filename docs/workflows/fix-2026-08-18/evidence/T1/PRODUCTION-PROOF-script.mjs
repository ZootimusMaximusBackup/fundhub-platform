import { chromium } from "playwright";
import pg from "pg"; import fs from "node:fs";
const BASE="https://fundhub.ai", TEST="8556bedc-46e1-4d85-b0cd-a24adfee1521";
const env=fs.readFileSync("/Users/zootimusmaximus/fundhub-platform/.env","utf8");
const c=new pg.Client({connectionString:(env.match(/^DATABASE_URL=(.*)$/m)||[])[1].trim(),ssl:{rejectUnauthorized:false},statement_timeout:15000});
await c.connect();
const addr=(await c.query("select email from clients where id=$1",[TEST])).rows[0].email;
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:900}});
const r=await ctx.request.post(BASE+"/api/auth/magic-link",{data:{email:addr},timeout:30000});
console.log("link request:", r.status());
await new Promise(x=>setTimeout(x,4000));
const m=(await c.query("select rendered_body from messages where to_address=$1 order by created_at desc limit 1",[addr])).rows[0];
const tok=((m?.rendered_body||"").match(/portal-login\.html\?t=([A-Za-z0-9_\-%.]+)/)||[])[1];
const p=await ctx.newPage();
const api=[]; const errs=[];
p.on("response",x=>{const u=x.url(); if(u.includes("/api/")) api.push(x.request().method()+" "+u.replace(BASE,"")+" -> "+x.status());});
p.on("pageerror",e=>errs.push(String(e).slice(0,300)));
p.on("console",e=>{ if(e.type()==="error") errs.push("console: "+e.text().slice(0,200)); });
await p.goto(`${BASE}/portal-login.html?t=${tok}`,{waitUntil:"domcontentloaded"});
await p.waitForURL(u=>/client-portal/.test(u.toString()),{timeout:30000}).catch(()=>{});
await p.waitForLoadState("networkidle").catch(()=>{});
await p.waitForTimeout(6000);
console.log("landed at:", p.url().replace(BASE,""));
console.log("API during whole flow:"); api.forEach(a=>console.log("   ",a));
console.log("page errors:", errs.length?errs:"none");
console.log(JSON.stringify(await p.evaluate(()=>({
  greeting:(document.getElementById("greeting")||{}).textContent,
  sub:(document.getElementById("greeting-sub-pre")||{}).textContent,
  fh_account_clientId:(()=>{try{const a=JSON.parse(localStorage.getItem("fh_account")||"null");return a&&(a.clientId||a.client_id)}catch{return null}})(),
  bannerText:(document.querySelector(".banner,[class*=banner]")||{}).textContent,
})),null,1));
await p.screenshot({path:"/Users/zootimusmaximus/fundhub-platform/docs/workflows/fix-2026-08-18/evidence/T1/shots/50-PRODUCTION-real-client-magic-link.png"});
await c.end(); await b.close();
