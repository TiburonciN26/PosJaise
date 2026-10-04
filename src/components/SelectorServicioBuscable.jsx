import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { servicioPorId } from '../lib/buscarServicios.js'
import { useBusquedaServicios } from '../hooks/useBusquedaServicios.js'

// <select> de servicios con buscador, para catálogos de más de 1000 fichas (QA-046). Las opciones son el
// resultado ACOTADO de la búsqueda en el servidor y, siempre, la ficha actualmente elegida (se pide por ID
// si cae fuera de la página de resultados), de modo que abrir/editar nunca pierde la selección guardada.
// El <select> conserva su `id` y su valor por ID: se sigue eligiendo igual que antes.
const CLASE_CAMPO =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none'

export default function SelectorServicioBuscable({
  id,
  valor,
  onCambiar, // (servicioId, ficha|null)
  textoVacio,
  excluirId = null,
  soloActivos = false,
  claseFoco = 'focus:border-amber',
}) {
  const [texto, setTexto] = useState('')
  const [elegida, setElegida] = useState(null)
  const [errorElegida, setErrorElegida] = useState(false)
  const busqueda = useBusquedaServicios({ termino: texto, soloActivos, excluirId })

  // La ficha elegida (por ID) se conserva aunque no esté entre los resultados de la búsqueda actual.
  useEffect(() => {
    if (!valor) {
      setElegida(null)
      return undefined
    }
    if (elegida?.id === valor) return undefined
    const enResultados = busqueda.resultados.find((s) => s.id === valor)
    if (enResultados) {
      setElegida(enResultados)
      return undefined
    }
    let vigente = true
    servicioPorId(supabase, valor).then(
      (ficha) => {
        if (!vigente) return
        setErrorElegida(false)
        setElegida(ficha)
      },
      () => vigente && setErrorElegida(true),
    )
    return () => {
      vigente = false
    }
  }, [valor, busqueda.resultados, elegida])

  const opciones = [...busqueda.resultados]
  if (valor && elegida?.id === valor && !opciones.some((s) => s.id === valor)) opciones.unshift(elegida)

  return (
    <div className="space-y-1.5">
      <input
        type="search"
        autoComplete="off"
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        placeholder="Buscar servicio por nombre..."
        aria-label="Buscar servicio por nombre"
        className={`${CLASE_CAMPO} ${claseFoco}`}
      />
      <select
        id={id}
        value={valor}
        onChange={(evento) => {
          const ficha = opciones.find((s) => s.id === evento.target.value) ?? null
          if (ficha) setElegida(ficha)
          onCambiar(evento.target.value, ficha)
        }}
        className={`${CLASE_CAMPO} ${claseFoco}`}
      >
        <option value="">{textoVacio}</option>
        {valor && !opciones.some((s) => s.id === valor) && (
          <option value={valor}>{errorElegida ? 'No se pudo cargar el servicio elegido' : 'Cargando servicio...'}</option>
        )}
        {opciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </select>
      {busqueda.buscando && <p className="text-xs text-ink/60">Buscando...</p>}
      {busqueda.error && (
        <p className="text-xs text-red">
          No se pudo buscar.{' '}
          <button type="button" onClick={busqueda.reintentar} className="underline">
            Reintentar
          </button>
        </p>
      )}
      {busqueda.listo && texto.trim() && busqueda.resultados.length === 0 && (
        <p className="text-xs text-ink/60">No hay servicios que coincidan.</p>
      )}
    </div>
  )
}
