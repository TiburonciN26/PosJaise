import { Star } from 'lucide-react'

// Fila de 5 estrellas (llenas hasta `calificacion`) — usada por el muro de
// reseñas de Nosotros y por las reseñas destacadas de Inicio, ambas sobre
// resenas_publicas() (86_resenas.sql).
export default function Estrellas({ calificacion, className = 'h-4 w-4' }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`${className} ${
            i < calificacion ? 'fill-[var(--lw-gold)] text-[var(--lw-gold)]' : 'text-white/20'
          }`}
        />
      ))}
    </div>
  )
}
