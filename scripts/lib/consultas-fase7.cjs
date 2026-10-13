// Fase 7 · constructores de consultas compartidos por medir-fase7.cjs y verificar-conteos-fase7.cjs.
// Reproducen la forma que genera PostgREST (capturada de pg_stat_statements) para las listas de las Fases 4 y 5.

const COL_PEDIDO = `p.id, p.tipo_entrega, p.direccion_entrega, p.celular_entrega, p.costo_delivery, p.subtotal, p.descuento_cupon, p.total, p.estado, p.creado_en, p.metodo_pago, p.comprobante_url, p.cupon_codigo, p.tipo_comprobante, p.ruc, p.razon_social, p.pago_verificado`

// Pedidos Web (leerPedidos en src/lib/listasAdmin.js). `termino` es una expresión SQL (p. ej. un literal o :'variable') ya entrecomillada.
// Con búsqueda la app usa `clientes!inner` + `clientes.nombre ilike`: la PÁGINA hace un INNER JOIN LATERAL y el CONTEO usa el mismo
// filtro como EXISTS (así lo genera PostgREST), de modo que ambos describen el mismo conjunto de pedidos. `estado` es opcional.
const pedidosLista = ({ estado = null, termino = null, limite = 40, desde = 0 } = {}) => {
  const buscando = termino !== null
  const patron = buscando ? `('%' || ${termino} || '%')` : null
  const condEstado = estado ? `p.estado = '${estado}'` : null
  const existe = buscando ? `exists (select 1 from public.clientes c where c.nombre ilike ${patron} and c.id = p.cliente_id)` : null
  const filtro = [condEstado, existe].filter(Boolean)
  const donde = filtro.length ? `where ${filtro.join(' and ')}` : ''
  return {
    fuente: `select ${COL_PEDIDO}, row_to_json(c1.*)::jsonb clientes, row_to_json(z1.*)::jsonb zonas from public.pedidos_web p
    ${buscando ? 'inner' : 'left'} join lateral (select c.nombre, c.telefono from public.clientes c where ${buscando ? `c.nombre ilike ${patron} and ` : ''}c.id = p.cliente_id limit 1) c1 on true
    left join lateral (select z.nombre from public.zonas_delivery z where z.id = p.zona_delivery_id limit 1) z1 on true
    ${condEstado ? `where ${condEstado}` : ''} order by p.creado_en desc, p.id desc limit ${limite} offset ${desde}`,
    cuenta: `select 1 from public.pedidos_web p ${donde}`,
  }
}

// Forma de PostgREST: página + conteo exacto del filtro completo.
function envolver(esc) {
  const cuenta = esc.cuenta ?? 'select 1 where false'
  return `with pgrst_source as (${esc.fuente}), pgrst_source_count as (${cuenta}) ` +
    `select (select count(*) from pgrst_source_count) total_result_set, count(_t) page_total, coalesce(json_agg(_t), '[]') body from (select * from pgrst_source) _t`
}

// Línea base «antes de la Fase 7». Si las migraciones ya están aplicadas en la base (como en Local tras la entrega), el estado actual NO es
// «antes»: se revierten DENTRO de la transacción de prueba con el rollback documentado y se comprueba que las políticas y los índices son los
// originales; si no lo son, la corrida se aborta. Todo se deshace con el ROLLBACK final.
const { readFileSync } = require('node:fs')
const quitarTx = (sql) => sql.replace(/^\s*begin\s*;\s*$/gim, '').replace(/^\s*commit\s*;\s*$/gim, '')
const lineaBase = (rutaRollback) => `
select (exists (select 1 from pg_policies where policyname = 'pedidos_web_select' and qual ~* 'select') or exists (select 1 from pg_indexes where indexname like 'idx_f7_%')) as migrada \\gset
\\if :migrada
\\echo @@@LINEA_BASE|revertida dentro de la transaccion
${quitarTx(readFileSync(rutaRollback, 'utf8'))}
\\else
\\echo @@@LINEA_BASE|original
\\endif
do $chk$ begin
  if exists (select 1 from pg_policies where policyname = 'pedidos_web_select' and qual ~* 'select') or exists (select 1 from pg_indexes where indexname like 'idx_f7_%') then
    raise exception 'La linea base no es la original (politicas o indices de la Fase 7 presentes)';
  end if;
end $chk$;
`

module.exports = { COL_PEDIDO, pedidosLista, envolver, lineaBase }
