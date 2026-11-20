import { useState } from 'react'
import { Scissors, ShoppingBag, Receipt } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { diaLargo, hora, soles, ESTADOS_SERVICIO, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import CampoColapsable from '../CampoColapsable.jsx'
import { Capsula, EstadoLista } from './PiezasPerfil.jsx'
import IconoFlechaDesplegable from '../IconoFlechaDesplegable.jsx'

// Una fila por DÍA (hora de Lima): qué se hizo, quién la atendió, qué compró y cuánto pagó. Sale de visitas_cliente()
// (migración 20261118000001), que agrupa en el servidor las atenciones y las ventas de la clienta.
export default function SeccionVisitas({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase.rpc('visitas_cliente', { p_cliente_id: clienteId, p_limite: cantidad, p_desde: desde }),
  })
  const [abiertos, setAbiertos] = useState(() => new Set())

  function alternar(dia) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(dia)) siguiente.delete(dia)
      else siguiente.add(dia)
      return siguiente
    })
  }

  return (
    <EstadoLista lista={lista} vacio="Todavía no tiene visitas registradas.">
      <div className="space-y-2">
        {lista.filas.map((visita) => {
          const abierto = abiertos.has(visita.dia)
          const servicios = visita.servicios ?? []
          const ventas = visita.ventas ?? []
          const productos = ventas.flatMap((v) => (v.estado === 'ACTIVA' ? (v.productos ?? []) : []))
          const resumen = [
            servicios.length > 0 && `${servicios.length} servicio${servicios.length === 1 ? '' : 's'}`,
            productos.length > 0 && `${productos.length} producto${productos.length === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <div key={visita.dia} className="rounded-lg border border-border bg-bg/40">
              <button
                type="button"
                onClick={() => alternar(visita.dia)}
                aria-expanded={abierto}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${abierto ? 'text-purple-300' : 'text-ink'}`}>
                    {diaLargo(visita.dia)}
                  </p>
                  <p className={`truncate text-xs ${abierto ? 'text-purple-300/80' : 'text-ink/60'}`}>
                    {resumen || 'Solo pago'}
                  </p>
                </div>
                <span className={`shrink-0 font-mono text-sm font-semibold ${abierto ? 'text-purple-300' : 'text-green'}`}>
                  {soles(visita.total_pagado)}
                </span>
                <IconoFlechaDesplegable
                  className={`h-3 w-3 shrink-0 transition-transform duration-300 ${
                    abierto ? 'rotate-180 text-purple-300' : 'text-ink/60'
                  }`}
                />
              </button>

              <CampoColapsable abierto={abierto} diferido>
                <div className="space-y-3 border-t border-border px-3 py-2.5">
                  {servicios.length > 0 && (
                    <div>
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink/60">
                        <Scissors className="h-3.5 w-3.5" /> Servicios
                      </p>
                      <ul className="space-y-1">
                        {servicios.map((servicio) => (
                          <li key={servicio.id} className="flex items-start gap-2 text-sm">
                            <span className="w-20 shrink-0 whitespace-nowrap font-mono text-xs leading-5 text-ink/50">{hora(servicio.hora)}</span>
                            <div className="min-w-0 flex-1">
                              <p className={`truncate ${servicio.estado === 'CANCELADO' ? 'text-ink/50 line-through' : 'text-ink'}`}>
                                {servicio.nombre}
                              </p>
                              <p className="truncate text-xs text-ink/60">
                                {servicio.asistente || 'Sin asistente'}
                                {servicio.estado !== 'CANCELADO' && !servicio.cobrado && ' · sin cobrar'}
                              </p>
                              {servicio.nota && <p className="text-xs italic text-ink/50">{servicio.nota}</p>}
                            </div>
                            <Capsula estado={ESTADOS_SERVICIO[servicio.estado]} />
                            <span className="shrink-0 font-mono text-sm text-ink/80">{soles(servicio.precio)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {ventas.length > 0 && (
                    <div>
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink/60">
                        <Receipt className="h-3.5 w-3.5" /> Pagos
                      </p>
                      <ul className="space-y-2">
                        {ventas.map((venta) => {
                          const anulada = venta.estado === 'ANULADA'
                          const descuento =
                            Number(venta.descuento_pct) > 0
                              ? `${Number(venta.descuento_pct)}% dcto.`
                              : Number(venta.descuento_monto) > 0
                                ? `${soles(venta.descuento_monto)} dcto.`
                                : null
                          return (
                            <li key={venta.id} className={`text-sm ${anulada ? 'opacity-60' : ''}`}>
                              <div className="flex items-start gap-2">
                                <span className="w-20 shrink-0 whitespace-nowrap font-mono text-xs leading-5 text-ink/50">{hora(venta.hora)}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-ink">
                                    <span className="font-mono">{venta.codigo}</span>
                                    <span className="text-ink/60"> · {venta.metodo_pago}</span>
                                  </p>
                                  <p className="truncate text-xs text-ink/60">
                                    {[venta.vendedor && `Cobró ${venta.vendedor}`, descuento, venta.cupon && `Cupón ${venta.cupon}`]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </p>
                                </div>
                                {anulada && <Capsula estado={{ label: 'Anulada', clase: 'border-red/50 bg-red/15 text-red' }} />}
                                <span className={`shrink-0 font-mono text-sm ${anulada ? 'text-ink/50 line-through' : 'text-ink'}`}>
                                  {soles(venta.total)}
                                </span>
                              </div>
                              {(venta.productos ?? []).length > 0 && (
                                <ul className="ml-[5.5rem] mt-1 space-y-0.5">
                                  {venta.productos.map((producto, i) => (
                                    <li key={i} className="flex items-center gap-1.5 text-xs text-ink/70">
                                      <ShoppingBag className="h-3 w-3 shrink-0 text-ink/50" />
                                      <span className="min-w-0 flex-1 truncate">
                                        {producto.cantidad} × {producto.nombre}
                                      </span>
                                      <span className="shrink-0 font-mono">{soles(producto.subtotal)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  {ventas.length === 0 && (
                    <p className="text-xs text-ink/50">Ese día no se registró un cobro a su nombre.</p>
                  )}
                </div>
              </CampoColapsable>
            </div>
          )
        })}
      </div>
    </EstadoLista>
  )
}
