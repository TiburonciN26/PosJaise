import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { GRUPOS_POR_VENTANA, TAMANO_PAGINA_CATALOGO, paginasTotales } from '../lib/catalogoPublico.js'
import { guardarCopia, leerCopia, mismaCopia } from '../lib/copiasEnMemoria.js'

// Estado de un catálogo público del portal (Productos / Servicios) resuelto en el SERVIDOR — Fase 4.
//
//   vitrina  → lo que se ve en «Todos» sin búsqueda: categorías con su total, primeras N de cada una, héroe, cintas.
//   grupos   → «Todos» muestra las filas por categoría de una VENTANA de GRUPOS_POR_VENTANA categorías (la primera viene con la
//              vitrina; las siguientes se piden al paginar los grupos). El nombre y el total de TODAS las categorías son metadatos
//              de la vitrina, independientes de la ventana: todas son alcanzables.
//   listado  → una PÁGINA del listado plano (categoría elegida o búsqueda). Reemplaza a la anterior: nunca se acumulan páginas en el
//              DOM. Cambiar categoría o texto vuelve a la página 1.
//
// Búsqueda: `setBusqueda` se llama ya con pausa (ver BarraCatalogo); el término efectivo es el texto recortado.
// Respuestas obsoletas: cada efecto lleva su AbortController (corta la petición) y una bandera `vigente` (descarta lo que ya llegó
// tarde: escribir deprisa, cambiar de categoría, navegar fuera o cambiar de cuenta). `clave` identifica la cuenta/sesión: si cambia,
// se vuelve a pedir todo y las respuestas de la cuenta anterior no pueden pisar a las nuevas.
//
// Estados diferenciados (la página decide cómo pintarlos): vitrina.estado = cargando | recargando | ok | error;
// listado.estado = inactivo | cargando | ok | error. `listado.clave` dice a qué categoría+texto pertenecen las filas, para no mostrar
// resultados de una búsqueda anterior bajo el encabezado de otra.
//
// `cargarVitrina({ signal })` y `cargarPagina({ categoria, termino, pagina, tam, signal })` pueden cambiar en cada render (se leen por ref).
//
// `catalogo` (opcional: 'servicios' | 'productos') activa la copia en memoria de la vitrina (lib/copiasEnMemoria.js): al volver a la
// página dentro de la misma visita se pinta al instante lo último visto (estado «recargando», sin «Cargando...») y la vitrina se
// vuelve a pedir en segundo plano. La copia es por catálogo Y por `clave` (cuenta): nunca se muestra la de otra cuenta. Sin
// `catalogo` el hook se comporta exactamente como antes.
const SIN_GRUPOS = []
const esAbort = (error) => error?.name === 'AbortError' || /AbortError/.test(String(error?.message ?? ''))

export function useCatalogoPublico({ cargarVitrina, cargarPagina, cargarGrupos, clave = 'anon', catalogo = null, tam = TAMANO_PAGINA_CATALOGO, categoriaInicial = 'todos' }) {
  const idCopia = catalogo ? `vitrina\u0000${catalogo}\u0000${clave}` : null
  const [categoriaActiva, setCategoriaCruda] = useState(categoriaInicial)
  const [busqueda, setBusquedaCruda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [vitrina, setVitrina] = useState(() => {
    const guardada = leerCopia(idCopia)
    return guardada ? { estado: 'recargando', datos: guardada, error: null } : { estado: 'cargando', datos: null, error: null }
  })
  const [listado, setListado] = useState({ estado: 'inactivo', clave: null, filas: [], total: 0, error: null })
  const [paginaGrupos, setPaginaGrupos] = useState(1)
  const [ventana, setVentana] = useState({ estado: 'inactivo', pagina: 1, grupos: [], error: null })
  const [intentoVentana, setIntentoVentana] = useState(0)
  const [intentoVitrina, setIntentoVitrina] = useState(0)
  const [intentoListado, setIntentoListado] = useState(0)

  const cargarVitrinaRef = useRef(cargarVitrina)
  const cargarPaginaRef = useRef(cargarPagina)
  const cargarGruposRef = useRef(cargarGrupos)
  cargarGruposRef.current = cargarGrupos
  cargarVitrinaRef.current = cargarVitrina
  cargarPaginaRef.current = cargarPagina

  const setCategoriaActiva = useCallback((categoria) => {
    setCategoriaCruda(categoria)
    setPagina(1)
  }, [])

  // La caja de búsqueda (BarraCatalogo) ya espera una pausa antes de avisar; aquí solo se recorta el texto y, si el término cambió,
  // se vuelve a la página 1.
  const termino = busqueda.trim()
  const agrupado = categoriaActiva === 'todos' && !termino
  const claveFiltro = `${categoriaActiva}\u0000${termino}`
  const terminoRef = useRef('')
  const setBusqueda = useCallback((texto) => {
    const limpio = texto.trim()
    if (limpio !== terminoRef.current) {
      terminoRef.current = limpio
      setPagina(1)
    }
    setBusquedaCruda(texto)
  }, [])

  useEffect(() => {
    const control = new AbortController()
    let vigente = true
    setVitrina((previa) => {
      // Copia de ESTA cuenta (si la hay y sigue vigente): es lo que se muestra mientras llega la lectura nueva. Si ya es lo que
      // está en pantalla (montaje normal) no se cambia el objeto de datos, así la página no vuelve a renderizar por nada.
      const guardada = leerCopia(idCopia)
      if (guardada) return previa.datos === guardada && previa.estado === 'recargando' ? previa : { estado: 'recargando', datos: guardada, error: null }
      return previa.datos ? { ...previa, estado: 'recargando' } : { estado: 'cargando', datos: null, error: null }
    })
    cargarVitrinaRef.current({ signal: control.signal }).then(
      (datos) => {
        if (!vigente) return
        guardarCopia(idCopia, datos)
        // Si la lectura nueva es idéntica a lo que ya se ve, se conserva el MISMO objeto: las listas memorizadas de la página
        // (grupos, héroe, claves de animación) no cambian y no se vuelve a pintar el catálogo.
        setVitrina((previa) => (previa.datos && mismaCopia(previa.datos, datos) ? { estado: 'ok', datos: previa.datos, error: null } : { estado: 'ok', datos, error: null }))
      },
      (error) => {
        if (!vigente || esAbort(error)) return
        // Falló la lectura en segundo plano pero hay una copia vigente de esta cuenta: se sigue mostrando (tiene como mucho
        // VIDA_MS de antigüedad) en vez de reemplazar un catálogo visible por una pantalla de error.
        const guardada = leerCopia(idCopia)
        setVitrina(guardada ? { estado: 'ok', datos: guardada, error: null } : { estado: 'error', datos: null, error })
      },
    )
    return () => {
      vigente = false
      control.abort()
    }
  }, [clave, intentoVitrina, idCopia])

  // Cuenta distinta: se vuelve a la primera ventana de grupos (viene con la vitrina).
  useEffect(() => {
    setPaginaGrupos(1)
  }, [clave])

  // Ventanas de grupos 2..n (la 1 viene con la vitrina). Mientras llega la nueva se conservan las filas anteriores, atenuadas.
  useEffect(() => {
    if (!agrupado || paginaGrupos <= 1) return undefined
    const control = new AbortController()
    let vigente = true
    setVentana((previa) => ({ ...previa, estado: 'cargando', error: null }))
    cargarGruposRef.current({ pagina: paginaGrupos, signal: control.signal }).then(
      (grupos) => {
        if (!vigente) return
        // Transición: montar hasta 40 tarjetas se hace en rebanadas, sin bloquear el desplazamiento.
        startTransition(() => setVentana({ estado: 'ok', pagina: paginaGrupos, grupos, error: null }))
      },
      (error) => {
        if (vigente && !esAbort(error)) setVentana((previa) => ({ ...previa, estado: 'error', error }))
      },
    )
    return () => {
      vigente = false
      control.abort()
    }
  }, [agrupado, paginaGrupos, clave, intentoVentana])

  useEffect(() => {
    if (agrupado) return undefined
    const control = new AbortController()
    let vigente = true
    setListado((previo) => ({ ...previo, estado: 'cargando', error: null, ...(previo.clave === claveFiltro ? {} : { clave: claveFiltro, filas: [], total: 0 }) }))
    cargarPaginaRef.current({ categoria: categoriaActiva, termino, pagina, tam, signal: control.signal }).then(
      ({ filas, total }) => {
        if (!vigente) return
        const ultima = paginasTotales(total, tam)
        // Los datos cambiaron entre dos páginas y esta ya no existe: se vuelve a la última válida en vez de mostrar «sin resultados».
        if (!filas.length && total > 0 && pagina > ultima) {
          setPagina(ultima)
          return
        }
        // Transición: montar hasta 40 tarjetas se hace en rebanadas, sin bloquear la escritura ni el desplazamiento.
        startTransition(() => setListado({ estado: 'ok', clave: claveFiltro, filas, total, error: null }))
      },
      (error) => {
        if (!vigente || esAbort(error)) return
        if (error?.code === 'PGRST103' && pagina > 1) {
          setPagina(1) // rango fuera de los datos actuales: se reinicia en vez de dejar un error
          return
        }
        setListado((previo) => ({ ...previo, estado: 'error', error }))
      },
    )
    return () => {
      vigente = false
      control.abort()
    }
  }, [agrupado, categoriaActiva, termino, pagina, tam, clave, intentoListado, claveFiltro])

  const categoriasTotales = vitrina.datos?.categorias?.length ?? 0
  const totalPaginasGrupos = paginasTotales(categoriasTotales, GRUPOS_POR_VENTANA)
  // Primera ventana: la de la vitrina. Las demás: la última recibida (la anterior mientras llega la nueva).
  const gruposVitrina = vitrina.datos?.grupos ?? SIN_GRUPOS
  const gruposVisibles = paginaGrupos <= 1 ? gruposVitrina : ventana.grupos.length ? ventana.grupos : gruposVitrina

  return {
    vitrina,
    gruposVisibles,
    paginaGrupos,
    totalPaginasGrupos,
    ventanaOcupada: paginaGrupos > 1 && ventana.estado === 'cargando',
    ventanaConError: paginaGrupos > 1 && ventana.estado === 'error',
    irAPaginaGrupos: (n) => setPaginaGrupos(Math.max(1, Math.min(n, totalPaginasGrupos))),
    reintentarVentana: () => setIntentoVentana((n) => n + 1),
    listado,
    // Las filas del listado solo son «de ahora» si pertenecen a la categoría+texto actuales (cambiar de página conserva las anteriores, atenuadas).
    listadoVigente: listado.clave === claveFiltro,
    categoriaActiva,
    setCategoriaActiva,
    busqueda,
    setBusqueda,
    termino,
    agrupado,
    pagina,
    totalPaginas: paginasTotales(listado.total, tam),
    irAPagina: (n) => setPagina(Math.max(1, Math.min(n, paginasTotales(listado.total, tam)))),
    reintentarVitrina: () => setIntentoVitrina((n) => n + 1),
    reintentarListado: () => setIntentoListado((n) => n + 1),
  }
}
