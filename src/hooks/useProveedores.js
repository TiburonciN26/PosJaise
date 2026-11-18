import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { COLUMNAS_PROVEEDOR } from '../lib/proveedores.js'

// Proveedores (migración 20261112000014). La administradora lee la ficha completa de `proveedores`; el resto del personal
// solo puede leer `proveedores_nombres` (id, nombre, activo), así que pasa `soloNombres`. `cargado` en false = no se
// pudo leer: quien guarda vínculos NO debe asumir que la lista está vacía.
export function useProveedores({ activo = true, soloNombres = false } = {}) {
  const [estado, setEstado] = useState({ lista: [], cargado: false })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!activo) return undefined
    let vigente = true
    const consulta = soloNombres
      ? supabase.from('proveedores_nombres').select('id, nombre, activo')
      : supabase.from('proveedores').select(COLUMNAS_PROVEEDOR)
    consulta.order('nombre', { ascending: true }).then(({ data, error }) => {
      if (!vigente) return
      setEstado(error ? { lista: [], cargado: false } : { lista: data ?? [], cargado: true })
    })
    return () => {
      vigente = false
    }
  }, [activo, soloNombres, intento])

  const recargar = useCallback(() => setIntento((n) => n + 1), [])
  return { lista: estado.lista, cargado: estado.cargado, recargar }
}
