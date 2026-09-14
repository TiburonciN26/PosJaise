const COLORES_ICONO_ACCION = {
  morado: 'text-purple-300',
  celeste: 'text-blue',
  rojo: 'text-red',
  verde: 'text-green',
}

export default function BotonAccion({
  icono: Icono,
  texto,
  color,
  onClick,
  href,
  target,
  rel,
  sinBorde,
}) {
  // min-h-10/min-w-10 (40px): mínimo táctil — antes el botón solo icono
  // (móvil, sin el texto de lg:inline) quedaba en ~28px; 40px se mantiene
  // cómodo para tocar sin el padding extra de la versión anterior (44px).
  const clases = `flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg bg-transparent px-1.5 py-1 text-xs transition-colors hover:bg-surface-2 ${
    sinBorde ? '' : 'border border-border-strong'
  } ${COLORES_ICONO_ACCION[color]}`

  // Solo ícono, en cualquier tamaño de pantalla — el texto queda como
  // title (tooltip) para accesibilidad. Antes se revelaba como texto en
  // desktop (lg:inline); pedido explícito: acciones de tabla/tarjeta con
  // solo ícono también en desktop, igual que ya era en móvil.
  if (href) {
    return (
      <a href={href} target={target} rel={rel} title={texto} aria-label={texto} className={clases}>
        <Icono className="h-3.5 w-3.5 shrink-0" />
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} title={texto} aria-label={texto} className={clases}>
      <Icono className="h-3.5 w-3.5 shrink-0" />
    </button>
  )
}
