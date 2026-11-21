import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { Plus, MessageCircle, Users, Filter, ArrowRight } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { numeroWhatsapp } from '../lib/contactoNegocio.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { useEncabezadoTablaPegado } from '../hooks/useEncabezadoTablaPegado.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalCliente from '../components/ModalCliente.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import PerfilCliente from '../components/clientes/PerfilCliente.jsx'
import { AvatarCliente, CapsulaTipoCliente } from '../components/clientes/PiezasPerfil.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import { edad } from '../lib/edad.js'

// Datos que suman a la barra de "datos completos": ocasionales como notas
// no cuentan (casi nadie los llena y no dice nada de qué tan bien se conoce
// al cliente); dirección sí, porque hace falta para delivery a futuro.
const CAMPOS_OPCIONALES = ['telefono', 'cumpleanos', 'direccion']

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'completitud-asc', label: 'Datos completos (menor a mayor)' },
  { id: 'completitud-desc', label: 'Datos completos (mayor a menor)' },
  // Por edad: lo ordena el servidor por fecha de cumpleaños (así «Cargar más» sigue el mismo orden); quienes no tienen
  // cumpleaños van al final. «Sin cumpleaños» además filtra: muestra solo a quienes no lo tienen registrado.
  { id: 'edad-asc', label: 'Edad (menor a mayor)' },
  { id: 'edad-desc', label: 'Edad (mayor a menor)' },
  { id: 'sin-cumpleanos', label: 'Sin cumpleaños registrado' },
]

const OPCIONES_SEXO = [
  { id: 'todos', label: 'Todos' },
  { id: 'Femenino', label: 'Femenino' },
  { id: 'Masculino', label: 'Masculino' },
]

const TAMANO_PAGINA = 50
// clientes_web(direcciones_cliente(...)) — un cliente Web puede guardar
// varias direcciones (ver implementacionesWed.md §7.17/§7.18); se
// embeben anidadas bajo clientes_web porque esa es la tabla con la que
// direcciones_cliente tiene la FK real (cliente_web_id), no "clientes"
// directamente. Un cliente cargado a mano (sin cuenta Web) no trae nada
// acá — para esos se sigue mostrando la columna `direccion` de siempre.
// Se lee de la vista `clientes_admin`: dirección, notas y DNI ya no se pueden leer de la tabla `clientes`
// (privilegio mínimo, migración 20261120000004); conteos y borrados siguen yendo a la tabla.
const SELECT_CLIENTES =
  'id, nombre, telefono, sexo, direccion, cumpleanos, notas, foto_url, cliente_web_id, ' +
  'clientes_web(email, direcciones_cliente(id, etiqueta, direccion, referencia, predeterminada))'

// "Datos completos" no se puede pedir ordenado al servidor (no es una
// columna, se calcula acá) — se sigue reordenando en el cliente sobre lo que
// ya está cargado. A diferencia de la búsqueda, un orden que solo reordena
// (no oculta filas) es seguro de dejar así con paginación: "Cargar más" trae
// el resto y el orden se recalcula sobre el total cargado hasta ese momento.
function ordenarClientes(clientes, orden) {
  if (orden === 'completitud-asc') return [...clientes].sort((a, b) => completitud(a) - completitud(b))
  if (orden === 'completitud-desc') return [...clientes].sort((a, b) => completitud(b) - completitud(a))
  return clientes
}

// Quita caracteres que rompen la sintaxis del filtro .or() de PostgREST.
function terminoSeguro(texto) {
  return texto.replace(/[%,()]/g, '')
}

// Compartido entre construirConsultaClientes (trae filas) y el conteo
// del header (B3 de la 2ª auditoría: antes usaba el total global de la
// tabla incluso con una búsqueda activa — "Clientes: 200" con 3 resultados
// visibles confundía).
function aplicarFiltroBusqueda(consulta, busqueda) {
  const termino = terminoSeguro(busqueda.trim())
  return termino ? consulta.or(`nombre.ilike.%${termino}%,telefono.ilike.%${termino}%`) : consulta
}

function aplicarFiltroSexo(consulta, sexo) {
  return sexo === 'todos' ? consulta : consulta.eq('sexo', sexo)
}

function aplicarFiltroCumpleanos(consulta, orden) {
  return orden === 'sin-cumpleanos' ? consulta.is('cumpleanos', null) : consulta
}

function construirConsultaClientes({ busqueda, orden, sexo }) {
  let consulta = aplicarFiltroBusqueda(supabase.from('clientes_admin').select(SELECT_CLIENTES), busqueda)
  consulta = aplicarFiltroCumpleanos(aplicarFiltroSexo(consulta, sexo), orden)
  // Menor a mayor = cumpleaños más reciente primero. El nombre queda como desempate.
  if (orden === 'edad-asc') consulta = consulta.order('cumpleanos', { ascending: false, nullsFirst: false })
  if (orden === 'edad-desc') consulta = consulta.order('cumpleanos', { ascending: true, nullsFirst: false })
  return consulta.order('nombre', { ascending: orden !== 'nombre-desc' })
}

// Un cliente Web "tiene dirección" si guardó al menos una en la pestaña
// Direcciones (§7.17) — la columna `direccion` sola ya no basta para
// saberlo, esa solo se sigue llenando para clientes cargados a mano.
function tieneDireccion(cliente) {
  return Boolean(cliente.direccion) || (cliente.clientes_web?.direcciones_cliente?.length ?? 0) > 0
}

function completitud(cliente) {
  const otrosLlenos = CAMPOS_OPCIONALES.filter((campo) => campo !== 'direccion' && cliente[campo]).length
  const llenos = otrosLlenos + (tieneDireccion(cliente) ? 1 : 0)
  return Math.round((llenos / CAMPOS_OPCIONALES.length) * 100)
}

function coloresCompletitud(porcentaje) {
  if (porcentaje === 100) return { barra: 'bg-green', texto: 'text-green' }
  if (porcentaje >= 50) return { barra: 'bg-purple-300', texto: 'text-purple-300' }
  return { barra: 'bg-ink/30', texto: 'text-ink/60' }
}

function BarraCompletitud({ porcentaje, colores }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-2.5 text-xs lg:pb-3 text-ink/60">
      <span className="shrink-0">Datos completos</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${colores.barra}`}
          style={{ width: `${porcentaje}%` }}
        />
      </div>
      <span className={`shrink-0 font-mono font-medium ${colores.texto}`}>{porcentaje}%</span>
    </div>
  )
}

export default function Clientes({ activo = true }) {
  const { mostrarToast } = useToast()

  const [clientes, setClientes] = useState([])
  const [totalClientes, setTotalClientes] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/clientes:busqueda', '')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [orden, setOrden] = useEstadoVista('/clientes:orden', 'nombre-asc')
  const [filtroSexo, setFiltroSexo] = useEstadoVista('/clientes:filtroSexo', 'todos')
  const [modalCliente, setModalCliente] = useState(null) // null | 'nuevo' | cliente
  const [clienteAEliminar, setClienteAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  // Perfil abierto: `?cliente=<id>` en la URL (el botón Atrás del navegador vuelve a la lista y el enlace se puede
  // recargar). PestanasCacheadas solo reconoce rutas exactas, así que el perfil vive DENTRO de /clientes: la lista
  // queda montada y oculta debajo (conserva lo cargado). Mientras esta pestaña está oculta la URL es la de otra
  // pestaña: el valor se congela y solo se vuelve a leer al estar activa.
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const parametroCliente = searchParams.get('cliente')
  // Solo si arranca activa: otra pestaña también puede usar `?cliente=` (Deudas filtrada a una clienta).
  const [clienteAbiertoId, setClienteAbiertoId] = useState(activo ? parametroCliente : null)
  const [versionPerfil, setVersionPerfil] = useState(0)
  const raizRef = useRef(null)
  const scrollListaRef = useRef(0)
  const perfilAnteriorRef = useRef(clienteAbiertoId)
  const { barraRef, encabezadoRef, claseTh, estiloTh } = useEncabezadoTablaPegado([clientes, cargando, clienteAbiertoId])
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasClientes descarte una respuesta que llega tarde de una
  // búsqueda/orden que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })
  const panelEliminarRef = useRef(null)

  useCerrarConEscape(() => setClienteAEliminar(null), Boolean(clienteAEliminar))
  useModalA11y(panelEliminarRef, Boolean(clienteAEliminar))

  useEffect(() => {
    if (activo) setClienteAbiertoId(parametroCliente)
  }, [activo, parametroCliente])

  // Al abrir un perfil se guarda dónde estaba la lista y se sube al inicio; al volver se recupera esa posición.
  useLayoutEffect(() => {
    const anterior = perfilAnteriorRef.current
    perfilAnteriorRef.current = clienteAbiertoId
    if (anterior === clienteAbiertoId) return
    const main = raizRef.current?.closest('main')
    if (!main) return
    if (!anterior) scrollListaRef.current = main.scrollTop
    main.scrollTop = clienteAbiertoId ? 0 : scrollListaRef.current
  }, [clienteAbiertoId])

  // Cada perfil abierto desde aquí suma una entrada al historial (con su profundidad en `state`): «← Clientes» retrocede
  // todas de una vez, así el Atrás del navegador no vuelve a pasar por los perfiles. Si el perfil se abrió desde un
  // enlace o al recargar (sin profundidad), se reemplaza la entrada.
  function abrirPerfil(id) {
    const profundidad = (location.state?.profundidadPerfil ?? 0) + 1
    setSearchParams({ cliente: id }, { state: { profundidadPerfil: profundidad } })
  }

  function volverALista() {
    const profundidad = location.state?.profundidadPerfil ?? 0
    if (profundidad > 0) navigate(-profundidad)
    else setSearchParams({}, { replace: true })
  }

  async function cargarClientes(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const filtros = { busqueda: busquedaDebounced, orden, sexo: filtroSexo }
    // Una recarga silenciosa (tras guardar/eliminar) conserva las filas ya cargadas con «Cargar más»: si se recortara a la
    // primera página, la lista encogería y el scroll saltaría.
    const hasta = silencioso ? Math.min(Math.max(clientes.length, TAMANO_PAGINA), 1000) : TAMANO_PAGINA

    const [clientesRes, totalRes] = await Promise.all([
      construirConsultaClientes(filtros).range(0, hasta - 1),
      aplicarFiltroCumpleanos(
        aplicarFiltroSexo(
          aplicarFiltroBusqueda(
            supabase.from('clientes').select('id', { count: 'exact', head: true }),
            busquedaDebounced,
          ),
          filtroSexo,
        ),
        orden,
      ),
    ])

    if (!vigente.actual) return

    if (clientesRes.error) {
      setError('No se pudo cargar el directorio de clientes.')
      setClientes([])
      setCargando(false)
      return
    }

    setError(null)
    setClientes(clientesRes.data ?? [])
    setHayMas((clientesRes.data ?? []).length === hasta)
    if (!totalRes.error) setTotalClientes(totalRes.count ?? 0)
    setCargando(false)
  }

  async function cargarMasClientes() {
    if (cargandoMas || !hayMas) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const filtros = { busqueda: busquedaDebounced, orden, sexo: filtroSexo }

    const { data, error: errorMas } = await construirConsultaClientes(filtros).range(
      clientes.length,
      clientes.length + TAMANO_PAGINA - 1,
    )

    setCargandoMas(false)
    if (!vigente.actual) return

    if (errorMas) {
      mostrarToast('No se pudieron cargar más clientes.', 'error')
      return
    }

    setClientes((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA)
  }

  // useEffectEvent: el efecto corre solo cuando cambian sus dependencias, pero llama a la versión más reciente
  // de cargarClientes (lee los filtros actuales) sin volver a dispararse cada vez que esa función se recrea.
  const cargarDesdeEfecto = useEffectEvent((vigente, silencioso) => cargarClientes(vigente, silencioso))
  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDesdeEfecto(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, orden, filtroSexo])

  async function confirmarEliminar() {
    if (!clienteAEliminar) return

    setEliminando(true)
    const { error: errorEliminar } = await supabase
      .from('clientes')
      .delete()
      .eq('id', clienteAEliminar.id)
    setEliminando(false)
    setClienteAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar el cliente.', 'error')
      return
    }

    mostrarToast('Cliente eliminado.', 'exito')
    if (clienteAEliminar.id === clienteAbiertoId) volverALista()
    cargarClientes(vigenteRef.current, true)
  }

  const clientesOrdenados = ordenarClientes(clientes, orden)

  const botonWhatsapp = (cliente) =>
    cliente.telefono ? (
      <span onClick={(evento) => evento.stopPropagation()} onKeyDown={(evento) => evento.stopPropagation()}>
        <BotonAccion
          icono={MessageCircle}
          texto="WhatsApp"
          color="verde"
          href={`https://wa.me/${numeroWhatsapp(cliente.telefono)}`}
          target="_blank"
          rel="noopener noreferrer"
          sinBorde
        />
      </span>
    ) : null

  return (
    <div
      ref={raizRef}
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {clienteAbiertoId && (
        <PerfilCliente
          key={clienteAbiertoId}
          clienteId={clienteAbiertoId}
          version={versionPerfil}
          onVolver={volverALista}
          onEditar={(cliente) => setModalCliente(cliente)}
          onEliminar={(cliente) => setClienteAEliminar(cliente)}
          onAbrirCliente={abrirPerfil}
        />
      )}

      {/* La lista sigue montada (oculta) mientras se ve un perfil: al volver conserva lo cargado. */}
      <div className={clienteAbiertoId ? 'hidden' : undefined}>
        {/* Buscador + Nuevo cliente: fijos arriba al hacer scroll, siempre debajo del header */}
        <div
          ref={barraRef}
          className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)"
        >
          <BarraBusqueda
            valor={busqueda}
            onCambiar={setBusqueda}
            placeholder="Buscar por nombre o teléfono..."
            tema="purple-300"
            sinBorde
          />

          <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" sinBorde />

          <SelectorOrden
            opciones={OPCIONES_SEXO}
            valor={filtroSexo}
            onCambiar={setFiltroSexo}
            tema="purple-300"
            icono={Filter}
            ariaLabel="Filtrar por sexo"
            sinBorde
          />

          <button
            type="button"
            onClick={() => setModalCliente('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo cliente</span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-ink/60">
            Clientes: <span className="font-mono font-semibold text-purple-300">{totalClientes}</span>
          </p>
          <Link
            to="/deudas"
            className="inline-flex items-center gap-1 text-sm text-purple-300 transition-colors hover:text-purple-200"
          >
            Ver deudas
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
            {error}
          </p>
        )}

        {cargando ? (
          <EsqueletoLista columnas={5} />
        ) : clientesOrdenados.length === 0 ? (
          <EstadoVacio
            icono={Users}
            mensaje="No se encontraron clientes."
            accion={{ label: '+ Nuevo cliente', onClick: () => setModalCliente('nuevo') }}
            tema="purple-300"
          />
        ) : (
          <>
            {/* Celular: tarjeta simple; tocarla abre el perfil. */}
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:hidden">
              {clientesOrdenados.map((cliente) => {
                const porcentaje = completitud(cliente)
                return (
                  <div
                    key={cliente.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => abrirPerfil(cliente.id)}
                    onKeyDown={manejarActivacionTeclado(() => abrirPerfil(cliente.id))}
                    className="cursor-pointer touch-manipulation rounded-lg border border-border bg-surface transition-colors hover:border-purple-300/40"
                  >
                    <div className="flex items-center gap-3 px-3 pb-1 pt-2">
                      <AvatarCliente cliente={cliente} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{cliente.nombre}</p>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                          <CapsulaTipoCliente web={Boolean(cliente.cliente_web_id)} />
                          {cliente.telefono && (
                            <span className="truncate font-mono text-xs text-ink/60">{cliente.telefono}</span>
                          )}
                        </div>
                      </div>
                      {botonWhatsapp(cliente)}
                      <ArrowRight className="h-4 w-4 shrink-0 text-ink/40" />
                    </div>
                    <BarraCompletitud porcentaje={porcentaje} colores={coloresCompletitud(porcentaje)} />
                  </div>
                )
              })}
            </div>

            {/* PC: tabla; clic en la fila abre el perfil. */}
            <div className="mt-4 hidden overflow-x-clip border-y border-border lg:block">
              <table className="w-full text-left text-sm">
                <thead ref={encabezadoRef}>
                  <tr className="font-mono text-xs uppercase tracking-wider text-ink/60">
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Nombre del cliente</th>
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Edad</th>
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Tipo de cliente</th>
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Celular / WhatsApp</th>
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Correo electrónico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {clientesOrdenados.map((cliente) => (
                    <tr
                      key={cliente.id}
                      tabIndex={0}
                      onClick={() => abrirPerfil(cliente.id)}
                      onKeyDown={manejarActivacionTeclado(() => abrirPerfil(cliente.id))}
                      className="cursor-pointer touch-manipulation bg-tabla hover:bg-surface-2/60"
                    >
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <AvatarCliente cliente={cliente} tamano="sm" />
                          <span className="min-w-0 truncate text-ink">{cliente.nombre}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-ink/80">
                        {edad(cliente.cumpleanos) != null ? (
                          `${edad(cliente.cumpleanos)} ${edad(cliente.cumpleanos) === 1 ? 'año' : 'años'}`
                        ) : (
                          <span className="font-sans text-ink/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <CapsulaTipoCliente web={Boolean(cliente.cliente_web_id)} />
                      </td>
                      <td className="px-3 py-2">
                        {cliente.telefono ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-ink/80">{cliente.telefono}</span>
                            {botonWhatsapp(cliente)}
                          </div>
                        ) : (
                          <span className="text-ink/40">—</span>
                        )}
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-ink/70">
                        {cliente.clientes_web?.email || <span className="font-sans text-ink/40">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {hayMas && (
          <button
            type="button"
            onClick={cargarMasClientes}
            disabled={cargandoMas}
            className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            {cargandoMas ? 'Cargando...' : 'Cargar más'}
          </button>
        )}
      </div>

      {!clienteAbiertoId && (
        <BotonFlotanteAgregar onClick={() => setModalCliente('nuevo')} color="morado" label="Nuevo cliente" />
      )}

      {modalCliente && (
        <ModalCliente
          cliente={modalCliente === 'nuevo' ? null : modalCliente}
          onCerrar={() => setModalCliente(null)}
          onGuardado={() => {
            const esNuevo = modalCliente === 'nuevo'
            setModalCliente(null)
            mostrarToast(esNuevo ? 'Cliente creado.' : 'Cliente actualizado.', 'exito')
            if (!esNuevo) setVersionPerfil((v) => v + 1)
            cargarClientes(vigenteRef.current, true)
          }}
        />
      )}

      {clienteAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar a "{clienteAEliminar.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setClienteAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
