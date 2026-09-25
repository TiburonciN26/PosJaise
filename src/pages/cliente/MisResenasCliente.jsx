import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../context/ToastContext.jsx'

const ETIQUETAS_ESTADO = {
  PENDIENTE: {
    texto: 'Pendiente de revisión',
    clase: 'bg-[var(--lw-gold)]/15 text-[var(--lw-gold)]',
    ayuda: 'La estamos revisando antes de publicarla — no tardamos mucho.',
  },
  APROBADA: {
    texto: 'Publicada',
    clase: 'bg-green/15 text-green',
    ayuda: 'Ya se ve en Nosotros > Reseñas. Si la editas, vuelve a quedar pendiente de revisión.',
  },
  RECHAZADA: {
    texto: 'No publicada',
    clase: 'bg-red/15 text-red',
    ayuda: 'No la publicamos por ahora — puedes editarla y volver a enviarla.',
  },
}

// "Tus reseñas" (menú del avatar) — una sola reseña por clienta,
// editable (decisión confirmada con el usuario). guardar_mi_resena()
// siempre hace upsert y la vuelve a PENDIENTE si ya estaba aprobada: el
// contenido cambió, hay que revisarlo de nuevo antes de que se vea
// pública otra vez (86_resenas.sql).
export default function MisResenasCliente() {
  const { mostrarToast } = useToast()

  const [cargando, setCargando] = useState(true)
  const [resena, setResena] = useState(null)
  const [calificacion, setCalificacion] = useState(0)
  const [calificacionHover, setCalificacionHover] = useState(0)
  const [comentario, setComentario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true

    supabase.rpc('mi_resena').then(({ data }) => {
      if (!vigente) return
      const fila = data?.[0] ?? null
      setResena(fila)
      setCalificacion(fila?.calificacion ?? 0)
      setComentario(fila?.comentario ?? '')
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  async function guardar(evento) {
    evento.preventDefault()
    setError('')

    if (calificacion === 0) {
      setError('Elige una calificación de 1 a 5 estrellas.')
      return
    }

    setGuardando(true)
    const { data, error: errorRpc } = await supabase.rpc('guardar_mi_resena', {
      p_calificacion: calificacion,
      p_comentario: comentario.trim() || null,
    })
    setGuardando(false)

    if (errorRpc) {
      setError(errorRpc.message || 'No se pudo guardar tu reseña. Intenta de nuevo.')
      return
    }

    setResena(data?.[0] ?? null)
    mostrarToast('¡Gracias por tu reseña! La estamos revisando.', 'exito')
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  const etiqueta = resena ? ETIQUETAS_ESTADO[resena.estado] : null

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-md">
        <p className="mb-6 text-sm text-white/60">
          Cuéntanos cómo fue tu experiencia — se publica en Nosotros luego de una revisión rápida.
        </p>

        {etiqueta && (
          <div className="liquid-glass mb-4 rounded-none p-4">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${etiqueta.clase}`}>
              {etiqueta.texto}
            </span>
            <p className="mt-1.5 text-xs text-white/60">{etiqueta.ayuda}</p>
          </div>
        )}

        <form onSubmit={guardar} className="liquid-glass space-y-4 rounded-none p-5">
          <div>
            <p className="mb-2 text-xs text-white/50">Calificación</p>
            <div className="flex gap-1.5">
              {Array.from({ length: 5 }, (_, i) => {
                const valor = i + 1
                const activo = valor <= (calificacionHover || calificacion)
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setCalificacion(valor)}
                    onMouseEnter={() => setCalificacionHover(valor)}
                    onMouseLeave={() => setCalificacionHover(0)}
                    aria-label={`${valor} estrellas`}
                    className="p-0.5"
                  >
                    <Star
                      className={`h-7 w-7 transition-colors ${
                        activo ? 'fill-[var(--lw-gold)] text-[var(--lw-gold)]' : 'text-white/20'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label htmlFor="resena-comentario" className="mb-1 block text-xs text-white/50">
              Comentario (opcional)
            </label>
            <textarea
              id="resena-comentario"
              value={comentario}
              onChange={(evento) => setComentario(evento.target.value)}
              placeholder="¿Qué te gustó de tu visita?"
              rows={4}
              className="w-full resize-none rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="w-full rounded-lg border border-[var(--lw-gold)] bg-transparent py-2.5 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : resena ? 'Guardar cambios' : 'Publicar reseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
