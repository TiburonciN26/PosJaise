import { Component, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { esErrorDeCarga } from '../lib/moduloDiferido.js'
import { usePendientes } from '../lib/trabajoPendiente.js'

// Fase 8 V2 (F8-01): límite de error LOCAL para una pantalla o ventana que se carga con import().
//
// Antes, si el código de una pantalla no llegaba (sin red, o la publicación de una versión nueva retiró los archivos de la
// que está abierta), el error subía hasta el ErrorBoundary global de main.jsx, que reemplazaba TODA la app: se desmontaban
// Layout y CarritoProvider (la venta en curso, que vive solo en memoria, se perdía) y también el aviso de actualización.
// Este límite deja el fallo dentro de la pantalla/ventana que lo causó: el menú, el carrito y el resto de pestañas siguen
// montados. Nunca recarga solo. Reintenta al pulsar «Reintentar», al volver la red y al volver a mostrar la pestaña; ofrece
// recargar la página únicamente cuando no hay trabajo pendiente que se perdería.
//
// Props: `variante` 'pantalla' | 'ventana'; `activa` (pestaña visible); `clave` (si cambia, p. ej. la ruta, se vuelve a
// intentar); `onReintentar` (descarta el rechazo guardado del módulo); `volver` { a, etiqueta } (enlace a una pantalla
// segura); `onCerrar` (ventana); `tono` 'portal' para el texto claro de la web de clientas.
export default class LimiteCargaDiferida extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reintentar = this.reintentar.bind(this)
    this.alVolverLaRed = this.alVolverLaRed.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Error en una pantalla o ventana (se muestra en su lugar, el resto de la app sigue):', error, info?.componentStack)
  }

  componentDidMount() {
    window.addEventListener('online', this.alVolverLaRed)
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.alVolverLaRed)
  }

  componentDidUpdate(previas) {
    if (!this.state.error) return
    const otraClave = this.props.clave !== previas.clave
    const vuelveAVerse = this.props.activa !== false && previas.activa === false
    if (otraClave || (vuelveAVerse && esErrorDeCarga(this.state.error))) this.reintentar()
  }

  alVolverLaRed() {
    if (this.state.error && this.props.activa !== false && esErrorDeCarga(this.state.error)) this.reintentar()
  }

  reintentar() {
    this.props.onReintentar?.()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <AvisoCargaFallida
        error={this.state.error}
        variante={this.props.variante ?? 'pantalla'}
        tono={this.props.tono}
        volver={this.props.volver}
        onReintentar={this.reintentar}
        onCerrar={this.props.onCerrar}
      />
    )
  }
}

const suscribirRed = (avisar) => {
  window.addEventListener('online', avisar)
  window.addEventListener('offline', avisar)
  return () => {
    window.removeEventListener('online', avisar)
    window.removeEventListener('offline', avisar)
  }
}

function AvisoCargaFallida({ error, variante, tono, volver, onReintentar, onCerrar }) {
  const enLinea = useSyncExternalStore(suscribirRed, () => navigator.onLine, () => true)
  const pendientes = [...new Set(usePendientes())]
  const esVentana = variante === 'ventana'
  useCerrarConEscape(() => onCerrar?.(), esVentana && Boolean(onCerrar), { trabajoPendiente: false })

  const deCarga = esErrorDeCarga(error)
  const que = esVentana ? 'esta ventana' : 'esta pantalla'
  const titulo = deCarga ? `No se pudo abrir ${que}` : `Ocurrió un error en ${que}`
  let detalle
  if (!deCarga) detalle = 'El resto de la app sigue funcionando. Puedes reintentar o ir a otra pantalla.'
  else if (!enLinea) detalle = 'No hay conexión y esta parte de la app todavía no se había descargado en este dispositivo. Se reintentará sola al volver la conexión.'
  else detalle = 'No se pudo descargar esta parte de la app. Puede que se haya publicado una versión nueva.'

  const portal = tono === 'portal'
  const textoFuerte = portal ? 'text-white' : 'text-ink'
  const textoSuave = portal ? 'text-white/60' : 'text-ink/60'
  const borde = portal ? 'border-white/20 text-white' : 'border-border text-ink'
  const botonSecundario = `rounded-lg border px-4 py-2 text-sm font-semibold ${borde}`

  const contenido = (
    <>
      <p className={`text-base font-semibold ${textoFuerte}`}>{titulo}</p>
      <p className={`max-w-sm text-sm ${textoSuave}`}>{detalle}</p>
      {pendientes.length > 0 && (
        <p data-testid="carga-fallida-trabajo-conservado" className={`max-w-sm text-sm ${textoFuerte}`}>
          Lo que tenías en curso sigue aquí ({pendientes.join(' y ')}). No recargues la página: termínalo o cancélalo primero.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onReintentar} className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-bg">
          Reintentar
        </button>
        {esVentana && onCerrar && (
          <button type="button" onClick={onCerrar} className={botonSecundario}>
            Cerrar
          </button>
        )}
        {!esVentana && volver && (
          <Link to={volver.a} className={botonSecundario}>
            Ir a {volver.etiqueta}
          </Link>
        )}
        {deCarga && enLinea && pendientes.length === 0 && (
          <button type="button" onClick={() => window.location.reload()} className={botonSecundario}>
            Recargar la página
          </button>
        )}
      </div>
    </>
  )

  if (esVentana) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-[59px] z-30 flex items-start justify-center bg-black/80 p-4 sm:top-0 sm:items-center">
        <div role="alertdialog" aria-modal="true" aria-label={titulo} data-carga-fallida="ventana" className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
          {contenido}
        </div>
      </div>
    )
  }
  return (
    <div role="alert" data-carga-fallida="pantalla" className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      {contenido}
    </div>
  )
}
