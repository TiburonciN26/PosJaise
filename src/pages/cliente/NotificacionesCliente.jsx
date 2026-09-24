import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CalendarClock, CheckCheck, ShoppingBag, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useNotificacionesCliente } from '../../context/NotificacionesClienteContext.jsx'

const ICONO_TIPO = {
  PEDIDO: ShoppingBag,
  RESENA: Star,
  CITA: CalendarClock,
}

const formatoFecha = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

// "Notificaciones" (menú del avatar, anidada bajo Mi Perfil — mismo
// criterio que Direcciones, §7.22) — bandeja IN-APP, no push al celular
// (eso necesita infraestructura que no existe todavía: suscripción del
// navegador + un backend que dispare cada evento). Se alimenta sola de
// eventos reales vía triggers de Postgres (93_notificaciones.sql): un
// pedido cambia de estado, una reseña se modera, o el negocio (nunca la
// propia clienta) cancela una cita. Nunca se inserta nada desde el
// frontend — solo se lee y se marca como leída.
export default function NotificacionesCliente() {
  const navigate = useNavigate()
  const { recargar: recargarNoLeidas } = useNotificacionesCliente()

  const [notificaciones, setNotificaciones] = useState([])
  const [cargando, setCargando] = useState(true)

  async function cargar() {
    const { data } = await supabase
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, ruta, leida, creado_en')
      .order('creado_en', { ascending: false })
      .limit(50)
    setNotificaciones(data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function abrir(notificacion) {
    if (!notificacion.leida) {
      await supabase.from('notificaciones').update({ leida: true }).eq('id', notificacion.id)
      setNotificaciones((anterior) =>
        anterior.map((n) => (n.id === notificacion.id ? { ...n, leida: true } : n)),
      )
      recargarNoLeidas()
    }
    if (notificacion.ruta) navigate(notificacion.ruta)
  }

  async function marcarTodasLeidas() {
    const idsNoLeidas = notificaciones.filter((n) => !n.leida).map((n) => n.id)
    if (idsNoLeidas.length === 0) return

    setNotificaciones((anterior) => anterior.map((n) => ({ ...n, leida: true })))
    await supabase.from('notificaciones').update({ leida: true }).in('id', idsNoLeidas)
    recargarNoLeidas()
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  const hayNoLeidas = notificaciones.some((n) => !n.leida)

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-lg">
        {hayNoLeidas && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={marcarTodasLeidas}
              className="flex items-center gap-1.5 text-xs font-medium text-white/60 transition-colors hover:text-[var(--lw-gold)]"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar todas como leídas
            </button>
          </div>
        )}

        {notificaciones.length === 0 ? (
          <div className="liquid-glass mt-6 flex flex-col items-center gap-2 rounded-none p-8 text-center">
            <Bell className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/60">Todavía no tienes notificaciones.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {notificaciones.map((notificacion) => {
              const Icono = ICONO_TIPO[notificacion.tipo] ?? Bell
              return (
                <button
                  key={notificacion.id}
                  type="button"
                  onClick={() => abrir(notificacion)}
                  className={`liquid-glass flex w-full items-start gap-3 rounded-none p-4 text-left transition-colors hover:bg-white/5 ${
                    notificacion.leida ? '' : 'ring-1 ring-inset ring-[var(--lw-gold)]/30'
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--lw-gold)]">
                    <Icono className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-white">
                        {notificacion.titulo}
                      </p>
                      {!notificacion.leida && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lw-gold)]" />
                      )}
                    </div>
                    {notificacion.mensaje && (
                      <p className="mt-0.5 text-sm text-white/60">{notificacion.mensaje}</p>
                    )}
                    <p className="mt-1 font-mono text-xs text-white/40">
                      {formatoFecha.format(new Date(notificacion.creado_en))}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
