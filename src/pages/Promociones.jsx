import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, Ticket, Calendar, ArrowBigDown } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalPromocion from '../components/ModalPromocion.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

function formatearValor(promocion) {
  return promocion.tipo_descuento === 'PORCENTAJE'
    ? `${promocion.valor}%`
    : formatearSoles(promocion.valor)
}

function formatearFecha(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

function formatearVigencia(promocion) {
  const desde = formatearFecha(promocion.vigente_desde)
  const hasta = formatearFecha(promocion.vigente_hasta)
  if (!desde && !hasta) return 'Sin límite de fechas'
  if (desde && hasta) return `${desde} — ${hasta}`
  if (desde) return `Desde el ${desde}`
  return `Hasta el ${hasta}`
}

export default function Promociones({ activo = true }) {
  const { mostrarToast } = useToast()

  const [promociones, setPromociones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [modalPromocion, setModalPromocion] = useState(null) // null | 'nuevo' | promocion
  const [promocionAEliminar, setPromocionAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)

  useCerrarConEscape(() => setPromocionAEliminar(null), Boolean(promocionAEliminar))
  useModalA11y(panelEliminarRef, Boolean(promocionAEliminar))

  async function cargarPromociones(silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('promociones')
      .select('id, titulo, descripcion, tipo_descuento, valor, vigente_desde, vigente_hasta, activo')
      .order('creado_en', { ascending: false })

    if (errorConsulta) {
      setError('No se pudo cargar las promociones.')
    } else {
      setError(null)
      setPromociones(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarPromociones(silencioso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!promocionAEliminar) return
    setEliminando(true)
    const { error: errorEliminar } = await supabase
      .from('promociones')
      .delete()
      .eq('id', promocionAEliminar.id)
    setEliminando(false)
    setPromocionAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la promoción.', 'error')
      return
    }

    mostrarToast('Promoción eliminada.', 'exito')
    cargarPromociones()
  }

  const filtradas = busqueda.trim()
    ? promociones.filter((p) => p.titulo.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : promociones

  return (
    <div className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-5xl">
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar promoción..."
          tema="red"
        />
        <button
          type="button"
          onClick={() => setModalPromocion('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-red px-3 py-2.5 text-sm font-semibold text-white lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nueva promoción</span>
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={3} />
      ) : filtradas.length === 0 ? (
        <EstadoVacio
          icono={Ticket}
          mensaje="No hay promociones registradas."
          accion={{ label: '+ Nueva promoción', onClick: () => setModalPromocion('nuevo') }}
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((promocion) => {
            const abierta = abiertos.has(promocion.id)
            return (
              <div key={promocion.id} className="rounded-lg border border-border bg-surface">
                <div
                  onClick={() => alternarAbierto(promocion.id)}
                  onKeyDown={manejarActivacionTeclado(() => alternarAbierto(promocion.id))}
                  role="button"
                  tabIndex={0}
                  aria-expanded={abierta}
                  className="flex cursor-pointer items-center gap-3 p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red/30 bg-red/15 text-sm font-semibold text-red">
                    <Ticket className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{promocion.titulo}</p>
                    <p className="font-mono text-sm text-red">{formatearValor(promocion)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      promocion.activo ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'
                    }`}
                  >
                    {promocion.activo ? 'Activa' : 'Inactiva'}
                  </span>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      abierta ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                <CampoColapsable abierto={abierta}>
                  <div className="border-t border-border p-3">
                    {promocion.descripcion && (
                      <p className="text-sm text-ink/70">{promocion.descripcion}</p>
                    )}
                    <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-ink/60">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatearVigencia(promocion)}
                    </p>

                    <div className="mt-3 flex gap-2">
                      <BotonAccion
                        icono={Pencil}
                        texto="Editar"
                        color="celeste"
                        onClick={() => setModalPromocion(promocion)}
                      />
                      <BotonAccion
                        icono={Trash2}
                        texto="Eliminar"
                        color="rojo"
                        onClick={() => setPromocionAEliminar(promocion)}
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
        onClick={() => setModalPromocion('nuevo')}
        color="rojo"
        label="Nueva promoción"
      />

      {modalPromocion && (
        <ModalPromocion
          promocion={modalPromocion === 'nuevo' ? null : modalPromocion}
          onCerrar={() => setModalPromocion(null)}
          onGuardado={() => {
            const esNueva = modalPromocion === 'nuevo'
            setModalPromocion(null)
            mostrarToast(esNueva ? 'Promoción creada.' : 'Promoción actualizada.', 'exito')
            cargarPromociones()
          }}
        />
      )}

      {promocionAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar "{promocionAEliminar.titulo}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPromocionAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-red hover:text-red disabled:opacity-40"
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
