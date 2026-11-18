import { useEffect, useRef, useState } from 'react'
import { guardarCopia, leerCopia, mismaCopia } from '../lib/copiasEnMemoria.js'

// Una lectura INDEPENDIENTE (Fase 5): cada sección secundaria de una pantalla pide lo suyo y se pinta cuando llega, sin esperar a
// las demás ni bloquear lo principal (en Inicio, el hero ya no depende de once consultas en un único Promise.all).
//   leer()  → Promise<datos>   Un rechazo deja el recurso en 'error' (la pantalla decide si oculta la sección o avisa).
//   dueno   → identidad de la que depende el dato (id de la cuenta; null = dato público). Los datos quedan ATADOS a su dueño: si
//             `dueno` cambia, lo anterior deja de verse en ese mismo render (nunca se muestran datos de la cuenta previa) y una
//             respuesta tardía de la cuenta anterior se descarta.
//   copia   → (opcional) clave de la copia en memoria (lib/copiasEnMemoria.js). Las rutas del portal se desmontan al navegar: con
//             copia, al volver a la pantalla la sección se pinta al instante con lo último leído (estado 'ok' desde el primer
//             render) y la lectura se repite en segundo plano. SOLO para datos PÚBLICOS: la clave no lleva la cuenta, así que un
//             dato personal (cupones, mis reseñas…) no debe usarla. Si la lectura en segundo plano falla, se conserva lo mostrado.
// Devuelve { estado: 'cargando' | 'ok' | 'error', datos }.
export function useLectura(leer, dueno = null, { copia = null } = {}) {
  const [almacen, setAlmacen] = useState(() => {
    const guardada = leerCopia(copia)
    return guardada != null ? { dueno, estado: 'ok', datos: guardada } : { dueno, estado: 'cargando', datos: null }
  })
  const leerRef = useRef(leer)
  leerRef.current = leer

  useEffect(() => {
    let vigente = true
    Promise.resolve()
      .then(() => leerRef.current())
      .then(
        (datos) => {
          guardarCopia(copia, datos)
          if (!vigente) return
          // Con copia: si lo recién leído es idéntico a lo que ya se ve, se conserva el mismo objeto (ni un render de más).
          setAlmacen((previo) =>
            copia && previo.dueno === dueno && previo.estado === 'ok' && mismaCopia(previo.datos, datos) ? previo : { dueno, estado: 'ok', datos },
          )
        },
        () => {
          if (!vigente) return
          setAlmacen((previo) => (copia && previo.dueno === dueno && previo.estado === 'ok' ? previo : { dueno, estado: 'error', datos: null }))
        },
      )
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `copia` es una constante de quien llama
  }, [dueno])

  return almacen.dueno === dueno ? almacen : { dueno, estado: 'cargando', datos: null }
}
