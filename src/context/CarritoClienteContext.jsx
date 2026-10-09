import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const CarritoClienteContext = createContext(null)

// Carrito del portal cliente (servicios a reservar + productos a pedir) —
// NO confundir con CarritoContext.jsx, que es el carrito de venta EN CAJA
// del POS interno, algo completamente distinto. Compartido por
// ServiciosCliente/ProductosCliente (para saber qué ya está en el
// carrito y poder agregar/quitar) y CarritoCliente.jsx (la pantalla del
// carrito) — mismo motivo que PerfilClienteContext: un solo fetch, todos
// ven el mismo estado sin recargar la página.
export function CarritoClienteProvider({ children }) {
  const { usuario } = useAuth()
  const [serviciosCarrito, setServiciosCarrito] = useState(() => new Set())
  const [productosCarrito, setProductosCarrito] = useState(() => new Map())
  const [cargando, setCargando] = useState(Boolean(usuario))

  // Sin sesión (visitante) el carrito no existe: no se consulta y queda vacío.
  // El portal no se remonta al iniciar o cerrar sesión, así que el efecto depende
  // del id del usuario: carga el carrito al entrar y lo vacía al salir (el
  // siguiente visitante nunca ve el carrito anterior).
  const usuarioId = usuario?.id ?? null

  const recargar = useCallback(async () => {
    if (!usuarioId) {
      setServiciosCarrito(new Set())
      setProductosCarrito(new Map())
      setCargando(false)
      return
    }
    const [serviciosRes, productosRes] = await Promise.all([
      supabase.from('carrito_servicios').select('servicio_id'),
      supabase.from('carrito_productos').select('producto_id, cantidad'),
    ])
    setServiciosCarrito(new Set((serviciosRes.data ?? []).map((fila) => fila.servicio_id)))
    setProductosCarrito(
      new Map((productosRes.data ?? []).map((fila) => [fila.producto_id, fila.cantidad])),
    )
    setCargando(false)
  }, [usuarioId])

  useEffect(() => {
    if (usuarioId) setCargando(true)
    recargar()
  }, [usuarioId, recargar])

  const agregarServicio = useCallback(
    async (servicioId) => {
      if (!usuario) return false
      const { error } = await supabase
        .from('carrito_servicios')
        .insert({ cliente_web_id: usuario.id, servicio_id: servicioId })
      if (error) return false
      setServiciosCarrito((anterior) => new Set(anterior).add(servicioId))
      return true
    },
    [usuario],
  )

  const quitarServicio = useCallback(
    async (servicioId) => {
      if (!usuario) return false
      const { error } = await supabase
        .from('carrito_servicios')
        .delete()
        .eq('cliente_web_id', usuario.id)
        .eq('servicio_id', servicioId)
      if (error) return false
      setServiciosCarrito((anterior) => {
        const siguiente = new Set(anterior)
        siguiente.delete(servicioId)
        return siguiente
      })
      return true
    },
    [usuario],
  )

  // Vacía de una sola vez los servicios que ya se convirtieron en una
  // cita real (mini-carrito de Citas → ModalAgendarCitaCliente) —
  // dejarlos ahí después de agendar sería como un carrito de compras
  // que no se vacía al pagar. Un solo DELETE con `.in()`, no un
  // quitarServicio() por cada uno.
  const vaciarServiciosReservados = useCallback(
    async (servicioIds) => {
      if (!usuario || !servicioIds || servicioIds.length === 0) return
      const { error } = await supabase
        .from('carrito_servicios')
        .delete()
        .eq('cliente_web_id', usuario.id)
        .in('servicio_id', servicioIds)
      if (error) return
      setServiciosCarrito((anterior) => {
        const siguiente = new Set(anterior)
        for (const id of servicioIds) siguiente.delete(id)
        return siguiente
      })
    },
    [usuario],
  )

  const agregarProducto = useCallback(
    // `cantidad`: cuántas unidades sumar de una vez (no reemplaza lo que
    // ya había en el carrito, se suma) — ProductosCliente.jsx la usa con
    // su propio selector de cantidad local, independiente de lo que el
    // carrito ya tenga; ServiciosCliente-style "Agregar" simple sigue
    // funcionando igual al no pasar nada (default 1).
    //
    // Se vuelve a pedir `stock_actual` acá (no confiar en el tope que ya
    // aplicó ProductosCliente.jsx) — bug real reportado por el usuario:
    // sin este chequeo, volver a Productos después de agregar dejaba
    // agregar de nuevo hasta el stock completo sin descontar lo que ya
    // estaba en el carrito (2+2 en un producto con stock real 2). El
    // límite de verdad (estricto, con `for update`) sigue siendo
    // confirmar_venta() al verificar el pago — esto es solo para no
    // dejar que el carrito prometa más de lo que existe.
    async (productoId, cantidad = 1) => {
      if (!usuario) return 0
      const cantidadActual = productosCarrito.get(productoId) ?? 0

      const { data: producto } = await supabase
        .from('productos')
        .select('stock_actual')
        .eq('id', productoId)
        .single()
      const disponible = Math.max(0, (producto?.stock_actual ?? 0) - cantidadActual)
      // 0 en vez de false: el llamador necesita saber CUÁNTO se agregó
      // de verdad (puede ser menos de lo pedido si el stock alcanzaba
      // para menos) para mostrar un mensaje correcto — no solo si "salió
      // bien" o no.
      const cantidadAAgregar = Math.min(cantidad, disponible)
      if (cantidadAAgregar <= 0) return 0

      const cantidadNueva = cantidadActual + cantidadAAgregar
      const { error } = cantidadActual
        ? await supabase
            .from('carrito_productos')
            .update({ cantidad: cantidadNueva })
            .eq('cliente_web_id', usuario.id)
            .eq('producto_id', productoId)
        : await supabase
            .from('carrito_productos')
            .insert({ cliente_web_id: usuario.id, producto_id: productoId, cantidad: cantidadNueva })
      if (error) return 0
      setProductosCarrito((anterior) => {
        const siguiente = new Map(anterior)
        siguiente.set(productoId, cantidadNueva)
        return siguiente
      })
      return cantidadAAgregar
    },
    [usuario, productosCarrito],
  )

  const cambiarCantidadProducto = useCallback(
    async (productoId, cantidad) => {
      if (!usuario) return false
      if (cantidad <= 0) {
        const { error } = await supabase
          .from('carrito_productos')
          .delete()
          .eq('cliente_web_id', usuario.id)
          .eq('producto_id', productoId)
        if (error) return false
        setProductosCarrito((anterior) => {
          const siguiente = new Map(anterior)
          siguiente.delete(productoId)
          return siguiente
        })
        return true
      }

      const { error } = await supabase
        .from('carrito_productos')
        .update({ cantidad })
        .eq('cliente_web_id', usuario.id)
        .eq('producto_id', productoId)
      if (error) return false
      setProductosCarrito((anterior) => new Map(anterior).set(productoId, cantidad))
      return true
    },
    [usuario],
  )

  const quitarProducto = useCallback(
    (productoId) => cambiarCantidadProducto(productoId, 0),
    [cambiarCantidadProducto],
  )

  // Solo productos: el ícono de carrito del header lleva a /carrito, que
  // desde el rediseño de Fase 1-4 es solo-productos — contar servicios
  // ahí también prometía un número que no coincidía con lo que esa
  // pantalla mostraba (bug real, corregido acá). Los servicios agregados
  // se ven y cuentan aparte, en su propio mini-carrito dentro de Citas.
  //
  // Suma las CANTIDADES, no `productosCarrito.size` (bug real reportado
  // por el usuario): `.size` cuenta líneas de producto distintas, así
  // que 2 unidades de un solo producto mostraban "1" en el badge — el
  // cliente esperaba ver el total de unidades, no de líneas.
  const totalItemsProductos = [...productosCarrito.values()].reduce((suma, cantidad) => suma + cantidad, 0)

  const value = useMemo(
    () => ({
      serviciosCarrito,
      productosCarrito,
      cargando,
      totalItemsProductos,
      recargar,
      agregarServicio,
      quitarServicio,
      vaciarServiciosReservados,
      agregarProducto,
      quitarProducto,
      cambiarCantidadProducto,
    }),
    [
      serviciosCarrito,
      productosCarrito,
      cargando,
      totalItemsProductos,
      recargar,
      agregarServicio,
      quitarServicio,
      vaciarServiciosReservados,
      agregarProducto,
      quitarProducto,
      cambiarCantidadProducto,
    ],
  )

  return <CarritoClienteContext.Provider value={value}>{children}</CarritoClienteContext.Provider>
}

export function useCarritoCliente() {
  const context = useContext(CarritoClienteContext)
  if (!context) {
    throw new Error('useCarritoCliente debe usarse dentro de un CarritoClienteProvider')
  }
  return context
}
