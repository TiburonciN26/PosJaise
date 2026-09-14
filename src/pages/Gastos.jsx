import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Trash2, Plus, ArrowBigDown, Download, Wallet, Ban, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { anioMesEnLima } from '../lib/fechas.js'
import { formatearSoles, sumarMontos } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { aCSV, descargarArchivo } from '../lib/csv.js'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import ModalGasto, { MESES } from '../components/ModalGasto.jsx'
import ModalPlantillasGasto from '../components/ModalPlantillasGasto.jsx'
import { EsqueletoGrupos } from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const MAX_NOMBRES_VISIBLES = 3

function resumenNombres(items) {
  const nombres = items.map((g) => g.nombre)
  if (nombres.length <= MAX_NOMBRES_VISIBLES) return nombres.join(', ')
  const visibles = nombres.slice(0, MAX_NOMBRES_VISIBLES)
  return `${visibles.join(', ')} +${nombres.length - MAX_NOMBRES_VISIBLES} más`
}

function formatearFechaHora(fechaIso) {
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  })
    .format(new Date(fechaIso))
    .replace('.', '')
}

// Misma fila para fijos/variables y para la tarjeta móvil/fila de tabla
// desktop — las 4 versiones ya eran prácticamente idénticas. Eliminar
// queda exclusivo del admin; cancelar/editar los ve cualquiera que llegue
// a esta pantalla (solo ADMINISTRADOR o CAJERA, ver navegacion.js).
function FilaGasto({ gasto, esAdmin, onEditar, onCancelar, onEliminar }) {
  const cancelado = gasto.estado === 'CANCELADO'
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg p-2.5 ${
        cancelado ? 'border border-red/40 bg-red/5' : 'bg-surface-2'
      }`}
    >
      <div className="min-w-0">
        <p className={`truncate text-sm ${cancelado ? 'text-red line-through' : 'text-ink'}`}>
          {gasto.nombre}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className={`font-mono text-sm ${cancelado ? 'text-red/70' : 'text-purple-300'}`}>
            {formatearSoles(gasto.monto)}
          </span>
          {gasto.creado_en && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-ink/40">
              <Clock className="h-3 w-3" />
              {formatearFechaHora(gasto.creado_en)}
            </span>
          )}
          {cancelado && (
            <span className="rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-medium text-red">
              Cancelado
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!cancelado && (
          <>
            <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={onEditar} />
            <BotonAccion icono={Ban} texto="Cancelar" color="rojo" onClick={onCancelar} />
          </>
        )}
        {esAdmin && (
          <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={onEliminar} />
        )}
      </div>
    </div>
  )
}

export default function Gastos({ activo = true }) {
  const { usuario, rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { mostrarToast } = useToast()
  // Mes/año iniciales en hora de Lima, no la del dispositivo (M3 de la 3ª
  // auditoría) — el resto de la app ya deriva el período con anioMesEnLima.
  const { anio: anioLima, mes: mesLimaIndice } = anioMesEnLima(new Date())

  const [mes, setMes] = useState(mesLimaIndice + 1)
  const [anio, setAnio] = useState(anioLima)
  // B9 de la 3ª auditoría: texto del input separado del año numérico — antes
  // el input escribía directo sobre "anio" y, al borrar el campo para
  // escribir uno nuevo, el fallback (parseInt(...) || anioLima) saltaba al
  // año actual en cada tecla del borrado, antes de que el usuario terminara
  // de escribir. Acá "anio" (el que se usa en las consultas) solo cambia
  // cuando el texto es un número válido; si el campo queda vacío/inválido,
  // el blur lo revierte a mostrar el último año válido, sin tocar "anio".
  const [anioTexto, setAnioTexto] = useState(String(anioLima))

  function actualizarAnioTexto(texto) {
    setAnioTexto(texto)
    const parseado = parseInt(texto, 10)
    if (texto.trim() !== '' && !Number.isNaN(parseado)) setAnio(parseado)
  }

  function confirmarAnioTexto() {
    const parseado = parseInt(anioTexto, 10)
    if (anioTexto.trim() === '' || Number.isNaN(parseado)) setAnioTexto(String(anio))
  }

  // M3 de la 4ª auditoría: "anio" ya no salta de valor mientras se escribe
  // (B9), pero seguía disparando un refetch por cada dígito válido de un año
  // de 4 cifras (2 -> 20 -> 202 -> 2026 = 4 consultas). anioDebounced es lo
  // único que alimenta la carga de datos y todo lo que depende de "qué
  // período está cargado ahora mismo" (encabezados, el CSV, el modal) — el
  // input en sí sigue respondiendo al instante vía anioTexto/anio.
  const anioDebounced = useDebounce(anio, 500)

  const [gastos, setGastos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [modalGasto, setModalGasto] = useState(null) // null | 'nuevo' | gasto
  const [gastoAEliminar, setGastoAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [gastoACancelar, setGastoACancelar] = useState(null)
  const [cancelando, setCancelando] = useState(false)

  const [plantillas, setPlantillas] = useState([])
  const [mostrarPlantillas, setMostrarPlantillas] = useState(false)
  const [generando, setGenerando] = useState(false)

  const [fijosAbiertos, setFijosAbiertos] = useState(false)
  const [variablesAbiertos, setVariablesAbiertos] = useState(false)
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)
  const panelCancelarRef = useRef(null)

  // Selector de mes: mismo desplegable a medida que en Citas.jsx, en vez del
  // <select> nativo (que en móvil abre el picker del sistema operativo).
  const [mesAbierto, setMesAbierto] = useState(false)
  const [posicionMes, setPosicionMes] = useState(null)
  const botonMesRef = useRef(null)

  useCerrarConEscape(() => setGastoAEliminar(null), Boolean(gastoAEliminar))
  useModalA11y(panelEliminarRef, Boolean(gastoAEliminar))
  useCerrarConEscape(() => setGastoACancelar(null), Boolean(gastoACancelar))
  useModalA11y(panelCancelarRef, Boolean(gastoACancelar))
  useCerrarConEscape(() => setMesAbierto(false), mesAbierto)

  function alternarMes() {
    if (mesAbierto) {
      setMesAbierto(false)
      return
    }
    const rect = botonMesRef.current?.getBoundingClientRect()
    if (rect) setPosicionMes({ top: rect.bottom + 4, left: rect.left })
    setMesAbierto(true)
  }

  function seleccionarMes(indiceMes) {
    setMes(indiceMes + 1)
    setMesAbierto(false)
  }

  async function cargarGastos(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('gastos')
      .select('id, nombre, tipo, monto, mes, anio, estado, creado_en')
      .eq('mes', mes)
      .eq('anio', anioDebounced)
      .order('nombre')

    if (!vigente.actual) return

    if (errorConsulta) {
      setError('No se pudo cargar los gastos.')
    } else {
      setError(null)
      setGastos(data ?? [])
    }
    setCargando(false)
  }

  async function cargarPlantillas() {
    const { data, error: errorConsulta } = await supabase
      .from('gastos_recurrentes')
      .select('id, nombre, monto, activo')
      .order('nombre')

    if (!errorConsulta) setPlantillas(data ?? [])
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarGastos(vigente, silencioso)
    if (!silencioso) {
      setFijosAbiertos(false)
      setVariablesAbiertos(false)
    }
    return () => {
      vigente.actual = false
    }
  }, [activo, mes, anioDebounced])

  useEffect(() => {
    cargarPlantillas()
  }, [])

  async function generarGastosFijos() {
    setGenerando(true)

    const { data: existentes, error: errorConsulta } = await supabase
      .from('gastos')
      .select('nombre')
      .eq('tipo', 'FIJO')
      .eq('mes', mes)
      .eq('anio', anioDebounced)

    if (errorConsulta) {
      setGenerando(false)
      mostrarToast('No se pudo verificar los gastos existentes.', 'error')
      return
    }

    const nombresExistentes = new Set(existentes.map((g) => g.nombre))
    const plantillasActivas = plantillas.filter((p) => p.activo)
    const plantillasFaltantes = plantillasActivas.filter((p) => !nombresExistentes.has(p.nombre))

    if (plantillasActivas.length === 0) {
      setGenerando(false)
      mostrarToast('No hay plantillas activas para generar.', 'info')
      return
    }

    if (plantillasFaltantes.length === 0) {
      setGenerando(false)
      mostrarToast('Todos los gastos fijos de este mes ya estaban generados.', 'info')
      return
    }

    const filas = plantillasFaltantes.map((p) => ({
      nombre: p.nombre,
      tipo: 'FIJO',
      monto: p.monto,
      mes,
      anio: anioDebounced,
      creado_por: usuario.id,
    }))

    const { error: errorInsercion } = await supabase.from('gastos').insert(filas)
    setGenerando(false)

    if (errorInsercion) {
      mostrarToast('No se pudieron generar los gastos fijos.', 'error')
      return
    }

    mostrarToast(
      plantillasFaltantes.length === 1
        ? `Se agregó 1 gasto fijo: ${plantillasFaltantes[0].nombre}.`
        : `Se agregaron ${plantillasFaltantes.length} gastos fijos: ${plantillasFaltantes.map((p) => p.nombre).join(', ')}.`,
      'exito',
    )
    cargarGastos()
  }

  async function confirmarEliminar() {
    if (!gastoAEliminar) return

    setEliminando(true)
    const { error: errorEliminar } = await supabase
      .from('gastos')
      .delete()
      .eq('id', gastoAEliminar.id)
    setEliminando(false)
    setGastoAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar el gasto.', 'error')
      return
    }

    mostrarToast('Gasto eliminado.', 'exito')
    cargarGastos()
  }

  async function confirmarCancelar() {
    if (!gastoACancelar) return

    setCancelando(true)
    const { error: errorCancelar } = await supabase
      .from('gastos')
      .update({ estado: 'CANCELADO' })
      .eq('id', gastoACancelar.id)
    setCancelando(false)
    setGastoACancelar(null)

    if (errorCancelar) {
      mostrarToast('No se pudo cancelar el gasto.', 'error')
      return
    }

    mostrarToast('Gasto cancelado.', 'exito')
    cargarGastos()
  }

  function exportarCSV() {
    if (gastos.length === 0) {
      mostrarToast('No hay gastos para exportar en este período.', 'info')
      return
    }
    descargarArchivo(
      `gastos_${anioDebounced}-${String(mes).padStart(2, '0')}.csv`,
      aCSV(gastos, ['nombre', 'tipo', 'monto', 'mes', 'anio']),
    )
  }

  const fijos = gastos.filter((g) => g.tipo === 'FIJO')
  const variables = gastos.filter((g) => g.tipo === 'VARIABLE')

  // Cancelado no cuenta en el total (mismo criterio que Mi Panel/Citas/
  // Ventas), pero sigue en la lista tachado — no desaparece.
  const totalFijos = sumarMontos(
    fijos.filter((g) => g.estado !== 'CANCELADO'),
    (g) => g.monto,
  )
  const totalVariables = sumarMontos(
    variables.filter((g) => g.estado !== 'CANCELADO'),
    (g) => g.monto,
  )

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-5xl"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Resumen del período — la cajera solo maneja caja chica (variable),
          los gastos fijos del negocio no le corresponden ni para verlos. */}
      <div className={`grid gap-3 ${esAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {esAdmin && (
          <TarjetaResumen
            etiqueta="Gastos fijos"
            valor={formatearSoles(totalFijos)}
            claseValor="text-blue"
            padding="p-3"
            compacto
            apilarCompacto
          />
        )}
        <TarjetaResumen
          etiqueta="Gastos variables"
          valor={formatearSoles(totalVariables)}
          claseValor="text-purple-300"
          padding="p-3"
          compacto
          apilarCompacto
        />
      </div>

      {/* Filtro de período + Nuevo gasto: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto bg-bg px-3 py-2">
        <div className="relative min-w-0 flex-1 md:flex-none">
          <button
            ref={botonMesRef}
            type="button"
            onClick={alternarMes}
            aria-expanded={mesAbierto}
            className="flex w-full items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-purple-300"
          >
            <span className="min-w-0 flex-1 truncate text-left">{MESES[mes - 1]}</span>
            <ArrowBigDown
              className={`h-3.5 w-3.5 shrink-0 text-ink/50 transition-transform duration-300 ${
                mesAbierto ? 'rotate-180' : ''
              }`}
            />
          </button>

          {mesAbierto &&
            posicionMes &&
            createPortal(
              <div
                className="fixed inset-0 z-30 bg-black/60"
                onClick={() => setMesAbierto(false)}
              >
                <div
                  onClick={(evento) => evento.stopPropagation()}
                  className="animate-entrada-dropdown fixed w-40 rounded-lg border border-border bg-surface-2 shadow-lg"
                  style={{ top: posicionMes.top, left: posicionMes.left }}
                >
                  {MESES.map((nombreMes, indice) => (
                    <button
                      key={nombreMes}
                      type="button"
                      onClick={() => seleccionarMes(indice)}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                        indice === mes - 1
                          ? 'bg-purple-300/15 text-purple-300'
                          : 'text-ink hover:bg-surface-3'
                      }`}
                    >
                      {nombreMes}
                    </button>
                  ))}
                </div>
              </div>,
              document.body,
            )}
        </div>
        <input
          type="search"
          inputMode="numeric"
          autoComplete="new-password"
          value={anioTexto}
          onChange={(evento) => actualizarAnioTexto(evento.target.value)}
          onBlur={confirmarAnioTexto}
          className="w-20 shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-purple-300"
        />

        <button
          type="button"
          onClick={exportarCSV}
          aria-label="Exportar CSV del mes"
          title="Exportar CSV del mes"
          className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong p-2.5 text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300"
        >
          <Download className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setModalGasto('nuevo')}
          className="ml-auto hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nuevo gasto var.</span>
        </button>
      </div>

      {/* Gestión de plantillas de gastos fijos — exclusivo del admin, la
          cajera no ve ni gestiona nada de gastos fijos. */}
      {esAdmin && (
        <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setMostrarPlantillas(true)}
            className="shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-3 py-1.5 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
          >
            Plantillas de gastos fijos
          </button>
          <button
            type="button"
            onClick={generarGastosFijos}
            disabled={generando}
            className="shrink-0 whitespace-nowrap rounded-lg border border-blue/40 bg-blue/10 px-3 py-1.5 text-sm text-blue transition-colors hover:bg-blue/20 disabled:opacity-40"
          >
            {generando ? 'Creando...' : 'Crear gastos fijos del mes'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoGrupos />
      ) : gastos.length === 0 ? (
        <EstadoVacio
          icono={Wallet}
          mensaje={`No hay gastos registrados en ${MESES[mes - 1]} ${anioDebounced}.`}
          accion={{ label: '+ Nuevo gasto', onClick: () => setModalGasto('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <>
          {/* Tarjetas: solo móvil */}
          <div className="mt-4 grid grid-cols-1 gap-3 lg:hidden">
            {fijos.length > 0 && (
              <div className="rounded-lg border border-blue/40 bg-surface">
                <button
                  type="button"
                  onClick={() => setFijosAbiertos((abierto) => !abierto)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">
                          {MESES[mes - 1]} {anioDebounced}
                        </p>
                        <span className="shrink-0 rounded-full border border-blue/40 bg-blue/15 px-2 py-0.5 text-[11px] font-medium text-blue">
                          FIJO
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-sm text-purple-300">
                        {formatearSoles(totalFijos)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink/60">{resumenNombres(fijos)}</p>
                  </div>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      fijosAbiertos ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <CampoColapsable abierto={fijosAbiertos}>
                  <div className="space-y-2 border-t border-border p-3">
                    {fijos.map((gasto) => (
                      <FilaGasto
                        key={gasto.id}
                        gasto={gasto}
                        esAdmin={esAdmin}
                        onEditar={() => setModalGasto(gasto)}
                        onCancelar={() => setGastoACancelar(gasto)}
                        onEliminar={() => setGastoAEliminar(gasto)}
                      />
                    ))}
                  </div>
                </CampoColapsable>
              </div>
            )}

            {variables.length > 0 && (
              <div className="rounded-lg border border-purple-300/40 bg-surface">
                <button
                  type="button"
                  onClick={() => setVariablesAbiertos((abierto) => !abierto)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">
                          {MESES[mes - 1]} {anioDebounced}
                        </p>
                        <span className="shrink-0 rounded-full border border-purple-300/40 bg-purple-300/15 px-2 py-0.5 text-[11px] font-medium text-purple-300">
                          VARIABLE
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-sm text-purple-300">
                        {formatearSoles(totalVariables)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink/60">{resumenNombres(variables)}</p>
                  </div>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      variablesAbiertos ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <CampoColapsable abierto={variablesAbiertos}>
                  <div className="space-y-2 border-t border-border p-3">
                    {variables.map((gasto) => (
                      <FilaGasto
                        key={gasto.id}
                        gasto={gasto}
                        esAdmin={esAdmin}
                        onEditar={() => setModalGasto(gasto)}
                        onCancelar={() => setGastoACancelar(gasto)}
                        onEliminar={() => setGastoAEliminar(gasto)}
                      />
                    ))}
                  </div>
                </CampoColapsable>
              </div>
            )}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs uppercase tracking-wider text-ink/60">
                  <th className="px-3 py-2 font-normal">Gasto</th>
                  <th className="px-3 py-2 font-normal">Tipo</th>
                  <th className="px-3 py-2 font-normal">Período</th>
                  <th className="px-3 py-2 text-right font-normal">Monto</th>
                  <th className="px-3 py-2 text-right font-normal">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fijos.length > 0 && (
                  <>
                    <tr
                      className="cursor-pointer bg-surface hover:bg-surface-2"
                      onClick={() => setFijosAbiertos((abierto) => !abierto)}
                      onKeyDown={manejarActivacionTeclado(() => setFijosAbiertos((abierto) => !abierto))}
                      role="button"
                      tabIndex={0}
                      aria-expanded={fijosAbiertos}
                    >
                      <td className="px-3 py-2.5 text-ink">
                        <div className="flex items-center gap-2">
                          <span>Gastos fijos</span>
                          <span className="rounded-full border border-blue/40 bg-blue/15 px-2 py-0.5 text-xs font-medium text-blue">
                            FIJO
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink/60">{resumenNombres(fijos)}</p>
                      </td>
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5 text-ink/60">
                        {MESES[mes - 1]} {anioDebounced}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-purple-300">
                        {formatearSoles(totalFijos)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end">
                          <ArrowBigDown
                            className={`h-4 w-4 text-ink/60 transition-transform duration-300 ${
                              fijosAbiertos ? 'rotate-180' : ''
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="p-0">
                        <CampoColapsable abierto={fijosAbiertos}>
                          <div className="space-y-2 border-t border-border bg-bg p-3">
                            {fijos.map((gasto) => (
                              <FilaGasto
                                key={gasto.id}
                                gasto={gasto}
                                esAdmin={esAdmin}
                                onEditar={() => setModalGasto(gasto)}
                                onCancelar={() => setGastoACancelar(gasto)}
                                onEliminar={() => setGastoAEliminar(gasto)}
                              />
                            ))}
                          </div>
                        </CampoColapsable>
                      </td>
                    </tr>
                  </>
                )}

                {variables.length > 0 && (
                  <>
                    <tr
                      className="cursor-pointer bg-surface hover:bg-surface-2"
                      onClick={() => setVariablesAbiertos((abierto) => !abierto)}
                      onKeyDown={manejarActivacionTeclado(() => setVariablesAbiertos((abierto) => !abierto))}
                      role="button"
                      tabIndex={0}
                      aria-expanded={variablesAbiertos}
                    >
                      <td className="px-3 py-2.5 text-ink">
                        <div className="flex items-center gap-2">
                          <span>Gastos variables</span>
                          <span className="rounded-full border border-purple-300/40 bg-purple-300/15 px-2 py-0.5 text-xs font-medium text-purple-300">
                            VARIABLE
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink/60">{resumenNombres(variables)}</p>
                      </td>
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5 text-ink/60">
                        {MESES[mes - 1]} {anioDebounced}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-purple-300">
                        {formatearSoles(totalVariables)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end">
                          <ArrowBigDown
                            className={`h-4 w-4 text-ink/60 transition-transform duration-300 ${
                              variablesAbiertos ? 'rotate-180' : ''
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="p-0">
                        <CampoColapsable abierto={variablesAbiertos}>
                          <div className="space-y-2 border-t border-border bg-bg p-3">
                            {variables.map((gasto) => (
                              <FilaGasto
                                key={gasto.id}
                                gasto={gasto}
                                esAdmin={esAdmin}
                                onEditar={() => setModalGasto(gasto)}
                                onCancelar={() => setGastoACancelar(gasto)}
                                onEliminar={() => setGastoAEliminar(gasto)}
                              />
                            ))}
                          </div>
                        </CampoColapsable>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <BotonFlotanteAgregar
        onClick={() => setModalGasto('nuevo')}
        color="morado"
        label="Nuevo gasto variable"
      />

      {modalGasto && (
        <ModalGasto
          gasto={modalGasto === 'nuevo' ? null : modalGasto}
          mesInicial={mes}
          anioInicial={anioDebounced}
          usuarioId={usuario.id}
          onCerrar={() => setModalGasto(null)}
          onGuardado={() => {
            const esNuevo = modalGasto === 'nuevo'
            setModalGasto(null)
            mostrarToast(esNuevo ? 'Gasto creado.' : 'Gasto actualizado.', 'exito')
            cargarGastos()
          }}
        />
      )}

      {mostrarPlantillas && (
        <ModalPlantillasGasto
          plantillas={plantillas}
          onCerrar={() => setMostrarPlantillas(false)}
          onCambio={cargarPlantillas}
        />
      )}

      {gastoAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar "{gastoAEliminar.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setGastoAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {gastoACancelar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelCancelarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              ¿Cancelar "{gastoACancelar.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Quedará marcado como cancelado y no contará en el total del período.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setGastoACancelar(null)}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarCancelar}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {cancelando ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
