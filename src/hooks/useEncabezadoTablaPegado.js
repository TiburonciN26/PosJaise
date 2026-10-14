import { useEffect, useRef, useState } from 'react'

const TOP_POR_DEFECTO = 58

// Encabezado de tabla que se queda pegado bajo la barra sticky de búsqueda
// (la que ya es `sticky top-0` en cada pestaña). Mide esa barra para saber
// a qué altura pegarse y detecta cuándo ya está pegado, para mostrar el
// degradado que difumina las filas que pasan por debajo.
//
// Uso: `ref={barraRef}` en la barra sticky, `ref={encabezadoRef}` en el
// <thead>, y en cada <th>: style={estiloTh} className={`${claseTh} ...`}.
// El contenedor de la tabla NO puede tener overflow-x-auto/hidden (rompe el
// sticky): usar overflow-x-clip.
export function useEncabezadoTablaPegado(dependencias = []) {
  const barraRef = useRef(null)
  const encabezadoRef = useRef(null)
  const [top, setTop] = useState(TOP_POR_DEFECTO)
  const [pegado, setPegado] = useState(false)

  useEffect(() => {
    function revisar() {
      const altoBarra = barraRef.current?.getBoundingClientRect().height || TOP_POR_DEFECTO
      setTop(altoBarra)
      const encabezado = encabezadoRef.current
      setPegado(Boolean(encabezado) && encabezado.getBoundingClientRect().top <= altoBarra + 0.5)
    }
    revisar()
    window.addEventListener('scroll', revisar, { capture: true, passive: true })
    window.addEventListener('resize', revisar)
    return () => {
      window.removeEventListener('scroll', revisar, { capture: true })
      window.removeEventListener('resize', revisar)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias)

  const claseTh = `sticky z-[5] bg-tabla shadow-[inset_0_-1px_0_var(--color-border)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-tabla after:to-transparent after:transition-opacity after:duration-200 after:content-[''] ${
    pegado ? 'after:opacity-100' : 'after:opacity-0'
  }`

  return { barraRef, encabezadoRef, claseTh, estiloTh: { top } }
}
