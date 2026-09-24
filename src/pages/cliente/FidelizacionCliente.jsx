import { useEffect, useState } from 'react'
import { Gift, Sparkles, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'

const VISITAS_POR_RECOMPENSA = 5

// Solo ver progreso — el canje real en caja queda para una fase aparte
// (ver implementacionesWed.md §2.5). El progreso se calcula al vuelo en
// mi_fidelizacion() a partir de registro_servicios: no hay contador ni
// tabla de movimientos que se puedan desincronizar.
export default function FidelizacionCliente() {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    supabase.rpc('mi_fidelizacion').then(({ data, error }) => {
      if (!vigente) return
      setDatos(!error && data?.length > 0 ? data[0] : null)
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  const sellos = datos?.sellos_actuales ?? 0
  const visitasTotales = datos?.visitas_totales ?? 0
  const recompensas = datos?.recompensas_disponibles ?? 0
  // Justo al completar un múltiplo de 5, el módulo da 0 — sin este caso
  // especial se leería como "recién empezaste" en vez de "¡la llenaste!".
  const tarjetaLlena = visitasTotales > 0 && sellos === 0

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="liquid-glass rounded-none p-5 text-center">
          <p className="text-sm text-white/60">
            Cada {VISITAS_POR_RECOMPENSA} visitas completadas ganas{' '}
            <span className="font-semibold text-[var(--lw-gold)]">20% de descuento</span> en tu próximo
            servicio.
          </p>

          <div className="mt-4 flex justify-center gap-2">
            {Array.from({ length: VISITAS_POR_RECOMPENSA }, (_, i) => {
              const lleno = tarjetaLlena || i < sellos
              return (
                <div
                  key={i}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${
                    lleno ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)]/15' : 'border-dashed border-white/20'
                  }`}
                >
                  <Star
                    className={`h-5 w-5 ${lleno ? 'fill-[var(--lw-gold)] text-[var(--lw-gold)]' : 'text-white/20'}`}
                  />
                </div>
              )
            })}
          </div>

          <p className="mt-3 text-sm font-medium text-white">
            {tarjetaLlena
              ? '¡Tarjeta completa!'
              : `${sellos} de ${VISITAS_POR_RECOMPENSA} visitas`}
          </p>
          <p className="mt-1 text-xs text-white/60">
            {visitasTotales === 0
              ? 'Todavía no tienes visitas registradas.'
              : `${visitasTotales} ${visitasTotales === 1 ? 'visita completada' : 'visitas completadas'} en total.`}
          </p>
        </div>

        {recompensas > 0 && (
          <div className="liquid-glass mt-3 flex items-start gap-3 rounded-none p-3.5">
            <Gift className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--lw-gold)]">
                Tienes {recompensas} {recompensas === 1 ? 'recompensa disponible' : 'recompensas disponibles'}
              </p>
              <p className="mt-0.5 text-xs text-white/60">
                Menciónalo en tu próxima visita para que te apliquen el descuento.
              </p>
            </div>
          </div>
        )}

        {visitasTotales === 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-white/50">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            Agenda tu primera cita para empezar a sumar sellos.
          </div>
        )}
      </div>
    </div>
  )
}
