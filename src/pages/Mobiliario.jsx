import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Trash2,
  Plus,
  ArrowBigDown,
  Armchair,
  MapPin,
  Ruler,
  Weight,
  Palette,
  Tag,
  StickyNote,
  Phone,
  Globe,
  User,
  Receipt,
  ShieldCheck,
  Calendar,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalMobiliario, { OPCIONES_CONDICION } from '../components/ModalMobiliario.jsx'
import ModalCompraMobiliario from '../components/ModalCompraMobiliario.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const CAMPOS_OPCIONALES = [
  'marca',
  'modelo',
  'material',
  'color',
  'alto_cm',
  'ancho_cm',
  'profundidad_cm',
  'peso_kg',
  'foto_url',
  'ubicacion',
  'notas',
]

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'completitud-asc', label: 'Datos completos (menor a mayor)' },
  { id: 'completitud-desc', label: 'Datos completos (mayor a menor)' },
]

const CLASES_CONDICION = {
  BUENO: 'border-green/50 bg-green/15 text-green',
  REGULAR: 'border-amber/50 bg-amber/15 text-amber',
  NECESITA_REPARACION: 'border-orange-400/50 bg-orange-400/15 text-orange-400',
  DE_BAJA: 'border-red/50 bg-red/15 text-red',
}

function completitud(mueble) {
  const llenos = CAMPOS_OPCIONALES.filter((campo) => mueble[campo] != null && mueble[campo] !== '').length
  return Math.round((llenos / CAMPOS_OPCIONALES.length) * 100)
}

function coloresCompletitud(porcentaje) {
  if (porcentaje === 100) return { barra: 'bg-green', texto: 'text-green' }
  if (porcentaje >= 50) return { barra: 'bg-purple-300', texto: 'text-purple-300' }
  return { barra: 'bg-ink/30', texto: 'text-ink/60' }
}

function ordenarMobiliario(muebles, orden) {
  const ordenados = [...muebles]
  switch (orden) {
    case 'nombre-desc':
      return ordenados.sort((a, b) => b.nombre.localeCompare(a.nombre))
    case 'completitud-asc':
      return ordenados.sort((a, b) => completitud(a) - completitud(b))
    case 'completitud-desc':
      return ordenados.sort((a, b) => completitud(b) - completitud(a))
    default:
      return ordenados.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }
}

function formatearFecha(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

function dimensionesDe(mueble) {
  const { alto_cm: alto, ancho_cm: ancho, profundidad_cm: fondo } = mueble
  if (alto == null && ancho == null && fondo == null) return null
  return `${alto ?? '—'} × ${ancho ?? '—'} × ${fondo ?? '—'} cm`
}

function ultimaCompraDe(mueble) {
  return mueble.mobiliario_compras?.[0] ?? null
}

function DatoMobiliario({ icono: Icono, children, mono }) {
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
        <div className={`h-full rounded-full ${colores.barra}`} style={{ width: `${porcentaje}%` }} />
      </div>
      <span className={`shrink-0 font-mono font-medium ${colores.texto}`}>{porcentaje}%</span>
    </div>
  )
}

function FilaCompra({ compra, onEditar, onEliminar }) {
  return (
    <div className="space-y-1.5 rounded-lg bg-surface-2 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{compra.proveedor_nombre}</p>
          <p className="font-mono text-[11px] text-ink/50">{formatearFecha(compra.fecha)}</p>
        </div>
        <span className="shrink-0 font-mono text-sm text-purple-300">
          {formatearSoles(compra.precio_total)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/60">
        <span>
          {compra.cantidad} × {formatearSoles(compra.precio_unitario)}
        </span>
        <span className="rounded-full border border-border-strong px-1.5 py-0.5 text-[10px]">
          {compra.condicion_compra === 'USADO' ? 'Usado' : 'Nuevo'}
        </span>
        {compra.metodo_pago && <span>{compra.metodo_pago}</span>}
        {compra.numero_comprobante && (
          <span className="flex items-center gap-1">
            <Receipt className="h-3 w-3" />
            {compra.numero_comprobante}
          </span>
        )}
        {compra.garantia_meses != null && (
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            {compra.garantia_meses} {compra.garantia_meses === 1 ? 'mes' : 'meses'}
          </span>
        )}
      </div>

      {(compra.proveedor_telefono || compra.proveedor_contacto || compra.proveedor_web) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/50">
          {compra.proveedor_contacto && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {compra.proveedor_contacto}
            </span>
          )}
          {compra.proveedor_telefono && (
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {compra.proveedor_telefono}
            </span>
          )}
          {compra.proveedor_web && (
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {compra.proveedor_web}
            </span>
          )}
        </div>
      )}

      {compra.notas && <p className="text-xs text-ink/60">{compra.notas}</p>}

      <div className="flex justify-end gap-1.5 pt-0.5">
        <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={onEditar} sinBorde />
        <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={onEliminar} sinBorde />
      </div>
    </div>
  )
}

export default function Mobiliario({ activo = true }) {
  const { mostrarToast } = useToast()

  const [muebles, setMuebles] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')
  const [abiertos, setAbiertos] = useState(() => new Set())

  const [modalMueble, setModalMueble] = useState(null) // null | 'nuevo' | mueble
  const [muebleAEliminar, setMuebleAEliminar] = useState(null)
  const [eliminandoMueble, setEliminandoMueble] = useState(false)

  const [modalCompra, setModalCompra] = useState(null) // null | { mobiliarioId } | { mobiliarioId, compra }
  const [compraAEliminar, setCompraAEliminar] = useState(null)
  const [eliminandoCompra, setEliminandoCompra] = useState(false)

  const primeraCargaHecha = useRef(false)
  const panelEliminarMuebleRef = useRef(null)
  const panelEliminarCompraRef = useRef(null)

  useCerrarConEscape(() => setMuebleAEliminar(null), Boolean(muebleAEliminar))
  useModalA11y(panelEliminarMuebleRef, Boolean(muebleAEliminar))
  useCerrarConEscape(() => setCompraAEliminar(null), Boolean(compraAEliminar))
  useModalA11y(panelEliminarCompraRef, Boolean(compraAEliminar))

  async function cargarMobiliario(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('mobiliario')
      .select('*, mobiliario_compras(*)')
      .order('nombre')
      .order('fecha', { foreignTable: 'mobiliario_compras', ascending: false })

    if (!vigente.actual) return

    if (errorConsulta) {
      setError('No se pudo cargar el mobiliario.')
    } else {
      setError(null)
      setMuebles(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarMobiliario(vigente, silencioso)
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

  async function confirmarEliminarMueble() {
    if (!muebleAEliminar) return

    setEliminandoMueble(true)
    const { error: errorEliminar } = await supabase
      .from('mobiliario')
      .delete()
      .eq('id', muebleAEliminar.id)
    setEliminandoMueble(false)
    setMuebleAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar el mueble.', 'error')
      return
    }

    mostrarToast('Mueble eliminado.', 'exito')
    cargarMobiliario()
  }

  async function confirmarEliminarCompra() {
    if (!compraAEliminar) return

    setEliminandoCompra(true)
    const { error: errorEliminar } = await supabase
      .from('mobiliario_compras')
      .delete()
      .eq('id', compraAEliminar.id)
    setEliminandoCompra(false)
    setCompraAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la compra.', 'error')
      return
    }

    mostrarToast('Compra eliminada.', 'exito')
    cargarMobiliario()
  }

  const filtrados = busqueda.trim()
    ? muebles.filter((mueble) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          mueble.nombre.toLowerCase().includes(texto) ||
          (mueble.marca ?? '').toLowerCase().includes(texto) ||
          (mueble.modelo ?? '').toLowerCase().includes(texto) ||
          (mueble.categoria ?? '').toLowerCase().includes(texto)
        )
      })
    : muebles

  const filtradosOrdenados = ordenarMobiliario(filtrados, orden)

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-6xl"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por nombre, marca, modelo..."
          tema="purple-300"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />

        <button
          type="button"
          onClick={() => setModalMueble('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nuevo mueble</span>
        </button>
      </div>

      <p className="mt-3 text-sm text-ink/60">
        Muebles: <span className="font-mono font-semibold text-purple-300">{muebles.length}</span>
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={4} />
      ) : filtrados.length === 0 ? (
        <EstadoVacio
          icono={Armchair}
          mensaje="No se encontraron muebles."
          accion={{ label: '+ Nuevo mueble', onClick: () => setModalMueble('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtradosOrdenados.map((mueble) => {
            const abierto = abiertos.has(mueble.id)
            const porcentaje = completitud(mueble)
            const colores = coloresCompletitud(porcentaje)
            const ultimaCompra = ultimaCompraDe(mueble)
            const dimensiones = dimensionesDe(mueble)
            const condicionInfo =
              OPCIONES_CONDICION.find((o) => o.id === mueble.condicion) ?? OPCIONES_CONDICION[0]

            return (
              <div key={mueble.id} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-3 p-3">
                  <div
                    onClick={() => alternarAbierto(mueble.id)}
                    onKeyDown={manejarActivacionTeclado(() => alternarAbierto(mueble.id))}
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-purple-300/30 bg-purple-300/15 text-purple-300">
                      {mueble.foto_url ? (
                        <img src={mueble.foto_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Armchair className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-ink">{mueble.nombre}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLASES_CONDICION[mueble.condicion]}`}
                        >
                          {condicionInfo.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink/60">
                        {ultimaCompra
                          ? `Última compra: ${formatearSoles(ultimaCompra.precio_total)} · ${ultimaCompra.proveedor_nombre}`
                          : 'Sin compras registradas'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => alternarAbierto(mueble.id)}
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

                <BarraCompletitud porcentaje={porcentaje} colores={colores} />

                <CampoColapsable abierto={abierto}>
                  <div className="space-y-3 border-t border-border p-3">
                    <div className="space-y-2">
                      <DatoMobiliario icono={Tag}>
                        {mueble.categoria || 'Sin categoría'}
                        {mueble.marca && ` · ${mueble.marca}`}
                        {mueble.modelo && ` ${mueble.modelo}`}
                      </DatoMobiliario>
                      <DatoMobiliario icono={Palette}>
                        {mueble.material || mueble.color
                          ? [mueble.material, mueble.color].filter(Boolean).join(' · ')
                          : 'Sin registrar'}
                      </DatoMobiliario>
                      <DatoMobiliario icono={Ruler} mono>
                        {dimensiones ?? 'Sin registrar'}
                      </DatoMobiliario>
                      <DatoMobiliario icono={Weight} mono>
                        {mueble.peso_kg != null ? `${mueble.peso_kg} kg` : 'Sin registrar'}
                      </DatoMobiliario>
                      <DatoMobiliario icono={MapPin}>
                        {mueble.ubicacion || 'Sin registrar'}
                      </DatoMobiliario>
                      {mueble.notas && (
                        <DatoMobiliario icono={StickyNote}>{mueble.notas}</DatoMobiliario>
                      )}
                    </div>

                    <div className="flex justify-end gap-2">
                      <BotonAccion
                        icono={Pencil}
                        texto="Editar"
                        color="celeste"
                        onClick={() => setModalMueble(mueble)}
                      />
                      <BotonAccion
                        icono={Trash2}
                        texto="Eliminar"
                        color="rojo"
                        onClick={() => setMuebleAEliminar(mueble)}
                      />
                    </div>

                    <div className="border-t border-border pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink/60">
                          <Calendar className="h-3.5 w-3.5" />
                          Historial de compras ({mueble.mobiliario_compras?.length ?? 0})
                        </p>
                        <button
                          type="button"
                          onClick={() => setModalCompra({ mobiliarioId: mueble.id })}
                          title="Agregar"
                          className="flex shrink-0 items-center gap-1 text-xs font-medium text-purple-300 hover:text-purple-300/80"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span className="lg:hidden">Agregar</span>
                        </button>
                      </div>

                      <div className="mt-2 space-y-2">
                        {(mueble.mobiliario_compras ?? []).length === 0 ? (
                          <p className="text-center text-xs text-ink/40">
                            Todavía no hay compras registradas.
                          </p>
                        ) : (
                          mueble.mobiliario_compras.map((compra) => (
                            <FilaCompra
                              key={compra.id}
                              compra={compra}
                              onEditar={() => setModalCompra({ mobiliarioId: mueble.id, compra })}
                              onEliminar={() => setCompraAEliminar(compra)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
      )}

      <BotonFlotanteAgregar onClick={() => setModalMueble('nuevo')} color="morado" label="Nuevo mueble" />

      {modalMueble && (
        <ModalMobiliario
          mueble={modalMueble === 'nuevo' ? null : modalMueble}
          onCerrar={() => setModalMueble(null)}
          onGuardado={() => {
            const esNuevo = modalMueble === 'nuevo'
            setModalMueble(null)
            mostrarToast(esNuevo ? 'Mueble creado.' : 'Mueble actualizado.', 'exito')
            cargarMobiliario()
          }}
        />
      )}

      {modalCompra && (
        <ModalCompraMobiliario
          mobiliarioId={modalCompra.mobiliarioId}
          compra={modalCompra.compra ?? null}
          onCerrar={() => setModalCompra(null)}
          onGuardado={() => {
            const esNueva = !modalCompra.compra
            setModalCompra(null)
            mostrarToast(esNueva ? 'Compra registrada.' : 'Compra actualizada.', 'exito')
            cargarMobiliario()
          }}
        />
      )}

      {muebleAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div
            ref={panelEliminarMuebleRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5"
          >
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar "{muebleAEliminar.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Se elimina también todo su historial de compras. Esta acción no se puede deshacer.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setMuebleAEliminar(null)}
                disabled={eliminandoMueble}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminarMueble}
                disabled={eliminandoMueble}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminandoMueble ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {compraAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div
            ref={panelEliminarCompraRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5"
          >
            <h2 className="text-base font-semibold text-ink">¿Eliminar esta compra?</h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCompraAEliminar(null)}
                disabled={eliminandoCompra}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminarCompra}
                disabled={eliminandoCompra}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminandoCompra ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
