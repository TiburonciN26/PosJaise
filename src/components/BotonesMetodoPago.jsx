import { METODOS_PAGO } from '../lib/metodosPago.js'

// Los 4 botones de método de pago (Efectivo, Tarjeta, Transferencia, Yape) con el mismo aspecto que en Ventas. `valor` es el nombre
// elegido ('' si ninguno); volver a pulsar el elegido lo quita (en Citas es solo informativo y opcional). `onElegir(nombre | '')`.
export default function BotonesMetodoPago({ valor, onElegir, deshabilitado = false, etiquetaGrupo = 'Método de pago' }) {
  return (
    <div role="group" aria-label={etiquetaGrupo} className="grid grid-cols-4 gap-1.5">
      {METODOS_PAGO.map((metodo) => {
        const elegido = valor === metodo.nombre
        return (
          <button
            key={metodo.nombre}
            type="button"
            disabled={deshabilitado}
            aria-pressed={elegido}
            onClick={() => onElegir(elegido ? '' : metodo.nombre)}
            className={`rounded-lg border px-1 py-2 text-[11px] transition-colors disabled:opacity-40 ${
              elegido ? metodo.clasesActivo : `border-border bg-bg text-ink ${metodo.clasesHover}`
            }`}
          >
            <span className="flex items-center justify-center gap-1">
              {metodo.nombre === 'Tarjeta' ? (
                <span className="shrink-0 text-sm leading-none">💳</span>
              ) : (
                // Transferencia: su SVG es negro; .icono-transferencia lo pinta claro en oscuro y oscuro en claro.
                <img
                  src={metodo.icono}
                  alt=""
                  className={`h-4 w-4 shrink-0 ${metodo.nombre === 'Transferencia' ? 'icono-transferencia' : ''}`}
                />
              )}
              <span>{metodo.nombreCorto}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
