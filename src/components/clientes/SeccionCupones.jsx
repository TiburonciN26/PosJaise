import { Gift, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { ETIQUETAS_ORIGEN_CUPON, estadoEfectivoCupon, formatearValorCupon } from '../../lib/cupones.js'
import { fechaCorta, ESTADOS_CUPON, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import { Capsula, EstadoLista } from './PiezasPerfil.jsx'

const ORIGENES = {
  ...ETIQUETAS_ORIGEN_CUPON,
  RECOMPENSA_MONEDAS: 'Canje de monedas',
  RECOMPENSA_SELLOS: 'Canje de sellos',
}

// Cupones de la clienta (vigentes, usados, vencidos o anulados) y sus referidos: quién la invitó y a quiénes invitó.
// Los nombres de referidos abren su propio perfil.
export default function SeccionCupones({ clienteId, codigoReferido, referidaPor, onAbrirCliente }) {
  const cupones = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('cupones')
        .select('id, codigo, origen, valor, tipo_descuento, estado, vigente_hasta, creado_en, canjeado_en, nombre_premio')
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .order('id')
        .range(desde, desde + cantidad - 1),
  })
  const referidas = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('clientes')
        .select('id, nombre, creado_en')
        .eq('referido_por', clienteId)
        .order('nombre')
        .order('id')
        .range(desde, desde + cantidad - 1),
  })

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink/60">
          <Gift className="h-3.5 w-3.5" /> Cupones
        </p>
        <EstadoLista lista={cupones} vacio="No tiene cupones.">
          <ul className="divide-y divide-border">
            {cupones.filas.map((cupon) => {
              const { estado } = estadoEfectivoCupon(cupon)
              return (
                <li key={cupon.id} className="flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      <span className="font-mono">{cupon.codigo}</span>
                      <span className="text-ink/60"> · {formatearValorCupon(cupon)}</span>
                    </p>
                    <p className="truncate text-xs text-ink/60">
                      {cupon.nombre_premio || ORIGENES[cupon.origen] || cupon.origen}
                      {' · '}
                      {cupon.canjeado_en
                        ? `usado el ${fechaCorta(cupon.canjeado_en)}`
                        : cupon.vigente_hasta
                          ? `vence el ${fechaCorta(cupon.vigente_hasta)}`
                          : `desde el ${fechaCorta(cupon.creado_en)}`}
                    </p>
                  </div>
                  <Capsula estado={ESTADOS_CUPON[estado]} />
                </li>
              )
            })}
          </ul>
        </EstadoLista>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink/60">
          <UserPlus className="h-3.5 w-3.5" /> Referidos
        </p>
        <p className="text-sm text-ink/70">
          Su código: <span className="font-mono text-ink">{codigoReferido || '—'}</span>
        </p>
        <p className="text-sm text-ink/70">
          La refirió:{' '}
          {referidaPor ? (
            <button type="button" onClick={() => onAbrirCliente(referidaPor.id)} className="text-purple-300 hover:underline">
              {referidaPor.nombre}
            </button>
          ) : (
            'nadie'
          )}
        </p>
        <div className="mt-2">
          <EstadoLista lista={referidas} vacio="Todavía no ha referido a nadie.">
            <ul className="space-y-1">
              {referidas.filas.map((referida) => (
                <li key={referida.id} className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => onAbrirCliente(referida.id)}
                    className="min-w-0 flex-1 truncate text-left text-purple-300 hover:underline"
                  >
                    {referida.nombre}
                  </button>
                  <span className="shrink-0 text-xs text-ink/50">
                    {referida.creado_en ? `desde ${fechaCorta(referida.creado_en)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </EstadoLista>
        </div>
      </div>
    </div>
  )
}
