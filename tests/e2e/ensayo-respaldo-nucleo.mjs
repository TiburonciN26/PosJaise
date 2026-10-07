// Núcleo (sin Docker) de ensayo-respaldo-procedimiento.mjs: decide si el ensayo FALLÓ, clasifica errores esperados e inesperados
// y garantiza que un fallo de limpieza no oculte el error original. Se prueba aislado en ensayo-respaldo-procedimiento.test.mjs.
//
// Vocabulario: un «resultado» (res) lo llena el script con hechos medidos (códigos de salida, errores, diferencias de huellas).
// Un FALLO es cualquier hecho inesperado. Un CONTROL NEGATIVO es un fallo deliberado que debe ocurrir exactamente como se espera;
// si el control NO falla (o falla de otra forma), el control no discrimina y eso también es un fallo del ensayo.

// Categorías de huella que SOLO pierde una restauración sin propietarios ni privilegios (--no-owner --no-acl).
export const CATEGORIAS_CONTRASTE = ['esquemas', 'relaciones', 'columnas_acl', 'funciones', 'tipos', 'privilegios_por_omision'];

// Clasifica las líneas «ERROR» al aplicar roles.sql (tal como lo exportó pg_dumpall) en un destino que ya tiene algunos roles.
// Cada error se relaciona con la SENTENCIA que lo causó (psql imprime «archivo:LINEA: ERROR: …»; LINEA es la primera línea de la
// sentencia) y solo es ESPERADO si coincide con una categoría conocida y justificada:
//   rol_preexistente        CREATE ROLE de un rol que ya existía en el destino («role "x" already exists»).
//   atributos_preexistente  ALTER ROLE <preexistente> WITH …: el superusuario inicial del clúster no puede dejar de serlo
//                           («permission denied to alter role»); sus atributos difieren del origen y se documenta aparte.
//   membresia_con_otorgante GRANT … TO … GRANTED BY <otorgante>: PostgreSQL 17 exige que el otorgante tenga ADMIN OPTION sobre el
//                           rol, y el destino recién creado no lo tiene («permission denied to grant privileges as role»). La
//                           pertenencia NO queda aplicada: se re-aplica sin «GRANTED BY» y se VERIFICA después (ver script).
// Todo lo demás es inesperado y hace fallar el ensayo, aunque la restauración posterior funcione.
export function clasificarErroresRoles(lineasError, rolesPreexistentes, sqlLineas = []) {
  const previos = new Set(rolesPreexistentes);
  const esperados = []; const inesperados = []; const sentenciasPorReparar = [];
  for (const linea of lineasError) {
    const m = linea.match(/:(\d+): ERROR:\s+(.*)$/);
    const n = m ? Number(m[1]) : null; const msg = m ? m[2] : linea;
    const sentencia = n ? (sqlLineas[n - 1] ?? '') : '';
    let categoria = null;
    const c = sentencia.match(/^CREATE ROLE (\S+?);/);
    const a = sentencia.match(/^ALTER ROLE (\S+) WITH /);
    if (c && previos.has(c[1]) && new RegExp(`role "${c[1]}" already exists`).test(msg)) categoria = 'rol_preexistente';
    else if (a && previos.has(a[1]) && /permission denied to alter role/.test(msg)) categoria = 'atributos_preexistente';
    else if (/^GRANT .* TO \S+.* GRANTED BY \S+;$/.test(sentencia) && /permission denied to grant privileges as role/.test(msg)) categoria = 'membresia_con_otorgante';
    if (categoria) { esperados.push({ linea, categoria, sentencia }); if (categoria === 'membresia_con_otorgante') sentenciasPorReparar.push(sentencia); } else inesperados.push(linea);
  }
  const porCategoria = {};
  for (const e of esperados) porCategoria[e.categoria] = (porCategoria[e.categoria] ?? 0) + 1;
  return { esperados, inesperados, porCategoria, sentenciasPorReparar };
}

// Re-aplicable: la misma pertenencia sin «GRANTED BY x» (la otorga el superusuario del destino).
export const sinOtorgante = (sentencia) => sentencia.replace(/ GRANTED BY \S+;$/, ';');

// Clasifica las líneas de error de pg_restore SIN roles (control negativo): esperado = «role "x" does not exist».
export function clasificarErroresSinRoles(lineasError) {
  const esperados = []; const otros = [];
  for (const linea of lineasError) (/role "[^"]+" does not exist/.test(linea) ? esperados : otros).push(linea);
  return { esperados, otros };
}

const diferencias = (r) => (Array.isArray(r?.diferencias) ? r.diferencias : null);

// Devuelve la lista de fallos (texto). Vacía = el ensayo salió bien.
export function evaluarResultado(res) {
  const f = [];
  const p = res?.pasos ?? {};
  const necesita = (cond, msg) => { if (!cond) f.push(msg); };

  necesita(res?.mismo_mayor === true, 'pg_dump y el servidor no son del mismo mayor');
  // 1) exportación
  necesita(p.exportacion?.codigo === 0, `exportación: pg_dump terminó con código ${p.exportacion?.codigo ?? 'desconocido'}`);
  necesita(p.exportacion?.bytes > 0, 'exportación: el archivo está vacío o no existe');
  necesita(/^[0-9a-f]{64}$/.test(p.exportacion?.sha256 ?? ''), 'exportación: falta el sha256 del archivo');
  // 2) lectura
  const l = p.lectura ?? {};
  necesita(l.codigo === 0, `lectura: pg_restore --list terminó con código ${l.codigo ?? 'desconocido'}`);
  necesita(l.lineas > 0, 'lectura: el archivo no tiene entradas');
  necesita(l.entradas_acl > 0, 'lectura: el archivo no trae entradas ACL (privilegios)');
  necesita(l.alter_owner > 0, 'lectura: el archivo no trae OWNER TO (propietarios)');
  necesita(l.entrada_schema_public_omitida === 1, `lectura: se esperaba omitir exactamente 1 entrada «SCHEMA - public» y fueron ${l.entrada_schema_public_omitida}`);
  // 3) roles globales
  const r = p.roles ?? {};
  necesita(r.codigo === 0, `roles: pg_dumpall terminó con código ${r.codigo ?? 'desconocido'}${r.error ? ` (${r.error})` : ''}`);
  necesita(r.lineas_create_role > 0, 'roles: roles.sql no contiene ningún CREATE ROLE');
  necesita(r.contiene_contrasenas === false, 'roles: roles.sql contiene contraseñas (se pidió --no-role-passwords)');
  necesita(r.dump_contiene_roles === false, 'roles: el .dump contiene roles (no debería: pg_dump no los guarda)');
  // 4A) restauración con roles presentes
  const a = p.restauracion_con_roles ?? {};
  necesita(a.codigo === 0, `restauración con roles: pg_restore terminó con código ${a.codigo ?? 'desconocido'}${a.salida ? ` — ${String(a.salida).slice(-200)}` : ''}`);
  necesita(diferencias(a) !== null, 'restauración con roles: no se comparó la huella');
  necesita((diferencias(a) ?? []).length === 0, `restauración con roles: difieren ${(diferencias(a) ?? ['?']).join(', ')}`);
  // 4B) clúster vacío preparado
  const b = p.restauracion_cluster_preparado ?? {};
  necesita(b.preparacion_roles?.codigo_psql !== undefined, 'preparación de roles: no se aplicó roles.sql');
  necesita(b.preparacion_roles?.errores_total === Object.values(b.preparacion_roles?.por_categoria ?? { x: -1 }).reduce((t, n) => t + n, 0) + (b.preparacion_roles?.inesperados?.length ?? -2), 'preparación de roles: hay errores sin clasificar (el total no coincide con esperados + inesperados)');
  const rem = b.preparacion_roles?.reparacion;
  necesita(rem && rem.codigo === 0 && rem.aplicadas === (b.preparacion_roles?.por_categoria?.membresia_con_otorgante ?? 0), 'preparación de roles: las pertenencias rechazadas no se re-aplicaron todas sin error');
  const vr = b.verificacion_roles;
  necesita(vr && Array.isArray(vr.pertenencias_distintas) && vr.pertenencias_distintas.length === 0, `verificación de roles: pertenencias distintas (${(vr?.pertenencias_distintas ?? ['sin verificar']).slice(0, 3).join(' | ')})`);
  necesita(vr && Array.isArray(vr.atributos_distintos) && vr.atributos_distintos.every((x) => (vr.atributos_distintos_esperados ?? []).includes(x)), `verificación de roles: atributos distintos no esperados (${(vr?.atributos_distintos ?? ['sin verificar']).filter((x) => !(vr?.atributos_distintos_esperados ?? []).includes(x)).join(', ')})`);
  necesita((b.preparacion_roles?.inesperados ?? ['?']).length === 0,
    `preparación de roles: ${(b.preparacion_roles?.inesperados ?? ['sin clasificar']).length} error(es) inesperado(s): ${(b.preparacion_roles?.inesperados ?? []).slice(0, 3).join(' | ')}`);
  necesita(b.roles_en_destino_despues >= (r.roles_en_origen?.length ?? Infinity), `preparación de roles: el destino tiene ${b.roles_en_destino_despues} roles y el origen ${r.roles_en_origen?.length}`);
  necesita(b.codigo === 0, `restauración en clúster preparado: pg_restore terminó con código ${b.codigo ?? 'desconocido'}${b.salida ? ` — ${String(b.salida).slice(-200)}` : ''}`);
  necesita(diferencias(b) !== null, 'restauración en clúster preparado: no se comparó la huella');
  necesita((diferencias(b) ?? []).length === 0, `restauración en clúster preparado: difieren ${(diferencias(b) ?? ['?']).join(', ')}`);
  // Controles negativos: deben fallar EXACTAMENTE como se espera.
  const s = p.restauracion_sin_roles ?? {};
  necesita(s.codigo !== undefined && s.codigo !== 0, 'control negativo «sin roles»: la restauración sin roles NO falló (el control no discrimina)');
  necesita(s.errores_rol_inexistente > 0, 'control negativo «sin roles»: no hubo errores «role … does not exist»');
  // El control debe fallar EXCLUSIVAMENTE por los errores de roles previstos: cualquier otro error (E/S, permisos, objetos…) lo invalida.
  necesita(Number.isInteger(s.otros_errores), 'control negativo «sin roles»: falta la verificación de otros errores (otros_errores ausente o inválido)');
  necesita(!Number.isInteger(s.otros_errores) || s.otros_errores === 0, `control negativo «sin roles»: falló también por ${s.otros_errores} error(es) distinto(s) de los de roles: ${(s.ejemplos_otros ?? []).slice(0, 2).join(' | ')}`);
  necesita(!Array.isArray(s.ejemplos_otros) || s.ejemplos_otros.length === 0, 'control negativo «sin roles»: hay ejemplos de errores no previstos');
  const c = p.contraste_sin_propietarios ?? {};
  necesita(c.codigo === 0, `control negativo «sin propietarios»: la restauración debía terminar y terminó con código ${c.codigo ?? 'desconocido'}`);
  const cat = c.categorias_que_difieren ?? null;
  necesita(cat !== null && CATEGORIAS_CONTRASTE.every((k) => cat.includes(k)), `control negativo «sin propietarios»: debían diferir ${CATEGORIAS_CONTRASTE.join(', ')} y difieren ${(cat ?? ['?']).join(', ')}`);
  necesita(cat === null || cat.every((k) => CATEGORIAS_CONTRASTE.includes(k)), `control negativo «sin propietarios»: difiere algo no esperado (${(cat ?? []).filter((k) => !CATEGORIAS_CONTRASTE.includes(k)).join(', ')})`);
  // Limpieza
  necesita((p.limpieza?.errores ?? ['?']).length === 0, `limpieza: ${(p.limpieza?.errores ?? ['no se ejecutó']).join(' | ')}`);
  return f;
}

export function codigoDeSalida({ fallos = [], error = null } = {}) {
  return error || fallos.length ? 1 : 0;
}

// Ejecuta `accion` y SIEMPRE las limpiezas (todas, aunque una falle). Reglas:
//  · si `accion` falló, se relanza ESE error (original) con `limpiezaErrores` adjunto; la limpieza no lo reemplaza;
//  · si `accion` salió bien y una limpieza falló, se lanza un error de limpieza (dejar residuos es un fallo);
//  · si todo salió bien, devuelve lo que devolvió `accion`.
export async function ejecutarConLimpieza(accion, limpiezas) {
  let original = null; let valor;
  try { valor = await accion(); } catch (e) { original = e; }
  const limpiezaErrores = [];
  for (const limpiar of limpiezas) {
    try { await limpiar(); } catch (e) { limpiezaErrores.push(String(e?.message ?? e)); }
  }
  if (original) {
    try { original.limpiezaErrores = limpiezaErrores; } catch { /* error inmutable: se relanza igual */ }
    throw original;
  }
  if (limpiezaErrores.length) {
    const e = new Error(`la limpieza falló: ${limpiezaErrores.join(' | ')}`);
    e.limpiezaErrores = limpiezaErrores;
    throw e;
  }
  return valor;
}
