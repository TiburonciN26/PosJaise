import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { agruparAtencionesPorCita } from '../lib/adelantoCita.js'
import BotonVoz from './BotonVoz.jsx'
import { X, ClipboardCheck, User, ListFilter } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useBusquedaAtenciones } from '../hooks/useBusquedaAtenciones.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
import IconoBuscar from './IconoBuscar.jsx'
import EstadoVacio from './EstadoVacio.jsx'
import SelectorOrden from './SelectorOrden.jsx'
import BotonCerrarModal from './BotonCerrarModal.jsx'

const MOSTRAR_VOZ = false

const OPCIONES_ORDEN = [
  { id: 'desc', label: 'Última agregada primero' },
  { id: 'asc', label: 'Más antigua primero' },
]

// Corta a propósito (día/mes + hora, sin año) — alcanza para notar de un
// vistazo que una atención quedó de un día anterior (se olvidaron de
// cobrarla) en vez de ser de la visita de hoy, sin la carga visual de una
// fecha completa en una lista que ya agrupa por cliente.
function formatearFechaCorta(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Lima',
  }).format(fecha)
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} · ${horaStr}`
}

// Reemplaza al viejo ModalBuscarServicio: ya no se elige de un catálogo
// libre, sino de las atenciones que una asistente ya registró en su Panel
// (o que quedaron listas al completar una cita) y todavía no se cobraron.
// No se muestra de qué asistente es cada una — a la cajera solo le hace
// falta identificar cuál pidió el cliente, no quién la atendió.
// QA-044: la lista ya NO llega completa desde Ventas (el servidor corta cada respuesta en 1000 filas y las
// pendientes posteriores eran invisibles aun con el buscador). El modal busca en el servidor, con orden
// (fecha, id), límite pequeño y aviso cuando hay más coincidencias de las que se muestran.
// `excluirIds`: atenciones ya agregadas al carrito de este ticket (no se pueden agregar dos veces).
export default function ModalBuscarAtencion({ excluirIds = [], onSeleccionar, onCerrar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [busqueda, setBusqueda] = useState('')
  const [indiceActivo, setIndiceActivo] = useState(-1)
  // Por defecto la última agregada arriba (el orden se pide al servidor: ver buscarAtenciones.js).
  const [orden, setOrden] = useState('desc')

  useCerrarConEscape(onCerrar)

  const busquedaAtenciones = useBusquedaAtenciones({ termino: busqueda, excluirIds, orden })
  const { listo, buscando, error, truncado } = busquedaAtenciones
  // Lo que ya está en el carrito desaparece al instante (sin esperar la nueva consulta).
  const idsExcluidos = new Set(excluirIds)
  const filtradas = busquedaAtenciones.resultados.filter((atencion) => !idsExcluidos.has(atencion.id))

  // Adelanto que la clienta dejó en Citas por cada atención listada (misma RPC que usa el carrito de Ventas: solo trae lo que
  // aún no se descontó). Es un aviso: si la consulta falla simplemente no se muestra y la lista funciona igual.
  const claveIdsListados = filtradas.map((atencion) => atencion.id).join(',')
  const [adelantos, setAdelantos] = useState([])
  useEffect(() => {
    if (!claveIdsListados) {
      setAdelantos([])
      return undefined
    }
    let vigente = true
    supabase.rpc('adelantos_pendientes_de_atenciones', { p_registro_ids: claveIdsListados.split(',') }).then(({ data, error }) => {
      if (vigente) setAdelantos(error || !Array.isArray(data) ? [] : data)
    })
    return () => {
      vigente = false
    }
  }, [claveIdsListados])

  // Agrupadas por cliente para que la cajera vea de un vistazo todo lo
  // pendiente de la misma persona. Los grupos salen en el orden de la
  // primera atención de cada uno (ya ordenada por fecha según `orden`), así
  // que la clienta con la atención más reciente (o más antigua) queda arriba.
  const gruposFiltrados = (() => {
    const mapa = new Map()
    for (const atencion of filtradas) {
      const clave = atencion.cliente_id ?? atencion.clientes?.nombre ?? 'sin-cliente'
      if (!mapa.has(clave)) {
        mapa.set(clave, { clienteNombre: atencion.clientes?.nombre ?? 'Cliente', atenciones: [] })
      }
      mapa.get(clave).atenciones.push(atencion)
    }
    // Dentro de cada clienta, las atenciones de una misma cita con adelanto forman un bloque (ver agruparAtencionesPorCita).
    return Array.from(mapa.values()).map((grupo) => ({
      ...grupo,
      elementos: agruparAtencionesPorCita(grupo.atenciones, adelantos),
    }))
  })()
  // Índice plano (un elemento = una atención suelta o un bloque de cita) en el MISMO orden en que se dibuja, para que las
  // flechas/Enter recorran la lista tal como se ve.
  const visibles = gruposFiltrados.flatMap((grupo) => grupo.elementos)
  const indicePorElemento = new Map(visibles.map((elemento, indice) => [elemento, indice]))

  // Elegir un elemento agrega TODAS sus atenciones (un bloque baja entero al carrito: su adelanto se descuenta en ese cobro).
  function seleccionarElemento(elemento) {
    elemento.atenciones.forEach((atencion) => onSeleccionar(atencion))
  }

  function manejarCambioBusqueda(valor) {
    setBusqueda(valor)
    setIndiceActivo(-1)
  }

  function manejarKeyDown(evento) {
    if (evento.key === 'Escape') {
      if (busqueda) {
        evento.preventDefault()
        evento.stopPropagation()
        manejarCambioBusqueda('')
      }
      return
    }

    if (evento.key === 'ArrowDown') {
      if (!listo || visibles.length === 0) return
      evento.preventDefault()
      setIndiceActivo((indice) => (indice + 1) % visibles.length)
      return
    }

    if (evento.key === 'ArrowUp') {
      if (!listo || visibles.length === 0) return
      evento.preventDefault()
      setIndiceActivo((indice) => (indice - 1 + visibles.length) % visibles.length)
      return
    }

    if (evento.key !== 'Enter') return
    evento.preventDefault()
    // Con la búsqueda pendiente o fallida Enter no elige nada (podría ser una fila desactualizada).
    if (!listo) return

    if (indiceActivo >= 0 && visibles[indiceActivo]) {
      seleccionarElemento(visibles[indiceActivo])
      return
    }
    if (visibles.length === 1) {
      seleccionarElemento(visibles[0])
    }
  }

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4"
    >
      <div
        ref={panelRef}
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <h2 className="text-base font-semibold text-ink">Atención a cobrar</h2>
          <BotonCerrarModal onClick={onCerrar} />
        </div>

        <div className="border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/60">
                <IconoBuscar />
              </span>
              <input
                type="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                autoFocus
                value={busqueda}
                onChange={(evento) => manejarCambioBusqueda(evento.target.value)}
                onKeyDown={manejarKeyDown}
                placeholder="Buscar por servicio o cliente..."
                className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/60 focus:border-amber"
              />
              {busqueda && (
                <button
                  type="button"
                  onClick={() => manejarCambioBusqueda('')}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 p-2.5 text-ink/60 transition-colors hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Micrófono oculto a pedido (no eliminado): poner MOSTRAR_VOZ en true para volver a mostrarlo. */}
            {MOSTRAR_VOZ && <BotonVoz onTexto={manejarCambioBusqueda} />}
            <SelectorOrden
              opciones={OPCIONES_ORDEN}
              valor={orden}
              onCambiar={(nuevo) => {
                setOrden(nuevo)
                setIndiceActivo(-1)
              }}
              icono={ListFilter}
              seleccionado
              ariaLabel="Ordenar atenciones por fecha"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {buscando ? (
            <p role="status" className="p-6 text-center font-mono text-sm text-ink/60">Cargando...</p>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-2 p-6 text-center">
              <p className="text-sm text-red">
                No se pudieron cargar las atenciones pendientes. Esto no significa que no haya.
              </p>
              <button
                type="button"
                onClick={busquedaAtenciones.reintentar}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
              >
                Reintentar
              </button>
            </div>
          ) : filtradas.length === 0 ? (
            <EstadoVacio
              icono={ClipboardCheck}
              mensaje={
                busqueda.trim()
                  ? 'No hay atenciones pendientes con ese nombre.'
                  : 'No hay atenciones pendientes por cobrar. Pide a la asistente que la registre en su Panel primero.'
              }
            />
          ) : (
            gruposFiltrados.map((grupo) => (
              <div
                key={grupo.clienteNombre}
                className="border-b border-border py-1.5 last:border-b-0"
              >
                <p className="flex items-center gap-1.5 px-3 pb-1 pt-1 text-sm font-semibold text-ink">
                  <User className="h-3.5 w-3.5 shrink-0 text-ink/60" />
                  <span className="truncate">{grupo.clienteNombre}</span>
                </p>
                <div className="px-3">
                  {grupo.elementos.map((elemento) => {
                    const indice = indicePorElemento.get(elemento)
                    const esBloque = elemento.atenciones.length > 1
                    return (
                      <button
                        key={elemento.atenciones[0].id}
                        type="button"
                        onMouseEnter={() => setIndiceActivo(indice)}
                        onClick={() => seleccionarElemento(elemento)}
                        className={`block w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                          esBloque ? 'my-1 border border-green/40' : ''
                        } ${indice === indiceActivo ? 'bg-amber/15 text-amber' : 'text-ink/80 hover:bg-surface-2'}`}
                      >
                        {esBloque && (
                          <p className="mb-1 font-mono text-[10px] text-green">
                            Misma cita · se cobran juntas
                            {elemento.adelanto ? ` · Adelanto ${formatearSoles(elemento.adelanto)}` : ''}
                          </p>
                        )}
                        <div className="space-y-1.5">
                          {elemento.atenciones.map((atencion) => (
                            <div key={atencion.id} className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate">{atencion.servicios?.nombre ?? 'Servicio'}</p>
                                <p className="truncate font-mono text-[10px] text-ink/40">
                                  {formatearFechaCorta(atencion.fecha)}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="font-mono text-amber">{formatearSoles(atencion.precio)}</p>
                                {!esBloque && elemento.adelanto && (
                                  <p className="font-mono text-[10px] text-green">
                                    Adelanto {formatearSoles(elemento.adelanto)}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
          {listo && truncado && (
            <p className="border-t border-border px-3 py-2 text-center text-xs text-ink/60">
              Hay más atenciones pendientes de las que se muestran. Escribe el nombre de la clienta o del servicio
              para encontrar la que buscas.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
