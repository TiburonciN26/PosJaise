import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { normalizarReglas } from '../lib/programaRecompensas.js'

// Estado del programa de Recompensas para las pantallas del portal que anuncian monedas, sellos o nivel (Citas, detalle de servicio y
// de producto, carrito de servicios, Inicio y «Cómo funciona»). UNA sola lectura de las reglas vigentes
// (recompensas_reglas_publicas(): pública y mínima) y, solo con sesión y programa activo, del saldo propio (mi_saldo_recompensas()).
//
// Cada parte tiene su propio estado — 'cargando' | 'ok' | 'error' — y un error NUNCA se traduce a un valor por omisión: sin reglas
// legibles no hay tasa, umbral ni beneficio que mostrar. `activo` es true/false solo cuando las reglas se leyeron; mientras carga o si
// falló es null (la pantalla no debe asumir ni «apagado» ni «activo»).
//   reglas: { estado, datos }  datos = normalizarReglas(...) → { activo:false } | { activo:true, tasaServ, tasaProd, ... }
//   saldo : { estado, datos }  estado 'inactivo' cuando no aplica (sin sesión o programa apagado)
export function useProgramaRecompensas(userId = null) {
  const [reglas, setReglas] = useState({ estado: 'cargando', datos: null })
  const [saldo, setSaldo] = useState({ estado: 'inactivo', datos: null })
  const generacion = useRef(0)

  const cargar = useCallback(async () => {
    const gen = ++generacion.current
    setReglas({ estado: 'cargando', datos: null })
    setSaldo({ estado: 'inactivo', datos: null })

    let lectura
    try {
      lectura = await supabase.rpc('recompensas_reglas_publicas')
    } catch (error) {
      lectura = { error }
    }
    if (gen !== generacion.current) return
    const datos = lectura.error ? null : normalizarReglas(lectura.data?.[0])
    if (!datos) {
      setReglas({ estado: 'error', datos: null })
      return
    }
    setReglas({ estado: 'ok', datos })
    if (!datos.activo || !userId) return

    setSaldo({ estado: 'cargando', datos: null })
    let propio
    try {
      propio = await supabase.rpc('mi_saldo_recompensas')
    } catch (error) {
      propio = { error }
    }
    if (gen !== generacion.current) return
    const fila = propio.error ? null : propio.data?.[0]
    // Una fila sin saldo (clienta sin perfil) es un error de lectura, no un saldo cero.
    setSaldo(fila ? { estado: 'ok', datos: fila } : { estado: 'error', datos: null })
  }, [userId])

  useEffect(() => {
    cargar()
    return () => {
      generacion.current += 1
    }
  }, [cargar])

  return {
    estado: reglas.estado,
    activo: reglas.estado === 'ok' ? reglas.datos.activo : null,
    reglas: reglas.estado === 'ok' && reglas.datos.activo ? reglas.datos : null,
    saldo,
    recargar: cargar,
  }
}
