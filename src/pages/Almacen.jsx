import { useEffect, useRef, useState } from 'react'
import { Minus, Pencil, Plus, Trash2, Warehouse } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { useEncabezadoTablaPegado } from '../hooks/useEncabezadoTablaPegado.js'
import { formatearSoles } from '../lib/moneda.js'
import { useEstadoVista } from '../lib/estadoVista.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalArticuloAlmacen from '../components/ModalArticuloAlmacen.jsx'
import ModalMovimientoAlmacen from '../components/ModalMovimientoAlmacen.jsx'
import { mensajeErrorAlmacen } from '../lib/almacen.js'
import ModalDetalleArticuloAlmacen from '../components/ModalDetalleArticuloAlmacen.jsx'

// Almacén: cosas internas del negocio que NO se venden (agua para las trabajadoras, papel, guantes, limpieza…). Misma
// estructura que Inventario, pero aparte de «productos». Migración 20261112000011_almacen:
//   · todo el personal ve los artículos activos y anota lo que SACA (quién y cuándo los guarda el servidor);
//   · solo la administradora crea / edita / elimina artículos, registra INGRESOS con su costo y ve el historial y el
//     «gastado este mes».

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'stock-asc', label: 'Stock (menor a mayor)' },
  { id: 'stock-desc', label: 'Stock (mayor a menor)' },
]

const ORDEN_A_COLUMNA = {
  'nombre-asc': { columna: 'nombre', ascending: true },
  'nombre-desc': { columna: 'nombre', ascending: false },
  'stock-asc': { columna: 'stock_actual', ascending: true },
  'stock-desc': { columna: 'stock_actual', ascending: false },
}

const RESUMEN_VACIO = { total: 0, bajoStock: 0, sinStock: 0, gastadoMes: 0, categorias: [] }

// Quita caracteres que rompen la sintaxis del filtro .or() de PostgREST (igual que en Inventario).
function terminoSeguro(texto) {
  return texto.replace(/[%,()]/g, '')
}

function claseColorStock(articulo) {
  if (articulo.stock_actual <= 0) return 'text-red'
  if (articulo.stock_actual <= articulo.stock_minimo) return 'text-orange-400'
  return 'text-green'
}

export default function Almacen({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'

  const [articulos, setArticulos] = useState([])
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/almacen:busqueda', '')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [orden, setOrden] = useEstadoVista('/almacen:orden', 'nombre-asc')
  const [filtroStock, setFiltroStock] = useEstadoVista('/almacen:filtroStock', 'todos') // 'todos' | 'bajo' | 'sin_stock'

  const [modalArticulo, setModalArticulo] = useState(null) // null | 'nuevo' | articulo
  const [movimiento, setMovimiento] = useState(null) // null | { articulo, tipo: 'SALIDA' | 'INGRESO' }
  const [detalle, setDetalle] = useState(null) // articulo | null
  const [articuloAEliminar, setArticuloAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)

  const primeraCargaHecha = useRef(false)
  const vigenteRef = useRef({ actual: true })
  const panelEliminarRef = useRef(null)
  const { barraRef, encabezadoRef, claseTh, estiloTh } = useEncabezadoTablaPegado([articulos, cargando])

  useCerrarConEscape(() => {
    if (!eliminando) setArticuloAEliminar(null)
  }, Boolean(articuloAEliminar))
  useModalA11y(panelEliminarRef, Boolean(articuloAEliminar))

  async function cargar(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)

    let consulta = supabase
      .from('almacen_articulos_vista')
      .select('id, nombre, categoria, unidad, stock_actual, stock_minimo, activo')
    const termino = terminoSeguro(busquedaDebounced.trim())
    if (termino) consulta = consulta.or(`nombre.ilike.%${termino}%,categoria.ilike.%${termino}%`)
    if (filtroStock === 'bajo') consulta = consulta.eq('stock_bajo', true).eq('activo', true)
    if (filtroStock === 'sin_stock') consulta = consulta.eq('sin_stock', true).eq('activo', true)
    const { columna, ascending } = ORDEN_A_COLUMNA[orden] ?? ORDEN_A_COLUMNA['nombre-asc']
    // Inactivos al final (solo los ve la administradora); dentro de cada grupo, el orden elegido.
    consulta = consulta.order('activo', { ascending: false }).order(columna, { ascending }).order('nombre')

    const [articulosRes, resumenRes] = await Promise.all([consulta.limit(1000), supabase.rpc('resumen_almacen')])
    if (!vigente.actual) return

    if (articulosRes.error) {
      setError('No se pudo cargar el almacén.')
      setArticulos([])
      setCargando(false)
      return
    }

    setError(null)
    setArticulos(articulosRes.data ?? [])
    const fila = resumenRes.data?.[0]
    setResumen(
      fila
        ? {
            total: fila.total ?? 0,
            bajoStock: fila.bajo_stock ?? 0,
            sinStock: fila.sin_stock ?? 0,
            gastadoMes: fila.gastado_mes ?? 0,
            categorias: fila.categorias ?? [],
          }
        : RESUMEN_VACIO,
    )
    setCargando(false)
  }

  function recargar() {
    cargar(vigenteRef.current, true)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargar(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, orden, filtroStock])

  async function confirmarEliminar() {
    if (!articuloAEliminar) return
    setEliminando(true)
    const { data, error: errorRpc } = await supabase.rpc('eliminar_articulo_almacen', { p_id: articuloAEliminar.id })
    setEliminando(false)
    setArticuloAEliminar(null)

    if (errorRpc) {
      mostrarToast(mensajeErrorAlmacen(errorRpc, 'No se pudo eliminar el artículo.'), 'error')
      return
    }
    setDetalle(null)
    mostrarToast(
      data === 'ELIMINADO'
        ? 'Artículo eliminado.'
        : 'Ese artículo ya tiene movimientos: se desactivó en vez de eliminarse para conservar el historial.',
      data === 'ELIMINADO' ? 'exito' : 'info',
    )
    recargar()
  }

  function abrirMovimiento(articulo, tipo) {
    setMovimiento({ articulo, tipo })
  }

  const accionesFila = (articulo, { sinBorde = false } = {}) => (
    <>
      {articulo.activo && (
        <BotonAccion
          plano
          sinBorde={sinBorde}
          icono={Minus}
          texto="Sacar"
          color="morado"
          onClick={() => abrirMovimiento(articulo, 'SALIDA')}
        />
      )}
      {esAdmin && (
        <BotonAccion
          plano
          sinBorde={sinBorde}
          icono={Plus}
          texto="Ingreso"
          color="verde"
          onClick={() => abrirMovimiento(articulo, 'INGRESO')}
        />
      )}
    </>
  )

  return (
    <div className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      <div
        ref={barraRef}
        className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)"
      >
        <BarraBusqueda valor={busqueda} onCambiar={setBusqueda} placeholder="Buscar en el almacén..." tema="purple-300" sinBorde />
        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" sinBorde />
        {esAdmin && (
          <button
            type="button"
            onClick={() => setModalArticulo('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo artículo</span>
          </button>
        )}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div
          className={`rounded-lg border border-border bg-surface px-3 py-2 ${
            esAdmin ? 'col-span-2 md:col-span-3' : 'col-span-2 md:col-span-4'
          }`}
        >
          <p className="text-xs text-ink/60 lg:text-center">Artículos</p>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            {[
              { id: 'todos', valor: resumen.total, label: 'Total', clase: 'text-ink' },
              { id: 'bajo', valor: resumen.bajoStock, label: 'Bajo', clase: 'text-orange-400' },
              { id: 'sin_stock', valor: resumen.sinStock, label: 'Sin stock', clase: 'text-red' },
            ].map((opcion) => (
              <button
                key={opcion.id}
                type="button"
                onClick={() => setFiltroStock(opcion.id)}
                aria-pressed={filtroStock === opcion.id}
                className={`rounded-lg py-1 transition-colors ${
                  filtroStock === opcion.id ? 'bg-surface-2' : 'hover:bg-surface-2/50'
                }`}
              >
                <p className={`font-mono text-lg font-semibold sm:text-xl ${opcion.clase}`}>{opcion.valor}</p>
                <p className="text-[11px] text-ink/60">{opcion.label}</p>
              </button>
            ))}
          </div>
        </div>

        {esAdmin && (
          <div className="col-span-2 grid md:col-span-1">
            <TarjetaResumen
              etiqueta="Gastado este mes"
              valor={formatearSoles(resumen.gastadoMes)}
              claseValor="text-purple-300"
            />
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}

      {cargando ? (
        <EsqueletoLista columnas={5} />
      ) : articulos.length === 0 ? (
        <EstadoVacio
          icono={Warehouse}
          tema="purple-300"
          mensaje={
            busquedaDebounced.trim() || filtroStock !== 'todos'
              ? 'No se encontraron artículos.'
              : 'Todavía no hay artículos en el almacén.'
          }
          accion={esAdmin ? { label: '+ Nuevo artículo', onClick: () => setModalArticulo('nuevo') } : undefined}
        />
      ) : (
        <>
          {/* Tarjetas: móvil. Tocar la tarjeta abre el detalle; «Sacar» (e «Ingreso» para la admin) quedan a mano. */}
          <div className="mt-3 grid grid-cols-1 gap-2.5 lg:hidden">
            {articulos.map((articulo) => (
              <div
                key={articulo.id}
                onClick={() => setDetalle(articulo)}
                className={`w-full touch-manipulation rounded-lg border border-border bg-surface p-2 text-left transition-colors hover:border-purple-300/40 ${
                  articulo.activo ? '' : 'opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{articulo.nombre}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {articulo.categoria && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink/60">
                          {articulo.categoria}
                        </span>
                      )}
                      {!articulo.activo && (
                        <span className="rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-ink/60">
                          Inactivo
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-ink/70">
                      <span className={claseColorStock(articulo)}>{articulo.stock_actual}</span> {articulo.unidad}
                    </span>
                    <div className="flex gap-1" onClick={(evento) => evento.stopPropagation()}>
                      {accionesFila(articulo)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tabla: escritorio */}
          <div className="mt-4 hidden overflow-x-clip border-y border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead ref={encabezadoRef}>
                <tr className="font-mono text-xs uppercase tracking-wider text-ink/60">
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Artículo</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Categoría</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Stock</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {articulos.map((articulo) => (
                  <tr
                    key={articulo.id}
                    onClick={() => setDetalle(articulo)}
                    className={`cursor-pointer touch-manipulation bg-tabla hover:bg-surface-2/60 ${
                      articulo.activo ? '' : 'opacity-60'
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <p className="text-ink">
                        {articulo.nombre}
                        {!articulo.activo && (
                          <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-ink/60">
                            Inactivo
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-xs text-ink/60">{articulo.unidad}</p>
                    </td>
                    <td className="px-3 py-2.5 text-ink/60">{articulo.categoria || '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${claseColorStock(articulo)}`}>{articulo.stock_actual}</td>
                    <td className="px-3 py-2.5" onClick={(evento) => evento.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        {accionesFila(articulo, { sinBorde: true })}
                        {esAdmin && (
                          <>
                            <BotonAccion
                              plano
                              sinBorde
                              icono={Pencil}
                              texto="Editar"
                              color="celeste"
                              onClick={() => setModalArticulo(articulo)}
                            />
                            <BotonAccion
                              plano
                              sinBorde
                              icono={Trash2}
                              texto="Eliminar"
                              color="rojo"
                              onClick={() => setArticuloAEliminar(articulo)}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {esAdmin && <BotonFlotanteAgregar onClick={() => setModalArticulo('nuevo')} color="morado" label="Nuevo artículo" />}

      {/* Igual que Inventario: si una acción se abre desde el detalle, el detalle no se cierra; solo se oculta mientras el
          otro modal está encima y reaparece (ya actualizado) al cerrarlo. */}
      {detalle && !movimiento && !modalArticulo && !articuloAEliminar && (
        <ModalDetalleArticuloAlmacen
          articulo={detalle}
          esAdmin={esAdmin}
          onCerrar={() => setDetalle(null)}
          onSacar={() => abrirMovimiento(detalle, 'SALIDA')}
          onIngresar={() => abrirMovimiento(detalle, 'INGRESO')}
          onEditar={() => setModalArticulo(detalle)}
          onEliminar={() => setArticuloAEliminar(detalle)}
        />
      )}

      {movimiento && (
        <ModalMovimientoAlmacen
          articulo={movimiento.articulo}
          tipo={movimiento.tipo}
          onCerrar={() => setMovimiento(null)}
          onGuardado={(stockNuevo) => {
            const { articulo, tipo } = movimiento
            setMovimiento(null)
            mostrarToast(
              tipo === 'INGRESO'
                ? `Ingreso registrado: ${articulo.nombre} (quedan ${stockNuevo}).`
                : `Salida registrada: ${articulo.nombre} (quedan ${stockNuevo}).`,
              'exito',
            )
            if (stockNuevo != null) {
              setDetalle((anterior) =>
                anterior?.id === articulo.id ? { ...anterior, stock_actual: stockNuevo } : anterior,
              )
            }
            recargar()
          }}
        />
      )}

      {modalArticulo && (
        <ModalArticuloAlmacen
          articulo={modalArticulo === 'nuevo' ? null : modalArticulo}
          categoriasExistentes={resumen.categorias}
          onCerrar={() => setModalArticulo(null)}
          onGuardado={() => {
            const esNuevo = modalArticulo === 'nuevo'
            setModalArticulo(null)
            // Tras editar desde el detalle, ese modal se cierra: sus datos (nombre, mínimo, estado) quedarían viejos.
            if (!esNuevo) setDetalle(null)
            mostrarToast(esNuevo ? 'Artículo creado.' : 'Artículo actualizado.', 'exito')
            recargar()
          }}
        />
      )}

      {articuloAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div
            ref={panelEliminarRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
          >
            <h2 className="text-base font-semibold text-ink">¿Eliminar "{articuloAEliminar.nombre}"?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Si ya tiene movimientos, en vez de eliminarse se desactivará para no perder el historial.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setArticuloAEliminar(null)}
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
