// Sincronización de la galería de fotos de un producto o servicio
// (producto_fotos / servicio_fotos) con coordinación completa de errores.
//
// Usado por ModalProducto y ModalServicio. Garantías (Fase 3):
//   - NINGÚN error de Supabase se ignora: insert, update y delete se inspeccionan.
//     Un delete/update que RLS convierte en "0 filas" sin error también cuenta como fallo.
//   - Rechazo CONFIRMADO de un insert → se elimina el objeto subido. Resultado INCIERTO
//     (error de transporte: la fila pudo confirmarse sin que llegara la respuesta) → el
//     objeto se CONSERVA, se reconcilia leyendo la fila y, si sigue sin saberse, la operación
//     queda pendiente con la MISMA identidad (id de fila y referencia) para el reintento:
//     no se duplica ni se deja una fila apuntando a un archivo borrado (ver resultadoBd.js).
//   - El objeto de una fila eliminada se borra SOLO después de confirmar el delete de la fila
//     (un delete incierto se reconcilia leyendo las filas; si no se sabe, no se borra nada).
//   - Una foto que falla no impide procesar las demás: el resultado es parcial y claro,
//     y las que sí se guardaron quedan marcadas como ya existentes para que reintentar
//     no las duplique.
import { supabase } from './supabase.js'
import { eliminarFoto, subirFoto } from './imagenes.js'
import { esRechazoConfirmado, estadoFila } from './resultadoBd.js'

const MENSAJE_INCIERTO = 'No se pudo confirmar si una foto de la galería se guardó (conexión interrumpida); se conservó la imagen.'

// fotos: estado del modal -> [{ id, etiqueta, fotoUrl, esNueva, blob, extension, previewUrl, operacion? }]
// eliminados: [{ id, fotoUrl }] (filas que el usuario quitó)
// Devuelve { fallos: string[], eliminadosOk: id[], resultados: (objeto|null)[] alineado con `fotos` }.
export async function sincronizarGaleria({ tabla, columnaPadre, padreId, bucket, fotos, eliminados }) {
  const fallos = []
  const eliminadosOk = []
  const resultados = fotos.map(() => null)

  if (eliminados.length > 0) {
    const ids = eliminados.map((e) => e.id)
    const resultado = await supabase.from(tabla).delete().in('id', ids).select('id')
    let confirmado = false
    if (!resultado.error) {
      confirmado = (resultado.data ?? []).length === ids.length
    } else if (!esRechazoConfirmado(resultado)) {
      // Incierto: ¿siguen las filas? Solo si TODAS ausentes se considera borrado.
      const estados = await Promise.all(ids.map((id) => estadoFila(tabla, id)))
      confirmado = estados.every((e) => e.estado === 'ausente') // 'desconocido' o 'difiere' → no se borra nada
    }
    if (!confirmado) {
      fallos.push('No se pudieron quitar algunas fotos de la galería.')
    } else {
      for (const eliminado of eliminados) {
        eliminadosOk.push(eliminado.id)
        // La fila ya no existe: recién ahora se puede borrar el archivo.
        if (eliminado.fotoUrl) await eliminarFoto(bucket, eliminado.fotoUrl)
      }
    }
  }

  for (let indice = 0; indice < fotos.length; indice += 1) {
    const item = fotos[indice]

    if (!item.esNueva) {
      const resultado = await supabase
        .from(tabla)
        .update({ etiqueta: item.etiqueta, orden: indice })
        .eq('id', item.id)
        .select('id')
      if (resultado.error || (resultado.data ?? []).length !== 1) fallos.push('No se pudo actualizar una foto de la galería.')
      continue
    }

    // Identidad de la operación: se genera una vez y se reutiliza en cada reintento.
    // `incierta` recuerda que un intento anterior terminó sin respuesta: mientras no se lea la
    // fila con éxito, ningún rechazo posterior (ni siquiera un 23505) autoriza a borrar nada.
    const operacion = item.operacion ?? { id: crypto.randomUUID(), referencia: null, incierta: false }
    if (!operacion.referencia) {
      try {
        operacion.referencia = await subirFoto(bucket, `${crypto.randomUUID()}.${item.extension}`, item.blob)
      } catch {
        fallos.push('No se pudo subir una foto de la galería.')
        continue
      }
    }

    const fila = { id: operacion.id, [columnaPadre]: padreId, foto_url: operacion.referencia, etiqueta: item.etiqueta, orden: indice }
    const resultado = await supabase.from(tabla).insert(fila).select('id').single()

    let guardada = !resultado.error && Boolean(resultado.data?.id)
    let lectura = null // { estado, fila } si se leyó
    const hayDuda = Boolean(resultado.error) && (resultado.error.code === '23505' || !esRechazoConfirmado(resultado))
    if (!guardada && (operacion.incierta || hayDuda)) {
      // Un 23505 dice que el INSERT actual chocó con una fila existente (¿la de un intento anterior
      // cuya respuesta se perdió?), no que esa fila sea ajena: hay que LEERLA.
      lectura = await estadoFila(tabla, operacion.id, { foto_url: operacion.referencia, etiqueta: item.etiqueta, orden: indice })
      if (lectura.estado === 'coincide') {
        guardada = true
      } else if (lectura.estado === 'difiere' && lectura.fila.foto_url === operacion.referencia) {
        // La fila de un intento anterior SÍ se confirmó con esta foto pero con otra etiqueta/orden
        // (el usuario los cambió mientras estaba pendiente): se corrige con un UPDATE, sin duplicar.
        const ajuste = await supabase.from(tabla).update({ etiqueta: item.etiqueta, orden: indice }).eq('id', operacion.id).select('id')
        guardada = !ajuste.error && (ajuste.data ?? []).length === 1
      }
    }

    if (guardada) {
      resultados[indice] = { id: operacion.id, fotoUrl: operacion.referencia }
    } else {
      // Solo se limpia si NO hay incertidumbre pendiente: rechazo confirmado (no-23505) sin intento
      // previo incierto, o una lectura exitosa que prueba que la fila no existe (`false`).
      // POR REFERENCIA: solo una lectura exitosa que pruebe que la fila NO existe ('ausente') autoriza a limpiar.
      // Una fila que existe ('difiere', 'desconocido') se conserva con todos sus archivos.
      const hayIncertidumbre = hayDuda || (operacion.incierta && lectura?.estado !== 'ausente')
      if (!hayIncertidumbre) {
        await eliminarFoto(bucket, operacion.referencia)
        fallos.push('No se pudo guardar una foto de la galería.')
      } else {
        // Desconocido: se conservan archivo, id y referencia; el reintento reconcilia sin romper nada.
        operacion.incierta = true
        resultados[indice] = { pendiente: operacion }
        fallos.push(MENSAJE_INCIERTO)
      }
    }
  }

  return { fallos, eliminadosOk, resultados }
}

// Estado del modal tras sincronizar: las fotos nuevas que SÍ se guardaron pasan a ser
// filas existentes (así un reintento no las vuelve a subir) y las inciertas conservan su
// identidad pendiente.
export function aplicarResultadoGaleria(fotos, { resultados }) {
  return fotos.map((foto, indice) => {
    const resultado = resultados[indice]
    if (!resultado) return foto
    if (resultado.pendiente) return { ...foto, operacion: resultado.pendiente }
    if (foto.previewUrl) URL.revokeObjectURL(foto.previewUrl)
    return { id: resultado.id, etiqueta: foto.etiqueta, fotoUrl: resultado.fotoUrl, esNueva: false }
  })
}

export function mensajeGaleriaParcial(entidad, fallos) {
  const unicos = [...new Set(fallos)]
  return `El ${entidad} se guardó, pero la galería quedó incompleta: ${unicos.join(' ')} Pulsa «Guardar cambios» para reintentar.`
}
