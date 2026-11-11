import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, KeyRound, Lock, LockOpen, Pencil, Plus, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import {
  ETIQUETA_ROL,
  ROLES_CON_FICHA,
  ROLES_PERSONAL,
  bloquearPersona,
  desbloquearPersona,
  estaBloqueada,
  listarPersonal,
} from '../lib/personal.js'
import { useEstadoVista } from '../lib/estadoVista.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalPersonal from '../components/ModalPersonal.jsx'
import ModalClavePersonal from '../components/ModalClavePersonal.jsx'

const FILTROS_ESTADO = [
  { id: 'todos', label: 'Todas' },
  { id: 'activas', label: 'Activas' },
  { id: 'bloqueadas', label: 'Bloqueadas' },
]

function iniciales(nombre) {
  return (
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

function formatearAcceso(iso) {
  if (!iso) return 'Aún no ha ingresado'
  return new Date(iso).toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Chip({ activo, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
        activo
          ? 'border-purple-300 bg-purple-300/10 text-purple-300'
          : 'border-border text-ink/70 hover:border-border-strong'
      }`}
    >
      {children}
    </button>
  )
}

// Pestaña «Personal» (solo ADMINISTRADOR): alta, bloqueo y gestión de las cuentas de acceso del POS. A diferencia de
// Web → Equipo (fichas del equipo: foto, bio y datos para la Web), aquí se maneja la CUENTA con login.
// Al crear una asistente o encargada, su ficha se crea sola y queda vinculada.
export default function Personal({ activo = true }) {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()

  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/personal:busqueda', '')
  const [filtroRol, setFiltroRol] = useEstadoVista('/personal:rol', 'todos')
  const [filtroEstado, setFiltroEstado] = useEstadoVista('/personal:estado', 'todos')
  const [modalPersona, setModalPersona] = useState(null) // null | 'nuevo' | fila
  const [personaClave, setPersonaClave] = useState(null)
  const [personaAConfirmar, setPersonaAConfirmar] = useState(null) // fila a bloquear
  const [procesando, setProcesando] = useState(false)
  const primeraCargaHecha = useRef(false)
  const panelConfirmarRef = useRef(null)

  useCerrarConEscape(() => setPersonaAConfirmar(null), Boolean(personaAConfirmar) && !procesando)
  useModalA11y(panelConfirmarRef, Boolean(personaAConfirmar))

  async function cargar(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const resultado = await listarPersonal()
    if (!vigente.actual) return
    if (!resultado.ok) {
      setError(resultado.error)
    } else {
      setError(null)
      setFilas(resultado.filas)
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargar(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo])

  async function confirmarBloqueo() {
    if (!personaAConfirmar) return
    setProcesando(true)
    const resultado = await bloquearPersona(personaAConfirmar.id)
    setProcesando(false)
    const nombre = personaAConfirmar.nombre_completo
    setPersonaAConfirmar(null)
    if (!resultado.ok) {
      mostrarToast(resultado.error, 'error')
      return
    }
    mostrarToast(`Se bloqueó el acceso de ${nombre}.`, 'exito')
    cargar(undefined, true)
  }

  async function desbloquear(fila) {
    setProcesando(true)
    const resultado = await desbloquearPersona(fila.id)
    setProcesando(false)
    if (!resultado.ok) {
      mostrarToast(resultado.error, 'error')
      return
    }
    mostrarToast(`${fila.nombre_completo} puede volver a ingresar.`, 'exito')
    cargar(undefined, true)
  }

  const texto = busqueda.trim().toLowerCase()
  const visibles = filas.filter((fila) => {
    if (filtroRol !== 'todos' && fila.rol !== filtroRol) return false
    const bloqueada = estaBloqueada(fila)
    if (filtroEstado === 'activas' && bloqueada) return false
    if (filtroEstado === 'bloqueadas' && !bloqueada) return false
    if (!texto) return true
    return fila.nombre_completo.toLowerCase().includes(texto) || (fila.email ?? '').toLowerCase().includes(texto)
  })

  const activas = filas.filter((fila) => !estaBloqueada(fila)).length

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <div className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por nombre o correo..."
          tema="purple-300"
          sinBorde
        />
        <button
          type="button"
          onClick={() => setModalPersona('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nueva persona</span>
        </button>
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        <Chip activo={filtroRol === 'todos'} onClick={() => setFiltroRol('todos')}>
          Todos los roles
        </Chip>
        {ROLES_PERSONAL.map((rol) => (
          <Chip key={rol.id} activo={filtroRol === rol.id} onClick={() => setFiltroRol(rol.id)}>
            {rol.label}
          </Chip>
        ))}
      </div>
      <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
        {FILTROS_ESTADO.map((estado) => (
          <Chip key={estado.id} activo={filtroEstado === estado.id} onClick={() => setFiltroEstado(estado.id)}>
            {estado.label}
          </Chip>
        ))}
      </div>

      <p className="mt-3 text-sm text-ink/60">
        Personal: <span className="font-mono font-semibold text-purple-300">{filas.length}</span> · Con acceso:{' '}
        <span className="font-mono font-semibold text-green">{activas}</span>
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={5} />
      ) : visibles.length === 0 ? (
        <EstadoVacio
          icono={Users}
          mensaje="No se encontró personal con esos filtros."
          accion={{ label: '+ Nueva persona', onClick: () => setModalPersona('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((fila) => {
            const bloqueada = estaBloqueada(fila)
            const esYo = fila.id === usuario?.id
            const sinFicha = ROLES_CON_FICHA.includes(fila.rol) && !fila.ficha_id
            return (
              <div
                key={fila.id}
                className={`rounded-lg border bg-surface ${bloqueada ? 'border-red/30' : 'border-border'}`}
              >
                <div className="flex items-start gap-3 p-3">
                  {fila.foto_url ? (
                    <img src={fila.foto_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-purple-300/30 bg-purple-300/15 text-sm font-semibold text-purple-300">
                      {iniciales(fila.nombre_completo)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate text-sm font-medium text-ink">
                        {fila.nombre_completo}
                        {esYo && <span className="text-ink/60"> (tú)</span>}
                      </p>
                      <span className="shrink-0 rounded-full bg-purple-300/15 px-2 py-0.5 text-[11px] font-medium text-purple-300">
                        {ETIQUETA_ROL[fila.rol] ?? fila.rol}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          bloqueada ? 'bg-red/15 text-red' : 'bg-green/15 text-green'
                        }`}
                      >
                        {bloqueada ? 'Bloqueada' : 'Activa'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink/60">{fila.email}</p>
                    <p className="mt-0.5 text-[11px] text-ink/60">Último ingreso: {formatearAcceso(fila.ultimo_acceso)}</p>
                    {sinFicha && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-amber">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Sin ficha de asistente: edítala y guárdala para crearla.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-border p-2">
                  <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={() => setModalPersona(fila)} />
                  <BotonAccion
                    icono={KeyRound}
                    texto="Contraseña"
                    color="morado"
                    onClick={() => setPersonaClave(fila)}
                  />
                  {bloqueada ? (
                    <BotonAccion
                      icono={LockOpen}
                      texto="Desbloquear"
                      color="verde"
                      onClick={() => !procesando && desbloquear(fila)}
                    />
                  ) : (
                    !esYo && (
                      <BotonAccion
                        icono={Lock}
                        texto="Bloquear"
                        color="rojo"
                        onClick={() => setPersonaAConfirmar(fila)}
                      />
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <BotonFlotanteAgregar onClick={() => setModalPersona('nuevo')} color="morado" label="Nueva persona" />

      {modalPersona && (
        <ModalPersonal
          persona={modalPersona === 'nuevo' ? null : modalPersona}
          esYo={modalPersona !== 'nuevo' && modalPersona.id === usuario?.id}
          onCerrar={() => setModalPersona(null)}
          onGuardado={(fueCreacion) => {
            setModalPersona(null)
            mostrarToast(fueCreacion ? 'Persona creada.' : 'Cambios guardados.', 'exito')
            cargar(undefined, true)
          }}
        />
      )}

      {personaClave && (
        <ModalClavePersonal
          persona={personaClave}
          onCerrar={() => setPersonaClave(null)}
          onGuardado={() => setPersonaClave(null)}
        />
      )}

      {personaAConfirmar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div
            ref={panelConfirmarRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
          >
            <h2 className="text-base font-semibold text-ink">¿Bloquear a "{personaAConfirmar.nombre_completo}"?</h2>
            <p className="mt-1 text-sm text-ink/60">
              No podrá iniciar sesión y perderá el acceso de inmediato. Su historial (ventas, atenciones, comisiones)
              se conserva y puedes desbloquearla cuando quieras.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPersonaAConfirmar(null)}
                disabled={procesando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarBloqueo}
                disabled={procesando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {procesando ? 'Bloqueando...' : 'Sí, bloquear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
