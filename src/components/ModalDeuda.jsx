import { useEffect, useId, useRef, useState } from 'react'
import { X, User, UserRoundPlus, Scissors, Package } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearFechaISO } from '../lib/fechas.js'
import Etiqueta from './Etiqueta.jsx'
import ModalCliente from './ModalCliente.jsx'

function formularioVacio() {
  return {
    clienteId: '',
    concepto: '',
    monto: '',
    fecha: formatearFechaISO(new Date()),
    nota: '',
  }
}

function formularioDesdeDeuda(deuda) {
  return {
    clienteId: deuda.cliente_id,
    concepto: deuda.concepto ?? '',
    monto: String(deuda.monto ?? ''),
    fecha: deuda.fecha ?? formatearFechaISO(new Date()),
    nota: deuda.nota ?? '',
  }
}

function validar(formulario) {
  if (!formulario.clienteId) return 'Selecciona un cliente.'
  if (!formulario.concepto.trim()) return 'Escribe de qué servicio o motivo viene la deuda.'
  const monto = parseFloat(formulario.monto)
  if (Number.isNaN(monto) || monto <= 0) return 'El monto debe ser mayor a 0.'
  if (!formulario.fecha) return 'Selecciona desde cuándo debe.'
  return null
}

export default function ModalDeuda({ deuda, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const esEdicion = Boolean(deuda)

  const [clientes, setClientes] = useState([])
  const [catalogo, setCatalogo] = useState([]) // servicios + productos, con datos reales
  const [cargandoClientes, setCargandoClientes] = useState(true)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeDeuda(deuda) : formularioVacio(),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const [busquedaCliente, setBusquedaCliente] = useState(() =>
    esEdicion ? (deuda.clientes?.nombre ?? '') : '',
  )
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false)
  const [modalClienteNuevoAbierto, setModalClienteNuevoAbierto] = useState(false)
  const inputClienteRef = useRef(null)

  const [mostrarSugerenciasConcepto, setMostrarSugerenciasConcepto] = useState(false)
  const inputConceptoRef = useRef(null)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    async function cargarListas() {
      const [resClientes, resServicios, resProductos] = await Promise.all([
        supabase.from('clientes').select('id, nombre').order('nombre'),
        supabase.from('servicios').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('productos').select('id, nombre').eq('activo', true).order('nombre'),
      ])
      setClientes(resClientes.data ?? [])
      setCatalogo([
        ...(resServicios.data ?? []).map((s) => ({ ...s, tipo: 'servicio' })),
        ...(resProductos.data ?? []).map((p) => ({ ...p, tipo: 'producto' })),
      ])
      setCargandoClientes(false)
    }
    cargarListas()
  }, [])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  function seleccionarCliente(cliente) {
    actualizarCampo('clienteId', cliente.id)
    setBusquedaCliente(cliente.nombre)
    setMostrarSugerenciasCliente(false)
    inputClienteRef.current?.blur()
  }

  function manejarClienteCreado(clienteCreado) {
    setModalClienteNuevoAbierto(false)
    if (!clienteCreado) return
    setClientes((anterior) =>
      [...anterior, clienteCreado].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    seleccionarCliente(clienteCreado)
  }

  const sugerenciasCliente = clientes.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busquedaCliente.trim().toLowerCase()),
  )

  const sugerenciasConcepto = formulario.concepto.trim()
    ? catalogo.filter((item) =>
        item.nombre.toLowerCase().includes(formulario.concepto.trim().toLowerCase()),
      )
    : catalogo

  function seleccionarConcepto(item) {
    actualizarCampo('concepto', item.nombre)
    setMostrarSugerenciasConcepto(false)
    inputConceptoRef.current?.blur()
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
      cliente_id: formulario.clienteId,
      concepto: formulario.concepto.trim(),
      monto: parseFloat(formulario.monto),
      fecha: formulario.fecha,
      nota: formulario.nota.trim() || null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('deudas').update(datos).eq('id', deuda.id)
      : await supabase.from('deudas').insert({ ...datos, creado_por: usuario.id })

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar la deuda. Intenta de nuevo.')
      return
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar deuda' : 'Nueva deuda'}
        </h2>

        {cargandoClientes ? (
          <p className="mt-4 text-center font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-cliente`}>Cliente</Etiqueta>
              <div className="relative">
                <input
                  ref={inputClienteRef}
                  id={`${idBase}-cliente`}
                  type="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  value={busquedaCliente}
                  onChange={(evento) => {
                    setBusquedaCliente(evento.target.value)
                    actualizarCampo('clienteId', '')
                    setMostrarSugerenciasCliente(true)
                  }}
                  onFocus={() => setMostrarSugerenciasCliente(true)}
                  onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 150)}
                  placeholder="Buscar cliente..."
                  className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-3 pr-9 text-sm text-ink outline-none focus:border-purple-300"
                />
                {busquedaCliente ? (
                  <button
                    type="button"
                    onClick={() => {
                      setBusquedaCliente('')
                      actualizarCampo('clienteId', '')
                    }}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <User className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                )}

                {mostrarSugerenciasCliente && (sugerenciasCliente.length > 0 || busquedaCliente.trim()) && (
                  <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                    {sugerenciasCliente.map((cliente) => (
                      <button
                        key={cliente.id}
                        type="button"
                        onMouseDown={(evento) => evento.preventDefault()}
                        onClick={() => seleccionarCliente(cliente)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                      >
                        <span className="truncate">{cliente.nombre}</span>
                      </button>
                    ))}
                    {busquedaCliente.trim() && (
                      <button
                        type="button"
                        onMouseDown={(evento) => evento.preventDefault()}
                        onClick={() => {
                          setMostrarSugerenciasCliente(false)
                          setModalClienteNuevoAbierto(true)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-purple-300 transition-colors hover:bg-surface-3 ${
                          sugerenciasCliente.length > 0 ? 'border-t border-border' : ''
                        }`}
                      >
                        <UserRoundPlus className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          Registrar "{busquedaCliente.trim()}" como cliente nuevo
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-concepto`}>
                Servicio / producto / motivo de la deuda
              </Etiqueta>
              <div className="relative">
                <input
                  ref={inputConceptoRef}
                  id={`${idBase}-concepto`}
                  type="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  value={formulario.concepto}
                  onChange={(evento) => {
                    actualizarCampo('concepto', evento.target.value)
                    setMostrarSugerenciasConcepto(true)
                  }}
                  onFocus={() => setMostrarSugerenciasConcepto(true)}
                  onBlur={() => setTimeout(() => setMostrarSugerenciasConcepto(false), 150)}
                  placeholder="Buscar servicio o producto, o escribir uno..."
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
                />

                {mostrarSugerenciasConcepto && sugerenciasConcepto.length > 0 && (
                  <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                    {sugerenciasConcepto.map((item) => (
                      <button
                        key={`${item.tipo}-${item.id}`}
                        type="button"
                        onMouseDown={(evento) => evento.preventDefault()}
                        onClick={() => seleccionarConcepto(item)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                      >
                        {item.tipo === 'servicio' ? (
                          <Scissors className="h-3.5 w-3.5 shrink-0 text-ink/40" />
                        ) : (
                          <Package className="h-3.5 w-3.5 shrink-0 text-ink/40" />
                        )}
                        <span className="truncate">{item.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-monto`}>Monto</Etiqueta>
                <input
                  id={`${idBase}-monto`}
                  type="search"
                  inputMode="decimal"
                  autoComplete="new-password"
                  value={formulario.monto}
                  onChange={(evento) => actualizarCampo('monto', evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
                />
              </div>
              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Debe desde</Etiqueta>
                <input
                  id={`${idBase}-fecha`}
                  type="date"
                  value={formulario.fecha}
                  onChange={(evento) => actualizarCampo('fecha', evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
                />
              </div>
            </div>

            <div>
              <Etiqueta htmlFor={`${idBase}-nota`}>Notas</Etiqueta>
              <textarea
                id={`${idBase}-nota`}
                autoComplete="off"
                value={formulario.nota}
                onChange={(evento) => actualizarCampo('nota', evento.target.value)}
                placeholder="Opcional"
                rows={2}
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
            disabled={guardando || cargandoClientes}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>

      {modalClienteNuevoAbierto && (
        <ModalCliente
          nombreInicial={busquedaCliente.trim()}
          onCerrar={() => setModalClienteNuevoAbierto(false)}
          onGuardado={manejarClienteCreado}
        />
      )}
    </div>
  )
}
