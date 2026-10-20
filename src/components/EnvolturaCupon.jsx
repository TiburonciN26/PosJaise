import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import './CuponPromocionInicio.css'
import StarBorder from './StarBorder.jsx'

// Presentación compartida; cada pantalla conserva sus permisos, datos y acciones.
export default function EnvolturaCupon({
  nivel, valor, titulo, subtitulo, estado, confirmado = false, reclamado = false,
  etiquetaBeneficio = 'Descuento', apagada = false, esNuevo = false,
  abierto: abiertoControlado, onToggle, pie, children, estrella = false,
}) {
  const [abiertoLocal, setAbiertoLocal] = useState(false)
  const abierto = abiertoControlado ?? abiertoLocal
  const id = useId()
  const envolturaRef = useRef(null)
  const talonRef = useRef(null)
  const tienePie = Boolean(pie)

  useEffect(() => {
    const talon = talonRef.current
    if (!talon) return undefined
    const medir = () => envolturaRef.current?.style.setProperty('--cpi-corte', `${talon.offsetHeight + .5}px`)
    medir()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observador = new ResizeObserver(medir)
    observador.observe(talon)
    return () => observador.disconnect()
  }, [tienePie])

  const cupon = (
    <div ref={envolturaRef} className="cpi-envoltura">
      <article className="cpi" data-nivel={nivel?.nombre ?? 'Oferta'} data-categoria={nivel?.categoria ?? 'oferta'} data-abierto={abierto}
        data-reclamado={reclamado && Boolean(pie)} data-confirmado={confirmado}
        data-apagada={apagada} data-sin-talon={!tienePie} aria-labelledby={`${id}-titulo`}>
        <button type="button" className="cpi-resumen" aria-expanded={abierto}
          aria-controls={`${id}-detalle`} onClick={onToggle ?? (() => setAbiertoLocal(v => !v))}>
          <span className="cpi-beneficio">
            {valor}
            <span className="cpi-etiqueta">{etiquetaBeneficio}</span>
          </span>
          <span className="cpi-textos">
            <span className="cpi-encabezado">
              <span className="cpi-categoria">Cupón {nivel?.nombre ?? 'oferta'}</span>
              {estado && <span className="cpi-sello" role="status">{confirmado && <Check aria-hidden="true" />}{estado}</span>}
              {esNuevo && <span className="cpi-sello cpi-nuevo">Nuevo</span>}
            </span>
            <span id={`${id}-titulo`} className="cpi-titulo">{titulo}</span>
            {subtitulo && <span className="cpi-fecha-resumen">{subtitulo}</span>}
          </span>
          <span className="cpi-accion" aria-hidden="true"><ChevronDown strokeWidth={2.6} /><span>{abierto ? 'Cerrar' : 'Ver'}</span></span>
        </button>
        <div id={`${id}-detalle`} className="cpi-desplegable" role="region" aria-labelledby={`${id}-titulo`} aria-hidden={!abierto} inert={!abierto}>
          <div className="cpi-recorte">
            <div className="cpi-cuerpo">{children}</div>
            {pie && <footer ref={talonRef} className="cpi-talon">{pie}</footer>}
          </div>
        </div>
      </article>
    </div>
  )

  // Star Border (reactbits.dev/animations/star-border): la estrella recorre el borde del cupón.
  // theme="light" siempre: es el modo que conserva el rojo puro (el "dark" mezcla la luz con blanco y se veía blanca).
  // Solo se activa con la prop `estrella` (cupón de promoción de Inicio); los demás cupones no cambian.
  if (!estrella) return cupon
  return (
    <StarBorder as="div" className="cpi-estrella" theme="light" radius={0} thickness={2} duration={5}
      trailLength={0.35} glow={0.8} sparkle color="#ff2d3f" trailColor="#ff7a86"
      backgroundColor="transparent" borderColor="transparent" hover="lap" clickPulse>
      {cupon}
    </StarBorder>
  )
}
