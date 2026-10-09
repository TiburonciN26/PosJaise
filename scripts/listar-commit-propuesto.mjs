// Genera un LISTADO REVISABLE del commit propuesto (todo el árbol de trabajo que compila) y sus exclusiones.
// NO hace add/commit/push ni modifica Git: solo lee `git status` y los archivos candidatos.
// Uso: node scripts/listar-commit-propuesto.mjs [salida.md]
// El análisis de secretos reporta archivo:línea:tipo, NUNCA el valor.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'

const git = (...a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout
const raw = git('status', '--porcelain=v1', '-uall', '-z').split('\0').filter(Boolean)
const entradas = []
for (let i = 0; i < raw.length; i++) {
  const e = raw[i]
  const st = e.slice(0, 2)
  let ruta = e.slice(3)
  if (st[0] === 'R' || st[0] === 'C') i++ // el origen del renombrado va en la entrada siguiente
  entradas.push({ st: st.trim() || '?', ruta })
}
const tipo = { M: 'modificado', '??': 'nuevo (sin seguimiento)', D: 'eliminado', A: 'añadido', R: 'renombrado' }

const categorias = [
  ['Migraciones SQL (supabase/migrations)', /^supabase\/migrations\//],
  ['Edge Functions (supabase/functions)', /^supabase\/functions\//],
  ['Otros de Supabase (config/seed/sql)', /^supabase\//],
  ['Código de la app (src/)', /^src\//],
  ['Recursos públicos (public/)', /^public\//],
  ['Pruebas (tests/)', /^tests\//],
  ['Scripts (scripts/)', /^scripts\//],
  ['Cloudflare / hosting', /^(cloudflare\/|\.node-version$|vite\.config\.js$|package(-lock)?\.json$|index\.html$)/],
  ['Evidencia de rendimiento (docs/evidencia-rendimiento)', /^docs\/evidencia-rendimiento\//],
  ['Otra documentación (docs/, guias/, *.md)', /^(docs\/|guias\/|[^/]+\.md$)/],
  ['Carpeta de Codex (.codex/)', /^\.codex\//],
]
const cat = (r) => (categorias.find(([, re]) => re.test(r)) ?? ['Otros', null])[0]

// Exclusiones recomendadas (aunque Git las vea): propias de Codex/QA o generadas.
const exclusion = (r) => {
  if (/^\.codex\//.test(r)) return 'Carpeta de trabajo de Codex (informes de revisión): no es código del producto'
  if (/^docs\/evidencia-rendimiento\/.*\.(png|jpg)$/.test(r)) return 'Capturas de evidencia (binarios): decidir si se versionan'
  if (/(^|\/)debug\.log$|\.log$/.test(r)) return 'Registro de depuración'
  if (/^tests\/e2e\/(results|artifacts)/.test(r)) return 'Resultados de ejecuciones de prueba'
  return null
}

const patrones = [
  ['sb_secret_ (clave privilegiada)', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['JWT (revisar role)', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['asignación service_role/secret', /(service_role|SERVICE_ROLE|secret_key|SECRET_KEY)\s*[:=]\s*['"`]?[A-Za-z0-9_.-]{20,}/],
  ['URL de base con contraseña', /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{4,}@/],
  ['contraseña literal', /(password|contraseña|passwd)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['correo no ficticio', /[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|icloud)\.(com|es|pe)/i],
]
function jwtRol(t) { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role ?? 'ausente' } catch { return 'ilegible' } }

const hallazgos = []
const grandes = []
const binarios = []
for (const { st, ruta } of entradas) {
  if (st === 'D') continue
  let s
  try { s = statSync(ruta) } catch { continue }
  if (!s.isFile()) continue
  if (s.size > 1 << 20) grandes.push({ ruta, mb: (s.size / 1048576).toFixed(1) })
  if (/\.(png|jpe?g|webp|gif|ico|ttf|woff2?|mp4|webm|zip|pdf)$/i.test(ruta)) { binarios.push(ruta); continue }
  if (s.size > 5 << 20) continue
  const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/)
  lineas.forEach((l, i) => {
    for (const [nombre, re] of patrones) {
      const m = l.match(re)
      if (!m) continue
      let n = nombre
      if (nombre.startsWith('JWT')) { const rol = jwtRol(m[0]); if (rol === 'anon') n = 'JWT anon (público por diseño)'; else n = `JWT con role «${rol}» — REVISAR` }
      hallazgos.push({ ruta, linea: i + 1, tipo: n })
    }
  })
}

// Coincidencias ya revisadas por una persona/agente (se identifican por archivo + tipo; si aparece OTRA coincidencia
// en otro archivo, sigue marcada como pendiente). Cada resolución explica por qué es aceptable.
const REVISADOS = [
  { ruta: 'src/pages/Login.jsx', tipo: 'correo no ficticio', resolucion: 'Placeholder genérico de ejemplo («Ej. maria@…») del campo de correo; no es una cuenta real. Revisado 2026-10-09.' },
  { ruta: 'implementacionesWed.md', tipo: 'correo no ficticio', resolucion: 'Mención ya presente en HEAD/origin (git show HEAD:implementacionesWed.md la contiene): el commit no la introduce. Si el usuario quiere redactarla es una decisión aparte. Revisado 2026-10-09.' },
]
const esRevisado = (h) => REVISADOS.find((r) => r.ruta === h.ruta && r.tipo === h.tipo)
// Identificadores de infraestructura (NO secretos) que quedarían visibles si el repositorio es PÚBLICO. Se cuentan por archivo.
const IDENTIFICADORES = [
  ['ref del Supabase de staging', /tqkdtojnhgykmcbvwdmz/],
  ['ref del Supabase del negocio (ya público en el bundle del sitio)', /cmkelllerzjqjbsqsylc/],
  ['proyecto de Cloudflare Pages de QA', /pos-jaise-preview/],
  ['ID de cuenta de Cloudflare', /af5ea2cb3f504970fe293b1923cd64d7/],
  ['correos QA ficticios (@staging.test)', /qa-(admin|cajera|cliente)@staging\.test/],
  ['repositorio de backups privado (nombre)', /PosJaise-backups/],
]
const infra = new Map()
for (const { st, ruta } of entradas) {
  if (st === 'D' || /^\.codex\//.test(ruta) || /\.(png|jpe?g|webp|ico|ttf|woff2?|zip|pdf)$/i.test(ruta)) continue
  let t
  try { if (statSync(ruta).size > 5 << 20) continue; t = readFileSync(ruta, 'utf8') } catch { continue }
  for (const [nombre, re] of IDENTIFICADORES) if (re.test(t)) infra.set(nombre, [...(infra.get(nombre) ?? []), ruta])
}
const porCat = new Map()
for (const e of entradas) { const c = cat(e.ruta); porCat.set(c, [...(porCat.get(c) ?? []), e]) }
const ignorados = git('ls-files', '--others', '--ignored', '--exclude-standard', '--directory').split('\n').filter((l) => l && !/^node_modules\/?$/.test(l))
const rastreadosEnv = git('ls-files').split('\n').filter((f) => /(^|\/)\.env(\..*)?$/.test(f))
const pkgDiff = git('diff', '--', 'package.json').split('\n').filter((l) => /^[+-] /.test(l))
const lockStat = git('diff', '--shortstat', '--', 'package-lock.json').trim()

let md = `# Commit propuesto (listado para revisión) — NO ejecutado\n\nGenerado por \`scripts/listar-commit-propuesto.mjs\` el ${new Date().toISOString()}. **No se ha hecho add, commit ni push.** La elección final se hace sobre este listado, no sobre una aprobación genérica; no es \`git add .\` ciego.\n\n`
md += `Base: \`HEAD\` ${git('rev-parse', '--short', 'HEAD').trim()} (rama \`${git('rev-parse', '--abbrev-ref', 'HEAD').trim()}\`). Entradas: **${entradas.length}** (${entradas.filter((e) => e.st === 'M').length} modificadas, ${entradas.filter((e) => e.st === '??').length} nuevas, ${entradas.filter((e) => e.st === 'D').length} eliminadas).\n\n`
md += `> **El repositorio es PÚBLICO** (verificado en GitHub): todo lo que se suba a cualquier rama, no solo \`main\`, es visible para cualquiera. Esta revisión es también una revisión de publicación.\n\n`
md += `> Efecto a tener en cuenta: el workflow \`deploy-pages.yml\` despliega GitHub Pages en **cada push a \`main\`**. Subir este código a \`main\` actualizaría la web actual aunque no se cambie el dominio. Por eso se propone una rama de preparación (p. ej. \`feat/cloudflare-pages\`) y fusionar a \`main\` solo con autorización.\n\n`
md += `## Resumen por categoría\n\n| Categoría | Archivos |\n|---|---|\n`
for (const [c, l] of porCat) md += `| ${c} | ${l.length} |\n`
md += `\n## Dependencias del commit\n- \`package.json\` (líneas cambiadas): ${pkgDiff.length ? pkgDiff.map((l) => '`' + l.trim() + '`').join(', ') : 'ninguna'}\n- \`package-lock.json\`: ${lockStat || 'sin cambios'}; \`npm ci --dry-run\` coherente (verificado aparte).\n`
md += `- Las migraciones nuevas ya están aplicadas en staging (153) y, según las instrucciones del repo, deben probarse en Local antes de producción; este commit **no** aplica nada a producción.\n`
md += `\n## Exclusiones propuestas (no deberían entrar al commit)\n\n`
const excl = entradas.map((e) => ({ ...e, motivo: exclusion(e.ruta) })).filter((e) => e.motivo)
md += excl.length ? excl.map((e) => `- \`${e.ruta}\` — ${e.motivo}`).join('\n') : '_ninguna entre las entradas de Git_'
md += `\n\nYa excluidos por \`.gitignore\` (no se versionan): ${ignorados.length ? ignorados.map((x) => '`' + x + '`').join(', ') : 'ninguno'}.\n\nArchivos \`.env*\` rastreados por Git: ${rastreadosEnv.length ? rastreadosEnv.map((x) => '`' + x + '`').join(', ') : 'ninguno'} (\`.env.staging.local\` y \`.env.local\` NO están rastreados). \`.gitignore\` no protege archivos ya rastreados.\n`
md += `\n## Revisión de secretos en el contenido de los candidatos\n\nPatrones buscados en los ${entradas.length} archivos candidatos (texto ≤5 MB; binarios no inspeccionados). Se reporta ubicación y tipo, nunca el valor.\n\n`
const graves = hallazgos.filter((h) => !/anon \(público/.test(h.tipo) && !esRevisado(h))
const revisados = hallazgos.filter((h) => esRevisado(h))
md += graves.length ? `**Hallazgos a revisar (${graves.length}):**\n\n` + graves.map((h) => `- \`${h.ruta}:${h.linea}\` — ${h.tipo}`).join('\n') + '\n' : '**Sin hallazgos que requieran revisión** (solo claves anon públicas, si las hay).\n'
if (revisados.length) md += `\n**Coincidencias ya revisadas (${revisados.length}):**\n\n` + revisados.map((h) => `- \`${h.ruta}:${h.linea}\` — ${h.tipo}: ${esRevisado(h).resolucion}`).join('\n') + '\n'
md += `\n## Identificadores de infraestructura que quedarían públicos (el repo es PÚBLICO)\n\nNo son secretos, pero hay que saberlo antes de autorizar el push (excluye \`.codex/**\`, ya propuesto como exclusión). Este análisis no busca contraseñas: eso lo hace la sección de secretos de arriba.\n\n`
md += ([...infra].map(([n, l]) => `- **${n}** — ${l.length} archivo(s): ${l.slice(0, 6).map((x) => '`' + x + '`').join(', ')}${l.length > 6 ? ', …' : ''}`).join('\n') || '_ninguno_') + '\n'
const anons = hallazgos.filter((h) => /anon \(público/.test(h.tipo))
if (anons.length) md += `\nJWT anon (públicos por diseño, \`role=anon\`): ${anons.map((h) => `\`${h.ruta}:${h.linea}\``).join(', ')}\n`
if (grandes.length) md += `\n### Archivos > 1 MB\n${grandes.map((g) => `- \`${g.ruta}\` (${g.mb} MB)`).join('\n')}\n`
md += `\n### Binarios (${binarios.length}) — no inspeccionados\n${binarios.map((b) => `- \`${b}\``).join('\n') || '_ninguno_'}\n`
md += `\n## Listado completo\n`
for (const [c, l] of porCat) {
  md += `\n### ${c} (${l.length})\n\n`
  md += l.map((e) => `- ${e.st === '??' ? '🆕' : e.st === 'D' ? '🗑️' : '✏️'} \`${e.ruta}\` — ${tipo[e.st] ?? e.st}${exclusion(e.ruta) ? ' **[EXCLUIR]**' : ''}`).join('\n') + '\n'
}
writeFileSync(process.argv[2] ?? 'docs/evidencia-rendimiento/fase-2/COMMIT-PROPUESTO.md', md)
console.log(`entradas=${entradas.length} hallazgos a revisar=${graves.length} exclusiones=${excl.length}`)
