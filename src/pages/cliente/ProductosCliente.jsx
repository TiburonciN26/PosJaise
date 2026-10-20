import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, HelpCircle, MapPin, MessageCircle, Package, ShoppingBag, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { COLUMNAS_PRODUCTO_TARJETA, GRUPOS_POR_VENTANA, POR_CATEGORIA, TAMANO_PAGINA_CATALOGO, cargarVentanaGrupos, cargarVitrinaProductos, leerPaginaCatalogo } from '../../lib/catalogoPublico.js'
import { useCatalogoPublico } from '../../hooks/useCatalogoPublico.js'
import { obtenerContacto, obtenerHorario } from '../../lib/datosNegocioWeb.js'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useRequerirSesion } from '../../hooks/useRequerirSesion.js'
import { useToast } from '../../context/ToastContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import { degradadoServicio } from '../../lib/serviciosVisual.js'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useRevelarEnPantalla } from '../../hooks/useRevelarEnPantalla.js'
import { useCintaContinua } from '../../hooks/useCintaContinua.js'
import TarjetaProductoCliente, { porcentajeDescuento } from '../../components/TarjetaProductoCliente.jsx'
import BarraTuCarritoFlotante from '../../components/BarraTuCarritoFlotante.jsx'
import BarraCatalogo from '../../components/BarraCatalogo.jsx'
import SelectorDesplegable from './recompensas/SelectorDesplegable.jsx'
import PaginadorCatalogo from '../../components/PaginadorCatalogo.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

const BUCKET_FOTOS = 'fotos-productos'
const POR_FILA = POR_CATEGORIA
// Constantes estables (no se recrean en cada render): evitan invalidar los useMemo que dependen de ellas.
const SIN_FILAS = []
const CINTA_VACIA = { filas: SIN_FILAS, total: 0 }
const etiquetaOferta = (p) => `Oferta −${porcentajeDescuento(p)}%`
const etiquetaDestacado = () => 'Destacado'
const INTERVALO_HERO_MS = 5000
// Cuántas tarjetas DISTINTAS mínimo debe tener una cinta antes de
// duplicarla — si hay pocas ofertas, la lista se repite para llenar el
// ancho (docs/diseno-productos/README.md, "Movimiento continuo").
const MIN_CINTA = 10

// Medidas de la cinta por medida de pantalla (README: "296×390 a 36px/s
// en escritorio; 200×264 a 28px/s en móvil"). Se resuelven una sola vez
// al montar vía useEntornoAnimacion — igual que los retrasos de la
// animación de entrada — porque el offset en px que lleva
// useCintaContinua tiene que calzar exacto con el tamaño realmente
// renderizado; no vale la pena el resize en vivo para esto.
const CINTA_MEDIDAS = {
  desktop: { ancho: 296, alto: 390, separacion: 24, velocidad: 36 },
  movil: { ancho: 200, alto: 264, separacion: 12, velocidad: 28 },
}

// Catálogo de productos del rediseño (docs/diseno-productos/README.md):
// inicio "Novedades y lo más vendido" con carrusel foto+texto (igual
// efecto que el hero de Servicios), dos cintas continuas (Ofertas /
// Destacados), filtros sticky + catálogo agrupado por categoría (idéntico
// a Servicios), "Cómo comprar", ayuda y la barra flotante "Tu carrito".
// Reemplaza la tarjeta iridiscente con inclinación 3D (`.iri-*`, que se
// queda en index.css sin tocar) por TarjetaProductoCliente.jsx, la misma
// tarjeta de Servicios con lo propio de un producto encima.
//
// `destacado`, `nuevo` y `en_inicio` (migración 117) se marcan a mano
// desde ModalProducto.jsx — decisión confirmada con el usuario. El
// inicio prioriza, por producto, la etiqueta: oferta (precio_antes) >
// "Nuevo" > "Destacado" > "Novedad" genérica. La descripción usa
// `productos.descripcion` (migración 118) si el admin ya la escribió, y
// solo cae al texto genérico por categoría en los que todavía no la
// tienen (mismo criterio que ServiciosCliente.jsx).
export default function ProductosCliente() {
  const { agregarProducto } = useCarritoCliente()
  const requerirSesion = useRequerirSesion()
  const { mostrarToast } = useToast()

  const { usuario } = useAuth()
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)
  const [heroIdx, setHeroIdx] = useState(0)
  const [heroTick, setHeroTick] = useState(0)

  // Fase 4: el catálogo ya no se descarga completo. «Todos» (sin búsqueda) sale de una vitrina acotada (categorías con su total,
  // primeras tarjetas de cada una, héroe y cintas); una categoría o una búsqueda piden UNA página de hasta 40 tarjetas al servidor.
  const {
    vitrina, listado, listadoVigente, categoriaActiva, setCategoriaActiva, busqueda, setBusqueda, termino, agrupado,
    pagina, totalPaginas, irAPagina, reintentarVitrina, reintentarListado,
    gruposVisibles, paginaGrupos, totalPaginasGrupos, ventanaOcupada, ventanaConError, irAPaginaGrupos, reintentarVentana,
  } = useCatalogoPublico({
    clave: usuario?.id ?? 'anon',
    cargarVitrina: ({ signal }) => cargarVitrinaProductos(supabase, { signal }),
    cargarPagina: (parametros) => leerPaginaCatalogo(supabase, { tabla: 'productos', columnas: COLUMNAS_PRODUCTO_TARJETA, ...parametros }),
    cargarGrupos: (parametros) => cargarVentanaGrupos(supabase, { tabla: 'productos', ...parametros }),
  })
  const datos = vitrina.datos
  const cargando = vitrina.estado === 'cargando'

  // Animación de entrada — mismo patrón que ServiciosCliente.jsx (ver
  // docs/patrones/animacion-entrada.md), tabla de retrasos propia de
  // Productos (docs/diseno-productos/README.md, "Animación de entrada").
  const { reducirMovimiento, esDesktop } = useEntornoAnimacion()

  // QA-020: el calendario original (filas de categoría a 1500/1600 ms + 220 ms
  // por fila) mantenía transparentes tarjetas ya cargadas ~1,7 s en cada
  // entrada/regreso. Misma coreografía (hero, ofertas, destacados, filtros,
  // filas) y mismas animaciones, con los retrasos comprimidos para que lo útil
  // aparezca en ~0,5 s tras cargar.
  const ENTRADA_FIJA = esDesktop
    ? { eyebrow: 100, foto: 100, bloque: 150, botones: 250, catalogoLinea: 300, fraseOfertas: 350, filaOfertas: 400, filaDestacados: 450, filtros: 500 }
    : { eyebrow: 150, foto: 80, bloque: 200, botones: 280, catalogoLinea: 320, fraseOfertas: 360, filaOfertas: 400, filaDestacados: 450, filtros: 500 }
  const ENTRADA_FILA = { fila: esDesktop ? 500 : 520, paso: 100, carta: 60, entre: 50 }
  const cintaMedidas = esDesktop ? CINTA_MEDIDAS.desktop : CINTA_MEDIDAS.movil
  const cintaPasoPx = cintaMedidas.ancho + cintaMedidas.separacion

  // QA-022: contacto/horario son secundarios: no bloquean la lista.
  useEffect(() => {
    let vigente = true
    obtenerContacto().then((fila) => vigente && setContacto(fila))
    obtenerHorario().then((fila) => vigente && setHorario(fila))
    return () => {
      vigente = false
    }
  }, [])

  const conteosCategoria = datos?.conteos ?? {}

  const listaRef = useRef(null)
  function elegirCategoria(categoria) {
    setCategoriaActiva(categoria)
    // La barra quedó arriba del hero: al elegir, se baja al inicio de la lista.
    listaRef.current?.scrollIntoView({ block: 'start', behavior: reducirMovimiento ? 'auto' : 'smooth' })
  }

  function cambiarPaginaGrupos(n) {
    irAPaginaGrupos(n)
    listaRef.current?.scrollIntoView({ block: 'start', behavior: reducirMovimiento ? 'auto' : 'smooth' })
  }

  function cambiarPagina(n) {
    irAPagina(n)
    listaRef.current?.scrollIntoView({ block: 'start', behavior: reducirMovimiento ? 'auto' : 'smooth' })
  }

  const categorias = useMemo(() => ['todos', ...(datos?.categorias ?? [])], [datos])

  // Inicio: productos marcados a mano (productos.en_inicio) con stock (hasta 5, ya acotados por el servidor).
  const heroProductos = useMemo(() => datos?.hero ?? [], [datos])
  const heroIdxSeguro = heroProductos.length ? heroIdx % heroProductos.length : 0
  const heroActual = heroProductos[heroIdxSeguro]

  useEffect(() => {
    if (heroProductos.length < 2) return undefined
    const id = setInterval(() => {
      setHeroIdx((indice) => (indice + 1) % heroProductos.length)
    }, INTERVALO_HERO_MS)
    return () => clearInterval(id)
  }, [heroProductos.length, heroTick])

  function irAHero(indice) {
    setHeroIdx(indice)
    setHeroTick((valor) => valor + 1)
  }

  async function agregarDesdeHero() {
    if (!heroActual) return
    if (!requerirSesion('agregar productos al carrito')) return
    const agregado = await agregarProducto(heroActual.id, 1)
    mostrarToast(agregado > 0 ? 'Agregado al carrito.' : 'No se pudo agregar — ya no hay stock disponible.', agregado > 0 ? 'exito' : 'error')
  }

  // Cintas: hasta 12 tarjetas cada una (orden nombre, id) y el total real de ofertas/destacados para el rótulo.
  const ofertas = datos?.ofertas ?? CINTA_VACIA
  const destacados = datos?.destacados ?? CINTA_VACIA

  // Listado plano: solo las filas que pertenecen a la categoría+texto actuales (si no, se muestra «Buscando…», no resultados viejos).
  const listaFiltrada = listadoVigente ? listado.filas : SIN_FILAS
  const listadoOcupado = listado.estado === 'cargando'

  // Vista «Todos»: una fila por categoría con su total real y las primeras tarjetas.
  const grupos = useMemo(() => (agrupado ? gruposVisibles : SIN_FILAS), [agrupado, gruposVisibles])

  // Lo que la página tiene en memoria: la barra del carrito pide por id lo que falte (ver BarraTuCarritoFlotante).
  const conocidos = useMemo(
    () => [...heroProductos, ...ofertas.filas, ...destacados.filas, ...grupos.flatMap((g) => g.primeros), ...listaFiltrada],
    [heroProductos, ofertas, destacados, grupos, listaFiltrada],
  )

  const clavesFilas = useMemo(() => grupos.map((grupo) => grupo.categoria), [grupos])
  const { contenedorRef, refFila, estadoFila } = useRevelarEnPantalla({
    activo: !reducirMovimiento && agrupado,
    claves: clavesFilas,
    agotarEnMs:
      ENTRADA_FILA.fila + (grupos.length + 1) * ENTRADA_FILA.paso + ENTRADA_FILA.carta + POR_FILA * ENTRADA_FILA.entre + 1500,
  })

  const plural = (n) => `${n} ${n === 1 ? 'producto' : 'productos'}`
  const totalVisible = agrupado ? (datos?.total ?? null) : listadoVigente && listado.estado === 'ok' ? listado.total : null
  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const horarioTexto = horario
    ? `${formatearDias(horario.dias_atencion)} ${formatearHora(horario.bloque1_inicio)}-${formatearHora(horario.bloque1_fin)}`
    : null

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  if (vitrina.estado === 'error') {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-white/70">No se pudo cargar el catálogo de productos.</p>
        <button type="button" onClick={reintentarVitrina} className="rounded-full border border-white/20 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div ref={contenedorRef} className="animate-entrada-pestana flex-1 overflow-y-auto">
      {/* 0. BARRA DEL CATÁLOGO (fija) — arriba de todo, justo bajo el header. */}
      <BarraCatalogo
        categorias={categorias}
        conteos={conteosCategoria}
        categoriaActiva={categoriaActiva}
        onElegirCategoria={elegirCategoria}
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        placeholder="Buscar producto…"
        etiquetaTotal={totalVisible == null ? 'Buscando…' : plural(totalVisible)}
        selectorCategoriasMovil={
          <SelectorDesplegable
            opciones={categorias.map(categoria => ({ clave: categoria, label: categoria === 'todos' ? 'Todas' : categoria }))}
            valor={categoriaActiva}
            onSeleccionar={elegirCategoria}
            etiqueta="Categoría de productos"
            etiquetaLista="Categorías de productos"
            alineacion="izquierda"
            className="w-[45%] shrink-0"
          />
        }
        className={reducirMovimiento ? '' : 'in-up'}
        style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.filtros}ms` }}
      />

      {/* 0. INICIO: "Novedades y lo más vendido" */}
      {heroActual && (
        <section className="mx-auto grid w-full max-w-[1400px] gap-8 lw-gutter pb-6 pt-6 lg:grid-cols-[1fr_1.12fr] lg:gap-16 lg:pt-10">
          <div className="order-2 flex flex-col justify-between gap-6 lg:order-1">
            <span
              className={`hidden text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-white/60 sm:block ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.eyebrow}ms` }}
            >
              Novedades y lo más vendido
            </span>

            <div
              className={`grid ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.bloque}ms` }}
            >
              {heroProductos.map((p, i) => {
                const activo = i === heroIdxSeguro
                const saliente = heroProductos.length > 2 && i === (heroIdxSeguro - 1 + heroProductos.length) % heroProductos.length
                const y = activo ? 0 : saliente ? -16 : 16
                const blur = activo ? 0 : 8
                const dTitulo = activo ? 350 : 0
                const dResto = activo ? 480 : 0
                const desc = p.descripcion || `Uno de nuestros productos de ${p.categoria ?? 'catálogo'} favoritos entre nuestras clientas.`
                const estiloTitulo = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, filter: 'none', transform: 'none', transition: 'none' }
                  : {
                      opacity: activo ? 1 : 0,
                      filter: `blur(${blur}px)`,
                      transform: `translateY(${y}px)`,
                      transition: `opacity 0.7s ease ${dTitulo}ms, filter 0.7s ease ${dTitulo}ms, transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) ${dTitulo}ms`,
                    }
                const estiloDescripcion = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, transform: 'none', transition: 'none' }
                  : {
                      opacity: activo ? 1 : 0,
                      transform: `translateY(${y}px)`,
                      transition: `opacity 0.7s ease ${dResto}ms, transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) ${dResto}ms`,
                    }
                const estiloPrecio = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, transition: 'none' }
                  : { opacity: activo ? 1 : 0, transition: `opacity 0.7s ease ${dResto}ms` }

                return (
                  <div key={p.id} style={{ gridArea: '1 / 1' }} aria-hidden={!activo} className={`flex flex-col ${activo ? '' : 'pointer-events-none'}`}>
                    <h1 style={estiloTitulo} className="sm:text-[48px] lw-titulo-heavitas mt-4 text-[34px] uppercase leading-[1.02]">
                      {p.nombre}
                    </h1>
                    <p style={estiloDescripcion} className="mt-4 max-w-[44ch] text-sm leading-relaxed text-[#d9d9dc] sm:text-[15px]">
                      {desc}
                    </p>
                    <span style={estiloPrecio} className="mt-3.5 text-[13px] sm:text-sm text-white/60">
                      <b className="text-[15px] sm:text-base font-semibold text-white">{formatearSoles(p.precio)}</b>
                      {p.precio_antes && <s className="ml-1.5">{formatearSoles(p.precio_antes)}</s>}
                      {p.categoria && ` · ${p.categoria}`}
                    </span>
                  </div>
                )
              })}
            </div>

            <div
              className={`flex flex-col gap-3 sm:flex-row sm:items-center ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.botones}ms` }}
            >
              <button
                type="button"
                onClick={agregarDesdeHero}
                className="flex items-center justify-between gap-3 rounded-full py-1.5 pl-6 pr-1.5 text-sm font-semibold text-black"
                style={{ background: 'var(--lw-gold)' }}
              >
                Agregar al carrito
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
                  <ShoppingBag className="h-[15px] w-[15px]" />
                </span>
              </button>
              <Link
                to={`/productos/${heroActual.id}`}
                className="rounded-full border border-white/15 px-6 py-3.5 text-center text-sm text-[#e8e8ea] transition-colors hover:border-white/30"
              >
                Ver detalles
              </Link>
            </div>

            <div
              className={`flex flex-wrap items-baseline gap-2 text-xs text-white/50 ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.catalogoLinea}ms` }}
            >
              <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-[#e8e8ea]">Catálogo</span>
              <span>/</span>
              <span className="font-medium text-[#e8e8ea]">{plural(datos?.total ?? 0)}</span>
              <span>·</span>
              <span>Recojo en el local</span>
              <span>·</span>
              <span>Envío a domicilio</span>
            </div>
          </div>

          <div
            className={`order-1 flex flex-col gap-2.5 lg:order-2 ${reducirMovimiento ? '' : 'in-photo'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.foto}ms` }}
          >
            <div className="relative h-[300px] overflow-hidden rounded-[16px] bg-[#050505] sm:h-[420px]">
              {heroProductos.map((p, i) => {
                // Solo se piden las fotos del activo y sus vecinos (anterior/siguiente): las demás se piden cuando les toca.
                const distancia = Math.abs(i - heroIdxSeguro)
                const cerca = distancia <= 1 || distancia === heroProductos.length - 1
                const urlFoto = cerca ? urlPublicaFoto(BUCKET_FOTOS, p.foto_url) : null
                return (
                  <div key={p.id} className="absolute inset-0" style={{ opacity: i === heroIdxSeguro ? 1 : 0, transition: 'opacity 1.1s ease' }}>
                    {urlFoto ? (
                      <img
                        src={urlFoto}
                        alt={p.nombre}
                        className="h-full w-full object-cover"
                        style={{ transform: `scale(${i === heroIdxSeguro ? 1 : 1.06})`, transition: 'transform 6s ease-out' }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/60" style={{ background: degradadoServicio(p) }}>
                        <Package className="h-10 w-10" />
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/60" />

              {heroProductos.map((producto, indice) => {
                const descuento = porcentajeDescuento(producto)
                const etiqueta = descuento != null ? `En oferta −${descuento}%` : producto.nuevo ? 'Nuevo' : producto.destacado ? 'Destacado' : 'Novedad'
                return (
                  <span key={producto.id} aria-hidden={indice !== heroIdxSeguro}
                    className="pointer-events-none absolute left-4 top-9 inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] sm:text-sm font-semibold text-[#0b0b0c] transition-opacity duration-300 motion-reduce:transition-none"
                    style={{ opacity: indice === heroIdxSeguro ? 1 : 0 }}>
                    <Sparkles aria-hidden="true" className="h-[13px] w-[13px]" />
                    {etiqueta}
                  </span>
                )
              })}

              {heroProductos.length > 1 && (
                <div className="absolute inset-x-4 top-3.5 flex gap-1.5">
                  {heroProductos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => irAHero(i)}
                      aria-label={`Ir a ${p.nombre}`}
                      className={`lw-barra-progreso ${i === heroIdxSeguro ? 'activa' : i < heroIdxSeguro ? 'completa' : ''}`}
                    >
                      <span />
                    </button>
                  ))}
                </div>
              )}

              <div className="absolute inset-x-4 bottom-4 flex items-end justify-between text-[11px] sm:text-xs font-medium uppercase tracking-widest text-white">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                  {String(heroIdxSeguro + 1).padStart(2, '0')} / {String(heroProductos.length).padStart(2, '0')}
                </span>
                <span className="normal-case tracking-normal text-[#eeeeee]">
                  <b className="font-semibold">{formatearSoles(heroActual.precio)}</b>
                </span>
              </div>
            </div>

            {heroProductos.length > 1 && (
              <div className="grid grid-cols-3 gap-2.5">
                {[1, 2, 3].map((j) => {
                  const t = (heroIdxSeguro + j) % heroProductos.length
                  const p = heroProductos[t]
                  const urlFoto = urlPublicaFoto(BUCKET_FOTOS, p.foto_url, 'm')
                  return (
                    <button
                      key={j}
                      type="button"
                      onClick={() => irAHero(t)}
                      aria-label={`Ver ${p.nombre}`}
                      className="group relative h-[108px] overflow-hidden rounded-[14px] bg-[#151517] sm:h-[180px]"
                    >
                      {urlFoto ? (
                        <img src={urlFoto} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/50" style={{ background: degradadoServicio(p) }}>
                          <Package className="h-6 w-6" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 1. OFERTAS Y DESTACADOS: dos cintas en movimiento continuo. */}
      {(ofertas.filas.length > 0 || destacados.filas.length > 0) && (
        <section className="flex flex-col gap-9 py-10">
          <p
            className={`mx-auto w-full max-w-[1700px] lw-gutter text-[15px] sm:text-base leading-relaxed text-[#d9d9dc] ${reducirMovimiento ? '' : 'in-left'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.fraseOfertas}ms` }}
          >
            Los mismos productos que usamos en el salón, para que tu resultado dure en casa.
          </p>
          {ofertas.filas.length > 0 && (
            <FilaCintaProductos
              titulo="Ofertas"
              derecha
              etiqueta={etiquetaOferta}
              productos={ofertas.filas}
              total={ofertas.total}
              pasoPx={cintaPasoPx}
              medidas={cintaMedidas}
              velocidadPxS={cintaMedidas.velocidad}
              activo={!reducirMovimiento}
              claseEntrada={reducirMovimiento ? '' : 'in-left'}
              delayEntrada={ENTRADA_FIJA.filaOfertas}
            />
          )}
          {destacados.filas.length > 0 && (
            <FilaCintaProductos
              titulo="Destacados"
              derecha={false}
              etiqueta={etiquetaDestacado}
              productos={destacados.filas}
              total={destacados.total}
              pasoPx={cintaPasoPx}
              medidas={cintaMedidas}
              velocidadPxS={cintaMedidas.velocidad}
              activo={!reducirMovimiento}
              claseEntrada={reducirMovimiento ? '' : 'in-right'}
              delayEntrada={ENTRADA_FIJA.filaDestacados}
            />
          )}
        </section>
      )}

      <div ref={listaRef} className="mx-auto w-full max-w-[1700px] scroll-mt-16 lw-gutter">
        {/* 3a. "Todos": una fila por categoría */}
        {agrupado && (
          <div aria-busy={ventanaOcupada} className={`flex flex-col gap-10 pt-8 transition-opacity ${ventanaOcupada ? 'opacity-60' : ''}`}>
            {grupos.map((grupo, gi) => {
              const decision = reducirMovimiento ? null : estadoFila(grupo.categoria)
              const pendiente = !reducirMovimiento && !decision
              const listo = Boolean(decision && !decision.agotada)
              const delayBase = decision?.modo === 'carga' ? ENTRADA_FILA.fila + gi * ENTRADA_FILA.paso : 0

              return (
                <section
                  key={grupo.categoria}
                  ref={refFila(grupo.categoria)}
                  className="flex flex-col gap-3.5"
                  style={pendiente ? { opacity: 0 } : undefined}
                >
                  <div
                    className={`flex items-baseline justify-between gap-3 ${listo ? 'in-left' : ''}`}
                    style={listo ? { animationDelay: `${delayBase}ms` } : undefined}
                  >
                    <div className="flex min-w-0 flex-wrap items-baseline gap-3">
                      <h2 className="sm:text-[40px] lw-titulo-heavitas text-lg uppercase">{grupo.categoria}</h2>
                      <span className="text-xs text-white/50">{plural(grupo.total)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCategoriaActiva(grupo.categoria)}
                      className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)]"
                    >
                      Ver todo ({grupo.total}) <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="-mx-(--separador-vertical) flex gap-3 overflow-x-auto px-(--separador-vertical) sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-5 sm:overflow-visible sm:px-0">
                    {grupo.primeros.map((p, k) => {
                      const claseTarjeta = listo ? (esDesktop ? (k < 2 ? 'in-left' : 'in-right') : 'in-right') : ''
                      const delayTarjeta = delayBase + ENTRADA_FILA.carta + k * ENTRADA_FILA.entre
                      return (
                        <div key={p.id} className={`w-[150px] shrink-0 sm:w-auto ${claseTarjeta}`} style={listo ? { animationDelay: `${delayTarjeta}ms` } : undefined}>
                          <TarjetaProductoCliente producto={p} />
                        </div>
                      )
                    })}
                    {grupo.total > POR_FILA && (
                      <button
                        type="button"
                        onClick={() => setCategoriaActiva(grupo.categoria)}
                        className={`flex h-[150px] w-[120px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-white/15 bg-[#111113] text-xs font-semibold text-white sm:hidden ${listo ? 'in-right' : ''}`}
                        style={listo ? { animationDelay: `${delayBase + ENTRADA_FILA.carta + POR_FILA * ENTRADA_FILA.entre}ms` } : undefined}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                        Ver los {grupo.total}
                      </button>
                    )}
                  </div>
                </section>
              )
            })}
            {ventanaConError && (
              <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-white/70">No se pudieron cargar las categorías.</p>
                <button type="button" onClick={reintentarVentana} className="rounded-full border border-white/20 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white">
                  Reintentar
                </button>
              </div>
            )}
            <PaginadorCatalogo pagina={paginaGrupos} totalPaginas={totalPaginasGrupos} total={categorias.length - 1} tam={GRUPOS_POR_VENTANA} ocupado={ventanaOcupada} onPagina={cambiarPaginaGrupos} etiqueta="categorías" />
          </div>
        )}

        {/* 3b. Una categoría o una búsqueda: UNA página (hasta 40 tarjetas) del listado del servidor */}
        {!agrupado && (
          <div className="flex flex-col gap-4 pt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="sm:text-[40px] lw-titulo-heavitas text-lg uppercase">{termino ? 'Resultados' : categoriaActiva}</h2>
                {totalVisible != null && <span className="text-xs text-white/50">{plural(totalVisible)}</span>}
              </div>
              {categoriaActiva !== 'todos' && (
                <button
                  type="button"
                  onClick={() => setCategoriaActiva('todos')}
                  className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)]"
                >
                  <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Todas las categorías
                </button>
              )}
            </div>
            {listado.estado === 'error' ? (
              <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-white/70">No se pudieron cargar los productos.</p>
                <button type="button" onClick={reintentarListado} className="rounded-full border border-white/20 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white">
                  Reintentar
                </button>
              </div>
            ) : !listadoVigente ? (
              <p role="status" className="py-10 text-center text-sm text-white/50">Buscando…</p>
            ) : listaFiltrada.length === 0 && listado.estado === 'ok' ? (
              <p className="py-10 text-center text-sm text-white/50">{termino ? `Sin resultados para "${termino}".` : 'No hay productos en esta categoría.'}</p>
            ) : (
              <div
                aria-busy={listadoOcupado}
                className={`grid grid-cols-2 gap-x-3 gap-y-6 transition-opacity sm:grid-cols-4 sm:gap-x-5 sm:gap-y-8 ${listadoOcupado ? 'opacity-60' : ''}`}
              >
                {listaFiltrada.map((p) => (
                  <TarjetaProductoCliente key={p.id} producto={p} />
                ))}
              </div>
            )}
            {listadoVigente && listado.estado !== 'error' && (
              <PaginadorCatalogo pagina={pagina} totalPaginas={totalPaginas} total={listado.total} tam={TAMANO_PAGINA_CATALOGO} ocupado={listadoOcupado} onPagina={cambiarPagina} etiqueta="productos" />
            )}
          </div>
        )}

        {/* 4. CÓMO COMPRAR */}
        <section className="mt-16 border-t border-white/10 pt-10">
          <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-white/60">Así de simple</span>
          <h2 className="sm:text-[40px] lw-titulo-heavitas mt-2.5 text-2xl uppercase">Cómo comprar</h2>
          <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {[
              { paso: 'Paso 1', titulo: 'Elige tus productos', texto: 'Toca un producto (o la flecha ↗) para ver sus detalles, elige la cantidad y agrégalo a tu carrito.' },
              { paso: 'Paso 2', titulo: 'Confirma tu pedido', texto: 'En el carrito aplica tu cupón, paga por Yape, Plin o transferencia y sube tu comprobante.' },
              { paso: 'Paso 3', titulo: 'Recoge o recibe', texto: 'Te avisamos en Notificaciones cuando tu pedido esté listo para recoger o en camino, según la entrega que elijas.' },
            ].map((item) => (
              <div key={item.paso} className="rounded-[10px] border border-white/10 bg-[#111113] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <span className="text-[11px] sm:text-xs tracking-widest text-[var(--lw-gold)]">{item.paso.toUpperCase()}</span>
                <h3 className="sm:text-xl mt-2.5 text-[15px] font-semibold text-white">{item.titulo}</h3>
                <p className="mt-1.5 text-[13px] sm:text-sm leading-relaxed text-white/60">{item.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 5. AYUDA */}
        <section className="mt-16 border-t border-white/10 pt-14">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex max-w-[560px] flex-col gap-3.5">
              <h2 className="sm:text-[40px] lw-titulo-heavitas text-3xl uppercase leading-[1.05]">¿No encuentras tu producto?</h2>
              <p className="text-sm leading-relaxed text-white/60 sm:text-[15px]">
                Cuéntanos qué buscas y te recomendamos el producto ideal para tu tipo de cabello, uñas o piel.
              </p>
            </div>
            {horarioTexto && (
              <div className="flex flex-col gap-1 text-right">
                <span className="text-lg font-bold text-white sm:text-2xl">{horarioTexto}</span>
                <span className="text-xs text-white/50">horario de atención por WhatsApp y en el local</span>
              </div>
            )}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                <MessageCircle className="h-[17px] w-[17px]" />
              </span>
              <h3 className="sm:text-xl mt-2.5 text-[15px] font-bold text-white">Escríbenos por WhatsApp</h3>
              <p className="mb-1 text-[13px] sm:text-sm leading-relaxed text-white/60">Te decimos si lo tenemos, cuándo llega o cuál te conviene más.</p>
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre sus productos.')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start rounded-full border border-white/20 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white"
                >
                  Abrir WhatsApp
                </a>
              ) : (
                <span className="self-start rounded-full border border-dashed border-white/15 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white/40">
                  Aún no configurado
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                <MapPin className="h-[17px] w-[17px]" />
              </span>
              <h3 className="sm:text-xl mt-2.5 text-[15px] font-bold text-white">Contacto y ubicación</h3>
              <p className="mb-1 text-[13px] sm:text-sm leading-relaxed text-white/60">
                {contacto?.direccion || contacto?.telefono ? [contacto?.direccion, contacto?.telefono].filter(Boolean).join(' · ') : 'Llámanos o visítanos. Te atendemos en el mismo horario.'}
              </p>
              <Link to="/nosotros" className="self-start rounded-full border border-white/20 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white">
                Ver contacto
              </Link>
            </div>
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                <HelpCircle className="h-[17px] w-[17px]" />
              </span>
              <h3 className="sm:text-xl mt-2.5 text-[15px] font-bold text-white">Preguntas frecuentes</h3>
              <p className="mb-1 text-[13px] sm:text-sm leading-relaxed text-white/60">Envíos, pagos, cambios y devoluciones: todo en un solo lugar.</p>
              <span className="self-start rounded-full border border-dashed border-white/15 px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-white/50">Muy pronto</span>
            </div>
          </div>
        </section>
      </div>

      <PieClienteWeb />

      <BarraTuCarritoFlotante productos={conocidos} />
    </div>
  )
}

// Una fila de la cinta continua (Ofertas/Destacados) — ver
// useCintaContinua.js para el mecanismo de desplazamiento. Encapsulada
// acá porque necesita su propio par de refs de hover/foco para pausar
// SOLO esta fila, sin afectar a la otra.
const FilaCintaProductos = memo(function FilaCintaProductos({ titulo, derecha, etiqueta, productos, total, pasoPx, medidas, velocidadPxS, activo, claseEntrada, delayEntrada }) {
  const n = productos.length
  const k = Math.max(1, Math.ceil(MIN_CINTA / n))
  const base = useMemo(() => Array.from({ length: k }, () => productos).flat(), [productos, k])
  const pista = useMemo(() => base.concat(base), [base])

  const { trackRef, dashRef, mover, pausar } = useCintaContinua({
    cantidadDistintos: n,
    pasoPx,
    velocidadPxS,
    derecha,
    activo,
  })

  function alEntrar(evento) {
    if (evento.target.closest('.cinta-tarjeta')) pausar(true)
  }
  function alSalir(evento) {
    const siguiente = evento.relatedTarget
    if (!siguiente || !siguiente.closest || !siguiente.closest('.cinta-tarjeta')) pausar(false)
  }

  return (
    <div className={`flex flex-col ${claseEntrada}`} style={claseEntrada ? { animationDelay: `${delayEntrada}ms` } : undefined}>
      <div className={`mx-auto flex w-full max-w-[1700px] items-baseline gap-3 lw-gutter ${derecha ? 'justify-start' : 'justify-end'}`}>
        <h2 className="sm:text-[40px] lw-titulo-heavitas text-xl uppercase">{titulo}</h2>
        <span className="text-xs text-white/50">{plural(total ?? n)}</span>
      </div>

      <div className="lw-cinta-mask my-6 overflow-hidden" onMouseOver={alEntrar} onMouseOut={alSalir} onFocus={alEntrar} onBlur={alSalir}>
        <div ref={trackRef} className="flex will-change-transform">
          {pista.map((p, indice) => {
            const urlFoto = urlPublicaFoto(BUCKET_FOTOS, p.foto_url)
            return (
              <Link
                key={`${p.id}-${indice}`}
                to={`/productos/${p.id}`}
                tabIndex={0}
                className="cinta-tarjeta group relative shrink-0 overflow-hidden rounded-[14px] bg-[#151517]"
                style={{ width: medidas.ancho, height: medidas.alto, marginRight: medidas.separacion }}
              >
                {urlFoto ? (
                  <img src={urlFoto} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/50" style={{ background: degradadoServicio(p) }}>
                    <Package className="h-8 w-8" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/80" />
                <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/30" />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/80 px-2.5 py-1.5 text-[9.5px] sm:text-xs font-bold uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                  {etiqueta(p)}
                </span>
                <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 flex flex-col gap-1">
                  <span className="text-[15px] sm:text-base font-bold leading-tight text-white">{p.nombre}</span>
                  <span className="text-[13px] sm:text-sm font-semibold text-white">
                    {formatearSoles(p.precio)}
                    {p.precio_antes && <s className="ml-1.5 text-[12px] sm:text-sm font-normal text-white/60">{formatearSoles(p.precio_antes)}</s>}
                  </span>
                </div>
                <span className="absolute left-1/2 top-1/2 z-[3] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 whitespace-nowrap rounded-full bg-white/0 py-0 pl-0 pr-0 text-[13px] sm:text-sm font-semibold text-[#0b0b0c] opacity-0 backdrop-blur transition-all duration-300 group-hover:bg-white/95 group-hover:py-2.5 group-hover:pl-4.5 group-hover:pr-1.5 group-hover:opacity-100">
                  Ver detalles
                  <span className="hidden h-[30px] w-[30px] items-center justify-center rounded-full bg-[#0b0b0c] text-white group-hover:flex">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3.5">
        <button type="button" onClick={() => mover(-1)} aria-label={`Producto anterior en ${titulo}`} className="flex h-11 w-11 items-center justify-center text-white/50 transition-colors hover:text-white">
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>
        <div className="relative flex h-[3px] items-center gap-[5px]">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className="h-[2px] w-[18px] rounded-full bg-[#3a3a3f]" />
          ))}
          <span ref={dashRef} className="absolute left-0 top-0 h-[3px] w-[18px] rounded-full bg-white" />
        </div>
        <button type="button" onClick={() => mover(1)} aria-label={`Siguiente producto en ${titulo}`} className="flex h-11 w-11 items-center justify-center text-white/50 transition-colors hover:text-white">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
})

function plural(n) {
  return `${n} ${n === 1 ? 'producto' : 'productos'}`
}
