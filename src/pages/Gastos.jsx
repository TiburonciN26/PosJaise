import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, ArrowBigDown, Download } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { formatearSoles } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { aCSV, descargarArchivo } from '../lib/csv.js'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import ModalGasto, { MESES } from '../components/ModalGasto.jsx'
import ModalPlantillasGasto from '../components/ModalPlantillasGasto.jsx'

const MAX_NOMBRES_VISIBLES = 3

function resumenNombres(items) {
  const nombres = items.map((g) => g.nombre)
  if (nombres.length <= MAX_NOMBRES_VISIBLES) return nombres.join(', ')
  const visibles = nombres.slice(0, MAX_NOMBRES_VISIBLES)
  return `${visibles.join(', ')} +${nombres.length - MAX_NOMBRES_VISIBLES} más`
}

export default function Gastos({ activo = true }) {
  const { mostrarToast } = useToast()
  const hoy = new Date()

  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [anio, setAnio] = useState(hoy.getFullYear())

  const [gastos, setGastos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [modalGasto, setModalGasto] = useState(null) // null | 'nuevo' | gasto
  const [gastoAEliminar, setGastoAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)

  const [plantillas, setPlantillas] = useState([])
  const [mostrarPlantillas, setMostrarPlantillas] = useState(false)
  const [generando, setGenerando] = useState(false)

  const [fijosAbiertos, setFijosAbiertos] = useState(false)
  const [variablesAbiertos, setVariablesAbiertos] = useState(false)
  const primeraCargaHecha = useRef(false)

  useCerrarConEscape(() => setGastoAEliminar(null), Boolean(gastoAEliminar))

  async function cargarGastos(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('gastos')
      .select('id, nombre, tipo, monto, mes, anio')
      .eq('mes', mes)
      .eq('anio', anio)
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
  }, [activo, mes, anio])

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
      .eq('anio', anio)

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
      anio,
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

  function exportarCSV() {
    if (gastos.length === 0) {
      mostrarToast('No hay gastos para exportar en este período.', 'info')
      return
    }
    descargarArchivo(
      `gastos_${anio}-${String(mes).padStart(2, '0')}.csv`,
      aCSV(gastos, ['nombre', 'tipo', 'monto', 'mes', 'anio']),
    )
  }

  const fijos = gastos.filter((g) => g.tipo === 'FIJO')
  const variables = gastos.filter((g) => g.tipo === 'VARIABLE')

  const totalFijos = fijos.reduce((acumulado, g) => acumulado + g.monto, 0)
  const totalVariables = variables.reduce((acumulado, g) => acumulado + g.monto, 0)

  return (
    <div className="p-3 pb-6">
      {/* Resumen del período */}
      <div className="grid grid-cols-2 gap-3">
        <TarjetaResumen
          etiqueta="Gastos fijos"
          valor={formatearSoles(totalFijos)}
          claseValor="text-blue"
        />
        <TarjetaResumen
          etiqueta="Gastos variables"
          valor={formatearSoles(totalVariables)}
          claseValor="text-purple-300"
        />
      </div>

      {/* Filtro de período + Nuevo gasto: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto bg-bg px-3 py-2">
        <select
          value={mes}
          onChange={(evento) => setMes(parseInt(evento.target.value, 10))}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-purple-300 md:flex-none"
        >
          {MESES.map((nombreMes, indice) => (
            <option key={nombreMes} value={indice + 1}>
              {nombreMes}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="numeric"
          value={anio}
          onChange={(evento) => setAnio(parseInt(evento.target.value, 10) || hoy.getFullYear())}
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

      {/* Gestión de plantillas de gastos fijos */}
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

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando gastos...</p>
      ) : gastos.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
          No hay gastos registrados en {MESES[mes - 1]} {anio}.
        </p>
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
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink">Gastos fijos</p>
                      <span className="shrink-0 rounded-full border border-blue/40 bg-blue/15 px-2 py-0.5 text-[10px] font-medium text-blue">
                        FIJO
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink/60">{resumenNombres(fijos)}</p>
                    <div className="mt-1.5 flex items-center gap-4 font-mono text-sm">
                      <span className="text-purple-300">{formatearSoles(totalFijos)}</span>
                      <span className="text-ink/60">
                        {MESES[mes - 1]} {anio}
                      </span>
                    </div>
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
                      <div
                        key={gasto.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{gasto.nombre}</p>
                          <span className="font-mono text-sm text-purple-300">
                            {formatearSoles(gasto.monto)}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <BotonAccion
                            icono={Pencil}
                            texto="Editar"
                            color="celeste"
                            onClick={() => setModalGasto(gasto)}
                          />
                          <BotonAccion
                            icono={Trash2}
                            texto="Eliminar"
                            color="rojo"
                            onClick={() => setGastoAEliminar(gasto)}
                          />
                        </div>
                      </div>
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
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink">Gastos variables</p>
                      <span className="shrink-0 rounded-full border border-purple-300/40 bg-purple-300/15 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                        VARIABLE
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink/60">{resumenNombres(variables)}</p>
                    <div className="mt-1.5 flex items-center gap-4 font-mono text-sm">
                      <span className="text-purple-300">{formatearSoles(totalVariables)}</span>
                      <span className="text-ink/60">
                        {MESES[mes - 1]} {anio}
                      </span>
                    </div>
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
                      <div
                        key={gasto.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{gasto.nombre}</p>
                          <span className="font-mono text-sm text-purple-300">
                            {formatearSoles(gasto.monto)}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <BotonAccion
                            icono={Pencil}
                            texto="Editar"
                            color="celeste"
                            onClick={() => setModalGasto(gasto)}
                          />
                          <BotonAccion
                            icono={Trash2}
                            texto="Eliminar"
                            color="rojo"
                            onClick={() => setGastoAEliminar(gasto)}
                          />
                        </div>
                      </div>
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
                <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-ink/60">
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
                        {MESES[mes - 1]} {anio}
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
                              <div
                                key={gasto.id}
                                className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5"
                              >
                                <span className="pl-2 text-sm text-ink">{gasto.nombre}</span>
                                <div className="flex items-center gap-4">
                                  <span className="font-mono text-sm text-purple-300">
                                    {formatearSoles(gasto.monto)}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <BotonAccion
                                      icono={Pencil}
                                      texto="Editar"
                                      color="celeste"
                                      onClick={() => setModalGasto(gasto)}
                                    />
                                    <BotonAccion
                                      icono={Trash2}
                                      texto="Eliminar"
                                      color="rojo"
                                      onClick={() => setGastoAEliminar(gasto)}
                                    />
                                  </div>
                                </div>
                              </div>
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
                        {MESES[mes - 1]} {anio}
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
                              <div
                                key={gasto.id}
                                className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5"
                              >
                                <span className="pl-2 text-sm text-ink">{gasto.nombre}</span>
                                <div className="flex items-center gap-4">
                                  <span className="font-mono text-sm text-purple-300">
                                    {formatearSoles(gasto.monto)}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <BotonAccion
                                      icono={Pencil}
                                      texto="Editar"
                                      color="celeste"
                                      onClick={() => setModalGasto(gasto)}
                                    />
                                    <BotonAccion
                                      icono={Trash2}
                                      texto="Eliminar"
                                      color="rojo"
                                      onClick={() => setGastoAEliminar(gasto)}
                                    />
                                  </div>
                                </div>
                              </div>
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
          anioInicial={anio}
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
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
    </div>
  )
}
