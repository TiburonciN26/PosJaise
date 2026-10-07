import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2, Plus, Scissors, Clock, ArrowBigDown } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { SELECT_SERVICIOS } from '../lib/columnasCatalogo.js'
import { consultaListadoServicios, categoriasDeServicios, TAMANO_PAGINA_SERVICIOS } from '../lib/buscarServicios.js'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalServicio from '../components/ModalServicio.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'precio-asc', label: 'Precio (menor a mayor)' },
  { id: 'precio-desc', label: 'Precio (mayor a menor)' },
  { id: 'duracion-asc', label: 'Duración (menor a mayor)' },
  { id: 'duracion-desc', label: 'Duración (mayor a menor)' },
]

function formatearDuracion(minutos) {
  return minutos != null ? `${minutos} min` : '—'
}

export default function Servicios({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'
  const navigate = useNavigate()

  const [servicios, setServicios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [categoriasExistentes, setCategoriasExistentes] = useState([])
  const vigenteRef = useRef({ actual: true })
  const [orden, setOrden] = useState('nombre-asc')
  const [modalServicio, setModalServicio] = useState(null) // null | 'nuevo' | servicio
  const [servicioAEliminar, setServicioAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  useCerrarConEscape(() => setServicioAEliminar(null), Boolean(servicioAEliminar))
  useModalA11y(panelEliminarRef, Boolean(servicioAEliminar))

  // QA-046: la búsqueda, el orden y la paginación los resuelve el SERVIDOR (como Inventario). Antes se
  // descargaba toda la tabla sin paginar y el servidor la cortaba en 1000, dejando fuera las fichas
  // posteriores aunque se buscaran por nombre.
  async function cargarServicios(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    // Una recarga silenciosa (tras guardar/eliminar) conserva hasta donde el usuario había llegado.
    const hasta = silencioso ? Math.min(Math.max(servicios.length, TAMANO_PAGINA_SERVICIOS), 1000) : TAMANO_PAGINA_SERVICIOS
    const [res, resCategorias] = await Promise.all([
      consultaListadoServicios(supabase, { termino: busquedaDebounced, orden, columnas: SELECT_SERVICIOS }).range(0, hasta - 1),
      categoriasDeServicios(supabase).catch(() => null),
    ])

    if (!vigente.actual) return

    if (res.error) {
      setError('No se pudo cargar el catálogo de servicios.')
      setServicios([])
      setHayMas(false)
    } else {
      setError(null)
      setServicios(res.data ?? [])
      setHayMas((res.data ?? []).length === hasta)
    }
    if (resCategorias) setCategoriasExistentes(resCategorias)
    setCargando(false)
  }

  async function cargarMasServicios() {
    if (cargandoMas || !hayMas) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { data, error: errorMas } = await consultaListadoServicios(supabase, {
      termino: busquedaDebounced,
      orden,
      columnas: SELECT_SERVICIOS,
    }).range(servicios.length, servicios.length + TAMANO_PAGINA_SERVICIOS - 1)
    setCargandoMas(false)
    if (!vigente.actual) return
    if (errorMas) {
      mostrarToast('No se pudieron cargar más servicios.', 'error')
      return
    }
    setServicios((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA_SERVICIOS)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarServicios(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, busquedaDebounced, orden])

  async function confirmarEliminar() {
    if (!servicioAEliminar) return

    setEliminando(true)
    const { data, error: errorEliminar } = await supabase.rpc('eliminar_servicio', {
      p_id: servicioAEliminar.id,
    })
    setEliminando(false)
    setServicioAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar el servicio.', 'error')
      return
    }

    if (data === 'ELIMINADO') {
      mostrarToast('Servicio eliminado.', 'exito')
    } else {
      mostrarToast(
        'Ese servicio ya tiene ventas registradas — se desactivó en vez de eliminarse.',
        'info',
      )
    }
    cargarServicios()
  }

  // Búsqueda y orden ya vienen resueltos por el servidor: `servicios` es la página a mostrar.
  const filtrados = servicios
  const filtradosOrdenados = servicios

  return (
    <div className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      {/* Buscador + Nuevo servicio: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar servicio..."
          tema="amber"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" />

        {esAdmin && (
          <button
            type="button"
            onClick={() => setModalServicio('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-amber px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo servicio</span>
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={5} />
      ) : filtrados.length === 0 && error ? null : filtrados.length === 0 ? (
        <EstadoVacio
          icono={Scissors}
          mensaje="No se encontraron servicios."
          accion={esAdmin ? { label: '+ Nuevo servicio', onClick: () => setModalServicio('nuevo') } : undefined}
        />
      ) : (
        <>
          {/* Tarjetas: solo móvil */}
          <div className="mt-4 grid grid-cols-1 gap-3 lg:hidden">
            {filtradosOrdenados.map((servicio) => {
              const abierto = abiertos.has(servicio.id)

              return (
                <div key={servicio.id} className="rounded-lg border border-border bg-surface">
                  <div className="flex items-center gap-2 px-3 py-[9px]">
                    <div
                      onClick={() => alternarAbierto(servicio.id)}
                      onKeyDown={manejarActivacionTeclado(() => alternarAbierto(servicio.id))}
                      role="button"
                      tabIndex={0}
                      aria-expanded={abierto}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{servicio.nombre}</p>
                        <p className="font-mono text-sm text-amber">
                          {formatearSoles(servicio.precio)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          servicio.activo ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'
                        }`}
                      >
                        {servicio.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => alternarAbierto(servicio.id)}
                      aria-label={abierto ? 'Contraer' : 'Expandir'}
                      className="shrink-0 p-1.5"
                    >
                      <ArrowBigDown
                        className={`h-4 w-4 text-ink/60 transition-transform duration-300 ${
                          abierto ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>

                  <CampoColapsable abierto={abierto}>
                    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-[9px]">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
                        {servicio.categoria && (
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink/60">
                            {servicio.categoria}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-ink/60">
                          <Clock className="h-3.5 w-3.5" />
                          {formatearDuracion(servicio.duracion_min)}
                        </span>
                      </div>

                      {esAdmin && (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <BotonAccion
                            icono={Pencil}
                            texto="Editar"
                            color="celeste"
                            onClick={() => setModalServicio(servicio)}
                          />
                          <BotonAccion
                            icono={Trash2}
                            texto="Eliminar"
                            color="rojo"
                            onClick={() => setServicioAEliminar(servicio)}
                          />
                        </div>
                      )}
                    </div>
                  </CampoColapsable>
                </div>
              )
            })}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs uppercase tracking-wider text-ink/60">
                  <th className="px-3 py-2 font-normal">Servicio</th>
                  <th className="px-3 py-2 font-normal">Categoría</th>
                  <th className="px-3 py-2 text-right font-normal">Precio</th>
                  <th className="px-3 py-2 text-right font-normal">Duración</th>
                  <th className="px-3 py-2 text-right font-normal">Estado</th>
                  {esAdmin && <th className="px-3 py-2 text-right font-normal">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtradosOrdenados.map((servicio) => (
                  <tr key={servicio.id} className="bg-surface">
                    <td className="px-3 py-2.5 text-ink">{servicio.nombre}</td>
                    <td className="px-3 py-2.5 text-ink/60">{servicio.categoria || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber">
                      {formatearSoles(servicio.precio)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink/60">
                      {formatearDuracion(servicio.duracion_min)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          servicio.activo ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'
                        }`}
                      >
                        {servicio.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {esAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-2">
                          <BotonAccion
                            icono={Pencil}
                            texto="Editar"
                            color="celeste"
                            onClick={() => setModalServicio(servicio)}
                          />
                          <BotonAccion
                            icono={Trash2}
                            texto="Eliminar"
                            color="rojo"
                            onClick={() => setServicioAEliminar(servicio)}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasServicios}
              disabled={cargandoMas}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}

      {esAdmin && (
        <BotonFlotanteAgregar
          onClick={() => setModalServicio('nuevo')}
          label="Nuevo servicio"
        />
      )}

      {modalServicio && (
        <ModalServicio
          servicio={modalServicio === 'nuevo' ? null : modalServicio}
          categoriasExistentes={categoriasExistentes}
          // «Editar en Web» (solo ADMINISTRADOR, ficha existente): abre el MISMO servicio, por ID, en
          // Web → Catálogo → Servicios. Esta pestaña queda montada (PestanasCacheadas), así que el modal, sus
          // cambios pendientes (sin guardar ni descartar) y el filtro siguen ahí al volver.
          onEditarEnWeb={
            esAdmin && modalServicio !== 'nuevo'
              ? () => navigate(`/catalogo-web?tab=servicios&id=${modalServicio.id}&desde=/servicios`)
              : undefined
          }
          // La protección económica sigue en Recompensas Web (importes protegidos, no contenido editorial).
          onProteccion={
            esAdmin && modalServicio !== 'nuevo'
              ? () => navigate(`/recompensas-web?tab=proteccion&servicio=${modalServicio.id}&desde=/servicios`)
              : undefined
          }
          onCerrar={() => setModalServicio(null)}
          onGuardado={() => {
            const esNuevo = modalServicio === 'nuevo'
            setModalServicio(null)
            mostrarToast(esNuevo ? 'Servicio creado.' : 'Servicio actualizado.', 'exito')
            cargarServicios()
          }}
        />
      )}

      {servicioAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar "{servicioAEliminar.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Si ya tiene ventas registradas, en vez de eliminarse se desactivará para no romper
              el historial.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setServicioAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
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
