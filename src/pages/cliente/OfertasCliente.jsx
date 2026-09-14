import { useEffect, useState } from 'react'
import { Ticket } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { formatearSoles } from '../../lib/moneda.js'

function formatearValor(promocion) {
  return promocion.tipo_descuento === 'PORCENTAJE'
    ? `${promocion.valor}% dcto.`
    : `${formatearSoles(promocion.valor)} dcto.`
}

function formatearFecha(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Solo lectura — las crea el personal desde /promociones (POS). RLS
// (promociones_select_web, 79_promociones.sql) ya filtra activas y
// vigentes, así que acá no hay que repetir ese filtro.
export default function OfertasCliente() {
  const [promociones, setPromociones] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    supabase
      .from('promociones')
      .select('id, titulo, descripcion, tipo_descuento, valor, vigente_hasta')
      .order('creado_en', { ascending: false })
      .then(({ data }) => {
        if (!vigente) return
        setPromociones(data ?? [])
        setCargando(false)
      })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-ink/60">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-md">
        {promociones.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Ticket className="h-8 w-8 text-ink/30" />
            <p className="text-sm text-ink/60">No hay ofertas activas por ahora.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {promociones.map((promocion) => (
              <div
                key={promocion.id}
                className="rounded-lg border border-amber/40 bg-amber/10 p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{promocion.titulo}</p>
                  <span className="shrink-0 rounded-full bg-amber px-2 py-0.5 text-[11px] font-semibold text-bg">
                    {formatearValor(promocion)}
                  </span>
                </div>
                {promocion.descripcion && (
                  <p className="mt-1 text-sm text-ink/70">{promocion.descripcion}</p>
                )}
                {promocion.vigente_hasta && (
                  <p className="mt-1.5 text-xs text-ink/50">
                    Válido hasta el {formatearFecha(promocion.vigente_hasta)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
