import { ETIQUETAS_ORIGEN_CUPON, formatearFechaCupon, estadoEfectivoCupon, nivelDeCupon } from '../lib/cupones.js'
import { formatearSoles } from '../lib/moneda.js'
import EnvolturaCupon from './EnvolturaCupon.jsx'

// Cupón ya emitido: «Reclamado» no significa «Canjeado» (consumido en una compra).
export default function TarjetaCupon({ cupon, esNuevo = false, onMostrarEnCaja, subtitulo }) {
  const efectivo = estadoEfectivoCupon(cupon)
  const disponible = efectivo.utilizable
  const estado = disponible ? 'Reclamado'
    : { VENCIDO: 'Vencido', ANULADO: 'Anulado', CANJEADO: 'Ya canjeado' }[efectivo.estado] ?? 'No disponible ahora'
  const porcentaje = cupon.tipo_descuento === 'PORCENTAJE'
  const fechaVigencia = cupon.vigente_hasta && Number.isFinite(new Date(cupon.vigente_hasta).getTime())
    ? formatearFechaCupon(cupon.vigente_hasta) : null
  return (
    <EnvolturaCupon nivel={nivelDeCupon(cupon)} apagada={!disponible} esNuevo={esNuevo}
      confirmado={disponible} reclamado={disponible} estado={estado} titulo={cupon.codigo}
      subtitulo={subtitulo ?? ETIQUETAS_ORIGEN_CUPON[cupon.origen] ?? cupon.origen}
      valor={<span className={`cpi-valor${porcentaje ? '' : ' cpi-valor-monto'}`}>{porcentaje ? <>{cupon.valor}<span className="cpi-unidad">%</span></> : formatearSoles(cupon.valor)}</span>}
      pie={disponible && onMostrarEnCaja ? <button type="button" className="cpi-reclamar" onClick={() => onMostrarEnCaja(cupon)}>Mostrar en caja</button> : null}>
      <p className="cpi-estado">{disponible ? 'Muéstralo en caja' : estado}</p>
      <dl className="cpi-datos">
        {cupon.creado_en && <><dt>Creado</dt><dd>{formatearFechaCupon(cupon.creado_en)}</dd></>}
        {cupon.canjeado_en && <><dt>Canjeado</dt><dd>{formatearFechaCupon(cupon.canjeado_en)}</dd></>}
        {fechaVigencia && <><dt>{efectivo.estado === 'VENCIDO' ? 'Venció' : 'Vigencia'}</dt><dd>{fechaVigencia}</dd></>}
        {cupon.vigente_hasta === null && <><dt>Vigencia</dt><dd>Sin vencimiento</dd></>}
      </dl>
    </EnvolturaCupon>
  )
}
