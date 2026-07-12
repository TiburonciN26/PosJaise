import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Trash2,
  Plus,
  Phone,
  Mail,
  MapPin,
  ShieldAlert,
  Cake,
  CalendarDays,
  KeyRound,
  MessageCircle,
  ArrowBigDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalAsistente from '../components/ModalAsistente.jsx'

const CAMPOS_OPCIONALES = [
  'telefono',
  'email',
  'direccion',
  'contacto_emergencia',
  'cumpleanos',
  'fecha_ingreso',
]

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'completitud-asc', label: 'Datos completos (menor a mayor)' },
  { id: 'completitud-desc', label: 'Datos completos (mayor a menor)' },
]

function ordenarAsistentes(asistentes, orden) {
  const ordenados = [...asistentes]
  switch (orden) {
    case 'nombre-desc':
      return ordenados.sort((a, b) => b.nombres_completos.localeCompare(a.nombres_completos))
    case 'completitud-asc':
      return ordenados.sort((a, b) => completitud(a) - completitud(b))
    case 'completitud-desc':
      return ordenados.sort((a, b) => completitud(b) - completitud(a))
    default:
      return ordenados.sort((a, b) => a.nombres_completos.localeCompare(b.nombres_completos))
  }
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

function completitud(asistente) {
  const llenos = CAMPOS_OPCIONALES.filter((campo) => asistente[campo]).length
  return Math.round((llenos / CAMPOS_OPCIONALES.length) * 100)
}

function coloresCompletitud(porcentaje) {
  if (porcentaje === 100) return { barra: 'bg-green', texto: 'text-green' }
  if (porcentaje >= 50) return { barra: 'bg-purple-300', texto: 'text-purple-300' }
  return { barra: 'bg-ink/30', texto: 'text-ink/60' }
}

function DatoAsistente({ icono: Icono, children, mono }) {
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

export default function Asistentes({ activo = true }) {
  const { mostrarToast } = useToast()

  const [asistentes, setAsistentes] = useState([])
  const [usuariosAsistente, setUsuariosAsistente] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')
  const [modalAsistente, setModalAsistente] = useState(null) // null | 'nuevo' | asistente
  const [asistenteAEliminar, setAsistenteAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)

  useCerrarConEscape(() => setAsistenteAEliminar(null), Boolean(asistenteAEliminar))

  async function cargarAsistentes(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('asistentes')
      .select(
        'id, usuario_id, nombres_completos, telefono, email, direccion, contacto_emergencia, cumpleanos, fecha_ingreso, activo',
      )
      .order('nombres_completos')

    if (!vigente.actual) return

    if (errorConsulta) {
      setError('No se pudo cargar el directorio de asistentes.')
    } else {
      setError(null)
      setAsistentes(data ?? [])
    }
    setCargando(false)
  }

  async function cargarUsuariosAsistente() {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('rol', 'ASISTENTE')
      .order('nombre_completo')
    setUsuariosAsistente(data ?? [])
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarAsistentes(vigente, silencioso)
    cargarUsuariosAsistente()
    return () => {
      vigente.actual = false
    }
  }, [activo])

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function confirmarEliminar() {
    if (!asistenteAEliminar) return

    setEliminando(true)
    const { data, error: errorEliminar } = await supabase.rpc('eliminar_asistente', {
      p_id: asistenteAEliminar.id,
    })
    setEliminando(false)
    setAsistenteAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la asistente.', 'error')
      return
    }

    if (data === 'ELIMINADO') {
      mostrarToast('Asistente eliminada.', 'exito')
    } else {
      mostrarToast(
        'Esa asistente ya tiene servicios registrados — se desactivó en vez de eliminarse.',
        'info',
      )
    }
    cargarAsistentes()
  }

  const filtrados = busqueda.trim()
    ? asistentes.filter((asistente) =>
        asistente.nombres_completos.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : asistentes

  const filtradosOrdenados = ordenarAsistentes(filtrados, orden)

  return (
    <div className="p-3 pb-6">
      {/* Buscador + Nueva asistente: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por nombre..."
          tema="purple-300"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />

        <button
          type="button"
          onClick={() => setModalAsistente('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nueva asistente</span>
        </button>
      </div>

      <p className="mt-3 text-sm text-ink/60">
        Asistentes:{' '}
        <span className="font-mono font-semibold text-purple-300">{asistentes.length}</span>
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando asistentes...</p>
      ) : filtrados.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
          No se encontraron asistentes.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtradosOrdenados.map((asistente) => {
            const abierto = abiertos.has(asistente.id)
            const porcentaje = completitud(asistente)
            const colores = coloresCompletitud(porcentaje)

            return (
              <div key={asistente.id} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-3 p-3">
                  <div
                    onClick={() => alternarAbierto(asistente.id)}
                    onKeyDown={manejarActivacionTeclado(() => alternarAbierto(asistente.id))}
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-purple-300/30 bg-purple-300/15 text-sm font-semibold text-purple-300">
                      {iniciales(asistente.nombres_completos)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-ink">
                          {asistente.nombres_completos}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            asistente.activo
                              ? 'bg-green/15 text-green'
                              : 'bg-surface-2 text-ink/60'
                          }`}
                        >
                          {asistente.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      {asistente.usuario_id && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/60">
                          <KeyRound className="h-3 w-3 shrink-0" />
                          <span>Vinculada a una cuenta</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {asistente.telefono && (
                      <BotonAccion
                        icono={MessageCircle}
                        texto="WhatsApp"
                        color="verde"
                        href={`https://wa.me/${numeroWhatsapp(asistente.telefono)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        sinBorde
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => alternarAbierto(asistente.id)}
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
                      <DatoAsistente icono={Phone} mono>
                        {asistente.telefono || 'Sin registrar'}
                      </DatoAsistente>
                      <DatoAsistente icono={Mail}>{asistente.email || 'Sin registrar'}</DatoAsistente>
                      <DatoAsistente icono={MapPin}>
                        {asistente.direccion || 'Sin registrar'}
                      </DatoAsistente>
                      <DatoAsistente icono={ShieldAlert}>
                        {asistente.contacto_emergencia || 'Sin registrar'}
                      </DatoAsistente>
                      <DatoAsistente icono={Cake} mono>
                        {formatearFecha(asistente.cumpleanos) || 'Sin registrar'}
                      </DatoAsistente>
                      <DatoAsistente icono={CalendarDays} mono>
                        {formatearFecha(asistente.fecha_ingreso) || 'Sin registrar'}
                      </DatoAsistente>
                      <DatoAsistente icono={KeyRound}>
                        {asistente.usuario_id ? 'Vinculada a una cuenta' : 'Sin cuenta vinculada'}
                      </DatoAsistente>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <BotonAccion
                        icono={Pencil}
                        texto="Editar"
                        color="celeste"
                        onClick={() => setModalAsistente(asistente)}
                      />
                      <BotonAccion
                        icono={Trash2}
                        texto="Eliminar"
                        color="rojo"
                        onClick={() => setAsistenteAEliminar(asistente)}
                      />
                    </div>
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
      )}

      <BotonFlotanteAgregar
        onClick={() => setModalAsistente('nuevo')}
        color="morado"
        label="Nueva asistente"
      />

      {modalAsistente && (
        <ModalAsistente
          asistente={modalAsistente === 'nuevo' ? null : modalAsistente}
          usuariosDisponibles={usuariosAsistente.filter(
            (usuario) =>
              !asistentes.some(
                (a) => a.usuario_id === usuario.id && a.id !== modalAsistente?.id,
              ),
          )}
          onCerrar={() => setModalAsistente(null)}
          onGuardado={() => {
            const esNueva = modalAsistente === 'nuevo'
            setModalAsistente(null)
            mostrarToast(esNueva ? 'Asistente creada.' : 'Asistente actualizada.', 'exito')
            cargarAsistentes()
          }}
        />
      )}

      {asistenteAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar a "{asistenteAEliminar.nombres_completos}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Si ya tiene servicios registrados, en vez de eliminarse se desactivará para no
              romper el historial.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAsistenteAEliminar(null)}
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
