// Todos los rangos de fecha ("hoy", "esta semana", "este mes") se calculan
// fijados a la zona horaria del negocio (America/Lima, UTC-5 todo el año —
// Perú no usa horario de verano), no a la hora/zona del dispositivo. Antes
// se usaban los getters/setters locales de Date (getHours, setDate,
// getFullYear...), que dependen de cómo esté configurado el reloj del
// celular: un celular con la zona horaria mal puesta filtraba "hoy" con un
// corte de día corrido. Acá se opera todo el tiempo sobre getUTC*/setUTC*
// más un desplazamiento fijo, así el resultado no depende del dispositivo.
const OFFSET_LIMA_MS = 5 * 60 * 60 * 1000

// Traslada un instante real a uno "falso" cuyos getUTC* devuelven los mismos
// valores que un reloj de pared en Lima (ej. para leer año/mes/día/día de
// semana "como los vería alguien en Lima"). Se exporta como escape hatch
// para pantallas que necesitan leer alguna otra parte de la fecha en hora de
// Lima sin sumar un helper nuevo para cada combinación.
export function aLima(fecha) {
  return new Date(fecha.getTime() - OFFSET_LIMA_MS)
}

// Inversa de aLima: vuelve del instante "falso" al instante UTC real.
function deLima(fechaLima) {
  return new Date(fechaLima.getTime() + OFFSET_LIMA_MS)
}

// Día de semana (0 = domingo) tal como cae en Lima, no en la zona horaria
// del dispositivo — para no contar un domingo como día hábil (o viceversa)
// solo porque el celular tiene mal la hora.
export function diaSemanaLima(fecha) {
  return aLima(fecha).getUTCDay()
}

export function iniciarDia(fecha) {
  const enLima = aLima(fecha)
  enLima.setUTCHours(0, 0, 0, 0)
  return deLima(enLima)
}

// Suma/resta días como aritmética pura de milisegundos: al no haber horario
// de verano en Lima, "sumar N días" es siempre exactamente N*24h, sin
// depender de ningún reloj/zona horaria (a diferencia de setDate/getDate).
export function sumarDias(fecha, dias) {
  return new Date(fecha.getTime() + dias * 24 * 60 * 60 * 1000)
}

// Convierte un string "YYYY-MM-DD" (como el que guardan los <input
// type="date">) al instante UTC real de la medianoche de ese día en Lima —
// sin pasar por new Date(`${iso}T00:00:00`), que interpreta la hora en la
// zona horaria del dispositivo.
export function parsearFechaISOLima(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number)
  return deLima(new Date(Date.UTC(anio, mes - 1, dia)))
}

export function calcularRango(filtro, personalizado) {
  const hoy = iniciarDia(new Date())

  if (filtro === 'semana') {
    const diaSemana = diaSemanaLima(hoy)
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1
    const lunes = sumarDias(hoy, -diasDesdeLunes)
    return { desde: lunes, hasta: sumarDias(lunes, 7) }
  }

  if (filtro === 'mes') {
    const enLima = aLima(hoy)
    const inicioMes = deLima(new Date(Date.UTC(enLima.getUTCFullYear(), enLima.getUTCMonth(), 1)))
    const inicioMesSiguiente = deLima(
      new Date(Date.UTC(enLima.getUTCFullYear(), enLima.getUTCMonth() + 1, 1)),
    )
    return { desde: inicioMes, hasta: inicioMesSiguiente }
  }

  if (filtro === 'personalizado') {
    const desde = personalizado.desde ? parsearFechaISOLima(personalizado.desde) : hoy
    const hastaBase = personalizado.hasta ? parsearFechaISOLima(personalizado.hasta) : hoy
    return { desde, hasta: sumarDias(hastaBase, 1) }
  }

  // 'hoy'
  return { desde: hoy, hasta: sumarDias(hoy, 1) }
}

export function formatearFechaISO(fecha) {
  const enLima = aLima(fecha)
  const anio = enLima.getUTCFullYear()
  const mes = String(enLima.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(enLima.getUTCDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

// Para pantallas que necesitan derivar más rangos a partir de uno ya
// calculado (ej. "período anterior" en Estadísticas) sin repetir el
// desplazamiento a mano.
export function anioMesEnLima(fecha) {
  const enLima = aLima(fecha)
  return { anio: enLima.getUTCFullYear(), mes: enLima.getUTCMonth() }
}

export function iniciarMesLima(anio, mesIndiceCero) {
  return deLima(new Date(Date.UTC(anio, mesIndiceCero, 1)))
}

// Clave estable para agrupar filas por día calendario en Lima (ej. el
// listado de Auditoría/Mi Panel, agrupado por día) — antes se agrupaba con
// getFullYear/getMonth/getDate locales, que podían mandar una fila de las
// 11pm al grupo del día siguiente en un dispositivo con otra zona horaria.
export function claveDiaLima(fecha) {
  const enLima = aLima(fecha)
  return `${enLima.getUTCFullYear()}-${enLima.getUTCMonth()}-${enLima.getUTCDate()}`
}
