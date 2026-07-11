import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { X, Camera } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const PAUSA_TRAS_ESCANEO_MS = 1200

export default function ModalEscanerCodigoBarras({ productos, onProductoEncontrado, onCerrar }) {
  const videoRef = useRef(null)
  const controlesRef = useRef(null)
  const pausadoRef = useRef(false)
  const productosRef = useRef(productos)
  const onProductoEncontradoRef = useRef(onProductoEncontrado)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null) // { texto, tipo: 'exito' | 'error' }

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    productosRef.current = productos
  }, [productos])

  useEffect(() => {
    onProductoEncontradoRef.current = onProductoEncontrado
  }, [onProductoEncontrado])

  // Se inicia una sola vez (deps vacías): la cámara no debe reiniciarse
  // en cada re-render de Ventas.jsx, solo al montar/desmontar este modal.
  //
  // El arranque real se retrasa con setTimeout(0) a propósito: en modo
  // desarrollo, StrictMode monta -> desmonta -> vuelve a montar este
  // efecto de forma síncrona (mismo tick). Sin este retraso, la primera
  // pasada ya alcanza a pedir la cámara (getUserMedia) antes de que su
  // propio cleanup pueda cancelarla, y la segunda pasada pide la cámara
  // otra vez casi al mismo tiempo — dos peticiones simultáneas al mismo
  // hardware de cámara, que en el celular causaban el destello negro.
  // Con el setTimeout, el cleanup de la primera pasada cancela su
  // temporizador antes de que llegue a disparar, y solo la segunda
  // (la que realmente sobrevive) llega a pedir la cámara.
  useEffect(() => {
    let activo = true
    let iniciado = false
    const lector = new BrowserMultiFormatReader()

    const idTemporizador = setTimeout(() => {
      iniciado = true
      lector
        .decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (resultado) => {
            if (!activo || !resultado || pausadoRef.current) return

            const codigo = resultado.getText()
            const producto = productosRef.current.find((p) => p.codigo_barras === codigo)

            pausadoRef.current = true
            if (producto) {
              onProductoEncontradoRef.current(producto)
              setMensaje({ texto: `Agregado: ${producto.nombre}`, tipo: 'exito' })
            } else {
              setMensaje({ texto: 'Producto no encontrado', tipo: 'error' })
            }

            setTimeout(() => {
              pausadoRef.current = false
              if (activo) setMensaje(null)
            }, PAUSA_TRAS_ESCANEO_MS)
          },
        )
        .then((controles) => {
          if (!activo) {
            controles.stop()
            return
          }
          controlesRef.current = controles
        })
        .catch(() => {
          if (activo) setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.')
        })
    }, 0)

    return () => {
      activo = false
      clearTimeout(idTemporizador)
      if (iniciado) controlesRef.current?.stop()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Camera className="h-5 w-5 text-amber" />
            Escanear código de barras
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-ink/40 transition-colors hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mt-3 overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />

          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-amber/70" />

          {mensaje && (
            <div
              className={`absolute inset-x-0 bottom-0 px-3 py-2 text-center text-sm font-semibold ${
                mensaje.tipo === 'exito' ? 'bg-green/90 text-bg' : 'bg-red/90 text-bg'
              }`}
            >
              {mensaje.texto}
            </div>
          )}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        ) : (
          <p className="mt-3 text-center text-xs text-ink/40">
            Apunta la cámara al código de barras del producto.
          </p>
        )}

        <button
          type="button"
          onClick={onCerrar}
          className="mt-3 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
        >
          Cerrar cámara
        </button>
      </div>
    </div>
  )
}
