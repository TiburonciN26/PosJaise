import { useCallback, useEffect, useRef, useState } from 'react'

// Fase 5: lista administrativa paginada EN EL SERVIDOR. Hasta TAM_PAGINA_ADMIN filas por página, con el conteo exacto del servidor
// para el filtro vigente (así un contador nunca es «lo que cabe en la página»). Sirve a Pedidos Web, Promociones, Reseñas,
// Referidos, Fidelización y las listas de Recompensas.
//
//   leer({ desde, hasta }) → Promise<{ data, count, error }>   (una consulta de Supabase con `.range(desde, hasta)` y
//                                                              `{ count: 'exact' }`; el orden debe ser determinista: columna + id)
//   clave                  → cadena que identifica los filtros vigentes (búsqueda, estado…). Si cambia, vuelve a la página 1.
//   activo                 → la pestaña está visible (PestanasCacheadas): al volver a mostrarse se refresca EN SILENCIO.
//
// Garantías:
//  · una respuesta que llega tarde (otra página, otro filtro, otra cuenta) se descarta: solo vale la última petición;
//  · si falta el conteo exacto o el servidor devuelve un error, la lectura FALLA y se avisa (`fallo`, con Reintentar): nunca se
//    muestra una página como si fuera la lista completa ni un total inventado a partir de lo recibido;
//  · las filas siempre están rotuladas con la página / filtro a los que PERTENECEN: se recuerda cuál fue la última lectura
//    confirmada (`de`). Si falla la página 2 se sigue viendo la página 1 con «Página 1» y el aviso; si falla una búsqueda NUEVA
//    no se muestran los resultados del filtro anterior (la lista queda vacía con el error);
//  · borrar la última fila de la última página (o filtrar) no deja una página vacía fuera de rango: se retrocede a la última real;
//  · mientras llega otra página se conservan las filas anteriores (atenuadas por quien pinta) en vez de vaciar la lista.
//
//   error → no hay NINGUNA fila confirmada para el filtro vigente (primera carga o búsqueda nueva fallida): la pantalla no pinta lista.
//   fallo → la última lectura pedida falló (haya o no filas anteriores): la pantalla muestra el aviso con Reintentar.
export const TAM_PAGINA_ADMIN = 40

export function useListaPaginada({ activo = true, tam = TAM_PAGINA_ADMIN, clave = '', leer }) {
  const [estado, setEstado] = useState({ filas: [], total: 0, cargando: true, ocupado: true, fallo: false, de: null })
  const [posicion, setPosicion] = useState({ clave, pagina: 1 })
  const pagina = posicion.clave === clave ? posicion.pagina : 1
  const generacion = useRef(0)
  const leerRef = useRef(leer)
  leerRef.current = leer

  const cargar = useCallback(
    async (numero) => {
      const gen = (generacion.current += 1)
      setEstado((a) => ({ ...a, ocupado: true }))
      let r
      try {
        r = await leerRef.current({ desde: (numero - 1) * tam, hasta: numero * tam - 1 })
      } catch (error) {
        r = { error }
      }
      if (gen !== generacion.current) return
      if (r.error || !Number.isSafeInteger(r.count) || r.count < 0) {
        setEstado((a) => ({ ...a, cargando: false, ocupado: false, fallo: true }))
        return
      }
      const paginas = Math.max(1, Math.ceil(r.count / tam))
      if (numero > paginas) {
        setPosicion({ clave, pagina: paginas })
        return
      }
      setEstado({ filas: r.data ?? [], total: r.count, cargando: false, ocupado: false, fallo: false, de: { clave, pagina: numero } })
    },
    [tam, clave],
  )

  useEffect(() => {
    if (!activo) return undefined
    cargar(pagina)
    return () => {
      generacion.current += 1
    }
  // `posicion` (objeto nuevo en cada irA) también reinicia la lectura: tras un fallo, volver a pedir la MISMA página funciona.
  }, [activo, pagina, clave, cargar, posicion])

  const irA = useCallback((numero) => setPosicion({ clave, pagina: Math.max(1, numero) }), [clave])
  // Vuelve a leer la página pedida sin vaciar la lista (después de guardar, borrar, cambiar un estado o tras un fallo).
  const recargar = useCallback(() => cargar(pagina), [cargar, pagina])

  const delFiltroVigente = estado.de !== null && estado.de.clave === clave
  // Mientras llega una búsqueda nueva se conservan (atenuadas) las filas anteriores; si esa lectura FALLA, las del filtro anterior
  // dejan de mostrarse: no se presentan como resultados del filtro que se pidió.
  const mostrar = estado.de !== null && (delFiltroVigente || !estado.fallo)
  const filas = mostrar ? estado.filas : []
  // Con un fallo se sigue rotulando la página que SÍ se ve (la última confirmada), no la que se pidió.
  const paginaMostrada = estado.fallo && delFiltroVigente ? estado.de.pagina : pagina
  const total = mostrar ? estado.total : 0

  return {
    filas,
    total,
    pagina: paginaMostrada,
    totalPaginas: Math.max(1, Math.ceil(total / tam)),
    tam,
    cargando: estado.cargando,
    ocupado: estado.ocupado,
    error: !estado.cargando && estado.fallo && !mostrar,
    fallo: estado.fallo,
    irA,
    recargar,
  }
}
