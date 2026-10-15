import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Pause, Play, Save, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import GuiaPestana from '../components/GuiaPestana.jsx'
import FotosLogin from '../components/FotosLogin.jsx'
import { FOTOS_LOGIN_RESPALDO, MAX_FOTOS_LOGIN } from '../config/fotosLogin.js'
import { BUCKET_LOGIN, guardarFotosLogin, leerFotosLogin, prepararFotoLogin, subirFotoLogin } from '../lib/fotosLogin.js'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { confirmarGuardado, envioDe, formularioEditado, formularioEnviado } from '../lib/formulariosProtegidos.js'
import './Login.css'

const BOTON = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong px-3 text-sm text-ink hover:border-azul-metal disabled:opacity-40'

export default function LoginWeb() {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const [fotos, setFotos] = useState([])
  const [base, setBase] = useState([])
  const [cargando, setCargando] = useState(true)
  const [cargaCorrecta, setCargaCorrecta] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [editado, setEditado] = useState(false)
  const [error, setError] = useState('')
  const [progreso, setProgreso] = useState('')
  const [temaVista, setTemaVista] = useState('oscuro')
  const [pausaVista, setPausaVista] = useState(false)
  const archivoRef = useRef(null)
  const formularioRef = useRef(null)
  const previews = useRef(new Set())
  const subidas = useRef(new Map())

  function liberarPreviews() {
    previews.current.forEach((url) => URL.revokeObjectURL(url))
    previews.current.clear()
  }

  async function cargar() {
    setCargando(true)
    setCargaCorrecta(false)
    setError('')
    try {
      const datos = await leerFotosLogin()
      liberarPreviews()
      subidas.current.clear()
      setFotos(datos)
      setBase(datos)
      setEditado(false)
      setCargaCorrecta(true)
      formularioEnviado(formularioRef.current)
      confirmarGuardado(envioDe(formularioRef.current))
    } catch {
      setError('No se pudieron cargar las fotos del login. Reintenta la carga antes de editar.')
    } finally { setCargando(false) }
  }

  useEffect(() => {
    if (rol === 'ADMINISTRADOR') cargar()
    return () => liberarPreviews()
  }, [rol]) // La pantalla cacheada conserva su borrador al cambiar de pestaña.

  function actualizar(nuevas) {
    setFotos(nuevas)
    setEditado(true)
    formularioEditado('/login-web', formularioRef.current)
  }

  function elegirArchivo(id = '') {
    archivoRef.current.dataset.reemplazar = id
    archivoRef.current.click()
  }

  async function recibirArchivos(evento) {
    const archivos = [...evento.target.files]
    const reemplazar = evento.target.dataset.reemplazar
    evento.target.value = ''
    if (!archivos.length) return
    if (!reemplazar && fotos.length + archivos.length > MAX_FOTOS_LOGIN) {
      setError(`Puedes configurar hasta ${MAX_FOTOS_LOGIN} fotos.`)
      return
    }
    setOcupado(true)
    setError('')
    try {
      const nuevas = []
      for (const archivo of reemplazar ? archivos.slice(0, 1) : archivos) {
        const blob = await prepararFotoLogin(archivo)
        const preview = URL.createObjectURL(blob)
        previews.current.add(preview)
        nuevas.push({ id: reemplazar || crypto.randomUUID(), titulo: archivo.name.replace(/\.[^.]+$/, '').slice(0, 120), foto_url: '', activo: true, blob, preview })
      }
      if (reemplazar) {
        subidas.current.delete(reemplazar)
        actualizar(fotos.map((f) => f.id === reemplazar ? { ...nuevas[0], titulo: f.titulo, activo: f.activo } : f))
      } else actualizar([...fotos, ...nuevas])
    } catch (e) { setError(e.message || 'No se pudo preparar la imagen.') }
    finally { setOcupado(false) }
  }

  function mover(indice, paso) {
    const nuevas = [...fotos]
    ;[nuevas[indice], nuevas[indice + paso]] = [nuevas[indice + paso], nuevas[indice]]
    actualizar(nuevas)
  }

  async function guardar(evento) {
    evento.preventDefault()
    if (ocupado || cargando || !cargaCorrecta || !editado) return
    formularioEnviado(formularioRef.current)
    const envio = envioDe(formularioRef.current)
    setOcupado(true)
    setError('')
    try {
      const listas = []
      for (const [indice, foto] of fotos.entries()) {
        let referencia = foto.foto_url
        if (foto.blob) {
          referencia = subidas.current.get(foto.id)
          if (!referencia) {
            setProgreso(`Subiendo foto ${indice + 1} de ${fotos.length}…`)
            referencia = await subirFotoLogin(foto.blob)
            subidas.current.set(foto.id, referencia)
          }
        }
        listas.push({ ...foto, foto_url: referencia })
      }
      setProgreso('Guardando cambios…')
      const guardadas = await guardarFotosLogin(listas, base)
      setFotos(guardadas)
      setBase(guardadas)
      liberarPreviews()
      subidas.current.clear()
      setEditado(false)
      confirmarGuardado(envio)
      mostrarToast('Fotos del login actualizadas.', 'exito')
    } catch (e) {
      setError(e.message || 'No se pudo guardar. Conservamos tu borrador para reintentar.')
    } finally {
      setProgreso('')
      setOcupado(false)
    }
  }

  if (rol !== 'ADMINISTRADOR') return <p className="p-4 text-ink">Esta sección es exclusiva del administrador.</p>
  const activas = fotos.filter((f) => f.activo).map((f) => ({ ...f, url: f.preview || urlPublicaFoto(BUCKET_LOGIN, f.foto_url) }))

  return (
    <div className="relative px-(--separador-vertical) pb-6 pt-(--separador-horizontal) lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      <GuiaPestana>Fotos de campaña de la pantalla de acceso. Edita el borrador y pulsa Guardar cambios para publicarlo. Sin fotos activas se muestran las imágenes de respaldo.</GuiaPestana>
      <form ref={formularioRef} onSubmit={guardar} aria-busy={ocupado}>
        <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Seleccionar fotos del login" onChange={recibirArchivos} disabled={ocupado || cargando || !cargaCorrecta} />
        <div className="mb-3 flex flex-wrap items-center gap-2 pr-10">
          <h1 className="mr-auto text-lg font-semibold text-ink">Fotos del login</h1>
          <button type="button" onClick={() => elegirArchivo()} disabled={ocupado || cargando || !cargaCorrecta || fotos.length >= MAX_FOTOS_LOGIN} className={BOTON}><ImagePlus className="h-4 w-4" />Agregar fotos</button>
          <button type="submit" disabled={ocupado || cargando || !editado} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-azul-metal px-4 text-sm font-semibold text-bg disabled:opacity-40"><Save className="h-4 w-4" />{ocupado ? progreso || 'Preparando…' : 'Guardar cambios'}</button>
        </div>
        {error && <p role="alert" className="mb-3 rounded-lg border border-red/40 p-3 text-sm text-red">{error}</p>}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <fieldset disabled={ocupado || cargando || !cargaCorrecta} className="min-w-0 space-y-3">
            <legend className="mb-2 text-sm text-ink/60">{cargando ? 'Cargando fotos…' : `${fotos.length} de ${MAX_FOTOS_LOGIN} fotos · ${editado ? 'Cambios sin guardar' : 'Sin cambios pendientes'}`}</legend>
            {!cargando && fotos.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-ink/70">Todavía no hay fotos de campaña. El login conserva las tres imágenes de respaldo.</p>}
            {fotos.map((foto, indice) => (
              <div key={foto.id} className="flex gap-3 rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
                <img src={foto.preview || urlPublicaFoto(BUCKET_LOGIN, foto.foto_url, 'm')} alt="" className="h-24 w-20 shrink-0 rounded-lg object-cover" />
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block text-xs text-ink/70">Nombre de la foto {indice + 1}<input aria-label={`Nombre de la foto ${indice + 1}`} value={foto.titulo} maxLength={120} onChange={(e) => actualizar(fotos.map((f) => f.id === foto.id ? { ...f, titulo: e.target.value } : f))} className="mt-1 w-full rounded-lg border border-border-strong bg-bg px-2 py-1.5 text-sm text-ink" /></label>
                  <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={foto.activo} onChange={(e) => actualizar(fotos.map((f) => f.id === foto.id ? { ...f, activo: e.target.checked } : f))} />Mostrar en el login</label>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => elegirArchivo(foto.id)} className={BOTON}>Cambiar foto</button>
                    <button type="button" aria-label={`Subir foto ${indice + 1}`} disabled={indice === 0} onClick={() => mover(indice, -1)} className={BOTON}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Bajar foto ${indice + 1}`} disabled={indice === fotos.length - 1} onClick={() => mover(indice, 1)} className={BOTON}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Quitar foto ${indice + 1}`} onClick={() => actualizar(fotos.filter((f) => f.id !== foto.id))} className={BOTON}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </fieldset>
          <section className="min-w-0 rounded-lg border border-border bg-surface p-3" aria-label="Vista previa del login">
            <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-semibold text-ink">Vista previa</h2><button type="button" className={BOTON} onClick={() => setTemaVista((t) => t === 'oscuro' ? 'claro' : 'oscuro')}>{temaVista === 'oscuro' ? 'Ver en claro' : 'Ver en oscuro'}</button><button type="button" className={BOTON} aria-label={pausaVista ? 'Reanudar vista previa' : 'Pausar vista previa'} onClick={() => setPausaVista((p) => !p)}>{pausaVista ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button></div>
            <div className="lgn grid overflow-hidden rounded-lg sm:grid-cols-2" data-tema-login={temaVista} style={{ minHeight: 0, '--lgn-foto': `url(${FOTOS_LOGIN_RESPALDO[0].url})` }}>
              <FotosLogin fotos={activas} pausadas={pausaVista} style={{ position: 'relative', height: '100%', minHeight: 260 }} />
              <div className="lgn-panel gap-4" style={{ padding: 18, minHeight: 0 }} aria-hidden="true"><p className="text-center font-bold">JAISE</p><p className="text-center text-lg font-semibold">Bienvenida de nuevo</p><div className="lgn-campo" /><div className="lgn-campo" /><span className="lgn-btn" style={{ fontSize: 14, marginTop: 0 }}>Ingresar</span></div>
            </div>
            <p className="mt-3 text-xs text-ink/60">{activas.length ? `${activas.length} fotos activas en el orden del borrador.` : 'Mostrando las fotos de respaldo.'} Los cambios se ven en el login después de guardar y volver a abrirlo.</p>
          </section>
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={BOTON} disabled={ocupado} onClick={cargar}>{editado ? 'Descartar borrador y recargar' : 'Recargar fotos'}</button></div>
      </form>
    </div>
  )
}
