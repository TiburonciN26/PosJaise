import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones, rutaInicialPara } from '../config/navegacion.js'
import Ventas from '../pages/Ventas.jsx'
import { PaginaActivaContext, ProteccionPantallaContext } from '../context/PaginaActivaContext.jsx'
import { fijarIdentidadVista, reiniciarEstadoVista } from '../lib/estadoVista.js'
import { alLiberarFormulario, formularioEditado, formularioEnviado, tieneFormulariosSinConfirmar } from '../lib/formulariosProtegidos.js'

// Ventas queda con import normal (no lazy): es la pestaña de aterrizaje de
// TODOS los usuarios (index redirige ahí), así que no vale la pena pagar una
// ida y vuelta de red extra solo para achicar el bundle inicial. Las demás
// —sobre todo las 7 exclusivas de admin— sí van con React.lazy: una
// asistente nunca llega a pedir ese código, y el admin lo pide recién cuando
// entra a esa pestaña, no todo junto al abrir la app.
const Citas = lazy(() => import('../pages/Citas.jsx'))
const Inventario = lazy(() => import('../pages/Inventario.jsx'))
const Historial = lazy(() => import('../pages/Historial.jsx'))
const Servicios = lazy(() => import('../pages/Servicios.jsx'))
const Dashboard = lazy(() => import('../pages/Dashboard.jsx'))
const MiPanel = lazy(() => import('../pages/MiPanel.jsx'))
const Estadisticas = lazy(() => import('../pages/Estadisticas.jsx'))
const Auditoria = lazy(() => import('../pages/Auditoria.jsx'))
const Clientes = lazy(() => import('../pages/Clientes.jsx'))
const Porcentajes = lazy(() => import('../pages/Porcentajes.jsx'))
const Gastos = lazy(() => import('../pages/Gastos.jsx'))
const Asistentes = lazy(() => import('../pages/Asistentes.jsx'))
const Mobiliario = lazy(() => import('../pages/Mobiliario.jsx'))
const Web = lazy(() => import('../pages/Web.jsx'))
const Deudas = lazy(() => import('../pages/Deudas.jsx'))
const Promociones = lazy(() => import('../pages/Promociones.jsx'))
const PedidosWeb = lazy(() => import('../pages/PedidosWeb.jsx'))
const ResenasWeb = lazy(() => import('../pages/ResenasWeb.jsx'))
const ContactoWeb = lazy(() => import('../pages/ContactoWeb.jsx'))
const PuntosWeb = lazy(() => import('../pages/PuntosWeb.jsx'))
const ReferidosWeb = lazy(() => import('../pages/ReferidosWeb.jsx'))
const FidelizacionWeb = lazy(() => import('../pages/FidelizacionWeb.jsx'))
const RecompensasWeb = lazy(() => import('../pages/RecompensasWeb.jsx'))
const GaleriaWeb = lazy(() => import('../pages/GaleriaWeb.jsx'))
const CatalogoWeb = lazy(() => import('../pages/CatalogoWeb.jsx'))
const LibroReclamacionesWeb = lazy(() => import('../pages/LibroReclamacionesWeb.jsx'))

const PAGINAS = {
  '/ventas': Ventas,
  '/citas': Citas,
  '/inventario': Inventario,
  '/historial': Historial,
  '/servicios': Servicios,
  '/dashboard': Dashboard,
  '/mi-panel': MiPanel,
  '/estadisticas': Estadisticas,
  '/auditoria': Auditoria,
  '/clientes': Clientes,
  '/porcentajes': Porcentajes,
  '/gastos': Gastos,
  '/asistentes': Asistentes,
  '/mobiliario': Mobiliario,
  '/web': Web,
  '/deudas': Deudas,
  '/promociones': Promociones,
  '/pedidos-web': PedidosWeb,
  '/resenas-web': ResenasWeb,
  '/contacto-web': ContactoWeb,
  '/puntos-web': PuntosWeb,
  '/referidos-web': ReferidosWeb,
  '/fidelizacion-web': FidelizacionWeb,
  '/recompensas-web': RecompensasWeb,
  '/galeria-web': GaleriaWeb,
  '/catalogo-web': CatalogoWeb,
  '/libro-reclamaciones-web': LibroReclamacionesWeb,
}

function puedeVer(seccion, rol) {
  return Boolean(seccion) && seccion.roles.includes(rol)
}

function CargandoPagina() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="font-mono text-sm text-ink/60">Cargando...</p>
    </div>
  )
}

// ───────── Política de caché de pantallas (Fase 6) ─────────
// Cada pestaña visitada queda montada (oculta con display:none, no desmontada): volver a ella es instantáneo y conserva su
// estado. Pero conservar TODAS las visitadas en una sesión larga acumulaba hasta 27 pantallas (decenas de miles de nodos, escuchas
// y suscripciones). Política explícita:
//   · como máximo MAX_PANTALLAS_MONTADAS pantallas montadas (la visible + las más recientes);
//   · al superarlo se desmonta la MENOS recientemente usada que no esté protegida;
//   · una pantalla PROTEGIDA nunca se descarta: tiene un diálogo abierto (useCerrarConEscape → useProtegerPantalla), un formulario
//     editado cuyo guardado NO se ha confirmado, o declaró trabajo pendiente con useProtegerPantalla(). El tope es entonces «blando»:
//     se supera mientras haya trabajo sin terminar y se recorta apenas se libera. Un formulario editado deja de proteger cuando:
//       – su guardado se CONFIRMA de forma explícita (`confirmarGuardado(envio)`, lib/formulariosProtegidos.js: el token nombra el
//         formulario y el intento, así que un éxito de otro flujo no lo libera); un envío rechazado por validación, con error o aún
//         en vuelo NO lo suelta, ni una respuesta de un intento anterior si ya se siguió editando;
//       – el formulario desaparece del DOM (un diálogo cancelado o cerrado); el registro lo guarda con WeakRef, así que no lo retiene;
//     y cada formulario cuenta por separado: enviar uno no suelta la protección de otro de la misma pantalla;
//   · lo que se conserva AUNQUE una pantalla se desmonte: el carrito y la venta en curso (CarritoProvider está por encima), los
//     filtros y búsquedas (useEstadoVista) y la posición de scroll de cada pantalla;
//   · al cambiar de cuenta o de rol TODO se invalida (la `key` desmonta las pantallas y se vacía el estado de vista).
export const MAX_PANTALLAS_MONTADAS = 6

function recortar(montadas, recencia, actual, protegida) {
  let resultado = montadas
  while (resultado.length > MAX_PANTALLAS_MONTADAS) {
    const candidata = recencia.find((ruta) => ruta !== actual && resultado.includes(ruta) && !protegida(ruta))
    if (!candidata) break
    resultado = resultado.filter((ruta) => ruta !== candidata)
  }
  return resultado
}

function PantallaCacheada({ ruta, activa, Pagina, proteger }) {
  const protegerAqui = useCallback((id, valor) => proteger(ruta, id, valor), [proteger, ruta])
  return (
    <div
      data-ruta={ruta}
      className={activa ? 'contents' : 'hidden'}
      // Un campo de un <form> editado protege la pantalla hasta que ese formulario se confirme o desaparezca.
      onInputCapture={(evento) => {
        const formulario = evento.target instanceof Element ? evento.target.closest('form') : null
        if (formulario) formularioEditado(ruta, formulario)
      }}
      // Enviar NO suelta nada por sí solo: solo marca el formulario como «enviado, esperando confirmación».
      onSubmitCapture={(evento) => {
        if (evento.target instanceof HTMLFormElement) formularioEnviado(evento.target)
      }}
    >
      <PaginaActivaContext.Provider value={activa}>
        <ProteccionPantallaContext.Provider value={protegerAqui}>
          <Suspense fallback={<CargandoPagina />}>
            <Pagina activo={activa} />
          </Suspense>
        </ProteccionPantallaContext.Provider>
      </PaginaActivaContext.Provider>
    </div>
  )
}

function Pantallas() {
  const { pathname } = useLocation()
  const { rol } = useAuth()
  const seccion = secciones.find((s) => s.path === pathname)
  const permitido = puedeVer(seccion, rol)

  const [montadas, setMontadas] = useState(() => (permitido ? [pathname] : []))
  const recencia = useRef(permitido ? [pathname] : []) // de la más antigua a la más reciente
  const razones = useRef(new Map()) // ruta → Set de razones de protección declaradas
  const [version, setVersion] = useState(0) // sube al liberar una protección para volver a evaluar el recorte
  const centinela = useRef(null)
  const scrollGuardado = useRef(new Map())
  const rutaVisible = useRef(pathname)

  // Un formulario protege mientras siga en el DOM y su guardado no se haya confirmado (los desmontados se olvidan aquí mismo).
  const protegida = useCallback((ruta) => tieneFormulariosSinConfirmar(ruta) || (razones.current.get(ruta)?.size ?? 0) > 0, [])

  const proteger = useCallback((ruta, id, valor) => {
    const conjunto = razones.current.get(ruta) ?? new Set()
    if (valor) conjunto.add(id)
    else conjunto.delete(id)
    razones.current.set(ruta, conjunto)
    if (!valor) setVersion((v) => v + 1)
  }, [])
  // Guardado confirmado de un formulario: se vuelve a evaluar el recorte.
  useEffect(() => alLiberarFormulario(() => setVersion((v) => v + 1)), [])

  // Registro de la pestaña actual y recorte de la caché.
  useEffect(() => {
    if (!permitido) return
    recencia.current = [...recencia.current.filter((r) => r !== pathname), pathname]
    setMontadas((anterior) => recortar(anterior.includes(pathname) ? anterior : [...anterior, pathname], recencia.current, pathname, protegida))
  }, [pathname, permitido, protegida])

  // Al liberarse una protección se vuelve a aplicar el tope.
  useEffect(() => {
    setMontadas((anterior) => recortar(anterior, recencia.current, pathname, protegida))
  }, [version, pathname, protegida])

  // Scroll por pantalla: el <main> es UNO solo para todas; se guarda su posición mientras una pantalla está visible y se restaura
  // al volver a ella (también si se desmontó y volvió a montarse y sus datos llegan después). Mientras se restaura NO se guardan los
  // eventos de scroll (el navegador recorta la posición cuando el contenido aún es corto y eso pisaría la posición guardada);
  // la restauración termina al alcanzarla, a los 3 s, o en cuanto la persona interactúa (rueda, toque, tecla, puntero).
  const restaurando = useRef(null)
  useEffect(() => {
    const main = centinela.current?.closest('main')
    if (!main) return undefined
    const alScroll = () => {
      if (restaurando.current !== null) return
      scrollGuardado.current.set(rutaVisible.current, main.scrollTop)
    }
    const alInteractuar = () => {
      restaurando.current = null
    }
    main.addEventListener('scroll', alScroll, { passive: true })
    for (const evento of ['wheel', 'touchstart', 'keydown', 'pointerdown']) main.addEventListener(evento, alInteractuar, { passive: true })
    return () => {
      main.removeEventListener('scroll', alScroll)
      for (const evento of ['wheel', 'touchstart', 'keydown', 'pointerdown']) main.removeEventListener(evento, alInteractuar)
    }
  }, [])
  useLayoutEffect(() => {
    const main = centinela.current?.closest('main')
    rutaVisible.current = pathname
    if (!main) return undefined
    const destino = scrollGuardado.current.get(pathname) ?? 0
    restaurando.current = destino > 0 ? destino : null
    main.scrollTop = destino
    if (destino <= 0) return undefined
    const limite = Date.now() + 3000
    const temporizador = setInterval(() => {
      if (restaurando.current === null || Date.now() > limite) {
        restaurando.current = null
        clearInterval(temporizador)
        return
      }
      main.scrollTop = destino
      if (Math.abs(main.scrollTop - destino) < 2) {
        restaurando.current = null
        clearInterval(temporizador)
      }
    }, 100)
    return () => {
      clearInterval(temporizador)
      restaurando.current = null
    }
  }, [pathname])

  // Al desmontar (cambio de cuenta / rol / salir del POS) se descarta también el estado de vista.
  useEffect(() => () => reiniciarEstadoVista(), [])

  if (!seccion || !permitido) {
    // Bug real corregido: esto redirigía siempre a "/ventas" a mano, así
    // que una ASISTENTE (sin acceso a Ventas) caía en un loop mudo —
    // pantalla negra permanente, sin ningún contenido. Ahora manda a la
    // primera pestaña que el rol actual sí puede ver.
    return <Navigate to={rutaInicialPara(rol)} replace />
  }

  // La pestaña actual se monta en este mismo render aunque `montadas` se actualice después del efecto.
  const aRenderizar = montadas.includes(pathname) ? montadas : [...montadas, pathname]
  return (
    <>
      <span ref={centinela} hidden />
      {aRenderizar.map((ruta) => {
        const Pagina = PAGINAS[ruta]
        if (!Pagina) return null
        return <PantallaCacheada key={ruta} ruta={ruta} activa={ruta === pathname} Pagina={Pagina} proteger={proteger} />
      })}
    </>
  )
}

// La `key` ata las pantallas a la cuenta Y al rol: si cambia cualquiera de los dos se desmontan todas (y se vacía el estado de
// vista), así el contenido protegido de una cuenta o de un rol anterior no queda en memoria ni a la vista.
export default function PestanasCacheadas() {
  const { usuario, rol } = useAuth()
  const identidad = `${usuario?.id ?? 'sin-cuenta'}:${rol ?? 'sin-rol'}`
  // Se declara en el render, antes de que se renderice cualquier pantalla: el almacén de vista queda vacío para la identidad nueva.
  fijarIdentidadVista(identidad)
  return <Pantallas key={identidad} />
}
