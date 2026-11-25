import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import {
  MUESTRA_MINIMA_COHORTE,
  PERIODOS,
  avisoCobertura,
  compararCohortes,
  coberturaCostos,
  hayDeudaDeMonedas,
  porcentaje,
  rangoUltimosDias,
} from '../../lib/rentabilidadRecompensas.js'
import { AvisoError } from './ui.jsx'
import { soles } from './formato.js'

// Rentabilidad del programa y de cada servicio / producto (solo administradora). Todo lo calcula la base (recompensas_rentabilidad);
// aquí solo se muestra, con avisos de cobertura: el margen se calcula SOLO sobre las líneas con costo conocido.

const num = (x) => Number(x ?? 0)
const colorMargen = (x) => (num(x) < 0 ? 'text-red' : 'text-green')

function Tarjeta({ titulo, children, nota }) {
  return (
    <section className="rounded-lg border border-border bg-surface px-3 py-3">
      <h3 className="text-sm font-medium text-ink">{titulo}</h3>
      <div className="mt-2">{children}</div>
      {nota && <p className="mt-2 text-xs text-ink/50">{nota}</p>}
    </section>
  )
}

function Dato({ etiqueta, valor, clase = 'text-ink' }) {
  return (
    <div>
      <p className="text-[11px] text-ink/60">{etiqueta}</p>
      <p className={`font-mono text-sm ${clase}`}>{valor}</p>
    </div>
  )
}

function ListaMargen({ filas, vacio, mostrarUnidades = false }) {
  if (!filas?.length) return <p className="text-sm text-ink/60">{vacio}</p>
  return (
    <ul className="space-y-1.5">
      {filas.map((f) => (
        <li key={f.nombre} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-ink">{f.nombre}</span>
            <span className={`shrink-0 font-mono text-sm ${colorMargen(f.margen)}`}>{soles(f.margen)}</span>
          </div>
          <p className="font-mono text-[11px] text-ink/60">
            {mostrarUnidades ? `${num(f.unidades)} u · ` : `${num(f.lineas)} venta(s) · `}
            cobrado {soles(f.neto)} (descuento {soles(f.descuento)}) · costo {soles(f.costo)}
          </p>
        </li>
      ))}
    </ul>
  )
}

export default function Rentabilidad({ activo }) {
  const [periodo, setPeriodo] = useState('90')
  const [estado, setEstado] = useState({ cargando: true, error: false, datos: null })

  const cargar = useCallback(async () => {
    const dias = PERIODOS.find((p) => p.id === periodo).dias
    const { desde, hasta } = rangoUltimosDias(dias)
    setEstado((a) => ({ ...a, cargando: true, error: false }))
    const { data, error } = await supabase.rpc('recompensas_rentabilidad', { p_desde: desde, p_hasta: hasta })
    // Un error nunca se muestra como ceros: se conserva lo anterior (atenuado) y se avisa.
    setEstado((a) => (error || !data ? { cargando: false, error: true, datos: a.datos } : { cargando: false, error: false, datos: data }))
  }, [periodo])

  useEffect(() => {
    if (activo) cargar()
  }, [cargar, activo])

  const d = estado.datos
  const cob = coberturaCostos(d?.margen)
  const coh = compararCohortes(d?.cohortes)

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-ink/60">
        ¿Ganas o pierdes dinero? Aquí ves el margen real de cada servicio y producto (precio cobrado − descuentos − costo directo, con la
        comisión real de la asistente) y cómo se mueve el programa de puntos. Solo la administradora ve esto.
      </p>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="rent-periodo">Periodo</label>
        <select id="rent-periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-azul-metal">
          {PERIODOS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button type="button" onClick={cargar} disabled={estado.cargando} className="rounded-lg border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40">
          {estado.cargando ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {estado.error && <AvisoError mensaje="No se pudo cargar la rentabilidad." onReintentar={cargar} />}
      {estado.cargando && !d && <p className="text-center font-mono text-sm text-ink/60">Cargando...</p>}

      {d && (
        <div className={`space-y-3 transition-opacity ${estado.cargando || estado.error ? 'opacity-60' : ''}`}>
          <Tarjeta titulo="Resultado de las ventas" nota={avisoCobertura(cob)}>
            <div className="grid grid-cols-2 gap-3">
              <Dato etiqueta="Vendido (precio lista)" valor={soles(d.ventas.ingreso_bruto)} />
              <Dato etiqueta="Descuentos dados" valor={soles(d.ventas.descuentos)} />
              <Dato etiqueta="Cobrado neto" valor={soles(d.ventas.neto)} />
              <Dato etiqueta="Ventas" valor={num(d.ventas.cantidad)} />
              <Dato etiqueta="Costo directo (líneas con costo)" valor={soles(d.margen.costo_directo)} />
              <Dato
                etiqueta={`Margen directo${d.margen.margen_pct === null ? '' : ` (${porcentaje(d.margen.margen_pct)})`}`}
                valor={cob.conCosto > 0 ? soles(d.margen.margen) : '—'}
                clase={cob.conCosto > 0 ? colorMargen(d.margen.margen) : 'text-ink'}
              />
            </div>
            <p className="mt-2 font-mono text-[11px] text-ink/60">
              Líneas con costo conocido: {cob.conCosto} de {cob.total}{cob.pct === null ? '' : ` (${porcentaje(cob.pct)})`}
            </p>
          </Tarjeta>

          <Tarjeta
            titulo="Programa de puntos y sellos"
            nota={
              d.programa.activo
                ? `Activo desde ${d.programa.corte ? new Date(d.programa.corte).toLocaleDateString('es-PE') : '—'}.`
                : 'El programa está apagado: aquí no habrá movimientos hasta activarlo.'
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Dato etiqueta="Monedas emitidas" valor={num(d.programa.monedas_emitidas).toFixed(1)} />
              <Dato etiqueta="Monedas revertidas (anulaciones)" valor={num(d.programa.monedas_revertidas).toFixed(1)} />
              <Dato etiqueta="Monedas canjeadas" valor={num(d.programa.monedas_canjeadas).toFixed(1)} />
              <Dato etiqueta="Canjes (monedas + sellos)" valor={num(d.programa.canjes)} />
              <Dato etiqueta="Sellos otorgados" valor={num(d.programa.sellos_otorgados)} />
              <Dato etiqueta="Descuento por premios" valor={soles(d.ventas.descuento_por_recompensas)} />
            </div>
            {hayDeudaDeMonedas(d.programa) && (
              <p className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-ink/80">
                Hoy las clientas tienen <b>{num(d.programa.monedas_pendientes_total).toFixed(1)} monedas</b> sin canjear
                ({num(d.programa.clientas_con_saldo)} clienta(s)). No es un gasto todavía, pero es un compromiso: las monedas no vencen.
              </p>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="¿Vienen más y gastan más las clientas del programa?"
            nota={`«Miembras» = clientas con cuenta web (las únicas que acumulan). Solo se compara con al menos ${MUESTRA_MINIMA_COHORTE} clientas en cada grupo; con menos, la diferencia puede ser casualidad.`}
          >
            {!d.cohortes?.length ? (
              <p className="text-sm text-ink/60">Todavía no hay ventas con clienta registrada en este periodo.</p>
            ) : (
              <ul className="space-y-1.5">
                {[coh.miembras, coh.resto].filter(Boolean).map((c) => (
                  <li key={c.grupo} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <p className="text-sm text-ink">{c.grupo === 'MIEMBRAS' ? 'Miembras del programa' : 'Resto de clientas'}</p>
                    <p className="font-mono text-[11px] text-ink/60">
                      {num(c.clientas)} clienta(s) · {num(c.ventas_por_clienta)} ventas c/u · ticket {soles(c.ticket)} · vuelven (2+ días) {porcentaje(c.recurrentes_pct)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {d.cohortes?.length > 0 && !coh.suficiente && (
              <p className="mt-2 text-xs text-amber">Muestra todavía pequeña: no saques conclusiones de esta comparación.</p>
            )}
          </Tarjeta>

          <Tarjeta titulo="Margen por servicio" nota="Solo servicios con costo configurado. Margen = cobrado neto − costo directo (comisión real incluida).">
            <ListaMargen filas={d.por_servicio} vacio="Ningún servicio vendido tiene costo configurado todavía." />
          </Tarjeta>

          <Tarjeta titulo="Margen por producto" nota="Solo productos con costo conocido.">
            <ListaMargen filas={d.por_producto} vacio="Ningún producto vendido tiene costo conocido todavía." mostrarUnidades />
          </Tarjeta>

          {d.sin_costo?.length > 0 && (
            <Tarjeta titulo="Sin costo configurado (no entran en el margen)" nota="Costéalos en «Costeo de servicios» y «Costeo de productos» para verlos arriba.">
              <ul className="space-y-1.5">
                {d.sin_costo.map((f) => (
                  <li key={`${f.tipo}-${f.nombre}`} className="flex items-baseline justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <span className="min-w-0 truncate text-sm text-ink">
                      {f.nombre} <span className="text-[11px] text-ink/50">· {f.tipo === 'SERVICIO' ? 'servicio' : 'producto'}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-ink/70">{soles(f.ingreso)}</span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </div>
      )}
    </div>
  )
}
