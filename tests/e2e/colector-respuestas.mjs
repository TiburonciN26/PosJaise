// QA-058 — Colector de respuestas con vida útil explícita. Un observador `page.on('response', async r => await r.json())` que
// sigue vivo tras navegar deja promesas rechazadas sin manejar («Response body is unavailable…») y aborta el test. Este colector:
//  * lee el cuerpo DENTRO del manejador y registra el rechazo (saneado) en vez de dejarlo sin manejar;
//  * se retira con detener(), que además espera las lecturas en curso y devuelve lo recogido.
// No silencia errores de la aplicación: un cuerpo no disponible queda REGISTRADO ({ ok: false, motivo }) y las aserciones del
// caso siguen decidiendo con los datos que sí llegaron.
export function sanearMotivo(error) {
  return String(error?.message ?? error ?? 'sin detalle').split('\n')[0]
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/(apikey|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1 [oculto]')
    .slice(0, 200);
}

export function colectorRespuestas(page, coincide) {
  const datos = [];
  const pendientes = new Set();
  let activo = true;
  const manejador = (respuesta) => {
    if (!activo || !coincide(respuesta)) return;
    const lectura = respuesta.json().then(
      (cuerpo) => { datos.push({ ok: true, status: respuesta.status(), cuerpo }); },
      (error) => { datos.push({ ok: false, status: respuesta.status(), motivo: sanearMotivo(error) }); },
    );
    pendientes.add(lectura);
    lectura.finally(() => pendientes.delete(lectura));
  };
  page.on('response', manejador);
  return {
    datos,
    async detener() {
      if (activo) {
        activo = false;
        page.off('response', manejador);
      }
      await Promise.allSettled([...pendientes]);
      return datos;
    },
  };
}
