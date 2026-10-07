import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'
import { useCerrarConEscape } from '../../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../../hooks/useModalA11y.js'
import {
  REGLA_CUPONES,
  REGLA_PROTECCION,
  describirBeneficio,
  formatearMonedas,
  textoAlcance,
  textoMinimo,
  textoPagoMinimo,
  textoVigenciaCupon,
} from './lib.js'

// Canje DEFINITIVO de un premio (monedas o sellos).
//
// Idempotencia: cada intención de canje lleva una clave que se guarda en
// sessionStorage hasta que el servidor responda con un resultado definitivo.
// Si la respuesta se pierde (red caída, recarga), el reintento reutiliza la MISMA
// clave y el servidor devuelve el mismo cupón sin descontar otra vez. Un error de
// negocio (saldo insuficiente, agotado…) no debita nada y descarta la clave.
// Mientras el canje está en vuelo no se puede cerrar ni confirmar de nuevo (doble clic).

const clavePendiente = (userId, premioId) => `jaise:canje:${userId}:${premioId}`

function leerClave(userId, premioId) {
  const k = clavePendiente(userId, premioId)
  try {
    const guardada = sessionStorage.getItem(k)
    if (guardada) return { clave: guardada, recuperada: true }
    const nueva = crypto.randomUUID()
    sessionStorage.setItem(k, nueva)
    return { clave: nueva, recuperada: false }
  } catch {
    return { clave: crypto.randomUUID(), recuperada: false }
  }
}
function olvidarClave(userId, premioId) {
  try {
    sessionStorage.removeItem(clavePendiente(userId, premioId))
  } catch {
    /* sin almacenamiento: no hay nada que limpiar */
  }
}

// Un error con `code` de Postgres (p. ej. P0001 de RAISE EXCEPTION) es una respuesta
// definitiva del servidor; sin código (fallo de red) no sabemos si el canje se hizo.
const esRespuestaDefinitiva = (error) => Boolean(error?.code)

export default function ConfirmarCanje({ premio, origen, saldo, userId, onCerrar, onExito }) {
  const panelRef = useRef(null)
  const [fase, setFase] = useState('confirmar') // confirmar | enviando | incierto | error | hecho
  const [mensaje, setMensaje] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [recuperada] = useState(() => Boolean(sessionStorage.getItem(clavePendiente(userId, premio.id))))
  const enVuelo = useRef(false)

  useModalA11y(panelRef)
  useCerrarConEscape(() => {
    if (!enVuelo.current) onCerrar(fase === 'hecho')
  })

  // Si había una clave pendiente (respuesta perdida o recarga), se avisa y se reintenta con ella.
  useEffect(() => {
    if (recuperada) {
      setMensaje(
        'Quedó un canje sin confirmar. Si ya se emitió, recuperaremos el mismo cupón sin descontar otra vez.',
      )
    }
  }, [recuperada])

  const esSellos = origen === 'SELLOS'
  const unidad = esSellos ? 'sellos' : 'monedas'
  const costo = Number(premio.costo)
  const disponible = esSellos ? Number(saldo.sellos) : Number(saldo.monedas)
  const resultante = disponible - costo
  const formato = (n) => (esSellos ? String(n) : formatearMonedas(n))
  const pagoMinimo = textoPagoMinimo(premio)

  async function confirmar() {
    if (enVuelo.current) return
    enVuelo.current = true
    setFase('enviando')
    setMensaje(null)
    const { clave } = leerClave(userId, premio.id)
    const fn = esSellos ? 'canjear_premio_sellos' : 'canjear_recompensa'
    let data = null
    let error = null
    try {
      const r = await supabase.rpc(fn, { p_catalogo_id: premio.id, p_clave: clave })
      data = r.data
      error = r.error
    } catch (e) {
      error = e ?? new Error('red')
    }
    enVuelo.current = false

    if (!error && data?.[0]) {
      olvidarClave(userId, premio.id)
      setResultado(data[0])
      setFase('hecho')
      onExito()
      return
    }
    if (error && esRespuestaDefinitiva(error)) {
      olvidarClave(userId, premio.id)
      setMensaje(error.message || 'No se pudo completar el canje. No se descontó nada.')
      setFase('error')
      return
    }
    // Sin respuesta confiable: la clave se conserva para recuperar el mismo resultado.
    setMensaje(
      'No pudimos confirmar si el canje se realizó. Reintenta: si ya se emitió, recuperaremos el mismo cupón y no se descontará otra vez.',
    )
    setFase('incierto')
  }

  const contenido = (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 px-4 pb-6 pt-16">
      <div
        ref={panelRef}
        className="lw-bar flex w-full max-w-[480px] flex-col gap-4 rounded-lg border border-white/10 p-6"
      >
        {fase === 'hecho' ? (
          <>
            <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Canje realizado</span>
            <h2 className="text-xl font-semibold leading-snug text-white">{premio.nombre}</h2>
            <div className="break-all rounded-lg border border-dashed border-[var(--lw-gold)] px-3 py-4 text-center font-mono text-3xl font-bold tracking-[0.12em] text-white">
              {resultado.codigo}
            </div>
            <p className="text-[13px] leading-relaxed text-white/70">
              {resultado.repetido
                ? 'Recuperamos el cupón de este canje: no se descontó nada más.'
                : `Se descontaron ${formato(Number(resultado.costo))} ${unidad}.`}{' '}
              Lo encuentras en «Mis cupones» y lo muestras en caja al pagar.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/recompensas?seccion=cupones"
                onClick={() => onCerrar(true)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-[#3a3a3f] px-5 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
              >
                Ver mis cupones
              </Link>
              <button
                type="button"
                onClick={() => onCerrar(true)}
                className="min-h-11 flex-1 rounded-full bg-white px-5 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
              >
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Confirmar canje</span>
            <h2 className="text-xl font-semibold leading-snug text-white">{premio.nombre}</h2>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px] leading-snug">
              <dt className="text-white/50">Beneficio</dt>
              <dd className="text-white">{describirBeneficio(premio)}</dd>
              <dt className="text-white/50">Costo</dt>
              <dd className="font-semibold text-[var(--lw-gold)]">
                {formato(costo)} {unidad}
              </dd>
              <dt className="text-white/50">{esSellos ? 'Sellos ahora' : 'Saldo ahora'}</dt>
              <dd className="text-white">
                {formato(disponible)} {unidad}
              </dd>
              <dt className="text-white/50">{esSellos ? 'Sellos después' : 'Saldo después'}</dt>
              <dd className="text-white">
                {formato(resultante)} {unidad}
              </dd>
              <dt className="text-white/50">Aplica en</dt>
              <dd className="text-white">{textoAlcance(premio)}</dd>
              <dt className="text-white/50">Compra mínima</dt>
              <dd className="text-white">{textoMinimo(premio)}</dd>
              <dt className="text-white/50">Vigencia del cupón</dt>
              <dd className="text-white">{textoVigenciaCupon(premio)}</dd>
              {premio.nivel_minimo !== 'BASICO' && (
                <>
                  <dt className="text-white/50">Nivel</dt>
                  <dd className="text-white">Desde {premio.nivel_minimo === 'VIP' ? 'VIP' : 'Premium'}</dd>
                </>
              )}
            </dl>

            {pagoMinimo && (
              <p className="border border-[var(--lw-gold)]/40 bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed text-white">
                {pagoMinimo}
              </p>
            )}

            <p className="text-xs leading-relaxed text-white/60">{REGLA_CUPONES}</p>
            <p className="text-xs leading-relaxed text-white/60">{REGLA_PROTECCION}</p>
            <p className="text-[13px] font-semibold leading-relaxed text-white">
              Este canje es definitivo. Una vez confirmado, no podrás recuperar {esSellos ? 'los sellos' : 'las monedas'}{' '}
              utilizados{esSellos ? '' : ', aunque el cupón siga sin usar'}.
            </p>

            {mensaje && (
              <p
                role={fase === 'error' || fase === 'incierto' ? 'alert' : 'status'}
                className={`border px-3 py-2 text-[13px] leading-relaxed ${
                  fase === 'error' ? 'border-red/60 text-red' : 'border-white/20 text-white/80'
                }`}
              >
                {mensaje}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onCerrar(false)}
                disabled={fase === 'enviando'}
                className="min-h-11 flex-1 rounded-full border border-[#3a3a3f] px-5 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={fase === 'enviando' || fase === 'error'}
                className="min-h-11 flex-1 rounded-full bg-[#3ECF6A] px-5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {fase === 'enviando' ? 'Confirmando…' : fase === 'incierto' ? 'Reintentar canje' : 'Confirmar canje'}
                <ArrowUpRight className="lw-flecha-claro ml-2 h-4 w-4 align-[-3px]" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  // Va dentro de .landing-web: ahí viven las variables --lw-* y el <main> del portal
  // recorta los fixed (CLAUDE.md).
  const objetivo = document.querySelector('.landing-web')
  return objetivo ? createPortal(contenido, objetivo) : contenido
}
