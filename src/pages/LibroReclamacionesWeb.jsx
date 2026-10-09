import { useEffect, useRef, useState } from 'react'
import { ArrowBigDown, BookOpen } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import Etiqueta from '../components/Etiqueta.jsx'

const formatoFecha = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Lima',
})

const FILTROS = [
  ['PENDIENTE', 'Pendientes'],
  ['ATENDIDO', 'Atendidos'],
  ['TODOS', 'Todos'],
]

function Dato({ titulo, children }) {
  return (
    <div>
      <p className="text-[11px] text-ink/50">{titulo}</p>
      <p className="whitespace-pre-wrap text-sm text-ink/80">{children}</p>
    </div>
  )
}

// Panel administrativo de «Libro de Reclamaciones» (cuelga de /web). Lo que las
// personas envían desde el pie de la web (migración 20261009000004) llega acá: el
// administrador ve cada hoja, el plazo legal (15 días hábiles) y registra la respuesta.
// Las hojas NO se editan ni se borran — son un registro legal; solo se les responde.
export default function LibroReclamacionesWeb({ activo = true }) {
  const { mostrarToast } = useToast()

  const [reclamos, setReclamos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState('PENDIENTE')
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [respuestas, setRespuestas] = useState({})
  const [respondiendo, setRespondiendo] = useState(null)
  const [proveedor, setProveedor] = useState({ razonSocial: '', ruc: '' })
  const [guardandoProveedor, setGuardandoProveedor] = useState(false)
  const primeraCargaHecha = useRef(false)

  async function cargar(silencioso = false) {
    if (!silencioso) setCargando(true)
    const [lista, negocio] = await Promise.all([
      supabase.from('libro_reclamaciones').select('*').order('creado_en', { ascending: false }),
      supabase.from('estado_negocio').select('razon_social, ruc').eq('id', 1).single(),
    ])
    if (lista.error) {
      setError('No se pudo cargar el libro de reclamaciones.')
    } else {
      setError(null)
      setReclamos(lista.data ?? [])
    }
    if (negocio.data) {
      setProveedor({ razonSocial: negocio.data.razon_social ?? '', ruc: negocio.data.ruc ?? '' })
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargar(silencioso)
  }, [activo])

  function alternar(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function guardarProveedor(evento) {
    evento.preventDefault()
    const ruc = proveedor.ruc.trim()
    if (ruc && !/^\d{11}$/.test(ruc)) {
      mostrarToast('El RUC debe tener 11 dígitos.', 'error')
      return
    }
    setGuardandoProveedor(true)
    const { error: errorGuardar } = await supabase
      .from('estado_negocio')
      .update({ razon_social: proveedor.razonSocial.trim() || null, ruc: ruc || null })
      .eq('id', 1)
    setGuardandoProveedor(false)
    if (errorGuardar) {
      mostrarToast('No se pudo guardar los datos del proveedor.', 'error')
      return
    }
    mostrarToast('Datos del proveedor guardados.', 'exito')
  }

  async function responder(reclamo) {
    const texto = (respuestas[reclamo.id] ?? '').trim()
    if (texto.length < 5) {
      mostrarToast('Escribe la respuesta (mínimo 5 caracteres).', 'error')
      return
    }
    setRespondiendo(reclamo.id)
    const { error: errorResponder } = await supabase.rpc('responder_reclamo', {
      p_id: reclamo.id,
      p_respuesta: texto,
    })
    setRespondiendo(null)
    if (errorResponder) {
      mostrarToast('No se pudo registrar la respuesta.', 'error')
      return
    }
    mostrarToast('Respuesta registrada.', 'exito')
    cargar(true)
  }

  const hoy = new Date().toISOString().slice(0, 10)
  const visibles = filtro === 'TODOS' ? reclamos : reclamos.filter((r) => r.estado === filtro)

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-(--separador-horizontal) lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-azul-metal)' }}
    >
      <form onSubmit={guardarProveedor} className="rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
        <p className="text-sm font-semibold text-ink">Datos del proveedor (salen en la hoja)</p>
        <p className="mt-0.5 text-[11px] text-ink/50">
          La ley exige mostrar razón social, RUC y domicilio. El domicilio es la dirección de Contacto Web.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Etiqueta htmlFor="lr-razon">Razón social</Etiqueta>
            <input
              id="lr-razon"
              value={proveedor.razonSocial}
              onChange={(e) => setProveedor((a) => ({ ...a, razonSocial: e.target.value }))}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-azul-metal"
            />
          </div>
          <div>
            <Etiqueta htmlFor="lr-ruc">RUC</Etiqueta>
            <input
              id="lr-ruc"
              inputMode="numeric"
              maxLength={11}
              value={proveedor.ruc}
              onChange={(e) => setProveedor((a) => ({ ...a, ruc: e.target.value.replace(/\D/g, '') }))}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-azul-metal"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={guardandoProveedor}
          className="mt-3 rounded-lg border border-azul-metal px-4 py-1.5 text-xs font-semibold text-azul-metal disabled:opacity-40"
        >
          {guardandoProveedor ? 'Guardando...' : 'Guardar datos'}
        </button>
      </form>

      <div className="mt-3 flex gap-2">
        {FILTROS.map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={filtro === valor}
            onClick={() => setFiltro(valor)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filtro === valor ? 'border-azul-metal bg-azul-metal/10 text-azul-metal' : 'border-border text-ink/60'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={3} />
      ) : visibles.length === 0 ? (
        <EstadoVacio icono={BookOpen} mensaje="No hay hojas de reclamación aquí." />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((reclamo) => {
            const abierto = abiertos.has(reclamo.id)
            const vencido = reclamo.estado === 'PENDIENTE' && reclamo.fecha_limite < hoy
            return (
              <div key={reclamo.id} className="rounded-lg border border-border bg-surface">
                <div
                  onClick={() => alternar(reclamo.id)}
                  onKeyDown={manejarActivacionTeclado(() => alternar(reclamo.id))}
                  role="button"
                  tabIndex={0}
                  aria-expanded={abierto}
                  className="flex cursor-pointer items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-ink/60">{reclamo.codigo}</p>
                    <p className="truncate text-sm font-medium text-ink">{reclamo.nombre}</p>
                    <p className="text-[11px] text-ink/60">
                      {reclamo.tipo === 'RECLAMO' ? 'Reclamo' : 'Queja'} · {formatoFecha.format(new Date(reclamo.creado_en))}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      reclamo.estado === 'ATENDIDO'
                        ? 'bg-green/15 text-green'
                        : vencido
                          ? 'bg-red/15 text-red'
                          : 'bg-amber/15 text-amber'
                    }`}
                  >
                    {reclamo.estado === 'ATENDIDO' ? 'Atendido' : vencido ? 'Plazo vencido' : 'Pendiente'}
                  </span>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      abierto ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                <CampoColapsable abierto={abierto}>
                  <div className="space-y-2 border-t border-border p-3">
                    <Dato titulo="Consumidor">
                      {reclamo.nombre} — {reclamo.tipo_documento} {reclamo.numero_documento}
                      {reclamo.menor_de_edad ? `\nMenor de edad. Tutor: ${reclamo.apoderado_nombre}` : ''}
                    </Dato>
                    <Dato titulo="Contacto">
                      {reclamo.email}
                      {reclamo.telefono ? ` · ${reclamo.telefono}` : ''}
                      {`\n${reclamo.domicilio}`}
                    </Dato>
                    <Dato titulo={reclamo.bien_tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}>
                      {reclamo.bien_descripcion}
                      {reclamo.monto_reclamado != null ? ` · S/ ${reclamo.monto_reclamado}` : ''}
                    </Dato>
                    <Dato titulo="Detalle">{reclamo.detalle}</Dato>
                    <Dato titulo="Pedido del consumidor">{reclamo.pedido}</Dato>
                    <Dato titulo="Responder antes de (15 días hábiles, sin descontar feriados)">
                      {formatoFecha.format(new Date(`${reclamo.fecha_limite}T12:00:00`))}
                    </Dato>

                    {reclamo.estado === 'ATENDIDO' ? (
                      <Dato titulo={`Respuesta · ${formatoFecha.format(new Date(reclamo.respondido_en))}`}>
                        {reclamo.respuesta}
                      </Dato>
                    ) : (
                      <div>
                        <Etiqueta obligatorio htmlFor={`resp-${reclamo.id}`}>Respuesta</Etiqueta>
                        <textarea
                          id={`resp-${reclamo.id}`}
                          rows={4}
                          maxLength={3000}
                          value={respuestas[reclamo.id] ?? ''}
                          onChange={(e) => setRespuestas((a) => ({ ...a, [reclamo.id]: e.target.value }))}
                          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-azul-metal"
                        />
                        <p className="mt-1 text-[11px] text-ink/50">
                          Después de guardarla, envíala a {reclamo.email} (correo o WhatsApp): la web aún no envía correos.
                        </p>
                        <button
                          type="button"
                          onClick={() => responder(reclamo)}
                          disabled={respondiendo === reclamo.id}
                          className="mt-2 w-full rounded-lg bg-green py-2 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          Registrar respuesta
                        </button>
                      </div>
                    )}
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
