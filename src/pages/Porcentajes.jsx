import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Lock, Unlock, ArrowBigDown, Percent, Hand } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { leerServicios } from '../lib/buscarServicios.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

// QA-050: cuántas tarjetas se pintan a la vez. Los datos siguen COMPLETOS en memoria (lectura por bloques, QA-046) y la
// búsqueda y el orden recorren todo el catálogo; solo el DOM se acota.
const TAMANO_VENTANA = 50

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'asignados-asc', label: '% asignado (menor a mayor)' },
  { id: 'asignados-desc', label: '% asignado (mayor a menor)' },
]

// Mide con canvas (mismo font que el elemento truncado) exactamente qué
// parte del nombre quedó tapada por el "..." del CSS, carácter por
// carácter — así lo que se muestra abajo al desplegar es solo lo que no se
// alcanzó a ver, no una copia del nombre completo.
let ctxMedicionNombre = null

function calcularParteOculta(nombre, elemento) {
  if (!elemento || elemento.scrollWidth <= elemento.clientWidth) return ''
  if (!ctxMedicionNombre) ctxMedicionNombre = document.createElement('canvas').getContext('2d')
  const estilo = getComputedStyle(elemento)
  ctxMedicionNombre.font = `${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`
  const anchoDisponible = elemento.clientWidth
  let corte = nombre.length
  while (corte > 0 && ctxMedicionNombre.measureText(`${nombre.slice(0, corte)}…`).width > anchoDisponible) {
    corte--
  }
  return nombre.slice(corte).trim()
}

// Cantidad de asistentes con % asignado por servicio, calculada UNA vez por cambio de datos (antes el comparador del orden
// recalculaba el conteo en cada comparación y cada tarjeta lo repetía).
function calcularConteos(servicios, asistentesActivos, porcentajesMap) {
  const conteos = new Map()
  for (const servicio of servicios) {
    let n = 0
    for (const a of asistentesActivos) if (porcentajesMap.has(`${servicio.id}_${a.id}`)) n += 1
    conteos.set(servicio.id, n)
  }
  return conteos
}

function ordenarServicios(servicios, orden, conteos) {
  const ordenados = [...servicios]
  switch (orden) {
    case 'nombre-desc':
      return ordenados.sort((a, b) => b.nombre.localeCompare(a.nombre))
    case 'asignados-asc':
      return ordenados.sort((a, b) => conteos.get(a.id) - conteos.get(b.id))
    case 'asignados-desc':
      return ordenados.sort((a, b) => conteos.get(b.id) - conteos.get(a.id))
    default:
      return ordenados.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }
}

function coloresIndicador(asignados, total) {
  if (total === 0) return { pill: 'bg-surface-2 text-ink/60' }
  if (asignados === total) return { pill: 'bg-green/15 text-green' }
  if (asignados / total >= 0.5) return { pill: 'bg-purple-300/15 text-purple-300' }
  return { pill: 'bg-surface-2 text-ink/60' }
}

function FilaAsistentePorcentaje({ precio, asistente, porcentajeActual, onGuardar }) {
  const [bloqueado, setBloqueado] = useState(true)
  const [valor, setValor] = useState(porcentajeActual != null ? String(porcentajeActual) : '')

  useEffect(() => {
    setValor(porcentajeActual != null ? String(porcentajeActual) : '')
    setBloqueado(true)
  }, [porcentajeActual])

  async function confirmarYBloquear() {
    setBloqueado(true)
    await onGuardar(asistente.id, valor)
  }

  // Monto automático que le corresponde a la asistente: precio del servicio × % escrito (se actualiza al teclear).
  const porcentajeNumerico = parseFloat(valor)
  const montoAsistente =
    valor.trim() !== '' && !Number.isNaN(porcentajeNumerico) && porcentajeNumerico >= 0 && porcentajeNumerico <= 100
      ? (Number(precio) * porcentajeNumerico) / 100
      : null

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        {asistente.nombres_completos}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <span
          title="Monto que recibe la asistente (calculado automáticamente)"
          className="flex items-center gap-1 font-mono text-xs text-ink/60"
        >
          <Hand className="h-3.5 w-3.5" />
          {montoAsistente != null ? formatearSoles(montoAsistente) : '—'}
        </span>
        <div className="flex items-center gap-1">
          <input
            type="search"
            inputMode="numeric"
            autoComplete="new-password"
            value={valor}
            disabled={bloqueado}
            placeholder="—"
            onChange={(evento) => setValor(evento.target.value)}
            onBlur={() => {
              if (!bloqueado) confirmarYBloquear()
            }}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') evento.target.blur()
            }}
            className="w-14 rounded-lg border border-border bg-surface px-2 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300 disabled:text-ink/60"
          />
          <span className="text-xs text-ink/60">%</span>
        </div>
        <button
          type="button"
          onClick={() => (bloqueado ? setBloqueado(false) : confirmarYBloquear())}
          aria-label={bloqueado ? 'Desbloquear' : 'Bloquear y guardar'}
          className="p-1 text-ink/60 transition-colors hover:text-purple-300"
        >
          {bloqueado ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-purple-300" />}
        </button>
      </div>
    </div>
  )
}

function TarjetaServicioPorcentaje({ servicio, asistentesActivos, porcentajesMap, asignados, onGuardar }) {
  const [abierto, setAbierto] = useState(false)
  // QA-050: las filas de asistentes (un input por asistente) se montan la PRIMERA vez que la tarjeta se abre y se conservan
  // después (para no cortar la animación de cierre ni perder lo escrito). Con cientos de servicios colapsados ya no hay
  // decenas de miles de nodos que nadie ve.
  const [montado, setMontado] = useState(false)
  const nombreRef = useRef(null)
  const [parteOculta, setParteOculta] = useState('')

  useLayoutEffect(() => {
    const elemento = nombreRef.current
    if (!elemento) return undefined
    const medir = () => setParteOculta(calcularParteOculta(servicio.nombre, elemento))
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [servicio.nombre])

  const total = asistentesActivos.length
  const colores = coloresIndicador(asignados, total)

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => {
          setMontado(true)
          setAbierto((valor) => !valor)
        }}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <p ref={nombreRef} className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {servicio.nombre}
        </p>
        <span className="shrink-0 font-mono text-xs text-ink/60">{formatearSoles(servicio.precio)}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-medium ${colores.pill}`}>
          {asignados}/{total}
        </span>
        <ArrowBigDown
          className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
            abierto ? 'rotate-180' : ''
          }`}
        />
      </button>

      <CampoColapsable abierto={abierto}>
        {montado && (
          <div className="space-y-2 border-t border-border px-1.5 py-2">
            {parteOculta && <p className="-mt-1 text-xs text-ink/50">…{parteOculta}</p>}
            {total === 0 ? (
              <p className="text-center text-sm text-ink/60">No hay asistentes activas.</p>
            ) : (
              asistentesActivos.map((asistente) => (
                <FilaAsistentePorcentaje
                  key={asistente.id}
                  precio={servicio.precio}
                  asistente={asistente}
                  porcentajeActual={porcentajesMap.get(`${servicio.id}_${asistente.id}`) ?? null}
                  onGuardar={(asistenteId, valor) => onGuardar(servicio.id, asistenteId, valor)}
                />
              ))
            )}
          </div>
        )}
      </CampoColapsable>
    </div>
  )
}

// Columnas independientes (no una grilla de filas): al desplegar una tarjeta solo crece su columna y la vecina no deja un hueco.
function useNumeroColumnas() {
  const consulta = '(min-width: 640px)'
  const [dos, setDos] = useState(() => window.matchMedia(consulta).matches)
  useEffect(() => {
    const mql = window.matchMedia(consulta)
    const alCambiar = (e) => setDos(e.matches)
    mql.addEventListener('change', alCambiar)
    return () => mql.removeEventListener('change', alCambiar)
  }, [])
  return dos ? 2 : 1
}

export default function Porcentajes({ activo = true }) {
  const { mostrarToast } = useToast()

  const [servicios, setServicios] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [porcentajes, setPorcentajes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')
  const [ventana, setVentana] = useState({ clave: '', n: TAMANO_VENTANA })
  const primeraCargaHecha = useRef(false)
  const numColumnas = useNumeroColumnas()

  async function cargarTodo(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const [resServicios, resAsistentes, resPorcentajes] = await Promise.all([
      // Lectura completa por bloques: el servidor corta cada respuesta en 1000 filas (QA-046).
      leerServicios(supabase, { columnas: 'id, nombre, precio' }).then(
        (data) => ({ data, error: null }),
        (error) => ({ data: null, error }),
      ),
      supabase
        .from('asistentes')
        .select('id, nombres_completos, usuario_id, usuarios(rol)')
        .eq('activo', true)
        .order('nombres_completos'),
      supabase.from('porcentajes').select('servicio_id, asistente_id, porcentaje'),
    ])

    if (!vigente.actual) return

    if (resServicios.error || resAsistentes.error || resPorcentajes.error) {
      setError('No se pudo cargar la información de porcentajes.')
    } else {
      setError(null)
      setServicios(resServicios.data ?? [])
      // Un admin puede tener ficha de asistente (para que le asignen citas),
      // pero su comisión siempre es 100% por rol, no por porcentaje
      // configurado acá — mostrarlo en esta lista solo confundía el
      // contador (ej. "1/2" cuando en realidad solo falta 1 asistente real
      // por configurar). rol viene del join a usuarios, que esta página ya
      // puede leer completo porque solo la ve un admin (usuarios_select
      // permite id=auth.uid() or es_admin()).
      setAsistentes((resAsistentes.data ?? []).filter((a) => a.usuarios?.rol !== 'ADMINISTRADOR'))
      setPorcentajes(resPorcentajes.data ?? [])
    }
    setCargando(false)
  }

  async function cargarPorcentajes() {
    const { data, error: errorConsulta } = await supabase
      .from('porcentajes')
      .select('servicio_id, asistente_id, porcentaje')

    if (!errorConsulta) setPorcentajes(data ?? [])
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarTodo(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo])

  const porcentajesMap = useMemo(() => {
    const mapa = new Map()
    porcentajes.forEach((p) => mapa.set(`${p.servicio_id}_${p.asistente_id}`, p.porcentaje))
    return mapa
  }, [porcentajes])

  async function guardarPorcentaje(servicioId, asistenteId, valorTexto) {
    const texto = valorTexto.trim()

    if (texto === '') {
      const { data: eliminados, error: errorEliminar } = await supabase
        .from('porcentajes')
        .delete()
        .eq('servicio_id', servicioId)
        .eq('asistente_id', asistenteId)
        .select('servicio_id')

      if (errorEliminar) {
        mostrarToast('No se pudo quitar la asignación.', 'error')
        return
      }
      if (eliminados.length > 0) {
        mostrarToast('Asignación quitada.', 'info')
        cargarPorcentajes()
      }
      return
    }

    const valor = parseFloat(texto)
    if (Number.isNaN(valor) || valor < 0 || valor > 100) {
      mostrarToast('El porcentaje debe estar entre 0 y 100.', 'error')
      cargarPorcentajes()
      return
    }

    const { error: errorGuardado } = await supabase
      .from('porcentajes')
      .upsert(
        { servicio_id: servicioId, asistente_id: asistenteId, porcentaje: valor },
        { onConflict: 'servicio_id,asistente_id' },
      )

    if (errorGuardado) {
      mostrarToast('No se pudo guardar el porcentaje.', 'error')
      return
    }

    mostrarToast('Porcentaje guardado.', 'exito')
    cargarPorcentajes()
  }

  const filtrados = busqueda.trim()
    ? servicios.filter((servicio) =>
        servicio.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : servicios

  const conteos = useMemo(
    () => calcularConteos(servicios, asistentes, porcentajesMap),
    [servicios, asistentes, porcentajesMap],
  )
  const filtradosOrdenados = useMemo(
    () => ordenarServicios(filtrados, orden, conteos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [servicios, busqueda, orden, conteos],
  )
  // La ventana vuelve a 50 al cambiar búsqueda u orden (cada vista nueva empieza arriba).
  const claveVista = `${busqueda.trim().toLowerCase()}|${orden}`
  const cuantas = ventana.clave === claveVista ? ventana.n : TAMANO_VENTANA
  // QA-051: cada CAMBIO real de búsqueda u orden reinicia a 50, también al volver a una vista anterior. Antes el estado
  // conservaba la clave y el n de la vista anterior, y al recuperar esa clave («A-Z», o la búsqueda vacía) reaparecía el n
  // viejo (100). Se reemplaza el estado en cuanto la clave cambia (ajuste durante el render, sin efecto ni parpadeo).
  if (ventana.clave !== claveVista) setVentana({ clave: claveVista, n: TAMANO_VENTANA })
  const visibles = filtradosOrdenados.slice(0, cuantas)

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Buscador: fijo arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar servicio..."
          tema="purple-300"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando servicios...</p>
      ) : filtrados.length === 0 ? (
        <EstadoVacio icono={Percent} mensaje="No se encontraron servicios." tema="purple-300" />
      ) : (
        <div className="mt-4 flex items-start gap-3">
          {Array.from({ length: numColumnas }, (_, c) => (
            <div key={c} className="flex min-w-0 flex-1 flex-col gap-3">
              {visibles
                .filter((_, i) => i % numColumnas === c)
                .map((servicio) => (
                  <TarjetaServicioPorcentaje
                    key={servicio.id}
                    servicio={servicio}
                    asistentesActivos={asistentes}
                    porcentajesMap={porcentajesMap}
                    asignados={conteos.get(servicio.id) ?? 0}
                    onGuardar={guardarPorcentaje}
                  />
                ))}
            </div>
          ))}
        </div>
      )}

      {!cargando && filtrados.length > visibles.length && (
        <div className="mt-4 text-center">
          <p className="mb-2 font-mono text-xs text-ink/60">
            Mostrando {visibles.length} de {filtrados.length} servicios. Busca por nombre para encontrar uno concreto.
          </p>
          <button
            type="button"
            onClick={() => setVentana({ clave: claveVista, n: cuantas + TAMANO_VENTANA })}
            className="w-full max-w-xs rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300"
          >
            Mostrar más
          </button>
        </div>
      )}
    </div>
  )
}
