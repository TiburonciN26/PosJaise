import { useEffect, useState } from 'react'

const DURACION_MS = 300

// `margen` es para Ventas: además de expandir, anima un margin-top (mt-3/mt-0)
// que las demás pantallas no necesitan. Se separan los dos className completos
// (en vez de armar el string con un ternario) para que Tailwind los detecte
// como clases literales al escanear el código.
//
// `diferido` (Fase 5): el contenido solo existe en el DOM mientras el campo está abierto (más lo que dura la animación de
// cierre). Sin él, cada fila de una lista montaba su detalle aunque nadie lo abriera: con cientos de filas eran miles de nodos.
// Es opt-in porque Ventas y otras pantallas conservan dentro de campos cerrados borradores que NO deben perderse; quien lo
// active debe guardar sus borradores fuera del árbol (en el padre) o no tener ninguno.
export default function CampoColapsable({ abierto, children, margen = false, diferido = false }) {
  const montado = useMontado(abierto, diferido)

  if (margen) {
    return (
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-300 ease-in-out ${
          abierto ? 'mt-2 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">{montado ? children : null}</div>
      </div>
    )
  }

  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
        abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">{montado ? children : null}</div>
    </div>
  )
}

// Sin `diferido` siempre está montado. Con él: se monta en el mismo render en que se abre y se desmonta cuando termina la
// animación de cierre (para que el contenido no desaparezca de golpe mientras se pliega).
function useMontado(abierto, diferido) {
  const [conservar, setConservar] = useState(false)

  useEffect(() => {
    if (!diferido) return undefined
    if (abierto) {
      setConservar(true)
      return undefined
    }
    const temporizador = setTimeout(() => setConservar(false), DURACION_MS + 40)
    return () => clearTimeout(temporizador)
  }, [abierto, diferido])

  return !diferido || abierto || conservar
}
