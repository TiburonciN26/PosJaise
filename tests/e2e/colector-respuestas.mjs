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

// QA-060 — Cuerpo de la respuesta que pertenece a UNA carga concreta de la página. Debe crearse JUSTO ANTES de navegar.
//  * Solo acepta peticiones emitidas DESPUÉS de que el marco principal se comprometió con el documento nuevo
//    ('framenavigated'): una respuesta tardía de la página anterior no se toma por la de esta carga.
//  * Empieza a leer el cuerpo en el mismo evento 'response' (no después de esperar la navegación), cuando aún está disponible.
//  * Si el cuerpo no se puede leer, o no llega respuesta en `timeout`, RECHAZA con un error saneado (no se silencia).
export function cuerpoDeLaCarga(page, coincide, { timeout = 15_000 } = {}) {
  let cargaNueva = false;
  const propias = new Set();
  let resolver;
  let rechazar;
  const resultado = new Promise((res, rej) => { resolver = res; rechazar = rej; });
  const alNavegar = (marco) => { if (marco === page.mainFrame()) cargaNueva = true; };
  const alPedir = (peticion) => { if (cargaNueva && coincide(peticion)) propias.add(peticion); };
  const alResponder = (respuesta) => {
    if (!propias.has(respuesta.request())) return;
    terminar();
    respuesta.json().then(resolver, (error) => rechazar(new Error(`El cuerpo de la respuesta de esta carga no está disponible: ${sanearMotivo(error)}`)));
  };
  const limite = setTimeout(() => { terminar(); rechazar(new Error('No llegó la respuesta esperada de esta carga.')); }, timeout);
  function terminar() {
    clearTimeout(limite);
    page.off('framenavigated', alNavegar);
    page.off('request', alPedir);
    page.off('response', alResponder);
  }
  page.on('framenavigated', alNavegar);
  page.on('request', alPedir);
  page.on('response', alResponder);
  resultado.catch(() => {}); // el llamador hace await del MISMO resultado: aquí solo se evita el aviso si la navegación lanza antes
  return resultado;
}
