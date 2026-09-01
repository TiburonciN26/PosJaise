import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Trash2,
  Plus,
  Phone,
  Cake,
  Mail,
  MapPin,
  StickyNote,
  MessageCircle,
  ArrowBigDown,
  Users,
  Globe,
  Lock,
  Venus,
  Mars,
  Filter,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalCliente from '../components/ModalCliente.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

// Datos que suman a la barra de "datos completos": ocasionales como notas
// no cuentan (casi nadie los llena y no dice nada de qué tan bien se conoce
// al cliente); dirección sí, porque hace falta para delivery a futuro.
const CAMPOS_OPCIONALES = ['telefono', 'cumpleanos', 'direccion']

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'completitud-asc', label: 'Datos completos (menor a mayor)' },
  { id: 'completitud-desc', label: 'Datos completos (mayor a menor)' },
]

const OPCIONES_SEXO = [
  { id: 'todos', label: 'Todos' },
  { id: 'Femenino', label: 'Femenino' },
  { id: 'Masculino', label: 'Masculino' },
]

const TAMANO_PAGINA = 50
const BUCKET_FOTOS_CLIENTES = 'fotos-clientes'
const SELECT_CLIENTES =
  'id, nombre, telefono, sexo, direccion, cumpleanos, notas, foto_url, cliente_web_id, clientes_web(email)'

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

function construirConsultaClientes({ busqueda, orden, sexo }) {
  let consulta = aplicarFiltroBusqueda(supabase.from('clientes').select(SELECT_CLIENTES), busqueda)
  consulta = aplicarFiltroSexo(consulta, sexo)
  return consulta.order('nombre', { ascending: orden !== 'nombre-desc' })
}

function formatearFecha(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

function numeroWhatsapp(telefono) {
  const digitos = telefono.replace(/\D/g, '')
  return digitos.length === 9 ? `51${digitos}` : digitos
}

function iniciales(nombre) {
  const partes = nombre.trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

// Solo los clientes que se registraron por la Web tienen foto (la suben
// ellos desde Mi Perfil, ver 63_mi_perfil_cliente.sql) — un manual
// siempre cae al círculo de iniciales de siempre. Estado de error propio
// por tarjeta (no uno global): si la foto de un cliente no carga, no debe
// tumbar la de los demás.
function AvatarCliente({ cliente }) {
  const [errorFoto, setErrorFoto] = useState(false)
  const urlFoto = !errorFoto ? urlPublicaFoto(BUCKET_FOTOS_CLIENTES, cliente.foto_url) : null

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-purple-300/30 bg-purple-300/15 text-sm font-semibold text-purple-300">
      {urlFoto ? (
        <img
          src={urlFoto}
          alt=""
          onError={() => setErrorFoto(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        iniciales(cliente.nombre)
      )}
    </div>
  )
}

function completitud(cliente) {
  const llenos = CAMPOS_OPCIONALES.filter((campo) => cliente[campo]).length
  return Math.round((llenos / CAMPOS_OPCIONALES.length) * 100)
}

function coloresCompletitud(porcentaje) {
  if (porcentaje === 100) return { barra: 'bg-green', texto: 'text-green' }
  if (porcentaje >= 50) return { barra: 'bg-purple-300', texto: 'text-purple-300' }
  return { barra: 'bg-ink/30', texto: 'text-ink/60' }
}

function DatoCliente({ icono: Icono, children, mono }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm text-ink/60">
      <Icono className="h-3.5 w-3.5 shrink-0 text-ink/60" />
      <span className={`min-w-0 truncate ${mono ? 'font-mono' : ''}`}>{children}</span>
    </div>
  )
}

function BarraCompletitud({ porcentaje, colores }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-3 text-xs text-ink/60">
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
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [orden, setOrden] = useState('nombre-asc')
  const [filtroSexo, setFiltroSexo] = useState('todos')
  const [modalCliente, setModalCliente] = useState(null) // null | 'nuevo' | cliente
  const [clienteAEliminar, setClienteAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasClientes descarte una respuesta que llega tarde de una
  // búsqueda/orden que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })
  const panelEliminarRef = useRef(null)

  useCerrarConEscape(() => setClienteAEliminar(null), Boolean(clienteAEliminar))
  useModalA11y(panelEliminarRef, Boolean(clienteAEliminar))

  async function cargarClientes(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const filtros = { busqueda: busquedaDebounced, orden, sexo: filtroSexo }

    const [clientesRes, totalRes] = await Promise.all([
      construirConsultaClientes(filtros).range(0, TAMANO_PAGINA - 1),
      aplicarFiltroSexo(
        aplicarFiltroBusqueda(
          supabase.from('clientes').select('id', { count: 'exact', head: true }),
          busquedaDebounced,
        ),
        filtroSexo,
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
    setHayMas((clientesRes.data ?? []).length === TAMANO_PAGINA)
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

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarClientes(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, orden, filtroSexo])

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

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
    cargarClientes()
  }

  const clientesOrdenados = ordenarClientes(clientes, orden)

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Buscador + Nuevo cliente: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por nombre o teléfono..."
          tema="purple-300"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />

        <SelectorOrden
          opciones={OPCIONES_SEXO}
          valor={filtroSexo}
          onCambiar={setFiltroSexo}
          tema="purple-300"
          icono={Filter}
          ariaLabel="Filtrar por sexo"
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

      <p className="mt-3 text-sm text-ink/60">
        Clientes: <span className="font-mono font-semibold text-purple-300">{totalClientes}</span>
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={4} />
      ) : clientesOrdenados.length === 0 ? (
        <EstadoVacio
          icono={Users}
          mensaje="No se encontraron clientes."
          accion={{ label: '+ Nuevo cliente', onClick: () => setModalCliente('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clientesOrdenados.map((cliente) => {
            const abierto = abiertos.has(cliente.id)
            const porcentaje = completitud(cliente)
            const colores = coloresCompletitud(porcentaje)

            return (
              <div key={cliente.id} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-3 p-3">
                  <div
                    onClick={() => alternarAbierto(cliente.id)}
                    onKeyDown={manejarActivacionTeclado(() => alternarAbierto(cliente.id))}
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  >
                    <AvatarCliente cliente={cliente} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{cliente.nombre}</p>
                      {cliente.cliente_web_id && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber/15 px-1.5 py-0.5 text-[10px] font-medium text-amber">
                          <Globe className="h-2.5 w-2.5" />
                          Cliente Web
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {cliente.telefono && (
                      <BotonAccion
                        icono={MessageCircle}
                        texto="WhatsApp"
                        color="verde"
                        href={`https://wa.me/${numeroWhatsapp(cliente.telefono)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        sinBorde
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => alternarAbierto(cliente.id)}
                      aria-label={abierto ? 'Contraer' : 'Expandir'}
                      className="p-1.5"
                    >
                      <ArrowBigDown
                        className={`h-4 w-4 text-ink/60 transition-transform duration-300 ${
                          abierto ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <BarraCompletitud porcentaje={porcentaje} colores={colores} />

                <CampoColapsable abierto={abierto}>
                  <div className="flex items-start justify-between gap-3 border-t border-border p-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <DatoCliente
                        icono={cliente.sexo === 'Femenino' ? Venus : cliente.sexo === 'Masculino' ? Mars : Users}
                      >
                        {cliente.sexo || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={Phone} mono>
                        {cliente.telefono || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={Cake} mono>
                        {formatearFecha(cliente.cumpleanos) || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={Mail} mono>
                        {cliente.clientes_web?.email || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={MapPin}>
                        {cliente.direccion || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={StickyNote}>
                        {cliente.notas || 'Sin registrar'}
                      </DatoCliente>
                    </div>

                    {cliente.cliente_web_id ? (
                      <div className="flex shrink-0 items-center gap-1.5 text-xs text-ink/50">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        <span className="max-w-[9rem]">
                          Se registró por la Web — edita su perfil desde ahí.
                        </span>
                      </div>
                    ) : (
                      <div className="flex shrink-0 gap-2">
                        <BotonAccion
                          icono={Pencil}
                          texto="Editar"
                          color="celeste"
                          onClick={() => setModalCliente(cliente)}
                        />
                        <BotonAccion
                          icono={Trash2}
                          texto="Eliminar"
                          color="rojo"
                          onClick={() => setClienteAEliminar(cliente)}
                        />
                      </div>
                    )}
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
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

      <BotonFlotanteAgregar
        onClick={() => setModalCliente('nuevo')}
        color="morado"
        label="Nuevo cliente"
      />

      {modalCliente && (
        <ModalCliente
          cliente={modalCliente === 'nuevo' ? null : modalCliente}
          onCerrar={() => setModalCliente(null)}
          onGuardado={() => {
            const esNuevo = modalCliente === 'nuevo'
            setModalCliente(null)
            mostrarToast(esNuevo ? 'Cliente creado.' : 'Cliente actualizado.', 'exito')
            cargarClientes()
          }}
        />
      )}

      {clienteAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
