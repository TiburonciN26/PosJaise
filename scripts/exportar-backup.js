// Backup mensual de ventas y gastos (M7 de la auditoría técnica).
// Corre desde GitHub Actions (ver .github/workflows/backup-mensual.yml), una
// vez al mes, con la Service Role Key de Supabase (necesita saltarse RLS
// para traer todo, no solo lo que vería un usuario autenticado normal).
//
// Uso local (para probarlo a mano):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/exportar-backup.js
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { anioMesEnLima, iniciarMesLima } from '../src/lib/fechas.js'
import { aCSV } from '../src/lib/csv.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function rangoMesAnteriorLima() {
  const { anio, mes } = anioMesEnLima(new Date())
  const mesAnteriorIndice = mes === 0 ? 11 : mes - 1
  const anioMesAnterior = mes === 0 ? anio - 1 : anio

  return {
    desde: iniciarMesLima(anioMesAnterior, mesAnteriorIndice),
    hasta: iniciarMesLima(anio, mes),
    mesNumero: mesAnteriorIndice + 1,
    anio: anioMesAnterior,
    etiqueta: `${anioMesAnterior}-${String(mesAnteriorIndice + 1).padStart(2, '0')}`,
  }
}

async function main() {
  const { desde, hasta, mesNumero, anio, etiqueta } = rangoMesAnteriorLima()
  console.log(`Exportando backup de ${etiqueta} (${desde.toISOString()} a ${hasta.toISOString()})...`)

  const [ventasRes, gastosRes] = await Promise.all([
    supabase
      .from('ventas')
      .select(
        'id, codigo, fecha, estado, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, venta_items(tipo, nombre, cantidad, precio_unitario, subtotal)',
      )
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha'),
    supabase.from('gastos').select('nombre, tipo, monto, mes, anio').eq('mes', mesNumero).eq('anio', anio),
  ])

  if (ventasRes.error) throw ventasRes.error
  if (gastosRes.error) throw gastosRes.error

  const ventas = ventasRes.data ?? []
  const gastos = gastosRes.data ?? []
  const items = ventas.flatMap((venta) =>
    (venta.venta_items ?? []).map((item) => ({ venta_codigo: venta.codigo, ...item })),
  )

  const carpeta = join('backups', etiqueta)
  mkdirSync(carpeta, { recursive: true })

  writeFileSync(
    join(carpeta, 'ventas.csv'),
    aCSV(ventas, [
      'id',
      'codigo',
      'fecha',
      'estado',
      'total',
      'metodo_pago',
      'monto_recibido',
      'vendedor_id',
      'cliente_id',
    ]),
  )
  writeFileSync(
    join(carpeta, 'venta_items.csv'),
    aCSV(items, ['venta_codigo', 'tipo', 'nombre', 'cantidad', 'precio_unitario', 'subtotal']),
  )
  writeFileSync(join(carpeta, 'gastos.csv'), aCSV(gastos, ['nombre', 'tipo', 'monto', 'mes', 'anio']))

  console.log(
    `Listo: ${ventas.length} ventas, ${items.length} items, ${gastos.length} gastos → ${carpeta}/`,
  )
}

main().catch((error) => {
  console.error('Error exportando el backup:', error)
  process.exit(1)
})
