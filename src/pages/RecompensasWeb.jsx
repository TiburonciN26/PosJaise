import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Coins, Plus, Stamp, ShieldCheck, ShoppingBag, Settings2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { leerServicios } from '../lib/buscarServicios.js'
import { patronIlike } from '../lib/buscarClientes.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from '../components/Etiqueta.jsx'

// Administración de Recompensas (Fase 2) — cuelga de /web, solo ADMINISTRADOR.
// Las escrituras las limita el backend (RLS es_admin() en recompensas_catalogo,
// servicios_proteccion y recompensas_config; recompensas_establecer_activo()),
// no solo esta pantalla. Todo vive en Supabase: el catálogo nace APAGADO y vacío.
//
// Solo se ofrece lo que el backend soporta de verdad: tipo MONTO | PORCENTAJE |
// SERVICIO y alcance TODO | SERVICIOS | PRODUCTOS. Elegibilidad por producto o
// servicio concreto NO existe en el contrato (salvo el servicio del premio tipo
// SERVICIO), así que no se inventa un selector.

const PESTANAS = [
  { id: 'monedas', label: 'Catálogo de monedas', icono: Coins },
  { id: 'sellos', label: 'Premios de sellos', icono: Stamp },
  { id: 'proteccion', label: 'Protección de servicios', icono: ShieldCheck },
  { id: 'proteccion-productos', label: 'Protección de productos', icono: ShoppingBag },
  { id: 'programa', label: 'Programa', icono: Settings2 },
]

const NIVELES = [
  { id: 'BASICO', label: 'Básico' },
  { id: 'PREMIUM', label: 'Premium' },
  { id: 'VIP', label: 'VIP' },
]

const CLASE_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red'

const soles = (n) => `S/ ${Number(n).toFixed(2)}`
const vacioANulo = (v) => (v === '' || v === null || v === undefined ? null : v)
const aNumero = (v) => (vacioANulo(v) === null ? null : Number(v))
// <input type="datetime-local"> <-> timestamptz ISO
const aLocal = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const aIso = (local) => (local ? new Date(local).toISOString() : null)

function premioVacio(origen) {
  return {
    nombre: '',
    descripcion: '',
    activo: false,
    origen,
    tipo: 'MONTO',
    valor: '',
    servicioId: '',
    alcance: 'TODO',
    minimoCompra: '',
    tope: '',
    nivelMinimo: 'BASICO',
    costoBasico: '',
    costoPremium: '',
    costoVip: '',
    cupoGlobal: '',
    limitePorClienta: '',
    reclamoDesde: '',
    reclamoHasta: '',
    cuponVigenciaDias: '',
    cuponVenceEl: '',
  }
}

function premioAFormulario(p) {
  return {
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    activo: p.activo,
    origen: p.origen,
    tipo: p.tipo,
    valor: String(p.valor ?? ''),
    servicioId: p.servicio_id ?? '',
    alcance: p.alcance,
    minimoCompra: p.minimo_compra ?? '',
    tope: p.tope ?? '',
    nivelMinimo: p.nivel_minimo,
    costoBasico: p.costo_basico ?? '',
    costoPremium: p.costo_premium ?? '',
    costoVip: p.costo_vip ?? '',
    cupoGlobal: p.cupo_global ?? '',
    limitePorClienta: p.limite_por_clienta ?? '',
    reclamoDesde: aLocal(p.reclamo_desde),
    reclamoHasta: aLocal(p.reclamo_hasta),
    cuponVigenciaDias: p.cupon_vigencia_dias ?? '',
    cuponVenceEl: aLocal(p.cupon_vence_el),
  }
}

function validar(f) {
  if (!f.nombre.trim()) return 'El nombre es obligatorio.'
  if (f.tipo !== 'SERVICIO') {
    const v = Number(f.valor)
    if (!(v > 0)) return 'El valor debe ser un número mayor a 0.'
    if (f.tipo === 'PORCENTAJE' && v > 100) return 'Un porcentaje no puede ser mayor a 100.'
  }
  if (f.tipo === 'SERVICIO' && !f.servicioId) return 'Elige el servicio del premio.'
  if (f.origen === 'MONEDAS') {
    if (vacioANulo(f.costoBasico) === null || Number(f.costoBasico) < 0) {
      return 'Indica el costo en monedas para el nivel Básico.'
    }
  }
  if (f.reclamoDesde && f.reclamoHasta && f.reclamoHasta < f.reclamoDesde) {
    return 'El período para reclamar termina antes de empezar.'
  }
  return null
}

function formularioAFila(f) {
  return {
    nombre: f.nombre.trim(),
    descripcion: vacioANulo(f.descripcion.trim()),
    activo: f.activo,
    origen: f.origen,
    tipo: f.tipo,
    valor: f.tipo === 'SERVICIO' ? 0 : Number(f.valor),
    servicio_id: f.tipo === 'SERVICIO' ? f.servicioId : null,
    alcance: f.alcance,
    minimo_compra: aNumero(f.minimoCompra),
    tope: aNumero(f.tope),
    nivel_minimo: f.nivelMinimo,
    costo_basico: f.origen === 'MONEDAS' ? aNumero(f.costoBasico) : null,
    costo_premium: f.origen === 'MONEDAS' ? aNumero(f.costoPremium) : null,
    costo_vip: f.origen === 'MONEDAS' ? aNumero(f.costoVip) : null,
    cupo_global: aNumero(f.cupoGlobal),
    limite_por_clienta: aNumero(f.limitePorClienta),
    reclamo_desde: aIso(f.reclamoDesde),
    reclamo_hasta: aIso(f.reclamoHasta),
    cupon_vigencia_dias: aNumero(f.cuponVigenciaDias),
    cupon_vence_el: aIso(f.cuponVenceEl),
    actualizado_en: new Date().toISOString(),
  }
}

function Campo({ id, etiqueta, obligatorio, ayuda, children }) {
  return (
    <div>
      <Etiqueta htmlFor={id} obligatorio={obligatorio}>
        {etiqueta}
      </Etiqueta>
      {children}
      {ayuda && <p className="mt-1 text-xs text-ink/50">{ayuda}</p>}
    </div>
  )
}

function AvisoError({ mensaje, onReintentar }) {
  return (
    <div role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
      {mensaje}{' '}
      {onReintentar && (
        <button type="button" onClick={onReintentar} className="underline">
          Reintentar
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal de premio
// ---------------------------------------------------------------------------
function ModalPremio({ premio, origen, servicios, sellosPorPremio, onCerrar, onGuardado }) {
  const { mostrarToast } = useToast()
  const [f, setF] = useState(() => (premio ? premioAFormulario(premio) : premioVacio(origen)))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const idBase = useRef(`pr-${Math.random().toString(36).slice(2, 8)}`).current
  const panelRef = useRef(null)
  useModalA11y(panelRef) // QA-042: trampa de foco, retorno al disparador, aria-modal y scroll
  useCerrarConEscape(onCerrar)

  const set = (campo, valor) => setF((a) => ({ ...a, [campo]: valor }))
  const esMonedas = f.origen === 'MONEDAS'

  async function guardar(e) {
    e.preventDefault()
    const msg = validar(f)
    if (msg) {
      setError(msg)
      return
    }
    setGuardando(true)
    setError(null)
    const fila = formularioAFila(f)
    const { error: err } = premio
      ? await supabase.from('recompensas_catalogo').update(fila).eq('id', premio.id)
      : await supabase.from('recompensas_catalogo').insert(fila)
    setGuardando(false)
    if (err) {
      setError('No se pudo guardar el premio. Revisa los datos e intenta de nuevo.')
      return
    }
    mostrarToast(premio ? 'Premio actualizado.' : 'Premio creado (queda sin publicar hasta que lo actives).', 'exito')
    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        ref={panelRef}
        onSubmit={guardar}
        autoComplete="off"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {premio ? 'Editar premio' : esMonedas ? 'Nuevo premio de monedas' : 'Nuevo premio de sellos'}
        </h2>
        {premio && (
          <p className="mt-1 text-xs text-ink/60">
            Los cupones ya emitidos conservan las condiciones con las que se emitieron: editar este
            premio solo afecta a los canjes nuevos.
          </p>
        )}

        <div className="mt-4 space-y-3">
          <Campo id={`${idBase}-nombre`} etiqueta="Nombre" obligatorio>
            <input id={`${idBase}-nombre`} className={CLASE_INPUT} value={f.nombre} onChange={(e) => set('nombre', e.target.value)} autoFocus />
          </Campo>
          <Campo id={`${idBase}-desc`} etiqueta="Descripción">
            <textarea id={`${idBase}-desc`} rows={2} className={`${CLASE_INPUT} resize-none`} value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo id={`${idBase}-tipo`} etiqueta="Tipo de premio" obligatorio>
              <select id={`${idBase}-tipo`} className={CLASE_INPUT} value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
                <option value="MONTO">Monto fijo (S/)</option>
                <option value="PORCENTAJE">Porcentaje (%)</option>
                <option value="SERVICIO">Servicio</option>
              </select>
            </Campo>
            {f.tipo !== 'SERVICIO' ? (
              <Campo id={`${idBase}-valor`} etiqueta={f.tipo === 'PORCENTAJE' ? 'Porcentaje' : 'Monto (S/)'} obligatorio>
                <input id={`${idBase}-valor`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={f.valor} onChange={(e) => set('valor', e.target.value)} />
              </Campo>
            ) : (
              <Campo id={`${idBase}-serv`} etiqueta="Servicio" obligatorio>
                <select id={`${idBase}-serv`} className={CLASE_INPUT} value={f.servicioId} onChange={(e) => set('servicioId', e.target.value)}>
                  <option value="">Elige…</option>
                  {servicios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
          </div>
          {f.tipo === 'SERVICIO' && (
            <p className="text-xs text-ink/50">
              El cupón cubre el precio del servicio menos su protección (importe mínimo). Sin protección
              configurada, cubre hasta el 50 % del precio: la clienta siempre paga algo.
            </p>
          )}

          {f.tipo !== 'SERVICIO' && (
            <div className="grid grid-cols-2 gap-3">
              <Campo id={`${idBase}-alcance`} etiqueta="Alcance">
                <select id={`${idBase}-alcance`} className={CLASE_INPUT} value={f.alcance} onChange={(e) => set('alcance', e.target.value)}>
                  <option value="TODO">Productos y servicios</option>
                  <option value="SERVICIOS">Solo servicios</option>
                  <option value="PRODUCTOS">Solo productos</option>
                </select>
              </Campo>
              <Campo id={`${idBase}-min`} etiqueta="Compra mínima (S/)" ayuda="Vacío = sin mínimo.">
                <input id={`${idBase}-min`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={f.minimoCompra} onChange={(e) => set('minimoCompra', e.target.value)} />
              </Campo>
            </div>
          )}
          {f.tipo === 'PORCENTAJE' && (
            <Campo id={`${idBase}-tope`} etiqueta="Tope de descuento (S/)" ayuda="Vacío = sin tope.">
              <input id={`${idBase}-tope`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={f.tope} onChange={(e) => set('tope', e.target.value)} />
            </Campo>
          )}

          <Campo id={`${idBase}-nivel`} etiqueta="Nivel mínimo (exclusividad)">
            <select id={`${idBase}-nivel`} className={CLASE_INPUT} value={f.nivelMinimo} onChange={(e) => set('nivelMinimo', e.target.value)}>
              {NIVELES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Campo>

          {esMonedas ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-xs text-ink/60">Costo en monedas por nivel</legend>
              <div className="grid grid-cols-3 gap-2">
                <Campo id={`${idBase}-cb`} etiqueta="Básico" obligatorio>
                  <input id={`${idBase}-cb`} type="number" min="0" step="1" className={CLASE_INPUT} value={f.costoBasico} onChange={(e) => set('costoBasico', e.target.value)} />
                </Campo>
                <Campo id={`${idBase}-cp`} etiqueta="Premium">
                  <input id={`${idBase}-cp`} type="number" min="0" step="1" className={CLASE_INPUT} value={f.costoPremium} onChange={(e) => set('costoPremium', e.target.value)} />
                </Campo>
                <Campo id={`${idBase}-cv`} etiqueta="VIP">
                  <input id={`${idBase}-cv`} type="number" min="0" step="1" className={CLASE_INPUT} value={f.costoVip} onChange={(e) => set('costoVip', e.target.value)} />
                </Campo>
              </div>
              <p className="mt-1 text-xs text-ink/50">Premium y VIP vacíos = mismo costo del nivel inferior.</p>
            </fieldset>
          ) : (
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-ink/70">
              Este premio consume {sellosPorPremio} sellos. Se ofrece solo en «Mis sellos».
            </p>
          )}

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-ink/60">Período para reclamar</legend>
            <div className="grid grid-cols-2 gap-2">
              <Campo id={`${idBase}-rd`} etiqueta="Desde">
                <input id={`${idBase}-rd`} type="datetime-local" className={CLASE_INPUT} value={f.reclamoDesde} onChange={(e) => set('reclamoDesde', e.target.value)} />
              </Campo>
              <Campo id={`${idBase}-rh`} etiqueta="Hasta">
                <input id={`${idBase}-rh`} type="datetime-local" className={CLASE_INPUT} value={f.reclamoHasta} onChange={(e) => set('reclamoHasta', e.target.value)} />
              </Campo>
            </div>
            <p className="mt-1 text-xs text-ink/50">Vacío = se puede reclamar siempre.</p>
          </fieldset>

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-ink/60">Vigencia del cupón emitido</legend>
            <div className="grid grid-cols-2 gap-2">
              <Campo id={`${idBase}-vd`} etiqueta="Días desde el canje">
                <input id={`${idBase}-vd`} type="number" min="1" step="1" className={CLASE_INPUT} value={f.cuponVigenciaDias} onChange={(e) => set('cuponVigenciaDias', e.target.value)} />
              </Campo>
              <Campo id={`${idBase}-vf`} etiqueta="Vence el (fecha fija)">
                <input id={`${idBase}-vf`} type="datetime-local" className={CLASE_INPUT} value={f.cuponVenceEl} onChange={(e) => set('cuponVenceEl', e.target.value)} />
              </Campo>
            </div>
            <p className="mt-1 text-xs text-ink/50">
              Ambos vacíos = el cupón no vence (indefinido). Si indicas los dos, vale el más próximo.
            </p>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Campo id={`${idBase}-cupo`} etiqueta="Cupo global" ayuda="Vacío = sin límite.">
              <input id={`${idBase}-cupo`} type="number" min="0" step="1" className={CLASE_INPUT} value={f.cupoGlobal} onChange={(e) => set('cupoGlobal', e.target.value)} />
            </Campo>
            <Campo id={`${idBase}-lim`} etiqueta="Límite por clienta" ayuda="Vacío = sin límite.">
              <input id={`${idBase}-lim`} type="number" min="0" step="1" className={CLASE_INPUT} value={f.limitePorClienta} onChange={(e) => set('limitePorClienta', e.target.value)} />
            </Campo>
          </div>

          <div>
            <Etiqueta>Publicación</Etiqueta>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={f.activo} onClick={() => set('activo', true)} className={`rounded-lg border px-3 py-2 text-sm ${f.activo ? 'border-green bg-green/10 text-green' : 'border-border text-ink/70'}`}>
                Publicado
              </button>
              <button type="button" aria-pressed={!f.activo} onClick={() => set('activo', false)} className={`rounded-lg border px-3 py-2 text-sm ${!f.activo ? 'border-red bg-red/10 text-red' : 'border-border text-ink/70'}`}>
                Sin publicar
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink disabled:opacity-40">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Catálogo (monedas o sellos)
// ---------------------------------------------------------------------------
function resumenCondiciones(p) {
  const partes = []
  if (p.tipo === 'MONTO') partes.push(soles(p.valor))
  if (p.tipo === 'PORCENTAJE') partes.push(`${p.valor}%`)
  if (p.tipo === 'SERVICIO') partes.push('Servicio')
  if (p.tipo !== 'SERVICIO' && p.alcance !== 'TODO') partes.push(p.alcance === 'SERVICIOS' ? 'solo servicios' : 'solo productos')
  if (p.minimo_compra) partes.push(`mín. ${soles(p.minimo_compra)}`)
  if (p.tope) partes.push(`tope ${soles(p.tope)}`)
  if (p.nivel_minimo !== 'BASICO') partes.push(`desde ${p.nivel_minimo}`)
  return partes.join(' · ')
}

function Catalogo({ origen, estado, servicios, sellosPorPremio, recargar }) {
  const [editando, setEditando] = useState(null) // null | 'nuevo' | premio
  const lista = useMemo(() => estado.premios.filter((p) => p.origen === origen), [estado.premios, origen])

  return (
    <div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-sm text-ink/60">
          {origen === 'MONEDAS'
            ? 'Premios que la clienta canjea con monedas, según su nivel.'
            : `Premios que la clienta reclama con ${sellosPorPremio} sellos, solo desde «Mis sellos».`}
        </p>
        <button type="button" onClick={() => setEditando('nuevo')} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-red px-3 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" />
          Nuevo
        </button>
      </div>

      {lista.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink/60">
          Todavía no hay premios. El catálogo no trae ejemplos: crea y revisa cada uno antes de publicarlo.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {lista.map((p) => {
            const usados = estado.canjes[p.id] ?? 0
            return (
              <li key={p.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{p.nombre}</p>
                    <p className="font-mono text-xs text-ink/60">{resumenCondiciones(p)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${p.activo ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'}`}>
                    {p.activo ? 'Publicado' : 'Sin publicar'}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-ink/70">
                  {origen === 'MONEDAS'
                    ? `Costo: ${p.costo_basico ?? '—'} / ${p.costo_premium ?? p.costo_basico ?? '—'} / ${p.costo_vip ?? p.costo_premium ?? p.costo_basico ?? '—'} (Básico / Premium / VIP)`
                    : `Costo: ${sellosPorPremio} sellos`}
                </p>
                <p className="font-mono text-xs text-ink/60">
                  Reclamados: {usados}
                  {p.cupo_global !== null ? ` · restantes: ${Math.max(p.cupo_global - usados, 0)} de ${p.cupo_global}` : ' · sin cupo global'}
                  {p.limite_por_clienta !== null ? ` · máx. ${p.limite_por_clienta} por clienta` : ''}
                </p>
                <p className="font-mono text-xs text-ink/60">
                  Reclamo: {p.reclamo_desde || p.reclamo_hasta ? `${p.reclamo_desde ? new Date(p.reclamo_desde).toLocaleDateString('es-PE') : '…'} – ${p.reclamo_hasta ? new Date(p.reclamo_hasta).toLocaleDateString('es-PE') : '…'}` : 'siempre'}
                  {' · '}Cupón: {p.cupon_vigencia_dias || p.cupon_vence_el ? `${p.cupon_vigencia_dias ? `${p.cupon_vigencia_dias} días` : ''}${p.cupon_vigencia_dias && p.cupon_vence_el ? ' / ' : ''}${p.cupon_vence_el ? `hasta ${new Date(p.cupon_vence_el).toLocaleDateString('es-PE')}` : ''}` : 'indefinido'}
                </p>
                <button type="button" onClick={() => setEditando(p)} className="mt-2 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink hover:border-red hover:text-red">
                  Editar
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editando && (
        <ModalPremio
          premio={editando === 'nuevo' ? null : editando}
          origen={origen}
          servicios={servicios}
          sellosPorPremio={sellosPorPremio}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Protección por servicio
// ---------------------------------------------------------------------------
function FilaProteccion({ servicio, prot, destacado, onGuardado }) {
  const { mostrarToast } = useToast()
  const [abierto, setAbierto] = useState(Boolean(destacado))
  // Porcentaje protegido de asistente (estimación). Una protección ANTIGUA (importe fijo en S/) tiene asistente_pct nulo:
  // conserva su importe y se muestra como pendiente de actualización; nunca se convierte sola en porcentaje.
  const pendiente = Boolean(prot) && (prot.asistente_pct === null || prot.asistente_pct === undefined)
  const [v, setV] = useState({
    materiales: prot ? String(prot.materiales) : '',
    pct: prot && !pendiente ? String(prot.asistente_pct) : '',
    otros: prot ? String(prot.otros) : '',
  })
  const [guardando, setGuardando] = useState(false)
  const ref = useRef(null)
  const idBase = useRef(`pt-${servicio.id.slice(0, 8)}`).current

  useEffect(() => {
    if (destacado) {
      setAbierto(true)
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [destacado])

  const n = (x) => (x === '' ? 0 : Number(x))
  const precio = Number(servicio.precio)
  // Con el porcentaje vacío en una fila antigua se sigue usando su importe fijo; en una fila nueva vacío = 0 %.
  const usaImporteAntiguo = pendiente && v.pct === ''
  const asistenteImporte = usaImporteAntiguo ? Number(prot.asistente) : Math.ceil(precio * n(v.pct) - 1e-9) / 100
  const total = n(v.materiales) + asistenteImporte + n(v.otros)
  const pctInvalido = v.pct !== '' && !(Number(v.pct) >= 0 && Number(v.pct) <= 100)
  const invalido = pctInvalido || [v.materiales, v.otros].some((x) => x !== '' && !(Number(x) >= 0))

  async function guardar() {
    if (invalido) return
    setGuardando(true)
    // No se escribe `asistente` (S/): el importe antiguo se conserva intacto para el histórico.
    const { error } = await supabase.from('servicios_proteccion').upsert({
      servicio_id: servicio.id,
      materiales: n(v.materiales),
      asistente_pct: v.pct === '' ? (pendiente ? null : 0) : Number(v.pct),
      otros: n(v.otros),
      actualizado_en: new Date().toISOString(),
    })
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo guardar la protección.', 'error')
      return
    }
    mostrarToast('Protección guardada.', 'exito')
    onGuardado()
  }

  async function quitar() {
    setGuardando(true)
    const { error } = await supabase.from('servicios_proteccion').delete().eq('servicio_id', servicio.id)
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo quitar la configuración.', 'error')
      return
    }
    setV({ materiales: '', pct: '', otros: '' })
    mostrarToast('Servicio sin configurar.', 'exito')
    onGuardado()
  }

  return (
    <li ref={ref} className={`rounded-lg border bg-surface ${destacado ? 'border-red' : 'border-border'}`}>
      <button type="button" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{servicio.nombre}</span>
          <span className="block font-mono text-xs text-ink/60">Precio {soles(servicio.precio)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${prot ? 'bg-green/15 text-green' : 'bg-surface-2 text-ink/60'}`}>
          {prot ? (pendiente ? `Pendiente de actualizar · ${soles(prot.total)}` : 'Protegido') : 'Sin configurar'}
        </span>
      </button>
      {abierto && (
        <div className="border-t border-border p-3">
          <div className="grid grid-cols-3 gap-2">
            <Campo id={`${idBase}-m`} etiqueta="Materiales protegidos (S/)">
              <input id={`${idBase}-m`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.materiales} onChange={(e) => setV((a) => ({ ...a, materiales: e.target.value }))} />
            </Campo>
            <Campo id={`${idBase}-a`} etiqueta="Porcentaje protegido de asistente (%)">
              <input id={`${idBase}-a`} type="number" min="0" max="100" step="0.01" className={CLASE_INPUT} value={v.pct} placeholder={pendiente ? 'Sin actualizar' : ''} onChange={(e) => setV((a) => ({ ...a, pct: e.target.value }))} />
            </Campo>
            <Campo id={`${idBase}-o`} etiqueta="Otros costos directos (S/)">
              <input id={`${idBase}-o`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.otros} onChange={(e) => setV((a) => ({ ...a, otros: e.target.value }))} />
            </Campo>
          </div>
          {pendiente && (
            <p className="mt-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink/80">
              Esta protección todavía usa el importe fijo antiguo de {soles(prot.asistente)} para la asistente. Escribe un
              porcentaje y guarda para actualizarla; mientras tanto se conserva ese importe.
            </p>
          )}
          <p className="mt-2 font-mono text-xs text-ink/70">
            Protección del servicio: {soles(total)} (precio {soles(precio)}; asistente {soles(asistenteImporte)}) · si fuera el único artículo del carrito, descuento máximo de un cupón: {soles(Math.max(precio - total, 0))}
          </p>
          <p className="mt-1 text-xs text-ink/50">
            El porcentaje de asistente es una ESTIMACIÓN que tú defines sobre el precio realmente cobrado en la atención:
            no consulta las comisiones reales y puede no cubrir una comisión real mayor. La protección total de un cupón es la
            suma de todo el carrito. Guardar con todo en 0 es una decisión explícita (el servicio admite neto 0).
            «Sin configurar» no es cero: los cupones descuentan hasta el 50 % del precio. Esto no cambia Porcentajes,
            comisiones ni pagos reales.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={guardar} disabled={guardando || invalido} className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40">
              {guardando ? 'Guardando...' : 'Guardar protección'}
            </button>
            {prot && (
              <button type="button" onClick={quitar} disabled={guardando} className="rounded-lg border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40">
                Dejar sin configurar
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Protección por producto (por unidad: costo de compra registrado + transporte de abastecimiento + otros)
// ---------------------------------------------------------------------------
// El costo de compra NO se copia ni se edita aquí: se lee de Inventario (productos.costo, visible solo para el
// administrador mediante productos_vista). El transporte de abastecimiento es distinto del envío cobrado a la clienta.
// Un costo 0 sin confirmar es DESCONOCIDO: bloquea el uso de cupones hasta que el administrador lo confirme.
function FilaProteccionProducto({ producto, prot, destacado, onGuardado }) {
  const { mostrarToast } = useToast()
  const [abierto, setAbierto] = useState(Boolean(destacado))
  const [v, setV] = useState({
    transporte: prot ? String(prot.transporte) : '',
    otros: prot ? String(prot.otros) : '',
    confirmado: Boolean(prot?.costo_confirmado),
  })
  const [guardando, setGuardando] = useState(false)
  const ref = useRef(null)
  const idBase = useRef(`pp-${producto.id.slice(0, 8)}`).current

  useEffect(() => {
    if (destacado) {
      setAbierto(true)
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [destacado])

  const n = (x) => (x === '' ? 0 : Number(x))
  const costo = Number(producto.costo ?? 0)
  const conocido = costo > 0 || v.confirmado
  const unitaria = costo + n(v.transporte) + n(v.otros)
  const invalido = [v.transporte, v.otros].some((x) => x !== '' && !(Number(x) >= 0))
  const guardadoConocido = costo > 0 || Boolean(prot?.costo_confirmado)

  async function guardar() {
    if (invalido) return
    setGuardando(true)
    const { error } = await supabase.from('productos_proteccion').upsert({
      producto_id: producto.id,
      transporte: n(v.transporte),
      otros: n(v.otros),
      costo_confirmado: v.confirmado,
      actualizado_en: new Date().toISOString(),
    })
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo guardar la protección del producto.', 'error')
      return
    }
    mostrarToast('Protección del producto guardada.', 'exito')
    onGuardado()
  }

  async function quitar() {
    setGuardando(true)
    const { error } = await supabase.from('productos_proteccion').delete().eq('producto_id', producto.id)
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo quitar la configuración.', 'error')
      return
    }
    setV({ transporte: '', otros: '', confirmado: false })
    mostrarToast('Producto sin importes adicionales.', 'exito')
    onGuardado()
  }

  return (
    <li ref={ref} className={`rounded-lg border bg-surface ${destacado ? 'border-red' : 'border-border'}`}>
      <button type="button" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{producto.nombre}</span>
          <span className="block font-mono text-xs text-ink/60">Precio {soles(producto.precio)} · Costo registrado {soles(costo)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${guardadoConocido ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
          {guardadoConocido ? 'Protegido' : 'Costo por revisar'}
        </span>
      </button>
      {abierto && (
        <div className="border-t border-border p-3">
          <p className="font-mono text-xs text-ink/70">
            Costo de compra registrado: {soles(costo)} (se edita en Inventario; aquí no se copia).
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Campo id={`${idBase}-t`} etiqueta="Transporte de abastecimiento por unidad (S/)">
              <input id={`${idBase}-t`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.transporte} onChange={(e) => setV((a) => ({ ...a, transporte: e.target.value }))} />
            </Campo>
            <Campo id={`${idBase}-o`} etiqueta="Otros importes protegidos por unidad (S/)">
              <input id={`${idBase}-o`} type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.otros} onChange={(e) => setV((a) => ({ ...a, otros: e.target.value }))} />
            </Campo>
          </div>
          {costo === 0 && (
            <label className="mt-3 flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={v.confirmado} onChange={(e) => setV((a) => ({ ...a, confirmado: e.target.checked }))} />
              <span>Confirmo que el costo de compra de este producto es realmente S/ 0,00. Sin esta confirmación el costo se considera desconocido y los cupones no se podrán usar en compras que lo incluyan.</span>
            </label>
          )}
          <p className="mt-2 font-mono text-xs text-ink/70">
            {conocido
              ? `Protección por unidad: ${soles(unitaria)} · descuento máximo de un cupón si fuera el único artículo (1 unidad): ${soles(Math.max(Number(producto.precio) - unitaria, 0))}`
              : 'Costo desconocido: los cupones quedan bloqueados para compras con este producto.'}
          </p>
          <p className="mt-1 text-xs text-ink/50">
            El transporte de abastecimiento no es el envío que paga la clienta. No se suman reserva, diezmo ni gastos generales
            salvo que los escribas en «otros». Esto limita cupones: las ventas sin cupón no cambian.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={guardar} disabled={guardando || invalido} className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40">
              {guardando ? 'Guardando...' : 'Guardar protección'}
            </button>
            {prot && (
              <button type="button" onClick={quitar} disabled={guardando} className="rounded-lg border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40">
                Quitar importes adicionales
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function ProteccionProductos({ productoFoco }) {
  const [filtro, setFiltro] = useState('')
  const [estado, setEstado] = useState({ cargando: true, error: false, productos: [], prot: {} })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let vigente = true
    const t = setTimeout(async () => {
      // Búsqueda y límite en el SERVIDOR (el catálogo puede superar las 1000 filas de max_rows).
      const base = supabase.from('productos_vista').select('id, nombre, precio, costo')
      const consulta =
        productoFoco && !filtro.trim()
          ? base.eq('id', productoFoco)
          : filtro.trim()
            ? base.ilike('nombre', patronIlike(filtro)).order('nombre').order('id').limit(40)
            : base.order('nombre').order('id').limit(40)
      const res = await consulta
      if (!vigente) return
      if (res.error) {
        setEstado({ cargando: false, error: true, productos: [], prot: {} })
        return
      }
      const ids = res.data.map((p) => p.id)
      const pr = ids.length
        ? await supabase.from('productos_proteccion').select('producto_id, transporte, otros, costo_confirmado, actualizado_en').in('producto_id', ids)
        : { data: [], error: null }
      if (!vigente) return
      if (pr.error) {
        setEstado({ cargando: false, error: true, productos: [], prot: {} })
        return
      }
      const prot = {}
      for (const p of pr.data) prot[p.producto_id] = p
      setEstado({ cargando: false, error: false, productos: res.data, prot })
    }, 250)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [filtro, productoFoco, version])

  return (
    <div>
      <p className="mt-3 text-sm text-ink/60">
        Protege el costo de cada producto frente a los cupones: costo de compra registrado en Inventario + transporte de
        abastecimiento + otros importes que tú definas, por unidad. Solo el administrador ve y edita estos importes; caja solo
        aplica las reglas y la clienta nunca ve los costos internos.
      </p>
      <input
        aria-label="Buscar producto"
        placeholder="Buscar producto…"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className={`${CLASE_INPUT} mt-3`}
      />
      {estado.cargando && <p className="mt-3 text-center font-mono text-sm text-ink/60">Cargando...</p>}
      {estado.error && <AvisoError mensaje="No se pudo cargar la protección de productos." onReintentar={() => setVersion((x) => x + 1)} />}
      {!estado.cargando && !estado.error && (
        <ul className="mt-3 space-y-2">
          {estado.productos.map((p) => (
            <FilaProteccionProducto key={`${p.id}-${estado.prot[p.id]?.actualizado_en ?? 'x'}`} producto={p} prot={estado.prot[p.id]} destacado={productoFoco === p.id} onGuardado={() => setVersion((x) => x + 1)} />
          ))}
          {estado.productos.length === 0 && <li className="text-center text-sm text-ink/60">Sin resultados.</li>}
          {estado.productos.length === 40 && <li className="text-center text-xs text-ink/50">Se muestran los primeros 40: usa el buscador para acotar.</li>}
        </ul>
      )}
    </div>
  )
}

function Proteccion({ estado, servicios, servicioFoco, recargar }) {
  const [filtro, setFiltro] = useState('')
  const lista = servicios.filter((s) => s.nombre.toLowerCase().includes(filtro.trim().toLowerCase()))
  return (
    <div>
      <p className="mt-3 text-sm text-ink/60">
        Protege el costo de cada servicio frente a los cupones. Solo el administrador ve y edita estos importes;
        caja solo aplica las reglas y la clienta nunca ve los costos internos.
      </p>
      <input
        aria-label="Buscar servicio"
        placeholder="Buscar servicio…"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className={`${CLASE_INPUT} mt-3`}
      />
      <ul className="mt-3 space-y-2">
        {lista.map((s) => (
          <FilaProteccion key={`${s.id}-${estado.proteccion[s.id]?.actualizado_en ?? 'x'}`} servicio={s} prot={estado.proteccion[s.id]} destacado={servicioFoco === s.id} onGuardado={recargar} />
        ))}
        {lista.length === 0 && <li className="text-center text-sm text-ink/60">Sin resultados.</li>}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Programa (activación, tasas, umbrales)
// ---------------------------------------------------------------------------
function Programa({ estado, recargar }) {
  const { mostrarToast } = useToast()
  const c = estado.config
  const [f, setF] = useState({
    tasaServMonedas: String(c.tasa_serv_monedas),
    tasaServSoles: String(c.tasa_serv_soles),
    tasaProdMonedas: String(c.tasa_prod_monedas),
    tasaProdSoles: String(c.tasa_prod_soles),
    umbralPremium: String(c.umbral_premium),
    umbralVip: String(c.umbral_vip),
  })
  const [guardando, setGuardando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    const num = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)]))
    if (Object.values(num).some((x) => !(x > 0))) {
      mostrarToast('Todas las tasas y umbrales deben ser mayores a 0.', 'error')
      return
    }
    if (num.umbralVip <= num.umbralPremium) {
      mostrarToast('El umbral de VIP debe ser mayor que el de Premium.', 'error')
      return
    }
    setGuardando(true)
    const { error } = await supabase
      .from('recompensas_config')
      .update({
        tasa_serv_monedas: num.tasaServMonedas,
        tasa_serv_soles: num.tasaServSoles,
        tasa_prod_monedas: num.tasaProdMonedas,
        tasa_prod_soles: num.tasaProdSoles,
        umbral_premium: num.umbralPremium,
        umbral_vip: num.umbralVip,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', 1)
    setGuardando(false)
    if (error) {
      mostrarToast('No se pudo guardar la configuración.', 'error')
      return
    }
    mostrarToast('Configuración guardada. Las tasas nuevas aplican a ventas futuras.', 'exito')
    recargar()
  }

  async function cambiarActivo(valor) {
    setGuardando(true)
    const { error } = await supabase.rpc('recompensas_establecer_activo', { p_activo: valor })
    setGuardando(false)
    setConfirmando(false)
    if (error) {
      mostrarToast('No se pudo cambiar el estado del programa.', 'error')
      return
    }
    mostrarToast(valor ? 'Recompensas activado.' : 'Recompensas desactivado.', 'exito')
    recargar()
  }

  const campo = (id, etiqueta, clave, paso = '0.01') => (
    <Campo id={`prog-${id}`} etiqueta={etiqueta}>
      <input id={`prog-${id}`} type="number" min="0" step={paso} className={CLASE_INPUT} value={f[clave]} onChange={(e) => setF((a) => ({ ...a, [clave]: e.target.value }))} />
    </Campo>
  )

  return (
    <div className="mt-3 space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-ink">
          Estado del programa:{' '}
          <span className={c.activo ? 'text-green' : 'text-red'}>{c.activo ? 'Activo' : 'Apagado'}</span>
        </p>
        <p className="mt-1 text-xs text-ink/60">
          {c.activo
            ? `Activo desde ${new Date(c.corte).toLocaleString('es-PE')}. Las ventas confirmadas desde esa fecha acreditan monedas y sellos.`
            : 'Mientras esté apagado ninguna venta acredita monedas ni sellos y no se pueden canjear premios.'}
        </p>
        {!confirmando ? (
          <button type="button" onClick={() => setConfirmando(true)} className="mt-3 rounded-lg border border-border-strong px-3 py-2 text-sm text-ink hover:border-red hover:text-red">
            {c.activo ? 'Apagar programa' : 'Activar programa'}
          </button>
        ) : (
          <div role="alertdialog" aria-label="Confirmar cambio de estado" className="mt-3 rounded-lg border border-red/40 bg-red/10 p-3">
            <p className="text-sm text-ink">
              {c.activo
                ? 'Al apagarlo se detienen las acreditaciones y los canjes. Lo ya acumulado se conserva.'
                : 'Al activarlo se fija la fecha de corte. Las ventas anteriores no acreditan. Esta pantalla no convierte los puntos antiguos: esa transición es un paso aparte.'}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setConfirmando(false)} disabled={guardando} className="flex-1 rounded-lg border border-border-strong py-2 text-sm">
                Cancelar
              </button>
              <button type="button" onClick={() => cambiarActivo(!c.activo)} disabled={guardando} className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40">
                {guardando ? 'Aplicando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={guardar} className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-ink">Tasas de monedas (sobre importes netos)</p>
        <div className="grid grid-cols-2 gap-3">
          {campo('sm', 'Servicios: monedas', 'tasaServMonedas')}
          {campo('ss', 'por cada S/ netos', 'tasaServSoles')}
          {campo('pm', 'Productos: monedas', 'tasaProdMonedas')}
          {campo('ps', 'por cada S/ netos', 'tasaProdSoles')}
        </div>
        <p className="text-xs text-ink/50">Se conservan las fracciones. El envío no cuenta. Las monedas no vencen.</p>
        <p className="pt-1 text-sm font-medium text-ink">Umbrales de clasificación (acumulados, no bajan por gastar ni por inactividad)</p>
        <div className="grid grid-cols-2 gap-3">
          {campo('up', 'Premium desde', 'umbralPremium', '1')}
          {campo('uv', 'VIP desde', 'umbralVip', '1')}
        </div>
        <p className="text-xs text-ink/50">
          Sellos: {c.sellos_max} como máximo para acumular; cada premio cuesta {c.sellos_por_premio}. Un sello por clienta y día de Perú con venta de servicios.
        </p>
        <button type="submit" disabled={guardando} className="w-full rounded-lg bg-red py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {guardando ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function RecompensasWeb() {
  const [params, setParams] = useSearchParams()
  const pestana = PESTANAS.some((p) => p.id === params.get('tab')) ? params.get('tab') : 'monedas'
  const servicioFoco = params.get('servicio')
  const productoFoco = params.get('producto')
  // Solo rutas internas del POS (nunca un destino arbitrario).
  const desdeParam = params.get('desde')
  const desde = desdeParam && /^\/[a-z-]+$/.test(desdeParam) ? desdeParam : null

  const [estado, setEstado] = useState(null)
  const [servicios, setServicios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    const [cat, prot, canj, cfg, serv] = await Promise.all([
      supabase.from('recompensas_catalogo').select('*').order('creado_en', { ascending: false }),
      supabase.from('servicios_proteccion').select('servicio_id, materiales, asistente, asistente_pct, otros, total, actualizado_en'),
      supabase.from('recompensas_canjes').select('catalogo_id'),
      supabase.from('recompensas_config').select('*').eq('id', 1).single(),
      // Lectura completa por bloques: el servidor corta cada respuesta en 1000 filas (QA-046).
      leerServicios(supabase, { columnas: 'id, nombre, precio, activo' }).then(
        (data) => ({ data, error: null }),
        (error) => ({ data: null, error }),
      ),
    ])
    const falla = [cat, prot, canj, cfg, serv].find((r) => r.error)
    if (falla) {
      // Un error nunca se presenta como lista vacía o valor 0.
      setError('No se pudo cargar la administración de Recompensas.')
      setCargando(false)
      return
    }
    const canjes = {}
    for (const c of canj.data) canjes[c.catalogo_id] = (canjes[c.catalogo_id] ?? 0) + 1
    const proteccion = {}
    for (const p of prot.data) proteccion[p.servicio_id] = p
    setServicios(serv.data)
    setEstado({ premios: cat.data, canjes, proteccion, config: cfg.data })
    setError(null)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  function irA(id) {
    const siguiente = new URLSearchParams(params)
    siguiente.set('tab', id)
    if (id !== 'proteccion') siguiente.delete('servicio')
    if (id !== 'proteccion-productos') siguiente.delete('producto')
    setParams(siguiente, { replace: true })
  }

  return (
    <div className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)" style={{ '--color-foco': 'var(--color-red)' }}>
      <h1 className="mt-3 text-base font-semibold text-red">Recompensas Web</h1>
      {desde && (
        <Link to={desde} className="mt-1 inline-block text-sm text-ink/70 underline hover:text-red">
          ← Volver a {desde === '/servicios' ? 'Servicios' : desde === '/inventario' ? 'Inventario' : 'la pantalla anterior'}
        </Link>
      )}

      <div role="tablist" aria-label="Secciones de Recompensas" className="mt-3 flex flex-wrap gap-2">
        {PESTANAS.map((p) => {
          const Icono = p.icono
          const activa = pestana === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => irA(p.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${activa ? 'border-red bg-red/10 text-red' : 'border-border text-ink/70 hover:border-border-strong'}`}
            >
              <Icono className="h-4 w-4" />
              {p.label}
            </button>
          )
        })}
      </div>

      {cargando && <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando...</p>}
      {!cargando && error && <AvisoError mensaje={error} onReintentar={() => { setCargando(true); cargar() }} />}

      {!cargando && !error && estado && (
        <div role="tabpanel" aria-label={PESTANAS.find((p) => p.id === pestana).label}>
          {(pestana === 'monedas' || pestana === 'sellos') && (
            <Catalogo
              origen={pestana === 'monedas' ? 'MONEDAS' : 'SELLOS'}
              estado={estado}
              servicios={servicios}
              sellosPorPremio={estado.config.sellos_por_premio}
              recargar={cargar}
            />
          )}
          {pestana === 'proteccion' && (
            <Proteccion estado={estado} servicios={servicios} servicioFoco={servicioFoco} recargar={cargar} />
          )}
          {pestana === 'proteccion-productos' && <ProteccionProductos productoFoco={productoFoco} />}
          {pestana === 'programa' && <Programa key={estado.config.actualizado_en} estado={estado} recargar={cargar} />}
        </div>
      )}
    </div>
  )
}
