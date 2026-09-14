import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearFechaISO } from '../lib/fechas.js'
import Etiqueta from './Etiqueta.jsx'

const OPCIONES_METODO_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'Yape']

function formularioVacio() {
  return {
    cantidad: '1',
    precioUnitario: '',
    fecha: formatearFechaISO(new Date()),
    numeroComprobante: '',
    metodoPago: '',
    condicionCompra: 'NUEVO',
    garantiaMeses: '',
    garantiaDetalle: '',
    proveedorNombre: '',
    proveedorTelefono: '',
    proveedorDireccion: '',
    proveedorWeb: '',
    proveedorContacto: '',
    linkProducto: '',
    notas: '',
  }
}

function formularioDesdeCompra(compra) {
  return {
    cantidad: String(compra.cantidad ?? 1),
    precioUnitario: String(compra.precio_unitario ?? ''),
    fecha: compra.fecha ?? formatearFechaISO(new Date()),
    numeroComprobante: compra.numero_comprobante ?? '',
    metodoPago: compra.metodo_pago ?? '',
    condicionCompra: compra.condicion_compra ?? 'NUEVO',
    garantiaMeses: compra.garantia_meses != null ? String(compra.garantia_meses) : '',
    garantiaDetalle: compra.garantia_detalle ?? '',
    proveedorNombre: compra.proveedor_nombre ?? '',
    proveedorTelefono: compra.proveedor_telefono ?? '',
    proveedorDireccion: compra.proveedor_direccion ?? '',
    proveedorWeb: compra.proveedor_web ?? '',
    proveedorContacto: compra.proveedor_contacto ?? '',
    linkProducto: compra.link_producto ?? '',
    notas: compra.notas ?? '',
  }
}

function validar(formulario) {
  if (!formulario.proveedorNombre.trim()) return 'El nombre del proveedor es obligatorio.'

  const cantidad = parseInt(formulario.cantidad, 10)
  if (Number.isNaN(cantidad) || cantidad <= 0) return 'La cantidad debe ser mayor a 0.'

  const precio = parseFloat(formulario.precioUnitario)
  if (Number.isNaN(precio) || precio < 0) return 'El precio unitario debe ser un número válido.'

  if (!formulario.fecha) return 'Selecciona la fecha de compra.'

  if (formulario.garantiaMeses.trim()) {
    const meses = parseInt(formulario.garantiaMeses, 10)
    if (Number.isNaN(meses) || meses < 0) return 'La garantía en meses no es válida.'
  }

  return null
}

export default function ModalCompraMobiliario({ mobiliarioId, compra, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const esEdicion = Boolean(compra)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeCompra(compra) : formularioVacio(),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  const cantidadNumero = parseInt(formulario.cantidad, 10)
  const precioUnitarioNumero = parseFloat(formulario.precioUnitario)
  const totalCalculado =
    !Number.isNaN(cantidadNumero) && !Number.isNaN(precioUnitarioNumero)
      ? cantidadNumero * precioUnitarioNumero
      : null

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    setGuardando(true)
    setError(null)

    const cantidad = parseInt(formulario.cantidad, 10)
    const precioUnitario = parseFloat(formulario.precioUnitario)

    const datos = {
      cantidad,
      precio_unitario: precioUnitario,
      precio_total: Math.round(cantidad * precioUnitario * 100) / 100,
      fecha: formulario.fecha,
      numero_comprobante: formulario.numeroComprobante.trim() || null,
      metodo_pago: formulario.metodoPago || null,
      condicion_compra: formulario.condicionCompra,
      garantia_meses: formulario.garantiaMeses.trim() ? parseInt(formulario.garantiaMeses, 10) : null,
      garantia_detalle: formulario.garantiaDetalle.trim() || null,
      proveedor_nombre: formulario.proveedorNombre.trim(),
      proveedor_telefono: formulario.proveedorTelefono.trim() || null,
      proveedor_direccion: formulario.proveedorDireccion.trim() || null,
      proveedor_web: formulario.proveedorWeb.trim() || null,
      proveedor_contacto: formulario.proveedorContacto.trim() || null,
      link_producto: formulario.linkProducto.trim() || null,
      notas: formulario.notas.trim() || null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('mobiliario_compras').update(datos).eq('id', compra.id)
      : await supabase
          .from('mobiliario_compras')
          .insert({ ...datos, mobiliario_id: mobiliarioId, creado_por: usuario.id })

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar la compra. Intenta de nuevo.')
      return
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar compra' : 'Nueva compra'}
        </h2>

        <div className="mt-4 space-y-3">
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink/60">
            Datos del proveedor
          </p>

          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-proveedor`}>Nombre del proveedor</Etiqueta>
            <input
              id={`${idBase}-proveedor`}
              type="search"
              autoComplete="new-password"
              value={formulario.proveedorNombre}
              onChange={(evento) => actualizarCampo('proveedorNombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-prov-tel`}>Teléfono</Etiqueta>
              <input
                id={`${idBase}-prov-tel`}
                type="search"
                inputMode="tel"
                autoComplete="new-password"
                value={formulario.proveedorTelefono}
                onChange={(evento) => actualizarCampo('proveedorTelefono', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-prov-contacto`}>Persona de contacto</Etiqueta>
              <input
                id={`${idBase}-prov-contacto`}
                type="search"
                autoComplete="new-password"
                value={formulario.proveedorContacto}
                onChange={(evento) => actualizarCampo('proveedorContacto', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-prov-direccion`}>Dirección</Etiqueta>
            <input
              id={`${idBase}-prov-direccion`}
              type="search"
              autoComplete="new-password"
              value={formulario.proveedorDireccion}
              onChange={(evento) => actualizarCampo('proveedorDireccion', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-prov-web`}>Web / red social</Etiqueta>
              <input
                id={`${idBase}-prov-web`}
                type="search"
                autoComplete="new-password"
                value={formulario.proveedorWeb}
                onChange={(evento) => actualizarCampo('proveedorWeb', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-link`}>Link del producto</Etiqueta>
              <input
                id={`${idBase}-link`}
                type="search"
                autoComplete="new-password"
                value={formulario.linkProducto}
                onChange={(evento) => actualizarCampo('linkProducto', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <p className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink/60">
            Datos de la compra
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-cantidad`}>Cantidad</Etiqueta>
              <input
                id={`${idBase}-cantidad`}
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                value={formulario.cantidad}
                onChange={(evento) => actualizarCampo('cantidad', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-precio`}>Precio unitario</Etiqueta>
              <input
                id={`${idBase}-precio`}
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.precioUnitario}
                onChange={(evento) => actualizarCampo('precioUnitario', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>
          </div>
          {totalCalculado != null && (
            <p className="-mt-1 text-xs text-ink/60">
              Total: <span className="font-mono text-purple-300">S/ {totalCalculado.toFixed(2)}</span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Fecha de compra</Etiqueta>
              <input
                id={`${idBase}-fecha`}
                type="date"
                value={formulario.fecha}
                onChange={(evento) => actualizarCampo('fecha', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-comprobante`}>N° de comprobante</Etiqueta>
              <input
                id={`${idBase}-comprobante`}
                type="search"
                autoComplete="new-password"
                value={formulario.numeroComprobante}
                onChange={(evento) => actualizarCampo('numeroComprobante', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-metodo`}>Método de pago</Etiqueta>
              <select
                id={`${idBase}-metodo`}
                value={formulario.metodoPago}
                onChange={(evento) => actualizarCampo('metodoPago', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="">Sin especificar</option>
                {OPCIONES_METODO_PAGO.map((metodo) => (
                  <option key={metodo} value={metodo}>
                    {metodo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-condicion-compra`}>Condición</Etiqueta>
              <select
                id={`${idBase}-condicion-compra`}
                value={formulario.condicionCompra}
                onChange={(evento) => actualizarCampo('condicionCompra', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="NUEVO">Nuevo</option>
                <option value="USADO">Usado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-garantia-meses`}>Garantía (meses)</Etiqueta>
              <input
                id={`${idBase}-garantia-meses`}
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                value={formulario.garantiaMeses}
                onChange={(evento) => actualizarCampo('garantiaMeses', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-garantia-detalle`}>Qué cubre la garantía</Etiqueta>
              <input
                id={`${idBase}-garantia-detalle`}
                type="search"
                autoComplete="new-password"
                value={formulario.garantiaDetalle}
                onChange={(evento) => actualizarCampo('garantiaDetalle', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-notas`}>Notas</Etiqueta>
            <textarea
              id={`${idBase}-notas`}
              autoComplete="off"
              value={formulario.notas}
              onChange={(evento) => actualizarCampo('notas', evento.target.value)}
              placeholder="Opcional"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
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
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
