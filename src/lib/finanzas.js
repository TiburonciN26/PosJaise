// A2 de la auditoría técnica: Dashboard y Estadísticas mostraban "Ganancia
// final" distinta para el mismo período — cada pantalla tenía su propia
// copia de la cascada, y además Estadísticas solo restaba los gastos del
// mes cuando el filtro era "Este mes" (0 en los demás), mientras Dashboard
// ya los prorrateaba en Hoy/Semana/Personalizado. Este módulo es la única
// fuente de verdad para ambas pantallas.
import { diaSemanaLima, sumarDias } from './fechas.js'
import { redondear2 } from './moneda.js'

function diasHabilesDelMes(anio, mesIndiceCero) {
  const diasEnMes = new Date(anio, mesIndiceCero + 1, 0).getDate()
  let habiles = 0
  for (let dia = 1; dia <= diasEnMes; dia++) {
    if (new Date(anio, mesIndiceCero, dia).getDay() !== 0) habiles++
  }
  return habiles
}

function diasHabilesEnRango(desde, hastaExclusiva) {
  let habiles = 0
  for (let cursor = new Date(desde); cursor < hastaExclusiva; cursor = sumarDias(cursor, 1)) {
    if (diaSemanaLima(cursor) !== 0) habiles++
  }
  return habiles
}

// Los gastos fijos + variables del mes de referencia (el mes donde empieza
// el período evaluado) se prorratean para que Hoy/Semana/Personalizado
// también carguen su parte proporcional — "Este mes" usa el total tal cual.
// Los domingos (negocio cerrado) no cuentan como día hábil al prorratear.
export function calcularGastosProrrateados({ filtro, gastosMesTotal, anio, mes, desde, hasta }) {
  if (filtro === 'mes') return gastosMesTotal
  if (filtro === 'semana') return gastosMesTotal / 4

  const habilesDelMes = diasHabilesDelMes(anio, mes)
  const gastoDiario = habilesDelMes > 0 ? gastosMesTotal / habilesDelMes : 0

  if (filtro === 'personalizado') {
    return gastoDiario * diasHabilesEnRango(desde, hasta)
  }

  // 'hoy'
  return diaSemanaLima(desde) === 0 ? 0 : gastoDiario
}

// Única cascada de ganancia, usada por Dashboard y Estadísticas:
// 1. Ingreso bruto → 2. −10% gastos operativos (estimado, sobre el ingreso
// bruto) → 3. −Costo de productos → 4. −Comisión pagada a asistentes →
// 5. −Gastos reales del período (prorrateados) = Utilidad neta →
// 6. −10% diezmo (sobre la utilidad neta) = Ganancia final.
//
// comisionesPagadas es lo que la asistente se lleva (pago_asistente), no lo
// que gana el admin sobre lo suyo — un admin registrando su propia atención
// se queda con el 100% líquido, así que eso nunca debe restarse acá (ver
// comisiones_pagadas en resumen_dashboard/resumen_estadisticas, que ya
// excluye esas filas por rol).
export function calcularCascadaGanancia({
  ingresoBruto,
  costoProductos,
  comisionesPagadas = 0,
  gastosMes,
}) {
  const gastosOperativos = redondear2(ingresoBruto * 0.1)
  const saldoTrasOperativos = ingresoBruto - gastosOperativos
  const saldoTrasCosto = saldoTrasOperativos - costoProductos
  const saldoTrasComisiones = saldoTrasCosto - comisionesPagadas
  const utilidadNeta = saldoTrasComisiones - gastosMes
  const montoDiezmo = redondear2(utilidadNeta * 0.1)
  const gananciaFinal = redondear2(utilidadNeta - montoDiezmo)
  const metaEquilibrio = redondear2(gastosOperativos + costoProductos + comisionesPagadas + gastosMes)

  return {
    gastosOperativos,
    saldoTrasOperativos,
    saldoTrasCosto,
    saldoTrasComisiones,
    utilidadNeta,
    montoDiezmo,
    gananciaFinal,
    metaEquilibrio,
  }
}
