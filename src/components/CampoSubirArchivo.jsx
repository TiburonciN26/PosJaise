import { useState } from 'react'
import { Check, ImagePlus, Loader2 } from 'lucide-react'

// Campo genérico para subir un archivo (imagen) con una animación de
// carga puramente estética entre "elegir archivo" y "listo" — pedido
// del usuario para reemplazar el "subir captura" que tenía el carrito
// (comprobante de pago), pensado desde el principio para reusarse en
// cualquier otro campo del proyecto que pida adjuntar algo similar (a
// futuro, reemplazando también los que ya existen en otras pantallas).
//
// `cargando` es simulado acá con un timeout — el archivo en sí todavía
// no se sube a ningún Storage real (Fase 1 del carrito, sin backend
// nuevo todavía). Cuando exista un upload real, el llamador puede pasar
// `simulacionMs={0}` para saltarse el timeout y manejar su propio
// estado de carga (la prop async real vendría envuelta en `onSeleccionar`
// devolviendo una promesa, y este componente ya sabría esperarla) — por
// ahora nadie necesita eso, así que no se construyó de más.
const DURACION_CARGA_MS = 900

export default function CampoSubirArchivo({
  nombreArchivo,
  previewUrl,
  onSeleccionar,
  onQuitar,
  etiqueta = 'Subir captura',
  etiquetaAdjunto = 'Archivo adjunto',
  simulacionMs = DURACION_CARGA_MS,
}) {
  const [cargando, setCargando] = useState(false)

  function alElegir(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return

    setCargando(true)
    setTimeout(() => {
      setCargando(false)
      onSeleccionar(archivo)
    }, simulacionMs)
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-[#2e2e2e] bg-[#141416] px-3 py-2.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#1a1a1c]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--lw-gold)]" />
        </div>
        <span className="text-[13px] text-white/70">Cargando...</span>
      </div>
    )
  }

  if (nombreArchivo) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-[rgba(62,207,106,.35)] bg-[rgba(62,207,106,.08)] px-3 py-2.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#1a1a1c]">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5 text-white/40" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#3ecf6a]">
            <Check className="h-3.5 w-3.5" />
            {etiquetaAdjunto}
          </span>
          <span className="truncate text-xs text-white/60">{nombreArchivo}</span>
        </div>
        <button type="button" onClick={onQuitar} className="shrink-0 text-[13px] text-white/60 hover:text-white">
          Quitar
        </button>
      </div>
    )
  }

  return (
    <label className="lw-subir-captura">
      <ImagePlus className="h-4 w-4" />
      {etiqueta}
      <input
        type="file"
        accept="image/*"
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        onChange={alElegir}
        aria-label={etiqueta}
      />
    </label>
  )
}
