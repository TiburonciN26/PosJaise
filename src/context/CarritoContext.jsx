import { createContext, useContext, useState } from 'react'

const CarritoContext = createContext(null)

export function CarritoProvider({ children }) {
  const [carrito, setCarrito] = useState([])
  const [metodoPago, setMetodoPago] = useState(null)
  const [montoRecibido, setMontoRecibido] = useState('')
  const [cliente, setCliente] = useState(null)

  const value = {
    carrito,
    setCarrito,
    metodoPago,
    setMetodoPago,
    montoRecibido,
    setMontoRecibido,
    cliente,
    setCliente,
  }

  return <CarritoContext.Provider value={value}>{children}</CarritoContext.Provider>
}

export function useCarrito() {
  const context = useContext(CarritoContext)
  if (!context) {
    throw new Error('useCarrito debe usarse dentro de un CarritoProvider')
  }
  return context
}
