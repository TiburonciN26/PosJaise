import { useMemo, useState } from 'react'
import { ArrowBigDown, Search } from 'lucide-react'
import EnvolturaCupon from '../../../components/EnvolturaCupon.jsx'
import CampoColapsable from '../../../components/CampoColapsable.jsx'
import { estiloNivelCupon } from '../../../lib/cupones.js'
import { CATEGORIAS, NOMBRES_NIVEL, ORDEN_NIVEL, RECOMPENSAS, nivelColorRecompensa } from './datos.js'
import { AvisoError, AvisoProximamente, Encabezado, Filtro, Pildora } from './ui.jsx'

// Estado visible de una recompensa para ESTA clienta. Mientras no exista
// el RPC de canje (Fase 2), ninguna se puede canjear de verdad: aunque
// el saldo y el nivel alcancen, el estado es "Próximamente" — lo demás
// (puntos/nivel insuficiente, agotado, fuera de vigencia) sí se calcula,
// para que se vea cómo se comportará el catálogo.
// `saldo`/`nivelIdx` son null mientras el saldo no se conoce (cargando o
// con error, QA-039): entonces NO se afirma "puntos insuficientes" ni
// "nivel insuficiente" — solo lo que no depende del saldo.
function estadoRecompensa(r, { saldo, nivelIdx }) {
  if (r.estado === 'vencida') return { chip: 'Fuera de vigencia', msg: 'Esta campaña ya terminó.' }
  if (r.estado === 'agotada' || r.stock === 0) return { chip: 'Agotado', msg: 'Esta recompensa se agotó.' }
  if (r.estado === 'prox') return { chip: 'Próximamente', msg: 'Todavía no está disponible para canjear.' }
  if (nivelIdx !== null && nivelIdx < r.nivelMin) {
    return {
      chip: 'Nivel insuficiente',
      msg: `Se desbloquea al llegar al nivel ${NOMBRES_NIVEL[ORDEN_NIVEL[r.nivelMin]]}. Sube de nivel sumando puntos de clasificación.`,
    }
  }
  if (saldo !== null && saldo < r.precio) {
    const faltan = r.precio - saldo
    return { chip: `Te faltan ${faltan}`, msg: `Te faltan ${faltan} ${faltan === 1 ? 'punto' : 'puntos'} para canjearla.` }
  }
  return {
    chip: 'Próximamente',
    msg: 'El canje de puntos por cupones se activa próximamente: por ahora puedes revisar las condiciones.',
  }
}

function Fila({ r, estado, abierta, onToggle }) {
  const nivel = estiloNivelCupon(nivelColorRecompensa(r.precio))
  const Icono = r.icono
  const apagada = r.estado === 'vencida' || r.estado === 'agotada'
  const etiqueta =
    r.estado === 'acordada'
      ? 'Recompensa inicial acordada'
      : r.estado === 'prox'
        ? 'Próximamente'
        : 'Ejemplo editable · pendiente de aprobación'

  return (
    <EnvolturaCupon nivel={nivel} apagada={apagada}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierta}
        className="relative flex min-h-11 w-full items-center gap-3 p-3 text-left"
      >
        <Icono className={`h-5 w-5 shrink-0 ${nivel.claseIcono}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold leading-snug ${nivel.claseTexto}`}>{r.nombre}</p>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {etiqueta.split(' · ')[0]} · {nivel.nombre}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-semibold ${nivel.claseTexto}`}>{r.precio} pts</p>
          <p className="text-[11px] text-white/50">{estado.chip}</p>
        </div>
        <ArrowBigDown
          className={`h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-300 ${
            abierta ? 'rotate-180' : ''
          }`}
        />
      </button>

      <CampoColapsable abierto={abierta}>
        <div className="relative mx-2.5 mb-2.5 flex flex-col gap-2.5 border border-white/10 bg-black/25 p-3">
          <p className="text-[13px] leading-relaxed text-white/70">{r.desc}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-snug text-white/50">
            <dt>Beneficio</dt>
            <dd className="text-white/80">{r.beneficio}</dd>
            <dt>Compra mínima</dt>
            <dd className="text-white/80">{r.minimo}</dd>
            <dt>Aplica en</dt>
            <dd className="text-white/80">{r.aplica}</dd>
            <dt>Nivel</dt>
            <dd className="text-white/80">
              {r.nivelMin === 0 ? 'Todos los niveles' : `Desde ${NOMBRES_NIVEL[ORDEN_NIVEL[r.nivelMin]]}`}
            </dd>
            <dt>Disponibilidad</dt>
            <dd className="text-white/80">{r.stock === null ? 'Sin límite' : `Quedan ${r.stock}`}</dd>
            <dt>Vigencia</dt>
            <dd className="text-white/80">{r.vigencia}</dd>
            <dt>Combinación</dt>
            <dd className="text-white/80">{r.comb}</dd>
            <dt>Uso</dt>
            <dd className="text-white/80">Se obtiene un cupón; el beneficio se aplica en una compra posterior.</dd>
          </dl>
          <p className="text-xs leading-relaxed text-white/70">{estado.msg}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled
              className="flex w-fit items-center gap-1.5 rounded-lg border border-[var(--lw-gold)] bg-transparent px-3 py-2 text-xs font-semibold text-[var(--lw-gold)] disabled:opacity-40"
            >
              Obtener cupón
            </button>
            <Pildora>{etiqueta}</Pildora>
          </div>
        </div>
      </CampoColapsable>
    </EnvolturaCupon>
  )
}

// Canjear puntos — el catálogo usa el mismo diseño de las tarjetas de
// cupón por nivel (EnvolturaCupon, con todos sus efectos), en 2
// columnas de máx. 420 px. Los datos son de ejemplo (datos.js): no hay
// catálogo ni canje en el backend todavía, así que "Obtener cupón" está
// deshabilitado y todo está marcado como propuesta/próximamente.
export default function SeccionCanje({ sesion, puntos: recursoPuntos, onReintentarPuntos }) {
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [abierta, setAbierta] = useState(null)

  // El saldo solo existe si la consulta respondió: un error o una carga
  // pendiente nunca se muestran como "0 pts" (QA-039). Sin sesión tampoco.
  const saldoConocido = sesion && recursoPuntos?.estado === 'ok'
  const datosPuntos = saldoConocido ? recursoPuntos.datos : null
  const saldo = saldoConocido ? (datosPuntos?.puntos ?? 0) : null
  const nivelIdx = saldoConocido ? Math.max(0, ORDEN_NIVEL.indexOf(datosPuntos?.nivel ?? 'BASICO')) : null

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return RECOMPENSAS.filter(
      (r) =>
        (categoria === 'todas' || r.cat === categoria) &&
        (!texto || `${r.nombre} ${r.desc}`.toLowerCase().includes(texto)),
    )
  }, [busqueda, categoria])

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Encabezado
          titulo="Canjear puntos"
          texto="Canjear obtiene un cupón. El beneficio se aplica cuando lo uses en una compra posterior."
        />
        {saldoConocido && (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white">
            Tienes <span className="text-[var(--lw-gold)]">{saldo} pts</span> disponibles
          </span>
        )}
      </div>

      {sesion && recursoPuntos?.estado === 'error' && (
        <AvisoError
          titulo="No pudimos cargar tu saldo de puntos"
          texto="Tu saldo no cambió; solo no pudimos leerlo ahora. Puedes seguir revisando las recompensas, pero no sabremos si te alcanza hasta que cargue."
          onReintentar={onReintentarPuntos}
        />
      )}

      <AvisoProximamente>
        El catálogo y el canje todavía no están activos: estas recompensas son ejemplos para revisar sus
        condiciones. Salvo el cupón de S/5 (acordado), importes y condiciones están pendientes de aprobación.
      </AvisoProximamente>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 max-w-[420px] flex-[1_1_260px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5">
          <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
          <span className="sr-only">Buscar recompensas</span>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar recompensas"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map((c) => (
            <Filtro key={c.clave} activo={categoria === c.clave} onClick={() => setCategoria(c.clave)}>
              {c.label}
            </Filtro>
          ))}
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="liquid-glass flex flex-col items-center gap-3 rounded-none px-6 py-10 text-center">
          <strong className="text-base text-white">No encontramos recompensas con esa búsqueda</strong>
          <span className="text-sm text-white/60">Prueba con otra palabra o quita el filtro de categoría.</span>
          <button
            type="button"
            onClick={() => {
              setBusqueda('')
              setCategoria('todas')
            }}
            className="min-h-11 rounded-full border border-[#3a3a3f] px-5 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
          >
            Borrar búsqueda y filtros
          </button>
        </div>
      ) : (
        <div className="grid items-start justify-center gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),420px))]">
          {visibles.map((r) => (
            <Fila
              key={r.id}
              r={r}
              estado={estadoRecompensa(r, { saldo, nivelIdx })}
              abierta={abierta === r.id}
              onToggle={() => setAbierta((actual) => (actual === r.id ? null : r.id))}
            />
          ))}
        </div>
      )}
    </section>
  )
}
