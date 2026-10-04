import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { buscarProductosCombo, productoNombrePorId } from '../lib/buscarProductosVenta.js'
import { useDebounce } from '../hooks/useDebounce.js'

// <select> de productos con buscador (combo sugerido de la ficha Web). Mismo contrato que SelectorServicioBuscable:
// opciones = resultado ACOTADO de la búsqueda en el servidor + SIEMPRE la ficha actualmente elegida (se pide por ID si
// cae fuera de los resultados), de modo que abrir/editar nunca pierde la selección guardada. Respuestas viejas se
// descartan por número de secuencia y el error se distingue de la ausencia.
const CLASE_CAMPO =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber'

export default function SelectorProductoBuscable({ id, valor, onCambiar, textoVacio, excluirId = null }) {
  const [texto, setTexto] = useState('')
  const debounced = useDebounce(texto, 250)
  const [resultado, setResultado] = useState(null) // { para, ok, datos }
  const [intento, setIntento] = useState(0)
  const [elegido, setElegido] = useState(null)
  const [errorElegido, setErrorElegido] = useState(false)
  const secuencia = useRef(0)

  useEffect(() => {
    const numero = ++secuencia.current
    buscarProductosCombo(supabase, debounced, { excluirId }).then(
      (datos) => numero === secuencia.current && setResultado({ para: debounced, ok: true, datos }),
      () => numero === secuencia.current && setResultado({ para: debounced, ok: false, datos: [] }),
    )
  }, [debounced, excluirId, intento])

  const vigente = resultado !== null && resultado.para === texto
  const opcionesBusqueda = vigente && resultado.ok ? resultado.datos : []

  useEffect(() => {
    if (!valor) {
      setElegido(null)
      return undefined
    }
    if (elegido?.id === valor) return undefined
    const enResultados = opcionesBusqueda.find((p) => p.id === valor)
    if (enResultados) {
      setElegido(enResultados)
      return undefined
    }
    let activo = true
    productoNombrePorId(supabase, valor).then(
      (ficha) => {
        if (!activo) return
        setErrorElegido(false)
        setElegido(ficha)
      },
      () => activo && setErrorElegido(true),
    )
    return () => {
      activo = false
    }
  }, [valor, opcionesBusqueda, elegido])

  const opciones = [...opcionesBusqueda]
  if (valor && elegido?.id === valor && !opciones.some((p) => p.id === valor)) opciones.unshift(elegido)

  return (
    <div className="space-y-1.5">
      <input
        type="search"
        autoComplete="off"
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        placeholder="Buscar producto por nombre..."
        aria-label="Buscar producto por nombre"
        className={CLASE_CAMPO}
      />
      <select
        id={id}
        value={valor}
        onChange={(evento) => {
          const ficha = opciones.find((p) => p.id === evento.target.value) ?? null
          if (ficha) setElegido(ficha)
          onCambiar(evento.target.value, ficha)
        }}
        className={CLASE_CAMPO}
      >
        <option value="">{textoVacio}</option>
        {valor && !opciones.some((p) => p.id === valor) && (
          <option value={valor}>{errorElegido ? 'No se pudo cargar el producto elegido' : 'Cargando producto...'}</option>
        )}
        {opciones.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      {!vigente && <p className="text-xs text-ink/60">Buscando...</p>}
      {vigente && !resultado.ok && (
        <p className="text-xs text-red">
          No se pudo buscar.{' '}
          <button
            type="button"
            onClick={() => {
              setResultado(null)
              setIntento((n) => n + 1)
            }}
            className="underline"
          >
            Reintentar
          </button>
        </p>
      )}
      {vigente && resultado.ok && texto.trim() && resultado.datos.length === 0 && (
        <p className="text-xs text-ink/60">No hay productos que coincidan.</p>
      )}
    </div>
  )
}
