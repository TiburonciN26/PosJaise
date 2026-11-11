// Gestión de cuentas de personal desde el navegador (pestaña «Personal», solo ADMINISTRADOR).
//
// Crear la cuenta de acceso, bloquearla o cambiar su contraseña exige el service_role de Supabase, que
// jamás va al navegador: eso lo hace la Edge Function `gestionar-personal` (verifica que quien llama sea
// ADMINISTRADOR). La lista sale de la RPC `personal_listar` (usuarios + último ingreso + bloqueo + ficha).
//
// Estas funciones no lanzan: devuelven { ok, error?, ...datos } y quien las llama decide qué mostrar.

import { supabase } from './supabase.js'

export const ROLES_PERSONAL = [
  { id: 'ADMINISTRADOR', label: 'Administrador', detalle: 'Ve y hace todo.' },
  { id: 'ENCARGADA', label: 'Encargada', detalle: 'Vende y atiende: caja + su Mi Panel.' },
  { id: 'CAJERA', label: 'Cajera', detalle: 'Ventas, inventario básico y gastos.' },
  { id: 'ASISTENTE', label: 'Asistente', detalle: 'Citas y su Mi Panel de pagos.' },
]

export const ETIQUETA_ROL = Object.fromEntries(ROLES_PERSONAL.map((rol) => [rol.id, rol.label]))

// Roles que atienden servicios y por eso necesitan ficha (comisión, citas, Mi Panel).
export const ROLES_CON_FICHA = ['ASISTENTE', 'ENCARGADA']

export const MIN_PASSWORD = 8

const CLAVES_COMUNES = new Set([
  'password',
  'password1',
  'contrasena',
  'contrasena1',
  'qwertyui',
  'qwerty123',
  'asdfghjk',
  'zxcvbnm1',
  'iloveyou',
  'admin123',
  'administrador',
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '00000000',
  '12341234',
  '12312312',
])

// Rechaza claves demasiado fáciles de adivinar (todo igual, secuencias como 12345678 o abcdefgh, patrones cortos
// repetidos como 12121212 y las más comunes). Devuelve el mensaje de error o null si la clave sirve. La Edge
// Function `gestionar-personal` repite esta misma regla (es la que manda); aquí solo adelanta el aviso.
export function validarPassword(valor) {
  if (typeof valor !== 'string' || valor.length < MIN_PASSWORD) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
  }
  const minusculas = valor.toLowerCase()
  const codigos = Array.from(minusculas, (c) => c.charCodeAt(0))
  const pasos = codigos.slice(1).map((c, i) => c - codigos[i])
  const esSecuencia = pasos.every((p) => p === 1) || pasos.every((p) => p === -1)
  const esPatronCorto = /^(.{1,3})\1+$/.test(minusculas)
  if (esSecuencia || esPatronCorto || CLAVES_COMUNES.has(minusculas)) {
    return 'Esa contraseña es muy fácil de adivinar (por ejemplo 12345678). Usa «Generar» o mezcla letras y números.'
  }
  return null
}

async function leerCuerpoError(error) {
  try {
    return await error.context.json()
  } catch {
    return null
  }
}

async function invocar(cuerpo) {
  let data
  let error
  try {
    ;({ data, error } = await supabase.functions.invoke('gestionar-personal', { body: cuerpo }))
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' }
  }
  if (error) {
    const detalle = await leerCuerpoError(error)
    return { ok: false, error: detalle?.error ?? 'No se pudo completar la acción. Intenta de nuevo.' }
  }
  return { ok: true, ...(data ?? {}) }
}

export async function listarPersonal() {
  const { data, error } = await supabase.rpc('personal_listar')
  if (error) return { ok: false, error: 'No se pudo cargar el personal.', filas: [] }
  return { ok: true, filas: data ?? [] }
}

export const crearPersona = ({ email, nombre, rol, password, tambienAtiende }) =>
  invocar({ accion: 'crear', email, nombre_completo: nombre, rol, password, tambien_atiende: tambienAtiende })

export const actualizarPersona = ({ id, nombre, rol }) =>
  invocar({ accion: 'actualizar', id, nombre_completo: nombre, rol })

export const bloquearPersona = (id) => invocar({ accion: 'bloquear', id })

export const desbloquearPersona = (id) => invocar({ accion: 'desbloquear', id })

export const restablecerPassword = (id, password) => invocar({ accion: 'restablecer_password', id, password })

// Contraseña inicial legible y sin caracteres ambiguos (sin 0/O, 1/l/I). Usa crypto, no Math.random.
export function generarPassword(largo = 10) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const numeros = '23456789'
  const todos = letras + numeros
  const bytes = new Uint32Array(largo)
  crypto.getRandomValues(bytes)
  const caracteres = Array.from(bytes, (b) => todos[b % todos.length])
  // Garantiza al menos un número para cumplir políticas de contraseña habituales.
  if (!/\d/.test(caracteres.join(''))) caracteres[largo - 1] = numeros[bytes[0] % numeros.length]
  return caracteres.join('')
}

// Una cuenta está bloqueada si la fila está inactiva o Auth la tiene baneada hacia el futuro.
export function estaBloqueada(fila) {
  if (!fila.activo) return true
  return Boolean(fila.bloqueada_hasta && new Date(fila.bloqueada_hasta) > new Date())
}
