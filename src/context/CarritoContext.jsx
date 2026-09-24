import { createContext, useContext, useMemo, useState } from 'react'

const CarritoContext = createContext(null)

export function CarritoProvider({ children }) {
  const [carrito, setCarrito] = useState([])
  const [metodoPago, setMetodoPago] = useState(null)
  const [montoRecibido, setMontoRecibido] = useState('')
  const [montoPosTarjeta, setMontoPosTarjeta] = useState('')
  const [cliente, setCliente] = useState(null)
  // tipoDescuento: 'porcentaje' (valorDescuento es un % 0-100), 'monto'
  // (valorDescuento son soles fijos) o 'cupon' (codigoCupon es el código
  // que muestra la clienta — el monto lo resuelve el servidor, nunca se
  // teclea a mano, ver confirmar_venta() en 95_cupones_referido.sql). El
  // botón de descuento rota entre los tres y limpia los valores de los
  // otros dos al cambiar, para no reinterpretar un dato tecleado para un
  // modo distinto.
  const [tipoDescuento, setTipoDescuento] = useState('porcentaje')
  const [valorDescuento, setValorDescuento] = useState('')
  const [codigoCupon, setCodigoCupon] = useState('')

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
      montoPosTarjeta,
      setMontoPosTarjeta,
      cliente,
      setCliente,
      tipoDescuento,
      setTipoDescuento,
      valorDescuento,
      setValorDescuento,
      codigoCupon,
      setCodigoCupon,
    }),
    [
      carrito,
      metodoPago,
      montoRecibido,
      montoPosTarjeta,
      cliente,
      tipoDescuento,
      valorDescuento,
      codigoCupon,
    ],
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
