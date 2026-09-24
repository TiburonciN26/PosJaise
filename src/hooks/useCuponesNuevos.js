import { useEffect, useRef, useState } from 'react'

const CLAVE = 'cupones_vistos'

function leerVistos() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? '[]'))
  } catch {
    return new Set()
  }
}

function guardarVistos(set) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify([...set]))
  } catch {
    // localStorage bloqueado (modo privado, cuota, etc.) — la etiqueta
    // "Nuevo" simplemente no persiste entre visitas, no rompe nada más.
  }
}

// La etiqueta "Nuevo" de un cupón se muestra UNA sola vez: la primera
// vez que el cliente entra a una pantalla que lo lista (Referidos o
// Cupones y ofertas — ambas comparten la misma lista de "vistos", así
// que un cupón visto en una ya no aparece como nuevo en la otra). Se
// guarda en localStorage (por dispositivo — no hace falta que viaje al
// servidor) qué códigos ya se mostraron; apenas se calcula qué es
// nuevo en esta visita, se marca todo lo actual como visto para la
// próxima. Si el cliente sale de la pestaña y vuelve (se desmonta y
// remonta la página), este hook vuelve a leer localStorage desde cero
// y ya no encuentra nada nuevo.
export function useCuponesNuevos(cupones) {
  const [nuevos, setNuevos] = useState(() => new Set())
  const yaProcesado = useRef(false)

  useEffect(() => {
    if (yaProcesado.current || cupones.length === 0) return
    yaProcesado.current = true

    const vistos = leerVistos()
    const idsNuevos = cupones.filter((cupon) => !vistos.has(cupon.id)).map((cupon) => cupon.id)
    setNuevos(new Set(idsNuevos))

    const actualizados = new Set(vistos)
    cupones.forEach((cupon) => actualizados.add(cupon.id))
    guardarVistos(actualizados)
  }, [cupones])

  return nuevos
}
