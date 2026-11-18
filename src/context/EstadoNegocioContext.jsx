import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const EstadoNegocioContext = createContext(null)

const COLUMNAS =
  'abierto, cuenta_transferencia, yape_numero, yape_titular, yape_qr_url, ' +
  'plin_numero, plin_titular, plin_qr_url, adelanto_minimo, cancelacion_plazo_horas'
// Una clienta no tiene canal Realtime (ver abajo): su copia se vuelve a leer al volver a la pestaña o al abrir un carrito,
// pero no más de una vez por minuto.
const FRESCURA_MS = 60_000

// Única fuente de verdad: la fila public.estado_negocio en Supabase (ver
// 44_estado_negocio.sql), no una variable local — todo dispositivo
// conectado la lee al montar. El PERSONAL se mantiene al día vía Realtime, sin
// recargar la página (abrir/cerrar el negocio tiene que verse al instante en
// todas las cajas). Una CLIENTA no abre ese canal: era el único de todo el
// portal, así que cada clienta con la web abierta mantenía un WebSocket vivo
// (y ocupaba una conexión simultánea de Realtime del proyecto) para una fila
// que casi nunca cambia. Su copia se refresca al volver a la pestaña y al
// abrir un carrito (refrescar), que es donde se leen los datos de pago.
export function EstadoNegocioProvider({ children }) {
  const { session, cargando: cargandoAuth, rol } = useAuth()
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

  // Fase 5: el efecto depende del ID de la cuenta, no del objeto `session`. Supabase entrega un objeto nuevo en cada
  // TOKEN_REFRESHED (cada hora y al volver a la pestaña): con él como dependencia se cerraba y reabría el canal Realtime y se
  // repetía la lectura de estado_negocio sin que nada hubiera cambiado.
  const usuarioId = session?.user?.id ?? null
  // «Esperando» solo importa para el visitante: con una cuenta ya identificada el efecto no debe reiniciarse cuando la auth
  // termina de cargar el perfil (eso repetía la lectura y el canal Realtime sin que nada hubiera cambiado).
  const esperandoVisitante = !usuarioId && cargandoAuth
  const cuentaActualRef = useRef(usuarioId)
  useEffect(() => {
    cuentaActualRef.current = usuarioId
  }, [usuarioId])
  const ultimaLecturaRef = useRef(0)

  const aplicarFila = useCallback((fila) => {
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
  }, [])

  const leerFila = useCallback(() => {
    ultimaLecturaRef.current = Date.now()
    return supabase.from('estado_negocio').select(COLUMNAS).eq('id', 1).maybeSingle()
  }, [])

  useEffect(() => {
    if (!usuarioId) {
      // QA-029: sin sesión AÚN (la auth sigue resolviendo la sesión guardada) no
      // es "sin configuración": marcarlo como cargado haría que el detalle del
      // servicio mostrara el texto de "no configurado" antes de que llegue la fila.
      if (esperandoVisitante) return undefined

      // Visitante (web pública): solo lo que la ficha del servicio anuncia —adelanto
      // mínimo y plazo de cancelación— por una función que NO devuelve cuentas de
      // Yape/Plin ni el estado interno. Al cerrar sesión también se borran los datos
      // de pago de la sesión anterior (el proveedor sigue montado).
      let vigenteVisitante = true
      setCuentaTransferencia('')
      setPagos({ yapeNumero: '', yapeTitular: '', yapeQrUrl: null, plinNumero: '', plinTitular: '', plinQrUrl: null })
      supabase
        .rpc('politicas_cita_publicas')
        .then(({ data }) => {
          if (!vigenteVisitante) return
          const fila = data?.[0]
          setAdelantoMinimo(fila?.adelanto_minimo ?? null)
          setCancelacionPlazoHoras(fila?.cancelacion_plazo_horas ?? null)
          setCargando(false)
        })
      return () => {
        vigenteVisitante = false
      }
    }

    let vigente = true
    leerFila().then(({ data }) => {
      if (!vigente) return
      if (data) aplicarFila(data)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [usuarioId, esperandoVisitante, aplicarFila, leerFila])

  // Canal Realtime: solo el personal (también cuando mira su perfil de clienta: conserva su rol). Va en un efecto aparte del
  // de la lectura para que conocer el rol —que llega después de la sesión— no repita la lectura (Fase 5).
  const esPersonal = Boolean(rol) && rol !== 'CLIENTE'
  useEffect(() => {
    if (!usuarioId || !esPersonal) return undefined
    let vigente = true
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
  }, [usuarioId, esPersonal, aplicarFila])

  // Clienta: sin canal, la fila se vuelve a leer cuando hace falta que esté al día. No hace nada para el personal (ya tiene
  // el canal) ni para el visitante (no lee esta tabla), ni si la última lectura es de hace menos de un minuto.
  const esClienta = Boolean(usuarioId) && rol === 'CLIENTE'
  const refrescar = useCallback(() => {
    if (!esClienta || Date.now() - ultimaLecturaRef.current < FRESCURA_MS) return
    const cuenta = usuarioId
    leerFila().then(({ data }) => {
      // Si mientras tanto cambió la cuenta (cierre de sesión), esta respuesta ya no es de nadie.
      if (data && cuentaActualRef.current === cuenta) aplicarFila(data)
    })
  }, [esClienta, usuarioId, aplicarFila, leerFila])

  useEffect(() => {
    if (!esClienta) return undefined
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [esClienta, refrescar])

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
      refrescar,
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
      refrescar,
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
