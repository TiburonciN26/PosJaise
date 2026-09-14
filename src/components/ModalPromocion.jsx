import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'

const formularioVacio = {
  titulo: '',
  descripcion: '',
  tipoDescuento: 'PORCENTAJE',
  valor: '',
  vigenteDesde: '',
  vigenteHasta: '',
  activo: true,
}

function formularioDesdePromocion(promocion) {
  return {
    titulo: promocion.titulo ?? '',
    descripcion: promocion.descripcion ?? '',
    tipoDescuento: promocion.tipo_descuento ?? 'PORCENTAJE',
    valor: String(promocion.valor ?? ''),
    vigenteDesde: promocion.vigente_desde ?? '',
    vigenteHasta: promocion.vigente_hasta ?? '',
    activo: promocion.activo ?? true,
  }
}

function validar(formulario) {
  if (!formulario.titulo.trim()) return 'El título es obligatorio.'

  const valor = parseFloat(formulario.valor)
  if (Number.isNaN(valor) || valor <= 0) {
    return 'El valor debe ser un número mayor a 0.'
  }
  if (formulario.tipoDescuento === 'PORCENTAJE' && valor > 100) {
    return 'Un porcentaje no puede ser mayor a 100.'
  }

  if (
    formulario.vigenteDesde &&
    formulario.vigenteHasta &&
    formulario.vigenteHasta < formulario.vigenteDesde
  ) {
    return 'La fecha de fin no puede ser antes que la de inicio.'
  }

  return null
}

export default function ModalPromocion({ promocion, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(promocion)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdePromocion(promocion) : formularioVacio,
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    setGuardando(true)
    setError(null)

    const datos = {
      titulo: formulario.titulo.trim(),
      descripcion: formulario.descripcion.trim() || null,
      tipo_descuento: formulario.tipoDescuento,
      valor: parseFloat(formulario.valor),
      vigente_desde: formulario.vigenteDesde || null,
      vigente_hasta: formulario.vigenteHasta || null,
      activo: formulario.activo,
    }

    const { data: filaGuardada, error: errorGuardado } = esEdicion
      ? await supabase.from('promociones').update(datos).eq('id', promocion.id).select().single()
      : await supabase.from('promociones').insert(datos).select().single()

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar la promoción. Intenta de nuevo.')
      return
    }

    onGuardado(filaGuardada)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar promoción' : 'Nueva promoción'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-titulo`}>Título</Etiqueta>
            <input
              id={`${idBase}-titulo`}
              type="search"
              autoComplete="new-password"
              value={formulario.titulo}
              onChange={(evento) => actualizarCampo('titulo', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-red"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-descripcion`}>Descripción</Etiqueta>
            <textarea
              id={`${idBase}-descripcion`}
              autoComplete="off"
              value={formulario.descripcion}
              onChange={(evento) => actualizarCampo('descripcion', evento.target.value)}
              placeholder="Opcional"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-red"
            />
          </div>

          <div>
            <Etiqueta>Tipo de descuento</Etiqueta>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => actualizarCampo('tipoDescuento', 'PORCENTAJE')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  formulario.tipoDescuento === 'PORCENTAJE'
                    ? 'border-red bg-red/10 text-red'
                    : 'border-border text-ink/70 hover:border-border-strong'
                }`}
              >
                Porcentaje (%)
              </button>
              <button
                type="button"
                onClick={() => actualizarCampo('tipoDescuento', 'MONTO_FIJO')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  formulario.tipoDescuento === 'MONTO_FIJO'
                    ? 'border-red bg-red/10 text-red'
                    : 'border-border text-ink/70 hover:border-border-strong'
                }`}
              >
                Monto fijo (S/)
              </button>
            </div>
          </div>

          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-valor`}>
              {formulario.tipoDescuento === 'PORCENTAJE' ? 'Porcentaje' : 'Monto'}
            </Etiqueta>
            <input
              id={`${idBase}-valor`}
              type="search"
              inputMode="decimal"
              autoComplete="new-password"
              value={formulario.valor}
              onChange={(evento) => actualizarCampo('valor', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-desde`}>Vigente desde</Etiqueta>
              <input
                id={`${idBase}-desde`}
                type="date"
                value={formulario.vigenteDesde}
                onChange={(evento) => actualizarCampo('vigenteDesde', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-hasta`}>Vigente hasta</Etiqueta>
              <input
                id={`${idBase}-hasta`}
                type="date"
                value={formulario.vigenteHasta}
                onChange={(evento) => actualizarCampo('vigenteHasta', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-ink/50">Deja vacío el que no tenga límite.</p>

          <div>
            <Etiqueta>Estado</Etiqueta>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => actualizarCampo('activo', true)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  formulario.activo
                    ? 'border-green bg-green/10 text-green'
                    : 'border-border text-ink/70 hover:border-border-strong'
                }`}
              >
                Activa
              </button>
              <button
                type="button"
                onClick={() => actualizarCampo('activo', false)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  !formulario.activo
                    ? 'border-red bg-red/10 text-red'
                    : 'border-border text-ink/70 hover:border-border-strong'
                }`}
              >
                Inactiva
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-red hover:text-red disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
