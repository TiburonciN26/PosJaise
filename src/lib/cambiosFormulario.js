// Lista de «qué se perdería» al salir de un formulario sin guardar (aviso de ModalConfirmarDescarte).
// Convención de todos los modales con formulario: X, «Cancelar», Esc y el clic en el fondo NO cierran de golpe si el
// usuario cambió algo; se pregunta y se dice qué se perdería. Ver useAvisoDescarte.jsx.

export function textoCorto(valor) {
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  const limpio = String(valor ?? '').trim()
  if (!limpio) return '(vacío)'
  return limpio.length > 40 ? `${limpio.slice(0, 40)}…` : limpio
}

function normalizar(valor) {
  return valor == null ? '' : valor
}

// `base` y `actual`: objetos del formulario (antes / ahora). `etiquetas`: { campo: 'Etiqueta visible' } — solo se
// comparan esos campos, en ese orden. Listas u objetos (jsonb, arrays) se comparan por contenido y se avisan como
// «modificado»; también los campos de `sinValor` (ids, contraseñas: no se muestra el valor).
export function listarCambios(base, actual, etiquetas, { sinValor = [] } = {}) {
  const cambios = []
  for (const [campo, etiqueta] of Object.entries(etiquetas)) {
    const antes = normalizar(base?.[campo])
    const ahora = normalizar(actual?.[campo])
    const esCompuesto = typeof antes === 'object' || typeof ahora === 'object'
    if (esCompuesto) {
      if (JSON.stringify(antes) !== JSON.stringify(ahora)) cambios.push(`${etiqueta}: modificado`)
      continue
    }
    if (String(antes) === String(ahora)) continue
    cambios.push(sinValor.includes(campo) ? `${etiqueta}: modificado` : `${etiqueta}: ${textoCorto(antes)} → ${textoCorto(ahora)}`)
  }
  return cambios
}
