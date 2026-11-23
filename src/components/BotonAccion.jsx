const COLORES_ICONO_ACCION = {
  morado: 'text-purple-300',
  celeste: 'text-blue',
  rojo: 'text-red',
  verde: 'text-green',
}

// Variante "plana": ícono blanco que toma su color solo en hover; el fondo
// (--color-boton-icono) y el borde no cambian.
const COLORES_ICONO_HOVER = {
  morado: 'hover:text-purple-300',
  celeste: 'hover:text-blue',
  rojo: 'hover:text-red',
  verde: 'hover:text-green',
}

export default function BotonAccion({
  plano,
  icono: Icono,
  texto,
  color,
  onClick,
  href,
  target,
  rel,
  sinBorde,
  fondo,
  relleno,
  etiquetaPc,
}) {
  // min-h-9.5/min-w-9.5 (38px): misma medida que los botones de la barra del buscador (código de barras, filtros: p-2.5 +
  // ícono 16px + borde = 38px), para que no se vean más grandes. Antes 40px (min-h-10); el botón solo icono sin mínimo
  // quedaba en ~24px, así que el mínimo táctil sigue mandando.
  const clases = `flex min-h-9.5 min-w-9.5 items-center justify-center gap-1.5 rounded-lg px-1.5 py-1 text-xs transition-colors ${
    etiquetaPc ? 'lg:px-2.5' : ''
  } ${
    sinBorde ? '' : 'border border-border-strong'
  } ${
    plano
      ? `bg-boton-icono text-ink ${COLORES_ICONO_HOVER[color]}`
      : `${
          relleno ? 'bg-boton-icono hover:bg-surface-3' : fondo ? 'bg-bg hover:bg-boton-icono' : 'bg-transparent hover:bg-surface-2'
        } ${COLORES_ICONO_ACCION[color]}`
  }`
  // `fondo`: fondo oscuro fijo (el de la página) para que el botón se distinga sobre una tarjeta `bg-surface`
  // sin necesitar borde, p. ej. las acciones del encabezado del perfil de clienta.
  // `relleno`: el mismo fondo de los botones de ícono (--color-boton-icono) pero conservando el color propio del ícono
  // (a diferencia de `plano`, que lo pone blanco y lo colorea solo en hover). Va con `sinBorde`: Editar/Eliminar en móvil.

  // `etiquetaPc` (opcional): texto visible junto al ícono solo en PC (lg); sin él, solo ícono en cualquier tamaño.
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
      {etiquetaPc && <span className="max-lg:hidden">{etiquetaPc}</span>}
    </button>
  )
}
