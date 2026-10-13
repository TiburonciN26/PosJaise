import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { leerPorIds } from '../lib/catalogoPublico.js'

// Precios de una SELECCIÓN (carrito de productos / cita de servicios) para las barras flotantes — Fase 4.
//
// Las páginas de catálogo ya no tienen todo el catálogo en memoria, así que el precio de un elemento seleccionado puede no estar en
// la página que se está viendo. Contrato:
//   · Cada dato tiene PROCEDENCIA: la hora en que se LEYÓ (una fila de la página conserva la hora en que se vio por primera vez; una
//     lectura por id, la de su respuesta). Gana el dato más reciente, nunca el que se copió o repintó más tarde: una fila antigua de
//     la vitrina que vuelve a mostrarse no pisa una lectura posterior.
//   · Una fila de la página no caduca mientras se muestra. Un dato de la CACHÉ sí: pasada VIGENCIA_PRECIO_MS es «desconocido», se
//     vuelve a pedir y, mientras no se renueve, el total no se presenta como completo.
//   · Lo que se muestra se copia a la caché con su hora de lectura, para que al salir de esa página el total no vuelva a un precio anterior.
//   · La caché es POR SESIÓN: otra cuenta nunca ve precios de la anterior, y una respuesta que llega tarde se descarta.
//   · Una lectura que FALLA no se confunde con «sin precio»: `precioDe(id)` devuelve `undefined` (desconocido: cargando, vencido o con
//     error) y el estado queda en 'error' hasta que una lectura funcione; `reintentar()` o cualquier cambio en la selección
//     (`refrescarCon`) vuelven a pedirlo. `null` significa «la lectura funcionó y ese elemento ya no está disponible».
export const VIGENCIA_PRECIO_MS = 60_000

export function usePreciosSeleccion({ tabla, ids, conocidos, refrescarCon = '' }) {
  const { usuario } = useAuth()
  const sesion = usuario?.id ?? 'anon'
  const almacen = useMemo(() => ({ sesion, mapa: new Map() }), [sesion])
  const cache = almacen.mapa
  const [, setVersion] = useState(0)
  const [estado, setEstado] = useState('ok') // 'ok' | 'cargando' | 'error'
  const [intento, setIntento] = useState(0)

  // Procedencia: cada fila que la página entrega es un «snapshot» (el objeto) con la hora en que se vio por primera vez. Una fila
  // vieja que vuelve a mostrarse (p. ej. la vitrina al limpiar la búsqueda) conserva SU hora y no pasa por más reciente que una
  // lectura posterior. Nunca se usa la hora de render o de copia como hora del dato.
  const vistas = useRef(new WeakMap())
  const porId = useMemo(() => {
    const mapa = new Map()
    for (const fila of conocidos) {
      let t = vistas.current.get(fila)
      if (t === undefined) {
        t = Date.now()
        vistas.current.set(fila, t)
      }
      const previa = mapa.get(fila.id)
      if (!previa || t >= previa.t) mapa.set(fila.id, { precio: Number(fila.precio), t })
    }
    return mapa
  }, [conocidos])
  const claveIds = ids.join(',')

  // Lo más reciente entre lo que la página tiene y la caché. Una fila de la página no caduca mientras se muestra; un dato de la
  // caché sí (pasada la vigencia es «desconocido» hasta renovarlo). Devuelve null si no hay dato utilizable.
  const resolver = (id, ahora) => {
    const fila = porId.get(id)
    const guardado = cache.get(id)
    if (guardado && (!fila || guardado.t > fila.t)) return ahora - guardado.t < VIGENCIA_PRECIO_MS ? guardado : null
    return fila ?? null
  }

  // 1. Lo que la página muestra se copia a la caché CON su hora de lectura, sin pisar una lectura más reciente.
  useEffect(() => {
    if (!claveIds) return
    for (const id of claveIds.split(',')) {
      const fila = porId.get(id)
      const guardado = cache.get(id)
      if (fila && (!guardado || fila.t > guardado.t)) cache.set(id, { precio: fila.precio, t: fila.t })
    }
  }, [porId, claveIds, cache])

  // 2. Lo que no se puede resolver (ni en la página ni en la caché vigente) se pide por id.
  useEffect(() => {
    const lista = claveIds ? claveIds.split(',') : []
    const ahora = Date.now()
    const faltan = lista.filter((id) => !resolver(id, ahora))
    if (!faltan.length) {
      setEstado('ok')
      return undefined
    }
    let vigente = true
    const control = new AbortController()
    setEstado('cargando')
    leerPorIds(supabase, tabla, 'id, precio', faltan, { signal: control.signal }).then(
      (filas) => {
        if (!vigente) return
        const t = Date.now()
        const halladas = new Set()
        for (const fila of filas) {
          cache.set(fila.id, { precio: Number(fila.precio), t })
          halladas.add(fila.id)
        }
        // La lectura funcionó y estos ids no volvieron: ya no están disponibles (desactivados o borrados).
        for (const id of faltan) if (!halladas.has(id)) cache.set(id, { precio: null, t })
        setEstado('ok')
        setVersion((v) => v + 1)
      },
      () => {
        if (vigente) setEstado('error')
      },
    )
    return () => {
      vigente = false
      control.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `resolver` depende solo de porId y cache, ya listados
  }, [claveIds, porId, cache, tabla, refrescarCon, intento])

  // number = precio; null = la lectura funcionó y ya no está disponible; undefined = desconocido (cargando, vencido o con error).
  const precioDe = (id) => {
    const dato = resolver(id, Date.now())
    return dato ? dato.precio : undefined
  }

  return { precioDe, estado, reintentar: () => setIntento((n) => n + 1) }
}
