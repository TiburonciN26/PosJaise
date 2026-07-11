import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'

const FILTROS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
]

const METRICAS_VACIAS = {
  ingresoProductos: 0,
  ingresoServicios: 0,
  costoProductos: 0,
  productosVendidos: 0,
  serviciosRealizados: 0,
  cantidadVentas: 0,
  gastosMes: 0,
}

function formatearSoles(monto) {
  return `S/ ${monto.toFixed(2)}`
}

function formatearFechaISO(fecha) {
  const anio = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
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

function diasHabilesDelMes(anio, mesIndiceCero) {
  const diasEnMes = new Date(anio, mesIndiceCero + 1, 0).getDate()
  let habiles = 0
  for (let dia = 1; dia <= diasEnMes; dia++) {
    if (new Date(anio, mesIndiceCero, dia).getDay() !== 0) habiles++
  }
  return habiles
}

function diasHabilesEnRango(desde, hastaExclusiva) {
  let habiles = 0
  for (let cursor = new Date(desde); cursor < hastaExclusiva; cursor = sumarDias(cursor, 1)) {
    if (cursor.getDay() !== 0) habiles++
  }
  return habiles
}

// Los gastos fijos + variables del mes se prorratean para que Hoy/Semana/
// Personalizado también carguen su parte proporcional (antes solo se restaban
// en "Este mes", lo que inflaba la ganancia mostrada en los demás filtros).
// Los domingos (negocio cerrado) no cuentan como día hábil al prorratear.
function calcularGastosProrrateados({ filtro, gastosMesTotal, anio, mes, desde, hasta }) {
  if (filtro === 'mes') return gastosMesTotal
  if (filtro === 'semana') return gastosMesTotal / 4

  const habilesDelMes = diasHabilesDelMes(anio, mes)
  const gastoDiario = habilesDelMes > 0 ? gastosMesTotal / habilesDelMes : 0

  if (filtro === 'personalizado') {
    return gastoDiario * diasHabilesEnRango(desde, hasta)
  }

  // 'hoy'
  return desde.getDay() === 0 ? 0 : gastoDiario
}

const ETIQUETA_GASTOS = {
  hoy: 'Gastos del día (prorrateado)',
  semana: 'Gastos de la semana (mes ÷ 4)',
  mes: 'Gastos fijos + variables del mes',
  personalizado: 'Gastos del período (prorrateado)',
}

const ETIQUETA_COBERTURA = {
  hoy: 'Gastos diarios cubiertos',
  semana: 'Gastos semanales cubiertos',
  mes: 'Gastos del mes cubiertos',
  personalizado: 'Gastos del período cubiertos',
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

function Brillo({ activo }) {
  if (!activo) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10 w-1/3 animate-brillo-barra bg-gradient-to-r from-transparent via-white/25 to-transparent" />
  )
}

// Brillo que recorre solo las letras (no su fondo): se pinta como el propio
// relleno del texto vía background-clip, así el destello ilumina el glifo en
// vez de dibujarse como un cuadro de luz encima de todo. La clase de color
// (text-ink, etc.) va aparte (claseColorInactiva) porque si se mezcla con
// text-transparent en la misma className, cuál gana depende del orden en el
// CSS generado por Tailwind, no del orden en el string — y a veces pierde
// text-transparent, dejando el texto opaco y tapando el degradado.
function TextoBrillante({ activo, color, className = '', claseColorInactiva = '', children }) {
  if (!activo) {
    return <span className={`${className} ${claseColorInactiva}`}>{children}</span>
  }
  return (
    <span
      className={`${className} animate-brillo-texto bg-clip-text text-transparent`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${color} 30%, #ffffff 50%, ${color} 70%)`,
        backgroundSize: '220% 100%',
      }}
    >
      {children}
    </span>
  )
}

function BarraTermometro({ filtro, ingresoBruto, meta }) {
  const porcentaje = meta > 0 ? (ingresoBruto / meta) * 100 : ingresoBruto > 0 ? 100 : 0
  const anchoRelleno = Math.min(porcentaje, 100)
  const superado = meta > 0 ? ingresoBruto > meta : ingresoBruto > 0
  const llegoAlTope = porcentaje >= 100

  return (
    <div className="relative isolate overflow-hidden rounded-lg border border-purple-300 bg-surface px-4 pb-[11px] pt-[11px]">
      {llegoAlTope && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 w-1/2 animate-brillo-tarjeta"
          style={{
            animationDelay: '3s',
            backgroundImage:
              'linear-gradient(100deg, transparent, rgba(216,180,254,0.08), transparent)',
          }}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <TextoBrillante
          activo={llegoAlTope}
          color="#f0ede6"
          className="text-sm font-semibold"
          claseColorInactiva="text-ink"
        >
          Punto de equilibrio
        </TextoBrillante>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-ink/50">
          {superado && <ArrowUp className="h-3 w-3 animate-elevar-flecha text-green" />}
          <TextoBrillante activo={llegoAlTope} color="rgba(240,237,230,0.5)">
            {ingresoBruto.toFixed(2)} - {meta.toFixed(2)}
          </TextoBrillante>
        </span>
      </div>

      <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-purple-300/20 to-purple-300 transition-[width] duration-500"
          style={{ width: `${anchoRelleno}%` }}
        />
        <Brillo activo={llegoAlTope} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <TextoBrillante activo={llegoAlTope} color="rgba(240,237,230,0.6)" className="text-xs">
          {ETIQUETA_COBERTURA[filtro]}
        </TextoBrillante>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-ink/50">
          {porcentaje > 100 && <ArrowUp className="h-3 w-3 animate-elevar-flecha text-green" />}
          <TextoBrillante activo={llegoAlTope} color="rgba(240,237,230,0.5)">
            {Math.round(porcentaje)}% - 100%
          </TextoBrillante>
        </span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [filtro, setFiltro] = useState('semana')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [metricas, setMetricas] = useState(METRICAS_VACIAS)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  async function cargarDatos() {
    setCargando(true)
    setError(null)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    const { data: ventasActivas, error: errorVentas } = await supabase
      .from('ventas')
      .select('id')
      .eq('estado', 'ACTIVA')
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())

    if (errorVentas) {
      setError('No se pudo cargar el dashboard.')
      setMetricas(METRICAS_VACIAS)
      setCargando(false)
      return
    }

    const idsVentas = (ventasActivas ?? []).map((v) => v.id)

    let ingresoProductos = 0
    let ingresoServicios = 0
    let costoProductos = 0
    let productosVendidos = 0
    let serviciosRealizados = 0

    if (idsVentas.length > 0) {
      const { data: items, error: errorItems } = await supabase
        .from('venta_items')
        .select('tipo, cantidad, subtotal, producto_id')
        .in('venta_id', idsVentas)

      if (errorItems) {
        setError('No se pudo cargar el dashboard.')
        setMetricas(METRICAS_VACIAS)
        setCargando(false)
        return
      }

      // productos.costo no es visible por columna para "authenticated"; se pide
      // por productos_vista (que sí lo expone) en vez de embeberlo en venta_items.
      const idsProductos = [
        ...new Set(
          (items ?? [])
            .filter((item) => item.tipo === 'PRODUCTO' && item.producto_id)
            .map((item) => item.producto_id),
        ),
      ]

      let costoPorProducto = new Map()
      if (idsProductos.length > 0) {
        const { data: productosData } = await supabase
          .from('productos_vista')
          .select('id, costo')
          .in('id', idsProductos)
        costoPorProducto = new Map((productosData ?? []).map((p) => [p.id, p.costo]))
      }

      for (const item of items ?? []) {
        if (item.tipo === 'PRODUCTO') {
          ingresoProductos += item.subtotal
          productosVendidos += item.cantidad
          costoProductos += (costoPorProducto.get(item.producto_id) ?? 0) * item.cantidad
        } else {
          ingresoServicios += item.subtotal
          serviciosRealizados += item.cantidad
        }
      }
    }

    // Mes de referencia para los gastos: el mes actual para Hoy/Semana/Mes,
    // o el mes donde empieza el rango para Personalizado.
    const mesReferencia = filtro === 'personalizado' ? desde : new Date()
    const anioReferencia = mesReferencia.getFullYear()
    const mesReferenciaIndice = mesReferencia.getMonth()

    const { data: gastosData } = await supabase
      .from('gastos')
      .select('monto')
      .eq('mes', mesReferenciaIndice + 1)
      .eq('anio', anioReferencia)
    const gastosMesTotal = (gastosData ?? []).reduce((acumulado, g) => acumulado + g.monto, 0)

    const gastosProrrateados = calcularGastosProrrateados({
      filtro,
      gastosMesTotal,
      anio: anioReferencia,
      mes: mesReferenciaIndice,
      desde,
      hasta,
    })

    setMetricas({
      ingresoProductos,
      ingresoServicios,
      costoProductos,
      productosVendidos,
      serviciosRealizados,
      cantidadVentas: idsVentas.length,
      gastosMes: gastosProrrateados,
    })
    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [filtro, personalizado.desde, personalizado.hasta])

  const ingresoBruto = metricas.ingresoProductos + metricas.ingresoServicios
  const gananciaProductos = metricas.ingresoProductos - metricas.costoProductos

  // 1. Ingreso bruto → 2. −10% gastos operativos (estimado, sobre el ingreso bruto) →
  // 3. −Costo de productos → 4. −Gastos reales del mes (solo si filtro = "mes") = Utilidad neta →
  // 5. −10% diezmo (sobre la utilidad neta, en cascada) = Ganancia final.
  const gastosOperativos = ingresoBruto * 0.1
  const saldoTrasOperativos = ingresoBruto - gastosOperativos
  const saldoTrasCosto = saldoTrasOperativos - metricas.costoProductos
  const utilidadNeta = saldoTrasCosto - metricas.gastosMes
  const montoDiezmo = utilidadNeta * 0.1
  const gananciaFinal = utilidadNeta - montoDiezmo
  const metaEquilibrio = gastosOperativos + metricas.costoProductos + metricas.gastosMes

  const pasosPrevios = [
    { etiqueta: 'Ingreso bruto', valor: ingresoBruto },
    { etiqueta: '10% gastos operativos (estimado)', valor: -gastosOperativos },
    { etiqueta: 'Costo de productos vendidos', valor: -metricas.costoProductos },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: -metricas.gastosMes },
  ]

  return (
    <div className="p-3 pb-6">
      {/* Filtros de fecha: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 bg-bg px-3 py-2">
        <div className="grid grid-cols-4 gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`min-w-0 overflow-visible whitespace-nowrap rounded-full px-1 py-2 text-center text-xs transition-colors sm:px-4 sm:py-1.5 sm:text-sm ${
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
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-ink/50">Desde</label>
            <input
              type="date"
              value={personalizado.desde}
              onChange={(evento) =>
                setPersonalizado((anterior) => ({ ...anterior, desde: evento.target.value }))
              }
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink/50">Hasta</label>
            <input
              type="date"
              value={personalizado.hasta}
              onChange={(evento) =>
                setPersonalizado((anterior) => ({ ...anterior, hasta: evento.target.value }))
              }
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">Cargando dashboard...</p>
      ) : (
        <>
          {/* Punto de equilibrio: barra tipo termómetro */}
          <div className="mt-4">
            <BarraTermometro filtro={filtro} ingresoBruto={ingresoBruto} meta={metaEquilibrio} />
          </div>

          {/* Tarjetas: orden personalizado en móvil */}
          <div className="mt-4 grid grid-cols-3 gap-3 sm:hidden">
            <TarjetaResumen
              etiqueta="Ingreso bruto"
              valor={formatearSoles(ingresoBruto)}
              claseValor="text-green"
            />
            <TarjetaResumen
              etiqueta="Ingreso productos"
              valor={formatearSoles(metricas.ingresoProductos)}
              claseValor="text-amber"
            />
            <TarjetaResumen
              etiqueta="Ingreso servicios"
              valor={formatearSoles(metricas.ingresoServicios)}
              claseValor="text-blue"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:hidden">
            <TarjetaResumen
              etiqueta="Costo productos"
              valor={formatearSoles(metricas.costoProductos)}
              claseValor="text-red"
            />
            <TarjetaResumen
              etiqueta="Ganancia productos"
              valor={formatearSoles(gananciaProductos)}
              claseValor="text-green"
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:hidden">
            <TarjetaResumen
              etiqueta={ETIQUETA_GASTOS[filtro]}
              valor={formatearSoles(metricas.gastosMes)}
              claseValor="text-blue"
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:hidden">
            <TarjetaResumen etiqueta="Ventas" valor={metricas.cantidadVentas} />
            <TarjetaResumen
              etiqueta="Productos vendidos"
              valor={`${metricas.productosVendidos} uds.`}
              claseValor="text-ink"
            />
            <TarjetaResumen etiqueta="Servicios realizados" valor={metricas.serviciosRealizados} />
          </div>

          {/* Tarjetas: tablet y desktop */}
          <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-3">
            <TarjetaResumen
              etiqueta="Ingreso bruto total"
              valor={formatearSoles(ingresoBruto)}
              claseValor="text-green"
            />
            <TarjetaResumen
              etiqueta="Ingreso por productos"
              valor={formatearSoles(metricas.ingresoProductos)}
              claseValor="text-amber"
            />
            <TarjetaResumen
              etiqueta="Ingreso por servicios"
              valor={formatearSoles(metricas.ingresoServicios)}
              claseValor="text-blue"
            />
            <TarjetaResumen
              etiqueta="Costo de productos vendidos"
              valor={formatearSoles(metricas.costoProductos)}
              claseValor="text-red"
            />
            <TarjetaResumen
              etiqueta="Ganancia de productos"
              valor={formatearSoles(gananciaProductos)}
              claseValor="text-green"
            />
            <TarjetaResumen
              etiqueta={ETIQUETA_GASTOS[filtro]}
              valor={formatearSoles(metricas.gastosMes)}
              claseValor="text-blue"
            />
            <TarjetaResumen etiqueta="Cantidad de ventas" valor={metricas.cantidadVentas} />
            <TarjetaResumen
              etiqueta="Productos vendidos"
              valor={`${metricas.productosVendidos} uds.`}
              claseValor="text-ink"
            />
            <TarjetaResumen
              etiqueta="Servicios realizados"
              valor={metricas.serviciosRealizados}
            />
          </div>

          {/* Cascada de ganancia */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Cascada de ganancia</h2>
            <div className="mt-3 space-y-2">
              {pasosPrevios.map((paso) => (
                <div key={paso.etiqueta} className="flex items-center justify-between text-sm">
                  <span className="text-ink/60">{paso.etiqueta}</span>
                  <span
                    className={`font-mono ${paso.valor < 0 ? 'text-red' : 'text-green'}`}
                  >
                    {paso.valor < 0 ? '− ' : ''}
                    {formatearSoles(Math.abs(paso.valor))}
                  </span>
                </div>
              ))}

              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm text-ink/70">Utilidad neta</span>
                <span className="font-mono text-sm font-semibold text-ink">
                  {formatearSoles(utilidadNeta)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-ink/60">10% diezmo</span>
                <span className="font-mono text-red">− {formatearSoles(montoDiezmo)}</span>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm font-semibold text-ink">Ganancia final</span>
                <span
                  className={`font-mono text-lg font-semibold ${
                    gananciaFinal < 0 ? 'text-red' : 'text-green'
                  }`}
                >
                  {formatearSoles(gananciaFinal)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
