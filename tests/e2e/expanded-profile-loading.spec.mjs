import {test,expect,knownIssue,expectKnownFailure} from './fixtures.mjs';
import {login,visibleButton} from './helpers.mjs';

test('PERFIL: editar durante carga debe conservar el nombre existente',async({page,data},info)=>{
  knownIssue(info,'QA-015');
  await login(page,'CLIENTE',data);await page.goto('/mi-perfil');
  await expect(page.getByText(data.clientName,{exact:true}).filter({visible:true})).toBeVisible();
  let release;const held=new Promise(resolve=>{release=resolve});
  // Delay a real read only. No response/status/body is fabricated.
  await page.route('**/rpc/mi_perfil_cliente',route=>release(route));
  await page.reload();const route=await held;
  const edit=visibleButton(page,'Editar');
  const editEnabled=await edit.isVisible() && await edit.isEnabled();
  if(editEnabled)await edit.click();
  const before=editEnabled?await page.locator('#perfil-nombre').inputValue():null;
  const response=page.waitForResponse(r=>r.url().includes('/rpc/mi_perfil_cliente'));
  await route.continue();const actualResponse=await response;expect(actualResponse.ok()).toBeTruthy();
  const actualData=await actualResponse.json();expect(actualData[0].nombre).toBe(data.clientName);
  // Wait until the completed request updates the provider's avatar.
  await expect(page.getByRole('button',{name:'Menú de cuenta',exact:true})).toContainText('TP');
  if(!editEnabled){
    await expect(page.getByText(data.clientName,{exact:true}).filter({visible:true})).toBeVisible();
    await visibleButton(page,'Editar').click();
  }
  const after=await page.locator('#perfil-nombre').inputValue();
  await info.attach('profile-load',{body:Buffer.from(JSON.stringify({profileName:actualData[0].nombre,readDelayed:true,editEnabled,before,after,noSaveAttempted:true})),contentType:'application/json'});
  await page.unroute('**/rpc/mi_perfil_cliente');
  expectKnownFailure('QA-015');
  expect(after,'El editor no debe quedarse vacío después de recibir el perfil existente').toBe(data.clientName);
});
