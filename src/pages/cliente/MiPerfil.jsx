import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cake, Lock, MapPin, Pencil, Phone, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { usePerfilCliente } from '../../context/PerfilClienteContext.jsx'
import { useCerrarConEscape } from '../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../hooks/useModalA11y.js'
import {
  eliminarFoto,
  procesarImagen,
  subirFoto,
  tipoDeImagenValido,
  urlPublicaFoto,
} from '../../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-clientes'
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function iniciales(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

function formatearFechaLarga(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  const nombreMes = MESES[Number(mes) - 1]
  return `${Number(dia)} de ${nombreMes.charAt(0).toUpperCase()}${nombreMes.slice(1)}, ${anio}`
}

// Etiqueta propia (no la Etiqueta.jsx compartida con el POS, que usa
// text-ink/60 — un token atado al switch claro/oscuro global; acá el
// fondo es siempre negro).
function EtiquetaCampo({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-white/50">
      {children}
    </label>
  )
}

// Cada dato cambia de "texto" a "input" en el mismo lugar según
// `editando` — a pedido del usuario, ya no hay un modal aparte para
// editar (ver ModalEditarPerfilCliente.jsx, eliminado).
function CampoPerfil({ icono: Icono, etiqueta, editando, valor, ...inputProps }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/70">
        <Icono className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {editando ? (
          <>
            <EtiquetaCampo htmlFor={inputProps.id}>{etiqueta}</EtiquetaCampo>
            <input
              {...inputProps}
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--lw-gold)]"
            />
          </>
        ) : (
          <>
            <p className="text-xs text-white/50">{etiqueta}</p>
            <p className="truncate text-sm font-medium text-white">{valor || 'Sin registrar'}</p>
          </>
        )}
      </div>
    </div>
  )
}

// Mi Perfil: antes vista de solo lectura + modal aparte para editar
// (ModalEditarPerfilCliente.jsx). A pedido del usuario, ahora todo vive
// en esta misma pantalla: "Editar" vuelve los campos editables in-place
// (mismo lugar, ya no un diálogo encima) y la foto se cambia con un
// lápiz sobre el avatar que abre el explorador de archivos nativo
// directo (sin cámara propia del proyecto — el selector del sistema
// operativo ya ofrece "Cámara" como opción en un celular).
export default function MiPerfil() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { perfil, setPerfil } = usePerfilCliente()

  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [cumpleanos, setCumpleanos] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mostrarConfirmarVinculo, setMostrarConfirmarVinculo] = useState(false)

  const [errorFoto, setErrorFoto] = useState(false)
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const inputFotoRef = useRef(null)

  const panelConfirmarRef = useRef(null)
  useModalA11y(panelConfirmarRef, mostrarConfirmarVinculo)
  useCerrarConEscape(() => setMostrarConfirmarVinculo(false), mostrarConfirmarVinculo)

  function empezarEdicion() {
    setNombre(perfil?.nombre ?? '')
    setTelefono(perfil?.telefono ?? '')
    setCumpleanos(perfil?.cumpleanos ?? '')
    setError('')
    setEditando(true)
  }

  function cancelarEdicion() {
    setEditando(false)
    setError('')
  }

  async function guardarPerfil(confirmarVinculo) {
    setGuardando(true)
    try {
      const { data, error: errorGuardar } = await supabase.rpc('vincular_o_crear_cliente_web', {
        p_nombre: nombre.trim(),
        p_telefono: telefono.trim(),
        p_cumpleanos: cumpleanos || null,
        p_confirmar_vinculo: confirmarVinculo,
      })
      if (errorGuardar) throw errorGuardar

      const fila = data?.[0]
      setPerfil(fila ?? null)
      setMostrarConfirmarVinculo(false)
      setEditando(false)
      mostrarToast(
        fila?.vinculado_existente ? 'Perfil vinculado a tu historial anterior.' : 'Perfil guardado.',
        'exito',
      )
    } catch (errorGuardarPerfil) {
      setMostrarConfirmarVinculo(false)
      const mensaje = errorGuardarPerfil?.message ?? ''
      setError(mensaje.includes('ya está en uso') ? mensaje : 'No se pudo guardar. Intenta de nuevo.')
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

    if (perfil) {
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

  async function elegirFoto(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return

    if (!tipoDeImagenValido(archivo)) {
      mostrarToast('Formato no admitido. Usa JPG, PNG o WEBP.', 'error')
      return
    }

    setSubiendoFoto(true)
    const fotoAnterior = perfil?.foto_url
    try {
      const { blob, extension } = await procesarImagen(archivo)
      const ruta = `${usuario.id}/${crypto.randomUUID()}.${extension}`
      await subirFoto(BUCKET_FOTOS, ruta, blob)
      const { error: errorFotoRpc } = await supabase.rpc('actualizar_mi_foto_cliente', {
        p_foto_url: ruta,
      })
      if (errorFotoRpc) throw errorFotoRpc

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

  const urlFoto = !errorFoto ? urlPublicaFoto(BUCKET_FOTOS, perfil?.foto_url) : null

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="liquid-glass flex items-center gap-4 rounded-none p-6">
          <div className="relative shrink-0">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-[var(--lw-gold)]/30 bg-[var(--lw-gold)]/15 text-xl font-semibold text-[var(--lw-gold)]">
              {urlFoto ? (
                <img
                  src={urlFoto}
                  alt=""
                  onError={() => setErrorFoto(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                iniciales(perfil?.nombre)
              )}
            </div>
            <button
              type="button"
              onClick={() => inputFotoRef.current?.click()}
              disabled={subiendoFoto}
              aria-label="Cambiar foto de perfil"
              className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--lw-gold)] bg-[#0b0b0c] text-[var(--lw-gold)] shadow-md transition-transform hover:scale-105 disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <input
              ref={inputFotoRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={elegirFoto}
              disabled={subiendoFoto}
              className="hidden"
            />
          </div>

          <div className="min-w-0">
            {editando ? (
              <input
                id="perfil-nombre"
                type="text"
                autoComplete="off"
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                placeholder="Nombre completo"
                autoFocus
                className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-lg font-semibold text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
              />
            ) : (
              <p className="lw-serif-regular truncate text-2xl text-white">
                {perfil?.nombre || 'Completa tu perfil'}
              </p>
            )}
            <p className="mt-1 truncate text-sm text-white/50">{usuario?.email}</p>
          </div>
        </div>

        <form onSubmit={manejarSubmit} className="liquid-glass mt-4 space-y-4 rounded-none p-5">
          <CampoPerfil
            icono={Phone}
            etiqueta="Teléfono"
            editando={editando}
            valor={perfil?.telefono}
            id="perfil-telefono"
            type="text"
            inputMode="tel"
            autoComplete="off"
            value={telefono}
            onChange={(evento) => setTelefono(evento.target.value)}
          />
          <CampoPerfil
            icono={Cake}
            etiqueta="Cumpleaños"
            editando={editando}
            valor={formatearFechaLarga(perfil?.cumpleanos)}
            id="perfil-cumpleanos"
            type="date"
            value={cumpleanos}
            onChange={(evento) => setCumpleanos(evento.target.value)}
          />

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}

          <div className="flex items-center gap-2 text-xs text-green">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <p>Jaise protege su información personal y la mantiene privada y segura.</p>
          </div>

          {editando ? (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={cancelarEdicion}
                disabled={guardando}
                className="flex-1 rounded-full border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="flex-1 rounded-full border border-[var(--lw-gold)] bg-transparent py-2 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={empezarEdicion}
                className="flex items-center gap-1.5 rounded-full border border-[var(--lw-gold)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--lw-gold)]"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
              <Link
                to="/mi-perfil/direcciones"
                className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
              >
                <MapPin className="h-3.5 w-3.5" />
                Mis direcciones
              </Link>
            </div>
          )}
        </form>
      </div>

      {mostrarConfirmarVinculo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelConfirmarRef} className="lw-bar w-full max-w-sm rounded-lg border border-white/10 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">¿Es tu registro?</h2>
              <button
                type="button"
                onClick={() => setMostrarConfirmarVinculo(false)}
                aria-label="Cerrar"
                className="-m-2 rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-white/60">
              Encontramos un cliente registrado con este teléfono en nuestro sistema. Si es tu
              registro, vincularemos tu historial de visitas anteriores a esta cuenta.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => guardarPerfil(false)}
                disabled={guardando}
                className="flex-1 rounded-full border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
              >
                No, crear uno nuevo
              </button>
              <button
                type="button"
                onClick={() => guardarPerfil(true)}
                disabled={guardando}
                className="flex-1 rounded-full border border-[var(--lw-gold)] bg-transparent py-2 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : 'Sí, es mi registro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
