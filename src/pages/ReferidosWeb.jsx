import { useEffect, useState } from 'react'
import AyudaCampo from '../components/AyudaCampo.jsx'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import { Gift, ListFilter } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { confirmarGuardado, envioDe } from '../lib/formulariosProtegidos.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearSoles } from '../lib/moneda.js'
import { nivelDeCupon } from '../lib/cupones.js'
import Etiqueta from '../components/Etiqueta.jsx'
import EnvolturaCupon from '../components/EnvolturaCupon.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import PaginadorLista from '../components/PaginadorLista.jsx'
import { useCuponesAdmin } from '../hooks/useCuponesAdmin.js'
import { ORIGENES_REFERIDOS } from '../lib/listasAdmin.js'

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

// Panel administrativo de "Referidos Web" (cuelga de /web como "padre",
// admin-only, junto a Puntos Web) — configura el crédito en soles que
// gana cada lado y muestra los cupones emitidos (§7.26/§7.27,
// 94_referidos.sql + 95_cupones_referido.sql). El cupón de bienvenida
// nace al ingresar un código; el cupón de recompensa de quien invitó
// nace recién cuando ESE cupón de bienvenida se canjea de verdad en una
// venta — acá solo hay visibilidad, el canje en sí pasa por el nuevo
// modo "Cupón" del botón de descuento en Ventas.jsx (pide el código,
// nunca un monto a mano).
export default function ReferidosWeb({ activo = true }) {
  const { mostrarToast } = useToast()
  const [formulario, setFormulario] = useState(formularioVacio)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  // Fase 5: los cupones emitidos se leen paginados (hasta 40 por página) con filtro, búsqueda y contadores globales del
  // servidor; la configuración (crédito de cada lado) es una sola fila y se lee aparte.
  const { lista, filtro, setFiltro, busqueda, setBusqueda, termino, estado, conteos } = useCuponesAdmin({ origenes: ORIGENES_REFERIDOS, activo, claveVista: '/referidos-web' })

  useEffect(() => {
    supabase
      .from('config_referidos')
      .select('credito_referidor, credito_referido')
      .eq('id', 1)
      .single()
      .then((configRes) => {
        if (configRes.data) {
          setFormulario({
            creditoReferidor: String(configRes.data.credito_referidor),
            creditoReferido: String(configRes.data.credito_referido),
          })
        }
        setCargando(false)
      })
  }, [])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()
    const envio = envioDe(evento.currentTarget) // Fase 6: la caché de pestañas libera ESTE formulario solo al confirmarse
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

    confirmarGuardado(envio)
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

      {conteos && (
        <p className="mt-1 font-mono text-xs text-ink/60" data-conteos>
          {conteos.DISPONIBLE + conteos.CANJEADO + conteos.ANULADO} emitidos · {conteos.DISPONIBLE} disponibles · {conteos.CANJEADO} canjeados
          {conteos.ANULADO > 0 ? ` · ${conteos.ANULADO} anulados` : ''}
        </p>
      )}

      {lista.fallo && (
        <p role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          No se pudo cargar los cupones.{' '}
          <button type="button" onClick={lista.recargar} className="underline">
            Reintentar
          </button>
        </p>
      )}

      {lista.cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando...</p>
      ) : lista.error ? null : lista.total === 0 && !termino && !estado ? (
        <EstadoVacio icono={Gift} mensaje="Todavía no se emitió ningún cupón." />
      ) : lista.filas.length === 0 ? (
        <EstadoVacio icono={Gift} mensaje="Ningún cupón coincide con la búsqueda o el filtro." />
      ) : (
        <div className={`mt-2 space-y-2 px-[calc(var(--separador-vertical-secundario)*2)] py-[calc(var(--separador-horizontal-secundario)*2)] transition-opacity ${lista.ocupado ? 'opacity-60' : ''}`}>
          {lista.filas.map((cupon) => {
            const etiquetaEstado = ETIQUETAS_ESTADO[cupon.estado] ?? ETIQUETAS_ESTADO.DISPONIBLE
            return (
              <EnvolturaCupon key={cupon.id} nivel={NIVEL_CUPON}
                apagada={cupon.estado !== 'DISPONIBLE'} titulo={cupon.codigo}
                estado={etiquetaEstado.texto} subtitulo={`${cupon.cliente_nombre ?? '—'} · ${ETIQUETAS_ORIGEN[cupon.origen] ?? cupon.origen}`}
                valor={<span className="cpi-valor cpi-valor-monto">{formatearSoles(cupon.valor)}</span>}>
                <dl className="cpi-datos"><dt>Clienta</dt><dd>{cupon.cliente_nombre ?? '—'}</dd><dt>Estado</dt><dd>{etiquetaEstado.texto}</dd></dl>
              </EnvolturaCupon>
            )
          })}
        </div>
      )}

      {!lista.cargando && !lista.error && (
        <PaginadorLista
          pagina={lista.pagina}
          totalPaginas={lista.totalPaginas}
          total={lista.total}
          tam={lista.tam}
          ocupado={lista.ocupado}
          onPagina={lista.irA}
          etiqueta="cupones"
        />
      )}
    </div>
  )
}
