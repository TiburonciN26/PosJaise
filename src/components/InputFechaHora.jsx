import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import CampoColapsable from './CampoColapsable.jsx'
import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useHorarioAtencionSemana } from '../hooks/useHorarioAtencionSemana.js'
import { turnosDelDia } from '../lib/horarioAtencion.js'
import { aInputDatetimeLima } from '../lib/fechas.js'
import {
  agruparHorarios,
  armarValor,
  celdasDelMes,
  claveFecha,
  diaDeLaSemana,
  etiquetaHora,
  horariosDelDia,
  minutosDePartes,
  moverMes,
  partesDeMinutos,
  partirValor,
  resumenFechaLarga,
  tituloMes,
} from '../lib/selectorFechaHora.js'

// Campo de fecha y hora: recibe las props de un <input type="datetime-local"> (`id`, `value`, `onChange(evento)` con
// `evento.target.value` = 'AAAA-MM-DDTHH:mm', hora de Lima).
//  · Escritorio: selector propio (diseño en docs/diseno-selector-fecha-hora/): un campo con la fecha escrita y la hora en 12 horas
//    que, al abrirse, despliega debajo un calendario en español y los horarios en botones de 30 minutos (Mañana / Tarde / Noche).
//    El navegador mostraba la hora en 24 horas según el sistema; este no depende de él.
//  · Táctil (celular): el <input type="datetime-local"> nativo (su selector ya muestra a. m. / p. m.). Chrome de Android le pone
//    una flecha «▾» propia que parecía un selector de lista: se quita (ver .input-fecha-hora en 05-interfaz-comun.css) y se
//    dibuja un calendario.
// `bloquearDiasPasados` (por defecto SÍ): no deja elegir días anteriores a hoy ni horas que ya pasaron hoy (Nueva y Editar cita;
// `resaltado` (opt-in, «Registrar atención» y Nueva/Editar cita): pinta el campo en ámbar (borde, fondo suave e íconos; el texto de la fecha y la hora sigue
// blanco), como los botones de Ventas al elegir cliente/servicio.
// «Registrar atención» lo apaga con `bloquearDiasPasados={false}` porque ahí sí se anota lo que se hizo ayer). La fecha ya guardada de una cita se conserva aunque sea pasada.
const CLASE_NATIVO =
  'input-fecha-hora w-full rounded-lg border border-border bg-surface-2 py-2 pl-3 pr-10 font-mono text-sm text-ink outline-none focus:border-purple-300'
const LETRAS_SEMANA = [
  ['L', 'lunes'],
  ['M', 'martes'],
  ['M', 'miércoles'],
  ['J', 'jueves'],
  ['V', 'viernes'],
  ['S', 'sábado'],
  ['D', 'domingo'],
]
// Días y horas que ya pasaron: gris apagado (el color del texto al 25 %, como en el prototipo). En línea para que ninguna regla global de
// botones lo pise.
const ESTILO_APAGADO = { color: 'color-mix(in srgb, var(--color-ink) 25%, transparent)' }
const CLASE_SELECT = 'rounded-md border border-border bg-bg px-1 py-1 text-xs text-ink outline-none focus:border-amber'

const mesDe = (fecha) => ({ anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) - 1 })

function SelectorPc({ id, value, onChange, bloquearDiasPasados, resaltado }) {
  const ahora = partirValor(aInputDatetimeLima(new Date()))
  const hoy = ahora.fecha
  const { fecha: fechaValor, minutos } = partirValor(value)
  const fecha = fechaValor || hoy

  const semana = useHorarioAtencionSemana()
  const [abierto, setAbierto] = useState(false)
  const [mesVista, setMesVista] = useState(() => mesDe(fecha))
  const contenedorRef = useRef(null)

  function cerrar() {
    setAbierto(false)
  }
  function alternar() {
    if (!abierto) setMesVista(mesDe(fecha))
    setAbierto(!abierto)
  }
  useCerrarConEscape(cerrar, abierto, { trabajoPendiente: false })

  // Tocar fuera del campo y del panel lo cierra.
  useEffect(() => {
    if (!abierto) return undefined
    function alPulsarFuera(evento) {
      if (!contenedorRef.current?.contains(evento.target)) setAbierto(false)
    }
    document.addEventListener('pointerdown', alPulsarFuera)
    return () => document.removeEventListener('pointerdown', alPulsarFuera)
  }, [abierto])

  // Al abrir, si el panel quedó fuera de la vista (el formulario se desplaza), se trae suavemente cuando termina de desplegarse.
  useEffect(() => {
    if (!abierto) return undefined
    const temporizador = setTimeout(
      () => contenedorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      320,
    )
    return () => clearTimeout(temporizador)
  }, [abierto])

  function emitir(nuevaFecha, nuevosMinutos) {
    onChange({ target: { value: armarValor(nuevaFecha, nuevosMinutos) } })
  }

  const diaSemana = diaDeLaSemana(fecha)
  const horarios = horariosDelDia(turnosDelDia(semana, diaSemana === 0 ? 7 : diaSemana), minutos)
  const grupos = agruparHorarios(horarios)
  const mesHoy = mesDe(hoy)
  const sinMesAnterior = bloquearDiasPasados && mesVista.anio * 12 + mesVista.mes <= mesHoy.anio * 12 + mesHoy.mes
  const hora = etiquetaHora(minutos)
  const otra = partesDeMinutos(minutos)

  return (
    <div ref={contenedorRef}>
      <button
        id={id}
        type="button"
        onClick={alternar}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors hover:border-border-strong ${
          resaltado ? 'bg-amber/10 text-ink' : 'bg-surface-2 text-ink'
        } ${abierto || resaltado ? 'border-amber' : 'border-border'}`}
      >
        <Calendar aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-amber" />
        <span className="min-w-0 flex-1 truncate font-medium">{resumenFechaLarga(fecha)}</span>
        <span className={`flex shrink-0 items-center gap-1.5 font-mono text-xs ${resaltado ? 'text-ink' : 'text-amber'}`}>
          <Clock aria-hidden="true" className={`h-[15px] w-[15px] ${resaltado ? 'text-amber' : ''}`} />
          {hora.texto}
        </span>
        <IconoFlechaDesplegable
          className={`h-3 w-3 shrink-0 text-ink transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      <CampoColapsable abierto={abierto} margen diferido>
        <div
          role="dialog"
          aria-label="Elegir fecha y hora"
          className="flex gap-2.5 rounded-lg border border-border-strong bg-surface-2 p-3"
        >
          {/* Calendario */}
          <div className="w-[196px] shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Mes anterior"
                disabled={sinMesAnterior}
                onClick={() => setMesVista(moverMes(mesVista, -1))}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-3 disabled:cursor-default disabled:text-ink/25 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
                {tituloMes(mesVista.anio, mesVista.mes)}
              </span>
              <button
                type="button"
                aria-label="Mes siguiente"
                onClick={() => setMesVista(moverMes(mesVista, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-3"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-1.5 grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-ink/60">
              {LETRAS_SEMANA.map(([letra, nombre]) => (
                <abbr key={nombre} title={nombre} className="no-underline">
                  {letra}
                </abbr>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {celdasDelMes(mesVista.anio, mesVista.mes).map((dia, indice) => {
                if (dia === null) return <span key={`hueco-${indice}`} aria-hidden="true" className="h-7" />
                const clave = claveFecha(mesVista.anio, mesVista.mes, dia)
                const esElegido = clave === fecha
                const esHoy = clave === hoy
                const pasado = bloquearDiasPasados && clave < hoy
                return (
                  <button
                    key={clave}
                    type="button"
                    disabled={pasado}
                    aria-pressed={esElegido}
                    aria-label={`${resumenFechaLarga(clave)}${esHoy ? ' (hoy)' : ''}`}
                    onClick={() => emitir(clave, minutos)}
                    style={pasado && !esElegido ? ESTILO_APAGADO : undefined}
                    className={`h-7 rounded-md border text-xs transition-colors ${
                      esElegido
                        ? 'border-amber bg-amber font-bold text-bg'
                        : esHoy
                          ? 'border-amber font-bold text-amber hover:bg-surface-3'
                          : pasado
                            ? 'cursor-default border-transparent'
                            : 'border-transparent text-ink hover:bg-surface-3'
                    }`}
                  >
                    {dia}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setMesVista(mesDe(hoy))
                emitir(hoy, minutos)
              }}
              className="mt-1 px-1 py-1.5 text-xs font-semibold text-amber transition-colors hover:text-amber/80"
            >
              Ir a hoy
            </button>
          </div>

          <div aria-hidden="true" className="w-px shrink-0 bg-border" />

          {/* Horarios */}
          <div className="min-w-0 flex-1">
            <div className="space-y-2.5">
              {grupos.map((grupo) => (
                <div key={grupo.titulo}>
                  <p className="mb-1 text-[11px] font-semibold text-ink/60">
                    {grupo.titulo} <span className="text-amber">· {grupo.sub}</span>
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    {grupo.items.map((min) => {
                      const esElegida = min === minutos
                      const pasada = bloquearDiasPasados && fecha === hoy && min <= ahora.minutos && !esElegida
                      const etiqueta = etiquetaHora(min)
                      return (
                        <button
                          key={min}
                          type="button"
                          disabled={pasada}
                          aria-pressed={esElegida}
                          aria-label={etiqueta.texto}
                          style={pasada ? ESTILO_APAGADO : undefined}
                          onClick={() => {
                            emitir(fecha, min)
                            cerrar()
                          }}
                          className={`h-7 rounded-md border font-mono text-[11px] transition-colors ${
                            esElegida
                              ? 'border-amber bg-amber font-bold text-bg'
                              : pasada
                                ? 'cursor-default border-border bg-bg'
                                : 'border-border bg-bg text-ink hover:bg-surface-3'
                          }`}
                        >
                          {etiqueta.hora}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Para una hora que no cae en los botones de 30 minutos (p. ej. 10:15). */}
            <div className="mt-2.5 border-t border-border pt-2">
              <p className="mb-1 text-[11px] font-semibold text-ink/60">Otra hora</p>
              <div className="flex items-center gap-1">
                <select
                  aria-label="Hora"
                  value={otra.hora12}
                  onChange={(evento) => emitir(fecha, minutosDePartes({ ...otra, hora12: evento.target.value }))}
                  className={CLASE_SELECT}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true" className="text-ink/60">
                  :
                </span>
                <select
                  aria-label="Minutos"
                  value={otra.minuto}
                  onChange={(evento) => emitir(fecha, minutosDePartes({ ...otra, minuto: evento.target.value }))}
                  className={CLASE_SELECT}
                >
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="a. m. o p. m."
                  value={otra.ampm}
                  onChange={(evento) => emitir(fecha, minutosDePartes({ ...otra, ampm: evento.target.value }))}
                  className={CLASE_SELECT}
                >
                  <option value="AM">a. m.</option>
                  <option value="PM">p. m.</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </CampoColapsable>
    </div>
  )
}

export default function InputFechaHora({ id, value, onChange, className = '', bloquearDiasPasados = true, resaltado = false }) {
  const [esTactil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  if (!esTactil) {
    return <SelectorPc id={id} value={value} onChange={onChange} bloquearDiasPasados={bloquearDiasPasados} resaltado={resaltado} />
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={onChange}
        className={`${CLASE_NATIVO} ${resaltado ? 'border-amber bg-amber/10' : ''} ${className}`}
      />
      <Calendar aria-hidden="true" className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${resaltado ? 'text-amber' : 'text-ink'}`} />
    </div>
  )
}
