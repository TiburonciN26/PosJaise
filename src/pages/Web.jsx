import { Link } from 'react-router-dom'
import { Ticket } from 'lucide-react'
import IconoMartillo from '../components/IconoMartillo.jsx'

// Panel administrativo de la pestaña Web de clientes — ya no es un
// placeholder. Cada sección (Promociones es la primera) es una pestaña
// propia que cuelga de esta como "padre" (ver navegacion.js), mismo
// patrón que Deudas cuelga de Clientes: en el menú lateral (móvil) se
// revela con la flechita en vez de sumar una pestaña suelta más — la
// lista ya es larga. En desktop (Header.jsx, sin jerarquía de submenús)
// Promociones aparece como una pestaña más, al lado de esta.
export default function Web() {
  return (
    <div
      className="animate-entrada-pestana flex h-full flex-col items-center gap-4 p-6 text-center"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <div className="mt-6 flex flex-col items-center gap-3">
        <IconoMartillo animando className="h-9 w-9 text-red" />
        <p className="text-base font-semibold text-red">Panel de la pestaña Web</p>
        <p className="max-w-xs text-sm text-ink/60">
          Acá se administra todo lo que ven tus clientes en su portal. Todavía se está
          construyendo — por ahora, Promociones.
        </p>
      </div>

      <Link
        to="/promociones"
        className="mt-2 flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-red/40 bg-red/10 px-4 py-3 text-sm font-medium text-red transition-colors hover:bg-red/15"
      >
        <Ticket className="h-4 w-4" />
        Ir a Promociones
      </Link>
    </div>
  )
}
