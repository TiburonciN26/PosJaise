import { useEffect, useRef, useState } from 'react'
import { PlusCircle, Pencil, Trash2, Ban, Package, ArrowBigDown } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { aLima, calcularRango, claveDiaLima, formatearFechaISO } from '../lib/fechas.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'

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

function formatearHora(fechaIso) {
  const fecha = new Date(fechaIso)
  return new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function formatearTituloDia(fecha) {
  const diaSemana = capitalizar(
    new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'America/Lima' }).format(fecha),
  )
  const dia = String(aLima(fecha).getUTCDate()).padStart(2, '0')
  const mes = capitalizar(
    new Intl.DateTimeFormat('es-PE', { month: 'short', timeZone: 'America/Lima' })
      .format(fecha)
      .replace('.', ''),
  )
  const anio = aLima(fecha).getUTCFullYear()
  return `${diaSemana} ${dia} ${mes} ${anio}`
}

function agruparPorDia(entradas) {
  const grupos = new Map()
  for (const entrada of entradas) {
    const fecha = new Date(entrada.fecha)
    const clave = claveDiaLima(fecha)
    if (!grupos.has(clave)) grupos.set(clave, { clave, fecha, entradas: [] })
    grupos.get(clave).entradas.push(entrada)
  }
  return Array.from(grupos.values())
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

// Mapea una fila del RPC auditoria_paginada() (que ya viene fusionada y
// ordenada por fecha desde Postgres) a la misma forma de "entrada" que antes
// armaban deAuditoria/deStock a mano en el cliente.
function mapearEntradaRpc(fila) {
  const prefijo = fila.origen === 'stock' ? 's' : 'a'
  return {
    id: `${prefijo}-${fila.id}`,
    fecha: fila.fecha,
    usuarioEmail: fila.usuario_email,
    tabla: fila.tabla,
    registro_id: fila.registro_id,
    descripcion: fila.descripcion,
    campo: fila.campo,
    valor_anterior: fila.valor_anterior,
    valor_nuevo: fila.valor_nuevo,
    cantidad_agregada: fila.cantidad_agregada,
    nota: fila.nota,
  }
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

export default function Auditoria({ activo = true }) {
  const [filtro, setFiltro] = useState('hoy')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [entradas, setEntradas] = useState([])
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [tablaFiltro, setTablaFiltro] = useState(OPCION_TODAS_TABLAS)
  const [diasAbiertos, setDiasAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasEntradas descarte una respuesta que llega tarde de un
  // filtro/búsqueda que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })

  // Con búsqueda de texto o filtro de tabla activos, paginar rompería el
  // resultado (podría "no encontrar" algo que existe más adelante sin
  // cargarlo) — se trae el período completo, ya acotado por fecha (mismo
  // criterio que Historial). Sin filtros, sí se pagina de verdad en servidor.
  const filtroActivo = Boolean(busqueda.trim()) || tablaFiltro !== OPCION_TODAS_TABLAS

  async function cargarEntradas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    setError(null)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    if (filtroActivo) {
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

      if (!vigente.actual) return

      if (resAuditoria.error || resStock.error) {
        setError('No se pudo cargar la auditoría.')
        setEntradas([])
        setHayMas(false)
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
      setHayMas(false)
      setCargando(false)
      return
    }

    // Sin filtros: el RPC ya trae auditoria + movimientos_stock fusionados,
    // ordenados y recortados a una sola página — no un .range() por tabla
    // (no alcanzaría para saber cuántas filas de cada una caen en la
    // página 1 sin conocer la otra).
    const { data, error: errorPagina } = await supabase.rpc('auditoria_paginada', {
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
      p_offset: 0,
      p_limite: TAMANO_PAGINA,
    })

    if (!vigente.actual) return

    if (errorPagina) {
      setError('No se pudo cargar la auditoría.')
      setEntradas([])
      setHayMas(false)
      setCargando(false)
      return
    }

    const pagina = (data ?? []).map(mapearEntradaRpc)
    setEntradas(pagina)
    setHayMas(pagina.length === TAMANO_PAGINA)
    setCargando(false)
  }

  async function cargarMasEntradas() {
    if (cargandoMas || !hayMas || filtroActivo) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    const { data, error: errorMas } = await supabase.rpc('auditoria_paginada', {
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
      p_offset: entradas.length,
      p_limite: TAMANO_PAGINA,
    })

    setCargandoMas(false)
    if (!vigente.actual) return

    if (errorMas) {
      setError('No se pudieron cargar más registros.')
      return
    }

    const siguientes = (data ?? []).map(mapearEntradaRpc)
    setEntradas((anterior) => [...anterior, ...siguientes])
    setHayMas(siguientes.length === TAMANO_PAGINA)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarEntradas(vigente, silencioso)
    if (!silencioso) setDiasAbiertos(new Set())
    return () => {
      vigente.actual = false
    }
  }, [activo, filtro, personalizado.desde, personalizado.hasta, filtroActivo])

  function alternarDia(clave) {
    setDiasAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  // Lista fija (no derivada de `entradas`): con la lista paginada, las
  // primeras 50 filas cargadas podrían no incluir todas las tablas con
  // actividad en el período, y el filtro se vería "encogido" al abrir.
  const opcionesTabla = [
    { id: OPCION_TODAS_TABLAS, label: 'Todas las tablas' },
    ...Object.entries(TABLA_LABELS).map(([id, label]) => ({ id, label })),
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

  const grupos = agruparPorDia(entradasFiltradas)

  return (
    <div className="p-3 pb-6">
      {/* Buscador + orden + filtros de fecha: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 space-y-3 bg-bg px-3 py-2">
        <div className="flex items-center gap-2">
          <BarraBusqueda
            valor={busqueda}
            onCambiar={setBusqueda}
            placeholder="Buscar por usuario, tabla o contenido..."
            tema="purple-300"
          />

          <SelectorOrden
            opciones={opcionesTabla}
            valor={tablaFiltro}
            onCambiar={setTablaFiltro}
            tema="purple-300"
            ariaLabel="Filtrar por tabla"
          />
        </div>

        <FiltrosFecha.Botones filtro={filtro} onCambiarFiltro={setFiltro} tema="purple-300" />
      </div>

      <FiltrosFecha.CamposPersonalizado
        filtro={filtro}
        personalizado={personalizado}
        onCambiarPersonalizado={setPersonalizado}
        tema="purple-300"
      />

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando auditoría...</p>
      ) : entradasFiltradas.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
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
                        <span className="text-xs text-ink/60">
                          {grupo.entradas.length} {grupo.entradas.length === 1 ? 'cambio' : 'cambios'}
                        </span>
                      </div>
                    </div>
                    <ArrowBigDown
                      className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
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
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/60">
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

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasEntradas}
              disabled={cargandoMas}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
