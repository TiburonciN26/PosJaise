import { useCallback, useEffect, useReducer, useRef } from 'react'

// Revela cada "fila" (cualquier bloque repetido: una fila de categoría
// en Servicios, más adelante quizás una sección del Carrito, etc.) UNA
// sola vez por instancia del componente que use este hook — patrón
// estándar de animación de entrada de la Web de clientes, nacido en
// ServiciosCliente.jsx (docs/diseno-servicios/README.md, "Animación de
// entrada"; ver también docs/patrones/animacion-entrada.md).
//
// Comportamiento:
// - Mientras `activo` es false (ej. la vista agrupada no está montada),
//   no hace nada.
// - Al activarse, cada `clave` sin decisión previa se clasifica UNA vez:
//   si su nodo ya está dentro de lo visible del `contenedorRef` en ese
//   instante → modo 'carga' (para los retrasos "de página"); si no →
//   se observa con IntersectionObserver y se clasifica 'entrada' recién
//   cuando entra en pantalla (retrasos "contados desde que aparece").
// - Una vez clasificada, la clave queda "agotada" a los `agotarEnMs`
//   (tiempo de sobra tras jugarse la animación): un remontaje posterior
//   de la misma fila (ej. el usuario cambia de categoría y vuelve) la
//   encuentra agotada y el componente debe renderizarla SIN clases de
//   animación — repetir la clase en un nodo del DOM nuevo la haría
//   jugarse de cero, que es justo lo que este hook evita.
//
// Uso tipico:
//   const { contenedorRef, refFila, estadoFila } = useRevelarEnPantalla({ activo, claves, agotarEnMs: 3000 })
//   <div ref={contenedorRef} className="overflow-y-auto">
//     {items.map((item) => {
//       const decision = estadoFila(item.clave) // null | { modo: 'carga'|'entrada', agotada }
//       ...
//       <section ref={refFila(item.clave)} style={!decision && !reducido ? { opacity: 0 } : undefined}>
//     })}
//   </div>
export function useRevelarEnPantalla({ activo, claves, agotarEnMs }) {
  const contenedorRef = useRef(null)
  const nodosRef = useRef(new Map()) // clave -> nodo del DOM
  const historialRef = useRef(new Map()) // clave -> { modo: 'carga' | 'entrada', agotada }
  const [, marcarCambio] = useReducer((x) => x + 1, 0)

  // Ref callback estable por clave (memoizado en un Map, no recreado en
  // cada render) — así <section ref={refFila(clave)}> no fuerza un
  // ciclo de detach/attach en cada render del padre.
  const callbacksRef = useRef(new Map())
  const refFila = useCallback((clave) => {
    if (!callbacksRef.current.has(clave)) {
      callbacksRef.current.set(clave, (nodo) => {
        if (nodo) nodosRef.current.set(clave, nodo)
        else nodosRef.current.delete(clave)
      })
    }
    return callbacksRef.current.get(clave)
  }, [])

  useEffect(() => {
    if (!activo || claves.length === 0) return undefined
    const contenedor = contenedorRef.current
    if (!contenedor) return undefined

    const pendientes = claves.filter((clave) => !historialRef.current.has(clave) && nodosRef.current.has(clave))
    if (pendientes.length === 0) return undefined

    const rectContenedor = contenedor.getBoundingClientRect()

    function agotarLuego(clave) {
      setTimeout(() => {
        const entrada = historialRef.current.get(clave)
        if (entrada) entrada.agotada = true
      }, agotarEnMs)
    }

    const observer = new IntersectionObserver(
      (entradasObservadas) => {
        let hayNuevas = false
        entradasObservadas.forEach((entradaObs) => {
          const clave = entradaObs.target.dataset.revelarClave
          if (!entradaObs.isIntersecting || historialRef.current.has(clave)) return
          historialRef.current.set(clave, { modo: 'entrada', agotada: false })
          agotarLuego(clave)
          observer.unobserve(entradaObs.target)
          hayNuevas = true
        })
        if (hayNuevas) marcarCambio()
      },
      { root: contenedor, threshold: 0 },
    )

    let hayInicial = false
    pendientes.forEach((clave) => {
      const nodo = nodosRef.current.get(clave)
      const rect = nodo.getBoundingClientRect()
      const visible = rect.top < rectContenedor.bottom && rect.bottom > rectContenedor.top
      if (visible) {
        historialRef.current.set(clave, { modo: 'carga', agotada: false })
        agotarLuego(clave)
        hayInicial = true
      } else {
        nodo.dataset.revelarClave = clave
        observer.observe(nodo)
      }
    })
    if (hayInicial) marcarCambio()

    return () => observer.disconnect()
  }, [activo, claves, agotarEnMs])

  const estadoFila = useCallback((clave) => historialRef.current.get(clave) ?? null, [])

  return { contenedorRef, refFila, estadoFila }
}
