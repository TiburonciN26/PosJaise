import { useEffect, useRef, useState } from 'react'

// Una lectura INDEPENDIENTE (Fase 5): cada sección secundaria de una pantalla pide lo suyo y se pinta cuando llega, sin esperar a
// las demás ni bloquear lo principal (en Inicio, el hero ya no depende de once consultas en un único Promise.all).
//   leer()  → Promise<datos>   Un rechazo deja el recurso en 'error' (la pantalla decide si oculta la sección o avisa).
//   dueno   → identidad de la que depende el dato (id de la cuenta; null = dato público). Los datos quedan ATADOS a su dueño: si
//             `dueno` cambia, lo anterior deja de verse en ese mismo render (nunca se muestran datos de la cuenta previa) y una
//             respuesta tardía de la cuenta anterior se descarta.
// Devuelve { estado: 'cargando' | 'ok' | 'error', datos }.
export function useLectura(leer, dueno = null) {
  const [almacen, setAlmacen] = useState({ dueno, estado: 'cargando', datos: null })
  const leerRef = useRef(leer)
  leerRef.current = leer

  useEffect(() => {
    let vigente = true
    Promise.resolve()
      .then(() => leerRef.current())
      .then(
        (datos) => vigente && setAlmacen({ dueno, estado: 'ok', datos }),
        () => vigente && setAlmacen({ dueno, estado: 'error', datos: null }),
      )
    return () => {
      vigente = false
    }
  }, [dueno])

  return almacen.dueno === dueno ? almacen : { dueno, estado: 'cargando', datos: null }
}
