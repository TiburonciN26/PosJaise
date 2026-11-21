// `npm test`: los tests de `node --test` que NO necesitan Supabase Local, la rama `testing`, un navegador ni contraseñas.
// Son los que corren en la CI (.github/workflows/verificar.yml) y en cualquier máquina recién clonada.
//
// Lista EXPLÍCITA a propósito (no un glob de tests/e2e/*.test.mjs): el resto de *.test.mjs exige la rama `testing` y la
// base QA local (ver tests/e2e/README.md, «Dos capas»), y en `main` o en la CI fallarían siempre. Un test nuevo que sea
// autónomo se agrega aquí; uno que necesite base de datos se ejecuta con la suite QA.
//
// Uso: npm test            (todos)
//      npm test -- cupones  (solo los que contienen «cupones» en el nombre)
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const AUTONOMOS = [
  'catalogo-publico-botones',
  'cobro',
  'colector-respuestas',
  'csp',
  'cupones-categorias',
  'cupones-vigencia-efectiva',
  'destino-login',
  'ensayo-aplicar-migraciones',
  'horario-atencion',
  'niveles-visuales',
  'promociones-admin',
  'recompensas-fase2-limpieza',
  'sanear-salidas',
  'seo',
  'tarjetas-cupon-niveles',
]

// Windows + Git Bash: el directorio llega como «c:\…» (unidad en minúscula). tarjetas-cupon-niveles carga el componente
// por Vite y React por Node; con dos grafías de la misma ruta, React se carga DOS veces y falla con
// «Cannot read properties of null (reading 'useState')». Normalizar la unidad evita ese falso negativo.
const raiz = process.cwd().replace(/^[a-z]:/, (u) => u.toUpperCase())
process.chdir(raiz)

const filtro = process.argv[2]
const elegidos = AUTONOMOS.filter((n) => !filtro || n.includes(filtro))
if (!elegidos.length) {
  console.error(`probar-unitarios: ningún test coincide con «${filtro}»`)
  process.exit(1)
}
const archivos = elegidos.map((n) => resolve(raiz, 'tests/e2e', `${n}.test.mjs`))
const faltan = archivos.filter((a) => !existsSync(a))
if (faltan.length) {
  console.error(`probar-unitarios: faltan archivos de test:\n  ${faltan.join('\n  ')}`)
  process.exit(1)
}

const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...archivos], { stdio: 'inherit', cwd: raiz })
process.exit(r.status ?? 1)
