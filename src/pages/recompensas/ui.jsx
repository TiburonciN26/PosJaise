import Etiqueta from '../../components/Etiqueta.jsx'

// Piezas pequeñas compartidas por la administración de Recompensas (pestaña Web). Estaban dentro de RecompensasWeb.jsx; se sacaron
// aquí para que los editores de costeo y el reporte de rentabilidad (archivos propios) las usen sin importarse en círculo.
// Las constantes y el formato (CLASE_INPUT, soles) están en formato.js.

export function Campo({ id, etiqueta, obligatorio, ayuda, children }) {
  return (
    <div>
      <Etiqueta htmlFor={id} obligatorio={obligatorio}>
        {etiqueta}
      </Etiqueta>
      {children}
      {ayuda && <p className="mt-1 text-xs text-ink/50">{ayuda}</p>}
    </div>
  )
}

export function AvisoError({ mensaje, onReintentar }) {
  return (
    <div role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
      {mensaje}{' '}
      {onReintentar && (
        <button type="button" onClick={onReintentar} className="underline">
          Reintentar
        </button>
      )}
    </div>
  )
}
