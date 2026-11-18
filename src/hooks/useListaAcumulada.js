import { useCallback, useEffect, useRef, useState } from 'react'

// Lista que se carga al montarse y SUMA filas con «Ver más» (a diferencia de useListaPaginada, que cambia de página con
// conteo exacto). La usan las secciones del perfil de clienta (src/components/clientes/), que se montan recién cuando se
// abren por primera vez: historiales largos donde lo que importa es lo más reciente.
//
// `cargar(desde, cantidad)` → Promise<{ data, error }> (una consulta con .range() o un rpc paginado).
// `clave` vuelve a cargar desde cero cuando cambia (por ejemplo, otra clienta o tras editar).
// Una respuesta que llega tarde (de otra clave) se descarta.
export function useListaAcumulada({ cargar, tam, clave = '' }) {
  const [estado, setEstado] = useState({ filas: [], cargando: true, cargandoMas: false, error: false, hayMas: false })
  const generacion = useRef(0)
  const cargarRef = useRef(cargar)
  cargarRef.current = cargar

  useEffect(() => {
    const gen = (generacion.current += 1)
    setEstado({ filas: [], cargando: true, cargandoMas: false, error: false, hayMas: false })
    Promise.resolve(cargarRef.current(0, tam))
      .catch((error) => ({ error }))
      .then(({ data, error }) => {
        if (gen !== generacion.current) return
        setEstado({
          filas: error ? [] : (data ?? []),
          cargando: false,
          cargandoMas: false,
          error: Boolean(error),
          hayMas: !error && (data ?? []).length === tam,
        })
      })
    return () => {
      generacion.current += 1
    }
  }, [clave, tam])

  const cargarMas = useCallback(async () => {
    if (estado.cargandoMas || !estado.hayMas) return
    const gen = generacion.current
    setEstado((a) => ({ ...a, cargandoMas: true }))
    let r
    try {
      r = await cargarRef.current(estado.filas.length, tam)
    } catch (error) {
      r = { error }
    }
    if (gen !== generacion.current) return
    if (r.error) {
      setEstado((a) => ({ ...a, cargandoMas: false, error: true }))
      return
    }
    setEstado((a) => ({
      ...a,
      filas: [...a.filas, ...(r.data ?? [])],
      cargandoMas: false,
      error: false,
      hayMas: (r.data ?? []).length === tam,
    }))
  }, [estado.cargandoMas, estado.hayMas, estado.filas.length, tam])

  return { ...estado, cargarMas }
}
