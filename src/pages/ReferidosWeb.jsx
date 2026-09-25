import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearSoles } from '../lib/moneda.js'
import Etiqueta from '../components/Etiqueta.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const formularioVacio = {
  creditoReferidor: '15',
  creditoReferido: '10',
}

const ETIQUETAS_ORIGEN = {
  REFERIDO_BIENVENIDA: 'Cupón de bienvenida',
  REFERIDO_RECOMPENSA: 'Cupón por referir',
}

const ETIQUETAS_ESTADO = {
  DISPONIBLE: { texto: 'Disponible', clase: 'bg-amber/15 text-amber' },
  CANJEADO: { texto: 'Canjeado', clase: 'bg-green/15 text-green' },
  ANULADO: { texto: 'Anulado', clase: 'bg-ink/10 text-ink/50' },
}

// Panel administrativo de "Referidos Web" (cuelga de /web como "padre",
// admin-only, junto a Puntos Web) — configura el crédito en soles que
// gana cada lado y muestra los cupones emitidos (§7.26/§7.27,
// 94_referidos.sql + 95_cupones_referido.sql). El cupón de bienvenida
// nace al ingresar un código; el cupón de recompensa de quien invitó
// nace recién cuando ESE cupón de bienvenida se canjea de verdad en una
// venta — acá solo hay visibilidad, el canje en sí pasa por el nuevo
// modo "Cupón" del botón de descuento en Ventas.jsx (pide el código,
// nunca un monto a mano).
export default function ReferidosWeb() {
  const { mostrarToast } = useToast()
  const [formulario, setFormulario] = useState(formularioVacio)
  const [cupones, setCupones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase
        .from('config_referidos')
        .select('credito_referidor, credito_referido')
        .eq('id', 1)
        .single(),
      supabase
        .from('cupones')
        // "clientes!cliente_id" desambigua: cupones tiene DOS FK a
        // clientes (cliente_id y referido_id) — sin el hint del FK,
        // PostgREST no sabe cuál usar y el select falla entero.
        // .in(...) (§7.58): desde que existen los cupones de
        // Fidelización, sin este filtro se mezclaban acá también —
        // esta pantalla es solo de los de Referidos, Fidelización
        // tiene su propia lista en Fidelización Web.
        .select('codigo, origen, valor, estado, creado_en, cliente:clientes!cliente_id(nombre)')
        .in('origen', ['REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA'])
        .order('creado_en', { ascending: false }),
    ]).then(([configRes, cuponesRes]) => {
      if (configRes.data) {
        setFormulario({
          creditoReferidor: String(configRes.data.credito_referidor),
          creditoReferido: String(configRes.data.credito_referido),
        })
      }
      setCupones(cuponesRes.data ?? [])
      setCargando(false)
    })
  }, [])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()
    setGuardando(true)

    const { error } = await supabase
      .from('config_referidos')
      .update({
        credito_referidor: parseFloat(formulario.creditoReferidor) || 0,
        credito_referido: parseFloat(formulario.creditoReferido) || 0,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', 1)

    setGuardando(false)

    if (error) {
      mostrarToast('No se pudo guardar. Intenta de nuevo.', 'error')
      return
    }

    mostrarToast('Configuración de referidos actualizada.', 'exito')
  }

  if (cargando) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-ink/60">Cargando...</p>
      </div>
    )
  }

  return (
    <div
      className="animate-entrada-pestana mx-auto w-full max-w-lg p-3 pb-6"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        <Gift className="h-8 w-8 text-red" />
        <p className="text-base font-semibold text-red">Referidos Web</p>
        <p className="max-w-sm text-sm text-ink/60">
          Define cuánto vale el cupón de bienvenida y el de recompensa. El cupón de quien invita
          recién se crea cuando el de bienvenida se canjea de verdad en una venta — en Ventas, el
          botón de descuento tiene un modo "Cupón" que pide el código, no hace falta buscarlo acá.
        </p>
      </div>

      <form onSubmit={guardar} className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <Etiqueta htmlFor="referido-credito-referidor">Crédito (S/) para quien invita</Etiqueta>
          <input
            id="referido-credito-referidor"
            type="number"
            min="0"
            step="1"
            value={formulario.creditoReferidor}
            onChange={(evento) => actualizarCampo('creditoReferidor', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="referido-credito-referido">Crédito (S/) para quien se registra</Etiqueta>
          <input
            id="referido-credito-referido"
            type="number"
            min="0"
            step="1"
            value={formulario.creditoReferido}
            onChange={(evento) => actualizarCampo('creditoReferido', evento.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-red"
          />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Gift className="h-4 w-4" />
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </form>

      <p className="mt-6 text-sm font-semibold text-ink">Cupones emitidos</p>
      {cupones.length === 0 ? (
        <EstadoVacio icono={Gift} mensaje="Todavía no se emitió ningún cupón." />
      ) : (
        <div className="mt-2 space-y-2">
          {cupones.map((cupon) => {
            const etiquetaEstado = ETIQUETAS_ESTADO[cupon.estado] ?? ETIQUETAS_ESTADO.DISPONIBLE
            return (
              <div
                key={cupon.codigo}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-ink">{cupon.cliente?.nombre ?? '—'}</p>
                  <p className="truncate text-xs text-ink/50">
                    {ETIQUETAS_ORIGEN[cupon.origen] ?? cupon.origen} · <span className="font-mono">{cupon.codigo}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-red">{formatearSoles(cupon.valor)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${etiquetaEstado.clase}`}>
                    {etiquetaEstado.texto}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
