import { useEffect, useState } from 'react'
import { PlusCircle, Pencil, Trash2, Ban, Package, ArrowBigDown, Mic, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useTextoEscritura } from '../hooks/useTextoEscritura.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import IconoBuscar from '../components/IconoBuscar.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'

const FILTROS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
]

const TABLA_LABELS = {
  usuarios: 'Usuarios',
  asistentes: 'Asistentes',
  productos: 'Productos',
  servicios: 'Servicios',
  porcentajes: 'Porcentajes',
  gastos: 'Gastos',
  gastos_recurrentes: 'Plantillas de gasto',
  clientes: 'Clientes',
  registro_servicios: 'Atenciones',
  ventas: 'Ventas',
  stock: 'Stock',
}

const OPCION_TODAS_TABLAS = 'todas'
const TAMANO_PAGINA = 50

function formatearFechaISO(fecha) {
  const anio = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

function formatearHora(fechaIso) {
  const fecha = new Date(fechaIso)
  return new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(fecha)
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function formatearTituloDia(fecha) {
  const diaSemana = capitalizar(new Intl.DateTimeFormat('es-PE', { weekday: 'long' }).format(fecha))
  const dia = String(fecha.getDate()).padStart(2, '0')
  const mes = capitalizar(
    new Intl.DateTimeFormat('es-PE', { month: 'short' }).format(fecha).replace('.', ''),
  )
  const anio = fecha.getFullYear()
  return `${diaSemana} ${dia} ${mes} ${anio}`
}

function iniciarDia(fecha) {
  const copia = new Date(fecha)
  copia.setHours(0, 0, 0, 0)
  return copia
}

function sumarDias(fecha, dias) {
  const copia = new Date(fecha)
  copia.setDate(copia.getDate() + dias)
  return copia
}

function calcularRango(filtro, personalizado) {
  const hoy = iniciarDia(new Date())

  if (filtro === 'semana') {
    const diaSemana = hoy.getDay()
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1
    const lunes = sumarDias(hoy, -diasDesdeLunes)
    return { desde: lunes, hasta: sumarDias(lunes, 7) }
  }

  if (filtro === 'mes') {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const inicioMesSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)
    return { desde: inicioMes, hasta: inicioMesSiguiente }
  }

  if (filtro === 'personalizado') {
    const desde = personalizado.desde ? iniciarDia(new Date(`${personalizado.desde}T00:00:00`)) : hoy
    const hastaBase = personalizado.hasta
      ? iniciarDia(new Date(`${personalizado.hasta}T00:00:00`))
      : hoy
    return { desde, hasta: sumarDias(hastaBase, 1) }
  }

  // 'hoy'
  return { desde: hoy, hasta: sumarDias(hoy, 1) }
}

function agruparPorDia(entradas) {
  const grupos = new Map()
  for (const entrada of entradas) {
    const fecha = new Date(entrada.fecha)
    const clave = `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`
    if (!grupos.has(clave)) grupos.set(clave, { clave, fecha, entradas: [] })
    grupos.get(clave).entradas.push(entrada)
  }
  return Array.from(grupos.values())
}

function CampoColapsable({ abierto, children }) {
  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
        abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

function accionDe(entrada) {
  if (entrada.tabla === 'stock') return 'stock'
  if (entrada.tabla === 'ventas' && entrada.campo === 'estado') return 'anulado'
  if (entrada.campo == null && entrada.valor_nuevo === 'creado') return 'creado'
  if (entrada.campo == null && entrada.valor_anterior === 'eliminado') return 'eliminado'
  return 'editado'
}

const ESTILO_ACCION = {
  creado: { icono: PlusCircle, clase: 'text-green', pill: 'bg-green/15 text-green' },
  editado: { icono: Pencil, clase: 'text-blue', pill: 'bg-blue/15 text-blue' },
  eliminado: { icono: Trash2, clase: 'text-red', pill: 'bg-red/15 text-red' },
  anulado: { icono: Ban, clase: 'text-red', pill: 'bg-red/15 text-red' },
  stock: { icono: Package, clase: 'text-purple-300', pill: 'bg-purple-300/15 text-purple-300' },
}

function formatearValor(valor) {
  if (valor == null || valor === '') return '—'
  if (valor === 'true') return 'Sí'
  if (valor === 'false') return 'No'
  return valor
}

function formatearCampo(campo) {
  if (!campo) return ''
  return campo.replaceAll('_', ' ')
}

function descripcionEntrada(entrada) {
  const accion = accionDe(entrada)
  const tablaLabel = TABLA_LABELS[entrada.tabla] ?? entrada.tabla

  if (accion === 'stock') {
    const signo = entrada.cantidad_agregada >= 0 ? '+' : ''
    return `${tablaLabel} · ${entrada.descripcion} — ${signo}${entrada.cantidad_agregada} uds. (${entrada.valor_anterior} → ${entrada.valor_nuevo})${entrada.nota ? ` · ${entrada.nota}` : ''}`
  }
  if (accion === 'creado') return `${tablaLabel} · ${entrada.descripcion ?? entrada.registro_id} — creado`
  if (accion === 'eliminado') return `${tablaLabel} · ${entrada.descripcion ?? entrada.registro_id} — eliminado`
  if (entrada.tabla === 'ventas' && entrada.campo === 'estado') {
    return `${tablaLabel} · ${entrada.descripcion} — anulada`
  }
  return `${tablaLabel} · ${entrada.descripcion ?? entrada.registro_id} — ${formatearCampo(entrada.campo)}: ${formatearValor(entrada.valor_anterior)} → ${formatearValor(entrada.valor_nuevo)}`
}

export default function Auditoria() {
  const { mostrarToast } = useToast()

  const [filtro, setFiltro] = useState('hoy')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [entradas, setEntradas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [tablaFiltro, setTablaFiltro] = useState(OPCION_TODAS_TABLAS)
  const [cantidadVisible, setCantidadVisible] = useState(TAMANO_PAGINA)
  const [diasAbiertos, setDiasAbiertos] = useState(() => new Set())

  async function cargarEntradas() {
    setCargando(true)
    setError(null)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    const [resAuditoria, resStock] = await Promise.all([
      supabase
        .from('auditoria')
        .select('id, fecha, usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo')
        .gte('fecha', desde.toISOString())
        .lt('fecha', hasta.toISOString())
        .order('fecha', { ascending: false }),
      supabase
        .from('movimientos_stock')
        .select(
          'id, fecha, cantidad_agregada, stock_anterior, stock_nuevo, nota, productos(nombre), usuarios(email)',
        )
        .gte('fecha', desde.toISOString())
        .lt('fecha', hasta.toISOString())
        .order('fecha', { ascending: false }),
    ])

    if (resAuditoria.error || resStock.error) {
      setError('No se pudo cargar la auditoría.')
      setEntradas([])
      setCargando(false)
      return
    }

    const deAuditoria = (resAuditoria.data ?? []).map((fila) => ({
      id: `a-${fila.id}`,
      fecha: fila.fecha,
      usuarioEmail: fila.usuario_email,
      tabla: fila.tabla,
      registro_id: fila.registro_id,
      descripcion: fila.descripcion,
      campo: fila.campo,
      valor_anterior: fila.valor_anterior,
      valor_nuevo: fila.valor_nuevo,
    }))

    const deStock = (resStock.data ?? []).map((fila) => ({
      id: `s-${fila.id}`,
      fecha: fila.fecha,
      usuarioEmail: fila.usuarios?.email ?? null,
      tabla: 'stock',
      descripcion: fila.productos?.nombre ?? 'Producto eliminado',
      cantidad_agregada: fila.cantidad_agregada,
      valor_anterior: fila.stock_anterior,
      valor_nuevo: fila.stock_nuevo,
      nota: fila.nota,
    }))

    const combinadas = [...deAuditoria, ...deStock].sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha),
    )

    setEntradas(combinadas)
    setCantidadVisible(TAMANO_PAGINA)
    setCargando(false)
  }

  useEffect(() => {
    cargarEntradas()
    setDiasAbiertos(new Set())
  }, [filtro, personalizado.desde, personalizado.hasta])

  function alternarDia(clave) {
    setDiasAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  const tablasPresentes = [...new Set(entradas.map((e) => e.tabla))]
  const opcionesTabla = [
    { id: OPCION_TODAS_TABLAS, label: 'Todas las tablas' },
    ...tablasPresentes.map((t) => ({ id: t, label: TABLA_LABELS[t] ?? t })),
  ]

  const entradasFiltradas = entradas.filter((entrada) => {
    if (tablaFiltro !== OPCION_TODAS_TABLAS && entrada.tabla !== tablaFiltro) return false
    if (!busqueda.trim()) return true
    const texto = busqueda.trim().toLowerCase()
    return (
      (entrada.usuarioEmail ?? '').toLowerCase().includes(texto) ||
      (TABLA_LABELS[entrada.tabla] ?? entrada.tabla).toLowerCase().includes(texto) ||
      (entrada.descripcion ?? '').toLowerCase().includes(texto) ||
      (entrada.campo ?? '').toLowerCase().includes(texto)
    )
  })

  const entradasVisibles = entradasFiltradas.slice(0, cantidadVisible)
  const grupos = agruparPorDia(entradasVisibles)
  const hayMasPorMostrar = entradasFiltradas.length > entradasVisibles.length

  const placeholderBuscador = useTextoEscritura('Buscar por usuario, tabla o contenido...')
  const { soportado: vozSoportada, escuchando, alternar: alternarVoz, onErrorRef: onErrorVozRef } =
    useReconocimientoVoz((texto) => setBusqueda(texto))
  onErrorVozRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  return (
    <div className="p-3 pb-6">
      {/* Buscador + orden + filtros de fecha: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 space-y-3 bg-bg px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40">
              <IconoBuscar />
            </span>
            <input
              type="text"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === 'Escape') setBusqueda('')
              }}
              placeholder={placeholderBuscador}
              className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/40 focus:border-purple-300"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {vozSoportada && (
            <button
              type="button"
              onClick={alternarVoz}
              aria-label={escuchando ? 'Detener búsqueda por voz' : 'Buscar por voz'}
              className={`flex shrink-0 items-center justify-center rounded-lg border p-2.5 transition-colors ${
                escuchando
                  ? 'animate-pulse border-red bg-red/10 text-red'
                  : 'border-dashed border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300'
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}

          <SelectorOrden
            opciones={opcionesTabla}
            valor={tablaFiltro}
            onCambiar={setTablaFiltro}
            tema="purple-300"
            ariaLabel="Filtrar por tabla"
          />
        </div>

        <div className="grid grid-cols-4 gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`min-w-0 overflow-visible whitespace-nowrap rounded-full px-1 py-2 text-center text-xs transition-colors sm:px-3 sm:text-sm ${
                filtro === f.id
                  ? 'bg-purple-300 font-semibold text-bg'
                  : 'border border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtro === 'personalizado' && (
        <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
          <label className="shrink-0 text-xs text-ink/50">Desde</label>
          <input
            type="date"
            value={personalizado.desde}
            onChange={(evento) =>
              setPersonalizado((anterior) => ({ ...anterior, desde: evento.target.value }))
            }
            className="min-w-0 shrink rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
          />
          <label className="shrink-0 text-xs text-ink/50">Hasta</label>
          <input
            type="date"
            value={personalizado.hasta}
            onChange={(evento) =>
              setPersonalizado((anterior) => ({ ...anterior, hasta: evento.target.value }))
            }
            className="min-w-0 shrink rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
          />
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">Cargando auditoría...</p>
      ) : entradasFiltradas.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">
          {busqueda.trim() || tablaFiltro !== OPCION_TODAS_TABLAS
            ? 'No se encontraron registros.'
            : 'No hay actividad registrada en este período.'}
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-3">
            {grupos.map((grupo) => {
              const abierto = diasAbiertos.has(grupo.clave)

              return (
                <div key={grupo.clave} className="rounded-lg border border-border bg-surface">
                  <button
                    type="button"
                    onClick={() => alternarDia(grupo.clave)}
                    className="flex w-full items-center gap-2 p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="text-sm font-medium text-ink">
                          {formatearTituloDia(grupo.fecha)}
                        </p>
                        <span className="text-xs text-ink/40">
                          {grupo.entradas.length} {grupo.entradas.length === 1 ? 'cambio' : 'cambios'}
                        </span>
                      </div>
                    </div>
                    <ArrowBigDown
                      className={`h-4 w-4 shrink-0 text-ink/40 transition-transform duration-300 ${
                        abierto ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <CampoColapsable abierto={abierto}>
                    <div className="space-y-2 border-t border-border p-3">
                      {grupo.entradas.map((entrada) => {
                        const accion = accionDe(entrada)
                        const estilo = ESTILO_ACCION[accion]
                        const Icono = estilo.icono

                        return (
                          <div key={entrada.id} className="rounded-lg bg-surface-2 p-2.5">
                            <div className="flex items-start gap-2">
                              <span className={`mt-0.5 shrink-0 rounded-full p-1 ${estilo.pill}`}>
                                <Icono className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-ink">{descripcionEntrada(entrada)}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/50">
                                  <span>{entrada.usuarioEmail ?? 'Sistema'}</span>
                                  <span>·</span>
                                  <span className="font-mono">{formatearHora(entrada.fecha)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CampoColapsable>
                </div>
              )
            })}
          </div>

          {hayMasPorMostrar && (
            <button
              type="button"
              onClick={() => setCantidadVisible((anterior) => anterior + TAMANO_PAGINA)}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300"
            >
              Cargar más
            </button>
          )}
        </>
      )}
    </div>
  )
}
