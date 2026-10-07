import { useEffect, useState } from 'react'
import { ImagePlus, MapPin, Phone, Wallet, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import Etiqueta from '../components/Etiqueta.jsx'
import {
  eliminarFoto,
  procesarImagen,
  subirFoto,
  tipoDeImagenValido,
  urlPublicaFoto,
} from '../lib/imagenes.js'

const BUCKET_QR = 'qr-pagos'

const formularioVacio = {
  direccion: '',
  telefono: '',
  instagramUrl: '',
  facebookUrl: '',
  tiktokUrl: '',
  cuentaTransferencia: '',
  yapeNumero: '',
  yapeTitular: '',
  plinNumero: '',
  plinTitular: '',
  adelantoMinimo: '',
  cancelacionPlazoHoras: '',
}

// Campo compartido por Yape y Plin: número + titular + su QR — el
// mismo patrón de "Foto" que ya usa ModalProducto.jsx (preview + subir/
// quitar), pero sin la opción de cámara (un QR se sube como imagen, no
// se fotografía con el celular del admin). `qrActual` es la ruta ya
// guardada en Storage (o null); `qrNueva` es la que se acaba de elegir,
// todavía sin subir (se sube recién al Guardar, igual que las fotos de
// producto — así cancelar el formulario no deja un archivo huérfano).
function CampoMetodoPago({
  titulo,
  icono: Icono,
  numero,
  onNumero,
  titular,
  onTitular,
  idBase,
  previewQr,
  procesandoQr,
  onElegirQr,
  onQuitarQr,
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Icono className="h-4 w-4 text-red" />
        {titulo}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Etiqueta htmlFor={`${idBase}-numero`}>Número</Etiqueta>
          <input
            id={`${idBase}-numero`}
            type="text"
            inputMode="tel"
            value={numero}
            onChange={(evento) => onNumero(evento.target.value)}
            placeholder="Ej. 987654321"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>
        <div>
          <Etiqueta htmlFor={`${idBase}-titular`}>Titular</Etiqueta>
          <input
            id={`${idBase}-titular`}
            type="text"
            value={titular}
            onChange={(evento) => onTitular(evento.target.value)}
            placeholder="Nombre completo"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>
      </div>
      <div>
        <Etiqueta>Código QR</Etiqueta>
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
            {previewQr ? (
              <img src={previewQr} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="h-6 w-6 text-ink/40" />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-red hover:text-red">
              <ImagePlus className="h-3.5 w-3.5" />
              {procesandoQr ? 'Procesando...' : previewQr ? 'Cambiar QR' : 'Subir QR'}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={onElegirQr}
                disabled={procesandoQr}
                className="hidden"
              />
            </label>
            {previewQr && (
              <button
                type="button"
                onClick={onQuitarQr}
                className="flex w-fit items-center gap-1 text-xs text-ink/60 transition-colors hover:text-red"
              >
                <X className="h-3 w-3" />
                Quitar QR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Panel administrativo de "Contacto Web" (cuelga de /web, ver
// navegacion.js) — dirección, teléfono y redes sociales que se muestran
// en Nosotros > Contacto del portal cliente (87_contacto_negocio.sql).
// A diferencia de Promociones/Pedidos Web/Reseñas, "estado_negocio" es
// una fila singleton (id=1) de configuración, no una lista — por eso
// esta pantalla es un formulario simple, sin buscador ni tarjetas.
export default function ContactoWeb() {
  const { mostrarToast } = useToast()
  const [formulario, setFormulario] = useState(formularioVacio)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  // qrActual: ruta ya guardada en Storage (o null). qrNueva: recién
  // elegida, ya redimensionada/convertida a WebP, pendiente de subir
  // recién al Guardar — mismo criterio que la foto de ModalProducto.jsx
  // (así cancelar/salir del formulario no deja un archivo huérfano).
  const [yapeQrActual, setYapeQrActual] = useState(null)
  const [yapeQrNueva, setYapeQrNueva] = useState(null)
  const [yapeQrEliminada, setYapeQrEliminada] = useState(false)
  const [procesandoYapeQr, setProcesandoYapeQr] = useState(false)

  const [plinQrActual, setPlinQrActual] = useState(null)
  const [plinQrNueva, setPlinQrNueva] = useState(null)
  const [plinQrEliminada, setPlinQrEliminada] = useState(false)
  const [procesandoPlinQr, setProcesandoPlinQr] = useState(false)

  useEffect(() => {
    supabase
      .from('estado_negocio')
      .select(
        'direccion, telefono, instagram_url, facebook_url, tiktok_url, cuenta_transferencia, ' +
          'yape_numero, yape_titular, yape_qr_url, plin_numero, plin_titular, plin_qr_url, ' +
          'adelanto_minimo, cancelacion_plazo_horas',
      )
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) {
          setFormulario({
            direccion: data.direccion ?? '',
            telefono: data.telefono ?? '',
            instagramUrl: data.instagram_url ?? '',
            facebookUrl: data.facebook_url ?? '',
            tiktokUrl: data.tiktok_url ?? '',
            cuentaTransferencia: data.cuenta_transferencia ?? '',
            yapeNumero: data.yape_numero ?? '',
            yapeTitular: data.yape_titular ?? '',
            plinNumero: data.plin_numero ?? '',
            plinTitular: data.plin_titular ?? '',
            adelantoMinimo: data.adelanto_minimo != null ? String(data.adelanto_minimo) : '',
            cancelacionPlazoHoras: data.cancelacion_plazo_horas != null ? String(data.cancelacion_plazo_horas) : '',
          })
          setYapeQrActual(data.yape_qr_url ?? null)
          setPlinQrActual(data.plin_qr_url ?? null)
        }
        setCargando(false)
      })
  }, [])

  // Libera los object URL de preview al reemplazar el QR o desmontar.
  useEffect(() => {
    return () => {
      if (yapeQrNueva?.previewUrl) URL.revokeObjectURL(yapeQrNueva.previewUrl)
      if (plinQrNueva?.previewUrl) URL.revokeObjectURL(plinQrNueva.previewUrl)
    }
  }, [yapeQrNueva, plinQrNueva])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function elegirQr(evento, { setNueva, setEliminada, setProcesando }) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return

    if (!tipoDeImagenValido(archivo)) {
      mostrarToast('Formato no admitido. Usa JPG, PNG o WEBP.', 'error')
      return
    }

    setProcesando(true)
    try {
      const { blob, extension } = await procesarImagen(archivo, { ladoMaximo: 800, calidad: 0.9 })
      setNueva((anterior) => {
        if (anterior?.previewUrl) URL.revokeObjectURL(anterior.previewUrl)
        return { blob, extension, previewUrl: URL.createObjectURL(blob) }
      })
      setEliminada(false)
    } catch {
      mostrarToast('No se pudo procesar la imagen. Intenta con otra.', 'error')
    } finally {
      setProcesando(false)
    }
  }

  function quitarQr({ nueva, setNueva, setEliminada }) {
    if (nueva?.previewUrl) URL.revokeObjectURL(nueva.previewUrl)
    setNueva(null)
    setEliminada(true)
  }

  const previewYapeQr = yapeQrNueva
    ? yapeQrNueva.previewUrl
    : !yapeQrEliminada && yapeQrActual
      ? urlPublicaFoto(BUCKET_QR, yapeQrActual)
      : null
  const previewPlinQr = plinQrNueva
    ? plinQrNueva.previewUrl
    : !plinQrEliminada && plinQrActual
      ? urlPublicaFoto(BUCKET_QR, plinQrActual)
      : null

  async function guardar(evento) {
    evento.preventDefault()

    if (formulario.adelantoMinimo.trim() && (Number.isNaN(parseFloat(formulario.adelantoMinimo)) || parseFloat(formulario.adelantoMinimo) <= 0)) {
      mostrarToast('El adelanto mínimo debe ser un número mayor a 0.', 'error')
      return
    }
    if (
      formulario.cancelacionPlazoHoras.trim() &&
      (Number.isNaN(parseInt(formulario.cancelacionPlazoHoras, 10)) || parseInt(formulario.cancelacionPlazoHoras, 10) <= 0)
    ) {
      mostrarToast('El plazo de cancelación debe ser un número entero mayor a 0.', 'error')
      return
    }

    setGuardando(true)

    // Igual que ModalProducto.jsx: si hay un QR nuevo, se sube primero —
    // si el guardado en BD falla después, se borra el archivo recién
    // subido para no dejar huérfanos.
    let rutaYapeSubida = null
    let rutaPlinSubida = null
    try {
      if (yapeQrNueva) {
        rutaYapeSubida = await subirFoto(BUCKET_QR, `yape-${crypto.randomUUID()}.${yapeQrNueva.extension}`, yapeQrNueva.blob)
      }
      if (plinQrNueva) {
        rutaPlinSubida = await subirFoto(BUCKET_QR, `plin-${crypto.randomUUID()}.${plinQrNueva.extension}`, plinQrNueva.blob)
      }
    } catch {
      setGuardando(false)
      mostrarToast('No se pudo subir el QR. Intenta de nuevo.', 'error')
      return
    }

    const yapeQrFinal = yapeQrNueva ? rutaYapeSubida : yapeQrEliminada ? null : yapeQrActual
    const plinQrFinal = plinQrNueva ? rutaPlinSubida : plinQrEliminada ? null : plinQrActual

    const { error } = await supabase
      .from('estado_negocio')
      .update({
        direccion: formulario.direccion.trim() || null,
        telefono: formulario.telefono.trim() || null,
        instagram_url: formulario.instagramUrl.trim() || null,
        facebook_url: formulario.facebookUrl.trim() || null,
        tiktok_url: formulario.tiktokUrl.trim() || null,
        cuenta_transferencia: formulario.cuentaTransferencia.trim() || null,
        yape_numero: formulario.yapeNumero.trim() || null,
        yape_titular: formulario.yapeTitular.trim() || null,
        yape_qr_url: yapeQrFinal,
        plin_numero: formulario.plinNumero.trim() || null,
        plin_titular: formulario.plinTitular.trim() || null,
        plin_qr_url: plinQrFinal,
        adelanto_minimo: formulario.adelantoMinimo.trim() ? parseFloat(formulario.adelantoMinimo) : null,
        cancelacion_plazo_horas: formulario.cancelacionPlazoHoras.trim()
          ? parseInt(formulario.cancelacionPlazoHoras, 10)
          : null,
      })
      .eq('id', 1)

    setGuardando(false)

    if (error) {
      if (rutaYapeSubida) eliminarFoto(BUCKET_QR, rutaYapeSubida)
      if (rutaPlinSubida) eliminarFoto(BUCKET_QR, rutaPlinSubida)
      mostrarToast('No se pudo guardar. Intenta de nuevo.', 'error')
      return
    }

    // Best-effort: recién ahora que la BD ya quedó consistente se borra
    // el QR anterior, si se reemplazó o quitó uno que ya existía.
    if (yapeQrActual && yapeQrActual !== yapeQrFinal) eliminarFoto(BUCKET_QR, yapeQrActual)
    if (plinQrActual && plinQrActual !== plinQrFinal) eliminarFoto(BUCKET_QR, plinQrActual)

    setYapeQrActual(yapeQrFinal)
    setYapeQrNueva(null)
    setYapeQrEliminada(false)
    setPlinQrActual(plinQrFinal)
    setPlinQrNueva(null)
    setPlinQrEliminada(false)

    mostrarToast('Datos de contacto actualizados.', 'exito')
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
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        <MapPin className="h-8 w-8 text-red" />
        <p className="text-base font-semibold text-red">Contacto Web</p>
        <p className="max-w-sm text-sm text-ink/60">
          Esto es lo que ven tus clientes en Nosotros &gt; Contacto — el horario ya está cargado
          (ver Citas), acá solo falta dirección, teléfono y redes.
        </p>
      </div>

      <form onSubmit={guardar} className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <Etiqueta htmlFor="contacto-direccion">Dirección</Etiqueta>
          <input
            id="contacto-direccion"
            type="text"
            value={formulario.direccion}
            onChange={(evento) => actualizarCampo('direccion', evento.target.value)}
            placeholder="Ej. Av. Pardo 123, Nuevo Chimbote"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-telefono">Teléfono / WhatsApp</Etiqueta>
          <input
            id="contacto-telefono"
            type="text"
            inputMode="tel"
            value={formulario.telefono}
            onChange={(evento) => actualizarCampo('telefono', evento.target.value)}
            placeholder="Ej. 987654321"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-instagram">Instagram (link completo)</Etiqueta>
          <input
            id="contacto-instagram"
            type="url"
            value={formulario.instagramUrl}
            onChange={(evento) => actualizarCampo('instagramUrl', evento.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-facebook">Facebook (link completo)</Etiqueta>
          <input
            id="contacto-facebook"
            type="url"
            value={formulario.facebookUrl}
            onChange={(evento) => actualizarCampo('facebookUrl', evento.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-tiktok">TikTok (link completo)</Etiqueta>
          <input
            id="contacto-tiktok"
            type="url"
            value={formulario.tiktokUrl}
            onChange={(evento) => actualizarCampo('tiktokUrl', evento.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Wallet className="h-4 w-4 text-red" />
            Métodos de pago del carrito web
          </p>
          <div className="space-y-3">
            <CampoMetodoPago
              titulo="Yape"
              icono={Wallet}
              idBase="contacto-yape"
              numero={formulario.yapeNumero}
              onNumero={(valor) => actualizarCampo('yapeNumero', valor)}
              titular={formulario.yapeTitular}
              onTitular={(valor) => actualizarCampo('yapeTitular', valor)}
              previewQr={previewYapeQr}
              procesandoQr={procesandoYapeQr}
              onElegirQr={(evento) =>
                elegirQr(evento, {
                  setNueva: setYapeQrNueva,
                  setEliminada: setYapeQrEliminada,
                  setProcesando: setProcesandoYapeQr,
                })
              }
              onQuitarQr={() =>
                quitarQr({ nueva: yapeQrNueva, setNueva: setYapeQrNueva, setEliminada: setYapeQrEliminada })
              }
            />
            <CampoMetodoPago
              titulo="Plin"
              icono={Wallet}
              idBase="contacto-plin"
              numero={formulario.plinNumero}
              onNumero={(valor) => actualizarCampo('plinNumero', valor)}
              titular={formulario.plinTitular}
              onTitular={(valor) => actualizarCampo('plinTitular', valor)}
              previewQr={previewPlinQr}
              procesandoQr={procesandoPlinQr}
              onElegirQr={(evento) =>
                elegirQr(evento, {
                  setNueva: setPlinQrNueva,
                  setEliminada: setPlinQrEliminada,
                  setProcesando: setProcesandoPlinQr,
                })
              }
              onQuitarQr={() =>
                quitarQr({ nueva: plinQrNueva, setNueva: setPlinQrNueva, setEliminada: setPlinQrEliminada })
              }
            />
            <div>
              <Etiqueta htmlFor="contacto-transferencia">Transferencia (cuenta a mostrar)</Etiqueta>
              <input
                id="contacto-transferencia"
                type="text"
                value={formulario.cuentaTransferencia}
                onChange={(evento) => actualizarCampo('cuentaTransferencia', evento.target.value)}
                placeholder="Ej. BCP 191-XXXXXXX-0-XX — Juan Pérez"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
              />
              <p className="mt-1 text-xs text-ink/50">
                Mismo dato que se edita rápido desde Ventas al cobrar por transferencia en el
                mostrador — cambiarlo acá o allá actualiza lo mismo.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-3 text-sm font-semibold text-ink">Citas — adelanto y cancelación</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor="contacto-adelanto-minimo">Adelanto mínimo (S/)</Etiqueta>
              <input
                id="contacto-adelanto-minimo"
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.adelantoMinimo}
                onChange={(evento) => actualizarCampo('adelantoMinimo', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
              />
            </div>
            <div>
              <Etiqueta htmlFor="contacto-cancelacion-plazo">Plazo de cancelación (h)</Etiqueta>
              <input
                id="contacto-cancelacion-plazo"
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                value={formulario.cancelacionPlazoHoras}
                onChange={(evento) => actualizarCampo('cancelacionPlazoHoras', evento.target.value)}
                placeholder="Opcional, ej. 24"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
              />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-ink/50">
            Se muestran en "Adelanto y pago" del Detalle del servicio, en la Web.
          </p>
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Phone className="h-4 w-4" />
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}
