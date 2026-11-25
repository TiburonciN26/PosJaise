import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../context/ToastContext.jsx'
import BotonFlechaDesplegable from '../../components/BotonFlechaDesplegable.jsx'
import CampoColapsable from '../../components/CampoColapsable.jsx'
import {
  CATEGORIAS_PRODUCTO,
  MAX_LINEAS_PRODUCTO,
  lineaProductoVacia,
  lineasProductoAJson,
  resultadoProducto,
  totalesProducto,
  validarLineasProducto,
} from '../../lib/costeoRecompensas.js'
import { soles } from './formato.js'

// Costeo detallado de UN producto, por UNIDAD vendida (pestaña Web → Recompensas → Protección de productos). Solo administradora.
// El costo de compra NO se copia ni se edita aquí: se lee de Inventario (productos.costo, visible solo para la administradora
// mediante productos_vista). Un costo 0 sin confirmar es DESCONOCIDO: bloquea cupones hasta que la administradora lo confirme.

const CAMPO_LINEA = 'w-full rounded-lg border border-border bg-surface px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-azul-metal'

export default function FilaCosteoProducto({ producto, prot, valores, abierto, destacado, onAlternar, onCambiar, onGuardado, onLimpiarBorrador }) {
  const { mostrarToast } = useToast()
  const [guardando, setGuardando] = useState(false)
  const ref = useRef(null)
  const lineas = valores.lineas
  const costo = Number(producto.costo ?? 0)
  const conocido = costo > 0 || valores.confirmado
  const guardadoConocido = costo > 0 || Boolean(prot?.costo_confirmado)
  const totales = totalesProducto(lineas)
  const r = resultadoProducto({ precio: Number(producto.precio), costoCompra: costo, transporte: totales.transporte, otros: totales.otros })
  const llena = lineas.length >= MAX_LINEAS_PRODUCTO

  useEffect(() => {
    if (destacado) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [destacado])

  const cambiarLinea = (i, parche) => onCambiar(producto.id, { ...valores, lineas: lineas.map((l, k) => (k === i ? { ...l, ...parche } : l)) })
  const quitarLinea = (i) => onCambiar(producto.id, { ...valores, lineas: lineas.filter((_, k) => k !== i) })
  const agregarLinea = () => onCambiar(producto.id, { ...valores, lineas: [...lineas, lineaProductoVacia()] })

  async function guardar() {
    const problema = validarLineasProducto(lineas)
    if (problema) {
      mostrarToast(problema, 'error')
      return
    }
    setGuardando(true)
    const { error } = await supabase.rpc('guardar_costeo_producto', {
      p_producto_id: producto.id,
      p_lineas: lineasProductoAJson(lineas),
      p_costo_confirmado: valores.confirmado,
    })
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo guardar el costeo del producto.', 'error')
      return
    }
    mostrarToast('Costeo del producto guardado.', 'exito')
    onLimpiarBorrador(producto.id)
    onGuardado()
  }

  async function quitar() {
    setGuardando(true)
    const { error } = await supabase.rpc('quitar_costeo_producto', { p_producto_id: producto.id })
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo quitar la configuración.', 'error')
      return
    }
    mostrarToast('Producto sin importes adicionales.', 'exito')
    onLimpiarBorrador(producto.id)
    onGuardado()
  }

  const alternar = () => onAlternar(producto.id)

  return (
    <li ref={ref} className={`rounded-lg border bg-surface ${destacado ? 'border-azul-metal' : 'border-border'}`}>
      <div className="flex cursor-pointer items-center gap-2 px-3 py-2" onClick={alternar}>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium transition-colors duration-300 ${abierto ? 'text-azul-metal' : 'text-ink'}`}>{producto.nombre}</span>
          <span className="block truncate font-mono text-xs text-ink/60">Precio {soles(producto.precio)} · Costo {soles(costo)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${guardadoConocido ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
          {guardadoConocido ? 'Protegido' : 'Costo por revisar'}
        </span>
        <BotonFlechaDesplegable plano abierto={abierto} onClick={(e) => { e.stopPropagation(); alternar() }} />
      </div>
      <CampoColapsable abierto={abierto} diferido>
        <div className="space-y-3 border-t border-border p-3">
          <p className="font-mono text-xs text-ink/70">Costo de compra registrado: {soles(costo)} (se edita en Inventario; aquí no se copia).</p>

          <div>
            <p className="text-sm font-medium text-ink">Otros costos por unidad vendida</p>
            {lineas.length === 0 && (
              <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-ink/60">
                Sin líneas. Agrega transporte, empaque o la comisión de tarjeta si quieres que el piso del cupón y el margen los incluyan.
              </p>
            )}
            <ul className="mt-2 space-y-2">
              {lineas.map((l, i) => {
                const n = i + 1
                const cat = CATEGORIAS_PRODUCTO.find((c) => c.id === l.categoria)
                return (
                  <li key={l.id ?? `n${i}`} className="rounded-lg border border-border bg-surface-2 p-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select aria-label={`Línea ${n}: categoría`} className={`${CAMPO_LINEA} col-span-2`} value={l.categoria} onChange={(e) => cambiarLinea(i, { categoria: e.target.value })}>
                        {CATEGORIAS_PRODUCTO.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      <input aria-label={`Línea ${n}: descripción`} placeholder="¿Qué es? (p. ej. Flete de Lima)" maxLength={120} className={`${CAMPO_LINEA} col-span-2`} value={l.descripcion} onChange={(e) => cambiarLinea(i, { descripcion: e.target.value })} />
                      <input aria-label={`Línea ${n}: monto por unidad (S/)`} type="number" inputMode="decimal" min="0" step="any" placeholder="S/ por unidad" className={CAMPO_LINEA} value={l.monto} onChange={(e) => cambiarLinea(i, { monto: e.target.value })} />
                      <div className="flex items-center justify-end">
                        <button type="button" aria-label={`Quitar la línea ${n}`} onClick={() => quitarLinea(i)} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg text-ink/70 hover:bg-surface-3 hover:text-red">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {cat && <p className="mt-1 text-[11px] text-ink/50">{cat.ayuda}</p>}
                  </li>
                )
              })}
            </ul>
            <button type="button" disabled={llena} onClick={agregarLinea} className="mt-2 flex items-center gap-1 rounded-lg border border-border-strong px-3 py-2 text-sm text-ink hover:border-azul-metal hover:text-azul-metal disabled:opacity-40">
              <Plus className="h-4 w-4" /> Agregar línea
            </button>
          </div>

          {costo === 0 && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={valores.confirmado} onChange={(e) => onCambiar(producto.id, { ...valores, confirmado: e.target.checked })} />
              <span>Confirmo que el costo de compra de este producto es realmente S/ 0,00. Sin esta confirmación el costo se considera desconocido y los cupones no se podrán usar en compras que lo incluyan.</span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-2 text-center">
            <div>
              <p className="text-[11px] text-ink/60">Transporte</p>
              <p className="font-mono text-sm text-ink">{soles(totales.transporte)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink/60">Otros por unidad</p>
              <p className="font-mono text-sm text-ink">{soles(totales.otros)}</p>
            </div>
          </div>

          <p className="font-mono text-xs text-ink/70">
            {conocido
              ? `Costo por unidad: ${soles(r.unitaria)} · margen por unidad ${soles(r.margenUnidad)} (${r.margenPct} %) · cupón máximo si fuera el único artículo (1 unidad): ${soles(r.cuponMaximo)}`
              : 'Costo desconocido: los cupones quedan bloqueados para compras con este producto.'}
          </p>
          <p className="text-xs text-ink/50">
            El transporte de abastecimiento no es el envío que paga la clienta. No se suman reserva, diezmo ni gastos generales salvo que
            los escribas como línea. Esto limita cupones: las ventas sin cupón no cambian, y cada venta guarda una foto de estos costos.
          </p>

          <div className="flex gap-2">
            <button type="button" onClick={guardar} disabled={guardando} className="flex-1 rounded-lg bg-azul-metal py-2 text-sm font-semibold text-bg disabled:opacity-40">
              {guardando ? 'Guardando...' : 'Guardar costeo'}
            </button>
            {prot && (
              <button type="button" onClick={quitar} disabled={guardando} className="rounded-lg border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40">
                Quitar importes adicionales
              </button>
            )}
          </div>
        </div>
      </CampoColapsable>
    </li>
  )
}
