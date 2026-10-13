import { useCallback, useState } from 'react'

// Fase 6: estado de VISTA (búsqueda, filtro, orden, periodo…) que sobrevive a que PestanasCacheadas desmonte una pantalla poco usada.
// Se guarda en memoria por clave (`ruta:nombre`) y se descarta al cambiar de cuenta o de rol (PestanasCacheadas llama a
// `reiniciarEstadoVista`). Mismo contrato que useState; el valor inicial solo cuenta la primera vez. No guarda datos de negocio:
// solo lo que la persona eligió para mirar la lista.
const almacen = new Map()

export function useEstadoVista(clave, inicial) {
  const [valor, setValor] = useState(() => (almacen.has(clave) ? almacen.get(clave) : typeof inicial === 'function' ? inicial() : inicial))
  const actualizar = useCallback(
    (nuevo) =>
      setValor((anterior) => {
        const siguiente = typeof nuevo === 'function' ? nuevo(anterior) : nuevo
        almacen.set(clave, siguiente)
        return siguiente
      }),
    [clave],
  )
  return [valor, actualizar]
}

export function reiniciarEstadoVista() {
  almacen.clear()
}

// El almacén pertenece a UNA identidad (cuenta + rol). PestanasCacheadas lo declara en su render, ANTES de que se renderice ningún
// hijo: si cambió, se vacía en ese momento, así los filtros nuevos nacen con su valor por defecto y nunca leen los de la
// identidad anterior (un vaciado posterior, en un cleanup, llegaría tarde: el useState del árbol nuevo ya habría leído el Map).
let identidadActual = null
export function fijarIdentidadVista(clave) {
  if (clave === identidadActual) return
  identidadActual = clave
  almacen.clear()
}
