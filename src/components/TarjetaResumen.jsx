export default function TarjetaResumen({
  etiqueta,
  valor,
  claseValor = 'text-ink',
  padding = 'p-2.5',
  compacto = false,
  apilarCompacto = false,
}) {
  if (compacto && apilarCompacto) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-0.5 text-center rounded-lg border border-border bg-surface ${padding}`}
      >
        <p className="whitespace-nowrap text-xs leading-tight text-ink/50">{etiqueta}</p>
        <p className={`font-mono text-lg font-semibold ${claseValor}`}>{valor}</p>
      </div>
    )
  }

  if (compacto) {
    return (
      <div
        className={`flex items-center justify-center gap-1 text-center rounded-lg border border-border bg-surface ${padding}`}
      >
        <p className="min-w-0 text-xs leading-tight text-ink/50">{etiqueta}</p>
        <p className={`shrink-0 font-mono text-xl font-semibold ${claseValor}`}>{valor}</p>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border border-border bg-surface ${padding}`}>
      <p className="text-xs text-ink/50">{etiqueta}</p>
      <p className={`mt-1 font-mono text-lg font-semibold sm:text-xl ${claseValor}`}>{valor}</p>
    </div>
  )
}
