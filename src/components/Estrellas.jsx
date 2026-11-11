import { Star } from 'lucide-react'

// Fila de 5 estrellas (llenas hasta `calificacion`) — usada por el muro de
// reseñas de Nosotros y por las reseñas destacadas de Inicio, ambas sobre
// resenas_publicas() (86_resenas.sql).
// `colorActivo` (opcional) pinta las estrellas llenas con un color fijo; si no
// se pasa, usan el dorado del tema (--lw-gold).
export default function Estrellas({ calificacion, className = 'h-4 w-4', colorActivo = null }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`${className} ${
            i < calificacion ? (colorActivo ? '' : 'fill-[var(--lw-gold)] text-[var(--lw-gold)]') : 'text-white/20'
          }`}
          style={i < calificacion && colorActivo ? { fill: colorActivo, color: colorActivo } : undefined}
        />
      ))}
    </div>
  )
}
