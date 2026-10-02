import { test, expect, knownIssue, expectKnownFailure } from './fixtures.mjs';
import {login,visibleButton,formWithTitle} from './helpers.mjs';

test('GASTOS: monto parcialmente numérico debe rechazarse completo',async({page,data},info)=>{
  knownIssue(info,'QA-014');
  await page.setViewportSize({width:390,height:844});await login(page,'CAJERA',data);await page.goto('/gastos');
  const name=`${data.prefix} INVALIDO-${Date.now().toString(36)}`;
  await visibleButton(page,'Nuevo gasto variable').first().click();let form=formWithTitle(page,'Nuevo gasto variable');
  await form.getByLabel('Nombre',{exact:false}).fill(name);await form.getByLabel('Monto',{exact:false}).fill('12abc');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.getByRole('button',{name:'Guardando...',exact:true})).toHaveCount(0);
  let persisted=null;
  if(!await form.count()){
    await page.reload();await page.getByRole('button',{name:/\bVARIABLE\b/}).filter({visible:true}).first().click();
    await page.getByText(name,{exact:true}).filter({visible:true}).locator('..').locator('..').getByRole('button',{name:'Editar',exact:true}).click();
    form=formWithTitle(page,'Editar gasto');persisted=await form.getByLabel('Monto',{exact:false}).inputValue();
  }
  await info.attach('numeric-validation',{body:Buffer.from(JSON.stringify({role:'CAJERA',name,input:'12abc',persisted,reloaded:persisted!==null})),contentType:'application/json'});
  expectKnownFailure('QA-014');
  expect(persisted,'Un monto con letras no debe guardarse como un importe numérico').toBeNull();
});
