import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { listarCambios } from '../lib/cambiosFormulario.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'
import { edad } from '../lib/edad.js'
import { formatearFechaISO } from '../lib/fechas.js'

const COLUMNAS_DEVUELTAS = 'id, nombre, telefono, sexo, cumpleanos, foto_url, cliente_web_id'

const formularioVacio = {
  nombre: '',
  telefono: '',
  dni: '',
  sexo: '',
  direccion: '',
  cumpleanos: '',
  notas: '',
}

function formularioDesdeCliente(cliente) {
  return {
    nombre: cliente.nombre ?? '',
    telefono: cliente.telefono ?? '',
    dni: cliente.dni ?? '',
    sexo: cliente.sexo ?? '',
    direccion: cliente.direccion ?? '',
    cumpleanos: cliente.cumpleanos ?? '',
    notas: cliente.notas ?? '',
  }
}

function validar(formulario) {
  if (!formulario.nombre.trim()) return 'El nombre completo es obligatorio.'
  const dni = formulario.dni.trim()
  if (dni && !/^\d{8}$/.test(dni)) return 'El DNI debe tener 8 dígitos.'
  if (formulario.cumpleanos && edad(formulario.cumpleanos) == null) {
    return 'La fecha de cumpleaños no es válida: no puede ser futura.'
  }
  return null
}

export default function ModalCliente({ cliente, nombreInicial, notaGuia, onCerrar, onGuardado, bajoHeader = true }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(cliente)

  const [formulario, setFormulario] = useState(() =>
    esEdicion
      ? formularioDesdeCliente(cliente)
      : { ...formularioVacio, nombre: nombreInicial ?? '' },
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const hoyIso = formatearFechaISO(new Date())
  const edadCalculada = edad(formulario.cumpleanos, hoyIso)


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
      nombre: formulario.nombre.trim(),
      telefono: formulario.telefono.trim() || null,
      sexo: formulario.sexo || null,
      direccion: formulario.direccion.trim() || null,
      cumpleanos: formulario.cumpleanos || null,
      notas: formulario.notas.trim() || null,
    }
    // Al editar, el DNI solo se manda si la fila que se abrió lo traía: así un formulario abierto con una fila sin esa
    // columna no lo borraría sin querer. (Hoy solo se edita desde el perfil, que sí lo trae.)
    if (!esEdicion || 'dni' in cliente) datos.dni = formulario.dni.trim() || null

    // DNI, dirección y notas se pueden escribir pero no leer de la tabla (solo por la vista clientes_admin,
    // migración 20261120000004): un `.select()` sin columnas pediría `*` y daría 403. Se devuelven las columnas
    // permitidas y lo enviado completa el resto.
    // Crear pasa por crear_cliente_personal (migración 20261124000006): cajera, encargada y asistente también registran
    // clientas, pero sin poder escribir columnas que no son suyas (puntos, referidos…). Editar sigue siendo solo de la admin.
    const { data: filaGuardada, error: errorGuardado } = esEdicion
      ? await supabase.from('clientes').update(datos).eq('id', cliente.id).select(COLUMNAS_DEVUELTAS).single()
      : await supabase.rpc('crear_cliente_personal', {
          p_nombre: datos.nombre,
          p_telefono: datos.telefono,
          p_dni: datos.dni ?? null,
          p_sexo: datos.sexo,
          p_direccion: datos.direccion,
          p_cumpleanos: datos.cumpleanos,
          p_notas: datos.notas,
        })

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.code === '23505'
          ? 'Ya existe un cliente con ese teléfono.'
          : errorGuardado.code === '23514'
            ? 'El DNI debe tener 8 dígitos.'
            : errorGuardado.code === 'P0001'
              ? errorGuardado.message
              : 'No se pudo guardar el cliente. Intenta de nuevo.',
      )
      return
    }

    onGuardado({ ...datos, ...filaGuardada })
  }

  // X, «Cancelar» y Esc: con cambios sin guardar se pregunta antes de cerrar y se dice qué se perdería.
  const formularioBase = useRef(formulario)
  const cambios = listarCambios(formularioBase.current, formulario, { nombre: 'Nombre', telefono: 'Teléfono', dni: 'DNI', sexo: 'Sexo', direccion: 'Dirección', cumpleanos: 'Cumpleaños', notas: 'Notas' })
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar, bloqueado: guardando })

  return (
    <div className={`${bajoHeader ? 'fixed inset-x-0 bottom-0 top-[59px] sm:top-0' : 'fixed inset-0'} z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4`}>
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">
            {esEdicion ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={guardando} />
        </div>

        {/* Nota que dejó quien agendó la cita (nombre completo, celular…): sirve de guía para llenar la ficha, no se guarda sola. */}
        {!esEdicion && notaGuia?.trim() && (
          <div className="mt-3 rounded-lg border border-blue/30 bg-blue/10 px-2.5 py-2 text-xs">
            <p className="font-medium text-blue">Nota de la cita (guía)</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-ink/80">{notaGuia}</p>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-nombre`}>Nombre completo</Etiqueta>
            <input
              id={`${idBase}-nombre`}
              type="search"
              autoComplete="new-password"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-telefono`}>Teléfono</Etiqueta>
            <input
              id={`${idBase}-telefono`}
              type="search"
              inputMode="tel"
              autoComplete="new-password"
              value={formulario.telefono}
              onChange={(evento) => actualizarCampo('telefono', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-dni`}>DNI</Etiqueta>
              <input
                id={`${idBase}-dni`}
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={formulario.dni}
                onChange={(evento) => actualizarCampo('dni', evento.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-sexo`}>Sexo</Etiqueta>
              <select
                id={`${idBase}-sexo`}
                value={formulario.sexo}
                onChange={(evento) => actualizarCampo('sexo', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="">Sin especificar</option>
                <option value="Femenino">Femenino</option>
                <option value="Masculino">Masculino</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[3fr_2fr] gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-cumpleanos`}>Fecha de cumpleaños</Etiqueta>
              <input
                id={`${idBase}-cumpleanos`}
                type="date"
                max={hoyIso}
                value={formulario.cumpleanos}
                onChange={(evento) => actualizarCampo('cumpleanos', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>
            <div>
              {/* Solo lectura: se calcula sola apenas la fecha es válida. */}
              <Etiqueta htmlFor={`${idBase}-edad`}>Edad</Etiqueta>
              <output
                id={`${idBase}-edad`}
                htmlFor={`${idBase}-cumpleanos`}
                aria-live="polite"
                className={`flex w-full items-center rounded-lg border border-dashed border-border px-3 py-2 text-sm ${
                  edadCalculada != null ? 'font-mono text-purple-300' : 'text-ink/50'
                }`}
              >
                {edadCalculada != null
                  ? `${edadCalculada} ${edadCalculada === 1 ? 'año' : 'años'}`
                  : formulario.cumpleanos
                    ? 'Fecha no válida'
                    : '—'}
              </output>
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-direccion`}>Dirección</Etiqueta>
            <input
              id={`${idBase}-direccion`}
              type="search"
              autoComplete="new-password"
              value={formulario.direccion}
              onChange={(evento) => actualizarCampo('direccion', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-notas`}>Notas</Etiqueta>
            <textarea
              id={`${idBase}-notas`}
              autoComplete="off"
              value={formulario.notas}
              onChange={(evento) => actualizarCampo('notas', evento.target.value)}
              placeholder="Opcional"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
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
            onClick={intentarCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
      {aviso}
    </div>
  )
}
