import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Gift,
  History,
  LogOut,
  MapPin,
  ShieldCheck,
  Star,
  Store,
  Ticket,
  UserCircle,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { usePerfilCliente } from '../context/PerfilClienteContext.jsx'
import { useNotificacionesCliente } from '../context/NotificacionesClienteContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { urlPublicaFoto } from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-clientes'

// Todas las opciones de acá ya tienen pantalla real. "Tus citas" no va
// acá:
// Citas ya es una pestaña real de la barra principal, tenerla acá
// también sería redundante. "Nuestro equipo" tampoco: se mudó a la
// pestaña "Nosotros" de la barra principal (no es información de la
// cuenta del cliente) — "Tus reseñas" SÍ se queda acá porque son las
// reseñas que ESTA clienta escribió (no confundir con la sub-sección
// pública "Reseñas" de Nosotros, que muestra testimonios de todas).
const OPCIONES = [
  { icono: UserCircle, label: 'Tu perfil', ruta: '/mi-perfil' },
  { icono: History, label: 'Historial', ruta: '/historial' },
  { icono: Wallet, label: 'Fidelización y puntos', ruta: '/fidelizacion' },
  { icono: Ticket, label: 'Cupones y ofertas', ruta: '/ofertas' },
  { icono: Star, label: 'Tus reseñas', ruta: '/mis-resenas' },
  { icono: MapPin, label: 'Direcciones', ruta: '/mi-perfil/direcciones' },
  { icono: Gift, label: 'Referidos', ruta: '/mi-perfil/referidos' },
  { icono: Bell, label: 'Notificaciones', ruta: '/mi-perfil/notificaciones' },
  { icono: ShieldCheck, label: 'Seguridad de la cuenta', ruta: '/mi-perfil/seguridad' },
]

function iniciales(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

export default function MenuUsuarioCliente() {
  const { perfil } = usePerfilCliente()
  const { rol, cerrarSesion, volverAlPos } = useAuth()
  const { mostrarToast } = useToast()
  // Personal (asistente/cajera/admin) mirando su propio perfil de clienta
  // con la misma sesión (ver AuthContext.jsx, "entrarComoClienta") — un
  // cliente puro tiene rol 'CLIENTE', nunca ve este botón.
  const esPersonalEnModoCliente = Boolean(rol) && rol !== 'CLIENTE'
  const { noLeidas } = useNotificacionesCliente()
  const navigate = useNavigate()

  const [abierto, setAbierto] = useState(false)
  const [confirmandoSalir, setConfirmandoSalir] = useState(false)
  const [errorFoto, setErrorFoto] = useState(false)
  const menuRef = useRef(null)

  useCerrarConEscape(() => setAbierto(false), abierto)
  useCerrarConEscape(() => setConfirmandoSalir(false), confirmandoSalir)

  // Mismo patrón que MenuUsuario.jsx (POS): cierre por clic-afuera con ref,
  // no por onBlur, para que un clic dentro del propio menú nunca lo cierre.
  useEffect(() => {
    if (!abierto) return undefined
    function alClicFuera(evento) {
      if (menuRef.current && !menuRef.current.contains(evento.target)) {
        setAbierto(false)
      }
    }
    document.addEventListener('pointerdown', alClicFuera)
    return () => document.removeEventListener('pointerdown', alClicFuera)
  }, [abierto])

  function elegir(opcion) {
    setAbierto(false)
    if (opcion.ruta) {
      navigate(opcion.ruta)
    } else {
      mostrarToast('Próximamente.', 'info')
    }
  }

  const urlFoto = !errorFoto ? urlPublicaFoto(BUCKET_FOTOS, perfil?.foto_url) : null

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((valorAnterior) => !valorAnterior)}
        aria-expanded={abierto}
        aria-label="Menú de cuenta"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--lw-gold)]/30 bg-[var(--lw-gold)]/15 text-sm font-semibold text-[var(--lw-gold)]"
      >
        {urlFoto ? (
          <img
            src={urlFoto}
            alt=""
            onError={() => setErrorFoto(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          iniciales(perfil?.nombre)
        )}
        {noLeidas > 0 && (
          <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border border-black bg-[var(--lw-gold)]" />
        )}
      </button>

      {abierto && (
        <div className="lw-bar animate-entrada-dropdown absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-white/10 p-2 shadow-lg">
          <div className="pt-1">
            {OPCIONES.map((opcion) => (
              <button
                key={opcion.label}
                type="button"
                onClick={() => elegir(opcion)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/5 hover:text-[var(--lw-gold)]"
              >
                <opcion.icono className="h-4 w-4 shrink-0" />
                <span className="flex-1">{opcion.label}</span>
                {opcion.label === 'Notificaciones' && noLeidas > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--lw-gold)] px-1 text-[10px] font-semibold text-black">
                    {noLeidas > 9 ? '9+' : noLeidas}
                  </span>
                )}
              </button>
            ))}
          </div>

          {esPersonalEnModoCliente && (
            <button
              type="button"
              onClick={() => {
                setAbierto(false)
                volverAlPos()
              }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-white/10 px-3 py-2 pt-3 text-left text-sm text-[var(--lw-gold)] transition-colors hover:bg-white/5"
            >
              <Store className="h-4 w-4 shrink-0" />
              Volver al POS
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setAbierto(false)
              setConfirmandoSalir(true)
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red transition-colors hover:bg-white/5 ${
              esPersonalEnModoCliente ? 'mt-1' : 'mt-1 border-t border-white/10 pt-3'
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Cerrar sesión
          </button>
        </div>
      )}

      {confirmandoSalir && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="lw-bar w-full max-w-sm rounded-lg border border-white/10 p-5">
            <h2 className="text-base font-semibold text-white">¿Cerrar sesión?</h2>
            <p className="mt-1 text-sm text-white/60">Vas a salir de tu cuenta en este dispositivo.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoSalir(false)}
                className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={cerrarSesion}
                className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white"
              >
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
