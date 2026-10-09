import { useEffect, useMemo, useState } from 'react'
import AyudaCampo from '../components/AyudaCampo.jsx'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import { ListFilter, Stamp, Ticket } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearValorCupon, nivelDeCupon } from '../lib/cupones.js'
import Etiqueta from '../components/Etiqueta.jsx'
import EnvolturaCupon from '../components/EnvolturaCupon.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const formularioVacio = {
  porcentajeRecompensa: '20',
}

const ETIQUETAS_ESTADO = {
  DISPONIBLE: { texto: 'Disponible', clase: 'bg-amber/15 text-amber' },
  CANJEADO: { texto: 'Canjeado', clase: 'bg-green/15 text-green' },
  ANULADO: { texto: 'Anulado', clase: 'bg-ink/10 text-ink/50' },
}

// Acabado verde de los cupones de fidelización en la web de clientes.
const NIVEL_CUPON = nivelDeCupon({ origen: 'FIDELIZACION' })

const OPCIONES_FILTRO = [
  { id: 'RECIENTES', label: 'Más recientes' },
  { id: 'DISPONIBLE', label: 'Disponibles' },
  { id: 'CANJEADO', label: 'Canjeados' },
]

const normalizar = (texto) =>
  (texto ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

// Panel administrativo de "Fidelización Web" (cuelga de /web como
// "padre", admin-only, mismo patrón que Puntos Web/Referidos Web) —
// configura el % de descuento del cupón que se genera al completar una
// tarjeta de 5 sellos (§7.58, 97_cupones_fidelizacion.sql) y muestra
// los cupones ya emitidos. El progreso de sellos en sí (Básico → Premium
// no aplica acá, es la tarjeta de puntos — esto es la tarjeta de sellos)
// se sigue viendo solo desde el lado del cliente (FidelizacionCliente.jsx);
// acá solo el % y la trazabilidad de lo ya generado.
export default function FidelizacionWeb() {
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
      supabase.from('config_fidelizacion').select('porcentaje_recompensa').eq('id', 1).single(),
      // "clientes!cliente_id" desambigua: cupones tiene DOS FK a
      // clientes (cliente_id y referido_id) — mismo hint que ya usa
      // ReferidosWeb.jsx, sin él PostgREST no sabe cuál usar.
      // origen=FIDELIZACION: esta pantalla es solo de ESTOS cupones,
      // los de Referidos tienen su propia lista en Referidos Web.
      supabase
        .from('cupones')
        .select('codigo, valor, tipo_descuento, estado, creado_en, cliente:clientes!cliente_id(nombre)')
        .eq('origen', 'FIDELIZACION')
        .order('creado_en', { ascending: false }),
    ]).then(([configRes, cuponesRes]) => {
      if (configRes.data) {
        setFormulario({ porcentajeRecompensa: String(configRes.data.porcentaje_recompensa) })
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

    const porcentaje = parseFloat(formulario.porcentajeRecompensa)
    if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
      mostrarToast('El porcentaje debe estar entre 0 y 100.', 'error')
      return
    }

    setGuardando(true)
    const { error } = await supabase
      .from('config_fidelizacion')
      .update({ porcentaje_recompensa: porcentaje, actualizado_en: new Date().toISOString() })
      .eq('id', 1)

    setGuardando(false)

    if (error) {
      mostrarToast('No se pudo guardar. Intenta de nuevo.', 'error')
      return
    }

    mostrarToast('Configuración de fidelización actualizada.', 'exito')
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
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <Etiqueta htmlFor="fidelizacion-porcentaje">% de descuento del cupón</Etiqueta>
              <span className="mb-1 flex"><AyudaCampo>Define el % de descuento del cupón que se genera al completar una tarjeta de 5 sellos (1 sello por visita completada). El canje se hace en Ventas, con el mismo modo "Cupón" que ya usan los cupones de Referidos.</AyudaCampo></span>
            </div>
            <input
              id="fidelizacion-porcentaje"
              type="number"
              min="1"
              max="100"
              step="1"
              value={formulario.porcentajeRecompensa}
              onChange={(evento) => actualizarCampo('porcentajeRecompensa', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-azul-metal"
            />
          </div>
          <button
            type="submit"
            disabled={guardando}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-azul-metal px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-40"
          >
            <Stamp className="h-4 w-4" />
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
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
        <EstadoVacio icono={Stamp} mensaje="Todavía no se generó ningún cupón de fidelización." />
      ) : cuponesVisibles.length === 0 ? (
        <EstadoVacio icono={Stamp} mensaje="Ningún cupón coincide con la búsqueda o el filtro." />
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
                    <p className="truncate text-xs text-white/50">{cupon.cliente?.nombre ?? '—'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-semibold ${NIVEL_CUPON.claseTexto}`}>{formatearValorCupon(cupon)}</p>
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
