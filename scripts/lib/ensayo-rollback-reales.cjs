// Adaptadores REALES (REST de Supabase + Worker de medios) del ensayo de rollback de Galería. Reciben el `fetch` seguro (lista cerrada de
// orígenes, redirect:'error') y los datos de sesión, para poder probarlos con un fetch FALSO que lanza o pierde respuestas
// (scripts/verificar-ensayo-rollback-galeria.cjs). Una excepción de red SE PROPAGA: el núcleo la trata como escritura incierta.
const G = require('./guardas-interfaz-r2.cjs')

function dependenciasReales({ seguro, supa, anon, worker, alias, destino, token, fabricarWebp }) {
  const cab = () => ({ Authorization: `Bearer ${token()}`, Origin: alias })
  const restCab = (extra = {}) => ({ apikey: anon, Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...extra })
  return {
    // Lectura ESTRICTA y COMPLETA: estado 200, array y cardinalidad = total declarado (count=exact); nunca un snapshot parcial.
    leerFilas: async () => {
      const r = await seguro(`${supa}/rest/v1/galeria_web?select=id,titulo,antes_url,despues_url,orden,activo&order=id`, { headers: restCab({ Prefer: 'count=exact' }) })
      const datos = r.status === 200 ? await r.json().catch(() => null) : null
      const total = Number((r.headers.get('content-range') ?? '').split('/')[1])
      if (!Array.isArray(datos) || !Number.isFinite(total) || datos.length !== total) throw new Error(`lectura incompleta o fallida (${r.status}) de galeria_web: ${Array.isArray(datos) ? datos.length : '?'} de ${Number.isFinite(total) ? total : '?'}`)
      return datos
    },
    leerInventario: () => G.leerInventario([destino], async (d) => {
      const r = await seguro(`${worker}/v1/inventario/${d}`, { headers: cab() })
      return { estado: r.status, cuerpo: await r.json().catch(() => null) }
    }),
    insertarFila: async (cuerpo) => ({ estado: (await seguro(`${supa}/rest/v1/galeria_web`, { method: 'POST', headers: restCab({ Prefer: 'return=minimal' }), body: JSON.stringify(cuerpo) })).status }),
    actualizarFila: async (id, titulo, cambios) => {
      const r = await seguro(`${supa}/rest/v1/galeria_web?id=eq.${id}&titulo=eq.${encodeURIComponent(titulo)}`, { method: 'PATCH', headers: restCab({ Prefer: 'return=representation' }), body: JSON.stringify(cambios) })
      return { estado: r.status, filas: r.status === 200 ? await r.json().catch(() => null) : null }
    },
    borrarFila: async (id) => ({ estado: (await seguro(`${supa}/rest/v1/galeria_web?id=eq.${id}`, { method: 'DELETE', headers: restCab() })).status }),
    subir: async (id, v, bytes) => (await seguro(`${worker}/v1/medios/${destino}/${id}/${v}`, { method: 'PUT', headers: { ...cab(), 'Content-Type': 'image/webp' }, body: bytes })).status,
    borrarGrupo: async (pre) => (await seguro(`${worker}/v1/medios/${pre.replace(/\/$/, '')}`, { method: 'DELETE', headers: cab() })).status,
    leerUrl: async (url) => { const r = await seguro(url); return { estado: r.status, tipo: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) } },
    fabricarWebp,
  }
}

module.exports = { dependenciasReales }
