import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Trash2,
  Plus,
  Phone,
  IdCard,
  Cake,
  StickyNote,
  MessageCircle,
  ArrowBigDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalCliente from '../components/ModalCliente.jsx'

const CAMPOS_OPCIONALES = ['telefono', 'dni', 'cumpleanos', 'notas']

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'completitud-asc', label: 'Datos completos (menor a mayor)' },
  { id: 'completitud-desc', label: 'Datos completos (mayor a menor)' },
]

const TAMANO_PAGINA = 50
const SELECT_CLIENTES = 'id, nombre, telefono, dni, cumpleanos, notas'

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

function construirConsultaClientes({ busqueda, orden }) {
  const consulta = aplicarFiltroBusqueda(supabase.from('clientes').select(SELECT_CLIENTES), busqueda)
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

function completitud(cliente) {
  const llenos = CAMPOS_OPCIONALES.filter((campo) => cliente[campo]).length
  return llenos * 25
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
  const [modalCliente, setModalCliente] = useState(null) // null | 'nuevo' | cliente
  const [clienteAEliminar, setClienteAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)

  useCerrarConEscape(() => setClienteAEliminar(null), Boolean(clienteAEliminar))

  async function cargarClientes(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const filtros = { busqueda: busquedaDebounced, orden }

    const [clientesRes, totalRes] = await Promise.all([
      construirConsultaClientes(filtros).range(0, TAMANO_PAGINA - 1),
      aplicarFiltroBusqueda(
        supabase.from('clientes').select('id', { count: 'exact', head: true }),
        busquedaDebounced,
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
    setCargandoMas(true)
    const filtros = { busqueda: busquedaDebounced, orden }

    const { data, error: errorMas } = await construirConsultaClientes(filtros).range(
      clientes.length,
      clientes.length + TAMANO_PAGINA - 1,
    )

    setCargandoMas(false)

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
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarClientes(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, orden])

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
    <div className="p-3 pb-6">
      {/* Buscador + Nuevo cliente: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por nombre o teléfono..."
          tema="purple-300"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />

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
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando clientes...</p>
      ) : clientesOrdenados.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
          No se encontraron clientes.
        </p>
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
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-purple-300/30 bg-purple-300/15 text-sm font-semibold text-purple-300">
                      {iniciales(cliente.nombre)}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {cliente.nombre}
                    </p>
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
                      <DatoCliente icono={Phone} mono>
                        {cliente.telefono || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={IdCard} mono>
                        {cliente.dni ? `DNI ${cliente.dni}` : 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={Cake} mono>
                        {formatearFecha(cliente.cumpleanos) || 'Sin registrar'}
                      </DatoCliente>
                      <DatoCliente icono={StickyNote}>
                        {cliente.notas || 'Sin registrar'}
                      </DatoCliente>
                    </div>

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
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
