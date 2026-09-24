import { useEffect, useState } from 'react'
import { History, Scissors, User } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { formatearSoles } from '../../lib/moneda.js'

const formatoFecha = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Lima',
})

// Historial de visitas — 100% lectura, sin RPC de escritura. Fuente:
// registro_servicios (no citas): así aparece tanto lo agendado por la
// Web como una atención que el personal registró directo, sin cita
// previa. RLS: registro_servicios_select_propio_web (73_historial_web.sql)
// usa mi_cliente_id(), no una subconsulta directa contra "clientes" —
// ese error ya nos costó un bug real en Citas (72_fix_citas_web_rls.sql).
export default function HistorialCliente() {
  const [registros, setRegistros] = useState([])
  const [nombresPorUsuario, setNombresPorUsuario] = useState(() => new Map())
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    Promise.all([
      supabase
        .from('registro_servicios')
        .select('id, fecha, precio, usuario_id, servicios(nombre)')
        .order('fecha', { ascending: false }),
      supabase.rpc('usuarios_para_citas'),
    ]).then(([registrosRes, usuariosRes]) => {
      if (!vigente) return
      setRegistros(registrosRes.data ?? [])
      setNombresPorUsuario(
        new Map((usuariosRes.data ?? []).map((u) => [u.id, u.nombre_completo])),
      )
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-md">
        {registros.length === 0 ? (
          <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-12 text-center">
            <History className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/50">Todavía no tienes visitas registradas.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {registros.map((registro) => (
              <div
                key={registro.id}
                className="liquid-glass flex items-center justify-between gap-3 rounded-none p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/70">
                    <Scissors className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {registro.servicios?.nombre ?? 'Servicio'}
                    </p>
                    <p className="text-xs text-white/60">{formatoFecha.format(new Date(registro.fecha))}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-white/50">
                      <User className="h-3 w-3" />
                      {nombresPorUsuario.get(registro.usuario_id) ?? 'Personal'}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-[var(--lw-gold)]">
                  {formatearSoles(registro.precio)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
