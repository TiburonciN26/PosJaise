import { useEffect, useId, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'
import Interruptor from './Interruptor.jsx'
import { esRechazoConfirmado, estadoFila } from '../lib/resultadoBd.js'
import { eliminarFoto, procesarImagen, rutaDeUrlGaleria, subirFoto, tipoDeImagenValido, urlPublicaFoto } from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-galeria'

// Un par de fotos por fila (antes/después), no una sola — mismo patrón
// de "se procesa al elegir, se sube recién al guardar" que ModalAsistente/
// ModalServicio (evita subir un archivo huérfano si se cancela el modal),
// duplicado para las dos fotos. `urlDeItem` decide si una URL ya guardada
// es de Storage (empieza con "http", se muestra tal cual) o la fila de
// prueba en /public (ruta relativa, se resuelve con BASE_URL) — mismo
// criterio que NosotrosCliente.jsx del lado del cliente.
function urlDeItem(url) {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  return `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`
}

// Para borrar el archivo viejo del bucket al reemplazar una foto (mismo
// espíritu que ModalAsistente.jsx). Solo funciona si la URL vieja es de
// ESTE bucket — la fila de prueba (foto en /public) no tiene ruta de
// Storage que borrar, así que ahí simplemente no hace nada.
const rutaEnBucket = (url) => rutaDeUrlGaleria(BUCKET_FOTOS, url)

function useFoto(urlActual) {
  const [nueva, setNueva] = useState(null) // { blob, extension, previewUrl } | null
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState(null)
  // Subida ya hecha de la foto elegida: si el guardado en BD es incierto, el reintento la
  // reutiliza en vez de subir otra copia, y si se confirma que no se guardó se limpia.
  const subida = useRef(null) // { blob, url }

  useEffect(() => {
    return () => {
      if (nueva?.previewUrl) URL.revokeObjectURL(nueva.previewUrl)
    }
  }, [nueva])

  async function elegir(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return

    if (!tipoDeImagenValido(archivo)) {
      setError('Formato no admitido. Usa JPG, PNG o WEBP.')
      return
    }

    setError(null)
    setProcesando(true)
    try {
      const { blob, extension } = await procesarImagen(archivo, { ladoMaximo: 1400, calidad: 0.85 })
      if (nueva?.previewUrl) URL.revokeObjectURL(nueva.previewUrl)
      setNueva({ blob, extension, previewUrl: URL.createObjectURL(blob) })
    } catch {
      setError('No se pudo procesar la imagen. Intenta con otra.')
    } finally {
      setProcesando(false)
    }
  }

  const preview = nueva ? nueva.previewUrl : urlDeItem(urlActual)

  async function subirSiHayNueva() {
    if (!nueva) return null
    if (subida.current?.blob === nueva.blob) return subida.current.url // reintento
    const ruta = `${crypto.randomUUID()}.${nueva.extension}`
    // Con R2, `subirFoto` devuelve la referencia "r2:..." (la clave la decide el
    // servidor); con Supabase devuelve la misma `ruta`. La galería guarda la URL
    // completa ya resuelta, como siempre.
    const referencia = await subirFoto(BUCKET_FOTOS, ruta, nueva.blob)
    const url = urlPublicaFoto(BUCKET_FOTOS, referencia)
    subida.current = { blob: nueva.blob, url }
    return url
  }

  function olvidarSubida() {
    subida.current = null
  }

  return { nueva, preview, procesando, error, elegir, subirSiHayNueva, olvidarSubida }
}

function CampoFoto({ etiqueta, foto, idInput }) {
  return (
    <div>
      <Etiqueta obligatorio htmlFor={idInput}>{etiqueta}</Etiqueta>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
          {foto.preview ? (
            <img src={foto.preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-6 w-6 text-ink/40" />
          )}
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-azul-metal hover:text-azul-metal">
          <ImagePlus className="h-3.5 w-3.5" />
          {foto.procesando ? 'Procesando...' : foto.preview ? 'Cambiar foto' : 'Elegir foto'}
          <input
            id={idInput}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={foto.elegir}
            disabled={foto.procesando}
            className="hidden"
          />
        </label>
      </div>
      {foto.error && <p className="mt-1 text-xs text-red">{foto.error}</p>}
    </div>
  )
}

export default function ModalGaleriaWeb({ item, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)
  const esEdicion = Boolean(item)

  const [titulo, setTitulo] = useState(item?.titulo ?? '')
  const [orden, setOrden] = useState(String(item?.orden ?? 0))
  const [activo, setActivo] = useState(item?.activo ?? true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const idFilaNueva = useRef(null)
  const operacionIncierta = useRef(false) // un guardado anterior terminó sin respuesta
  // Mismo hecho, para pintar: mientras haya un guardado pendiente de confirmar el formulario se
  // bloquea (fotos, título, orden, visibilidad) para que el reintento reconcilie EXACTAMENTE lo que se envió.
  const [pendiente, setPendiente] = useState(false)
  const fotoAntes = useFoto(item?.antes_url)
  const fotoDespues = useFoto(item?.despues_url)

  // Guarda de entrada: un segundo envío (clic doble, Enter) mientras el primero sigue
  // en curso se ignora, aunque el estado `guardando` aún no se haya repintado.
  const guardandoRef = useRef(false)
  async function guardar(evento) {
    evento.preventDefault()
    if (guardandoRef.current) return
    guardandoRef.current = true
    try {
      await guardarSinGuarda()
    } finally {
      guardandoRef.current = false
      setGuardando(false) // se libera SOLO al terminar toda la operación (incluidas las lecturas de reconciliación)
    }
  }

  async function guardarSinGuarda() {

    if (!esEdicion && !fotoAntes.nueva) {
      setError('Elige la foto de "antes".')
      return
    }
    if (!esEdicion && !fotoDespues.nueva) {
      setError('Elige la foto de "después".')
      return
    }

    setGuardando(true)
    setError(null)

    let antesUrlSubida
    let despuesUrlSubida
    try {
      antesUrlSubida = await fotoAntes.subirSiHayNueva()
      despuesUrlSubida = await fotoDespues.subirSiHayNueva()
    } catch {
      // Si «antes» ya se subió y «después» falló, no dejar «antes» sin referencia.
      if (antesUrlSubida) {
        await eliminarFoto(BUCKET_FOTOS, rutaEnBucket(antesUrlSubida))
        fotoAntes.olvidarSubida()
      }
      setGuardando(false)
      setError('No se pudo subir alguna de las fotos. Intenta de nuevo.')
      return
    }

    const datos = {
      titulo: titulo.trim() || null,
      antes_url: antesUrlSubida ?? item?.antes_url,
      despues_url: despuesUrlSubida ?? item?.despues_url,
      orden: parseInt(orden, 10) || 0,
      activo,
    }

    // Identidad de la fila nueva: se genera una vez y se reutiliza en los reintentos (ver resultadoBd.js).
    if (!esEdicion && !idFilaNueva.current) idFilaNueva.current = crypto.randomUUID()
    const idFila = esEdicion ? item.id : idFilaNueva.current
    const fila = esEdicion ? datos : { id: idFila, ...datos }

    // `.select('id')`: un update que RLS deja en 0 filas no devuelve error y no
    // debe contarse como guardado.
    const resultado = esEdicion
      ? await supabase.from('galeria_web').update(fila).eq('id', idFila).select('id')
      : await supabase.from('galeria_web').insert(fila).select('id')

    let guardada = !resultado.error && (resultado.data ?? []).length === 1
    let lectura = null // { estado, fila } si se leyó
    const hayDuda = Boolean(resultado.error) && (resultado.error.code === '23505' || !esRechazoConfirmado(resultado))
    if (!guardada && (operacionIncierta.current || hayDuda)) {
      // Un 23505 dice que ESTE insert chocó con una fila existente (¿la de un intento anterior cuya
      // respuesta se perdió?): no que sea ajena. Hay que LEERLA y comparar TODO lo enviado.
      lectura = await estadoFila('galeria_web', idFila, datos)
      guardada = lectura.estado === 'coincide'
    }

    if (!guardada) {
      // Solo se limpian las fotos con un rechazo CONFIRMADO sin incertidumbre previa, o si una lectura
      // exitosa prueba que la fila NO existe ('ausente'). Una fila que existe con otros valores
      // ('difiere') usa archivos: NUNCA se borra ninguno. En cualquier duda se CONSERVAN fotos, id y referencia.
      if (hayDuda || (operacionIncierta.current && lectura?.estado !== 'ausente')) {
        operacionIncierta.current = true
        setPendiente(true)
        setError(
          lectura?.estado === 'difiere'
            ? 'Ya existe un guardado anterior con otros valores. Se conservaron todas las fotos: pulsa «Guardar cambios» para reintentar.'
            : 'No se pudo confirmar si se guardó (conexión interrumpida). Se conservaron las fotos: pulsa «Guardar cambios» para reintentar.',
        )
        return
      }
      operacionIncierta.current = false
      setPendiente(false)
      if (antesUrlSubida) {
        eliminarFoto(BUCKET_FOTOS, rutaEnBucket(antesUrlSubida))
        fotoAntes.olvidarSubida()
      }
      if (despuesUrlSubida) {
        eliminarFoto(BUCKET_FOTOS, rutaEnBucket(despuesUrlSubida))
        fotoDespues.olvidarSubida()
      }
      setError('No se pudo guardar. Intenta de nuevo.')
      return
    }

    operacionIncierta.current = false
    setPendiente(false)
    setGuardando(false)

    if (antesUrlSubida && item?.antes_url) {
      const rutaVieja = rutaEnBucket(item.antes_url)
      if (rutaVieja) eliminarFoto(BUCKET_FOTOS, rutaVieja)
    }
    if (despuesUrlSubida && item?.despues_url) {
      const rutaVieja = rutaEnBucket(item.despues_url)
      if (rutaVieja) eliminarFoto(BUCKET_FOTOS, rutaVieja)
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-azul-metal)' }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar foto de galería' : 'Nueva foto de galería'}
        </h2>

        {pendiente && (
          <p className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink" data-testid="galeria-guardado-pendiente">
            Hay un guardado pendiente de confirmar. Los campos están bloqueados hasta resolverlo: pulsa «Guardar cambios» para reintentar o Cancelar.
          </p>
        )}

        <fieldset disabled={pendiente} className="mt-4 min-w-0 space-y-3 border-0 p-0">
          <CampoFoto etiqueta="Foto de antes" foto={fotoAntes} idInput={`${idBase}-antes`} />
          <CampoFoto etiqueta="Foto de después" foto={fotoDespues} idInput={`${idBase}-despues`} />

          <div>
            <Etiqueta htmlFor={`${idBase}-titulo`}>Título</Etiqueta>
            <input
              id={`${idBase}-titulo`}
              type="search"
              autoComplete="new-password"
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
              placeholder="Opcional — ej. Corte + color"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-azul-metal"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-orden`}>Orden</Etiqueta>
            <input
              id={`${idBase}-orden`}
              type="number"
              step="1"
              value={orden}
              onChange={(evento) => setOrden(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-azul-metal"
            />
            <p className="mt-1 text-xs text-ink/60">Las fotos con número más chico van primero.</p>
          </div>

          <button
            type="button"
            onClick={() => setActivo((anterior) => !anterior)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-azul-metal"
          >
            <span className="text-sm text-ink">Visible en la Web</span>
            <Interruptor activado={activo} colorActivado="bg-azul-metal" />
          </button>
        </fieldset>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-azul-metal hover:text-azul-metal disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-azul-metal py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
