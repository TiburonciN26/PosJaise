import { test, expect } from './fixtures.mjs';
import {login,visibleButton,formWithTitle,createService,abrirBuscadorCitas} from './helpers.mjs';

test('CITAS: crear, reprogramar, cancelar y persistir servicios por flujo normal',async({page,data},info)=>{
  test.setTimeout(90_000);await login(page,'ADMINISTRADOR',data);
  const service={serviceName:`${data.prefix} CITA NORMAL ${Date.now().toString(36)}`};await createService(page,service);await page.goto('/citas');
  await visibleButton(page,'Nueva cita').first().click();let form=formWithTitle(page,'Nueva cita');
  await form.getByPlaceholder('Buscar cliente...').fill(data.clientName);await form.getByRole('button',{name:data.clientName,exact:true}).click();
  await form.getByPlaceholder('Buscar servicio...').fill(service.serviceName);await form.getByRole('button',{name:new RegExp(service.serviceName)}).first().click();
  const d=new Date(`${data.today}T12:00:00-05:00`);d.setUTCDate(d.getUTCDate()+3);
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(d);
  await form.getByLabel('Fecha y hora',{exact:false}).fill(`${day}T14:15`);await form.getByLabel('Nota',{exact:true}).fill(`${data.prefix} cita normal`);
  const created=page.waitForResponse(r=>r.url().includes('/rest/v1/rpc/guardar_cita_pos')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'Agendar',exact:true}).click();const response=await created;expect(response.ok()).toBeTruthy();const record=await response.json();
  await expect(form).toHaveCount(0);
  async function open(){
    await page.goto('/citas');
    await page.getByRole('button',{name:/^(Mostrar|Ocultar) canceladas$/}).filter({visible:true}).waitFor();
    if(await visibleButton(page,'Mostrar canceladas').count())await visibleButton(page,'Mostrar canceladas').click();
    await expect(visibleButton(page,'Ocultar canceladas')).toBeVisible();
    if(day.slice(0,7)!==data.today.slice(0,7)){
      const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      await page.getByRole('button',{name:new RegExp(`^${months[Number(data.today.slice(5,7))-1]} ${data.today.slice(0,4)}$`,'i')}).click();
      await page.getByRole('button',{name:new RegExp(`^${months[Number(day.slice(5,7))-1]}$`,'i')}).click();
    }
    await (await abrirBuscadorCitas(page)).fill(service.serviceName);
    await page.getByRole('button').filter({hasText:data.clientName}).filter({hasText:service.serviceName}).filter({visible:true}).click();
    await expect(page.getByText(service.serviceName,{exact:true}).filter({visible:true})).toBeVisible();
  }
  await open();await visibleButton(page,'Editar').click();form=formWithTitle(page,'Editar cita');await form.getByLabel('Fecha y hora',{exact:false}).fill(`${day}T15:15`);
  await form.getByRole('button',{name:'Guardar cambios',exact:true}).click();await expect(form).toHaveCount(0);await page.reload();await open();
  await visibleButton(page,'Editar').click();form=formWithTitle(page,'Editar cita');await expect(form.getByLabel('Fecha y hora',{exact:false})).toHaveValue(`${day}T15:15`);
  await expect(form.getByText(service.serviceName,{exact:true})).toBeVisible();await form.getByRole('button',{name:'Cancelar',exact:true}).click();
  await visibleButton(page,'Cancelar').click();await visibleButton(page,'Sí, cancelar').click();await expect(page.getByText('Cita cancelada.',{exact:true})).toBeVisible();await page.reload();await open();
  await expect(page.getByRole('dialog').getByText('Cancelada',{exact:true})).toBeVisible();await expect(visibleButton(page,'Editar')).toHaveCount(0);
  await info.attach('cita-normal',{body:Buffer.from(JSON.stringify({id:typeof record==='string'?record:record.id,serviceId:service.serviceId,date:day,initialTime:'14:15',savedTime:'15:15',finalState:'CANCELADA'})),contentType:'application/json'});
});
