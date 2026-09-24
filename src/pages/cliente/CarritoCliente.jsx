import { useEffect, useState } from 'react'
import { Bike, MapPin, Minus, Plus, Scissors, ShoppingBag, Store, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import ModalAgendarCitaCliente from '../../components/ModalAgendarCitaCliente.jsx'

function EtiquetaCampo({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-white/50">
      {children}
    </label>
  )
}

// Carrito del portal cliente — dos bloques SIEMPRE separados a propósito
// (pedido explícito del usuario): Servicios (solo intención de reserva,
// "Reservar cita" llama a agendar_cita_web() con los marcados — no se
// venden ni tienen delivery) y Productos (con cantidad, "Confirmar
// compra" llama a confirmar_pedido_productos(), 85_carrito_pedidos_web.sql
// — crea un pedido real para que el personal lo gestione desde "Pedidos
// Web" en el POS; sin pago online, el pedido queda PENDIENTE).
export default function CarritoCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { recargar: recargarCarrito } = useCarritoCliente()

  const [cargando, setCargando] = useState(true)
  const [serviciosCarrito, setServiciosCarrito] = useState([])
  const [productosCarrito, setProductosCarrito] = useState([])
  const [zonas, setZonas] = useState([])
  const [direcciones, setDirecciones] = useState([])

  const [serviciosMarcados, setServiciosMarcados] = useState(() => new Set())
  const [productosMarcados, setProductosMarcados] = useState(() => new Set())
  const [mostrarAgendar, setMostrarAgendar] = useState(false)

  const [tipoEntrega, setTipoEntrega] = useState('RECOJO_TIENDA')
  const [zonaId, setZonaId] = useState('')
  const [direccionId, setDireccionId] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [errorProductos, setErrorProductos] = useState('')

  async function cargar() {
    const [serviciosRes, productosRes, zonasRes, direccionesRes] = await Promise.all([
      supabase.from('carrito_servicios').select('servicio_id, servicios(nombre, precio, duracion_min)'),
      supabase
        .from('carrito_productos')
        .select('producto_id, cantidad, productos(nombre, precio, stock_actual)'),
      supabase.from('zonas_delivery').select('id, nombre, costo').order('costo'),
      supabase
        .from('direcciones_cliente')
        .select('id, etiqueta, direccion, celular, referencia, predeterminada')
        .order('predeterminada', { ascending: false })
        .order('creado_en', { ascending: true }),
    ])

    const servicios = (serviciosRes.data ?? [])
      .filter((fila) => fila.servicios)
      .map((fila) => ({ id: fila.servicio_id, ...fila.servicios }))
    const productos = (productosRes.data ?? [])
      .filter((fila) => fila.productos)
      .map((fila) => ({ id: fila.producto_id, cantidad: fila.cantidad, ...fila.productos }))
    const direccionesGuardadas = direccionesRes.data ?? []

    setServiciosCarrito(servicios)
    setProductosCarrito(productos)
    setZonas(zonasRes.data ?? [])
    setDirecciones(direccionesGuardadas)
    setDireccionId((anterior) => {
      if (anterior && direccionesGuardadas.some((d) => d.id === anterior)) return anterior
      return direccionesGuardadas[0]?.id ?? ''
    })
    // Por defecto todo marcado — el cliente desmarca lo que NO quiere
    // resolver todavía, en vez de tener que marcar uno por uno.
    setServiciosMarcados(new Set(servicios.map((s) => s.id)))
    setProductosMarcados(new Set(productos.map((p) => p.id)))
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function alternarServicio(id) {
    setServiciosMarcados((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function quitarServicioDelCarrito(id) {
    await supabase
      .from('carrito_servicios')
      .delete()
      .eq('cliente_web_id', usuario.id)
      .eq('servicio_id', id)
    setServiciosCarrito((anterior) => anterior.filter((s) => s.id !== id))
    setServiciosMarcados((anterior) => {
      const siguiente = new Set(anterior)
      siguiente.delete(id)
      return siguiente
    })
    recargarCarrito()
  }

  function alternarProducto(id) {
    setProductosMarcados((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function cambiarCantidad(id, cantidad) {
    if (cantidad <= 0) {
      await supabase
        .from('carrito_productos')
        .delete()
        .eq('cliente_web_id', usuario.id)
        .eq('producto_id', id)
      setProductosCarrito((anterior) => anterior.filter((p) => p.id !== id))
      setProductosMarcados((anterior) => {
        const siguiente = new Set(anterior)
        siguiente.delete(id)
        return siguiente
      })
    } else {
      await supabase
        .from('carrito_productos')
        .update({ cantidad })
        .eq('cliente_web_id', usuario.id)
        .eq('producto_id', id)
      setProductosCarrito((anterior) =>
        anterior.map((p) => (p.id === id ? { ...p, cantidad } : p)),
      )
    }
    recargarCarrito()
  }

  async function alAgendarExito(horarioElegido, serviciosIds) {
    setMostrarAgendar(false)
    mostrarToast('Cita agendada.', 'exito')
    await supabase
      .from('carrito_servicios')
      .delete()
      .eq('cliente_web_id', usuario.id)
      .in('servicio_id', serviciosIds)
    recargarCarrito()
    cargar()
  }

  async function confirmarCompra() {
    setErrorProductos('')

    if (productosMarcados.size === 0) {
      setErrorProductos('Selecciona al menos un producto.')
      return
    }
    const direccionElegida = direcciones.find((d) => d.id === direccionId)
    if (tipoEntrega === 'DELIVERY' && (!zonaId || !direccionElegida)) {
      setErrorProductos('Elige tu zona y una dirección guardada para el delivery.')
      return
    }

    const direccionTexto = direccionElegida
      ? `${direccionElegida.direccion}${direccionElegida.referencia ? ' - ' + direccionElegida.referencia : ''}`
      : null

    setConfirmando(true)
    const { error } = await supabase.rpc('confirmar_pedido_productos', {
      p_producto_ids: [...productosMarcados],
      p_tipo_entrega: tipoEntrega,
      p_zona_delivery_id: tipoEntrega === 'DELIVERY' ? zonaId : null,
      p_direccion: tipoEntrega === 'DELIVERY' ? direccionTexto : null,
      p_celular_entrega: tipoEntrega === 'DELIVERY' ? direccionElegida?.celular ?? null : null,
    })
    setConfirmando(false)

    if (error) {
      setErrorProductos(error.message || 'No se pudo confirmar el pedido. Intenta de nuevo.')
      return
    }

    mostrarToast('¡Pedido confirmado! Nos contactaremos para coordinar el pago y la entrega.', 'exito')
    recargarCarrito()
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  const zonaElegida = zonas.find((z) => z.id === zonaId)
  const subtotalProductos = productosCarrito
    .filter((p) => productosMarcados.has(p.id))
    .reduce((suma, p) => suma + p.precio * p.cantidad, 0)
  const costoDelivery = tipoEntrega === 'DELIVERY' ? (zonaElegida?.costo ?? 0) : 0
  const totalProductos = subtotalProductos + costoDelivery

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Bloque de Servicios — nunca se mezcla con Productos */}
        <section className="liquid-glass rounded-none p-4 md:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Scissors className="h-4 w-4 text-[var(--lw-gold)]" />
            Servicios
          </h2>

          {serviciosCarrito.length === 0 ? (
            <p className="mt-3 text-sm text-white/50">
              Todavía no agregaste servicios. Ve a Servicios y agrégalos desde ahí.
            </p>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                {serviciosCarrito.map((servicio) => (
                  <label
                    key={servicio.id}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={serviciosMarcados.has(servicio.id)}
                        onChange={() => alternarServicio(servicio.id)}
                        className="h-4 w-4 shrink-0 accent-[var(--lw-gold)]"
                      />
                      <span className="min-w-0 truncate text-sm text-white">{servicio.nombre}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs text-white/60">
                        {formatearSoles(servicio.precio)}
                      </span>
                      <button
                        type="button"
                        onClick={() => quitarServicioDelCarrito(servicio.id)}
                        aria-label="Quitar del carrito"
                        className="text-white/40 transition-colors hover:text-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setMostrarAgendar(true)}
                disabled={serviciosMarcados.size === 0}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--lw-gold)] py-2.5 text-sm font-semibold text-black disabled:opacity-40"
              >
                Reservar cita ({serviciosMarcados.size})
              </button>
            </>
          )}
        </section>

        {/* Bloque de Productos — separado del de Servicios */}
        <section className="liquid-glass rounded-none p-4 md:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <ShoppingBag className="h-4 w-4 text-[var(--lw-gold)]" />
            Productos
          </h2>

          {productosCarrito.length === 0 ? (
            <p className="mt-3 text-sm text-white/50">
              Todavía no agregaste productos. Ve a Productos y agrégalos desde ahí.
            </p>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                {productosCarrito.map((producto) => (
                  <div
                    key={producto.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={productosMarcados.has(producto.id)}
                        onChange={() => alternarProducto(producto.id)}
                        className="h-4 w-4 shrink-0 accent-[var(--lw-gold)]"
                      />
                      <span className="min-w-0 truncate text-sm text-white">{producto.nombre}</span>
                    </label>

                    <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-1 py-0.5">
                      <button
                        type="button"
                        onClick={() => cambiarCantidad(producto.id, producto.cantidad - 1)}
                        aria-label="Quitar uno"
                        className="flex h-5 w-5 items-center justify-center text-white/70"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-4 text-center text-xs text-white">{producto.cantidad}</span>
                      <button
                        type="button"
                        onClick={() => cambiarCantidad(producto.id, producto.cantidad + 1)}
                        aria-label="Agregar uno"
                        className="flex h-5 w-5 items-center justify-center text-white/70"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    <span className="w-16 shrink-0 text-right font-mono text-xs text-white/60">
                      {formatearSoles(producto.precio * producto.cantidad)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <EtiquetaCampo>Entrega</EtiquetaCampo>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTipoEntrega('RECOJO_TIENDA')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      tipoEntrega === 'RECOJO_TIENDA'
                        ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)]/10 text-[var(--lw-gold)]'
                        : 'border-white/15 text-white/70 hover:border-white/30'
                    }`}
                  >
                    <Store className="h-3.5 w-3.5" />
                    Recojo en tienda
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoEntrega('DELIVERY')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      tipoEntrega === 'DELIVERY'
                        ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)]/10 text-[var(--lw-gold)]'
                        : 'border-white/15 text-white/70 hover:border-white/30'
                    }`}
                  >
                    <Bike className="h-3.5 w-3.5" />
                    Delivery
                  </button>
                </div>

                {tipoEntrega === 'DELIVERY' && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <EtiquetaCampo htmlFor="carrito-zona">Zona</EtiquetaCampo>
                      <select
                        id="carrito-zona"
                        value={zonaId}
                        onChange={(evento) => setZonaId(evento.target.value)}
                        className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--lw-gold)]"
                      >
                        <option value="">Selecciona tu zona</option>
                        {zonas.map((zona) => (
                          <option key={zona.id} value={zona.id}>
                            {zona.nombre} — {formatearSoles(zona.costo)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <EtiquetaCampo htmlFor="carrito-direccion">Dirección</EtiquetaCampo>
                        <Link
                          to="/mi-perfil/direcciones"
                          className="flex items-center gap-1 text-xs text-white/50 transition-colors hover:text-[var(--lw-gold)]"
                        >
                          <MapPin className="h-3 w-3" />
                          Gestionar
                        </Link>
                      </div>
                      {direcciones.length === 0 ? (
                        <Link
                          to="/mi-perfil/direcciones"
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2.5 text-sm text-white/60 transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Agregar una dirección
                        </Link>
                      ) : (
                        <select
                          id="carrito-direccion"
                          value={direccionId}
                          onChange={(evento) => setDireccionId(evento.target.value)}
                          className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--lw-gold)]"
                        >
                          {direcciones.map((direccion) => (
                            <option key={direccion.id} value={direccion.id}>
                              {direccion.etiqueta} — {direccion.direccion}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-1 border-t border-white/10 pt-4 text-sm">
                <div className="flex justify-between text-white/60">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatearSoles(subtotalProductos)}</span>
                </div>
                {tipoEntrega === 'DELIVERY' && (
                  <div className="flex justify-between text-white/60">
                    <span>Delivery</span>
                    <span className="font-mono">{formatearSoles(costoDelivery)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-semibold text-white">
                  <span>Total</span>
                  <span className="font-mono text-[var(--lw-gold)]">{formatearSoles(totalProductos)}</span>
                </div>
              </div>

              {errorProductos && (
                <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                  {errorProductos}
                </p>
              )}

              <button
                type="button"
                onClick={confirmarCompra}
                disabled={
                  confirmando ||
                  productosMarcados.size === 0 ||
                  (tipoEntrega === 'DELIVERY' && direcciones.length === 0)
                }
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--lw-gold)] py-2.5 text-sm font-semibold text-black disabled:opacity-40"
              >
                {confirmando ? 'Confirmando...' : `Confirmar compra (${productosMarcados.size})`}
              </button>
              <p className="mt-2 text-center text-xs text-white/40">
                Sin pago en línea todavía — nos contactaremos para coordinar el cobro y la entrega.
              </p>
            </>
          )}
        </section>
      </div>

      {mostrarAgendar && (
        <ModalAgendarCitaCliente
          serviciosIniciales={[...serviciosMarcados]}
          onCerrar={() => setMostrarAgendar(false)}
          onAgendada={alAgendarExito}
        />
      )}
    </div>
  )
}
