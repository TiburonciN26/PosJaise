// Fictitious image inspection through UI, no source/config mutations.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {assertLocalTest,localNetworkOnly} from './local-safety.mjs';
import {login} from './helpers.mjs';
await assertLocalTest();
const data=JSON.parse(await readFile('tests/e2e/fixtures/runtime.json','utf8'));
const own=JSON.parse(await readFile('tests/e2e/results/performance/writes.json','utf8'));
const report={environment:'Local TEST dev; external fonts blocked',samples:[],resources:[],errors:[]};
const browser=await chromium.launch({headless:true});
try{for(const mobile of [false,true]){
  const ctx=await browser.newContext({baseURL:'http://localhost:5173',viewport:mobile?{width:390,height:844}:{width:1440,height:900},timezoneId:'America/Lima',serviceWorkers:'block'});await localNetworkOnly(ctx);
  const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push({mobile,message:e.message}));
  const requests=new Set();page.on('response',async r=>{const u=new URL(r.url());if(!r.headers()['content-type']?.startsWith('image/')||requests.has(r.url()))return;requests.add(r.url());try{const bytes=(await r.body()).length;report.resources.push({mobile,path:u.pathname,status:r.status(),type:r.headers()['content-type'],bytes,cache:r.headers()['cache-control']??null,encoding:r.headers()['content-encoding']??null});}catch{}});
  await login(page,'CLIENTE',data);await page.waitForLoadState('networkidle');
  for(const path of ['/inicio',`/productos/${own.products[0].id}`]){
    await page.goto(path);await page.waitForLoadState('networkidle');
    await page.locator('main img').first().waitFor();
    const before=await snapshot(page);await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(600);await page.waitForLoadState('networkidle');
    const after=await snapshot(page);report.samples.push({mobile,path,before,after});
    console.log(JSON.stringify({mobile,path,imageCount:before.images.length,loaded:before.images.filter(x=>x.complete&&x.naturalWidth).length}));
  }
  await ctx.close();
}}finally{await browser.close();await writeFile('tests/e2e/results/performance/images.json',JSON.stringify(report,null,2));}
async function snapshot(page){return page.evaluate(()=>({images:[...document.querySelectorAll('main img')].map(i=>{const box=i.getBoundingClientRect();return {path:new URL(i.currentSrc||i.src,location.href).pathname,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,width:Math.round(box.width),height:Math.round(box.height),loading:i.loading,priority:i.fetchPriority,srcset:!!i.srcset,complete:i.complete,inViewport:box.bottom>0&&box.top<innerHeight};}),resources:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='img').map(r=>({path:new URL(r.name).pathname,duration:r.duration,transfer:r.transferSize,decoded:r.decodedBodySize}))}));}
