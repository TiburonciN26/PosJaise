// Constantes y formato compartidos por la administración de Recompensas (pestaña Web). Van aparte de ui.jsx para que ese archivo
// exporte solo componentes (requisito de Fast Refresh).

export const CLASE_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-azul-metal'

export const soles = (n) => `S/ ${Number(n).toFixed(2)}`

// Para costos por uso (hasta 4 decimales, mínimo 2): S/ 0.10, S/ 0.25, S/ 3.6667.
export const solesPrecisos = (n) => `S/ ${Number(n).toFixed(4).replace(/0{1,2}$/, '')}`
