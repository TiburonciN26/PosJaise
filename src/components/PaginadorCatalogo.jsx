import { ArrowRight } from 'lucide-react'

// Paginador del listado plano de los catálogos públicos (Productos y Servicios) — Fase 4. Reemplaza una página por otra (no
// acumula tarjetas en el DOM): muestra a qué rango del total corresponde y se atenúa mientras llega la página pedida.
// `total` es el conteo exacto del servidor para el filtro actual.
export default function PaginadorCatalogo({ pagina, totalPaginas, total, tam, ocupado = false, onPagina, etiqueta = 'resultados' }) {
  if (total <= tam) return null

  const desde = (pagina - 1) * tam + 1
  const hasta = Math.min(total, pagina * tam)
  const claseBoton =
    'flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/20'

  return (
    <nav aria-label="Paginación del catálogo" className="mt-10 flex flex-col items-center gap-3" aria-busy={ocupado}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onPagina(1)} disabled={pagina <= 1 || ocupado} aria-label="Primera página" className={claseBoton}>
          <span aria-hidden="true" className="text-sm font-semibold">«</span>
        </button>
        <button type="button" onClick={() => onPagina(pagina - 1)} disabled={pagina <= 1 || ocupado} aria-label="Página anterior" className={claseBoton}>
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>
        <span className="min-w-[120px] text-center text-sm text-white" aria-live="polite">
          Página <b className="font-semibold">{pagina}</b> de {totalPaginas}
        </span>
        <button type="button" onClick={() => onPagina(pagina + 1)} disabled={pagina >= totalPaginas || ocupado} aria-label="Página siguiente" className={claseBoton}>
          <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onPagina(totalPaginas)} disabled={pagina >= totalPaginas || ocupado} aria-label="Última página" className={claseBoton}>
          <span aria-hidden="true" className="text-sm font-semibold">»</span>
        </button>
      </div>
      <p className="text-xs text-white/50">
        {desde}–{hasta} de {total} {etiqueta}
      </p>
    </nav>
  )
}
