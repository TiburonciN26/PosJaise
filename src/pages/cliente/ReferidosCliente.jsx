import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Gift, MessageCircle, UserCircle, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../context/ToastContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { useCuponesNuevos } from '../../hooks/useCuponesNuevos.js'
import TarjetaCupon from '../../components/TarjetaCupon.jsx'

// "Referidos" (menú del avatar, anidada bajo Mi Perfil — mismo criterio
// que Direcciones/Notificaciones/Seguridad, §7.22 y sucesivas). Cada
// recompensa es un CUPÓN de un solo uso con su propio código (§7.27,
// 95_cupones_referido.sql) — no un saldo neto: la clienta muestra el
// código del cupón en caja, donde la cajera lo ingresa en el nuevo modo
// "Cupón" del botón de descuento de Ventas.jsx (a propósito, para que
// tenga que abrir la Web). El cupón de quien invita recién nace cuando
// el cupón de bienvenida del referido se canjea de verdad en una venta
// — nunca antes. Los mismos cupones también aparecen en "Cupones y
// ofertas" (OfertasCliente.jsx, §7.32) — ambas pantallas leen
// mis_cupones() directo, así que el estado (disponible/canjeado/
// anulado) siempre es el mismo en las dos, sin nada que sincronizar.
export default function ReferidosCliente() {
  const { mostrarToast } = useToast()

  const [estado, setEstado] = useState(null)
  const [cupones, setCupones] = useState([])
  const [cargando, setCargando] = useState(true)
  // mi_estado_referidos() exige un perfil de negocio vinculado (mismo
  // criterio que agendar_cita_web()/guardar_mi_resena()) y lanza un
  // error claro si todavía no lo tiene — ej. alguien recién registrado,
  // o personal que activó "Mi perfil de clienta" (§7.28) y todavía no
  // guardó Mi Perfil ni una vez. Sin este chequeo, la pantalla se
  // rompía entera al intentar leer estado.codigo de un estado nulo.
  const [sinPerfil, setSinPerfil] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [codigoIngresado, setCodigoIngresado] = useState('')
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState('')
  const cuponesNuevos = useCuponesNuevos(cupones)

  async function cargar() {
    const [estadoRes, cuponesRes] = await Promise.all([
      supabase.rpc('mi_estado_referidos'),
      supabase.rpc('mis_cupones'),
    ])
    setSinPerfil(Boolean(estadoRes.error))
    setEstado(estadoRes.error ? null : estadoRes.data?.[0] ?? null)
    setCupones(cuponesRes.data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function copiarCodigo() {
    try {
      await navigator.clipboard.writeText(estado.codigo)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      mostrarToast('No se pudo copiar. Copia el código a mano.', 'error')
    }
  }

  async function ingresarCodigo(evento) {
    evento.preventDefault()
    setError('')

    if (!codigoIngresado.trim()) {
      setError('Ingresa un código.')
      return
    }

    setAplicando(true)
    const { error: errorAplicar } = await supabase.rpc('aplicar_codigo_referido', {
      p_codigo: codigoIngresado.trim(),
    })
    setAplicando(false)

    if (errorAplicar) {
      setError(errorAplicar.message || 'No se pudo aplicar el código. Intenta de nuevo.')
      return
    }

    setCodigoIngresado('')
    mostrarToast('¡Código aplicado! Ya tienes tu cupón de bienvenida — muéstralo en tu próxima visita.', 'exito')
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  if (sinPerfil || !estado) {
    return (
      <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto w-full max-w-lg">
          <div className="liquid-glass flex flex-col items-center gap-2 rounded-none p-8 text-center">
            <UserCircle className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/60">
              Completa tu perfil (nombre y teléfono) para tener tu código de referidos.
            </p>
            <Link
              to="/mi-perfil"
              className="mt-2 rounded-full bg-[var(--lw-gold)] px-4 py-2 text-sm font-semibold text-black"
            >
              Ir a Mi Perfil
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const mensajeWhatsapp = encodeURIComponent(
    `¡Hola! Te invito a Jaise Beauty Academy 💅 Usa mi código "${estado.codigo}" al registrarte en la Web y te llevas un cupón de bienvenida para tu primera visita.`,
  )

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="liquid-glass rounded-none p-5 text-center">
          <Gift className="mx-auto h-8 w-8 text-[var(--lw-gold)]" />
          <p className="mt-2 text-sm text-white/70">
            Invita a una amiga: al registrarse con tu código gana un cupón de{' '}
            <span className="font-semibold text-[var(--lw-gold)]">
              {formatearSoles(estado.credito_referido)}
            </span>
            . Cuando lo canjee en su primera visita, tú ganas un cupón de{' '}
            <span className="font-semibold text-[var(--lw-gold)]">
              {formatearSoles(estado.credito_referidor)}
            </span>
            .
          </p>

          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="rounded-lg bg-white/5 px-4 py-2 font-mono text-lg font-semibold tracking-widest text-white">
              {estado.codigo}
            </span>
            <button
              type="button"
              onClick={copiarCodigo}
              aria-label="Copiar código"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white/70 transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
            >
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <a
            href={`https://wa.me/?text=${mensajeWhatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-full bg-[var(--lw-gold)] py-2.5 text-sm font-semibold text-black"
          >
            <MessageCircle className="h-4 w-4" />
            Compartir por WhatsApp
          </a>
        </div>

        <div className="liquid-glass mt-4 grid grid-cols-2 gap-4 rounded-none p-5 text-center">
          <div>
            <p className="text-2xl font-semibold text-white">{formatearSoles(estado.credito_disponible)}</p>
            <p className="mt-0.5 text-xs text-white/50">En cupones disponibles</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-1.5 text-2xl font-semibold text-white">
              <Users className="h-5 w-5 text-white/40" />
              {estado.total_referidos}
            </p>
            <p className="mt-0.5 text-xs text-white/50">Personas invitadas</p>
          </div>
        </div>

        {cupones.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-white">Tus cupones</p>
            <div className="space-y-2">
              {cupones.map((cupon) => (
                <TarjetaCupon key={cupon.id} cupon={cupon} esNuevo={cuponesNuevos.has(cupon.id)} />
              ))}
            </div>
            <Link
              to="/ofertas"
              className="mt-2 block text-center text-xs text-white/50 transition-colors hover:text-[var(--lw-gold)]"
            >
              Ver todos tus cupones en Cupones y ofertas →
            </Link>
          </div>
        )}

        {!estado.ya_referido && (
          <form onSubmit={ingresarCodigo} className="liquid-glass mt-4 space-y-3 rounded-none p-5">
            <p className="text-sm font-medium text-white">¿Alguien te invitó?</p>
            <p className="text-xs text-white/50">
              Ingresa su código antes de tu primera visita o compra para que ambos ganen el crédito.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={codigoIngresado}
                onChange={(evento) => setCodigoIngresado(evento.target.value.toUpperCase())}
                placeholder="Código de 6 letras"
                maxLength={6}
                className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 font-mono text-sm uppercase tracking-widest text-white outline-none placeholder:text-white/40 placeholder:tracking-normal placeholder:normal-case focus:border-[var(--lw-gold)]"
              />
              <button
                type="submit"
                disabled={aplicando}
                className="shrink-0 rounded-lg bg-[var(--lw-gold)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                {aplicando ? '...' : 'Aplicar'}
              </button>
            </div>
            {error && <p className="text-xs text-red">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
