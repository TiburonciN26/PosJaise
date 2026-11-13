import { ArrowUp, Smile } from 'lucide-react'

const ETIQUETA_COBERTURA = {
  hoy: 'Gastos diarios cubiertos',
  semana: 'Gastos semanales cubiertos',
  mes: 'Gastos del mes cubiertos',
  personalizado: 'Gastos del período cubiertos',
}

// % de los gastos del período que ya cubre el ingreso neto. Sin meta (nada
// que cubrir) cualquier ingreso cuenta como 100%.
export function porcentajeEquilibrio(ingreso, meta) {
  if (meta > 0) return (ingreso / meta) * 100
  return ingreso > 0 ? 100 : 0
}

// Confeti de la meta cumplida (diseño Aurora, docs/diseño-puntoEquilibrio/):
// cada pieza sale del mismo punto y vuela a (dx, dy) girando. En PC brota del
// final de la barra; en móvil, de la esquina superior derecha de la tarjeta.
const CONFETI_PC = [
  { dx: -70, dy: -46, rot: 260, color: '#ed8bac' },
  { dx: -45, dy: -62, rot: -200, color: '#d8b4fe' },
  { dx: -22, dy: -52, rot: 320, color: '#3ecf6a' },
  { dx: -8, dy: -70, rot: -120, color: '#ffd9a0' },
  { dx: 12, dy: -58, rot: 200, color: '#9ad1ff' },
  { dx: 30, dy: -66, rot: -280, color: '#3ecf6a' },
  { dx: 52, dy: -48, rot: 150, color: '#ed8bac' },
  { dx: 74, dy: -40, rot: -240, color: '#ffd9a0' },
  { dx: -58, dy: -24, rot: 180, color: '#9ad1ff' },
  { dx: 62, dy: -22, rot: -160, color: '#d8b4fe' },
]
const CONFETI_MOVIL = [
  { dx: -90, dy: -34, rot: 260, color: '#ed8bac' },
  { dx: -62, dy: -52, rot: -200, color: '#d8b4fe' },
  { dx: -38, dy: -44, rot: 320, color: '#3ecf6a' },
  { dx: -20, dy: -60, rot: -120, color: '#ffd9a0' },
  { dx: -4, dy: -48, rot: 200, color: '#9ad1ff' },
  { dx: -76, dy: -18, rot: -280, color: '#3ecf6a' },
  { dx: -50, dy: -24, rot: 150, color: '#ed8bac' },
  { dx: -10, dy: -26, rot: -240, color: '#ffd9a0' },
]

function Confeti({ piezas, className }) {
  return piezas.map((pieza, indice) => (
    <span
      key={indice}
      aria-hidden="true"
      className={`pe-confeti ${className}`}
      style={{
        '--dx': `${pieza.dx}px`,
        '--dy': `${pieza.dy}px`,
        '--rot': `${pieza.rot}deg`,
        background: pieza.color,
      }}
    />
  ))
}

function PastillaMetaCumplida({ className, clasePico }) {
  return (
    <div
      aria-hidden="true"
      className={`pe-pastilla pointer-events-none absolute z-30 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 ${className}`}
    >
      <Smile className="pe-menear h-[18px] w-[18px] text-[#3ecf6a]" strokeWidth={2} />
      <span className="text-[13px] font-bold text-[#3ecf6a]">¡Meta cumplida!</span>
      <span className={`pe-pastilla-pico absolute -bottom-[6px] h-2.5 w-2.5 rotate-45 ${clasePico}`} />
    </div>
  )
}

// Tarjeta "Punto de equilibrio" — diseño Aurora (docs/diseño-puntoEquilibrio/).
// Un solo árbol para PC y móvil, reacomodado con grid: en móvil título y
// montos arriba y la barra debajo a lo ancho; en PC (lg) todo en una fila
// título · barra · montos. Las animaciones viven en index.css (.pe-*).
// La pastilla y el confeti sobresalen por ARRIBA de la tarjeta: el Dashboard
// le reserva ese espacio (pt-8) cuando la meta está cumplida, e `isolate`
// mantiene todo por debajo de los filtros sticky (z-10) al hacer scroll.
export default function TarjetaPuntoEquilibrio({ filtro, ingreso, meta }) {
  const porcentaje = porcentajeEquilibrio(ingreso, meta)
  const cumplida = porcentaje >= 100
  const anchoRelleno = Math.min(porcentaje, 100)
  // floor: un 99,6% no debe leerse "100%" mientras la meta aún no se cumple.
  const porcentajeTexto = `${Math.floor(porcentaje)}%`

  const contenido = (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 lg:grid-cols-[auto_minmax(4rem,1fr)_auto] lg:items-center lg:gap-x-5">
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-0.5 lg:min-w-[190px]">
        <span className="text-[13px] font-semibold text-ink">Punto de equilibrio</span>
        <span className={`text-[11px] ${cumplida ? 'text-ink/80' : 'text-ink/60'}`}>
          {ETIQUETA_COBERTURA[filtro]}
        </span>
      </div>

      <div className="relative col-span-2 row-start-2 h-2 rounded-full bg-ink/[0.08] lg:col-span-1 lg:col-start-2 lg:row-start-1">
        {cumplida ? (
          <>
            <div className="pe-flujo absolute inset-0 overflow-hidden rounded-full">
              <div className="pe-destello absolute inset-y-0 left-0 w-[22%]" />
            </div>
            <PastillaMetaCumplida
              className="pe-pastilla-centrada bottom-6 left-full hidden lg:flex"
              clasePico="left-1/2 -ml-[5px]"
            />
            <Confeti piezas={CONFETI_PC} className="left-full top-1/2 -ml-[3px] -mt-[5px] hidden lg:block" />
          </>
        ) : (
          <>
            <div
              className="pe-relleno absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
              style={{ width: `${anchoRelleno}%` }}
            />
            <div
              className="pe-perilla absolute top-1/2 -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-full transition-[left] duration-500"
              style={{ left: `${anchoRelleno}%` }}
            />
          </>
        )}
      </div>

      <div
        className={`col-start-2 row-start-1 flex flex-col items-end lg:col-start-3 lg:min-w-[190px] lg:flex-row lg:items-center lg:justify-end lg:gap-2.5 ${
          cumplida ? 'gap-1' : 'gap-0.5'
        }`}
      >
        <span className="whitespace-nowrap font-mono text-xs text-ink">
          {ingreso.toFixed(2)}{' '}
          <span className={cumplida ? 'text-ink/60' : 'text-ink/50'}>/ {meta.toFixed(2)}</span>
        </span>
        {cumplida ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green/15 px-2 py-0.5 font-mono text-xs font-bold text-green">
            <ArrowUp className="pe-subir h-3 w-3" strokeWidth={3} aria-hidden="true" />
            {porcentajeTexto}
          </span>
        ) : (
          <span className="font-mono text-xs font-bold text-purple-300">{porcentajeTexto}</span>
        )}
      </div>
    </div>
  )

  if (!cumplida) {
    return (
      <div className="relative isolate flex h-full flex-col justify-center rounded-lg border border-border bg-surface px-3.5 pb-3.5 pt-3 lg:px-4 lg:py-2.5">
        {contenido}
      </div>
    )
  }

  return (
    <div className="pe-aurora relative isolate h-full">
      <div className="relative flex h-full flex-col justify-center rounded-lg bg-surface px-3.5 pb-3.5 pt-3 lg:px-4 lg:py-2.5">
        {/* Manchas de luz a la deriva, recortadas a la tarjeta (la pastilla
            y el confeti, en cambio, deben poder salirse por arriba). */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
          <div className="pe-mancha pe-mancha-a -top-[50px] left-[2%] h-[120px] w-[180px] bg-[#d8b4fe] opacity-[0.28] blur-[34px] lg:left-[6%] lg:h-[130px] lg:w-[300px] lg:blur-[38px]" />
          <div className="pe-mancha pe-mancha-b -top-10 left-1/2 h-[120px] w-[180px] bg-[#ed8bac] opacity-[0.26] blur-[34px] lg:left-[62%] lg:h-[130px] lg:w-[300px] lg:blur-[38px]" />
        </div>
        <div className="relative z-[1]">{contenido}</div>
      </div>
      <PastillaMetaCumplida
        className="pe-pastilla-derecha -top-8 right-3.5 flex lg:hidden"
        clasePico="right-6"
      />
      <Confeti piezas={CONFETI_MOVIL} className="right-[38px] top-[6px] lg:hidden" />
    </div>
  )
}
