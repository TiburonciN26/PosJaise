// Piezas chicas compartidas por las secciones de Recompensas.

// Marca de "dato de diseño": propuesta / próximamente / ejemplo. Todo lo
// que todavía no existe en el backend (ver docs/diseno-recompensas) lleva
// una — nunca se presenta como si fuera real.
//
// `envolver` (QA-040): por defecto la píldora es de una sola línea; con
// `envolver`, si el texto no cabe (móvil de 320 px) se parte en varias
// líneas dentro de su contenedor en vez de salirse de la pantalla.
export function Pildora({ children, envolver = false }) {
  return (
    <span
      className={`inline-flex items-center border border-dashed border-[var(--lw-gold)] px-2.5 text-[11px] font-semibold tracking-wide text-[var(--lw-gold)] ${
        envolver ? 'max-w-full whitespace-normal rounded-xl py-1 text-center leading-snug' : 'whitespace-nowrap rounded-full py-0.5'
      }`}
    >
      {children}
    </span>
  )
}

export function Filtro({ activo, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
        activo
          ? 'border-white bg-white text-[#0b0b0c]'
          : 'border-[#3a3a3f] bg-transparent text-white hover:border-[var(--lw-gold)]'
      }`}
    >
      {children}
    </button>
  )
}

export function Encabezado({ titulo, texto }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[22px] font-semibold text-white">{titulo}</h2>
      {texto && <p className="text-[13px] leading-relaxed text-white/60">{texto}</p>}
    </div>
  )
}

// Aviso estándar de una sección que todavía no tiene backend.
export function AvisoProximamente({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-white/10 bg-white/[0.02] px-5 py-4 text-[13px] leading-relaxed text-white/60">
      <Pildora>Próximamente</Pildora>
      {children}
    </div>
  )
}

// QA-039: una consulta que falló NO es un resultado vacío. Este aviso dice
// qué dato no se pudo leer, aclara que no se perdió nada y permite
// reintentar solo esa consulta (las demás secciones siguen usables).
export function AvisoError({ titulo, texto, onReintentar }) {
  return (
    <div
      role="alert"
      className="liquid-glass flex flex-col items-start gap-3 rounded-none border border-red/60 p-5"
    >
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-red">{titulo}</p>
        {texto && <p className="max-w-[560px] text-[13px] leading-relaxed text-white/60">{texto}</p>}
      </div>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          className="min-h-11 rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}

export function Cargando() {
  return (
    <div aria-busy="true" aria-label="Cargando tus datos" className="flex flex-col gap-4">
      <div className="mx-auto h-56 w-full max-w-[640px] animate-pulse bg-white/5" />
      <div className="mx-auto h-24 w-full max-w-[640px] animate-pulse bg-white/5" />
    </div>
  )
}
