import { useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { aInputDatetimeLima, deInputDatetimeLima } from '../lib/fechas.js'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'
import Etiqueta from './Etiqueta.jsx'

function formularioVacio() {
  return {
    servicioId: '',
    clienteId: '',
    precio: '',
    fecha: aInputDatetimeLima(new Date()),
    nota: '',
  }
}

function formularioDesdeRegistro(registro) {
  return {
    servicioId: registro.servicio_id ?? '',
    clienteId: registro.cliente_id ?? '',
    precio: String(registro.precio ?? ''),
    fecha: aInputDatetimeLima(new Date(registro.fecha)),
    nota: registro.nota ?? '',
  }
}

function validar(formulario) {
  if (!formulario.servicioId) return 'Selecciona un servicio.'
  if (!formulario.clienteId) return 'Selecciona un cliente.'

  const precio = parseFloat(formulario.precio)
  if (Number.isNaN(precio) || precio < 0) return 'El precio debe ser un número válido.'

  if (!formulario.fecha) return 'Selecciona una fecha y hora.'

  return null
}

export default function ModalRegistroAtencion({ registro, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const esEdicion = Boolean(registro)

  // El % de comisión depende de quién es DUEÑO del registro (a nombre de
  // quién queda guardado), no de quién lo está editando. Antes, un admin
  // editando la atención de una asistente pisaba su comisión real con 100%
  // porque el cálculo miraba el rol de quien editaba en vez del dueño.
  const idDueno = esEdicion ? registro.usuario_id : usuario.id

  const [servicios, setServicios] = useState([])
  const [clientes, setClientes] = useState([])
  const [cargandoListas, setCargandoListas] = useState(true)

  const [asistenteIdDueno, setAsistenteIdDueno] = useState(null)
  const [cargandoAsistenteDueno, setCargandoAsistenteDueno] = useState(true)
  const [porcentajeActual, setPorcentajeActual] = useState(null)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeRegistro(registro) : formularioVacio(),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    async function cargarListas() {
      const [resServicios, resClientes] = await Promise.all([
        supabase.from('servicios').select('id, nombre, precio').order('nombre'),
        supabase.from('clientes').select('id, nombre').order('nombre'),
      ])
      setServicios(resServicios.data ?? [])
      setClientes(resClientes.data ?? [])
      setCargandoListas(false)
    }
    cargarListas()
  }, [])

  // Ficha de asistente del DUEÑO del registro (no de quien edita). Si el
  // dueño no tiene ficha de asistente (p. ej. es el propio admin), se asume
  // que se queda con el 100% — igual que antes, pero ahora basado en el
  // dueño real y no en el rol de quien abrió el modal.
  useEffect(() => {
    let vigente = true
    async function cargarAsistenteDueno() {
      setCargandoAsistenteDueno(true)
      const { data } = await supabase
        .from('asistentes')
        .select('id')
        .eq('usuario_id', idDueno)
        .maybeSingle()
      if (vigente) {
        setAsistenteIdDueno(data?.id ?? null)
        setCargandoAsistenteDueno(false)
      }
    }
    cargarAsistenteDueno()
    return () => {
      vigente = false
    }
  }, [idDueno])

  useEffect(() => {
    async function cargarPorcentaje() {
      if (!formulario.servicioId || cargandoAsistenteDueno) {
        setPorcentajeActual(null)
        return
      }
      if (!asistenteIdDueno) {
        setPorcentajeActual(100)
        return
      }
      const { data } = await supabase
        .from('porcentajes')
        .select('porcentaje')
        .eq('servicio_id', formulario.servicioId)
        .eq('asistente_id', asistenteIdDueno)
        .maybeSingle()
      setPorcentajeActual(data?.porcentaje ?? null)
    }
    cargarPorcentaje()
  }, [formulario.servicioId, asistenteIdDueno, cargandoAsistenteDueno])

  const precioNumero = parseFloat(formulario.precio)
  const pagoCalculado =
    porcentajeActual != null && !Number.isNaN(precioNumero)
      ? (precioNumero * porcentajeActual) / 100
      : null

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  function seleccionarServicio(servicioId) {
    const servicio = servicios.find((s) => s.id === servicioId)
    setFormulario((anterior) => ({
      ...anterior,
      servicioId,
      precio: servicio ? String(servicio.precio) : anterior.precio,
    }))
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

    const precio = parseFloat(formulario.precio)

    const datos = {
      servicio_id: formulario.servicioId,
      cliente_id: formulario.clienteId,
      precio,
      fecha: deInputDatetimeLima(formulario.fecha).toISOString(),
      nota: formulario.nota.trim() || null,
      porcentaje_aplicado: porcentajeActual,
      pago_asistente: porcentajeActual != null ? (precio * porcentajeActual) / 100 : null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('registro_servicios').update(datos).eq('id', registro.id)
      : await supabase.from('registro_servicios').insert({ ...datos, usuario_id: usuario.id })

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.message === MENSAJE_NEGOCIO_CERRADO
          ? MENSAJE_NEGOCIO_CERRADO
          : 'No se pudo guardar la atención. Intenta de nuevo.',
      )
      return
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar atención' : 'Registrar atención'}
        </h2>

        {cargandoListas ? (
          <p className="mt-4 text-center font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-servicio`}>Servicio</Etiqueta>
              <select
                id={`${idBase}-servicio`}
                value={formulario.servicioId}
                onChange={(evento) => seleccionarServicio(evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="">Selecciona un servicio</option>
                {servicios.map((servicio) => (
                  <option key={servicio.id} value={servicio.id}>
                    {servicio.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-cliente`}>Cliente</Etiqueta>
              <select
                id={`${idBase}-cliente`}
                value={formulario.clienteId}
                onChange={(evento) => actualizarCampo('clienteId', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="">Selecciona un cliente</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-precio`}>Precio</Etiqueta>
              <input
                id={`${idBase}-precio`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formulario.precio}
                onChange={(evento) => actualizarCampo('precio', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
              {formulario.servicioId &&
                (porcentajeActual == null ? (
                  <p className="mt-1.5 text-xs text-orange-400">
                    Sin porcentaje asignado para este servicio — se guardará sin comisión.
                  </p>
                ) : (
                  !Number.isNaN(precioNumero) && (
                    <p className="mt-1.5 font-mono text-xs text-ink/60">
                      {precioNumero} × {porcentajeActual}% = {pagoCalculado.toFixed(2)}
                    </p>
                  )
                ))}
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Fecha y hora</Etiqueta>
              <input
                id={`${idBase}-fecha`}
                type="datetime-local"
                value={formulario.fecha}
                onChange={(evento) => actualizarCampo('fecha', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>

            <div>
              <Etiqueta htmlFor={`${idBase}-nota`}>Nota</Etiqueta>
              <textarea
                id={`${idBase}-nota`}
                value={formulario.nota}
                onChange={(evento) => actualizarCampo('nota', evento.target.value)}
                placeholder="Opcional"
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>
        )}

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
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || cargandoListas || cargandoAsistenteDueno}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
