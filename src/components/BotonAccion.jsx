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
  // min-h-11/min-w-11 (44px): mínimo táctil recomendado — antes el botón
  // solo icono (móvil, sin el texto de lg:inline) quedaba en ~28px.
  const clases = `flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg bg-transparent px-2 py-1.5 text-xs transition-colors hover:bg-surface-2 ${
    sinBorde ? '' : 'border border-border-strong'
  } ${COLORES_ICONO_ACCION[color]}`

  if (href) {
    return (
      <a href={href} target={target} rel={rel} title={texto} className={clases}>
        <Icono className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden lg:inline">{texto}</span>
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} title={texto} className={clases}>
      <Icono className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden lg:inline">{texto}</span>
    </button>
  )
}
