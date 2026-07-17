const CLASE_ACCION = {
  amber: 'text-amber hover:text-amber/80',
  'purple-300': 'text-purple-300 hover:text-purple-300/80',
}

// M5 de la 5ª auditoría: "No se encontraron productos." como único
// feedback en cada lista vacía se sentía plano. Ícono grande atenuado +
// texto + (cuando aplica) una acción sugerida, en un solo componente
// reutilizado por todas las páginas/listas del proyecto. `tema` sigue el
// mismo criterio amber/rosa que ya usa SelectorOrden por sección.
export default function EstadoVacio({ icono: Icono, mensaje, accion, tema = 'amber' }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icono className="h-10 w-10 text-ink/20" strokeWidth={1.5} />
      <p className="max-w-xs font-mono text-sm text-ink/60">{mensaje}</p>
      {accion && (
        <button
          type="button"
          onClick={accion.onClick}
          className={`mt-1 text-sm font-medium transition-colors ${CLASE_ACCION[tema]}`}
        >
          {accion.label}
        </button>
      )}
    </div>
  )
}
