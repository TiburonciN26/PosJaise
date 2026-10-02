import {expect} from 'playwright/test';
import {assertLocalTest,localServiceKey,localNetworkOnly,supabaseURL} from './local-safety.mjs';
import {password} from './fixtures/accounts.mjs';
import {login} from './helpers.mjs';
import {mkdir,writeFile} from 'node:fs/promises';

export async function qaContext(browser){
  const context=await browser.newContext({baseURL:'http://localhost:5173',timezoneId:'America/Lima',viewport:{width:1280,height:900},serviceWorkers:'block'});
  await localNetworkOnly(context);return context;
}

export async function isolatedClient(browser,data,label){
  await assertLocalTest();const suffix=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,5);
  const own={...data,clientEmail:`clientetest-${label}-${suffix}@test.local`,clientName:`${data.prefix} ${label} ${suffix}`,phone:'9'+String(Date.now()).slice(-8)};
  const key=localServiceKey();
  const r=await fetch(supabaseURL+'/auth/v1/admin/users',{method:'POST',redirect:'error',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email:own.clientEmail,password,email_confirm:true,user_metadata:{qa:true}})});
  expect(r.ok,'Only isolated local QA Auth provisioning').toBeTruthy();own.clientAuthId=(await r.json()).id;
  await mkdir('tests/e2e/results/phase2-fixtures',{recursive:true});await writeFile(`tests/e2e/results/phase2-fixtures/${label}-${suffix}.json`,JSON.stringify(own,null,2));
  const context=await qaContext(browser);const page=await context.newPage();await login(page,'CLIENTE',own);await page.goto('/mi-perfil');
  await page.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('#perfil-nombre').fill(own.clientName);await page.getByLabel('Teléfono',{exact:true}).fill(own.phone);
  await page.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.getByText('Perfil guardado.',{exact:true})).toBeVisible();await context.close();return own;
}

export async function testImage(page,name='TEST-QA-NO-PAGO.png'){
  // Detached canvas generates an isolated fictitious image, not app data.
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=80;const x=c.getContext('2d');x.fillStyle='#ffccd9';x.fillRect(0,0,160,80);x.fillStyle='#222';x.font='20px sans-serif';x.fillText('TEST QA',20,35);x.font='12px sans-serif';x.fillText('NO PAGO / FICTICIO',12,60);return c.toDataURL('image/png').split(',')[1];});
  return {name,mimeType:'image/png',buffer:Buffer.from(png,'base64')};
}
