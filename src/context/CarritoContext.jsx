import { createContext, useContext, useMemo, useState } from 'react'

const CarritoContext = createContext(null)

export function CarritoProvider({ children }) {
  const [carrito, setCarrito] = useState([])
  const [metodoPago, setMetodoPago] = useState(null)
  const [montoRecibido, setMontoRecibido] = useState('')
  const [cliente, setCliente] = useState(null)

  // Memoizado (M5): los setState de React ya son estables, así que el value
  // solo cambia cuando cambia algún dato real del carrito, no en cada render.
  const value = useMemo(
    () => ({
      carrito,
      setCarrito,
      metodoPago,
      setMetodoPago,
      montoRecibido,
      setMontoRecibido,
      cliente,
      setCliente,
    }),
    [carrito, metodoPago, montoRecibido, cliente],
  )

  return <CarritoContext.Provider value={value}>{children}</CarritoContext.Provider>
}

export function useCarrito() {
  const context = useContext(CarritoContext)
  if (!context) {
    throw new Error('useCarrito debe usarse dentro de un CarritoProvider')
  }
  return context
}
