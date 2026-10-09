// Lógica pura del destino tras iniciar sesión (src/lib/destinoLogin.js). Sin base de datos ni navegador:
//   node --test tests/e2e/destino-login.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esRutaDePersonal, resolverDestino, rutaInternaSegura } from '../../src/lib/destinoLogin.js';

test('rutaInternaSegura: solo rutas internas absolutas y nunca el login', () => {
  assert.equal(rutaInternaSegura('/mi-perfil'), '/mi-perfil');
  assert.equal(rutaInternaSegura('/productos/abc?x=1'), '/productos/abc?x=1');
  for (const mala of [undefined, null, 42, '', 'mi-perfil', '//otro.sitio', 'https://otro.sitio', '/\\otro', '/login', '/login?modo=registro']) {
    assert.equal(rutaInternaSegura(mala), null, String(mala));
  }
});

test('resolverDestino CLIENTE: vuelve a la ruta pedida y, sin ella, a Inicio', () => {
  assert.equal(resolverDestino('CLIENTE', '/mi-perfil/pedidos'), '/mi-perfil/pedidos');
  assert.equal(resolverDestino('CLIENTE', '/productos/abc'), '/productos/abc');
  assert.equal(resolverDestino('CLIENTE', undefined), '/inicio');
  assert.equal(resolverDestino('CLIENTE', '//otro.sitio'), '/inicio');
  assert.equal(resolverDestino('CLIENTE', 'https://otro.sitio'), '/inicio');
});

test('resolverDestino personal: solo pantallas del POS que su rol puede abrir; si no, su panel', () => {
  assert.equal(resolverDestino('ADMINISTRADOR', '/inventario'), '/inventario');
  assert.equal(resolverDestino('CAJERA', '/inventario'), '/inventario');
  assert.equal(resolverDestino('ASISTENTE', '/inventario'), '/mi-panel');
  assert.equal(resolverDestino('CAJERA', '/dashboard'), '/ventas');
  // Una página de la web no existe en el POS: cae en la pantalla inicial del rol.
  assert.equal(resolverDestino('ADMINISTRADOR', '/servicios/abc'), '/ventas');
  assert.equal(resolverDestino('ASISTENTE', '/mi-perfil'), '/mi-panel');
  assert.equal(resolverDestino('ADMINISTRADOR', undefined), '/ventas');
  assert.equal(resolverDestino('ASISTENTE', undefined), '/mi-panel');
});

test('esRutaDePersonal: reconoce pantallas del POS, con o sin consulta y barra final', () => {
  assert.equal(esRutaDePersonal('/ventas'), true);
  assert.equal(esRutaDePersonal('/dashboard?x=1'), true);
  assert.equal(esRutaDePersonal('/ventas/'), true);
  assert.equal(esRutaDePersonal('/inicio'), false);
  assert.equal(esRutaDePersonal('/mi-perfil'), false);
  assert.equal(esRutaDePersonal('//ventas'), false);
});
