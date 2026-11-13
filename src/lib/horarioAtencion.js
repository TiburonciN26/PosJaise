import { formatearDias, formatearHora } from './contactoNegocio.js'

// Horario de atención POR DÍA (horario_semanal, migración 20261112000004): cada día ISO (1 = lunes … 7 = domingo) tiene
// 0 turnos (cerrado), 1 o 2. Lo edita la administradora desde su menú de usuario (ModalHorarioAtencion.jsx) y lo leen
// la web (Inicio, pie, Nosotros, Citas, carritos) y el servidor al validar citas y pedidos.

export const NOMBRES_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

// '10:00:00' → '10:00' (lo que entiende <input type="time"> y lo que se compara en la web).
function horaCorta(horaSql) {
  return horaSql ? horaSql.slice(0, 5) : null
}

// Filas de horario_atencion_semanal() → 7 días siempre presentes y ordenados: [{ dia, turnos: [{ inicio, fin }] }].
export function normalizarSemana(filas) {
  const porDia = new Map((filas ?? []).map((fila) => [Number(fila.dia), fila]))
  return Array.from({ length: 7 }, (_, i) => {
    const dia = i + 1
    const fila = porDia.get(dia)
    const turnos = []
    if (fila?.bloque1_inicio && fila?.bloque1_fin) {
      turnos.push({ inicio: horaCorta(fila.bloque1_inicio), fin: horaCorta(fila.bloque1_fin) })
      if (fila.bloque2_inicio && fila.bloque2_fin) {
        turnos.push({ inicio: horaCorta(fila.bloque2_inicio), fin: horaCorta(fila.bloque2_fin) })
      }
    }
    return { dia, turnos }
  })
}

export function hayDiasAbiertos(semana) {
  return Boolean(semana?.some((d) => d.turnos.length > 0))
}

// Turnos del día ISO pedido ([] = cerrado o semana aún sin cargar).
export function turnosDelDia(semana, isodow) {
  return semana?.find((d) => d.dia === isodow)?.turnos ?? []
}

export function textoTurnos(turnos, { separador = ' - ', union = ' y ' } = {}) {
  return turnos.map((t) => `${formatearHora(t.inicio)}${separador}${formatearHora(t.fin)}`).join(union)
}

// Agrupa los días ABIERTOS que comparten exactamente los mismos turnos, en orden de semana:
//   [{ dias: 'Lunes a Viernes', turnos }, { dias: 'Sábado', turnos }, …]
// (formatearDias ya junta los días seguidos con «a» y separa con comas los sueltos).
export function agruparHorario(semana) {
  const grupos = new Map()
  for (const { dia, turnos } of semana ?? []) {
    if (turnos.length === 0) continue
    const clave = turnos.map((t) => `${t.inicio}-${t.fin}`).join('|')
    if (!grupos.has(clave)) grupos.set(clave, { listaDias: [], turnos })
    grupos.get(clave).listaDias.push(dia)
  }
  return [...grupos.values()].map(({ listaDias, turnos }) => ({ dias: formatearDias(listaDias), turnos }))
}

// Una sola línea para textos de ayuda («Atendemos …»): «Lunes a Viernes 10:00 a. m.-1:00 p. m. y 3:00 p. m.-8:30 p. m.
// · Sábado 10:00 a. m.-2:00 p. m.».
export function textoHorarioEnLinea(semana) {
  return agruparHorario(semana)
    .map((g) => `${g.dias} ${textoTurnos(g.turnos, { separador: '-' })}`)
    .join(' · ')
}

// Horas para elegir en un día (pedidos web): cada `pasoMin` desde el inicio de cada turno; la hora de cierre no se
// ofrece (mismo criterio que el selector fijo que había antes).
export function horasDelDia(turnos, pasoMin = 60) {
  const horas = []
  for (const { inicio, fin } of turnos) {
    const [hi, mi] = inicio.split(':').map(Number)
    const [hf, mf] = fin.split(':').map(Number)
    for (let minutos = hi * 60 + mi; minutos < hf * 60 + mf; minutos += pasoMin) {
      horas.push(`${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`)
    }
  }
  return horas
}
