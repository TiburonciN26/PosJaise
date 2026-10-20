import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ticket, X } from 'lucide-react'
import { formatearSoles } from '../lib/moneda.js'
import CuponPromocionInicio from './CuponPromocionInicio.jsx'

// Cupón de promoción de Inicio, flotante bajo el header (portal dentro de .landing-web: <main> tiene overflow-hidden y
// recortaría un fixed). Ciclo: aparece tras una breve espera "cayendo" desde el header -> se minimiza solo a una pastilla
// si no se toca (o con la X, y entonces se recuerda) -> la pastilla lo vuelve a abrir -> al reclamarlo vuela hacia el ícono
// de la cuenta y desaparece (ya está en Mis cupones). Con "reducir movimiento" no hay caída, vuelo ni pulso.
const ESPERA_MS = 1500
const AUTOMINIMIZAR_MS = 8000
const SALIDA_MS = 260
const VUELO_MS = 750

const leer = (almacen, clave) => {
  try {
    return almacen.getItem(clave)
  } catch {
    return null
  }
}
const guardar = (almacen, clave, valor) => {
  try {
    almacen.setItem(clave, valor)
  } catch {
    // sin storage: el recuerdo vale solo para esta pantalla
  }
}

export default function CuponFlotanteInicio({ promocion, reclamado, reclamando, onReclamar, usuarioId, reducirMovimiento }) {
  const claveCerrado = `jaise-cupon-cerrado:${promocion.id}`
  const claveVisto = `jaise-cupon-visto:${promocion.id}`
  const [destino, setDestino] = useState(null)
  const [fase, setFase] = useState(() => {
    if (reclamado) return 'fin'
    if (leer(localStorage, claveCerrado) || leer(sessionStorage, claveVisto)) return 'pastilla'
    return reducirMovimiento ? 'abierto' : 'espera'
  })
  const interactuo = useRef(false)
  const tarjetaRef = useRef(null)
  const yaReclamado = useRef(reclamado)

  useEffect(() => setDestino(document.querySelector('.landing-web')), [])

  // espera -> abierto
  useEffect(() => {
    if (fase !== 'espera') return undefined
    const t = setTimeout(() => setFase('abierto'), ESPERA_MS)
    return () => clearTimeout(t)
  }, [fase])

  function minimizar(recordar) {
    // «Ya se vio en esta visita» se marca al MINIMIZAR, no al abrir: si la pantalla se vuelve a montar mientras el cupón aún
    // cae (p. ej. al resolverse la sesión y recargarse la promoción), debe seguir cayendo y no saltar directo a la pastilla.
    guardar(sessionStorage, claveVisto, '1')
    if (recordar) guardar(localStorage, claveCerrado, '1')
    if (reducirMovimiento) {
      setFase('pastilla')
      return
    }
    setFase('cerrando')
    setTimeout(() => setFase('pastilla'), SALIDA_MS)
  }

  // abierto: marca la visita y, si no se toca, se minimiza solo
  useEffect(() => {
    if (fase !== 'abierto') return undefined
    const t = setTimeout(() => {
      if (!interactuo.current) minimizar(false)
    }, AUTOMINIMIZAR_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase])

  // Reclamado mientras está en pantalla: vuela al ícono de la cuenta y se retira.
  useEffect(() => {
    if (!reclamado || yaReclamado.current) return
    yaReclamado.current = true
    const tarjeta = tarjetaRef.current
    const meta = [...document.querySelectorAll('[data-cupones-destino]')].find((n) => n.getBoundingClientRect().width > 0)
    if (!tarjeta || reducirMovimiento || typeof tarjeta.animate !== 'function') {
      setFase('fin')
      return
    }
    setFase('volando')
    const o = tarjeta.getBoundingClientRect()
    const m = meta?.getBoundingClientRect()
    const dx = m ? m.left + m.width / 2 - (o.left + o.width / 2) : 0
    const dy = m ? m.top + m.height / 2 - (o.top + o.height / 2) : -40
    const animacion = tarjeta.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
        { transform: 'translate(0,-10px) scale(1.04)', opacity: 1, offset: 0.18 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, opacity: 0.15, offset: 1 },
      ],
      { duration: VUELO_MS, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' },
    )
    // chispas desde el centro de la tarjeta
    const colores = ['#ff2d3f', '#ff7a86', '#ffd1d5', '#ffffff']
    for (let i = 0; i < 14; i += 1) {
      const chispa = document.createElement('span')
      const ang = (Math.PI * 2 * i) / 14 + Math.random() * 0.4
      const dist = 50 + Math.random() * 70
      Object.assign(chispa.style, {
        position: 'fixed',
        left: `${o.left + o.width / 2}px`,
        top: `${o.top + o.height / 2}px`,
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: colores[i % colores.length],
        pointerEvents: 'none',
        zIndex: 60,
      })
      document.body.appendChild(chispa)
      const fin = `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0)`
      chispa
        .animate(
          [
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
            { transform: fin, opacity: 0 },
          ],
          { duration: 600 + Math.random() * 250, easing: 'ease-out', fill: 'forwards' },
        )
        .finished.then(
          () => chispa.remove(),
          () => chispa.remove(),
        )
    }
    animacion.finished.then(
      () => setFase('fin'),
      () => setFase('fin'),
    )
  }, [reclamado, reducirMovimiento])

  if (!destino || fase === 'fin' || fase === 'espera') return null

  const esPorcentaje = promocion.tipo_descuento === 'PORCENTAJE'
  const textoValor = esPorcentaje ? `${promocion.valor}%` : formatearSoles(promocion.valor)
  // Abierto: centrado en móvil y a la derecha en PC. Minimizado: siempre a la derecha (en móvil solo el ícono del cupón).
  const ubicacion = `pointer-events-none fixed inset-x-0 top-[calc(var(--alto-header-cliente)+var(--separador-horizontal))] z-40 flex lw-gutter lw-gutter-sep ${
    fase === 'pastilla' ? 'justify-end' : 'justify-center lg:justify-end'
  }`

  return createPortal(
    <div className={ubicacion}>
      {fase === 'pastilla' ? (
        <button
          type="button"
          onClick={() => {
            interactuo.current = true
            setFase('abierto')
          }}
          className={`cpi-pastilla pointer-events-auto${reducirMovimiento ? '' : ' cpi-pastilla-entra'}`}
          aria-label={`Ver cupón de ${textoValor} de descuento`}
        >
          <Ticket aria-hidden="true" className="h-4 w-4" />
          <span className="max-sm:sr-only">Cupón {textoValor}</span>
        </button>
      ) : (
        <div
          ref={tarjetaRef}
          className={`pointer-events-auto relative w-full max-w-[440px] ${
            fase === 'cerrando' ? 'cpi-flotante-salida' : fase === 'abierto' && !reducirMovimiento ? 'cpi-caida' : ''
          }`}
          onPointerDownCapture={() => {
            interactuo.current = true
          }}
          onFocusCapture={() => {
            interactuo.current = true
          }}
        >
          <CuponPromocionInicio
            key={`${usuarioId ?? 'visitante'}:${promocion.id}`}
            promocion={promocion}
            reclamado={reclamado}
            reclamando={reclamando}
            onReclamar={onReclamar}
          />
          {!reclamado && fase === 'abierto' && (
            <button type="button" className="cpi-minimizar" onClick={() => minimizar(true)} aria-label="Minimizar cupón">
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>,
    destino,
  )
}
