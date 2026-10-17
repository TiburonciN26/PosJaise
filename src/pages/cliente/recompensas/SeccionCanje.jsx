import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import EnvolturaCupon from '../../../components/EnvolturaCupon.jsx'
import { estiloNivelDeNegocio, nivelDeCupon } from '../../../lib/cupones.js'
import { CATEGORIAS, NOMBRES_NIVEL, ORDEN_NIVEL, RECOMPENSAS } from './datos.js'
import { AvisoError, AvisoProximamente, Cargando, Filtro } from './ui.jsx'
import { REGLA_CUPONES, REGLA_MONEDAS, REGLA_PROTECCION, formatearMonedas, premioAItem } from './lib.js'
import ConfirmarCanje from './ConfirmarCanje.jsx'
import SelectorDesplegable from './SelectorDesplegable.jsx'

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

function nivelDeItem(r) {
  return nivelDeCupon({ origen: r.premio?.origen ?? r.origen, nivel_minimo: ORDEN_NIVEL[r.nivelMin] })
}

function Fila({ r, estado, abierta, onToggle, onObtener }) {
  // QA-064: el color es el nivel de negocio del premio (el que decide quién lo canjea), no su costo.
  const nivel = nivelDeItem(r)
  const apagada = r.estado === 'vencida' || r.estado === 'agotada'
  const etiqueta = r.real
    ? 'Recompensa publicada'
    : r.estado === 'acordada'
      ? 'Recompensa inicial acordada'
      : r.estado === 'prox'
        ? 'Próximamente'
        : 'Ejemplo editable · pendiente de aprobación'

  return (
    <EnvolturaCupon nivel={nivel} apagada={apagada} abierto={abierta} onToggle={onToggle}
      titulo={r.nombre} subtitulo={etiqueta.split(' · ')[0]} estado={estado.chip}
      etiquetaBeneficio={r.real ? 'Monedas' : 'Puntos'}
      valor={<span className="cpi-valor cpi-valor-monto">{r.real ? formatearMonedas(r.precio) : r.precio}</span>}
      pie={<div className="flex flex-col gap-2">
        <button type="button" disabled={!r.real || !r.canjeable}
          onClick={r.real && r.canjeable ? () => onObtener(r.premio) : undefined}
          className="cpi-reclamar">Obtener cupón</button>
        {!r.real && <span className="cpi-ayuda">{etiqueta}</span>}
      </div>}>
      <div data-premio-id={r.real ? r.id : undefined}>
          <p className="cpi-descripcion">{r.desc}</p>
          <dl className="cpi-datos">
            <dt>Beneficio</dt>
            <dd>{r.beneficio}</dd>
            <dt>Compra mínima</dt>
            <dd>{r.minimo}</dd>
            <dt>Aplica en</dt>
            <dd>{r.aplica}</dd>
            <dt>Nivel</dt>
            <dd>
              {r.nivelMin === 0 ? 'Todos los niveles' : `Desde ${NOMBRES_NIVEL[ORDEN_NIVEL[r.nivelMin]]}`}
            </dd>
            <dt>Disponibilidad</dt>
            <dd>{r.stock === null ? 'Sin límite' : `Quedan ${r.stock}`}</dd>
            <dt>Vigencia</dt>
            <dd>{r.vigencia}</dd>
            <dt>Combinación</dt>
            <dd>{r.comb}</dd>
            {r.real && (
              <>
                <dt>Reclamo</dt>
                <dd>{r.reclamo}</dd>
              </>
            )}
            {r.pagoMinimo && (
              <>
                <dt>Pago mínimo</dt>
                <dd>{r.pagoMinimo}</dd>
              </>
            )}
            <dt>Uso</dt>
            <dd>Se obtiene un cupón; el beneficio se aplica en una compra posterior.</dd>
          </dl>
          <p className="cpi-descripcion">{estado.msg}</p>

      </div>
    </EnvolturaCupon>
  )
}

// Canjear puntos — el catálogo usa el mismo diseño de las tarjetas de
// cupón por nivel (EnvolturaCupon, con todos sus efectos), en 2
// columnas de máx. 440 px.
//
// Dos modos, según el backend:
//  * REAL (Fase 2): el programa está activo y hay catálogo publicado. Con sesión se
//    lee mi_catalogo_recompensas() (costo del nivel, disponibilidad, pago mínimo) y el
//    canje pide confirmación (ConfirmarCanje). Sin sesión se lee el catálogo público
//    (solo lectura, sin costos internos ni datos personales).
//  * EJEMPLO (Fase 1): programa apagado o sin catálogo público. Los datos son de
//    ejemplo (datos.js) y «Obtener cupón» está deshabilitado: nada se presenta como real.
export default function SeccionCanje({
  sesion,
  userId,
  puntos: recursoPuntos,
  onReintentarPuntos,
  saldo: recursoSaldo,
  catalogo: recursoCatalogo,
  catalogoPublico,
  onReintentarSaldo,
  onReintentarCatalogo,
  onReintentarCatalogoPublico,
  onCanjeExitoso,
}) {
  const [busqueda, setBusqueda] = useState('')
  const [filtroElegido, setFiltroElegido] = useState(null)
  const [abierta, setAbierta] = useState(null)
  const [confirmando, setConfirmando] = useState(null)

  function elegirCategoria(clave) {
    setFiltroElegido({ cuenta: userId ?? null, categoria: clave })
  }

  const saldoReal = sesion && recursoSaldo?.estado === 'ok' ? recursoSaldo.datos : null
  const programaActivo = Boolean(saldoReal?.activo)
  const publicoReal = !sesion && catalogoPublico?.estado === 'ok' && catalogoPublico.datos.some((p) => p.origen === 'MONEDAS')

  // Estado de las lecturas nuevas (QA-039: un error nunca es un catálogo vacío).
  const cargandoModo = sesion ? recursoSaldo?.estado === 'cargando' : catalogoPublico?.estado === 'cargando'
  const errorModo = sesion ? recursoSaldo?.estado === 'error' : catalogoPublico?.estado === 'error'
  const modoReal = sesion ? programaActivo : publicoReal

  // El saldo solo existe si la consulta respondió: un error o una carga
  // pendiente nunca se muestran como "0 pts" (QA-039). Sin sesión tampoco.
  const saldoConocido = sesion && recursoPuntos?.estado === 'ok'
  const datosPuntos = saldoConocido ? recursoPuntos.datos : null
  const saldo = saldoConocido ? (datosPuntos?.puntos ?? 0) : null
  const nivelIdx = saldoConocido ? Math.max(0, ORDEN_NIVEL.indexOf(datosPuntos?.nivel ?? 'BASICO')) : null
  const nivelActual = sesion ? (programaActivo ? saldoReal.nivel : datosPuntos?.nivel) : null
  const categoriaInicial = ORDEN_NIVEL.includes(nivelActual) ? estiloNivelDeNegocio(nivelActual).categoria : 'todas'
  // El nivel puede llegar después del catálogo. Solo determina la selección
  // inicial: una elección manual nunca se pisa al terminar una lectura.
  const categoria = filtroElegido?.cuenta === (userId ?? null) ? filtroElegido.categoria : categoriaInicial

  const items = useMemo(() => {
    if (!modoReal) return RECOMPENSAS
    if (sesion) return recursoCatalogo?.estado === 'ok' ? recursoCatalogo.datos.map((p) => premioAItem(p)) : []
    return catalogoPublico.datos.filter((p) => p.origen === 'MONEDAS').map((p) => premioAItem(p, { publico: true }))
  }, [modoReal, sesion, recursoCatalogo, catalogoPublico])

  const categorias = CATEGORIAS

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return items.filter(
      (r) =>
        (categoria === 'todas' || nivelDeItem(r).categoria === categoria) &&
        (!texto || `${r.nombre} ${r.desc}`.toLowerCase().includes(texto)),
    )
  }, [items, busqueda, categoria])

  function estadoDe(r) {
    if (r.real) {
      return r.canjeable
        ? { chip: 'Disponible', msg: r.pagoMinimo ?? 'Puedes canjearla ahora. El canje es definitivo.' }
        : { chip: r.motivo ?? 'No disponible', msg: r.motivo ?? 'No está disponible por ahora.' }
    }
    return estadoRecompensa(r, { saldo, nivelIdx })
  }

  return (
    <section className="flex flex-col gap-5">
      {(Boolean(modoReal && saldoReal) || saldoConocido) && (
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {modoReal && saldoReal ? (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white">
            Tienes <span className="text-[var(--lw-gold)]">{formatearMonedas(saldoReal.monedas)} monedas</span> disponibles
          </span>
        ) : (
          saldoConocido && (
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white">
              Tienes <span className="text-[var(--lw-gold)]">{saldo} pts</span> disponibles
            </span>
          )
        )}
      </div>
      )}

      {sesion && errorModo && (
        <AvisoError
          titulo="No pudimos cargar tu saldo de monedas"
          texto="Tu saldo no cambió; solo no pudimos leerlo ahora. Inténtalo de nuevo."
          onReintentar={onReintentarSaldo}
        />
      )}
      {!sesion && errorModo && (
        <AvisoError
          titulo="No pudimos cargar el catálogo"
          texto="El catálogo no cambió; solo no pudimos leerlo ahora."
          onReintentar={onReintentarCatalogoPublico}
        />
      )}
      {sesion && modoReal && recursoCatalogo?.estado === 'error' && (
        <AvisoError
          titulo="No pudimos cargar las recompensas"
          texto="Tu saldo y tus cupones no cambiaron; solo no pudimos leer el catálogo ahora."
          onReintentar={onReintentarCatalogo}
        />
      )}

      {sesion && modoReal && saldoReal && Number(saldoReal.monedas) < 0 && (
        <p role="status" className="border border-white/20 px-4 py-3 text-[13px] leading-relaxed text-white/80">
          Tu saldo de monedas es negativo por una venta anulada. Se compensa con tus próximas compras; mientras tanto
          no puedes canjear.
        </p>
      )}

      {!modoReal && !errorModo && (sesion && recursoPuntos?.estado === 'error') && (
        <AvisoError
          titulo="No pudimos cargar tu saldo de puntos"
          texto="Tu saldo no cambió; solo no pudimos leerlo ahora. Puedes seguir revisando las recompensas, pero no sabremos si te alcanza hasta que cargue."
          onReintentar={onReintentarPuntos}
        />
      )}

      {modoReal ? (
        <div className="flex flex-col gap-1 border border-white/10 bg-white/[0.02] px-5 py-4 text-[13px] leading-relaxed text-white/60">
          <span>{REGLA_MONEDAS}</span>
          <span>{REGLA_CUPONES}</span>
          <span>{REGLA_PROTECCION}</span>
        </div>
      ) : (
        !cargandoModo && (
          <AvisoProximamente>
            El catálogo y el canje todavía no están activos: estas recompensas son ejemplos para revisar sus
            condiciones. Salvo el cupón de S/5 (acordado), importes y condiciones están pendientes de aprobación.
          </AvisoProximamente>
        )
      )}

      {cargandoModo && <Cargando />}

      {!cargandoModo && !(sesion && errorModo) && !(!sesion && errorModo) && (
        <>
          <div className="flex items-center gap-3 sm:flex-wrap">
            <label className="flex min-h-11 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 sm:flex-[1_1_260px]">
              <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
              <span className="sr-only">Buscar recompensas</span>
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar recompensas"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40 max-sm:placeholder:text-transparent"
              />
            </label>
            <SelectorDesplegable className="shrink-0" opciones={categorias} valor={categoria}
              onSeleccionar={elegirCategoria} etiqueta="Filtrar recompensas" etiquetaLista="Categorías de recompensas" />
            <div className="hidden flex-wrap gap-2 sm:flex">
              {categorias.map((c) => (
                <Filtro key={c.clave} activo={categoria === c.clave} onClick={() => elegirCategoria(c.clave)}>
                  {c.label}
                </Filtro>
              ))}
            </div>
          </div>

          {modoReal && items.length === 0 && recursoCatalogo?.estado !== 'error' ? (
            <div className="liquid-glass flex flex-col items-center gap-2 rounded-none px-6 py-10 text-center">
              <strong className="text-base text-white">Todavía no hay recompensas publicadas</strong>
              <span className="text-sm text-white/60">Vuelve pronto: tus monedas se conservan y no vencen.</span>
            </div>
          ) : visibles.length === 0 ? (
            <div className="liquid-glass flex flex-col items-center gap-3 rounded-none px-6 py-10 text-center">
              <strong className="text-base text-white">No encontramos recompensas con esa búsqueda</strong>
              <span className="text-sm text-white/60">Prueba con otra palabra o quita el filtro de categoría.</span>
              <button
                type="button"
                onClick={() => {
                  setBusqueda('')
                  elegirCategoria('todas')
                }}
                className="min-h-11 rounded-full border border-[#3a3a3f] px-5 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
              >
                Borrar búsqueda y filtros
              </button>
            </div>
          ) : (
            <div className="grid items-start justify-center gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),440px))]">
              {visibles.map((r) => (
                <Fila
                  key={r.id}
                  r={r}
                  estado={estadoDe(r)}
                  abierta={abierta === r.id}
                  onToggle={() => setAbierta((actual) => (actual === r.id ? null : r.id))}
                  onObtener={(premio) => setConfirmando(premio)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {confirmando && saldoReal && (
        <ConfirmarCanje
          premio={confirmando}
          origen="MONEDAS"
          saldo={saldoReal}
          userId={userId}
          onCerrar={() => setConfirmando(null)}
          onExito={onCanjeExitoso}
        />
      )}
    </section>
  )
}
