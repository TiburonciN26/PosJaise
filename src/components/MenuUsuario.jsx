import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useEstadoNegocio } from '../context/EstadoNegocioContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import ModalCamara from './ModalCamara.jsx'
import Interruptor from './Interruptor.jsx'
import SwitchTema from './SwitchTema.jsx'
import {
  eliminarFoto,
  procesarImagen,
  subirFoto,
  tipoDeImagenValido,
  urlPublicaFoto,
} from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-usuarios'

function iniciales(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

// Menú de usuario (avatar, esquina derecha del header): junta lo que
// antes vivía disperso — datos de la cuenta con foto editable, estado
// del negocio (con su botón único, admin-only) y tema claro/oscuro — más
// cerrar sesión. Reemplaza al logo+MenuEstadoNegocio: el logo pasa acá,
// abajo del todo, como firma de marca en vez de disparador de un menú.
export default function MenuUsuario() {
  const { usuario, rol, cerrarSesion, actualizarFotoPerfil } = useAuth()
  const { abierto: negocioAbierto, cambiarEstado } = useEstadoNegocio()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'

  const [menuAbierto, setMenuAbierto] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [cambiandoEstado, setCambiandoEstado] = useState(false)
  const [mostrarCamara, setMostrarCamara] = useState(false)
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  useCerrarConEscape(() => setMenuAbierto(false), menuAbierto)
  useCerrarConEscape(() => setConfirmando(false), confirmando)

  // Cierre por clic-afuera con ref (no por onBlur): el enfoque de blur +
  // timer que había antes era frágil — cualquier pérdida de foco lo
  // disparaba solo, y hacer clic en el switch de tema/negocio (que roba
  // el foco al abrir su acción) cerraba el menú sin querer. Con esto, el
  // menú solo se cierra cuando el clic cae REALMENTE fuera de este
  // contenedor; todo lo de adentro (foto, tema, estado del negocio, sus
  // modales — que son descendientes del ref) lo deja abierto.
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuAbierto) return undefined
    function alClicFuera(evento) {
      if (menuRef.current && !menuRef.current.contains(evento.target)) {
        setMenuAbierto(false)
      }
    }
    document.addEventListener('pointerdown', alClicFuera)
    return () => document.removeEventListener('pointerdown', alClicFuera)
  }, [menuAbierto])

  async function confirmarCambioEstado() {
    setCambiandoEstado(true)
    try {
      await cambiarEstado(!negocioAbierto)
      mostrarToast(negocioAbierto ? 'Negocio cerrado.' : 'Negocio abierto.', 'exito')
      setConfirmando(false)
    } catch {
      mostrarToast('No se pudo cambiar el estado del negocio.', 'error')
    } finally {
      setCambiandoEstado(false)
    }
  }

  async function procesarYSubirFoto(archivo) {
    if (!tipoDeImagenValido(archivo)) {
      mostrarToast('Formato no admitido. Usa JPG, PNG o WEBP.', 'error')
      return
    }

    setSubiendoFoto(true)
    const fotoAnterior = usuario.foto_url
    try {
      const { blob, extension } = await procesarImagen(archivo)
      const ruta = `${usuario.id}/${crypto.randomUUID()}.${extension}`
      await subirFoto(BUCKET_FOTOS, ruta, blob)
      await actualizarFotoPerfil(ruta)
      // Best-effort: la anterior se borra recién ahora que la fila ya
      // quedó consistente con la nueva ruta.
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

  // Bug reportado: si la URL de la foto no llega a cargar (borrada del
  // bucket, glitch de red, propagación lenta del CDN justo después de
  // subir), el <img> quedaba en blanco sin avisar — no había fallback.
  // Se reintenta useEffect resetea el error cada vez que cambia la foto
  // (nueva subida o login de otro usuario), así un error viejo no se
  // arrastra a una foto nueva que sí carga bien.
  const [errorFoto, setErrorFoto] = useState(false)
  useEffect(() => {
    setErrorFoto(false)
  }, [usuario?.foto_url])

  const urlFoto = !errorFoto ? urlPublicaFoto(BUCKET_FOTOS, usuario?.foto_url) : null

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuAbierto((valorAnterior) => !valorAnterior)}
        aria-expanded={menuAbierto}
        aria-label="Menú de usuario"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-purple-300/30 bg-purple-300/15 text-sm font-semibold text-purple-300"
      >
        {urlFoto ? (
          <img
            src={urlFoto}
            alt=""
            onError={() => setErrorFoto(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          iniciales(usuario?.nombre_completo)
        )}
      </button>

      {menuAbierto && (
        <div className="animate-entrada-dropdown absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-border bg-surface-2 p-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-purple-300/30 bg-purple-300/15 text-base font-semibold text-purple-300">
              {urlFoto ? (
                <img
                  src={urlFoto}
                  alt=""
                  onError={() => setErrorFoto(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                iniciales(usuario?.nombre_completo)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {usuario?.nombre_completo}
              </p>
              <p className="truncate text-xs text-ink/60">{usuario?.email}</p>
              <p className="mt-0.5 font-mono text-[11px] text-amber">{rol}</p>
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <label
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber ${
                subiendoFoto ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {subiendoFoto ? 'Subiendo...' : 'Elegir foto'}
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
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              <Camera className="h-3.5 w-3.5" />
              Tomar foto
            </button>
          </div>

          <div className="mt-3 border-t border-border pt-3">
            {esAdmin ? (
              // Un único control (el switch) que refleja y cambia el
              // estado — nunca dos botones separados "abrir"/"cerrar".
              // El clic sigue exigiendo confirmación (setConfirmando),
              // el switch por sí solo no es interactivo (ver Interruptor.jsx).
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="flex w-full items-center justify-between rounded-lg border border-border-strong px-3 py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${negocioAbierto ? 'bg-green' : 'bg-red'}`}
                  />
                  {negocioAbierto ? 'Negocio abierto' : 'Negocio cerrado'}
                </span>
                <Interruptor activado={negocioAbierto} colorActivado="bg-green" />
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${negocioAbierto ? 'bg-green' : 'bg-red'}`}
                />
                <span className={negocioAbierto ? 'text-green' : 'text-red'}>
                  {negocioAbierto ? 'Negocio abierto' : 'Negocio cerrado'}
                </span>
              </div>
            )}
            {!esAdmin && !negocioAbierto && (
              <p className="mt-2 text-xs text-ink/60">
                Esperando a que el administrador inicie la jornada.
              </p>
            )}
          </div>

          <div className="mt-3 flex justify-center">
            <SwitchTema />
          </div>

          <button
            type="button"
            onClick={cerrarSesion}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-red hover:text-red"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar sesión
          </button>

          <div className="mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-3">
            <img
              src={`${import.meta.env.BASE_URL}icon-512.png`}
              alt=""
              className="h-4 w-4 rounded object-cover"
            />
            <span className="text-xs text-ink/40">Pos Jaise</span>
          </div>
        </div>
      )}

      {confirmando && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              {negocioAbierto
                ? '¿Está seguro de cerrar el negocio?'
                : '¿Está seguro de abrir el negocio?'}
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              {negocioAbierto
                ? 'Los asistentes no podrán iniciar sesión ni registrar ventas, servicios o stock hasta que vuelva a abrirlo.'
                : 'Los asistentes podrán volver a iniciar sesión y trabajar con normalidad.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={cambiandoEstado}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarCambioEstado}
                disabled={cambiandoEstado}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-40 ${
                  negocioAbierto ? 'bg-red' : 'bg-green'
                }`}
              >
                {cambiandoEstado ? 'Guardando...' : 'Sí'}
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
