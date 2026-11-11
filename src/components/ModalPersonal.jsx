import { useId, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import {
  ETIQUETA_ROL,
  MIN_PASSWORD,
  ROLES_CON_FICHA,
  ROLES_PERSONAL,
  actualizarPersona,
  crearPersona,
  generarPassword,
  validarPassword,
} from '../lib/personal.js'
import Etiqueta from './Etiqueta.jsx'
import Interruptor from './Interruptor.jsx'

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CLASE_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300'

// Copia texto al portapapeles; si el navegador no lo permite (p. ej. sin HTTPS) devuelve false.
async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

// Crear o editar una cuenta de personal. Al CREAR muestra una sola vez el correo y la contraseña inicial
// (la administradora se las entrega a la persona). `persona` = fila de personal_listar (edición) o null.
export default function ModalPersonal({ persona, esYo, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  useModalA11y(panelRef)
  const esEdicion = Boolean(persona)

  const [nombre, setNombre] = useState(persona?.nombre_completo ?? '')
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState(persona?.rol ?? 'ASISTENTE')
  const [password, setPassword] = useState(() => (esEdicion ? '' : generarPassword()))
  const [verPassword, setVerPassword] = useState(true)
  const [tambienAtiende, setTambienAtiende] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [credenciales, setCredenciales] = useState(null) // { email, password } tras crear

  // Con las credenciales a la vista, cerrar con Esc equivale a «Listo».
  useCerrarConEscape(() => (credenciales ? onGuardado(true) : onCerrar()), !guardando)

  function validar() {
    if (nombre.trim().length < 2) return 'Escribe el nombre completo.'
    if (!esEdicion) {
      if (!RE_EMAIL.test(email.trim())) return 'Escribe un correo válido.'
      const errorClave = validarPassword(password)
      if (errorClave) return errorClave
    }
    return null
  }

  async function guardar(evento) {
    evento.preventDefault()
    const mensaje = validar()
    if (mensaje) {
      setError(mensaje)
      return
    }
    setGuardando(true)
    setError(null)

    const resultado = esEdicion
      ? await actualizarPersona({ id: persona.id, nombre: nombre.trim(), rol: esYo ? undefined : rol })
      : await crearPersona({
          email: email.trim().toLowerCase(),
          nombre: nombre.trim(),
          rol,
          password,
          tambienAtiende: rol === 'ADMINISTRADOR' && tambienAtiende,
        })
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (esEdicion) {
      onGuardado(false)
      return
    }
    setCredenciales({ email: email.trim().toLowerCase(), password })
  }

  async function copiarCredenciales() {
    const texto = `Correo: ${credenciales.email}\nContraseña: ${credenciales.password}`
    const listo = await copiar(texto)
    mostrarToast(listo ? 'Credenciales copiadas.' : 'No se pudo copiar. Anótalas manualmente.', listo ? 'exito' : 'error')
  }

  const llevaFicha = ROLES_CON_FICHA.includes(rol) || (rol === 'ADMINISTRADOR' && tambienAtiende)

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      {credenciales ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Cuenta creada"
          className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Check className="h-4 w-4 text-green" aria-hidden="true" />
            Cuenta creada
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            Entrégale estos datos a {nombre.trim()}. La contraseña solo se muestra ahora: luego puedes
            restablecerla desde la lista. Puede cambiarla al entrar, desde su menú de usuario.
          </p>
          <dl className="mt-3 space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <div>
              <dt className="text-xs text-ink/60">Rol</dt>
              <dd className="text-ink">{ETIQUETA_ROL[rol]}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/60">Correo</dt>
              <dd className="break-all font-mono text-ink">{credenciales.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/60">Contraseña inicial</dt>
              <dd className="font-mono text-ink">{credenciales.password}</dd>
            </div>
          </dl>
          {llevaFicha && (
            <p className="mt-3 rounded-lg border border-purple-300/30 bg-purple-300/10 px-3 py-2 text-xs text-ink/80">
              Su ficha ya está creada. Para que pueda registrar servicios, asígnale su % de comisión por
              servicio en la pestaña <strong>Porcentajes</strong>; mientras tanto solo podrá anotarlos como
              pendientes.
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={copiarCredenciales}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copiar
            </button>
            <button
              type="button"
              onClick={() => onGuardado(true)}
              className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg"
            >
              Listo
            </button>
          </div>
        </div>
      ) : (
        <form
          autoComplete="off"
          ref={panelRef}
          onSubmit={guardar}
          style={{ '--color-foco': 'var(--color-purple-300)' }}
          className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
        >
          <h2 className="text-base font-semibold text-ink">{esEdicion ? 'Editar persona' : 'Nueva persona'}</h2>

          <div className="mt-4 space-y-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-nombre`}>
                Nombre completo
              </Etiqueta>
              <input
                id={`${idBase}-nombre`}
                type="search"
                autoComplete="new-password"
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                className={CLASE_INPUT}
                autoFocus
              />
            </div>

            {!esEdicion && (
              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-email`}>
                  Correo (con el que inicia sesión)
                </Etiqueta>
                <input
                  id={`${idBase}-email`}
                  type="search"
                  inputMode="email"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  value={email}
                  onChange={(evento) => setEmail(evento.target.value)}
                  className={CLASE_INPUT}
                />
              </div>
            )}

            <div>
              <Etiqueta>Rol</Etiqueta>
              <div className="grid grid-cols-2 gap-2">
                {ROLES_PERSONAL.map((opcion) => {
                  const elegido = rol === opcion.id
                  const bloqueado = esEdicion && esYo
                  return (
                    <button
                      key={opcion.id}
                      type="button"
                      disabled={bloqueado}
                      aria-pressed={elegido}
                      onClick={() => setRol(opcion.id)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                        elegido
                          ? 'border-purple-300 bg-purple-300/10'
                          : 'border-border hover:border-border-strong'
                      }`}
                    >
                      <span className={`block text-sm font-medium ${elegido ? 'text-purple-300' : 'text-ink'}`}>
                        {opcion.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-ink/60">{opcion.detalle}</span>
                    </button>
                  )
                })}
              </div>
              {esEdicion && esYo && (
                <p className="mt-1 text-xs text-ink/60">No puedes cambiar tu propio rol.</p>
              )}
            </div>

            {!esEdicion && rol === 'ADMINISTRADOR' && (
              <button
                type="button"
                onClick={() => setTambienAtiende((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-purple-300"
              >
                <span className="min-w-0 text-sm text-ink">
                  También atiende servicios
                  <span className="block text-xs text-ink/60">Le crea ficha para asignarle citas.</span>
                </span>
                <Interruptor activado={tambienAtiende} colorActivado="bg-purple-300" />
              </button>
            )}

            {!esEdicion && (
              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-clave`}>
                  Contraseña inicial
                </Etiqueta>
                <div className="flex items-center gap-2">
                  <input
                    id={`${idBase}-clave`}
                    type={verPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(evento) => setPassword(evento.target.value)}
                    className={`${CLASE_INPUT} font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setVerPassword((v) => !v)}
                    aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink/70 hover:border-purple-300"
                  >
                    {verPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPassword(generarPassword())}
                    aria-label="Generar contraseña"
                    title="Generar contraseña"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink/70 hover:border-purple-300"
                  >
                    <Sparkles className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-ink/60">
                  Mínimo {MIN_PASSWORD} caracteres, sin claves obvias como 12345678.
                </p>
              </div>
            )}

            {esEdicion && (
              <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-ink/70">
                <strong className="text-ink">Contraseña:</strong> no se puede ver — por seguridad Supabase solo guarda una versión
                cifrada. Si la persona la olvidó, usa el botón de la llave (<em>Contraseña</em>) de la lista para definirle una
                nueva y entrégasela.
              </p>
            )}

            {esEdicion && ROLES_CON_FICHA.includes(rol) && !ROLES_CON_FICHA.includes(persona.rol) && (
              <p className="rounded-lg border border-purple-300/30 bg-purple-300/10 px-3 py-2 text-xs text-ink/80">
                Al guardar se le crea su ficha de asistente. Recuerda asignarle sus % en Porcentajes.
              </p>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
