import { useId } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import { useToast } from '../context/ToastContext.jsx'
import { NOMBRES_DIA } from '../lib/horarioAtencion.js'
import Etiqueta from './Etiqueta.jsx'
import Interruptor from './Interruptor.jsx'
import SelectorHora from './SelectorHora.jsx'

// Editor de la semana: por día, un interruptor (abre / no abre) y 1 horario por defecto, con un segundo horario
// OPCIONAL («Agregar segundo horario»), p. ej. 10:00 a. m.-1:00 p. m. y 3:00 p. m.-8:30 p. m. Lo comparten:
//   · ModalHorarioAtencion — horario de atención de la web (Web › Contacto Web).
//   · ModalHorarioPos      — apertura y cierre automático del POS (menú de usuario).
// Estado: [{ dia, activo, turnos: [{ inicio, fin }] }] con horas "HH:MM" (24 h); se arma, valida y convierte con
// src/lib/turnosSemana.js.

// Propuesta al «Agregar segundo horario» (se ajusta a mano):
//   · si el horario abarca el mediodía (p. ej. 10:00-20:30) se parte en 10:00-13:00 y 15:00-20:30;
//   · si no, el segundo empieza 2 h después de que termina el primero y dura hasta las 8:30 p. m. (o 1 h).
function dividirEnDosTurnos(primero) {
  const aMin = (hora) => {
    const [h, m] = hora.split(':').map(Number)
    return h * 60 + m
  }
  const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  if (aMin(primero.inicio) < 13 * 60 && aMin(primero.fin) > 15 * 60) {
    return [{ inicio: primero.inicio, fin: '13:00' }, { inicio: '15:00', fin: primero.fin }]
  }
  const inicio = Math.min(aMin(primero.fin) + 120, 22 * 60)
  const fin = Math.max(20 * 60 + 30, Math.min(inicio + 60, 23 * 60 + 55))
  return [primero, { inicio: aHora(inicio), fin: aHora(fin) }]
}

// Clases completas por color de pestaña (Tailwind solo genera las que aparecen escritas tal cual).
const ACENTOS = {
  amber: { enlace: 'text-amber hover:text-amber/80' },
  'azul-metal': { enlace: 'text-azul-metal hover:text-azul-metal/80' },
}

export default function EditorTurnosSemana({
  dias,
  onCambiar,
  diaConError = null,
  deshabilitado = false,
  acento = 'amber',
  textoActivo = 'Abierto',
  textoInactivo = 'Cerrado',
}) {
  const idBase = useId()
  const { mostrarToast } = useToast()
  const colores = ACENTOS[acento] ?? ACENTOS.amber
  const diasActivos = dias.filter((d) => d.activo).length

  function cambiarDia(dia, cambio) {
    onCambiar(dias.map((d) => (d.dia === dia ? { ...d, ...cambio(d) } : d)))
  }

  function cambiarHora(dia, indice, campo, valor) {
    cambiarDia(dia, (d) => ({ turnos: d.turnos.map((t, i) => (i === indice ? { ...t, [campo]: valor } : t)) }))
  }

  function copiarALosDemas(origen) {
    const fuente = dias.find((d) => d.dia === origen)
    onCambiar(
      dias.map((d) => (d.activo && d.dia !== origen ? { ...d, turnos: fuente.turnos.map((t) => ({ ...t })) } : d)),
    )
    mostrarToast(`Horario del ${NOMBRES_DIA[origen].toLowerCase()} copiado a los demás días.`, 'exito')
  }

  return (
    // <fieldset disabled> apaga de una vez todos los interruptores, selectores y botones de adentro.
    <fieldset
      disabled={deshabilitado}
      className={`min-w-0 space-y-2 transition-opacity ${deshabilitado ? 'opacity-50' : ''}`}
    >
      {dias.map(({ dia, activo, turnos }) => {
        const nombre = NOMBRES_DIA[dia]
        return (
          <div
            key={dia}
            className={`rounded-lg border bg-surface-2 px-3 py-2.5 ${diaConError === dia ? 'border-red/60' : 'border-border'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-semibold ${activo ? 'text-ink' : 'text-ink/60'}`}>{nombre}</span>
              <button
                type="button"
                onClick={() => cambiarDia(dia, (d) => ({ activo: !d.activo }))}
                aria-pressed={activo}
                aria-label={`${nombre}: ${activo ? textoActivo : textoInactivo}`}
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-xs disabled:cursor-not-allowed"
              >
                <span className={activo ? 'text-green' : 'text-ink/60'}>{activo ? textoActivo : textoInactivo}</span>
                <Interruptor activado={activo} colorActivado="bg-green" />
              </button>
            </div>

            {activo && (
              <div className="mt-2 space-y-2">
                {turnos.map((turno, indice) => {
                  const idInicio = `${idBase}-${dia}-${indice}-inicio`
                  const sufijo = turnos.length > 1 ? ` ${indice + 1}` : ''
                  return (
                    <div key={indice} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Etiqueta obligatorio htmlFor={idInicio} className="block">
                          Horario{sufijo}
                        </Etiqueta>
                        {indice === 1 && (
                          <button
                            type="button"
                            onClick={() => cambiarDia(dia, (d) => ({ turnos: [d.turnos[0]] }))}
                            className="flex items-center gap-1 rounded-lg px-1 py-0.5 text-xs text-ink/60 transition-colors hover:text-red disabled:cursor-not-allowed"
                          >
                            <X className="h-3.5 w-3.5" />
                            Quitar
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <SelectorHora
                          id={idInicio}
                          valor={turno.inicio}
                          onCambiar={(valor) => cambiarHora(dia, indice, 'inicio', valor)}
                          etiqueta={`${nombre}, horario${sufijo}, desde`}
                          acento={acento}
                        />
                        <span className="text-xs text-ink/60">a</span>
                        <SelectorHora
                          valor={turno.fin}
                          onCambiar={(valor) => cambiarHora(dia, indice, 'fin', valor)}
                          etiqueta={`${nombre}, horario${sufijo}, hasta`}
                          acento={acento}
                        />
                      </div>
                    </div>
                  )
                })}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  {turnos.length < 2 ? (
                    <button
                      type="button"
                      onClick={() =>
                        cambiarDia(dia, (d) => ({ turnos: dividirEnDosTurnos(d.turnos[0]) }))
                      }
                      className={`flex items-center gap-1 rounded-lg px-1 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${colores.enlace}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Agregar segundo horario
                    </button>
                  ) : (
                    <span />
                  )}
                  {diasActivos > 1 && (
                    <button
                      type="button"
                      onClick={() => copiarALosDemas(dia)}
                      aria-label={`Copiar el horario del ${nombre.toLowerCase()} a los demás días`}
                      className="flex items-center gap-1 rounded-lg px-1 py-0.5 text-xs text-ink/60 transition-colors hover:text-ink disabled:cursor-not-allowed"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copiar a los demás
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
