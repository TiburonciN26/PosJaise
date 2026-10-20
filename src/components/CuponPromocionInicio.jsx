import { Check, Ticket } from 'lucide-react'
import { formatearSoles } from '../lib/moneda.js'
import { formatearFechaCupon, nivelDeCupon } from '../lib/cupones.js'
import EnvolturaCupon from './EnvolturaCupon.jsx'

// Solo presentación. Inicio conserva las lecturas, la sesión y la RPC de reclamación.
export default function CuponPromocionInicio({ promocion, reclamado, reclamando, onReclamar }) {
  const esPorcentaje = promocion.tipo_descuento === 'PORCENTAJE'
  // promociones.vigente_hasta es DATE; no desplazar su día al convertirlo a Lima.
  const fechaOriginal = promocion.vigente_hasta
  const fecha = fechaOriginal
    ? formatearFechaCupon(/^\d{4}-\d{2}-\d{2}$/.test(fechaOriginal) ? `${fechaOriginal}T12:00:00-05:00` : fechaOriginal)
    : null
  return (
    <EnvolturaCupon estrella nivel={nivelDeCupon({ origen: 'PROMOCION' })} titulo={promocion.titulo}
      subtitulo={fecha ? `Hasta el ${fecha}` : null} reclamado={reclamado} confirmado={reclamado}
      estado={reclamado ? 'Reclamado' : reclamando ? 'Reclamando…' : 'Reclamar'}
      valor={<span className={`cpi-valor${esPorcentaje ? '' : ' cpi-valor-monto'}`}>{esPorcentaje ? <>{promocion.valor}<span className="cpi-unidad">%</span></> : formatearSoles(promocion.valor)}</span>}
      pie={<>
        <button type="button" className="cpi-reclamar" disabled={reclamado || reclamando} onClick={onReclamar} aria-busy={reclamando}>
          {reclamado ? <Check aria-hidden="true" /> : <Ticket aria-hidden="true" />}
          {reclamado ? 'Guardado en Mis cupones' : reclamando ? 'Reclamando…' : 'Reclamar cupón'}
        </button>
        <p className="cpi-ayuda">{reclamado ? 'Tu cupón ya está listo para tu próxima visita' : 'Se guarda en Mis cupones'}</p>
      </>}>
      <p className="cpi-estado">{reclamado ? 'Cupón reclamado' : 'Promoción activa'}</p>
      {promocion.descripcion && <>
        <div className="cpi-tabla-cabecera" aria-hidden="true"><span>Descripción</span><span>Beneficio especial</span></div>
        <p className="cpi-descripcion">{promocion.descripcion}</p>
      </>}
      {fecha && <dl className="cpi-vigencia"><dt>Disponible hasta</dt><dd>{fecha}</dd></dl>}
    </EnvolturaCupon>
  )
}
