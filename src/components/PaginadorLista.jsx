import { ArrowBigDown } from 'lucide-react'

// Paginador de las listas administrativas (Fase 5). Siempre informa el TOTAL del servidor para el filtro vigente («41–80 de 429
// pedidos»), así el contador no depende de cuántas filas caben en la página; los botones aparecen solo si hay más de una página.
// `ocupado` atenúa y bloquea los botones mientras llega la página pedida.
export default function PaginadorLista({ pagina, totalPaginas, total, tam, ocupado = false, onPagina, etiqueta = 'resultados' }) {
  if (total <= 0) return null
  const desde = (pagina - 1) * tam + 1
  const hasta = Math.min(total, pagina * tam)
  const clase =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-ink transition-colors hover:border-azul-metal hover:text-azul-metal disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border-strong disabled:hover:text-ink'

  return (
    <nav aria-label={`Paginación de ${etiqueta}`} className="mt-4 flex flex-col items-center gap-2" aria-busy={ocupado}>
      {totalPaginas > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPagina(1)} disabled={pagina <= 1 || ocupado} aria-label="Primera página" className={clase}>
            <span aria-hidden="true" className="text-sm font-semibold">«</span>
          </button>
          <button type="button" onClick={() => onPagina(pagina - 1)} disabled={pagina <= 1 || ocupado} aria-label="Página anterior" className={clase}>
            <ArrowBigDown className="h-4 w-4 rotate-90" />
          </button>
          <span className="min-w-[110px] text-center text-sm text-ink" aria-live="polite">
            Página <b className="font-semibold">{pagina}</b> de {totalPaginas}
          </span>
          <button type="button" onClick={() => onPagina(pagina + 1)} disabled={pagina >= totalPaginas || ocupado} aria-label="Página siguiente" className={clase}>
            <ArrowBigDown className="h-4 w-4 -rotate-90" />
          </button>
          <button type="button" onClick={() => onPagina(totalPaginas)} disabled={pagina >= totalPaginas || ocupado} aria-label="Última página" className={clase}>
            <span aria-hidden="true" className="text-sm font-semibold">»</span>
          </button>
        </div>
      )}
      <p className="font-mono text-xs text-ink/60" data-total={total}>
        {desde}–{hasta} de {total} {etiqueta}
      </p>
    </nav>
  )
}
