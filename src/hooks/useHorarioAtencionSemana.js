import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { normalizarSemana } from '../lib/horarioAtencion.js'

// Horario de atención por día (horario_atencion_semanal) para avisar si una cita cae fuera de horario. Se guarda en memoria entre
// aperturas del modal (5 min), así no se pide cada vez; mientras no cargue (o si falla) devuelve null y simplemente no se avisa.
const VIGENCIA_MS = 5 * 60 * 1000
let guardado = null // { semana, en }

export function useHorarioAtencionSemana() {
  const [semana, setSemana] = useState(() => (guardado && Date.now() - guardado.en < VIGENCIA_MS ? guardado.semana : null))

  useEffect(() => {
    if (guardado && Date.now() - guardado.en < VIGENCIA_MS) return undefined
    let vigente = true
    supabase.rpc('horario_atencion_semanal').then(({ data, error }) => {
      if (error) return
      guardado = { semana: normalizarSemana(data), en: Date.now() }
      if (vigente) setSemana(guardado.semana)
    })
    return () => {
      vigente = false
    }
  }, [])

  return semana
}
