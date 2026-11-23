import { forwardRef, useEffect, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { formatearSoles } from '../lib/moneda.js'
import {
  PESTANAS_DETALLE,
  TAM_PAGINA_DETALLE,
  filtrarDetalle,
  formatearFechaHoraLima,
  paginarDetalle,
  totalDetalle,
  totalesProductos,
} from '../lib/detalleDashboard.js'
import { obtenerDetalleDashboard, obtenerDetalleGastos } from '../lib/detalleDashboardDatos.js'
import BarraBusqueda from './BarraBusqueda.jsx'
import BotonFlechaDesplegable from './BotonFlechaDesplegable.jsx'
import CampoColapsable from './CampoColapsable.jsx'
import EstadoVacio from './EstadoVacio.jsx'
import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'
import PaginadorLista from './PaginadorLista.jsx'

const NOMBRE_VACIO = {
  productos: 'No se vendieron productos en este período.',
  servicios: 'No se cobraron servicios en este período.',
  descuentos: 'No hubo descuentos en este período.',
  comisiones: 'No hay comisiones a pagar en este período.',
  gastos: 'No hay gastos registrados en este mes.',
  envios: 'No se cobró envío en este período.',
}

const ETIQUETA_LISTA = {
  productos: 'productos',
  servicios: 'servicios',
  descuentos: 'ventas con descuento',
  comisiones: 'comisiones',
  gastos: 'gastos',
  envios: 'envíos',
}

const soles = (valor) => formatearSoles(Number(valor ?? 0))

function unir(partes) {
  return partes.filter(Boolean).join(' · ')
}

// Cuadrícula «etiqueta / valor» del desplegable: dos columnas en móvil, más en pantallas anchas. Los campos vacíos no se pintan.
function Datos({ items }) {
  const visibles = items.filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
      {visibles.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="min-w-0">
          <dt className="text-ink/50">{etiqueta}</dt>
          <dd className="break-words font-medium text-ink">{valor}</dd>
        </div>
      ))}
    </dl>
  )
}

// Fila de una sola línea (título + monto + flecha). Todo lo demás vive en el desplegable, que se desliza con CampoColapsable
// (docs/patrones/desplegable-animado.md). Al abrir, el título se pinta del color del Dashboard y vuelve a la normalidad al cerrar;
// abierto se muestra completo (cerrado se recorta para no pasar de una línea). En pantallas anchas, `resumen` ocupa el hueco de la fila.
function FilaExpandible({ abierto, onAlternar, titulo, resumen, monto, claseMonto, children }) {
  return (
    <li>
      <div className="flex cursor-pointer items-center gap-2 px-1 py-2" onClick={onAlternar}>
        <p
          className={`min-w-0 flex-1 text-sm font-medium transition-colors duration-300 ${
            abierto ? 'break-words text-purple-300' : 'truncate text-ink'
          }`}
        >
          {titulo}
        </p>
        {resumen && <p className="hidden min-w-0 max-w-[55%] truncate text-xs text-ink/60 lg:block">{resumen}</p>}
        <span className={`shrink-0 whitespace-nowrap font-mono text-sm ${claseMonto}`}>{monto}</span>
        <BotonFlechaDesplegable
          plano
          abierto={abierto}
          onClick={(evento) => {
            evento.stopPropagation()
            onAlternar()
          }}
        />
      </div>
      <CampoColapsable abierto={abierto} diferido>
        <div className="space-y-3 px-1 pb-6 pt-1">{children}</div>
      </CampoColapsable>
    </li>
  )
}

// Productos: el desplegable lleva unidades, costo, ganancia y stock, y después cada venta (a quién, quién vendió, cuándo). La
// cantidad × precio va chica bajo el monto para que el monto sea lo que se lee.
function VentasDelProducto({ ventas }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink/70">Ventas</p>
      <ul className="mt-1">
        {ventas.map((venta, indice) => (
          <li
            key={`${venta.codigo}-${indice}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-border py-2 text-xs first:border-t-0"
          >
            <p className="break-words text-sm font-medium text-ink">{venta.cliente ?? 'Sin cliente'}</p>
            <p className="text-right font-mono text-sm text-ink">{soles(venta.subtotal)}</p>
            <p className="break-words text-ink/60">
              {unir([formatearFechaHoraLima(venta.fecha), venta.codigo, venta.vendedor ? `Vendió ${venta.vendedor}` : null])}
            </p>
            <p className="whitespace-nowrap text-right font-mono text-ink/50">
              {venta.cantidad} × {soles(venta.precio_unitario)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function renderFila(pestana, fila, indice, expandidos, alternar) {
  const abrirDe = (clave) => ({ abierto: expandidos.has(clave), onAlternar: () => alternar(clave) })

  if (pestana === 'productos') {
    const clave = `productos|${fila.producto_id ?? fila.nombre}`
    const stock = fila.stock_actual == null ? '—' : fila.stock_actual
    return (
      <FilaExpandible
        key={clave}
        {...abrirDe(clave)}
        titulo={fila.nombre}
        resumen={`${fila.unidades} ${fila.unidades === 1 ? 'ud.' : 'uds.'} · Ganancia ${soles(fila.ganancia)} · Stock ${stock}`}
        monto={`+${soles(fila.ingreso)}`}
        claseMonto="text-amber"
      >
        <Datos
          items={[
            ['Unidades', String(fila.unidades)],
            ['Costo', soles(fila.costo)],
            ['Ganancia', soles(fila.ganancia)],
            ['Stock actual', String(stock)],
          ]}
        />
        <VentasDelProducto ventas={fila.ventas} />
      </FilaExpandible>
    )
  }

  if (pestana === 'servicios') {
    const clave = `servicios|${fila.codigo}|${fila.servicio}|${indice}`
    return (
      <FilaExpandible
        key={clave}
        {...abrirDe(clave)}
        titulo={`${fila.cantidad > 1 ? `${fila.cantidad} × ` : ''}${fila.servicio}`}
        resumen={unir([fila.cliente ?? 'Sin cliente', fila.asistente])}
        monto={`+${soles(fila.precio)}`}
        claseMonto="text-blue"
      >
        <Datos
          items={[
            ['Cliente', fila.cliente ?? 'Sin cliente'],
            ['Atendió', fila.asistente],
            ['Comisión', fila.comision != null ? soles(fila.comision) : null],
            ['Fecha', formatearFechaHoraLima(fila.fecha)],
            ['Venta', fila.codigo],
          ]}
        />
      </FilaExpandible>
    )
  }

  if (pestana === 'descuentos') {
    const clave = `descuentos|${fila.codigo}|${indice}`
    return (
      <FilaExpandible
        key={clave}
        {...abrirDe(clave)}
        titulo={fila.cliente ?? 'Sin cliente'}
        resumen={unir([`Subtotal ${soles(fila.subtotal)}`, fila.cupon ? `Cupón ${fila.cupon}` : null, fila.codigo])}
        monto={`−${soles(fila.descuento)}`}
        claseMonto="text-red"
      >
        <Datos
          items={[
            ['Subtotal', soles(fila.subtotal)],
            ['Cobrado', soles(fila.total)],
            ['Descuento', Number(fila.descuento_pct) > 0 ? `${Number(fila.descuento_pct)} %` : null],
            ['Monto descontado', Number(fila.descuento_monto) > 0 ? soles(fila.descuento_monto) : null],
            ['Cupón', fila.cupon],
            ['Fecha', formatearFechaHoraLima(fila.fecha)],
            ['Venta', fila.codigo],
          ]}
        />
      </FilaExpandible>
    )
  }

  if (pestana === 'comisiones') {
    const clave = `comisiones|${fila.fecha}|${fila.asistente}|${indice}`
    return (
      <FilaExpandible
        key={clave}
        {...abrirDe(clave)}
        titulo={fila.asistente ?? 'Sin asistente'}
        resumen={unir([fila.servicio, fila.cliente])}
        monto={`−${soles(fila.pago)}`}
        claseMonto="text-red"
      >
        <Datos
          items={[
            ['Servicio', fila.servicio],
            ['Cliente', fila.cliente],
            ['Precio', soles(fila.precio)],
            ['Porcentaje', fila.porcentaje != null ? `${Number(fila.porcentaje)} %` : null],
            ['Fecha', formatearFechaHoraLima(fila.fecha)],
          ]}
        />
      </FilaExpandible>
    )
  }

  if (pestana === 'gastos') {
    // Un gasto solo tiene nombre, tipo y monto: cabe todo en la fila, no necesita desplegable.
    return (
      <li key={fila.id} className="flex items-center gap-2 px-1 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{fila.nombre}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
            fila.tipo === 'FIJO'
              ? 'border-blue/40 bg-blue/10 text-blue'
              : 'border-purple-300/60 bg-purple-300/15 text-purple-300'
          }`}
        >
          {fila.tipo === 'FIJO' ? 'Fijo' : 'Variable'}
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-sm text-red">−{soles(fila.monto)}</span>
      </li>
    )
  }

  const clave = `envios|${fila.codigo}|${indice}`
  return (
    <FilaExpandible
      key={clave}
      {...abrirDe(clave)}
      titulo={fila.cliente ?? 'Sin cliente'}
      resumen={unir([formatearFechaHoraLima(fila.fecha), fila.codigo])}
      monto={soles(fila.envio)}
      claseMonto="text-ink/60"
    >
      <Datos
        items={[
          ['Entrega', fila.tipo_entrega === 'DELIVERY' ? 'Delivery' : fila.tipo_entrega],
          ['Fecha', formatearFechaHoraLima(fila.fecha)],
          ['Venta', fila.codigo],
        ]}
      />
    </FilaExpandible>
  )
}

function PieTotales({ pestana, filas, gastosPeriodo, etiquetaGastos, filtrado }) {
  const lineas = []
  if (pestana === 'productos') {
    const { ingreso, costo, ganancia, unidades } = totalesProductos(filas)
    lineas.push(['Unidades vendidas', String(unidades)])
    lineas.push(['Ingreso productos', soles(ingreso)])
    lineas.push(['Costo de los productos', `−${soles(costo)}`])
    lineas.push(['Ganancia productos', soles(ganancia)])
  } else if (pestana === 'gastos') {
    lineas.push([filtrado ? 'Gastos del mes (búsqueda)' : 'Gastos del mes', `−${soles(totalDetalle('gastos', filas))}`])
    // El prorrateo es del mes completo: con una búsqueda activa no se puede repartir, así que no se muestra.
    if (!filtrado) lineas.push([etiquetaGastos, `−${soles(gastosPeriodo)}`])
  } else {
    const etiqueta = PESTANAS_DETALLE.find((p) => p.id === pestana)?.etiqueta ?? 'Total'
    const prefijo = pestana === 'descuentos' || pestana === 'comisiones' ? '−' : ''
    lineas.push([`Total ${etiqueta.toLowerCase()}`, `${prefijo}${soles(totalDetalle(pestana, filas))}`])
  }
  return (
    <div className="mt-3 space-y-1 border-t border-border pt-3">
      {filtrado && <p className="text-xs text-ink/50">Totales de lo que coincide con la búsqueda.</p>}
      {lineas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 text-ink/70">{etiqueta}</span>
          <span className="shrink-0 whitespace-nowrap font-mono font-semibold text-ink">{valor}</span>
        </div>
      ))}
    </div>
  )
}

// Selector de rubro para móvil: mismo diseño que el desplegable de meses de FiltrosFecha (botón redondeado con flechita y una
// lista que cae debajo; se cierra al tocar fuera o con Esc).
function SelectorRubro({ pestana, onElegir }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)

  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (evento) => {
      if (raiz.current && !raiz.current.contains(evento.target)) setAbierto(false)
    }
    const esc = (evento) => {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])

  const actual = PESTANAS_DETALLE.find((p) => p.id === pestana)?.etiqueta ?? ''

  return (
    <div ref={raiz} className="relative shrink-0 lg:hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={`Rubro del detalle: ${actual}`}
        className="flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-purple-300 bg-purple-300 px-3 py-2 text-xs font-semibold text-bg"
      >
        <span>{actual}</span>
        <IconoFlechaDesplegable className={`h-3 w-3 shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-44 overflow-y-auto rounded-xl border border-border bg-surface-2 p-1 shadow-lg"
        >
          {PESTANAS_DETALLE.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={pestana === p.id}
                onClick={() => {
                  setAbierto(false)
                  onElegir(p.id)
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  pestana === p.id ? 'bg-purple-300 font-semibold text-bg' : 'text-ink/70 hover:bg-ink/10'
                }`}
              >
                {p.etiqueta}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// «Detalle del período» del Dashboard: las filas que componen cada monto del Resumen, para el mismo rango de fechas. Carga solo
// la pestaña abierta. `version` cambia cada vez que el Dashboard recarga sus métricas: invalida lo ya leído. El Dashboard vive
// en PestanasCacheadas, así que no se consulta nada mientras `activo` sea false.
const DetalleDashboard = forwardRef(function DetalleDashboard(
  { pestana, onCambiarPestana, filtro, personalizado, activo, version, gastosPeriodo, etiquetaGastos },
  ref,
) {
  const claveDatos = `${pestana}|${filtro}|${personalizado.desde}|${personalizado.hasta}|${version}`
  const cache = useRef(new Map())
  const [estado, setEstado] = useState({ clave: '', filas: null, error: false })
  const [intento, setIntento] = useState(0)
  const [paginaEstado, setPaginaEstado] = useState({ clave: '', pagina: 1 })
  const [expandidos, setExpandidos] = useState(() => new Set())
  // La búsqueda se conserva al cambiar de rubro: sirve para seguir a una clienta o a una asistente por todos los rubros.
  const [busqueda, setBusqueda] = useState('')

  // Todo lo que la lectura necesita entra por las dependencias del efecto (no por un Effect Event): con useEffectEvent la
  // función veía la pestaña ANTERIOR al cambiar de rubro, no pedía nada y el esqueleto se quedaba para siempre.
  const desde = personalizado.desde
  const hasta = personalizado.hasta
  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    async function leer() {
      const enCache = cache.current.get(claveDatos)
      if (enCache) {
        setEstado({ clave: claveDatos, filas: enCache, error: false })
        return
      }
      setEstado({ clave: '', filas: null, error: false })
      const rango = { desde, hasta }
      const { filas, error } =
        pestana === 'gastos'
          ? await obtenerDetalleGastos(filtro, rango)
          : await obtenerDetalleDashboard(pestana, filtro, rango)
      if (!vigente.actual) return
      if (error) {
        setEstado({ clave: claveDatos, filas: null, error: true })
        return
      }
      cache.current.set(claveDatos, filas)
      setEstado({ clave: claveDatos, filas, error: false })
    }
    leer()
    return () => {
      vigente.actual = false
    }
  }, [activo, claveDatos, intento, pestana, filtro, desde, hasta])

  const listo = estado.clave === claveDatos
  const filas = listo ? estado.filas : null
  const hayError = listo && estado.error

  const buscando = busqueda.trim() !== ''
  const filasVisibles = filas ? filtrarDetalle(pestana, filas, busqueda) : null
  // La página vuelve a la 1 al cambiar de rubro, de rango o de búsqueda.
  const clavePagina = `${claveDatos}|${busqueda}`
  const pagina = paginaEstado.clave === clavePagina ? paginaEstado.pagina : 1
  const paginado = filasVisibles ? paginarDetalle(filasVisibles, pagina) : null
  const nombrePestana = PESTANAS_DETALLE.find((p) => p.id === pestana)?.etiqueta ?? ''

  function alternar(clave) {
    setExpandidos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  return (
    <section
      ref={ref}
      aria-label="Detalle del período"
      className="mt-(--separador-horizontal) scroll-mt-24 pb-4"
    >
      {/* Buscador + rubro, FIJOS bajo la barra de fechas del Dashboard al hacer scroll (--alto-filtros la mide Dashboard.jsx).
          Móvil: buscador y desplegable de rubro. PC: buscador y, en la MISMA fila, todos los rubros; si no cabe, se achica el
          buscador (nunca los rubros). */}
      <div className="sticky top-[var(--alto-filtros,0px)] z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-sm lg:min-w-32">
          <BarraBusqueda
            valor={busqueda}
            onCambiar={setBusqueda}
            placeholder={`Buscar en ${nombrePestana.toLowerCase()}...`}
            tema="purple-300"
            sinVoz
          />
        </div>

        <SelectorRubro pestana={pestana} onElegir={onCambiarPestana} />

        <div role="tablist" aria-label="Rubro del detalle" className="hidden shrink-0 items-center gap-1.5 lg:flex">
          {PESTANAS_DETALLE.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              onClick={() => onCambiarPestana(p.id)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-xs transition-colors ${
                pestana === p.id
                  ? 'border border-purple-300 bg-purple-300 font-semibold text-bg'
                  : 'border border-border text-ink/70 hover:text-purple-300'
              }`}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-xs text-ink/60" aria-live="polite">
        <span className="font-semibold text-ink">{nombrePestana}</span>
        {paginado ? ` · ${paginado.total} ${paginado.total === 1 ? 'resultado' : 'resultados'}` : ''}
      </p>

      <div className="mt-2" role="tabpanel" aria-busy={!listo}>
        {!listo && (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="h-12 animate-pulse rounded-lg bg-surface-3" />
            ))}
          </div>
        )}

        {hayError && (
          <div className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
            No se pudo cargar el detalle. Esto no significa que no haya datos.{' '}
            <button type="button" onClick={() => setIntento((n) => n + 1)} className="font-semibold underline">
              Reintentar
            </button>
          </div>
        )}

        {paginado && paginado.total === 0 && (
          <EstadoVacio
            icono={ClipboardList}
            mensaje={buscando ? `Nada coincide con «${busqueda.trim()}» en ${nombrePestana.toLowerCase()}.` : NOMBRE_VACIO[pestana]}
            accion={buscando ? { label: 'Limpiar búsqueda', onClick: () => setBusqueda('') } : undefined}
            tema="purple-300"
          />
        )}

        {paginado && paginado.total > 0 && (
          <>
            <ul className="divide-y divide-border border-y border-border">
              {paginado.filas.map((fila, indice) => renderFila(pestana, fila, indice, expandidos, alternar))}
            </ul>
            <PaginadorLista
              pagina={paginado.pagina}
              totalPaginas={paginado.totalPaginas}
              total={paginado.total}
              tam={TAM_PAGINA_DETALLE}
              onPagina={(nueva) => setPaginaEstado({ clave: clavePagina, pagina: nueva })}
              etiqueta={ETIQUETA_LISTA[pestana]}
            />
          </>
        )}

        {filasVisibles && (
          <PieTotales
            pestana={pestana}
            filas={filasVisibles}
            gastosPeriodo={gastosPeriodo}
            etiquetaGastos={etiquetaGastos}
            filtrado={buscando}
          />
        )}
      </div>
    </section>
  )
})

export default DetalleDashboard
