import { useEffect, useRef, useState } from 'react'
import { ArrowBigDown, MessageCircle, Star } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const ETIQUETAS_ESTADO = {
  PENDIENTE: { texto: 'Pendiente', clase: 'bg-amber/15 text-amber' },
  APROBADA: { texto: 'Publicada', clase: 'bg-green/15 text-green' },
  RECHAZADA: { texto: 'No publicada', clase: 'bg-ink/10 text-ink/50' },
}

const formatoFecha = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Lima',
})

function numeroWhatsapp(telefono) {
  const digitos = telefono.replace(/\D/g, '')
  return digitos.length === 9 ? `51${digitos}` : digitos
}

// Panel administrativo de "Reseñas" (cuelga de /web, ver navegacion.js)
// — moderación de lo que las clientas dejan desde "Tus reseñas" en el
// portal (86_resenas.sql). Decisión confirmada con el usuario: nada se
// ve público hasta que el admin la aprueba acá. Sin crear/editar
// contenido — el texto lo escribe la clienta, el admin solo aprueba o
// rechaza.
//
// QA-026: las reseñas POR PRODUCTO (resenas_producto, migración 123) también
// nacen PENDIENTE y prometen "revisión antes de publicarse", pero este panel
// solo leía `resenas`, así que nunca llegaban a un administrador. Ahora se
// listan en el mismo panel, rotuladas con el producto para distinguirlas de
// la reseña general, y se aprueban/rechazan con el mismo flujo. No cambia
// RLS: resenas_producto ya permite SELECT/UPDATE al administrador
// (es_admin()) y la lista pública sigue filtrando por estado = 'APROBADA'.
//
// QA-032: lo mismo para las reseñas POR SERVICIO (resenas_servicio, migración 116:
// nacen PENDIENTE, UPDATE solo administración, pública solo APROBADA): se listan
// aquí con el nombre del servicio, sin cambios de RLS.
const TABLA_POR_ORIGEN = {
  GENERAL: 'resenas',
  PRODUCTO: 'resenas_producto',
  SERVICIO: 'resenas_servicio',
}
export default function ResenasWeb({ activo = true }) {
  const { mostrarToast } = useToast()

  const [resenas, setResenas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [actualizando, setActualizando] = useState(null)
  const primeraCargaHecha = useRef(false)

  async function cargarResenas(silencioso = false) {
    if (!silencioso) setCargando(true)
    const [generales, deProducto, deServicio] = await Promise.all([
      supabase
        .from('resenas')
        .select('id, calificacion, comentario, estado, creado_en, clientes(nombre, telefono)')
        .order('creado_en', { ascending: false }),
      supabase
        .from('resenas_producto')
        .select('id, calificacion, comentario, estado, creado_en, clientes(nombre, telefono), productos(nombre)')
        .order('creado_en', { ascending: false }),
      supabase
        .from('resenas_servicio')
        .select('id, calificacion, comentario, estado, creado_en, clientes(nombre, telefono), servicios(nombre)')
        .order('creado_en', { ascending: false }),
    ])

    if (generales.error || deProducto.error || deServicio.error) {
      setError('No se pudo cargar las reseñas.')
    } else {
      setError(null)
      const todas = [
        ...(generales.data ?? []).map((r) => ({ ...r, origen: 'GENERAL' })),
        ...(deProducto.data ?? []).map((r) => ({ ...r, origen: 'PRODUCTO' })),
        ...(deServicio.data ?? []).map((r) => ({ ...r, origen: 'SERVICIO' })),
      ].sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))
      setResenas(todas)
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarResenas(silencioso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function cambiarEstado(resena, estado) {
    setActualizando(resena.id)
    const { error: errorActualizar } = await supabase
      .from(TABLA_POR_ORIGEN[resena.origen])
      .update({ estado, actualizado_en: new Date().toISOString() })
      .eq('id', resena.id)
    setActualizando(null)

    if (errorActualizar) {
      mostrarToast('No se pudo actualizar la reseña.', 'error')
      return
    }

    mostrarToast(estado === 'APROBADA' ? 'Reseña publicada.' : 'Reseña rechazada.', 'exito')
    cargarResenas(true)
  }

  const filtradas = busqueda.trim()
    ? resenas.filter((r) => {
        const termino = busqueda.trim().toLowerCase()
        return (
          (r.clientes?.nombre ?? '').toLowerCase().includes(termino) ||
          (r.productos?.nombre ?? '').toLowerCase().includes(termino) ||
          (r.servicios?.nombre ?? '').toLowerCase().includes(termino)
        )
      })
    : resenas

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-azul-metal)' }}
    >
      <div className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por clienta, producto o servicio..."
          tema="azul-metal"
          sinBorde
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={3} />
      ) : filtradas.length === 0 ? (
        <EstadoVacio icono={Star} mensaje="No hay reseñas todavía." />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((resena) => {
            const abierto = abiertos.has(`${resena.origen}-${resena.id}`)
            const etiqueta = ETIQUETAS_ESTADO[resena.estado] ?? ETIQUETAS_ESTADO.PENDIENTE

            return (
              <div key={`${resena.origen}-${resena.id}`} className="rounded-lg border border-border bg-surface">
                <div
                  onClick={() => alternarAbierto(`${resena.origen}-${resena.id}`)}
                  onKeyDown={manejarActivacionTeclado(() => alternarAbierto(`${resena.origen}-${resena.id}`))}
                  role="button"
                  tabIndex={0}
                  aria-expanded={abierto}
                  className="flex cursor-pointer items-center gap-3 p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-azul-metal/30 bg-azul-metal/15 text-azul-metal">
                    <Star className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {resena.clientes?.nombre ?? 'Cliente'}
                    </p>
                    <p className="truncate text-[11px] text-ink/60">
                      {resena.origen === 'PRODUCTO'
                        ? `Producto: ${resena.productos?.nombre ?? 'eliminado'}`
                        : resena.origen === 'SERVICIO'
                          ? `Servicio: ${resena.servicios?.nombre ?? 'eliminado'}`
                          : 'Reseña general'}
                    </p>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          className={`h-3 w-3 ${
                            i < resena.calificacion ? 'fill-amber text-amber' : 'text-ink/20'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${etiqueta.clase}`}>
                    {etiqueta.texto}
                  </span>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      abierto ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                <CampoColapsable abierto={abierto}>
                  <div className="border-t border-border p-3">
                    <p className="font-mono text-xs text-ink/50">
                      {formatoFecha.format(new Date(resena.creado_en))}
                    </p>
                    {resena.comentario && (
                      <p className="mt-2 text-sm text-ink/80">"{resena.comentario}"</p>
                    )}

                    {resena.clientes?.telefono && (
                      <a
                        href={`https://wa.me/${numeroWhatsapp(resena.clientes.telefono)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center gap-1.5 text-xs text-green"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Escribir por WhatsApp
                      </a>
                    )}

                    {resena.estado !== 'APROBADA' && (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => cambiarEstado(resena, 'APROBADA')}
                          disabled={actualizando === resena.id}
                          className="flex-1 rounded-lg bg-green py-2 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          onClick={() => cambiarEstado(resena, 'RECHAZADA')}
                          disabled={actualizando === resena.id}
                          className="flex-1 rounded-lg border border-red py-2 text-xs font-semibold text-red disabled:opacity-40"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                    {resena.estado === 'APROBADA' && (
                      <button
                        type="button"
                        onClick={() => cambiarEstado(resena, 'RECHAZADA')}
                        disabled={actualizando === resena.id}
                        className="mt-3 w-full rounded-lg border border-red py-2 text-xs font-semibold text-red disabled:opacity-40"
                      >
                        Quitar de la Web
                      </button>
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
