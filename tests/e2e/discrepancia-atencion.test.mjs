// Discrepancia de una atención (src/lib/discrepanciaAtencion.js): qué discrepancia se muestra y en qué estado está la manito para
// cada parte. Sin base de datos ni navegador:  node --test tests/e2e/discrepancia-atencion.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discrepanciaDe, estadoAcuerdo } from '../../src/lib/discrepanciaAtencion.js'

const d = (extra) => ({ id: 'd', creada_en: '2026-11-20T10:00:00Z', admin_acuerdo_en: null, duena_acuerdo_en: null, resuelta_en: null, retirada_en: null, ...extra })

test('sin discrepancias no hay nada que mostrar', () => {
  assert.equal(discrepanciaDe(null), null)
  assert.equal(discrepanciaDe({}), null)
  assert.equal(discrepanciaDe({ registro_discrepancias: [] }), null)
  assert.equal(discrepanciaDe({ registro_discrepancias: null }), null)
})

test('una discrepancia retirada no se muestra', () => {
  assert.equal(discrepanciaDe({ registro_discrepancias: [d({ retirada_en: '2026-11-20T11:00:00Z' })] }), null)
})

test('la abierta manda sobre las resueltas anteriores', () => {
  const r = { registro_discrepancias: [d({ id: 'vieja', resuelta_en: '2026-11-01T10:00:00Z' }), d({ id: 'nueva' })] }
  const x = discrepanciaDe(r)
  assert.equal(x.id, 'nueva')
  assert.equal(x.abierta, true)
})

test('sin abierta, se muestra la última resuelta como constancia', () => {
  const r = {
    registro_discrepancias: [
      d({ id: 'a', resuelta_en: '2026-11-01T10:00:00Z' }),
      d({ id: 'b', resuelta_en: '2026-11-15T10:00:00Z' }),
      d({ id: 'c', retirada_en: '2026-11-18T10:00:00Z' }),
    ],
  }
  const x = discrepanciaDe(r)
  assert.equal(x.id, 'b')
  assert.equal(x.abierta, false)
})

test('manito: nadie confirmó → pendiente para las dos partes', () => {
  const x = discrepanciaDe({ registro_discrepancias: [d()] })
  assert.deepEqual(estadoAcuerdo(x, true), { estado: 'pendiente', yoConfirme: false, otroConfirmo: false })
  assert.deepEqual(estadoAcuerdo(x, false), { estado: 'pendiente', yoConfirme: false, otroConfirmo: false })
})

test('manito: confirma la administradora → «enviado» para ella y «falta la mía» para la trabajadora', () => {
  const x = discrepanciaDe({ registro_discrepancias: [d({ admin_acuerdo_en: '2026-11-20T12:00:00Z' })] })
  assert.deepEqual(estadoAcuerdo(x, false), { estado: 'parcial', yoConfirme: true, otroConfirmo: false })
  assert.deepEqual(estadoAcuerdo(x, true), { estado: 'parcial', yoConfirme: false, otroConfirmo: true })
})

test('manito: si confirma primero la trabajadora, se invierte (el orden no importa)', () => {
  const x = discrepanciaDe({ registro_discrepancias: [d({ duena_acuerdo_en: '2026-11-20T12:00:00Z' })] })
  assert.deepEqual(estadoAcuerdo(x, true), { estado: 'parcial', yoConfirme: true, otroConfirmo: false })
  assert.deepEqual(estadoAcuerdo(x, false), { estado: 'parcial', yoConfirme: false, otroConfirmo: true })
})

test('manito: acuerdo de las dos partes → resuelto para ambas', () => {
  const x = discrepanciaDe({
    registro_discrepancias: [d({ admin_acuerdo_en: '2026-11-20T12:00:00Z', duena_acuerdo_en: '2026-11-20T12:05:00Z', resuelta_en: '2026-11-20T12:05:00Z' })],
  })
  assert.equal(estadoAcuerdo(x, true).estado, 'resuelto')
  assert.equal(estadoAcuerdo(x, false).estado, 'resuelto')
})

test('sin discrepancia el estado es «ninguna»', () => {
  assert.equal(estadoAcuerdo(null, true).estado, 'ninguna')
})
