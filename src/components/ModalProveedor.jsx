import { useId, useRef, useState } from 'react'
import { Building2, MapPin, Phone, StickyNote, Truck, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { SIN_SUGERENCIAS } from '../lib/sinSugerencias.js'
import {
  CAMPOS_PROVEEDOR,
  COLUMNAS_PROVEEDOR,
  GRUPOS_PROVEEDOR,
  formularioProveedor,
  mensajeErrorProveedor,
} from '../lib/proveedores.js'
import Etiqueta from './Etiqueta.jsx'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import CampoColapsable from './CampoColapsable.jsx'
import ModalConfirmarDescarte from './ModalConfirmarDescarte.jsx'
import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'

// Ícono de cada sección de «Más datos» (mismo patrón que los títulos de Web → Contacto).
const ICONO_GRUPO = { contacto: Phone, ubicacion: MapPin, empresa: Building2, comercial: Wallet, otros: StickyNote }

const CLASE_CAMPO =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-amber'

function textoCorto(valor) {
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  const limpio = String(valor ?? '').trim()
  if (!limpio) return '(vacío)'
  return limpio.length > 40 ? `${limpio.slice(0, 40)}…` : limpio
}

// Crear / editar un proveedor (solo administradora; guardar_proveedor). Lo esencial siempre a la vista; el resto de la
// ficha en «Más datos». `onGuardado` recibe la fila ya guardada (normalizada por el servidor, p. ej. la web con https://).
// z-40: se abre encima de otros modales (buscador de proveedores, detalle del proveedor).
export default function ModalProveedor({ proveedor = null, nombreInicial = '', onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(proveedor)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioProveedor(proveedor) : { ...formularioProveedor(null), nombre: nombreInicial.trim() },
  )
  const base = useRef(formulario)
  const [mostrarMas, setMostrarMas] = useState(() =>
    CAMPOS_PROVEEDOR.some((campo) => campo.grupo !== 'principal' && String(formulario[campo.clave] ?? '').trim()),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)

  const cambios = CAMPOS_PROVEEDOR.filter(({ clave }) => base.current[clave] !== formulario[clave]).map(
    ({ clave, etiqueta }) => `${etiqueta}: ${textoCorto(base.current[clave])} → ${textoCorto(formulario[clave])}`,
  )
  if (base.current.activo !== formulario.activo) cambios.push(`Activo: ${textoCorto(base.current.activo)} → ${textoCorto(formulario.activo)}`)

  function intentarCerrar() {
    if (guardando) return
    if (cambios.length > 0) setConfirmandoDescarte(true)
    else onCerrar()
  }
  useCerrarConEscape(intentarCerrar)

  function actualizar(clave, valor) {
    setFormulario((anterior) => ({ ...anterior, [clave]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()
    if (guardando) return
    if (!formulario.nombre.trim()) {
      setError('El nombre del proveedor es obligatorio.')
      return
    }
    setGuardando(true)
    setError(null)

    const { data: id, error: errorRpc } = await supabase.rpc('guardar_proveedor', {
      p_id: proveedor?.id ?? null,
      p_datos: formulario,
    })
    if (errorRpc) {
      setGuardando(false)
      setError(mensajeErrorProveedor(errorRpc, 'No se pudo guardar el proveedor. Intenta de nuevo.'))
      return
    }

    const { data: fila } = await supabase.from('proveedores').select(COLUMNAS_PROVEEDOR).eq('id', id).maybeSingle()
    setGuardando(false)
    onGuardado(fila ?? { ...formulario, id })
  }

  // Mismo formato que «Datos de contacto y redes» de Web → Contacto: etiqueta a la izquierda (w-24 / lg:w-36) y el control a la
  // derecha, en filas; en escritorio dos columnas. Los campos largos (nombre, textos) ocupan las dos.
  function campo({ clave, etiqueta, obligatorio, placeholder, inputMode, mono, tipo }) {
    const id = `${idBase}-${clave}`
    const ancho = tipo === 'textarea' || clave === 'nombre' ? 'lg:col-span-2' : ''
    return (
      <div key={clave} className={`flex gap-3 ${tipo === 'textarea' ? 'items-start' : 'items-center'} ${ancho}`}>
        <Etiqueta
          obligatorio={obligatorio}
          htmlFor={id}
          className={`w-24 shrink-0 lg:w-36 ${tipo === 'textarea' ? 'pt-2' : ''}`}
        >
          {etiqueta}
        </Etiqueta>
        {tipo === 'textarea' ? (
          <textarea
            id={id}
            rows={2}
            {...SIN_SUGERENCIAS}
            value={formulario[clave]}
            onChange={(evento) => actualizar(clave, evento.target.value)}
            placeholder={placeholder}
            className={`${CLASE_CAMPO} min-w-0 flex-1 resize-none`}
          />
        ) : (
          <input
            id={id}
            type="search"
            inputMode={inputMode}
            {...SIN_SUGERENCIAS}
            value={formulario[clave]}
            onChange={(evento) => actualizar(clave, evento.target.value)}
            placeholder={placeholder}
            autoFocus={clave === 'nombre'}
            className={`${CLASE_CAMPO} min-w-0 flex-1 ${mono ? 'font-mono' : ''}`}
          />
        )}
      </div>
    )
  }

  const camposDe = (grupo) => CAMPOS_PROVEEDOR.filter((c) => c.grupo === grupo)

  const tituloSeccion = (Icono, texto) => (
    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
      <Icono className="h-4 w-4 text-amber" aria-hidden="true" />
      {texto}
    </p>
  )

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        ref={panelRef}
        autoComplete="off"
        onSubmit={guardar}
        className="flex max-h-full w-full max-w-md flex-col rounded-lg border border-border bg-surface lg:max-w-3xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <h2 className="text-base font-semibold text-ink">{esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={guardando} />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          {tituloSeccion(Truck, 'Datos del proveedor')}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2 lg:gap-x-6">{camposDe('principal').map(campo)}</div>

          <button
            type="button"
            onClick={() => setMostrarMas((abierto) => !abierto)}
            aria-expanded={mostrarMas}
            className="flex items-center gap-1 text-xs text-ink/60 transition-colors hover:text-amber"
          >
            <IconoFlechaDesplegable className={`h-3 w-3 transition-transform duration-300 ${mostrarMas ? 'rotate-180' : ''}`} />
            Más datos del proveedor
          </button>
          <CampoColapsable abierto={mostrarMas} diferido>
            <div className="space-y-4">
              {GRUPOS_PROVEEDOR.filter((grupo) => grupo.id !== 'principal').map((grupo) => (
                <section key={grupo.id} className="space-y-3 border-t border-border pt-3" aria-label={grupo.titulo}>
                  {tituloSeccion(ICONO_GRUPO[grupo.id] ?? StickyNote, grupo.titulo)}
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2 lg:gap-x-6">{camposDe(grupo.id).map(campo)}</div>
                </section>
              ))}
            </div>
          </CampoColapsable>

          {esEdicion && (
            <label className="flex items-center gap-2 border-t border-border pt-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={formulario.activo}
                onChange={(evento) => actualizar('activo', evento.target.checked)}
                className="h-4 w-4 accent-amber"
              />
              Activo (los inactivos no se ofrecen al vincular ni al agregar stock)
            </label>
          )}

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario) lg:justify-end">
          <button
            type="button"
            onClick={intentarCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40 lg:w-36 lg:flex-none"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40 lg:w-44 lg:flex-none"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>

      {confirmandoDescarte && (
        <ModalConfirmarDescarte cambios={cambios} onSeguir={() => setConfirmandoDescarte(false)} onDescartar={onCerrar} />
      )}
    </div>
  )
}
