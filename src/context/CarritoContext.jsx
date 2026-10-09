import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { limpiarPendiente, marcarPendiente } from '../lib/trabajoPendiente.js'

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

  // Fase 2B (B4): una venta en curso vive solo en memoria; se registra como trabajo pendiente para que el aviso de
  // «versión nueva» no recargue la página y la borre. Solo informa: no cambia cobros, cupones ni stock.
  const ventaEnCurso =
    carrito.length > 0 ||
    !!cliente ||
    !!metodoPago ||
    montoRecibido !== '' ||
    montoPosTarjeta !== '' ||
    valorDescuento !== '' ||
    codigoCupon !== ''
  useEffect(() => {
    if (ventaEnCurso) marcarPendiente('caja-venta', 'una venta en curso en la caja')
    else limpiarPendiente('caja-venta')
    return () => limpiarPendiente('caja-venta')
  }, [ventaEnCurso])

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
