import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import IconoBuscar from '../../components/IconoBuscar.jsx'
import { SIN_SUGERENCIAS } from '../../lib/sinSugerencias.js'
import { filtrarArticulosAlmacen } from '../../lib/costeoRecompensas.js'

// Elegir un material del almacén con el MISMO estilo del buscador de Ventas: un solo cuadro con lupa y, al escribir, una lista que se va
// filtrando (flechas + Enter, Esc para limpiar). La búsqueda ignora mayúsculas y tildes y cada palabra escrita debe aparecer en el nombre.
// Los materiales de un servicio NO se escriben sueltos: salen de aquí, así el costo siempre corresponde a algo que existe en el almacén.
//
// La lista se pinta EN LÍNEA (empuja el contenido de abajo) y no flotando: las filas desplegables de esta pantalla recortan lo que
// sobresale (overflow-hidden) y una lista flotante quedaría cortada.
const CLASE_CAMPO =
  'w-full rounded-lg border border-border bg-surface-2 py-2 pl-8 pr-10 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/60 hover:border-amber focus:border-amber disabled:opacity-60'

export default function BuscadorAlmacen({ id, articulos, usados = [], disabled = false, onElegir }) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(-1)
  const listaRef = useRef(null)
  const coincidencias = filtrarArticulosAlmacen(articulos, texto)
  const idLista = `${id}-lista`

  if (articulos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-ink/60">
        El almacén todavía no tiene artículos activos. Los materiales de un servicio se eligen del almacén: primero regístralos allí (con su
        compra, para que traigan el costo) y vuelve aquí.
      </p>
    )
  }

  function elegir(articulo) {
    if (!articulo || usados.includes(articulo.articulo_id)) return
    setTexto('')
    setAbierto(false)
    setActivo(-1)
    onElegir(articulo)
  }

  function mover(delta) {
    if (coincidencias.length === 0) return
    setAbierto(true)
    const siguiente = (activo + delta + coincidencias.length) % coincidencias.length
    setActivo(siguiente)
    // Mantiene visible la fila activa dentro de la lista con scroll
    listaRef.current?.querySelector(`[data-indice="${siguiente}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function teclas(evento) {
    if (evento.key === 'Escape') {
      if (texto || abierto) evento.stopPropagation()
      setTexto('')
      setAbierto(false)
      setActivo(-1)
    } else if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      mover(1)
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      mover(-1)
    } else if (evento.key === 'Enter') {
      evento.preventDefault() // no envía ningún formulario
      if (activo >= 0) elegir(coincidencias[activo])
    }
  }

  const hayTexto = texto.trim().length > 0

  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink/60">
          <IconoBuscar />
        </span>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={activo >= 0 ? `${id}-op${activo}` : undefined}
          aria-label="Buscar material del almacén"
          {...SIN_SUGERENCIAS}
          value={texto}
          disabled={disabled}
          placeholder="Buscar material del almacén..."
          onChange={(e) => {
            setTexto(e.target.value)
            setAbierto(true)
            setActivo(-1)
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setAbierto(false)}
          onKeyDown={teclas}
          className={CLASE_CAMPO}
        />
        {texto && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setTexto('')
              setActivo(-1)
            }}
            aria-label="Limpiar búsqueda"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 p-2.5 text-ink/60 transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {abierto && !disabled && (
        <div className="animate-entrada-dropdown mt-1 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg">
          {coincidencias.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink/60">No hay materiales que coincidan{hayTexto ? ` con «${texto.trim()}»` : ''}.</p>
          ) : (
            <ul id={idLista} ref={listaRef} role="listbox" className="max-h-64 overflow-y-auto">
              {coincidencias.map((a, indice) => {
                const yaEsta = usados.includes(a.articulo_id)
                return (
                  <li key={a.articulo_id} role="presentation">
                    <button
                      id={`${id}-op${indice}`}
                      type="button"
                      role="option"
                      aria-selected={indice === activo}
                      aria-disabled={yaEsta}
                      data-indice={indice}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActivo(indice)}
                      onClick={() => elegir(a)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        yaEsta ? 'cursor-not-allowed text-ink/40' : indice === activo ? 'bg-amber/15 text-amber' : 'text-ink hover:bg-surface-3'
                      }`}
                    >
                      <span className="truncate">{a.nombre}</span>
                      <span className="shrink-0 font-mono text-xs text-ink/60">
                        {yaEsta
                          ? 'ya está en la receta'
                          : a.costo_unitario !== null
                            ? `S/ ${Number(a.costo_unitario).toFixed(2)} por ${a.unidad ?? 'unidad'}`
                            : 'sin compra registrada'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
