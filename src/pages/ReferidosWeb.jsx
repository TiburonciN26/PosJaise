import { useEffect, useMemo, useState } from 'react'
import AyudaCampo from '../components/AyudaCampo.jsx'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import { Gift, ListFilter, Ticket } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearSoles } from '../lib/moneda.js'
import { nivelDeCupon } from '../lib/cupones.js'
import Etiqueta from '../components/Etiqueta.jsx'
import EnvolturaCupon from '../components/EnvolturaCupon.jsx'
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

// Acabado verde de los cupones de referidos en la web de clientes.
const NIVEL_CUPON = nivelDeCupon({ origen: 'REFERIDO_BIENVENIDA' })

const OPCIONES_FILTRO = [
  { id: 'RECIENTES', label: 'Más recientes' },
  { id: 'DISPONIBLE', label: 'Disponibles' },
  { id: 'CANJEADO', label: 'Canjeados' },
]

const normalizar = (texto) =>
  (texto ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

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
  const [filtro, setFiltro] = useState('RECIENTES')
  const [busqueda, setBusqueda] = useState('')

  // La consulta ya llega ordenada por creado_en desc, así que "Más recientes"
  // es el orden base y los otros filtros solo recortan por estado.
  const cuponesVisibles = useMemo(() => {
    const consulta = normalizar(busqueda)
    return cupones.filter((cupon) => {
      if (filtro !== 'RECIENTES' && cupon.estado !== filtro) return false
      if (!consulta) return true
      return normalizar(cupon.codigo).includes(consulta) || normalizar(cupon.cliente?.nombre).includes(consulta)
    })
  }, [cupones, filtro, busqueda])

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
      className="relative animate-entrada-pestana px-(--separador-vertical) pb-6 pt-(--separador-horizontal) lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-azul-metal)' }}
    >
      <form onSubmit={guardar} className="rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
        <div className="space-y-3">
          <div className="min-w-0">
            <Etiqueta htmlFor="referido-credito-referidor">Crédito (S/) para quien invita</Etiqueta>
            <input
              id="referido-credito-referidor"
              type="number"
              min="0"
              step="1"
              value={formulario.creditoReferidor}
              onChange={(evento) => actualizarCampo('creditoReferidor', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-azul-metal"
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <Etiqueta htmlFor="referido-credito-referido">Crédito (S/) para quien se registra</Etiqueta>
              <span className="mb-1 flex"><AyudaCampo>Define cuánto vale el cupón de bienvenida y el de recompensa. El cupón de quien invita recién se crea cuando el de bienvenida se canjea de verdad en una venta — en Ventas, el botón de descuento tiene un modo "Cupón" que pide el código, no hace falta buscarlo acá.</AyudaCampo></span>
            </div>
            <input
              id="referido-credito-referido"
              type="number"
              min="0"
              step="1"
              value={formulario.creditoReferido}
              onChange={(evento) => actualizarCampo('creditoReferido', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-azul-metal"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-azul-metal px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-40"
        >
          <Gift className="h-4 w-4" />
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </form>

      <div className="relative mt-(--separador-horizontal) flex items-center gap-2">
        <p className="w-min shrink-0 text-sm font-semibold leading-tight text-ink sm:w-auto">Cupones emitidos</p>
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Código o cliente"
          tema="azul-metal"
          sinVoz
        />
        <SelectorOrden
          opciones={OPCIONES_FILTRO}
          valor={filtro}
          onCambiar={setFiltro}
          tema="azul-metal"
          icono={ListFilter}
          ariaLabel="Filtrar cupones"
        />
      </div>

      {cupones.length === 0 ? (
        <EstadoVacio icono={Gift} mensaje="Todavía no se emitió ningún cupón." />
      ) : cuponesVisibles.length === 0 ? (
        <EstadoVacio icono={Gift} mensaje="Ningún cupón coincide con la búsqueda o el filtro." />
      ) : (
        <div className="mt-2 space-y-2 px-[calc(var(--separador-vertical-secundario)*2)] py-[calc(var(--separador-horizontal-secundario)*2)]">
          {cuponesVisibles.map((cupon) => {
            const etiquetaEstado = ETIQUETAS_ESTADO[cupon.estado] ?? ETIQUETAS_ESTADO.DISPONIBLE
            return (
              <EnvolturaCupon key={cupon.codigo} nivel={NIVEL_CUPON} apagada={cupon.estado !== 'DISPONIBLE'}>
                <div className="relative flex items-center gap-3 p-3">
                  <Ticket className={`h-5 w-5 shrink-0 ${NIVEL_CUPON.claseIcono}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`font-mono text-base font-semibold tracking-widest ${NIVEL_CUPON.claseTexto}`}>{cupon.codigo}</p>
                    <p className="truncate text-xs text-white/50">
                      {cupon.cliente?.nombre ?? '—'} · {ETIQUETAS_ORIGEN[cupon.origen] ?? cupon.origen}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-semibold ${NIVEL_CUPON.claseTexto}`}>{formatearSoles(cupon.valor)}</p>
                    <p className="text-[11px] text-white/50">{etiquetaEstado.texto}</p>
                  </div>
                </div>
              </EnvolturaCupon>
            )
          })}
        </div>
      )}
    </div>
  )
}
