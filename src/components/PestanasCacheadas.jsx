import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones, rutaInicialPara } from '../config/navegacion.js'
import Ventas from '../pages/Ventas.jsx'
import LimiteCargaDiferida from './LimiteCargaDiferida.jsx'
import { componenteDiferido } from '../lib/moduloDiferido.js'
import { PaginaActivaContext, ProteccionPantallaContext } from '../context/PaginaActivaContext.jsx'
import { fijarIdentidadVista, reiniciarEstadoVista } from '../lib/estadoVista.js'
import { alLiberarFormulario, formularioEditado, formularioEnviado, tieneFormulariosSinConfirmar } from '../lib/formulariosProtegidos.js'

// Ventas queda con import normal (no lazy): es la pestaña de aterrizaje de
// TODOS los usuarios (index redirige ahí), así que no vale la pena pagar una
// ida y vuelta de red extra solo para achicar el bundle inicial. Las demás
// —sobre todo las 7 exclusivas de admin— sí se cargan aparte (import()): una
// asistente nunca llega a pedir ese código, y el admin lo pide recién cuando
// entra a esa pestaña, no todo junto al abrir la app.
//
// Fase 8 V2 (F8-01): desde que el precaché de la PWA ya no incluye el POS, esas pantallas pueden no estar en el dispositivo.
// Por eso (1) cada una es un componenteDiferido (lib/moduloDiferido.js): reintentable, y con un límite de error LOCAL
// (LimiteCargaDiferida) que deja el fallo en su pestaña sin desmontar Layout ni la venta en curso; y (2) al entrar al POS,
// en reposo, se precargan las pantallas que el rol puede abrir (ver precargarPantallasDelRol): quedan evaluadas en memoria
// (abrirlas después no necesita red ni los archivos del servidor, aunque se haya publicado otra versión) y en la caché por
// uso del service worker (sobreviven a una recarga de la misma versión).
const Citas = componenteDiferido(() => import('../pages/Citas.jsx'), 'Citas')
const Inventario = componenteDiferido(() => import('../pages/Inventario.jsx'), 'Inventario')
const Historial = componenteDiferido(() => import('../pages/Historial.jsx'), 'Historial')
const Servicios = componenteDiferido(() => import('../pages/Servicios.jsx'), 'Servicios')
const Dashboard = componenteDiferido(() => import('../pages/Dashboard.jsx'), 'Dashboard')
const MiPanel = componenteDiferido(() => import('../pages/MiPanel.jsx'), 'MiPanel')
const Estadisticas = componenteDiferido(() => import('../pages/Estadisticas.jsx'), 'Estadisticas')
const Auditoria = componenteDiferido(() => import('../pages/Auditoria.jsx'), 'Auditoria')
const Clientes = componenteDiferido(() => import('../pages/Clientes.jsx'), 'Clientes')
const Porcentajes = componenteDiferido(() => import('../pages/Porcentajes.jsx'), 'Porcentajes')
const Gastos = componenteDiferido(() => import('../pages/Gastos.jsx'), 'Gastos')
const Asistentes = componenteDiferido(() => import('../pages/Asistentes.jsx'), 'Asistentes')
const Mobiliario = componenteDiferido(() => import('../pages/Mobiliario.jsx'), 'Mobiliario')
const Chanchito = componenteDiferido(() => import('../pages/Chanchito.jsx'), 'Chanchito')
const Web = componenteDiferido(() => import('../pages/Web.jsx'), 'Web')
const Deudas = componenteDiferido(() => import('../pages/Deudas.jsx'), 'Deudas')
const Promociones = componenteDiferido(() => import('../pages/Promociones.jsx'), 'Promociones')
const PedidosWeb = componenteDiferido(() => import('../pages/PedidosWeb.jsx'), 'PedidosWeb')
const ResenasWeb = componenteDiferido(() => import('../pages/ResenasWeb.jsx'), 'ResenasWeb')
const ContactoWeb = componenteDiferido(() => import('../pages/ContactoWeb.jsx'), 'ContactoWeb')
const PuntosWeb = componenteDiferido(() => import('../pages/PuntosWeb.jsx'), 'PuntosWeb')
const ReferidosWeb = componenteDiferido(() => import('../pages/ReferidosWeb.jsx'), 'ReferidosWeb')
const FidelizacionWeb = componenteDiferido(() => import('../pages/FidelizacionWeb.jsx'), 'FidelizacionWeb')
const RecompensasWeb = componenteDiferido(() => import('../pages/RecompensasWeb.jsx'), 'RecompensasWeb')
const GaleriaWeb = componenteDiferido(() => import('../pages/GaleriaWeb.jsx'), 'GaleriaWeb')
const CatalogoWeb = componenteDiferido(() => import('../pages/CatalogoWeb.jsx'), 'CatalogoWeb')
const LibroReclamacionesWeb = componenteDiferido(() => import('../pages/LibroReclamacionesWeb.jsx'), 'LibroReclamacionesWeb')

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
  '/chanchito': Chanchito,
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

// Fase 8 V2 (F8-01): en reposo y de a una, se descargan Y evalúan las pantallas que este rol puede abrir (no el escáner de
// Ventas: 480 kB que no hacen falta para terminar una venta; si falla se avisa en su ventana). Así, si luego se corta la red o
// se publica una versión nueva que retira los archivos de la abierta, cambiar de pestaña sigue funcionando con el código que ya
// está en memoria. Una precarga fallida no deja nada roto: la pantalla se vuelve a pedir al abrirla.
function precargarPantallasDelRol(rol) {
  const cola = secciones.filter((s) => puedeVer(s, rol)).map((s) => PAGINAS[s.path]).filter((Pagina) => Pagina?.precargar)
  let cancelada = false
  let espera = null
  const conReposo = typeof window.requestIdleCallback === 'function'
  const programar = () => {
    espera = conReposo ? window.requestIdleCallback(siguiente, { timeout: 4000 }) : window.setTimeout(siguiente, 300)
  }
  function siguiente() {
    espera = null
    if (cancelada || cola.length === 0) return
    cola.shift().precargar().finally(() => !cancelada && programar())
  }
  programar()
  return () => {
    cancelada = true
    if (espera !== null) (conReposo ? window.cancelIdleCallback : window.clearTimeout)(espera)
  }
}

function PantallaCacheada({ ruta, activa, Pagina, proteger, volver }) {
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
          {/* F8-01: si su código no llega, el error queda en ESTA pestaña (Layout, menú y venta en curso siguen montados). */}
          <LimiteCargaDiferida activa={activa} onReintentar={Pagina.reintentar} volver={volver}>
            <Suspense fallback={<CargandoPagina />}>
              <Pagina activo={activa} />
            </Suspense>
          </LimiteCargaDiferida>
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

  // F8-01: precarga en reposo de las pantallas del rol (se cancela si cambia la cuenta o el rol: la `key` desmonta esto).
  useEffect(() => precargarPantallasDelRol(rol), [rol])

  if (!seccion || !permitido) {
    // Bug real corregido: esto redirigía siempre a "/ventas" a mano, así
    // que una ASISTENTE (sin acceso a Ventas) caía en un loop mudo —
    // pantalla negra permanente, sin ningún contenido. Ahora manda a la
    // primera pestaña que el rol actual sí puede ver.
    return <Navigate to={rutaInicialPara(rol)} replace />
  }

  // La pestaña actual se monta en este mismo render aunque `montadas` se actualice después del efecto.
  const aRenderizar = montadas.includes(pathname) ? montadas : [...montadas, pathname]
  // Salida segura desde una pestaña que no pudo abrirse: la pantalla inicial del rol (Ventas para administración y caja).
  const inicial = secciones.find((s) => s.path === rutaInicialPara(rol))
  return (
    <>
      <span ref={centinela} hidden />
      {aRenderizar.map((ruta) => {
        const Pagina = PAGINAS[ruta]
        if (!Pagina) return null
        const volver = inicial && inicial.path !== ruta ? { a: inicial.path, etiqueta: inicial.label } : undefined
        return <PantallaCacheada key={ruta} ruta={ruta} activa={ruta === pathname} Pagina={Pagina} proteger={proteger} volver={volver} />
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
