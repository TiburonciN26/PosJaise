import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../context/ToastContext.jsx'
import BotonFlechaDesplegable from '../../components/BotonFlechaDesplegable.jsx'
import CampoColapsable from '../../components/CampoColapsable.jsx'
import BuscadorAlmacen from './BuscadorAlmacen.jsx'
import {
  CATEGORIAS_MATERIAL,
  CATEGORIAS_OTRO_COSTO,
  CATEGORIAS_SERVICIO,
  MAX_LINEAS_SERVICIO,
  aCentavos,
  costoPorUsoLinea,
  cuponMaximoParejo,
  esCategoriaMaterial,
  lineaServicioVacia,
  lineasServicioAJson,
  motivoSinMargen,
  resultadoPorAsistente,
  subtotalLineaServicio,
  totalesServicio,
  validarLineasServicio,
} from '../../lib/costeoRecompensas.js'
import { soles, solesPrecisos } from './formato.js'

// Costeo detallado de UN servicio (pestaña Web → Recompensas → Costeo de servicios). Solo administradora.
//
// La receta son líneas de costo. Los MATERIALES (insumo, descartable, herramienta) se eligen SOLO del almacén (con buscador): no se
// escriben sueltos. Lo que no es material (tarjeta/POS, otro costo, tiempo del local) se agrega aparte. Cada línea dice cuánto costó
// lo comprado y para cuántos usos rinde: el sistema calcula solo el costo por uso (no se escribe a mano). La MANO DE OBRA
// no se escribe: es la comisión REAL de cada asistente (su % en ese servicio × el precio real), y una promoción o un cupón del salón
// no la reduce. Los % ya existen (los define la administración); aquí solo se leen para mostrar el margen de cada una.
// Los borradores viven en el padre (almacén por id de servicio): sobreviven a plegar la fila, paginar y buscar.

const CAMPO_LINEA = 'w-full rounded-lg border border-border bg-surface px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-azul-metal'

function CampoLinea({ id, etiqueta, ayuda, clase = '', children }) {
  return (
    <div className={clase}>
      <label htmlFor={id} className="mb-0.5 block text-[11px] text-ink/60">
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="mt-0.5 text-[10px] text-ink/40">{ayuda}</p>}
    </div>
  )
}

function EditorLineas({ idBase, lineas, precio, sugeridos, onChange }) {
  const cambiar = (i, parche) => onChange(lineas.map((l, k) => (k === i ? { ...l, ...parche } : l)))
  const quitar = (i) => onChange(lineas.filter((_, k) => k !== i))
  const llena = lineas.length >= MAX_LINEAS_SERVICIO
  const usados = lineas.map((l) => l.almacenArticuloId).filter(Boolean)

  // Los datos del artículo (nombre, unidad y costo de la última compra) vienen del almacén; solo falta decir cuántos usos rinde.
  const datosDeArticulo = (art) => ({
    descripcion: art.nombre,
    almacenArticuloId: art.articulo_id,
    unidad: art.unidad ?? '',
    costoCompra: art.costo_unitario === null ? '' : String(Number(art.costo_unitario)),
  })
  const agregarMaterial = (art) => {
    if (!llena) onChange([...lineas, { ...lineaServicioVacia('INSUMO'), ...datosDeArticulo(art) }])
  }

  return (
    <div>
      <p className="mb-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-ink/70">
        <b>Ejemplo:</b> un frasco de alcohol cuesta S/ 10 y rinde 100 usos. Lo eliges del almacén, escribes que rinde 100 y el sistema calcula solo
        que cada uso cuesta S/ 0,10. Si este servicio gasta 1 uso, la línea suma S/ 0,10 (no los S/ 10 del frasco). Los materiales solo se
        eligen del almacén: no se escriben sueltos.
      </p>
      {lineas.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-ink/60">
          Sin líneas todavía. Busca en el almacén cada insumo y descartable que consume este servicio. Guardar sin líneas también es válido:
          significa que el servicio no tiene costo directo (decisión explícita).
        </p>
      )}
      <ul className="space-y-2">
        {lineas.map((l, i) => {
          const n = i + 1
          const esMaterial = esCategoriaMaterial(l.categoria)
          const categorias = esMaterial ? CATEGORIAS_MATERIAL : CATEGORIAS_OTRO_COSTO
          const cat = CATEGORIAS_SERVICIO.find((c) => c.id === l.categoria)
          const porUso = costoPorUsoLinea(l)
          const subtotal = subtotalLineaServicio(l)
          const sinVincular = esMaterial && !l.almacenArticuloId
          const id = (campo) => `${idBase}-l${i}-${campo}`
          return (
            <li key={l.id ?? `n${i}`} className="rounded-lg border border-border bg-surface-2 p-2">
              <div className="grid grid-cols-2 gap-2">
                {esMaterial && !sinVincular && (
                  <div className="col-span-2 rounded-lg bg-surface px-2 py-1.5">
                    <p className="text-[11px] text-ink/60">Material del almacén</p>
                    <p className="text-sm font-medium text-ink">
                      {l.descripcion}
                      {l.unidad ? <span className="font-normal text-ink/60"> · {l.unidad}</span> : null}
                    </p>
                  </div>
                )}
                {sinVincular && (
                  <div className="col-span-2">
                    <p role="note" className="mb-1 text-[11px] text-amber">
                      {l.descripcion ? `«${l.descripcion}» no está vinculado al almacén. ` : ''}Elige el material del almacén para poder guardar, o quita esta línea.
                    </p>
                    <BuscadorAlmacen
                      id={id('vincular')}
                      articulos={sugeridos}
                      usados={usados}
                      onElegir={(art) => cambiar(i, datosDeArticulo(art))}
                    />
                  </div>
                )}
                <CampoLinea id={id('cat')} etiqueta={esMaterial ? 'Tipo de material' : 'Tipo de costo'} clase="col-span-2">
                  <select id={id('cat')} className={CAMPO_LINEA} value={l.categoria} onChange={(e) => cambiar(i, { categoria: e.target.value })}>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                        {c.piso ? '' : ' (informativo)'}
                      </option>
                    ))}
                  </select>
                </CampoLinea>
                {!esMaterial && (
                  <CampoLinea id={id('desc')} etiqueta="¿Qué es?" clase="col-span-2">
                    <input id={id('desc')} placeholder="Ej.: Comisión del POS, uso del local 60 min" maxLength={120} className={CAMPO_LINEA} value={l.descripcion} onChange={(e) => cambiar(i, { descripcion: e.target.value })} />
                  </CampoLinea>
                )}
                <CampoLinea id={id('compra')} etiqueta={esMaterial ? 'Lo que costó lo que compraste (S/)' : 'Costo (S/)'} ayuda={esMaterial ? 'El envase o paquete completo (se trae de la última compra del almacén).' : 'Lo que cuesta en total.'}>
                  <input id={id('compra')} type="number" inputMode="decimal" min="0" step="any" placeholder="Ej.: 10" className={CAMPO_LINEA} value={l.costoCompra} onChange={(e) => cambiar(i, { costoCompra: e.target.value })} />
                </CampoLinea>
                <CampoLinea id={id('rinde')} etiqueta="Rinde para (usos)" ayuda="1 = se gasta entero en un servicio.">
                  <input id={id('rinde')} type="number" inputMode="decimal" min="0" step="any" placeholder="Ej.: 100" className={CAMPO_LINEA} value={l.rinde} onChange={(e) => cambiar(i, { rinde: e.target.value })} />
                </CampoLinea>
                <CampoLinea id={id('cant')} etiqueta="Usos gastados en este servicio" ayuda="Casi siempre 1.">
                  <input id={id('cant')} type="number" inputMode="decimal" min="0" step="any" placeholder="Ej.: 1" className={CAMPO_LINEA} value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} />
                </CampoLinea>
                <div className="col-span-2 flex items-end justify-between gap-2 rounded-lg bg-surface px-2 py-1.5">
                  <div className="font-mono text-xs text-ink/70">
                    <p>Costo por uso (estimado): <span className="text-ink">{porUso === null ? '—' : solesPrecisos(porUso)}</span></p>
                    <p>
                      Esta línea suma: <span className="text-ink">{soles(subtotal)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Quitar la línea ${n}`}
                    onClick={() => quitar(i)}
                    className="flex min-h-8 min-w-8 items-center justify-center rounded-lg text-ink/70 hover:bg-surface-3 hover:text-red"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {cat && <p className="mt-1 text-[11px] text-ink/50">{cat.ayuda}</p>}
              {precio > 0 && subtotal >= precio && (
                <p role="note" className="mt-1 text-[11px] text-amber">
                  Esta sola línea ({soles(subtotal)}) iguala o supera el precio del servicio ({soles(precio)}). Si es un envase que rinde varios servicios, escribe cuántos usos rinde.
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-2 space-y-2">
        <BuscadorAlmacen id={`${idBase}-alm`} articulos={sugeridos} usados={usados} disabled={llena} onElegir={agregarMaterial} />
        <button
          type="button"
          disabled={llena}
          onClick={() => onChange([...lineas, lineaServicioVacia('OTRO')])}
          className="flex items-center gap-1 rounded-lg border border-border-strong px-3 py-2 text-sm text-ink hover:border-azul-metal hover:text-azul-metal disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Agregar otro costo (no es material)
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink/50">
        Los materiales traen el costo de su última compra: solo te falta decir cuántos usos rinde. «Otro costo» sirve para lo que no está en el
        almacén: comisión del POS, otro costo directo o el tiempo del local. Los costos son tuyos: edítalos cuando cambien.
      </p>
    </div>
  )
}

function TablaAsistentes({ precio, totales, asistentes, porcentajeMax }) {
  const filas = [
    ...asistentes.map((a) => ({ clave: a.nombre, nombre: a.nombre, porcentaje: a.porcentaje, aviso: null })),
    { clave: 'duena', nombre: 'Administradora (la dueña)', porcentaje: 0, aviso: 'se queda con el 100 %: no es un pago en efectivo' },
  ]
  // El tope del cupón es PAREJO: depende del servicio, no de quién atienda (así dos clientas con el mismo servicio tienen el mismo tope).
  const tope = cuponMaximoParejo({ precio, materiales: totales.materiales, otros: totales.otros, porcentajeMax })
  const motivoTope = tope.cuponMaximo > 0 ? null : motivoSinMargen({ precio, costoDirecto: tope.piso, margen: aCentavos(Number(precio) - tope.piso) })
  return (
    <div>
      <p className="text-sm font-medium text-ink">Cupón máximo de este servicio</p>
      <div className="mt-1 rounded-lg border border-border bg-surface px-3 py-2">
        <p className="font-mono text-sm text-ink">Cupón máximo para cualquier clienta: {soles(tope.cuponMaximo)}</p>
        <p className="mt-0.5 text-[11px] text-ink/60">
          Es el mismo para todas, atienda quien atienda. Se calcula con la comisión más alta ({Number(porcentajeMax)} % = {soles(tope.comision)}) para que
          el salón no pierda aunque atienda la asistente que más cobra. Piso: materiales + otros directos + esa comisión = {soles(tope.piso)}.
        </p>
        {motivoTope && <p role="note" className="mt-1 text-[11px] text-amber">{motivoTope}</p>}
      </div>

      <p className="mt-3 text-sm font-medium text-ink">Mano de obra real y margen según quién atiende</p>
      <p className="mt-0.5 text-xs text-ink/60">
        Cada asistente cobra su % sobre el precio real ({soles(precio)}). Una promoción o un cupón del salón <b>no</b> le baja la comisión, así
        que el descuento sale del margen del salón. Esto es lo que gana el salón de verdad (y lo que mide el reporte de Rentabilidad); no cambia el tope del cupón.
      </p>
      {asistentes.length === 0 && (
        <p className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-ink/70">
          Ninguna asistente activa tiene porcentaje en este servicio todavía. Mientras tanto solo la administradora puede registrarlo.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {filas.map((f) => {
          const r = resultadoPorAsistente({ precio, materiales: totales.materiales, otros: totales.otros, local: totales.local, porcentaje: f.porcentaje })
          return (
            <li key={f.clave} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-ink">
                  {f.nombre} <span className="font-mono text-xs text-ink/60">· {Number(f.porcentaje)} %</span>
                </span>
                <span className={`shrink-0 font-mono text-sm ${r.margen < 0 ? 'text-red' : 'text-green'}`}>
                  margen {soles(r.margen)} ({r.margenPct} %)
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-ink/60">
                comisión {soles(r.comision)} · costo directo {soles(r.costoDirecto)}
                {totales.local > 0 && ` · con local ${soles(r.margenConLocal)}`}
              </p>
              {f.aviso && <p className="text-[11px] text-ink/50">{f.aviso}</p>}
              {r.margen < 0 && <p role="note" className="mt-1 text-[11px] text-red">Con esta receta, cada servicio hecho por {f.nombre} deja pérdida aun sin cupón.</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function FilaCosteoServicio({ servicio, prot, asistentes, valores, abierto, destacado, sugeridos, onAlternar, onCambiar, onGuardado, onLimpiarBorrador }) {
  const { mostrarToast } = useToast()
  const [guardando, setGuardando] = useState(false)
  const ref = useRef(null)
  const idBase = useRef(`ct-${servicio.id.slice(0, 8)}`).current
  const lineas = valores.lineas
  const precio = Number(servicio.precio)
  const totales = totalesServicio(lineas)
  const porcentajeMax = asistentes.reduce((m, a) => Math.max(m, Number(a.porcentaje)), 0)

  useEffect(() => {
    if (destacado) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [destacado])

  async function guardar() {
    const problema = validarLineasServicio(lineas)
    if (problema) {
      mostrarToast(problema, 'error')
      return
    }
    setGuardando(true)
    const { error } = await supabase.rpc('guardar_costeo_servicio', { p_servicio_id: servicio.id, p_lineas: lineasServicioAJson(lineas) })
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo guardar el costeo.', 'error')
      return
    }
    mostrarToast('Costeo guardado.', 'exito')
    onLimpiarBorrador(servicio.id)
    onGuardado()
  }

  async function quitar() {
    setGuardando(true)
    const { error } = await supabase.rpc('quitar_costeo_servicio', { p_servicio_id: servicio.id })
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo quitar la configuración.', 'error')
      return
    }
    mostrarToast('Servicio sin configurar.', 'exito')
    onLimpiarBorrador(servicio.id)
    onGuardado()
  }

  const alternar = () => onAlternar(servicio.id)

  return (
    <li ref={ref} className={`rounded-lg border bg-surface ${destacado ? 'border-azul-metal' : 'border-border'}`}>
      <div className="flex cursor-pointer items-center gap-2 px-3 py-2" onClick={alternar}>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium transition-colors duration-300 ${abierto ? 'text-azul-metal' : 'text-ink'}`}>{servicio.nombre}</span>
          <span className="block truncate font-mono text-xs text-ink/60">Precio {soles(servicio.precio)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${prot ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'}`}>
          {prot ? 'Costeado' : 'Sin configurar'}
        </span>
        <BotonFlechaDesplegable plano abierto={abierto} onClick={(e) => { e.stopPropagation(); alternar() }} />
      </div>
      <CampoColapsable abierto={abierto} diferido>
        <div className="space-y-4 border-t border-border p-3">
          <div>
            <p className="text-sm font-medium text-ink">Receta de costos (por cada vez que se hace el servicio)</p>
            <div className="mt-2">
              <EditorLineas idBase={idBase} lineas={lineas} precio={precio} sugeridos={sugeridos} onChange={(nuevas) => onCambiar(servicio.id, { lineas: nuevas })} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-2 p-2 text-center">
            <div>
              <p className="text-[11px] text-ink/60">Materiales</p>
              <p className="font-mono text-sm text-ink">{soles(totales.materiales)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink/60">Otros directos</p>
              <p className="font-mono text-sm text-ink">{soles(totales.otros)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink/60">Local (informativo)</p>
              <p className="font-mono text-sm text-ink">{soles(totales.local)}</p>
            </div>
          </div>

          <TablaAsistentes precio={precio} totales={totales} asistentes={asistentes} porcentajeMax={porcentajeMax} />

          <p className="text-xs text-ink/50">
            El tope del cupón es el mismo para toda clienta (se calcula con el % más alto{asistentes.length > 0 ? ` (${porcentajeMax} %)` : ''}). «Sin
            configurar» no es cero: los cupones descuentan hasta el 50 % del precio. Esto no cambia las comisiones ni los pagos reales, y cada
            venta guarda una foto de estos costos, con la comisión REAL de quien atendió, para el reporte de Rentabilidad.
          </p>

          <div className="flex gap-2">
            <button type="button" onClick={guardar} disabled={guardando} className="flex-1 rounded-lg bg-azul-metal py-2 text-sm font-semibold text-bg disabled:opacity-40">
              {guardando ? 'Guardando...' : 'Guardar costeo'}
            </button>
            {prot && (
              <button type="button" onClick={quitar} disabled={guardando} className="rounded-lg border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40">
                Dejar sin configurar
              </button>
            )}
          </div>
        </div>
      </CampoColapsable>
    </li>
  )
}
