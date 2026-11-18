import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { fechaCorta, ESTADOS_RESENA } from '../../lib/perfilCliente.js'
import Estrellas from '../Estrellas.jsx'
import { Capsula, EstadoLista } from './PiezasPerfil.jsx'

// Hasta este tope por tipo: una clienta deja pocas reseñas (una por servicio o producto como mucho).
const TOPE_POR_TIPO = 100

async function cargarResenas(clienteId) {
  const [negocio, servicios, productos] = await Promise.all([
    supabase
      .from('resenas')
      .select('id, calificacion, comentario, estado, creado_en')
      .eq('cliente_id', clienteId)
      .limit(TOPE_POR_TIPO),
    supabase
      .from('resenas_servicio')
      .select('id, calificacion, comentario, estado, creado_en, servicios(nombre)')
      .eq('cliente_id', clienteId)
      .limit(TOPE_POR_TIPO),
    supabase
      .from('resenas_producto')
      .select('id, calificacion, comentario, estado, creado_en, productos(nombre)')
      .eq('cliente_id', clienteId)
      .limit(TOPE_POR_TIPO),
  ])
  const error = negocio.error || servicios.error || productos.error
  if (error) return { error }
  const filas = [
    ...(negocio.data ?? []).map((r) => ({ ...r, clave: `n-${r.id}`, sobre: 'El salón' })),
    ...(servicios.data ?? []).map((r) => ({ ...r, clave: `s-${r.id}`, sobre: `Servicio: ${r.servicios?.nombre ?? '—'}` })),
    ...(productos.data ?? []).map((r) => ({ ...r, clave: `p-${r.id}`, sobre: `Producto: ${r.productos?.nombre ?? '—'}` })),
  ].sort((a, b) => (b.creado_en ?? '').localeCompare(a.creado_en ?? ''))
  return { data: filas }
}

// Reseñas que dejó la clienta en la web: del salón, de servicios y de productos (aprobadas, pendientes o rechazadas).
// Moderarlas se sigue haciendo en Web → Reseñas.
export default function SeccionResenas({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TOPE_POR_TIPO * 3 + 1,
    cargar: () => cargarResenas(clienteId),
  })

  return (
    <EstadoLista lista={lista} vacio="No ha dejado reseñas.">
      <ul className="divide-y divide-border">
        {lista.filas.map((resena) => (
          <li key={resena.clave} className="py-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm text-ink">{resena.sobre}</p>
              <Capsula estado={ESTADOS_RESENA[resena.estado]} />
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <Estrellas calificacion={resena.calificacion} className="h-3.5 w-3.5" colorActivo="var(--color-amber)" />
              <span className="text-xs text-ink/50">{fechaCorta(resena.creado_en)}</span>
            </div>
            {resena.comentario && <p className="mt-1 text-sm text-ink/70">«{resena.comentario}»</p>}
          </li>
        ))}
      </ul>
    </EstadoLista>
  )
}
