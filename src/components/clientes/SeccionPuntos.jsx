import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { fechaHora, numero, NIVELES, TIPOS_MOVIMIENTO_PUNTOS, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import { Capsula, EstadoLista, TablaSeccion } from './PiezasPerfil.jsx'

function detalleMovimiento(mov) {
  const d = mov.detalle ?? {}
  if (d.premio) return d.premio
  if (d.motivo) return d.motivo
  if (mov.ventas?.codigo) return mov.ventas.codigo
  return ''
}

function Signo({ valor, sufijo = '' }) {
  const n = Number(valor ?? 0)
  const clase = n > 0 ? 'text-green' : n < 0 ? 'text-red' : 'text-ink/50'
  return (
    <span className={`font-mono ${clase}`}>
      {n > 0 ? '+' : ''}
      {numero(n)}
      {sufijo}
    </span>
  )
}

// Saldo (monedas, nivel, sellos) más el historial de monedas y el de sellos. Solo acumulan las clientas con cuenta web:
// para una manual se dice y no se consulta nada.
export default function SeccionPuntos({ clienteId, esWeb, puntos }) {
  if (!esWeb) {
    return (
      <p className="py-1 text-sm text-ink/60">
        Sin cuenta web: no acumula puntos. Empieza a sumar cuando se registra en la web con este mismo celular.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {puntos && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border bg-bg/40 p-2">
            <p className="text-xs text-ink/60">Monedas</p>
            <p className="font-mono text-lg font-semibold text-purple-300">{numero(puntos.monedas)}</p>
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-2">
            <p className="text-xs text-ink/60">Nivel</p>
            <div className="mt-1 flex justify-center">
              <Capsula estado={NIVELES[puntos.nivel] ?? NIVELES.BASICO} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-2">
            <p className="text-xs text-ink/60">Sellos</p>
            <p className="font-mono text-lg font-semibold text-ink">{puntos.sellos}</p>
          </div>
        </div>
      )}
      <MovimientosMonedas clienteId={clienteId} />
      <MovimientosSellos clienteId={clienteId} />
    </div>
  )
}

function MovimientosMonedas({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('recompensas_movimientos')
        .select('id, tipo, monedas, clasificacion, detalle, creado_en, ventas(codigo)')
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .order('id')
        .range(desde, desde + cantidad - 1),
  })

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink/60">Movimientos de monedas</p>
      <EstadoLista lista={lista} vacio="Sin movimientos de monedas.">
        <TablaSeccion
          columnas={[
            { titulo: 'Fecha' },
            { titulo: 'Tipo' },
            { titulo: 'Detalle' },
            { titulo: 'Monedas', derecha: true },
            { titulo: 'Para nivel', derecha: true },
          ]}
        >
          {lista.filas.map((mov) => (
            <tr key={mov.id}>
              <td className="whitespace-nowrap px-2 py-2 text-ink/70">{fechaHora(mov.creado_en)}</td>
              <td className="px-2 py-2 text-ink">{TIPOS_MOVIMIENTO_PUNTOS[mov.tipo] ?? mov.tipo}</td>
              <td className="px-2 py-2 text-ink/60">{detalleMovimiento(mov)}</td>
              <td className="px-2 py-2 text-right"><Signo valor={mov.monedas} /></td>
              <td className="px-2 py-2 text-right"><Signo valor={mov.clasificacion} /></td>
            </tr>
          ))}
        </TablaSeccion>
      </EstadoLista>
    </div>
  )
}

function MovimientosSellos({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('recompensas_sellos_movs')
        .select('id, tipo, delta, dia, detalle, creado_en, ventas(codigo)')
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .order('id')
        .range(desde, desde + cantidad - 1),
  })

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink/60">Sellos</p>
      <EstadoLista lista={lista} vacio="Sin movimientos de sellos.">
        <TablaSeccion columnas={[{ titulo: 'Fecha' }, { titulo: 'Tipo' }, { titulo: 'Detalle' }, { titulo: 'Sellos', derecha: true }]}>
          {lista.filas.map((mov) => (
            <tr key={mov.id}>
              <td className="whitespace-nowrap px-2 py-2 text-ink/70">{fechaHora(mov.creado_en)}</td>
              <td className="px-2 py-2 text-ink">{TIPOS_MOVIMIENTO_PUNTOS[mov.tipo] ?? mov.tipo}</td>
              <td className="px-2 py-2 text-ink/60">{detalleMovimiento(mov)}</td>
              <td className="px-2 py-2 text-right"><Signo valor={mov.delta} /></td>
            </tr>
          ))}
        </TablaSeccion>
      </EstadoLista>
    </div>
  )
}
