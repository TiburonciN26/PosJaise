import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estiloNivelDeNegocio, nivelDeCupon } from '../../src/lib/cupones.js'

test('el nivel de negocio determina Plata/Oro/Diamante sin depender del valor', () => {
  for (const [nivel, categoria] of [['BASICO', 'plata'], ['PREMIUM', 'oro'], ['VIP', 'diamante']]) {
    for (const valor of [5, 500]) {
      assert.equal(nivelDeCupon({ origen: 'MONEDAS', nivel_minimo: nivel, valor }).categoria, categoria)
      assert.equal(estiloNivelDeNegocio(nivel).categoria, categoria)
    }
  }
})

test('las promociones son Oferta roja incluso con un nivel mínimo alto', () => {
  const nivel = nivelDeCupon({ origen: 'PROMOCION', nivel_minimo: 'VIP' })
  assert.equal(nivel.nombre, 'Oferta')
  assert.equal(nivel.categoria, 'oferta')
  assert.match(nivel.claseTarjeta, /cupon-n-rubi/)
})

test('bienvenida, referidos y fidelización son Especial verde', () => {
  for (const origen of ['REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA', 'FIDELIZACION']) {
    const nivel = nivelDeCupon({ origen, nivel_minimo: 'PREMIUM' })
    assert.equal(nivel.nombre, 'Especial')
    assert.equal(nivel.categoria, 'especial')
    assert.match(nivel.claseTarjeta, /cupon-n-verde/)
  }
})
