// Fase 6: registro de formularios con trabajo sin confirmar, para que la caché de pestañas (PestanasCacheadas) no descarte una pantalla
// que aún lo tiene.
//
// · Un campo de un <form> editado lo registra como «editado».
// · Enviarlo lo marca «enviado» y le asigna un INTENTO numerado. Enviar NO libera nada: un envío rechazado por validación, con error
//   o todavía en vuelo sigue protegido.
// · Solo una confirmación EXPLÍCITA lo libera: la pantalla que guarda llama `confirmarGuardado(envio)` con el token que obtuvo al enviar
//   (`envioDe(evento.currentTarget)`). El token nombra el formulario y el intento: un éxito de otro flujo (una exportación, otro
//   formulario) no lo toca, y si la persona sigue editando después de enviar, la respuesta del intento anterior ya no vale.
// · Un formulario que sale del DOM (diálogo cancelado o cerrado) deja de contar por sí mismo.
// · Un formulario sin confirmación cableada se conserva hasta salir del DOM: es retención, nunca pérdida de datos.
//
// El registro NO retiene los formularios: los guarda con WeakRef, así que un formulario desmontado puede recolectarse aunque la
// caché no llegue a recortarse.
const estados = new WeakMap() // formulario → { estado: 'editado' | 'enviado', intento }
const porRuta = new Map() // ruta → Set<WeakRef<HTMLFormElement>>
const oyentes = new Set()
let contador = 0

function podar(ruta) {
  const refs = porRuta.get(ruta)
  if (!refs) return false
  for (const ref of [...refs]) {
    const formulario = ref.deref()
    if (!formulario || !formulario.isConnected || !estados.has(formulario)) refs.delete(ref)
  }
  if (refs.size === 0) porRuta.delete(ruta)
  return refs.size > 0
}

// ¿La ruta tiene algún formulario conectado cuyo guardado no se confirmó?
export function tieneFormulariosSinConfirmar(ruta) {
  return podar(ruta)
}

export function formularioEditado(ruta, formulario) {
  const previo = estados.get(formulario)
  if (previo) {
    previo.estado = 'editado' // seguir editando tras un envío invalida la respuesta del intento anterior
    previo.intento = 0
  } else {
    estados.set(formulario, { estado: 'editado', intento: 0 })
    const refs = porRuta.get(ruta) ?? new Set()
    refs.add(new WeakRef(formulario))
    porRuta.set(ruta, refs)
  }
  podar(ruta)
}

export function formularioEnviado(formulario) {
  const registro = estados.get(formulario)
  if (!registro) return
  registro.estado = 'enviado'
  registro.intento = ++contador
}

// Token del último envío de `formulario` (llamar sincrónicamente al empezar el guardado: `evento.currentTarget` ya es null tras un await).
// Es null si el formulario no estaba registrado (sin cambios): confirmarGuardado(null) no hace nada.
export function envioDe(formulario) {
  if (!(formulario instanceof HTMLFormElement)) return null
  const registro = estados.get(formulario)
  if (!registro || registro.estado !== 'enviado') return null
  return { formulario: new WeakRef(formulario), intento: registro.intento }
}

// Guardado confirmado de ESE intento: suelta ese formulario y nada más.
export function confirmarGuardado(envio) {
  const formulario = envio?.formulario.deref()
  const registro = formulario ? estados.get(formulario) : null
  if (!registro || registro.estado !== 'enviado' || registro.intento !== envio.intento) return
  estados.delete(formulario)
  oyentes.forEach((oyente) => oyente())
}

// PestanasCacheadas se suscribe para volver a evaluar el recorte cuando se libera un formulario.
export function alLiberarFormulario(oyente) {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}
