import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { sumarMontos } from '../../lib/moneda.js'
import { diaCorto, soles, ESTADOS_DEUDA, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import { Capsula, EstadoLista } from './PiezasPerfil.jsx'

// Quién cobró un abono, con el mismo criterio que la pestaña Deudas: si vino de una nota de cobro confirmada, quien la
// anotó (aunque la confirme la administradora); si no, quien registró el pago (`creado_por`). Los pagos viejos sin
// `creado_por` quedan como «Administración», que era la única que podía registrarlos.
function cobradoPorDe(deuda) {
  const porNota = new Map(
    (deuda.deuda_notas_cobro ?? [])
      .filter((nota) => nota.estado === 'CONFIRMADA' && nota.pago_id)
      .map((nota) => [nota.pago_id, nota.creado_por_nombre]),
  )
  return (pago) => porNota.get(pago.id) || pago.usuarios?.nombre_completo || 'Administración'
}

// Deudas de la clienta con sus abonos y el saldo. Cobrar o abonar se sigue haciendo en la pestaña Deudas: el enlace
// la abre filtrada a esta clienta (`/deudas?cliente=<id>`).
export default function SeccionDeudas({ clienteId, nombreCliente }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('deudas')
        .select(
          'id, concepto, monto, fecha, estado, nota, cobrado_en, ' +
            'deuda_pagos(id, monto, fecha, nota, creado_en, usuarios(nombre_completo)), ' +
            'deuda_notas_cobro(estado, creado_por_nombre, pago_id)',
        )
        .eq('cliente_id', clienteId)
        .order('fecha', { ascending: false })
        .order('id')
        .range(desde, desde + cantidad - 1),
  })

  return (
    <>
      <EstadoLista lista={lista} vacio="No tiene deudas registradas.">
        <ul className="space-y-2">
          {lista.filas.map((deuda) => {
            const pagos = [...(deuda.deuda_pagos ?? [])].sort((a, b) =>
              a.fecha === b.fecha ? a.creado_en.localeCompare(b.creado_en) : a.fecha.localeCompare(b.fecha),
            )
            const cobradoPor = cobradoPorDe(deuda)
            const pagado = sumarMontos(pagos, (p) => p.monto)
            const saldo = Math.max(Number(deuda.monto) - pagado, 0)
            return (
              <li key={deuda.id} className="rounded-lg border border-border bg-bg/40 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{deuda.concepto}</p>
                    <p className="text-xs text-ink/60">
                      {diaCorto(deuda.fecha)} · Monto {soles(deuda.monto)}
                    </p>
                    {deuda.nota && <p className="text-xs italic text-ink/50">{deuda.nota}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Capsula estado={ESTADOS_DEUDA[deuda.estado]} />
                    {deuda.estado === 'PENDIENTE' && (
                      <span className="font-mono text-sm font-semibold text-amber">Saldo {soles(saldo)}</span>
                    )}
                  </div>
                </div>
                {pagos.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
                    {pagos.map((pago) => (
                      <li key={pago.id} className="flex items-center gap-2 text-xs text-ink/70">
                        <span className="w-20 shrink-0 font-mono text-ink/50">{diaCorto(pago.fecha)}</span>
                        <span className="min-w-0 flex-1 truncate">
                          Cobró {cobradoPor(pago)}
                          {pago.nota && <span className="text-ink/50"> · {pago.nota}</span>}
                        </span>
                        <span className="shrink-0 font-mono text-green">{soles(pago.monto)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </EstadoLista>
      <Link
        to={`/deudas?cliente=${clienteId}`}
        state={{ nombreCliente }}
        className="mt-3 inline-flex items-center gap-1 text-sm text-purple-300 transition-colors hover:text-purple-200"
      >
        Cobrar o registrar en Deudas
        <ArrowRight className="h-4 w-4" />
      </Link>
    </>
  )
}
