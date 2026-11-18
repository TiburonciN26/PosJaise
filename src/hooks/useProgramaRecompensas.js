import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { normalizarReglas } from '../lib/programaRecompensas.js'
import { guardarCopia, leerCopia, mismaCopia } from '../lib/copiasEnMemoria.js'

// Las REGLAS del programa son públicas e iguales para todas: llevan copia en memoria (lib/copiasEnMemoria.js). Las piden el menú
// del header y cada página que muestra un estimado de puntos; sin copia, cada página que se montaba mostraba «Calculando…» hasta
// que respondía la misma lectura otra vez. Con copia el estimado se pinta al instante y las reglas se vuelven a leer en segundo
// plano en cada montaje (si el programa se apagó o cambió, se corrige solo). El SALDO es personal: nunca se guarda.
const COPIA_REGLAS = 'recompensas:reglas-publicas'

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
  const [reglas, setReglas] = useState(() => {
    const guardadas = leerCopia(COPIA_REGLAS)
    return guardadas ? { estado: 'ok', datos: guardadas } : { estado: 'cargando', datos: null }
  })
  const [saldo, setSaldo] = useState({ estado: 'inactivo', datos: null })
  const generacion = useRef(0)

  const cargar = useCallback(async () => {
    const gen = ++generacion.current
    const guardadas = leerCopia(COPIA_REGLAS)
    setReglas((previas) => (guardadas ? (previas.estado === 'ok' && previas.datos === guardadas ? previas : { estado: 'ok', datos: guardadas }) : { estado: 'cargando', datos: null }))
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
      // Falló la lectura en segundo plano: se conserva la copia vigente (si la hay) en vez de borrar el estimado ya pintado.
      if (!guardadas) setReglas({ estado: 'error', datos: null })
      return
    }
    guardarCopia(COPIA_REGLAS, datos)
    setReglas((previas) => (previas.estado === 'ok' && mismaCopia(previas.datos, datos) ? previas : { estado: 'ok', datos }))
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
