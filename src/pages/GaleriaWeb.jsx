import { useEffect, useRef, useState } from 'react'
import GuiaPestana from '../components/GuiaPestana.jsx'
import { Image, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { eliminarFoto } from '../lib/imagenes.js'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalGaleriaWeb from '../components/ModalGaleriaWeb.jsx'

const BUCKET_FOTOS = 'fotos-galeria'

function rutaEnBucket(url) {
  const marcador = `/${BUCKET_FOTOS}/`
  const indice = url?.indexOf(marcador) ?? -1
  return indice === -1 ? null : url.slice(indice + marcador.length)
}

function urlDeItem(url) {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  return `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`
}

// Panel administrativo de "Galería Web" (cuelga de /web como "padre",
// admin-only, mismo patrón que las otras subpestañas de Web) — el
// último punto pendiente del §7 de implementacionesWed.md
// (98_galeria_web.sql). Cada fila es un par de fotos antes/después; el
// cliente las ve en /nosotros → Galería como un slider arrastrable
// (ComparadorAntesDespues.jsx), no acá — esto es solo el CRUD.
export default function GaleriaWeb() {
  const { mostrarToast } = useToast()
  const panelEliminarRef = useRef(null)

  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null) // null | 'nuevo' | item
  const [itemAEliminar, setItemAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)

  useCerrarConEscape(() => setItemAEliminar(null), Boolean(itemAEliminar))
  useModalA11y(panelEliminarRef, Boolean(itemAEliminar))

  async function cargar() {
    const { data } = await supabase
      .from('galeria_web')
      .select('id, titulo, antes_url, despues_url, orden, activo')
      .order('orden')
      .order('creado_en')
    setItems(data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function confirmarEliminar() {
    if (!itemAEliminar) return
    setEliminando(true)

    const { error } = await supabase.from('galeria_web').delete().eq('id', itemAEliminar.id)

    setEliminando(false)

    if (error) {
      mostrarToast('No se pudo eliminar. Intenta de nuevo.', 'error')
      return
    }

    const rutaAntes = rutaEnBucket(itemAEliminar.antes_url)
    const rutaDespues = rutaEnBucket(itemAEliminar.despues_url)
    if (rutaAntes) eliminarFoto(BUCKET_FOTOS, rutaAntes)
    if (rutaDespues) eliminarFoto(BUCKET_FOTOS, rutaDespues)

    setItemAEliminar(null)
    mostrarToast('Foto eliminada.', 'exito')
    cargar()
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
      <GuiaPestana>Fotos de antes/después que ven tus clientes en Nosotros → Galería, como un slider arrastrable. Las que estén "Visible en la Web" apagadas no se muestran.</GuiaPestana>

      <button
        type="button"
        onClick={() => setModal('nuevo')}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-azul-metal py-2.5 text-sm font-semibold text-bg"
      >
        <Plus className="h-4 w-4" />
        Agregar foto
      </button>

      {items.length === 0 ? (
        <EstadoVacio icono={Image} mensaje="Todavía no agregaste ninguna foto." tema="amber" />
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
            >
              <div className="flex shrink-0 -space-x-3">
                <img
                  src={urlDeItem(item.antes_url)}
                  alt=""
                  className="h-14 w-14 rounded-lg border-2 border-surface object-cover"
                />
                <img
                  src={urlDeItem(item.despues_url)}
                  alt=""
                  className="h-14 w-14 rounded-lg border-2 border-surface object-cover"
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{item.titulo || 'Sin título'}</p>
                <p className="text-xs text-ink/50">
                  Orden {item.orden} ·{' '}
                  <span className={item.activo ? 'text-green' : 'text-ink/40'}>
                    {item.activo ? 'Visible' : 'Oculta'}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setModal(item)}
                aria-label={`Editar ${item.titulo || 'foto'}`}
                className="shrink-0 rounded-lg border border-border-strong p-2 text-ink/70 transition-colors hover:border-azul-metal hover:text-azul-metal"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setItemAEliminar(item)}
                aria-label={`Eliminar ${item.titulo || 'foto'}`}
                className="shrink-0 rounded-lg border border-border-strong p-2 text-ink/70 transition-colors hover:border-azul-metal hover:text-azul-metal"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ModalGaleriaWeb
          item={modal === 'nuevo' ? null : modal}
          onCerrar={() => setModal(null)}
          onGuardado={() => {
            const esNueva = modal === 'nuevo'
            setModal(null)
            mostrarToast(esNueva ? 'Foto agregada.' : 'Foto actualizada.', 'exito')
            cargar()
          }}
        />
      )}

      {itemAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Eliminar esta foto?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Se borra de la galería y del almacenamiento. No se puede deshacer.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setItemAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-azul-metal hover:text-azul-metal disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
