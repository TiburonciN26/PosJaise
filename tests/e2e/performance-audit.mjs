// Read-only page measurements; fictitious writes are in a separate UI scenario.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance as hostClock} from 'node:perf_hooks';
import {assertLocalTest,localNetworkOnly} from './local-safety.mjs';
import {login,visibleButton} from './helpers.mjs';
import {staffRoutes,clientRoutes} from './coverage-inventory.mjs';
const data=JSON.parse(await readFile('tests/e2e/fixtures/runtime.json','utf8'));
const mode=process.argv[2]??'catalogs';
await assertLocalTest();await mkdir('tests/e2e/results/performance',{recursive:true});
const result={date:'2026-10-01',mode,environment:'Vite development + Supabase Local TEST',app:'http://localhost:5173',database:'http://127.0.0.1:54321',samples:[],errors:[],limits:['Local timings are not production/network benchmarks.','Headless Chromium frame intervals are not physical GPU FPS.','External origins blocked; no production calls.','No HAR, tokens, traces or session exports.']};
const browser=await chromium.launch({headless:true});
async function context(options={}){
  const ctx=await browser.newContext({baseURL:result.app,viewport:options.mobile?(process.argv.includes('--tablet-only')?{width:768,height:1024}:{width:390,height:844}):{width:1440,height:900},timezoneId:'America/Lima',serviceWorkers:'block',reducedMotion:options.reduce?'reduce':'no-preference'});await localNetworkOnly(ctx);
  await ctx.addInitScript(()=>{
    const metrics={longTasks:[],shifts:[],paint:[],lcp:null,events:[]};
    for(const type of ['longtask','layout-shift','paint','largest-contentful-paint','event'])try{new PerformanceObserver(list=>{for(const e of list.getEntries()){if(type==='longtask')metrics.longTasks.push({start:e.startTime,duration:e.duration});if(type==='layout-shift'&&!e.hadRecentInput)metrics.shifts.push({start:e.startTime,value:e.value});if(type==='paint')metrics.paint.push({name:e.name,start:e.startTime});if(type==='largest-contentful-paint')metrics.lcp={start:e.startTime,size:e.size,tag:e.element?.tagName};if(type==='event')metrics.events.push({name:e.name,start:e.startTime,duration:e.duration});}}).observe({type,buffered:true,durationThreshold:16});}catch{}
    function visible(el){if(!el)return false;for(let n=el;n;n=n.parentElement){const c=getComputedStyle(n);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)<0.05)return false;}return el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0;}
    window.__qaPerf={metrics,start(selectors={},path=location.pathname){
      if(this.timer)clearInterval(this.timer);this.origin=performance.now();this.selectors=selectors;this.path=path;this.found={};this.frames=[];this.last=null;this.running=true;
      this.generation=(this.generation??0)+1;const generation=this.generation;const tick=t=>{if(!this.running||generation!==this.generation)return;if(this.last!==null)this.frames.push(t-this.last);this.last=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);
      this.textTimeline=[];this.timer=setInterval(()=>{if(location.pathname!==path)return;const main=document.querySelector('main');const text=main?.innerText?.trim();const t=performance.now()-this.origin;if(text)this.textTimeline.push({t,text:text.slice(0,600)});if(this.found.textReady==null&&text&&!/^Cargando[^\n]*$/i.test(text))this.found.textReady=t;for(const [name,selector] of Object.entries(selectors)){const nodes=[...document.querySelectorAll(selector)];if(this.found[name+'Dom']==null&&nodes.length)this.found[name+'Dom']=t;if(this.found[name+'Visible']==null&&nodes.some(visible))this.found[name+'Visible']=t;}},16);
    },finish(){this.running=false;clearInterval(this.timer);const start=this.origin;const rs=performance.getEntriesByType('resource').filter(e=>e.startTime>=start).map(e=>{const u=new URL(e.name);return {path:u.pathname,origin:u.origin,type:e.initiatorType,start:e.startTime-start,duration:e.duration,responseEnd:e.responseEnd-start,transferBytes:e.transferSize,decodedBytes:e.decodedBodySize};});const frames=[...this.frames].sort((a,b)=>a-b);return {...this.found,resources:rs,frames:{count:frames.length,median:frames[Math.floor(frames.length/2)]??null,p95:frames[Math.floor(frames.length*.95)]??null,over33ms:frames.filter(n=>n>33.4).length},longTasks:metrics.longTasks.filter(e=>e.start>=start),cls:metrics.shifts.filter(e=>e.start>=start).reduce((n,e)=>n+e.value,0),documentPaint:metrics.paint,lcpDocument:metrics.lcp,domNodes:document.querySelectorAll('*').length,activeAnimations:document.getAnimations().length,images:[...document.querySelectorAll('main img')].map(i=>({path:i.currentSrc?new URL(i.currentSrc,location.href).pathname:'',naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,width:Math.round(i.getBoundingClientRect().width),loading:i.loading,complete:i.complete,fetchPriority:i.fetchPriority})),events:metrics.events.filter(e=>e.start>=start)};}};
  });return ctx;
}
async function openLink(page,path){let link=page.locator(`a[href="${path}"]:not([tabindex="-1"])`).filter({visible:true}).first();if(!await link.count()){const menu=visibleButton(page,'Abrir menú');if(await menu.count())await menu.first().click();link=page.locator(`a[href="${path}"]:not([tabindex="-1"])`).filter({visible:true}).first();}if(await link.count()){await link.click();return 'UI link';}await page.goto(path);return 'direct document';}
async function measure(page,role,path,options={}){
  const current=new URL(page.url()).pathname;if(current===path){await openLink(page,role==='CLIENTE'?'/mi-perfil':'/ventas');await page.waitForLoadState('networkidle');}
  // Prepare a visible navigation link before starting, so opening the menu is not counted as page load.
  let link=page.locator(`a[href="${path}"]:not([tabindex="-1"])`).filter({visible:true}).first();if(!await link.count()&&await visibleButton(page,'Abrir menú').count()){await visibleButton(page,'Abrir menú').first().click();link=page.locator(`a[href="${path}"]:not([tabindex="-1"])`).filter({visible:true}).first();}
  const network=[],pending=new Set(),starts=new Map();let lastActivity=hostClock.now();const onRequest=r=>{starts.set(r,hostClock.now());pending.add(r);lastActivity=hostClock.now();};const onFinished=r=>{pending.delete(r);lastActivity=hostClock.now();};const onResponse=r=>{const u=new URL(r.url());if(starts.has(r.request())&&u.origin==='http://127.0.0.1:54321'&&u.pathname.startsWith('/rest/'))network.push({path:u.pathname,status:r.status(),method:r.request().method(),headersReceivedMs:hostClock.now()-starts.get(r.request())});};page.on('request',onRequest);page.on('requestfinished',onFinished);page.on('requestfailed',onFinished);page.on('response',onResponse);
  const item=path==='/productos'?'productos':path==='/servicios'?'servicios':null;
  const selectors={content:'main h1, main h2, main article, main table, main form, main input, main select',cards:item?`main section:has(article) article a[href^="/${item}/"]`:'main article',filters:item?`main input[placeholder="Buscar ${item}..."]`:'main input[placeholder*="Buscar"]',category:item?`main section:has(article a[href^="/${item}/"]) h2`:'main section h2'};
  const start=hostClock.now();let routeMode;
  if(await link.count()){await page.evaluate(({s,path})=>window.__qaPerf.start(s,path),{s:selectors,path});await link.click();routeMode='UI link';}else{await page.goto(path);await page.evaluate(s=>window.__qaPerf.start(s),selectors);routeMode='document after DOMContentLoaded';}
  await page.waitForTimeout(100);while((pending.size||hostClock.now()-lastActivity<250)&&hostClock.now()-start<10000)await page.waitForTimeout(50);const networkIdle=hostClock.now()-start;
  // A cached POS route can briefly keep previous content before Suspense appears.
  await page.waitForTimeout(800);
  await page.waitForFunction(()=>{const t=document.querySelector('main')?.innerText?.trim();return Boolean(t)&&!/^Cargando[^\n]*$/i.test(t);},{},{timeout:20000});
  const readyMs=await page.evaluate(()=>performance.now()-window.__qaPerf.origin);
  while((pending.size||hostClock.now()-lastActivity<200)&&hostClock.now()-start<20000)await page.waitForTimeout(50);
  await page.waitForTimeout(options.catalog?3400:300);
  const measured=await page.evaluate(()=>{const p=window.__qaPerf;const finalText=document.querySelector('main')?.innerText?.trim().slice(0,600);const confirmed=!/^Cargando[^\n]*$/i.test(finalText??'');return {...p.finish(),settledContentMs:confirmed?p.textTimeline.find(x=>x.text===finalText)?.t??null:null};});page.off('response',onResponse);page.off('request',onRequest);page.off('requestfinished',onFinished);page.off('requestfailed',onFinished);
  const sample={role,path,currentPath:new URL(page.url()).pathname,readyMs,mainSummary:await page.locator('main').innerText().then(t=>t.slice(0,180)).catch(()=>''),routeMode,...options,networkIdleMs:networkIdle,...measured,apiResponses:network};result.samples.push(sample);
  if(options.screenshot)await page.screenshot({path:`tests/e2e/results/performance/${role}-${path.replaceAll('/','-')}-${options.label??''}.png`,fullPage:false});
  await writeFile(`tests/e2e/results/performance/${mode}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({role,path,label:options.label,content:measured.contentVisible,cardsDom:measured.cardsDom,cardsVisible:measured.cardsVisible,filtersVisible:measured.filtersVisible,idle:Math.round(networkIdle),requests:network.length,longTasks:measured.longTasks.length}));return sample;
}
try{
  if(mode==='catalogs')for(const mobile of process.argv.includes('--mobile-only')||process.argv.includes('--tablet-only')?[true]:[false,true])for(const reduce of [false,true]){
    const ctx=await context({mobile,reduce});const page=await ctx.newPage();await login(page,'CLIENTE',data);await page.waitForLoadState('networkidle');
    for(let repeat=0;repeat<2;repeat++)for(const path of ['/productos','/servicios'])await measure(page,'CLIENTE',path,{catalog:true,mobile,tablet:process.argv.includes('--tablet-only'),reduce,label:`${mobile?(process.argv.includes('--tablet-only')?'tablet':'mobile'):'desktop'}-${reduce?'reduce':'normal'}-${repeat+1}`,screenshot:repeat===0});await ctx.close();
  }
  if(mode==='routes')for(const role of ['ADMINISTRADOR','CLIENTE','CAJERA','ASISTENTE']){
    const ctx=await context();const page=await ctx.newPage();page.on('pageerror',e=>result.errors.push({role,path:new URL(page.url()).pathname,type:'pageerror',message:e.message}));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith('http://127.0.0.1:54321/'))result.errors.push({role,path:new URL(page.url()).pathname,type:'http',resource:new URL(r.url()).pathname,status:r.status()});});await login(page,role,data);await page.waitForLoadState('networkidle');const paths=role==='CLIENTE'?clientRoutes:staffRoutes.filter(x=>x[1].includes(role)).map(x=>x[0]);
    for(const path of paths)try{await measure(page,role,path,{label:'first',catalog:role==='CLIENTE'&&['/productos','/servicios'].includes(path)});}catch(e){result.errors.push({role,path,error:e.message});console.log('Unmeasured '+role+' '+path+': '+e.message.slice(0,100));}
    if(role==='ADMINISTRADOR')for(const path of ['/inventario','/servicios','/ventas','/clientes','/historial'])await measure(page,role,path,{label:'return'});await ctx.close();
  }
  if(mode==='aux')for(const delayed of [false,true]){
    const ctx=await context({reduce:true});const page=await ctx.newPage();await login(page,'CLIENTE',data);await page.waitForLoadState('networkidle');if(delayed)await page.route('**/rpc/datos_contacto',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.continue();});
    for(let repeat=0;repeat<2;repeat++)for(const path of ['/productos','/servicios'])await measure(page,'CLIENTE',path,{catalog:true,reduce:true,label:delayed?'contact-1000ms':'baseline',repeat});await ctx.close();
  }
  if(mode==='pos-focus'){
    const ctx=await context();const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await login(page,'ADMINISTRADOR',data);await page.waitForLoadState('networkidle');for(const path of ['/servicios','/inventario','/servicios','/mi-panel','/dashboard'])await measure(page,'ADMINISTRADOR',path,{catalog:true,label:'settled',screenshot:true});result.errors=errors;await ctx.close();
  }
}finally{await browser.close();await writeFile(`tests/e2e/results/performance/${mode}.json`,JSON.stringify(result,null,2));}
