import { Link } from 'react-router-dom'
import { BookOpen, Coins, Gift, LayoutGrid, Image, MapPin, PiggyBank, ShoppingBag, Stamp, Star, Ticket } from 'lucide-react'
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
      className="animate-entrada-pestana flex h-full flex-col items-center gap-4 px-(--separador-vertical) pb-6 pt-(--separador-horizontal) text-center"
      style={{ '--color-foco': 'var(--color-azul-metal)' }}
    >
      <div className="flex flex-col items-center gap-3">
        <IconoMartillo animando className="h-9 w-9 text-azul-metal" />
        <p className="text-base font-semibold text-azul-metal">Panel de la pestaña Web</p>
        <p className="max-w-xs text-sm text-ink/60">
          Acá se administra todo lo que ven tus clientes en su portal.
        </p>
      </div>

      <Link
        to="/promociones"
        className="mt-2 flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <Ticket className="h-4 w-4" />
        Ir a Promociones
      </Link>

      <Link
        to="/catalogo-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <LayoutGrid className="h-4 w-4" />
        Ir a Catálogo Web
      </Link>

      <Link
        to="/pedidos-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <ShoppingBag className="h-4 w-4" />
        Ir a Pedidos Web
      </Link>

      <Link
        to="/resenas-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <Star className="h-4 w-4" />
        Ir a Reseñas
      </Link>

      <Link
        to="/contacto-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <MapPin className="h-4 w-4" />
        Ir a Contacto Web
      </Link>

      <Link
        to="/libro-reclamaciones-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <BookOpen className="h-4 w-4" />
        Ir a Libro de Reclamaciones
      </Link>

      <Link
        to="/puntos-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <PiggyBank className="h-4 w-4" />
        Ir a Puntos Web
      </Link>

      <Link
        to="/referidos-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <Gift className="h-4 w-4" />
        Ir a Referidos Web
      </Link>

      <Link
        to="/fidelizacion-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <Stamp className="h-4 w-4" />
        Ir a Fidelización Web
      </Link>

      <Link
        to="/recompensas-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <Coins className="h-4 w-4" />
        Ir a Recompensas Web
      </Link>

      <Link
        to="/galeria-web"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-azul-metal/40 bg-azul-metal/10 px-4 py-3 text-sm font-medium text-azul-metal transition-colors hover:bg-azul-metal/15"
      >
        <Image className="h-4 w-4" />
        Ir a Galería Web
      </Link>
    </div>
  )
}
