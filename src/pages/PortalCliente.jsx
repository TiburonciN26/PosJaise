import { Menu, ShoppingCart, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { PerfilClienteProvider } from '../context/PerfilClienteContext.jsx'
import { CarritoClienteProvider, useCarritoCliente } from '../context/CarritoClienteContext.jsx'
import { NotificacionesClienteProvider } from '../context/NotificacionesClienteContext.jsx'
import { seccionesCliente, titulosSubpaginasCliente } from '../config/navegacionCliente.js'
import MenuUsuarioCliente from '../components/MenuUsuarioCliente.jsx'
import MenuLateralCliente from '../components/MenuLateralCliente.jsx'

// Chanchito "activo" — SVG que trajo el usuario (public/icons/
// chanchitoActivo.svg), inlineado acá en vez de <img src="..."> a
// propósito: un <img> de un .svg externo no hereda `currentColor` del
// botón (siempre se vería negro, sin importar el hover/tema) — inline
// sí, igual que el resto de íconos "a medida" del proyecto
// (EsquinaBracket, .lw-checker). El path es el mismo que el archivo,
// solo con los atributos en formato JSX (stroke-width→strokeWidth,
// etc).
// -scale-x-100: el dibujo original mira hacia la derecha (el hocico
// del lado del carrito/avatar) — se espeja para que mire hacia la
// izquierda, o sea hacia el logo (pedido explícito del usuario).
// El archivo hermano (chanchitoBloqueado.svg, mismo chancho + una
// barra diagonal) queda en public/icons/ sin usar todavía — el
// usuario lo reservó para más adelante, cuando algún producto/servicio
// puntual no sume puntos.
function IconoChanchito() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icono-chanchito h-[22px] w-[22px] -scale-x-100 sm:h-8 sm:w-8"
    >
      <path d="M15 11v.01" />
      <path d="M16 3l0 3.803a6.019 6.019 0 0 1 2.658 3.197h1.341a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-1.342a6.008 6.008 0 0 1 -1.658 2.473v2.027a1.5 1.5 0 0 1 -3 0v-.583a6.04 6.04 0 0 1 -1 .083h-4a6.04 6.04 0 0 1 -1 -.083v.583a1.5 1.5 0 0 1 -3 0v-2l0 -.027a6 6 0 0 1 4 -10.473h2.5l4.5 -3" />
    </svg>
  )
}

// Ícono de puntos (header) — ya no es un placeholder inerte: lleva a
// '/mis-puntos' (ver implementacionesWed.md §7.15), la tarjeta con el
// nivel real del cliente (Básico/Premium/VIP, calculado en el servidor
// por mis_puntos()). Las animaciones de la referencia del usuario
// (rebote al sumar, brillo pulsante al llenarse, moneda cayendo,
// destellos, "+N" flotante) siguen portadas en index.css
// (`.chanchito-*`) para cuando el ícono del header también reaccione en
// vivo a sumar puntos — hoy solo usa `.icono-chanchito` en reposo.
// §7.54: mismo "volver" que BotonCarrito (§7.53) — parado en
// /mis-puntos, el ícono pasa a ser navigate(-1) en vez de un Link que
// no haría nada ahí.
function BotonChanchito({ estaEnPuntos }) {
  const navigate = useNavigate()

  if (estaEnPuntos) {
    return (
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Volver"
        className="-mr-2 flex h-11 w-11 items-center justify-center text-white/80 transition-colors hover:text-white"
      >
        <IconoChanchito />
      </button>
    )
  }

  return (
    <Link
      to="/mis-puntos"
      aria-label="Tus puntos"
      className="-mr-2 flex h-11 w-11 items-center justify-center text-white/80 transition-colors hover:text-white"
    >
      <IconoChanchito />
    </Link>
  )
}

// Botón del carrito (header) — subpágina propia ('/carrito', ver
// titulosSubpaginasCliente), no una de las pestañas principales. La
// insignia con la cantidad viene de CarritoClienteContext, compartido
// con ServiciosCliente/ProductosCliente para que se actualice sola al
// agregar/quitar algo, sin recargar la página.
// La insignia usa el degradado --lw-metal-azul (el "acero pulido" con
// brillo) — antes solo en Inicio (esInicio), dorado en el resto; desde
// §7.57 el azul metálico es el acento único de todo el portal cliente,
// así que la insignia lo usa siempre, sin condicional.
// §7.53: si ya estás EN /carrito, el mismo ícono pasa a ser "volver" —
// navigate(-1) (un paso atrás en el historial del navegador), no un
// Link a /carrito de nuevo (que ahí no haría nada) ni a /inicio fijo —
// así, parada en Productos, abrís el carrito y volvés a tocar el
// ícono, volvés a Productos, no a Inicio. Fuera de /carrito se
// comporta exactamente igual que antes (Link normal).
function BotonCarrito({ estaEnCarrito }) {
  const { totalItems } = useCarritoCliente()
  const navigate = useNavigate()

  const contenido = (
    <>
      <ShoppingCart className="h-5 w-5 sm:h-7 sm:w-7" />
      {totalItems > 0 && (
        <span
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-black"
          style={{ background: 'var(--lw-metal-azul)' }}
        >
          {totalItems}
        </span>
      )}
    </>
  )

  if (estaEnCarrito) {
    return (
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Volver"
        className="relative flex h-11 w-11 items-center justify-center text-white/80 transition-colors hover:text-white"
      >
        {contenido}
      </button>
    )
  }

  return (
    <Link
      to="/carrito"
      aria-label="Tu carrito"
      className="relative flex h-11 w-11 items-center justify-center text-white/80 transition-colors hover:text-white"
    >
      {contenido}
    </Link>
  )
}

// Shell de la pestaña Web para clientes: deliberadamente NO usa Layout ni
// MenuLateral del POS (ni su config de navegacion.js) — un cliente con
// rol 'CLIENTE' (ver AuthContext.cargarPerfilCliente) nunca llega a montar
// esos componentes.
//
// Header inspirado en la técnica de nav flotante de la referencia
// "Apogee" que trajo el usuario (pastillas de vidrio translúcidas sobre
// el contenido, no una barra sólida) — se tomó solo la técnica del
// nav/header, no el resto de ese Hero (video/dashboard falso de esa
// referencia son de otro rubro, no del salón).
//
// El <header> en sí es transparente (sin fondo propio) y, a pedido del
// usuario, sin cajas/bordes alrededor de nada — pestañas, ícono de
// carrito y hamburguesa son íconos/texto "libres" directo sobre el
// header, sin el tratamiento `.liquid-glass` que tenían antes (eso
// se queda solo para tarjetas/paneles de contenido, no para el
// cromo del header). Es `fixed` (no un bloque más del flujo) a
// propósito: flotando encima, el contenido de cada pestaña pasa por
// debajo al hacer scroll. `pt-16 sm:pt-[72px]` en el contenedor de abajo
// compensa SOLO el alto real del header — el contenido de cada pestaña
// (el video de Inicio incluido) arranca justo debajo, sin ningún hueco
// extra reservado para la migaja de abajo: si hubiera un hueco ahí, en
// ese tramo no pasaría nada por detrás y tanto el header como la migaja
// se verían con un fondo negro sólido en vez de flotar de verdad sobre
// el contenido (bug reportado por el usuario con captura).
//
// El drawer móvil (`MenuLateralCliente`, z-20) queda por debajo del
// header (z-50) a propósito: el botón de hamburguesa sigue visible/
// clickeable para cerrarlo con el drawer abierto.
//
// Indicador de ubicación: ya no vive al lado del logo ni es parte del
// <header> (a pedido explícito del usuario: debe ser un elemento propio,
// separado del header, no una segunda fila pegada a él) — es una migaja
// de pan ("Inicio | <pestaña actual>") en su propio `fixed`, `z-40`
// (debajo del header, `z-50`, pero encima de cualquier contenido/video
// de la pestaña, que no declara z-index propio) y completamente sin
// fondo — flota directo sobre el contenido real que ahora sí pasa por
// ahí (ver el fix de arriba). El "|" va en el dorado del tema. El
// contenedor exterior es `pointer-events-none`
// (ocupa todo el ancho pero solo el texto/link de adentro es clickeable)
// para no tapar clics sobre el contenido que flota debajo, en el espacio
// vacío a la derecha de la migaja. Si la ruta actual ya es Inicio, se
// muestra sola (sin "|" ni segunda migaja, sería redundante). Misma
// animación de deslizamiento que usa Header.jsx en el POS
// (`.animate-deslizar-pestana`).
//
// Busca el título de una ruta exacta, ya sea una pestaña principal
// (seccionesCliente) o una subpágina (titulosSubpaginasCliente, ver
// navegacionCliente.js) — ambas listas son planas, una ruta con "/"
// adentro (ej. '/mi-perfil/direcciones') es una sola clave más ahí, no
// necesita anidarse de verdad en ningún lado.
function tituloDeRuta(ruta) {
  return seccionesCliente.find((seccion) => seccion.path === ruta)?.label ?? titulosSubpaginasCliente[ruta]
}

// Arma la migaja completa de la ruta actual partiéndola por segmentos:
// '/mi-perfil/direcciones' → ['/mi-perfil', '/mi-perfil/direcciones'] →
// [{ruta:'/mi-perfil', titulo:'Mi Perfil'}, {ruta:'/mi-perfil/direcciones', titulo:'Direcciones'}].
// Así, con el título de Mi Perfil ya declarado como prefijo, cualquier
// subpágina anidada bajo una ruta existente arma sola su nivel extra sin
// tocar este archivo — no hace falta una tabla de "padres" aparte.
function migajasDeRuta(pathname) {
  const segmentos = pathname.split('/').filter(Boolean)
  const migajas = []
  for (let i = 0; i < segmentos.length; i += 1) {
    const ruta = `/${segmentos.slice(0, i + 1).join('/')}`
    const titulo = tituloDeRuta(ruta)
    if (titulo) migajas.push({ ruta, titulo })
  }
  return migajas
}

// Todo el shell de cliente vive bajo .landing-web (§6 implementacionesWed.md)
// — ya no es condicional por ruta: el diseño oscuro es el único diseño de
// esta pestaña de ahora en más, así que cualquier página nueva que se
// agregue después la hereda automáticamente sin tocar este archivo.
export default function PortalCliente() {
  const location = useLocation()
  const [menuAbierto, setMenuAbierto] = useState(false)

  const esInicio = location.pathname === '/inicio'
  const migajas = esInicio ? [] : migajasDeRuta(location.pathname)

  return (
    <PerfilClienteProvider>
      <CarritoClienteProvider>
        <NotificacionesClienteProvider>
          <div className="landing-web flex h-svh flex-col">
            {/* Fondo sólido (§7.51, antes transparente/flotante desde
                §7.36): a pedido del usuario, para que el header no se
                "mezcle" con lo que pasa por detrás al hacer scroll. Esto
                deshace el bleed de la foto de Inicio bajo el header
                (§7.37) — si el header ahora es opaco, dejar que la foto
                siga detrás solo tapaba la punta de la cabeza de la
                clienta con una franja negra sólida. Por eso el `pt-16
                sm:pt-[72px]` de acá abajo volvió a aplicarse SIEMPRE (ya
                no se salta en /inicio) — toda la estructura, hero
                incluido, arranca debajo del header otra vez, como en
                el resto de la Web. */}
            <header className="fixed inset-x-0 top-0 z-50 flex h-12 items-center bg-[#0b0b0c] px-4 pt-2 sm:h-[72px] sm:px-6 md:px-8">
              <div className="mx-auto flex w-full max-w-[1700px] items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMenuAbierto((valorAnterior) => !valorAnterior)}
                  aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
                  aria-expanded={menuAbierto}
                  className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-white/80 transition-colors hover:text-white lg:hidden"
                >
                  {menuAbierto ? <X className="h-6 w-6 text-[#a9c6ec]" /> : <Menu className="h-6 w-6" />}
                </button>
  
                {/* Wordmark tipográfico (referencia "jaise-inicio-oscuro", ver
                    implementacionesWed.md §7.37) — reemplaza el logo anterior
                    (ícono redondo + "Jaise"/"Beauty Academy" en Inter) que no
                    tenía nada que ver con la nueva dirección visual. Sin
                    imagen: es texto en Orbitron, mismo trato que .lw-titulo-*
                    del hero de Inicio.
                    `relative` acá (no en el <header>) a propósito: es el
                    ancla de la migaja de abajo (§7.41) — así su posición
                    sale de la del logo mismo (CSS puro, `top-full`), no de
                    un cálculo de píxeles aparte que hay que mantener
                    sincronizado a mano con el alto del header en cada
                    breakpoint (eso era lo que se desalineaba al achicar/
                    agrandar la pantalla, bug reportado por el usuario). */}
                <div className="relative flex shrink-0 flex-col items-center gap-0.5 leading-none">
                  <Link to="/inicio" aria-label="Jaise Beauty Academy — inicio" className="flex flex-col items-center gap-0.5 leading-none">
                    <span
                      className="pl-[0.15em] text-[14px] font-black tracking-[0.19em] text-white sm:text-[24px]"
                      style={{ fontFamily: "'Orbitron', sans-serif" }}
                    >
                       JAISE
                      <sup className="ml-0.5 align-top text-[0px]">˚</sup>
                    </span>
                    <span className="pl-[0.3em] text-[6px] font-bold tracking-[0.3em] text-white/50">
                      BEAUTY ACADEMY
                    </span>
                  </Link>

                  {/* Migaja de pan ("Inicio | <pestaña actual>") — pegada
                      justo debajo del logo (`top-full`) y alineada a su
                      borde izquierdo (`left-0`), inmune al tamaño de
                      pantalla porque es 100% relativa a ESTE contenedor, no
                      al viewport. Sigue siendo un elemento propio (no una
                      segunda fila del <nav> de pestañas, a pedido explícito
                      de una instrucción anterior del usuario) — vive acá
                      adentro por el `relative` del logo, no adentro del
                      <nav> de pestañas. "Inicio" y el "|" van siempre en
                      azul metálico (§7.57, antes condicional a esInicio,
                      dorado en el resto — el dorado se retiró de todo el
                      portal cliente). Si la ruta actual ya es Inicio, se
                      muestra sola (sin "|" ni segunda migaja, sería
                      redundante). Misma animación de deslizamiento que usa
                      Header.jsx en el POS (`.animate-deslizar-pestana`).
                      !menuAbierto (§7.56): con el drawer móvil abierto,
                      la migaja se ocultaba detrás pero seguía ahí — a
                      pedido del usuario, se esconde mientras el drawer
                      está abierto y vuelve a aparecer sola al cerrarlo
                      (mismo estado `menuAbierto` que ya maneja el botón
                      de hamburguesa, sin agregar estado nuevo). */}
                  {(esInicio || migajas.length > 0) && !menuAbierto && (
                    <nav
                      aria-label="Ubicación actual"
                      className="absolute left-0 top-full mt-3 flex items-center gap-2 whitespace-nowrap text-xs font-medium max-lg:left-[-36px]"
                    >
                      <Link
                        to="/inicio"
                        className={`shrink-0 transition-colors ${esInicio ? 'lw-metal-azul-texto' : 'text-white/60 hover:text-white'}`}
                      >
                        Inicio
                      </Link>
                      {migajas.map((migaja, indice) => {
                        const esUltima = indice === migajas.length - 1
                        return (
                          <span key={migaja.ruta} className="flex min-w-0 items-center gap-2">
                            <span aria-hidden="true" className="lw-metal-azul-texto shrink-0">
                              |
                            </span>
                            {esUltima ? (
                              <span
                                key={location.pathname}
                                className="animate-deslizar-pestana lw-metal-azul-texto truncate"
                              >
                                {migaja.titulo}
                              </span>
                            ) : (
                              <Link
                                to={migaja.ruta}
                                className="shrink-0 truncate text-white/60 transition-colors hover:text-white"
                              >
                                {migaja.titulo}
                              </Link>
                            )}
                          </span>
                        )
                      })}
                    </nav>
                  )}
                </div>
  
                {/* Íconos/texto libres, sin caja — solo desktop: en móvil las
                    pestañas viven adentro del drawer (MenuLateralCliente).
                    Pegado al logo (orden pedido por el usuario: menú, logo,
                    pestañas, ..., carrito, avatar), sin íconos por pestaña.
                    El borde de abajo usa un solo origen (origin-left) para
                    las dos animaciones: entrada = scale-x 0→1 (crece de la
                    esquina izquierda hacia la derecha, con el borde
                    izquierdo fijo); salida = scale-x 1→0 (encoge de vuelta
                    hacia ese mismo borde izquierdo — visualmente el lado
                    derecho retrocede primero, así que "se achica de
                    derecha a izquierda"), sin cambiar el origen entre una
                    animación y otra. */}
                <nav className="hidden items-center gap-6 lg:ml-2 lg:flex">
                  {seccionesCliente.map((seccion) => (
                    <NavLink key={seccion.path} to={seccion.path} className="relative py-1">
                      {({ isActive }) => (
                        <>
                          <span
                            className={`whitespace-nowrap text-[15px] font-semibold transition-colors ${
                              isActive ? 'lw-metal-azul-texto' : 'text-white/60 hover:text-white'
                            }`}
                          >
                            {seccion.label}
                          </span>
                          {/* Subrayado en el degradado real (background, no
                              color/border-color — por eso va por `style`,
                              no por --lw-gold): azul metálico siempre
                              desde §7.57, antes solo en Inicio. */}
                          <span
                            aria-hidden="true"
                            className={`absolute -bottom-1 left-0 h-[2px] w-full origin-left transition-transform duration-300 ease-out ${
                              isActive ? 'scale-x-100' : 'scale-x-0'
                            }`}
                            style={{ background: 'var(--lw-metal-azul)' }}
                          />
                        </>
                      )}
                    </NavLink>
                  ))}
                </nav>
  
                <div className="flex-1" />
  
                <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                  <BotonChanchito estaEnPuntos={location.pathname === '/mis-puntos'} />
  
                  <BotonCarrito estaEnCarrito={location.pathname === '/carrito'} />
  
                  <MenuUsuarioCliente />
                </div>
              </div>
            </header>

            {/* pt-12/72px SIEMPRE (§7.51, antes se saltaba en /inicio
                desde §7.37): el header ahora tiene fondo sólido (ver su
                comentario arriba), así que ya no tiene sentido que el
                hero de Inicio arranque detrás de él — con header opaco,
                "detrás" es "tapado". Todas las rutas, Inicio incluida,
                reservan este espacio otra vez, igual que el resto de la
                Web.
                pt-12, no pt-16 (§7.52): tiene que calzar EXACTO con el
                alto real del <header> en cada breakpoint (`h-12
                sm:h-[72px]` de arriba) — con `pt-16` (64px) en celular
                sobraban 16px de hueco vacío del mismo color que el
                header, dando la sensación de un header más alto/ancho
                de lo que realmente es (bug reportado). Si el `h-*` del
                <header> cambia, este valor hay que actualizarlo junto
                (no hay forma de derivarlo solo sin tocar el <header>). */}
            <div
              className="relative flex flex-1 flex-col overflow-hidden pt-12 sm:pt-[72px]"
            >
              <main className="flex flex-1 flex-col overflow-hidden">
                <Outlet />
              </main>
              <MenuLateralCliente abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
            </div>
          </div>
        </NotificacionesClienteProvider>
      </CarritoClienteProvider>
    </PerfilClienteProvider>
  )
}
