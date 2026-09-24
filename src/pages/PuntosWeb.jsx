import { useEffect, useState } from 'react'
import { PiggyBank } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import Etiqueta from '../components/Etiqueta.jsx'

const formularioVacio = {
  puntosPorVisita: '1',
  puntosPorSolGastado: '0.05',
  umbralPremium: '10',
  umbralVip: '30',
}

// Panel administrativo de "Puntos Web" (cuelga de /web, ver
// navegacion.js) — configuración del sistema de niveles de tarjeta que
// ve el cliente en Mis puntos (chanchito del header). Confirmado con el
// usuario: los puntos suman TANTO por visitas como por monto gastado,
// pero las cantidades exactas todavía no están decididas — por eso viven
// acá, editables sin despliegue nuevo, en vez de hardcodeadas en
// mis_puntos() (88_puntos.sql). config_puntos es una fila singleton
// (id=1), igual que estado_negocio en Contacto Web — por eso este
// formulario es simple, sin buscador ni tarjetas.
export default function PuntosWeb() {
  const { mostrarToast } = useToast()
  const [formulario, setFormulario] = useState(formularioVacio)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase
      .from('config_puntos')
      .select('puntos_por_visita, puntos_por_sol_gastado, umbral_premium, umbral_vip')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) {
          setFormulario({
            puntosPorVisita: String(data.puntos_por_visita),
            puntosPorSolGastado: String(data.puntos_por_sol_gastado),
            umbralPremium: String(data.umbral_premium),
            umbralVip: String(data.umbral_vip),
          })
        }
        setCargando(false)
      })
  }, [])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()

    const umbralPremium = parseInt(formulario.umbralPremium, 10)
    const umbralVip = parseInt(formulario.umbralVip, 10)
    if (!Number.isFinite(umbralPremium) || !Number.isFinite(umbralVip) || umbralVip <= umbralPremium) {
      mostrarToast('El umbral de VIP debe ser mayor que el de Premium.', 'error')
      return
    }

    setGuardando(true)
    const { error } = await supabase
      .from('config_puntos')
      .update({
        puntos_por_visita: parseFloat(formulario.puntosPorVisita) || 0,
        puntos_por_sol_gastado: parseFloat(formulario.puntosPorSolGastado) || 0,
        umbral_premium: umbralPremium,
        umbral_vip: umbralVip,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', 1)

    setGuardando(false)

    if (error) {
      mostrarToast('No se pudo guardar. Intenta de nuevo.', 'error')
      return
    }

    mostrarToast('Configuración de puntos actualizada.', 'exito')
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
        <PiggyBank className="h-8 w-8 text-red" />
        <p className="text-base font-semibold text-red">Puntos Web</p>
        <p className="max-w-sm text-sm text-ink/60">
          Define cuántos puntos suma cada clienta y cuánto necesita para subir de nivel en su
          tarjeta (Básico → Premium → VIP). Todo cliente nuevo empieza en Básico.
        </p>
      </div>

      <form onSubmit={guardar} className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <Etiqueta htmlFor="puntos-visita">Puntos por visita completada</Etiqueta>
          <input
            id="puntos-visita"
            type="number"
            min="0"
            step="0.5"
            value={formulario.puntosPorVisita}
            onChange={(evento) => actualizarCampo('puntosPorVisita', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="puntos-sol">Puntos por sol (S/) gastado</Etiqueta>
          <input
            id="puntos-sol"
            type="number"
            min="0"
            step="0.01"
            value={formulario.puntosPorSolGastado}
            onChange={(evento) => actualizarCampo('puntosPorSolGastado', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
          <p className="mt-1 text-xs text-ink/50">
            Ej. 0.05 = 1 punto por cada S/20 gastados en servicios.
          </p>
        </div>

        <div>
          <Etiqueta htmlFor="puntos-umbral-premium">Puntos para llegar a Premium</Etiqueta>
          <input
            id="puntos-umbral-premium"
            type="number"
            min="1"
            step="1"
            value={formulario.umbralPremium}
            onChange={(evento) => actualizarCampo('umbralPremium', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="puntos-umbral-vip">Puntos para llegar a VIP</Etiqueta>
          <input
            id="puntos-umbral-vip"
            type="number"
            min="1"
            step="1"
            value={formulario.umbralVip}
            onChange={(evento) => actualizarCampo('umbralVip', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <PiggyBank className="h-4 w-4" />
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}
