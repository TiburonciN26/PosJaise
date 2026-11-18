import { CalendarClock, Globe } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { fechaHora, soles, ESTADOS_CITA, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import { Capsula, EstadoLista } from './PiezasPerfil.jsx'

const SELECT_CITAS_PERFIL =
  'id, fecha_hora, estado, nota, adelanto, metodo_pago, pago_verificado, creado_por_cliente_web_id, ' +
  'asistentes(nombres_completos), cita_servicios(id, precio, servicios(nombre))'

// Todas las citas de la clienta, de la más lejana en el futuro a la más antigua. Las que todavía no llegan se resaltan.
export default function SeccionCitas({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('citas')
        .select(SELECT_CITAS_PERFIL)
        .eq('cliente_id', clienteId)
        .order('fecha_hora', { ascending: false })
        .order('id')
        .range(desde, desde + cantidad - 1),
  })
  const ahora = Date.now()

  return (
    <EstadoLista lista={lista} vacio="No tiene citas registradas.">
      <ul className="space-y-2">
        {lista.filas.map((cita) => {
          const futura = new Date(cita.fecha_hora).getTime() >= ahora
          const servicios = (cita.cita_servicios ?? []).map((cs) => cs.servicios?.nombre).filter(Boolean)
          return (
            <li
              key={cita.id}
              className={`rounded-lg border px-3 py-2.5 ${futura ? 'border-purple-300/40 bg-purple-300/5' : 'border-border bg-bg/40'}`}
            >
              <div className="flex items-start gap-2">
                <CalendarClock className={`mt-0.5 h-4 w-4 shrink-0 ${futura ? 'text-purple-300' : 'text-ink/50'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    {fechaHora(cita.fecha_hora)}
                    {futura && <span className="ml-2 text-xs font-medium text-purple-300">Próxima</span>}
                  </p>
                  <p className="text-xs text-ink/60">
                    {servicios.length > 0 ? servicios.join(', ') : 'Sin servicios indicados'}
                    {' · '}
                    {cita.asistentes?.nombres_completos || 'Sin asistente'}
                  </p>
                  {Number(cita.adelanto) > 0 && (
                    <p className="text-xs text-ink/60">
                      Adelanto {soles(cita.adelanto)}
                      {cita.metodo_pago && ` · ${cita.metodo_pago}`}
                      {' · '}
                      <span className={cita.pago_verificado ? 'text-green' : 'text-amber'}>
                        {cita.pago_verificado ? 'pago verificado' : 'pago sin verificar'}
                      </span>
                    </p>
                  )}
                  {cita.nota && <p className="mt-0.5 text-xs italic text-ink/50">{cita.nota}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Capsula estado={ESTADOS_CITA[cita.estado] ?? { label: cita.estado, clase: 'border-border-strong text-ink/60' }} />
                  {cita.creado_por_cliente_web_id && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber">
                      <Globe className="h-2.5 w-2.5" /> Reservó por la web
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </EstadoLista>
  )
}
