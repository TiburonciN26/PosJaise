import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  History,
  LogOut,
  MapPin,
  Moon,
  ShieldCheck,
  Star,
  Sun,
  Ticket,
  UserCircle,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { usePerfilCliente } from '../context/PerfilClienteContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { urlPublicaFoto } from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-clientes'

// "Tu perfil", "Historial", "Fidelización" y "Cupones y ofertas" ya
// tienen pantalla real — el resto son accesos pensados para fases
// futuras del roadmap (ver implementacionesWed.md): Tus reseñas →
// futuro, Direcciones → múltiples direcciones a futuro (hoy Mi Perfil
// solo tiene una), Notificaciones y Seguridad de la cuenta (cambiar
// contraseña) son transversales, sin fase asignada todavía. "Tus citas"
// no va acá: Citas ya es una pestaña real de la barra principal, tenerla
// acá también sería redundante.
const OPCIONES = [
  { icono: UserCircle, label: 'Tu perfil', ruta: '/mi-perfil' },
  { icono: History, label: 'Historial', ruta: '/historial' },
  { icono: Wallet, label: 'Fidelización y puntos', ruta: '/fidelizacion' },
  { icono: Ticket, label: 'Cupones y ofertas', ruta: '/ofertas' },
  { icono: Star, label: 'Tus reseñas' },
  { icono: MapPin, label: 'Direcciones' },
  { icono: Bell, label: 'Notificaciones' },
  { icono: ShieldCheck, label: 'Seguridad de la cuenta' },
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
  const { cerrarSesion } = useAuth()
  const { tema, alternarTema } = useTheme()
  const { mostrarToast } = useToast()
  const navigate = useNavigate()

  const [abierto, setAbierto] = useState(false)
  const [confirmandoSalir, setConfirmandoSalir] = useState(false)
  const [errorFoto, setErrorFoto] = useState(false)
  const menuRef = useRef(null)
  const esOscuro = tema === 'oscuro'

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
        className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber/30 bg-amber/15 text-sm font-semibold text-amber"
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
      </button>

      {abierto && (
        <div className="animate-entrada-dropdown absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-border bg-surface-2 p-2 shadow-lg">
          <div className="flex justify-end border-b border-border px-1 pb-2">
            <button
              type="button"
              onClick={alternarTema}
              aria-label={esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              className="rounded-full p-1.5 text-ink/70 transition-colors hover:text-amber"
            >
              {esOscuro ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>

          <div className="pt-1">
            {OPCIONES.map((opcion) => (
              <button
                key={opcion.label}
                type="button"
                onClick={() => elegir(opcion)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface hover:text-amber"
              >
                <opcion.icono className="h-4 w-4 shrink-0" />
                {opcion.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setAbierto(false)
              setConfirmandoSalir(true)
            }}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-border px-3 py-2 pt-3 text-left text-sm text-red transition-colors hover:bg-surface"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Cerrar sesión
          </button>
        </div>
      )}

      {confirmandoSalir && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">¿Cerrar sesión?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Vas a salir de tu cuenta en este dispositivo.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoSalir(false)}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
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
