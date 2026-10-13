// Chips de estado con contadores GLOBALES (Fase 5). `conteos` viene del servidor y cubre toda la tabla —no la página visible—;
// mientras no llega (o si falló) los chips se muestran sin número en vez de inventar uno. Elegir un chip filtra en el servidor.
export default function FiltroEstadoContadores({ opciones, valor, onCambiar, conteos, etiqueta }) {
  const total = conteos ? opciones.reduce((suma, o) => suma + (conteos[o.id] ?? 0), 0) : null
  const todas = [{ id: null, label: 'Todos' }, ...opciones]
  return (
    <div role="group" aria-label={etiqueta} className="mt-2 flex flex-wrap gap-1.5">
      {todas.map((o) => {
        const activa = valor === o.id
        const n = o.id === null ? total : conteos ? (conteos[o.id] ?? 0) : null
        return (
          <button
            key={o.id ?? 'todos'}
            type="button"
            aria-pressed={activa}
            onClick={() => onCambiar(o.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
              activa ? 'border-azul-metal bg-azul-metal/10 text-azul-metal' : 'border-border text-ink/70 hover:border-border-strong'
            }`}
          >
            {o.label}
            {n !== null && <span className="font-mono text-[11px] opacity-80" data-contador={o.id ?? 'todos'}>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
