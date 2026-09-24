import { Menu, PiggyBank, ShoppingCart, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { PerfilClienteProvider } from '../context/PerfilClienteContext.jsx'
import { CarritoClienteProvider, useCarritoCliente } from '../context/CarritoClienteContext.jsx'
import { NotificacionesClienteProvider } from '../context/NotificacionesClienteContext.jsx'
import { seccionesCliente, titulosSubpaginasCliente } from '../config/navegacionCliente.js'
import MenuUsuarioCliente from '../components/MenuUsuarioCliente.jsx'
import MenuLateralCliente from '../components/MenuLateralCliente.jsx'

// Ícono de puntos (header) — ya no es un placeholder inerte: lleva a
// '/mis-puntos' (ver implementacionesWed.md §7.15), la tarjeta con el
// nivel real del cliente (Básico/Premium/VIP, calculado en el servidor
// por mis_puntos()). Las animaciones de la referencia del usuario
// (rebote al sumar, brillo pulsante al llenarse, moneda cayendo,
// destellos, "+N" flotante) siguen portadas en index.css
// (`.chanchito-*`) para cuando el ícono del header también reaccione en
// vivo a sumar puntos — hoy solo usa `.icono-chanchito` en reposo.
function BotonChanchito() {
  return (
    <Link
      to="/mis-puntos"
      aria-label="Tus puntos"
      className="flex h-11 w-11 items-center justify-center text-white/80 transition-colors hover:text-white"
    >
      <PiggyBank className="icono-chanchito h-5 w-5" />
    </Link>
  )
}

// Botón del carrito (header) — subpágina propia ('/carrito', ver
// titulosSubpaginasCliente), no una de las pestañas principales. La
// insignia con la cantidad viene de CarritoClienteContext, compartido
// con ServiciosCliente/ProductosCliente para que se actualice sola al
// agregar/quitar algo, sin recargar la página.
function BotonCarrito() {
  const { totalItems } = useCarritoCliente()

  return (
    <Link
      to="/carrito"
      aria-label="Tu carrito"
      className="relative flex h-11 w-11 items-center justify-center text-white/80 transition-colors hover:text-white"
    >
      <ShoppingCart className="h-5 w-5" />
      {totalItems > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--lw-gold)] px-1 text-[10px] font-semibold text-black">
          {totalItems}
        </span>
      )}
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
  const [errorLogo, setErrorLogo] = useState(false)

  const esInicio = location.pathname === '/inicio'
  const migajas = esInicio ? [] : migajasDeRuta(location.pathname)

  return (
    <PerfilClienteProvider>
      <CarritoClienteProvider>
        <NotificacionesClienteProvider>
          <div className="landing-web flex h-svh flex-col">
            <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center px-4 sm:h-[72px] sm:px-6 md:px-8">
              <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMenuAbierto((valorAnterior) => !valorAnterior)}
                  aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
                  aria-expanded={menuAbierto}
                  className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-white/80 transition-colors hover:text-white lg:hidden"
                >
                  {menuAbierto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
  
                <Link to="/inicio" className="flex shrink-0 flex-col items-center leading-none">
                  {!errorLogo && (
                    <img
                      src={`${import.meta.env.BASE_URL}icon-192.png`}
                      alt=""
                      onError={() => setErrorLogo(true)}
                      className="h-6 w-6 shrink-0 rounded-full object-cover"
                    />
                  )}
                  <span className="mt-1 text-xs font-semibold text-white">Jaise</span>
                  <span className="text-[7px] font-medium uppercase tracking-wide text-white/50">
                    Beauty Academy
                  </span>
                </Link>
  
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
                            className={`whitespace-nowrap text-sm font-medium transition-colors ${
                              isActive ? 'text-[var(--lw-gold)]' : 'text-white/60 hover:text-white'
                            }`}
                          >
                            {seccion.label}
                          </span>
                          <span
                            aria-hidden="true"
                            className={`absolute -bottom-1 left-0 h-[2px] w-full origin-left bg-[var(--lw-gold)] transition-transform duration-300 ease-out ${
                              isActive ? 'scale-x-100' : 'scale-x-0'
                            }`}
                          />
                        </>
                      )}
                    </NavLink>
                  ))}
                </nav>
  
                <div className="flex-1" />
  
                <div className="flex shrink-0 items-center gap-1">
                  <BotonChanchito />
  
                  <BotonCarrito />
  
                  <MenuUsuarioCliente />
                </div>
              </div>
            </header>
  
            {(esInicio || migajas.length > 0) && (
              <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex px-4 sm:top-24 sm:px-6 md:px-8">
                <nav
                  aria-label="Ubicación actual"
                  className="pointer-events-auto mx-auto flex w-full max-w-[1400px] items-center gap-2 py-1 text-sm font-medium sm:py-1.5"
                >
                  <Link
                    to="/inicio"
                    className={`shrink-0 transition-colors ${esInicio ? 'text-white' : 'text-white/60 hover:text-white'}`}
                  >
                    Inicio
                  </Link>
                  {migajas.map((migaja, indice) => {
                    const esUltima = indice === migajas.length - 1
                    return (
                      <span key={migaja.ruta} className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className="shrink-0 text-[var(--lw-gold)]">
                          |
                        </span>
                        {esUltima ? (
                          <span
                            key={location.pathname}
                            className="animate-deslizar-pestana truncate text-white"
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
              </div>
            )}
  
            <div className="relative flex flex-1 flex-col overflow-hidden pt-16 sm:pt-[72px]">
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
