import { useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { usePerfilCliente } from '../context/PerfilClienteContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'
import ModalCamara from './ModalCamara.jsx'
import {
  eliminarFoto,
  procesarImagen,
  subirFoto,
  tipoDeImagenValido,
  urlPublicaFoto,
} from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-clientes'

function iniciales(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

// Formulario de Mi Perfil, ahora como modal (antes vivía inline en la
// página) — la vista de solo-lectura de MiPerfil.jsx dispara esto con el
// botón "Editar". Sigue siendo la única puerta de escritura sobre
// "clientes" para un cliente (ver implementacionesWed.md, sección 1):
// todo pasa por vincular_o_crear_cliente_web(), nunca un update directo.
export default function ModalEditarPerfilCliente({ onCerrar }) {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { perfil, setPerfil } = usePerfilCliente()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const yaVinculado = Boolean(perfil)
  const [nombre, setNombre] = useState(perfil?.nombre ?? '')
  const [telefono, setTelefono] = useState(perfil?.telefono ?? '')
  const [direccion, setDireccion] = useState(perfil?.direccion ?? '')
  const [cumpleanos, setCumpleanos] = useState(perfil?.cumpleanos ?? '')
  const [fotoUrl, setFotoUrl] = useState(perfil?.foto_url ?? null)
  const [errorFoto, setErrorFoto] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mostrarConfirmarVinculo, setMostrarConfirmarVinculo] = useState(false)
  const [mostrarCamara, setMostrarCamara] = useState(false)
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  const panelConfirmarRef = useRef(null)
  useModalA11y(panelConfirmarRef, mostrarConfirmarVinculo)
  useCerrarConEscape(() => setMostrarConfirmarVinculo(false), mostrarConfirmarVinculo)

  async function guardarPerfil(confirmarVinculo) {
    setGuardando(true)
    try {
      const { data, error: errorGuardar } = await supabase.rpc('vincular_o_crear_cliente_web', {
        p_nombre: nombre.trim(),
        p_telefono: telefono.trim(),
        p_direccion: direccion.trim() || null,
        p_cumpleanos: cumpleanos || null,
        p_confirmar_vinculo: confirmarVinculo,
      })
      if (errorGuardar) throw errorGuardar

      const fila = data?.[0]
      setPerfil(fila ?? null)
      setMostrarConfirmarVinculo(false)
      mostrarToast(
        fila?.vinculado_existente
          ? 'Perfil vinculado a tu historial anterior.'
          : 'Perfil guardado.',
        'exito',
      )
      onCerrar()
    } catch (errorGuardarPerfil) {
      // Cierra el diálogo de confirmación (si estaba abierto) antes de
      // mostrar el error: si no, el error queda pintado detrás del
      // overlay del diálogo y parece que "no pasó nada" al guardar.
      setMostrarConfirmarVinculo(false)
      const mensaje = errorGuardarPerfil?.message ?? ''
      setError(
        mensaje.includes('ya está en uso') ? mensaje : 'No se pudo guardar. Intenta de nuevo.',
      )
    } finally {
      setGuardando(false)
    }
  }

  async function manejarSubmit(evento) {
    evento.preventDefault()
    setError('')

    if (!nombre.trim()) {
      setError('El nombre es obligatorio.')
      return
    }
    if (!telefono.trim()) {
      setError('El teléfono es obligatorio.')
      return
    }

    if (yaVinculado) {
      await guardarPerfil(false)
      return
    }

    setGuardando(true)
    try {
      const { data: hayCandidato, error: errorExiste } = await supabase.rpc(
        'existe_cliente_no_vinculado',
        { p_telefono: telefono.trim() },
      )
      if (errorExiste) throw errorExiste

      if (hayCandidato) {
        setGuardando(false)
        setMostrarConfirmarVinculo(true)
        return
      }

      await guardarPerfil(false)
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setGuardando(false)
    }
  }

  async function procesarYSubirFoto(archivo) {
    if (!tipoDeImagenValido(archivo)) {
      mostrarToast('Formato no admitido. Usa JPG, PNG o WEBP.', 'error')
      return
    }

    setSubiendoFoto(true)
    const fotoAnterior = fotoUrl
    try {
      const { blob, extension } = await procesarImagen(archivo)
      const ruta = `${usuario.id}/${crypto.randomUUID()}.${extension}`
      await subirFoto(BUCKET_FOTOS, ruta, blob)
      const { error: errorFotoRpc } = await supabase.rpc('actualizar_mi_foto_cliente', {
        p_foto_url: ruta,
      })
      if (errorFotoRpc) throw errorFotoRpc

      setFotoUrl(ruta)
      setErrorFoto(false)
      setPerfil((anterior) => (anterior ? { ...anterior, foto_url: ruta } : anterior))
      if (fotoAnterior) eliminarFoto(BUCKET_FOTOS, fotoAnterior)
      mostrarToast('Foto de perfil actualizada.', 'exito')
    } catch {
      mostrarToast('No se pudo actualizar la foto. Intenta de nuevo.', 'error')
    } finally {
      setSubiendoFoto(false)
    }
  }

  function elegirFoto(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return
    procesarYSubirFoto(archivo)
  }

  function capturarDesdeCamara(blob) {
    setMostrarCamara(false)
    procesarYSubirFoto(blob)
  }

  const urlFoto = !errorFoto ? urlPublicaFoto(BUCKET_FOTOS, fotoUrl) : null

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={panelRef}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Editar Perfil</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-2 rounded-lg p-2 text-ink/60 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {yaVinculado && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-amber/30 bg-amber/15 text-xl font-semibold text-amber">
              {urlFoto ? (
                <img
                  src={urlFoto}
                  alt=""
                  onError={() => setErrorFoto(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                iniciales(nombre)
              )}
            </div>
            <div className="flex gap-2">
              <label
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber ${
                  subiendoFoto ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {subiendoFoto ? 'Subiendo...' : 'Galería'}
                <input
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={elegirFoto}
                  disabled={subiendoFoto}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => setMostrarCamara(true)}
                disabled={subiendoFoto}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
              >
                <Camera className="h-3.5 w-3.5" />
                Cámara
              </button>
            </div>
          </div>
        )}

        <form onSubmit={manejarSubmit} autoComplete="off" className="mt-5 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor="perfil-nombre">
              Nombre completo
            </Etiqueta>
            <input
              id="perfil-nombre"
              type="text"
              autoComplete="off"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta obligatorio htmlFor="perfil-telefono">
              Teléfono
            </Etiqueta>
            <input
              id="perfil-telefono"
              type="text"
              inputMode="tel"
              autoComplete="off"
              value={telefono}
              onChange={(evento) => setTelefono(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
          </div>

          <div>
            <Etiqueta htmlFor="perfil-direccion">Dirección</Etiqueta>
            <input
              id="perfil-direccion"
              type="text"
              autoComplete="off"
              value={direccion}
              onChange={(evento) => setDireccion(evento.target.value)}
              placeholder="Para futuros pedidos a domicilio"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>

          <div>
            <Etiqueta htmlFor="perfil-cumpleanos">Fecha de cumpleaños</Etiqueta>
            <input
              id="perfil-cumpleanos"
              type="date"
              value={cumpleanos}
              onChange={(evento) => setCumpleanos(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
              {error}
            </p>
          )}

          <div className="flex gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>

      {mostrarConfirmarVinculo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div
            ref={panelConfirmarRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5"
          >
            <h2 className="text-base font-semibold text-ink">¿Es tu registro?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Encontramos un cliente registrado con este teléfono en nuestro sistema. Si es tu
              registro, vincularemos tu historial de visitas anteriores a esta cuenta.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => guardarPerfil(false)}
                disabled={guardando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
              >
                No, crear uno nuevo
              </button>
              <button
                type="button"
                onClick={() => guardarPerfil(true)}
                disabled={guardando}
                className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : 'Sí, es mi registro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarCamara && (
        <ModalCamara onCapturar={capturarDesdeCamara} onCerrar={() => setMostrarCamara(false)} />
      )}
    </div>
  )
}
