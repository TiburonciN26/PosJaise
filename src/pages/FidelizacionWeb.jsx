import { useEffect, useState } from 'react'
import { Stamp } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearValorCupon } from '../lib/cupones.js'
import Etiqueta from '../components/Etiqueta.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const formularioVacio = {
  porcentajeRecompensa: '20',
}

const ETIQUETAS_ESTADO = {
  DISPONIBLE: { texto: 'Disponible', clase: 'bg-amber/15 text-amber' },
  CANJEADO: { texto: 'Canjeado', clase: 'bg-green/15 text-green' },
  ANULADO: { texto: 'Anulado', clase: 'bg-ink/10 text-ink/50' },
}

// Panel administrativo de "Fidelización Web" (cuelga de /web como
// "padre", admin-only, mismo patrón que Puntos Web/Referidos Web) —
// configura el % de descuento del cupón que se genera al completar una
// tarjeta de 5 sellos (§7.58, 97_cupones_fidelizacion.sql) y muestra
// los cupones ya emitidos. El progreso de sellos en sí (Básico → Premium
// no aplica acá, es la tarjeta de puntos — esto es la tarjeta de sellos)
// se sigue viendo solo desde el lado del cliente (FidelizacionCliente.jsx);
// acá solo el % y la trazabilidad de lo ya generado.
export default function FidelizacionWeb() {
  const { mostrarToast } = useToast()
  const [formulario, setFormulario] = useState(formularioVacio)
  const [cupones, setCupones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('config_fidelizacion').select('porcentaje_recompensa').eq('id', 1).single(),
      // "clientes!cliente_id" desambigua: cupones tiene DOS FK a
      // clientes (cliente_id y referido_id) — mismo hint que ya usa
      // ReferidosWeb.jsx, sin él PostgREST no sabe cuál usar.
      // origen=FIDELIZACION: esta pantalla es solo de ESTOS cupones,
      // los de Referidos tienen su propia lista en Referidos Web.
      supabase
        .from('cupones')
        .select('codigo, valor, tipo_descuento, estado, creado_en, cliente:clientes!cliente_id(nombre)')
        .eq('origen', 'FIDELIZACION')
        .order('creado_en', { ascending: false }),
    ]).then(([configRes, cuponesRes]) => {
      if (configRes.data) {
        setFormulario({ porcentajeRecompensa: String(configRes.data.porcentaje_recompensa) })
      }
      setCupones(cuponesRes.data ?? [])
      setCargando(false)
    })
  }, [])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()

    const porcentaje = parseFloat(formulario.porcentajeRecompensa)
    if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
      mostrarToast('El porcentaje debe estar entre 0 y 100.', 'error')
      return
    }

    setGuardando(true)
    const { error } = await supabase
      .from('config_fidelizacion')
      .update({ porcentaje_recompensa: porcentaje, actualizado_en: new Date().toISOString() })
      .eq('id', 1)

    setGuardando(false)

    if (error) {
      mostrarToast('No se pudo guardar. Intenta de nuevo.', 'error')
      return
    }

    mostrarToast('Configuración de fidelización actualizada.', 'exito')
  }

  if (cargando) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-ink/60">Cargando...</p>
      </div>
    )
  }

  return (
    <div
      className="animate-entrada-pestana mx-auto w-full max-w-lg p-3 pb-6"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        <Stamp className="h-8 w-8 text-red" />
        <p className="text-base font-semibold text-red">Fidelización Web</p>
        <p className="max-w-sm text-sm text-ink/60">
          Define el % de descuento del cupón que se genera al completar una tarjeta de 5 sellos
          (1 sello por visita completada). El canje se hace en Ventas, con el mismo modo "Cupón"
          que ya usan los cupones de Referidos.
        </p>
      </div>

      <form onSubmit={guardar} className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <Etiqueta htmlFor="fidelizacion-porcentaje">% de descuento del cupón</Etiqueta>
          <input
            id="fidelizacion-porcentaje"
            type="number"
            min="1"
            max="100"
            step="1"
            value={formulario.porcentajeRecompensa}
            onChange={(evento) => actualizarCampo('porcentajeRecompensa', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Stamp className="h-4 w-4" />
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </form>

      <p className="mt-6 text-sm font-semibold text-ink">Cupones emitidos</p>
      {cupones.length === 0 ? (
        <EstadoVacio icono={Stamp} mensaje="Todavía no se generó ningún cupón de fidelización." />
      ) : (
        <div className="mt-2 space-y-2">
          {cupones.map((cupon) => {
            const etiquetaEstado = ETIQUETAS_ESTADO[cupon.estado] ?? ETIQUETAS_ESTADO.DISPONIBLE
            return (
              <div
                key={cupon.codigo}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-ink">{cupon.cliente?.nombre ?? '—'}</p>
                  <p className="truncate text-xs text-ink/50 font-mono">{cupon.codigo}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-red">{formatearValorCupon(cupon)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${etiquetaEstado.clase}`}>
                    {etiquetaEstado.texto}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
