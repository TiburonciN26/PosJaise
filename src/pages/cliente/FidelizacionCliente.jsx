import { useEffect, useState } from 'react'
import { ArrowBigDown, Gift, Sparkles, Star, Ticket } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../context/ToastContext.jsx'
import { formatearFechaSoloDia } from '../../lib/fechas.js'
import CampoColapsable from '../../components/CampoColapsable.jsx'

const VISITAS_POR_RECOMPENSA = 5

// §7.58: el canje real ya existe — "Generar cupón" crea un cupón de %
// de verdad (generar_cupon_fidelizacion()), canjeable en Ventas con el
// mismo modo "Cupón" que ya usan los de Referidos (95_cupones_
// referido.sql). El progreso de sellos se sigue calculando al vuelo en
// mi_fidelizacion() a partir de registro_servicios — lo único que SÍ
// se guarda ahora es cuántas recompensas ya se reclamaron
// (clientes.fidelizacion_recompensas_reclamadas), para que el botón no
// se pueda tocar más veces de las tarjetas completas de verdad.
export default function FidelizacionCliente() {
  const { mostrarToast } = useToast()
  const [datos, setDatos] = useState(null)
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [historialAbierto, setHistorialAbierto] = useState(false)

  async function cargar() {
    const [fidelizacionRes, historialRes] = await Promise.all([
      supabase.rpc('mi_fidelizacion'),
      supabase.rpc('mi_historial_fidelizacion'),
    ])
    setDatos(!fidelizacionRes.error && fidelizacionRes.data?.length > 0 ? fidelizacionRes.data[0] : null)
    setHistorial(historialRes.data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function generarCupon() {
    setGenerando(true)
    const { data, error } = await supabase.rpc('generar_cupon_fidelizacion')
    setGenerando(false)

    if (error) {
      mostrarToast(error.message ?? 'No se pudo generar el cupón.', 'error')
      return
    }

    const cupon = data?.[0]
    mostrarToast(
      cupon ? `¡Cupón ${cupon.codigo} generado! Muéstralo en tu próxima visita.` : 'Cupón generado.',
      'exito',
    )
    // recompensas_disponibles baja recién con datos frescos del servidor
    // (fidelizacion_recompensas_reclamadas ya se actualizó ahí) — un
    // refetch completo, no un ajuste optimista a mano, para que quede
    // exactamente lo que el servidor validó.
    cargar()
  }

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
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--lw-gold)]">
                Tienes {recompensas} {recompensas === 1 ? 'recompensa disponible' : 'recompensas disponibles'}
              </p>
              <p className="mt-0.5 text-xs text-white/60">
                Genera tu cupón y muéstralo en tu próxima visita para que te apliquen el descuento.
              </p>
              <button
                type="button"
                onClick={generarCupon}
                disabled={generando}
                className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--lw-gold)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--lw-gold)] disabled:opacity-40"
              >
                <Ticket className="h-3.5 w-3.5" />
                {generando ? 'Generando...' : 'Generar cupón'}
              </button>
            </div>
          </div>
        )}

        {/* Historial de visitas (§7.58, pedido del usuario) — cada fecha
            de acá es también "cuándo se sumó un sello nuevo a la
            tarjeta", van ligados 1 a 1 (mismo criterio de "visita" que
            usa el progreso de arriba). Cerrado por defecto. */}
        {historial.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setHistorialAbierto((anterior) => !anterior)}
              aria-expanded={historialAbierto}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
            >
              Ver historial de visitas
              <ArrowBigDown
                className={`h-3 w-3 transition-transform duration-300 ${historialAbierto ? 'rotate-180' : ''}`}
              />
            </button>
            <CampoColapsable abierto={historialAbierto} margen>
              <div className="liquid-glass space-y-1.5 rounded-none p-3">
                {historial.map((visita, indice) => (
                  <div key={visita.fecha} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-white/70">Visita {historial.length - indice}</span>
                    <span className="text-white/40">{formatearFechaSoloDia(visita.fecha)}</span>
                  </div>
                ))}
              </div>
            </CampoColapsable>
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
