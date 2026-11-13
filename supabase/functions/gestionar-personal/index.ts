// Gestión de cuentas de personal (pestaña «Personal» del POS). Solo ADMINISTRADOR.
//
// Entrada: POST { accion, ... } con el JWT de la administradora (verify_jwt activo).
//   crear              { email, nombre_completo, rol, password, tambien_atiende? }
//   actualizar         { id, nombre_completo?, rol? }
//   bloquear           { id }
//   desbloquear        { id }
//   restablecer_password { id, password }
//
// Reglas de seguridad:
//   * El llamador debe ser ADMINISTRADOR activo (rol_actual() con SU JWT). Si no: 403.
//   * El service_role se usa SOLO para auth.admin.* (crear la cuenta, banear, cambiar contraseña), que el
//     navegador no puede hacer. Todo lo demás (filas de `usuarios` y `asistentes`) se escribe con el JWT de la
//     administradora: la RLS vuelve a exigirle ser admin y los triggers de auditoría registran QUIÉN lo hizo.
//   * El rol se valida contra una lista blanca; nunca se toma tal cual del cuerpo.
//   * No se borran cuentas (ventas.vendedor_id es FK restrict): se BLOQUEAN. El trigger de la BD
//     `proteger_ultimo_administrador` impide dejar el sistema sin administradores activos.
//   * Las contraseñas nunca se escriben en logs ni en respuestas.
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLES = ['ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA', 'PERSONAL_APOYO'] as const
type Rol = (typeof ROLES)[number]
// Roles que atienden servicios y por eso llevan ficha en `asistentes` (comisión, citas, Mi Panel). La ficha del
// PERSONAL_APOYO sirve para su comisión; no sale como profesional en citas (migración rol_personal_apoyo).
const ROLES_CON_FICHA: Rol[] = ['ASISTENTE', 'ENCARGADA', 'PERSONAL_APOYO']
// ~100 años: el baneo de Auth es una duración, no un booleano.
const BAN_PERMANENTE = '876000h'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function responder(cuerpo: Record<string, unknown>, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function esRol(v: unknown): v is Rol {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v)
}

// Misma regla que `validarPassword` de src/lib/personal.js (aquí es la que manda; el front solo adelanta el aviso):
// además del largo, rechaza claves obvias (todo igual, secuencias, patrones cortos repetidos y las más comunes).
const CLAVES_COMUNES = new Set([
  'password', 'password1', 'contrasena', 'contrasena1', 'qwertyui', 'qwerty123', 'asdfghjk', 'zxcvbnm1',
  'iloveyou', 'admin123', 'administrador', '12345678', '123456789', '1234567890', '87654321', '11111111',
  '00000000', '12341234', '12312312',
])

function validarPassword(v: unknown): string | null {
  if (typeof v !== 'string') return 'La contraseña es obligatoria.'
  if (v.length < 8) return 'La contraseña debe tener al menos 8 caracteres.'
  if (v.length > 72) return 'La contraseña no puede pasar de 72 caracteres.'
  const minusculas = v.toLowerCase()
  const codigos = Array.from(minusculas, (c) => c.charCodeAt(0))
  const pasos = codigos.slice(1).map((c, i) => c - codigos[i])
  const esSecuencia = pasos.every((p) => p === 1) || pasos.every((p) => p === -1)
  const esPatronCorto = /^(.{1,3})\1+$/.test(minusculas)
  if (esSecuencia || esPatronCorto || CLAVES_COMUNES.has(minusculas)) {
    return 'Esa contraseña es muy fácil de adivinar (por ejemplo 12345678). Usa una más difícil.'
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('gestionar-personal: faltan variables de entorno de Supabase')
    return responder({ error: 'Servicio no configurado.' }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return responder({ error: 'Sesión no válida.' }, 401)

  // Cliente con el JWT de la administradora: RLS y auditoría la tratan como a ella.
  const comoAdmin = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: dataUsuaria, error: errUsuaria } = await comoAdmin.auth.getUser()
  if (errUsuaria || !dataUsuaria?.user) return responder({ error: 'Sesión no válida.' }, 401)
  const yoId = dataUsuaria.user.id

  const { data: rolLlamador, error: errRol } = await comoAdmin.rpc('rol_actual')
  if (errRol) return responder({ error: 'No se pudo verificar el rol.' }, 500)
  if (rolLlamador !== 'ADMINISTRADOR') {
    return responder({ error: 'Solo el administrador puede gestionar el personal.' }, 403)
  }

  // Solo para auth.admin.*
  const servicio = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await req.json()
  } catch {
    return responder({ error: 'Solicitud no válida.' }, 400)
  }
  const accion = texto(cuerpo.accion)

  // ---------------------------------------------------------------------------------------------
  // Utilidades sobre la ficha de asistente
  // ---------------------------------------------------------------------------------------------
  async function fichaDe(usuarioId: string) {
    const { data } = await comoAdmin
      .from('asistentes')
      .select('id, nombres_completos, activo')
      .eq('usuario_id', usuarioId)
      .maybeSingle()
    return data as { id: string; nombres_completos: string; activo: boolean } | null
  }

  async function objetivo(id: unknown) {
    if (typeof id !== 'string' || !RE_UUID.test(id)) return { error: 'Cuenta no válida.' as const }
    const { data, error } = await comoAdmin
      .from('usuarios')
      .select('id, email, nombre_completo, rol, activo')
      .eq('id', id)
      .maybeSingle()
    if (error) return { error: 'No se pudo leer la cuenta.' as const }
    if (!data) return { error: 'La cuenta no existe.' as const }
    return { usuario: data as { id: string; email: string; nombre_completo: string; rol: Rol; activo: boolean } }
  }

  // Mensaje legible para errores de la BD que son reglas de negocio (p. ej. «último administrador»).
  function mensajeBD(error: { message?: string; code?: string } | null, porDefecto: string) {
    if (error?.code === 'P0001' && error.message) return error.message
    return porDefecto
  }

  // ---------------------------------------------------------------------------------------------
  // crear
  // ---------------------------------------------------------------------------------------------
  if (accion === 'crear') {
    const email = texto(cuerpo.email).toLowerCase()
    const nombre = texto(cuerpo.nombre_completo)
    const rol = cuerpo.rol
    const tambienAtiende = cuerpo.tambien_atiende === true

    if (!RE_EMAIL.test(email) || email.length > 200) return responder({ error: 'Escribe un correo válido.' }, 400)
    if (nombre.length < 2 || nombre.length > 120) return responder({ error: 'Escribe el nombre completo.' }, 400)
    if (!esRol(rol)) return responder({ error: 'Rol no válido.' }, 400)
    const errPass = validarPassword(cuerpo.password)
    if (errPass) return responder({ error: errPass }, 400)

    const { data: creada, error: errCrear } = await servicio.auth.admin.createUser({
      email,
      password: cuerpo.password as string,
      email_confirm: true,
    })
    if (errCrear || !creada?.user) {
      const msg = (errCrear?.message ?? '').toLowerCase()
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return responder({ error: 'Ese correo ya tiene una cuenta (de personal o de una clienta).' }, 409)
      }
      console.error('gestionar-personal crear: createUser falló:', errCrear?.message)
      return responder({ error: 'No se pudo crear la cuenta.' }, 500)
    }
    const nuevoId = creada.user.id

    // Si algo falla a partir de aquí se deshace todo: no debe quedar una cuenta de acceso huérfana.
    async function revertir() {
      await comoAdmin.from('asistentes').delete().eq('usuario_id', nuevoId)
      const { error } = await servicio.auth.admin.deleteUser(nuevoId)
      if (error) console.error('gestionar-personal crear: no se pudo revertir la cuenta', nuevoId, error.message)
    }

    const { error: errUsuarioFila } = await comoAdmin.from('usuarios').insert({
      id: nuevoId,
      email,
      nombre_completo: nombre,
      rol,
      activo: true,
    })
    if (errUsuarioFila) {
      console.error('gestionar-personal crear: insert usuarios falló:', errUsuarioFila.message)
      await revertir()
      return responder({ error: 'No se pudo crear la cuenta.' }, 500)
    }

    const llevaFicha = ROLES_CON_FICHA.includes(rol) || (rol === 'ADMINISTRADOR' && tambienAtiende)
    let fichaId: string | null = null
    if (llevaFicha) {
      const { data: ficha, error: errFicha } = await comoAdmin
        .from('asistentes')
        .insert({ nombres_completos: nombre, usuario_id: nuevoId, activo: true })
        .select('id')
        .single()
      if (errFicha || !ficha) {
        console.error('gestionar-personal crear: insert asistentes falló:', errFicha?.message)
        await revertir()
        return responder({ error: 'No se pudo crear la ficha de la persona.' }, 500)
      }
      fichaId = ficha.id
    }

    return responder({ ok: true, id: nuevoId, ficha_id: fichaId })
  }

  // ---------------------------------------------------------------------------------------------
  // actualizar
  // ---------------------------------------------------------------------------------------------
  if (accion === 'actualizar') {
    const r = await objetivo(cuerpo.id)
    if ('error' in r) return responder({ error: r.error }, r.error === 'La cuenta no existe.' ? 404 : 400)
    const u = r.usuario

    const nombre = cuerpo.nombre_completo === undefined ? u.nombre_completo : texto(cuerpo.nombre_completo)
    if (nombre.length < 2 || nombre.length > 120) return responder({ error: 'Escribe el nombre completo.' }, 400)

    let rolNuevo: Rol = u.rol
    if (cuerpo.rol !== undefined) {
      if (!esRol(cuerpo.rol)) return responder({ error: 'Rol no válido.' }, 400)
      rolNuevo = cuerpo.rol
    }
    if (u.id === yoId && rolNuevo !== u.rol) {
      return responder({ error: 'No puedes cambiar tu propio rol.' }, 400)
    }

    const { error: errAct } = await comoAdmin
      .from('usuarios')
      .update({ nombre_completo: nombre, rol: rolNuevo })
      .eq('id', u.id)
    if (errAct) {
      console.error('gestionar-personal actualizar:', errAct.message)
      return responder({ error: mensajeBD(errAct, 'No se pudo guardar el cambio.') }, 409)
    }

    // Ficha acorde al rol (el historial de atenciones se conserva: nunca se borra, solo se desactiva).
    const ficha = await fichaDe(u.id)
    if (rolNuevo === 'CAJERA') {
      if (ficha?.activo) await comoAdmin.from('asistentes').update({ activo: false }).eq('id', ficha.id)
    } else if (ROLES_CON_FICHA.includes(rolNuevo)) {
      if (!ficha) {
        const { error } = await comoAdmin
          .from('asistentes')
          .insert({ nombres_completos: nombre, usuario_id: u.id, activo: u.activo })
        if (error) console.error('gestionar-personal actualizar: no se pudo crear la ficha:', error.message)
      } else {
        const cambios: Record<string, unknown> = { activo: u.activo }
        // El nombre de la ficha sigue al de la cuenta solo si no se había personalizado.
        if (ficha.nombres_completos === u.nombre_completo) cambios.nombres_completos = nombre
        await comoAdmin.from('asistentes').update(cambios).eq('id', ficha.id)
      }
    } else if (ficha && ficha.nombres_completos === u.nombre_completo) {
      // ADMINISTRADOR con ficha propia: solo se sincroniza el nombre.
      await comoAdmin.from('asistentes').update({ nombres_completos: nombre }).eq('id', ficha.id)
    }

    return responder({ ok: true })
  }

  // ---------------------------------------------------------------------------------------------
  // bloquear / desbloquear
  // ---------------------------------------------------------------------------------------------
  if (accion === 'bloquear' || accion === 'desbloquear') {
    const r = await objetivo(cuerpo.id)
    if ('error' in r) return responder({ error: r.error }, r.error === 'La cuenta no existe.' ? 404 : 400)
    const u = r.usuario
    const bloquear = accion === 'bloquear'

    if (bloquear && u.id === yoId) return responder({ error: 'No puedes bloquear tu propia cuenta.' }, 400)

    // 1) La fila: desde este instante rol_actual() es null para ella y la RLS le quita todos los permisos.
    //    El trigger de la BD rechaza bloquear al último administrador activo.
    const { error: errFila } = await comoAdmin.from('usuarios').update({ activo: !bloquear }).eq('id', u.id)
    if (errFila) {
      console.error('gestionar-personal bloqueo (fila):', errFila.message)
      return responder({ error: mensajeBD(errFila, 'No se pudo cambiar el estado de la cuenta.') }, 409)
    }

    // 2) Auth: el baneo impide iniciar sesión y renovar el token de una sesión abierta.
    const { error: errBan } = await servicio.auth.admin.updateUserById(u.id, {
      ban_duration: bloquear ? BAN_PERMANENTE : 'none',
    })
    if (errBan) {
      console.error('gestionar-personal bloqueo (auth):', errBan.message)
      await comoAdmin.from('usuarios').update({ activo: bloquear }).eq('id', u.id) // deshacer
      return responder({ error: 'No se pudo cambiar el acceso de la cuenta.' }, 500)
    }

    // 3) La ficha deja de salir como profesional en las citas mientras esté bloqueada.
    const ficha = await fichaDe(u.id)
    if (ficha && (bloquear ? ficha.activo : u.rol !== 'CAJERA' && !ficha.activo)) {
      await comoAdmin.from('asistentes').update({ activo: !bloquear }).eq('id', ficha.id)
    }

    return responder({ ok: true })
  }

  // ---------------------------------------------------------------------------------------------
  // restablecer_password
  // ---------------------------------------------------------------------------------------------
  if (accion === 'restablecer_password') {
    const r = await objetivo(cuerpo.id)
    if ('error' in r) return responder({ error: r.error }, r.error === 'La cuenta no existe.' ? 404 : 400)
    const errPass = validarPassword(cuerpo.password)
    if (errPass) return responder({ error: errPass }, 400)

    const { error } = await servicio.auth.admin.updateUserById(r.usuario.id, { password: cuerpo.password as string })
    if (error) {
      console.error('gestionar-personal restablecer_password:', error.message)
      return responder({ error: 'No se pudo cambiar la contraseña.' }, 500)
    }
    return responder({ ok: true })
  }

  return responder({ error: 'Acción no válida.' }, 400)
})
