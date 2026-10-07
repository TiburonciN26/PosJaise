// Núcleo (sin Docker) de ensayo-aplicar-migraciones.mjs: aplica en orden y se detiene ante el primer fallo, incluido el fallo
// de registrar la versión en supabase_migrations.schema_migrations. Las acciones reales se inyectan para poder probar el
// comportamiento sin base de datos (ver ensayo-aplicar-migraciones.test.mjs).
//
// Por archivo: 1) aplicar el SQL; 2) registrar la versión; 3) comprobar que quedó registrada. Si cualquiera falla, se detiene
// y la fila queda con el paso fallido, para documentar el estado parcial (las migraciones se confirman una por una).
export function datosDeArchivo(f) {
  return { version: f.split('_')[0], nombre: f.replace(/^\d+_/, '').replace(/\.sql$/, '') };
}

export async function aplicarEnOrden(archivos, { aplicar, registrar, versionRegistrada }) {
  const filas = [];
  for (const f of archivos) {
    const { version, nombre } = datosDeArchivo(f);
    const fila = { archivo: f, ok: false, paso: 'aplicar', error: '' };
    filas.push(fila);
    const a = await aplicar(f);
    if (!a.ok) { fila.error = a.error ?? 'fallo al aplicar'; break; }
    fila.paso = 'registrar';
    const r = await registrar(version, nombre);
    if (!r.ok) { fila.error = `no se pudo registrar la versión ${version}: ${r.error ?? ''}`.trim(); break; }
    fila.paso = 'verificar';
    if (!(await versionRegistrada(version))) { fila.error = `la versión ${version} no quedó registrada en schema_migrations`; break; }
    fila.ok = true; fila.paso = 'completa';
  }
  return filas;
}
