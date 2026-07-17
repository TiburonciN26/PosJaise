import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, Scissors } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalServicio from '../components/ModalServicio.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'precio-asc', label: 'Precio (menor a mayor)' },
  { id: 'precio-desc', label: 'Precio (mayor a menor)' },
  { id: 'duracion-asc', label: 'Duración (menor a mayor)' },
  { id: 'duracion-desc', label: 'Duración (mayor a menor)' },
]

function ordenarServicios(servicios, orden) {
  const ordenados = [...servicios]
  switch (orden) {
    case 'nombre-desc':
      return ordenados.sort((a, b) => b.nombre.localeCompare(a.nombre))
    case 'precio-asc':
      return ordenados.sort((a, b) => a.precio - b.precio)
    case 'precio-desc':
      return ordenados.sort((a, b) => b.precio - a.precio)
    case 'duracion-asc':
      return ordenados.sort((a, b) => (a.duracion_min ?? 0) - (b.duracion_min ?? 0))
    case 'duracion-desc':
      return ordenados.sort((a, b) => (b.duracion_min ?? 0) - (a.duracion_min ?? 0))
    default:
      return ordenados.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }
}

function formatearDuracion(minutos) {
  return minutos != null ? `${minutos} min` : '—'
}

export default function Servicios({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'

  const [servicios, setServicios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')
  const [modalServicio, setModalServicio] = useState(null) // null | 'nuevo' | servicio
  const [servicioAEliminar, setServicioAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)

  useCerrarConEscape(() => setServicioAEliminar(null), Boolean(servicioAEliminar))
  useModalA11y(panelEliminarRef, Boolean(servicioAEliminar))

  async function cargarServicios(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('servicios')
      .select('id, nombre, categoria, precio, duracion_min, activo')
      .order('nombre')

    if (!vigente.actual) return

    if (errorConsulta) {
      setError('No se pudo cargar el catálogo de servicios.')
    } else {
      setError(null)
      setServicios(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarServicios(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo])

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

  const filtrados = busqueda.trim()
    ? servicios.filter((servicio) =>
        servicio.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : servicios

  const filtradosOrdenados = ordenarServicios(filtrados, orden)

  const categoriasExistentes = [...new Set(servicios.map((s) => s.categoria).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  )

  return (
    <div className="animate-entrada-pestana p-3 pb-6">
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
      ) : filtrados.length === 0 ? (
        <EstadoVacio
          icono={Scissors}
          mensaje="No se encontraron servicios."
          accion={esAdmin ? { label: '+ Nuevo servicio', onClick: () => setModalServicio('nuevo') } : undefined}
        />
      ) : (
        <>
          {/* Tarjetas: solo móvil */}
          <div className="mt-4 grid grid-cols-1 gap-3 lg:hidden">
            {filtradosOrdenados.map((servicio) => (
              <div key={servicio.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">{servicio.nombre}</p>
                    {servicio.categoria && (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink/60">
                        {servicio.categoria}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        servicio.activo ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'
                      }`}
                    >
                      {servicio.activo ? 'Activo' : 'Inactivo'}
                    </span>
                    {esAdmin && (
                      <>
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
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 flex items-center gap-4 font-mono text-sm">
                  <span className="text-amber">{formatearSoles(servicio.precio)}</span>
                  <span className="text-ink/60">{formatearDuracion(servicio.duracion_min)}</span>
                </div>
              </div>
            ))}
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
