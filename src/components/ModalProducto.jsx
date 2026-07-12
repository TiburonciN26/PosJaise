import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const STOCK_MINIMO_POR_DEFECTO = 3
const OPCION_NUEVA_CATEGORIA = '__nueva__'

const formularioVacio = {
  codigoBarras: '',
  nombre: '',
  categoriaSeleccionada: '',
  categoriaNueva: '',
  costo: '',
  precio: '',
  stockInicial: '',
  proveedor: '',
}

function Etiqueta({ children, obligatorio }) {
  return (
    <label className="mb-1 block text-xs text-ink/60">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

function formularioDesdeProducto(producto) {
  return {
    codigoBarras: producto.codigo_barras ?? '',
    nombre: producto.nombre ?? '',
    categoriaSeleccionada: producto.categoria ?? '',
    categoriaNueva: '',
    costo: String(producto.costo ?? ''),
    precio: String(producto.precio ?? ''),
    stockInicial: String(producto.stock_actual ?? ''),
    proveedor: producto.proveedor ?? '',
  }
}

function validar(formulario) {
  if (!formulario.nombre.trim()) return 'El nombre es obligatorio.'

  const costo = parseFloat(formulario.costo)
  if (Number.isNaN(costo) || costo < 0) {
    return 'El costo debe ser un número mayor o igual a 0.'
  }

  const precio = parseFloat(formulario.precio)
  if (Number.isNaN(precio) || precio <= 0) {
    return 'El precio de venta debe ser un número mayor a 0.'
  }

  const stockInicial = parseInt(formulario.stockInicial, 10)
  if (Number.isNaN(stockInicial) || stockInicial < 0) {
    return 'El stock inicial debe ser 0 o más.'
  }

  return null
}

export default function ModalProducto({ producto, categoriasExistentes, onCerrar, onGuardado }) {
  const esEdicion = Boolean(producto)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeProducto(producto) : formularioVacio,
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  const costoNumerico = parseFloat(formulario.costo) || 0
  const precioNumerico = parseFloat(formulario.precio) || 0
  const ganancia = precioNumerico - costoNumerico

  // La categoría actual del producto puede no estar en categoriasExistentes
  // si viene de otra fuente; la agregamos para que el <select> la muestre.
  const opcionesCategoria =
    esEdicion && producto.categoria && !categoriasExistentes.includes(producto.categoria)
      ? [producto.categoria, ...categoriasExistentes]
      : categoriasExistentes

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    const categoriaFinal =
      formulario.categoriaSeleccionada === OPCION_NUEVA_CATEGORIA
        ? formulario.categoriaNueva.trim()
        : formulario.categoriaSeleccionada

    setGuardando(true)
    setError(null)

    // Sin .select(): si pidiéramos de vuelta la fila afectada, Postgres
    // rechazaría la columna "costo" para el rol authenticated (ver 03_rls.sql).
    // La lista se refresca aparte, leyendo de productos_vista.
    const datos = {
      codigo_barras: formulario.codigoBarras.trim() || null,
      nombre: formulario.nombre.trim(),
      categoria: categoriaFinal || null,
      precio: precioNumerico,
      costo: costoNumerico,
      stock_actual: parseInt(formulario.stockInicial, 10),
      proveedor: formulario.proveedor.trim() || null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('productos').update(datos).eq('id', producto.id)
      : await supabase
          .from('productos')
          .insert({ ...datos, stock_minimo: STOCK_MINIMO_POR_DEFECTO })

    setGuardando(false)

    if (errorGuardado) {
      if (errorGuardado.code === '23505') {
        setError('Ya existe un producto con ese código de barras.')
      } else {
        setError('No se pudo guardar el producto. Intenta de nuevo.')
      }
      return
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar producto' : 'Nuevo producto'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio>Nombre</Etiqueta>
            <input
              type="text"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta>Código de barras</Etiqueta>
            <input
              type="text"
              value={formulario.codigoBarras}
              onChange={(evento) => actualizarCampo('codigoBarras', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>

          <div>
            <Etiqueta>Categoría</Etiqueta>
            <select
              value={formulario.categoriaSeleccionada}
              onChange={(evento) => actualizarCampo('categoriaSeleccionada', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            >
              <option value="">Selecciona categoría</option>
              {opcionesCategoria.map((categoria) => (
                <option key={categoria} value={categoria}>
                  {categoria}
                </option>
              ))}
              <option value={OPCION_NUEVA_CATEGORIA}>+ Nueva categoría</option>
            </select>

            {formulario.categoriaSeleccionada === OPCION_NUEVA_CATEGORIA && (
              <input
                type="text"
                value={formulario.categoriaNueva}
                onChange={(evento) => actualizarCampo('categoriaNueva', evento.target.value)}
                placeholder="Nombre de la nueva categoría"
                autoFocus
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            )}
          </div>

          <div>
            <Etiqueta obligatorio>{esEdicion ? 'Stock actual' : 'Stock inicial'}</Etiqueta>
            <input
              type="number"
              inputMode="numeric"
              value={formulario.stockInicial}
              onChange={(evento) => actualizarCampo('stockInicial', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Etiqueta obligatorio>Costo</Etiqueta>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formulario.costo}
                onChange={(evento) => actualizarCampo('costo', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
            <div className="flex-1">
              <Etiqueta obligatorio>Precio de venta</Etiqueta>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formulario.precio}
                onChange={(evento) => actualizarCampo('precio', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
            <div className="shrink-0">
              <Etiqueta>Ganancia</Etiqueta>
              <div className="whitespace-nowrap rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-green">
                S/ {ganancia.toFixed(2)}
              </div>
            </div>
          </div>

          <div>
            <Etiqueta>Proveedor</Etiqueta>
            <input
              type="text"
              value={formulario.proveedor}
              onChange={(evento) => actualizarCampo('proveedor', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
