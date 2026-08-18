import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT='/Users/zootimusmaximus/fundhub-platform/public';
const API_DELAY=Number(process.env.API_DELAY||400);
const CARDS=Number(process.env.CARDS||50);
const FIX=process.env.FIX==='1';
function stages(){
  const names=['New','Contacted','Booked','Presented','Won','Lost'];
  return names.map((n,i)=>({key:'s'+i,name:n,count:CARDS,amount:CARDS*15000,
    cards:Array.from({length:CARDS},(_,j)=>({id:'c'+i+'_'+j,client_id:'cl'+i+'_'+j,name:'Person '+i+'-'+j,
      amount:15000,entered_at:new Date(Date.now()-j*3600e3).toISOString(),owner:'Rep '+(j%7),survey_fico:'700-750'}))}));
}
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname.startsWith('/api/')){
    const j=(o,d=API_DELAY)=>setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(o));},d);
    if(u.pathname==='/api/auth/session') return j({ok:true,staff:{id:'s1',name:'Owner',role:'owner',org_id:'o1',email:'owner@fundhub.ai'}},120);
    if(u.pathname==='/api/health') return j({ok:true,db:'up',migrations:120},60);
    if(u.pathname==='/api/dashboard/pipeline') return j({ok:true,stages:stages()});
    if(u.pathname==='/api/org-brand') return j({ok:true,brand:{}},80);
    if(u.pathname==='/api/demo/mode') return j({ok:true,demo_mode_enabled:false},80);
    return j({ok:true},20);
  }
  try{
    let body=fs.readFileSync(path.join(ROOT,u.pathname));
    if(u.pathname.endsWith('pipeline.html')){
      let t=String(body);
      if(FIX) t=t.replace('<script defer src="data.js"></script>','<script src="data.js"></script>');
      if(process.env.NORAIL==='1') t=t.replace('  loadRailCounts("R-01");','  /*railcounts off*/');
      body=Buffer.from(t);
    }
    const ct={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u.pathname)]||'application/octet-stream';
    res.writeHead(200,{'content-type':ct});res.end(body);
  }catch(e){res.writeHead(404);res.end('nf');}
});
await new Promise(r=>srv.listen(0,r));
const port=srv.address().port;
const b=await chromium.launch();
const ctx=await b.newContext();
await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,body:'',contentType:'text/css'}));
await ctx.route('https://fonts.gstatic.com/**',r=>r.abort());
const pg=await ctx.newPage();
const errs=[],reqs=[];
pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
pg.on('request',r=>{if(r.url().includes('/api/'))reqs.push({t:Date.now(),u:r.url().replace(`http://127.0.0.1:${port}`,'')});});
pg.on('requestfinished',r=>{if(r.url().includes('/api/dashboard/pipeline'))reqs.push({t:Date.now(),u:'   DONE '+r.url().split('key=')[1]});});
await pg.addInitScript(()=>{try{localStorage.setItem('fh_token','tok-abc');localStorage.setItem('fh_role','owner');}catch(e){}
  window.__m={firstCard:null,lastCard:null,cards:0,boardShown:null};
  const start=()=>{const b=document.querySelector('.board');if(!b)return setTimeout(start,5);
    new MutationObserver(muts=>{let n=0;muts.forEach(m=>{m.addedNodes.forEach(x=>{if(x.querySelectorAll)n+=x.querySelectorAll('.card').length;});});
      if(n){if(window.__m.firstCard===null)window.__m.firstCard=performance.now();window.__m.lastCard=performance.now();window.__m.cards+=n;}
      if(window.__m.boardShown===null && !b.hidden)window.__m.boardShown=performance.now();
    }).observe(b,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();});
const t0=Date.now();
await pg.goto(`http://127.0.0.1:${port}/app/pipeline.html`,{waitUntil:'load'});
// wait until first card appears
let firstCard=null;
try{ await pg.waitForSelector('.board .card',{timeout:8000}); firstCard=Date.now()-t0; }catch(e){}
await pg.waitForTimeout(3500);
console.log('FIX='+FIX+'  CARDS/stage='+CARDS+'  API_DELAY='+API_DELAY+'ms');
console.log('--- page errors ---'); console.log(errs.join('\n')||'(none)');
console.log('--- api traffic in order (ms after nav) ---');
reqs.sort((a,b)=>a.t-b.t).forEach(r=>console.log(String(r.t-t0).padStart(6),r.u));
const m=await pg.evaluate(()=>window.__m);
console.log('--- in-page marks (ms from navigationStart) ---');
console.log('  first card in DOM :', m.firstCard===null?'never':Math.round(m.firstCard));
console.log('  last  card in DOM :', m.lastCard===null?'never':Math.round(m.lastCard));
console.log('  board un-hidden   :', m.boardShown===null?'never':Math.round(m.boardShown));
console.log('  paint span (ms)   :', m.firstCard===null?'-':Math.round(m.lastCard-m.firstCard));
console.log('  cards appended    :', m.cards);
console.log('  (playwright visible-selector: '+firstCard+'ms)');
console.log('--- board state ---');
console.log(await pg.evaluate(()=>({
  boardStatus:(document.getElementById('boardStatus')||{}).textContent,
  cols:document.querySelectorAll('.board .col').length,
  cards:document.querySelectorAll('.board .card').length,
  sumCount:(document.getElementById('sumCount')||{}).textContent,
  railCounts:[].map.call(document.querySelectorAll('.rail-tab .rt-count'),e=>e.textContent).join(','),
  ownerOptions:document.getElementById('fOwner').options.length,
})));
await b.close();srv.close();
