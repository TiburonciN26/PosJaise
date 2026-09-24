import { useEffect, useState } from 'react'
import { Ticket } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { formatearSoles } from '../../lib/moneda.js'
import { useCuponesNuevos } from '../../hooks/useCuponesNuevos.js'
import TarjetaCupon from '../../components/TarjetaCupon.jsx'

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

// "Cupones y ofertas" — junta DOS cosas distintas a propósito, cada una
// con su propia sección: tus cupones personales (uno por cada uno que
// ganaste, sin importar cómo — hoy solo Referidos los genera, ver
// implementacionesWed.md §7.32; `mis_cupones()` es la misma fuente que
// usa ReferidosCliente.jsx, así que un cupón se ve y se marca canjeado
// igual en las dos pantallas, sin nada que sincronizar) y las ofertas
// generales del salón (`promociones`, solo lectura, las crea el
// personal desde /promociones en el POS — sin código, sin dueño, se
// aplican a mano en Ventas, no pasan por el modo "Cupón").
export default function OfertasCliente() {
  const [promociones, setPromociones] = useState([])
  const [cupones, setCupones] = useState([])
  const [cargando, setCargando] = useState(true)
  const cuponesNuevos = useCuponesNuevos(cupones)

  useEffect(() => {
    let vigente = true

    Promise.all([
      supabase
        .from('promociones')
        .select('id, titulo, descripcion, tipo_descuento, valor, vigente_hasta')
        .order('creado_en', { ascending: false }),
      supabase.rpc('mis_cupones'),
    ]).then(([promocionesRes, cuponesRes]) => {
      if (!vigente) return
      setPromociones(promocionesRes.data ?? [])
      setCupones(cuponesRes.data ?? [])
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

  const sinNada = promociones.length === 0 && cupones.length === 0

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-2xl">
        {sinNada ? (
          <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-12 text-center">
            <Ticket className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/50">No tienes cupones ni hay ofertas activas por ahora.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {cupones.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-white">Tus cupones</p>
                <div className="space-y-2">
                  {cupones.map((cupon) => (
                    <TarjetaCupon key={cupon.id} cupon={cupon} esNuevo={cuponesNuevos.has(cupon.id)} />
                  ))}
                </div>
              </div>
            )}

            {promociones.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-white">Ofertas del salón</p>
                <div className="space-y-3">
                  {promociones.map((promocion) => (
                    <div key={promocion.id} className="liquid-glass rounded-none p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{promocion.titulo}</p>
                        <span className="shrink-0 rounded-full bg-[var(--lw-gold)] px-2 py-0.5 text-[11px] font-semibold text-black">
                          {formatearValor(promocion)}
                        </span>
                      </div>
                      {promocion.descripcion && (
                        <p className="mt-1 text-sm text-white/70">{promocion.descripcion}</p>
                      )}
                      {promocion.vigente_hasta && (
                        <p className="mt-1.5 text-xs text-white/50">
                          Válido hasta el {formatearFecha(promocion.vigente_hasta)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
