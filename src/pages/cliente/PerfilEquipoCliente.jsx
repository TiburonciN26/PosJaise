import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, User } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import PieClienteWeb from './PieClienteWeb.jsx'

// Perfil de una persona del equipo (destino de "Conoce más de ..."). Fuente:
// equipo_para_web(), solo fichas activas y publicadas. Versión inicial: foto y
// especialidad; la biografía ampliada se diseñará más adelante (la descripción
// corta ya aparece en Equipo).
export default function PerfilEquipoCliente() {
  const { id } = useParams()
  const [persona, setPersona] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    supabase.rpc('equipo_para_web').then(({ data }) => {
      if (!vigente) return
      setPersona((data ?? []).find((p) => p.id === id) ?? null)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [id])

  const urlFoto = persona?.foto_url ? urlPublicaFoto('fotos-asistentes', persona.foto_url) : null

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto py-4 md:py-8">
      <div className="mx-auto w-full max-w-[1400px] lw-gutter-detalle">
        <Link to="/nosotros" className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a Nuestro equipo
        </Link>

        {cargando ? (
          <p className="py-10 text-center font-mono text-sm text-white/50">Cargando...</p>
        ) : !persona ? (
          <p className="py-10 text-center text-sm text-white/50">Este perfil no está disponible.</p>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[300px_minmax(0,1fr)] md:gap-14">
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-black">
              {urlFoto ? (
                <img src={urlFoto} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <User className="h-12 w-12 text-white/20" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <h1 className="lw-titulo-heavitas text-3xl uppercase leading-none md:text-5xl">{persona.nombres_completos}</h1>
              {persona.especialidad && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--lw-gold)]">
                  {persona.especialidad}
                </p>
              )}
              {/* La descripción corta vive en Equipo; aquí irá la biografía ampliada (diseño a futuro). */}
              <p className="mt-2 max-w-[60ch] text-sm text-white/50">Muy pronto: su historia completa.</p>
            </div>
          </div>
        )}
      </div>
      <PieClienteWeb />
    </div>
  )
}
