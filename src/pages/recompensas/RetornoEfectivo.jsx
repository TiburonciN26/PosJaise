import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { servicioPorId } from '../../lib/buscarServicios.js'
import {
  TEXTO_LECTURA,
  costosPorNivel,
  lecturaRetorno,
  monedasPorSol,
  retornoMonedas,
  retornoSellos,
  valorDelPremio,
} from '../../lib/retornoPremio.js'
import { CLASE_INPUT, soles } from './formato.js'

// Retorno efectivo EN VIVO del premio que se está creando o editando (se recalcula al escribir). Solo informa: no bloquea el guardado.
// «Por cada sol que gasta la clienta, ¿cuántos soles le devuelves en este premio?» Ver src/lib/retornoPremio.js.

const NOMBRE_NIVEL = { BASICO: 'Básico', PREMIUM: 'Premium', VIP: 'VIP' }
const COLOR = { bajo: 'text-amber', moderado: 'text-green', alto: 'text-red' }
const pct = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(1)} %`)

function Celda({ retorno, gasto }) {
  const lectura = lecturaRetorno(retorno)
  return (
    <span className={`font-mono ${lectura ? COLOR[lectura] : 'text-ink/60'}`}>
      {pct(retorno)}
      {gasto !== null && gasto !== undefined && <span className="text-ink/50"> · gasta {soles(gasto)}</span>}
    </span>
  )
}

export default function RetornoEfectivo({ f, tasas, sellosPorPremio }) {
  const [precioServicio, setPrecioServicio] = useState(null)
  const [referencia, setReferencia] = useState('')
  const esSellos = f.origen === 'SELLOS'

  // El valor de un premio de servicio es el precio de ese servicio: se pide por id cuando se elige.
  useEffect(() => {
    if (f.tipo !== 'SERVICIO' || !f.servicioId) return undefined
    let vigente = true
    servicioPorId(supabase, f.servicioId, 'id, precio').then(
      (fila) => vigente && setPrecioServicio(fila ? Number(fila.precio) : null),
      () => vigente && setPrecioServicio(null),
    )
    return () => {
      vigente = false
    }
  }, [f.tipo, f.servicioId])

  const necesitaCompra = f.tipo === 'PORCENTAJE' && !(Number(f.tope) > 0)
  const valor = valorDelPremio({
    tipo: f.tipo,
    valor: f.valor,
    tope: f.tope,
    servicioPrecio: f.tipo === 'SERVICIO' && f.servicioId ? precioServicio : null,
    compraEjemplo: f.tipo === 'PORCENTAJE' ? referencia : null,
  })

  let cuerpo
  if (!valor) {
    cuerpo = (
      <p className="text-xs text-ink/60">
        {f.tipo === 'SERVICIO'
          ? 'Elige el servicio para calcular cuánto vale este premio.'
          : necesitaCompra
            ? 'Un porcentaje sin tope depende de la compra donde se use: escribe una compra de ejemplo o pon un tope de descuento.'
            : 'Escribe el valor del premio para calcular su retorno.'}
      </p>
    )
  } else if (esSellos) {
    const r = retornoSellos({ valorSoles: valor.soles, sellosPorPremio, gastoPorVisita: referencia })
    const lectura = lecturaRetorno(r.retorno)
    cuerpo = (
      <div className="space-y-1 text-sm">
        <p className="text-xs text-ink/60">Equivale a {sellosPorPremio} visitas con servicios (un sello por visita).</p>
        {r.retorno === null ? (
          <p className="text-xs text-ink/60">Escribe el gasto promedio por visita para ver el retorno.</p>
        ) : (
          <p>
            <span className={`font-mono ${COLOR[lectura]}`}>{pct(r.retorno)}</span>{' '}
            <span className="text-xs text-ink/60">(gasta {soles(r.gasto)} en {r.visitas} visitas y recibe {soles(valor.soles)})</span>
          </p>
        )}
        {lectura && <p className="text-xs text-ink/60">{TEXTO_LECTURA[lectura]}</p>}
      </div>
    )
  } else {
    const filas = retornoMonedas({
      valorSoles: valor.soles,
      costos: costosPorNivel({ costoBasico: f.costoBasico, costoPremium: f.costoPremium, costoVip: f.costoVip }),
      tasaServ: tasas.serv,
      tasaProd: tasas.prod,
    })
    const mejor = filas.reduce((m, x) => Math.max(m, x.retornoServicios ?? 0, x.retornoProductos ?? 0), 0)
    const lectura = filas.length ? lecturaRetorno(mejor) : null
    cuerpo = filas.length === 0 ? (
      <p className="text-xs text-ink/60">Escribe el costo en monedas para calcular el retorno.</p>
    ) : (
      <div className="space-y-1.5">
        <ul className="space-y-1">
          {filas.map((x) => (
            <li key={x.nivel} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs">
              <p className="text-ink">
                {NOMBRE_NIVEL[x.nivel]} · {x.costo} monedas
              </p>
              <p className="text-ink/70">
                Si gana en servicios: <Celda retorno={x.retornoServicios} gasto={x.gastoServicios} />
              </p>
              <p className="text-ink/70">
                Si gana en productos: <Celda retorno={x.retornoProductos} gasto={x.gastoProductos} />
              </p>
              {x.costo === 0 && <p className="text-amber">Costo 0: es un regalo, no hay retorno que calcular.</p>}
            </li>
          ))}
        </ul>
        {lectura && <p className="text-xs text-ink/60">{TEXTO_LECTURA[lectura]}</p>}
      </div>
    )
  }

  const etiquetaReferencia = esSellos ? 'Gasto promedio por visita (S/)' : 'Compra de ejemplo (S/)'
  const mostrarReferencia = esSellos || necesitaCompra
  const rs = monedasPorSol(tasas.serv)
  const rp = monedasPorSol(tasas.prod)

  return (
    <section aria-label="Retorno efectivo del premio" className="rounded-lg border border-border p-3">
      <h3 className="text-xs font-medium text-ink">Retorno efectivo (por cada sol que gasta la clienta, ¿cuánto le devuelves?)</h3>
      {valor && (
        <p className="mt-1 font-mono text-xs text-ink/70">
          Valor del premio: {soles(valor.soles)}
          {valor.nota ? ` · ${valor.nota}` : ''}
        </p>
      )}
      {mostrarReferencia && (
        <div className="mt-2">
          <label htmlFor="retorno-referencia" className="text-xs text-ink/60">{etiquetaReferencia}</label>
          <input
            id="retorno-referencia"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={CLASE_INPUT}
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
          />
        </div>
      )}
      <div className="mt-2">{cuerpo}</div>
      {!esSellos && rs !== null && rp !== null && (
        <p className="mt-2 text-[11px] text-ink/50">
          Con las tasas actuales la clienta gana {rs.toFixed(3).replace(/\.?0+$/, '')} monedas por S/ en servicios y {rp.toFixed(3).replace(/\.?0+$/, '')} en productos. Referencia
          general: entre 3 % y 8 % es lo habitual; la decisión real depende de tu margen.
        </p>
      )}
    </section>
  )
}
