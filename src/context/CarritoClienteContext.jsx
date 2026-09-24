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
  const [cargando, setCargando] = useState(true)

  const recargar = useCallback(async () => {
    const [serviciosRes, productosRes] = await Promise.all([
      supabase.from('carrito_servicios').select('servicio_id'),
      supabase.from('carrito_productos').select('producto_id, cantidad'),
    ])
    setServiciosCarrito(new Set((serviciosRes.data ?? []).map((fila) => fila.servicio_id)))
    setProductosCarrito(
      new Map((productosRes.data ?? []).map((fila) => [fila.producto_id, fila.cantidad])),
    )
    setCargando(false)
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  const agregarServicio = useCallback(
    async (servicioId) => {
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

  const agregarProducto = useCallback(
    async (productoId) => {
      const cantidadActual = productosCarrito.get(productoId)
      const { error } = cantidadActual
        ? await supabase
            .from('carrito_productos')
            .update({ cantidad: cantidadActual + 1 })
            .eq('cliente_web_id', usuario.id)
            .eq('producto_id', productoId)
        : await supabase
            .from('carrito_productos')
            .insert({ cliente_web_id: usuario.id, producto_id: productoId, cantidad: 1 })
      if (error) return false
      setProductosCarrito((anterior) => {
        const siguiente = new Map(anterior)
        siguiente.set(productoId, (cantidadActual ?? 0) + 1)
        return siguiente
      })
      return true
    },
    [usuario, productosCarrito],
  )

  const cambiarCantidadProducto = useCallback(
    async (productoId, cantidad) => {
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

  const totalItems = serviciosCarrito.size + productosCarrito.size

  const value = useMemo(
    () => ({
      serviciosCarrito,
      productosCarrito,
      cargando,
      totalItems,
      recargar,
      agregarServicio,
      quitarServicio,
      agregarProducto,
      quitarProducto,
      cambiarCantidadProducto,
    }),
    [
      serviciosCarrito,
      productosCarrito,
      cargando,
      totalItems,
      recargar,
      agregarServicio,
      quitarServicio,
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
