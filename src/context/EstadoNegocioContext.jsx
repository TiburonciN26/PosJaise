import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const EstadoNegocioContext = createContext(null)

// Única fuente de verdad: la fila public.estado_negocio en Supabase (ver
// 44_estado_negocio.sql), no una variable local — todo dispositivo
// conectado la lee al montar y se mantiene al día vía Realtime, sin
// necesidad de recargar la página.
export function EstadoNegocioProvider({ children }) {
  const { session, cargando: cargandoAuth } = useAuth()
  // Fail-open a propósito: esto es solo para la UI (mostrar el aviso,
  // habilitar/deshabilitar botones). La barrera real está en el servidor
  // (RLS + RPCs en 45_negocio_cerrado_bloquea_escrituras.sql), así que un
  // valor optimista acá no abre ningún hueco de seguridad.
  const [abierto, setAbierto] = useState(true)
  const [cuentaTransferencia, setCuentaTransferencia] = useState('')
  // Datos de Yape/Plin para el carrito web (ContactoWeb.jsx los edita,
  // ver 100_pedidos_web_pago.sql) — agrupados en un solo objeto, a
  // diferencia de `cuentaTransferencia` suelto, porque siempre se usan
  // juntos (número + titular + QR de cada método) y ya son 6 campos.
  const [pagos, setPagos] = useState({
    yapeNumero: '',
    yapeTitular: '',
    yapeQrUrl: null,
    plinNumero: '',
    plinTitular: '',
    plinQrUrl: null,
  })
  // Adelanto/cancelación configurables por el negocio (migración 115) —
  // el Detalle del servicio los muestra en la franja "Adelanto y pago" en
  // vez del placeholder [S/ X] / [24 h]; null = el negocio no lo cargó
  // todavía, y esa pantalla muestra un texto alternativo claro (QA-029).
  const [adelantoMinimo, setAdelantoMinimo] = useState(null)
  const [cancelacionPlazoHoras, setCancelacionPlazoHoras] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!session) {
      // QA-029: sin sesión AÚN (la auth sigue resolviendo la sesión guardada) no
      // es "sin configuración": marcarlo como cargado haría que el detalle del
      // servicio mostrara el texto de "no configurado" antes de que llegue la fila.
      if (!cargandoAuth) setCargando(false)
      return undefined
    }

    let vigente = true

    function aplicarFila(fila) {
      setAbierto(fila.abierto)
      setCuentaTransferencia(fila.cuenta_transferencia ?? '')
      setPagos({
        yapeNumero: fila.yape_numero ?? '',
        yapeTitular: fila.yape_titular ?? '',
        yapeQrUrl: fila.yape_qr_url ?? null,
        plinNumero: fila.plin_numero ?? '',
        plinTitular: fila.plin_titular ?? '',
        plinQrUrl: fila.plin_qr_url ?? null,
      })
      setAdelantoMinimo(fila.adelanto_minimo ?? null)
      setCancelacionPlazoHoras(fila.cancelacion_plazo_horas ?? null)
    }

    supabase
      .from('estado_negocio')
      .select(
        'abierto, cuenta_transferencia, yape_numero, yape_titular, yape_qr_url, ' +
          'plin_numero, plin_titular, plin_qr_url, adelanto_minimo, cancelacion_plazo_horas',
      )
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!vigente) return
        if (data) aplicarFila(data)
        setCargando(false)
      })

    const canal = supabase
      .channel('estado_negocio')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'estado_negocio' },
        (payload) => {
          if (!vigente) return
          aplicarFila(payload.new)
        },
      )
      .subscribe()

    return () => {
      vigente = false
      supabase.removeChannel(canal)
    }
  }, [session, cargandoAuth])

  // El servidor decide quién puede llamar esto (RLS admin-only) — acá no
  // se repite ese chequeo, solo se propaga el error si Supabase lo rechaza.
  const cambiarEstado = useCallback(async (nuevoAbierto) => {
    const { error } = await supabase
      .from('estado_negocio')
      .update({ abierto: nuevoAbierto })
      .eq('id', 1)
    if (error) throw error
    setAbierto(nuevoAbierto)
  }, [])

  // Misma barrera del lado del servidor que cambiarEstado: RLS solo deja
  // actualizar la fila al admin, acá no se repite el chequeo de rol.
  const cambiarCuentaTransferencia = useCallback(async (nuevaCuenta) => {
    const { error } = await supabase
      .from('estado_negocio')
      .update({ cuenta_transferencia: nuevaCuenta })
      .eq('id', 1)
    if (error) throw error
    setCuentaTransferencia(nuevaCuenta)
  }, [])

  const value = useMemo(
    () => ({
      abierto,
      cuentaTransferencia,
      pagos,
      adelantoMinimo,
      cancelacionPlazoHoras,
      cargando,
      cambiarEstado,
      cambiarCuentaTransferencia,
    }),
    [
      abierto,
      cuentaTransferencia,
      pagos,
      adelantoMinimo,
      cancelacionPlazoHoras,
      cargando,
      cambiarEstado,
      cambiarCuentaTransferencia,
    ],
  )

  return <EstadoNegocioContext.Provider value={value}>{children}</EstadoNegocioContext.Provider>
}

export function useEstadoNegocio() {
  const context = useContext(EstadoNegocioContext)
  if (!context) {
    throw new Error('useEstadoNegocio debe usarse dentro de un EstadoNegocioProvider')
  }
  return context
}
