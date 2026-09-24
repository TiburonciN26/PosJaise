import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { usePerfilCliente } from '../../context/PerfilClienteContext.jsx'
import TarjetaPuntos from '../../components/TarjetaPuntos.jsx'

// "Mis puntos" — se entra desde el ícono del chanchito en el header (ver
// implementacionesWed.md §7.13/§7.15), no es una pestaña de la barra
// principal. Sistema de niveles automático (Básico → Premium → VIP)
// calculado en el servidor por mis_puntos() (88_puntos.sql): el cliente
// nunca elige ni edita su nivel, solo lo ve. Los multiplicadores de
// puntos (por visita / por sol gastado) todavía están sin decisión final
// del negocio — hoy usan valores por defecto editables desde el panel
// "Puntos Web" del POS, no números fijos en este archivo.
export default function MisPuntosCliente() {
  const { perfil } = usePerfilCliente()
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    supabase.rpc('mis_puntos').then(({ data, error }) => {
      if (!vigente) return
      setDatos(!error && data?.length > 0 ? data[0] : null)
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  const puntos = datos?.puntos ?? 0
  const nivel = datos?.nivel ?? 'BASICO'
  const umbralPremium = datos?.umbral_premium ?? 10
  const umbralVip = datos?.umbral_vip ?? 30
  const faltan = datos?.puntos_para_siguiente ?? 0

  let piso = 0
  let techo = umbralPremium
  let siguienteEtiqueta = `FALTAN ${faltan} PTS · PREMIUM`
  if (nivel === 'PREMIUM') {
    piso = umbralPremium
    techo = umbralVip
    siguienteEtiqueta = `FALTAN ${faltan} PTS · VIP`
  } else if (nivel === 'VIP') {
    piso = umbralVip
    techo = umbralVip
    siguienteEtiqueta = 'NIVEL MÁXIMO'
  }
  const progresoPct = techo > piso ? Math.min(100, Math.max(0, ((puntos - piso) / (techo - piso)) * 100)) : 100

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-2xl">
        <p className="mb-6 text-center text-sm text-white/60">
          Suma puntos con cada visita y cada compra — tu tarjeta sube de nivel sola.
        </p>

        <TarjetaPuntos
          nivel={nivel}
          puntos={puntos}
          progresoPct={progresoPct}
          siguienteEtiqueta={siguienteEtiqueta}
          nombre={perfil?.nombre ?? ''}
        />

        <div className="liquid-glass mt-5 flex items-start gap-3 rounded-none p-4">
          <Info className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
          <p className="text-xs text-white/60">
            {nivel === 'VIP'
              ? 'Ya alcanzaste el nivel más alto. ¡Gracias por tu preferencia!'
              : `Te faltan ${faltan} ${faltan === 1 ? 'punto' : 'puntos'} para subir de nivel.`}
          </p>
        </div>
      </div>
    </div>
  )
}
