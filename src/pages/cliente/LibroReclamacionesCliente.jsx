import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

// Libro de Reclamaciones virtual (Ley 29571 / D.S. 011-2011-PCM, INDECOPI).
// Vive dentro de la web, sin sesión: un visitante puede presentar su reclamo.
// Se guarda con registrar_reclamo() (security definer, ver migración
// 20261009000004); el administrador lo atiende desde Web → Libro de Reclamaciones.
// Al enviar, la hoja se muestra en pantalla y se puede imprimir/guardar como PDF:
// la persona se queda con su copia aunque no haya correo automático.

const CAMPO =
  'w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[var(--lw-gold)]'

const formularioVacio = {
  nombre: '',
  tipoDocumento: 'DNI',
  numeroDocumento: '',
  domicilio: '',
  telefono: '',
  email: '',
  menorDeEdad: false,
  apoderadoNombre: '',
  bienTipo: 'SERVICIO',
  bienDescripcion: '',
  montoReclamado: '',
  tipo: 'RECLAMO',
  detalle: '',
  pedido: '',
  conformidad: false,
  // Campo trampa: una persona nunca lo ve ni lo llena; un bot sí.
  sitioWeb: '',
}

const formatoFechaHora = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Lima',
})
const formatoFecha = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' })

function Etiqueta({ children, obligatorio, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-white/50">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

function Seccion({ titulo, children }) {
  return (
    <section className="liquid-glass space-y-4 rounded-none p-5">
      <h2 className="text-sm font-semibold text-[var(--lw-gold)]">{titulo}</h2>
      {children}
    </section>
  )
}

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// Abre la hoja en una ventana aparte, en blanco y negro, lista para imprimir o
// «Guardar como PDF». Más fiable que imprimir la página con su tema oscuro.
function imprimirHoja({ constancia, datos, proveedor }) {
  const filas = [
    ['Código', constancia.codigo],
    ['Fecha de presentación', formatoFechaHora.format(new Date(constancia.creado_en))],
    ['Proveedor', `${proveedor?.razon_social ?? 'Jaise Beauty Academy'}${proveedor?.ruc ? ` — RUC ${proveedor.ruc}` : ''}`],
    ['Establecimiento', proveedor?.direccion ?? ''],
    ['Consumidor', `${datos.nombre} — ${datos.tipoDocumento} ${datos.numeroDocumento}`],
    ['Domicilio', datos.domicilio],
    ['Correo / teléfono', `${datos.email}${datos.telefono ? ` / ${datos.telefono}` : ''}`],
    ...(datos.menorDeEdad ? [['Padre, madre o tutor', datos.apoderadoNombre]] : []),
    ['Bien contratado', `${datos.bienTipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}: ${datos.bienDescripcion}`],
    ...(datos.montoReclamado ? [['Monto reclamado', `S/ ${datos.montoReclamado}`]] : []),
    ['Tipo', datos.tipo === 'RECLAMO' ? 'Reclamo' : 'Queja'],
    ['Detalle', datos.detalle],
    ['Pedido del consumidor', datos.pedido],
    ['Respuesta del proveedor hasta', formatoFecha.format(new Date(`${constancia.fecha_limite}T12:00:00`))],
  ]
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Hoja de reclamación ${escaparHtml(constancia.codigo)}</title>
<style>body{font-family:Arial,sans-serif;color:#000;margin:32px;font-size:13px}h1{font-size:18px;margin:0 0 4px}
p.sub{margin:0 0 16px;color:#444}table{border-collapse:collapse;width:100%}td{border:1px solid #999;padding:6px 8px;vertical-align:top}
td:first-child{width:32%;font-weight:bold;background:#f2f2f2}td:last-child{white-space:pre-wrap}.pie{margin-top:16px;color:#444;font-size:11px}</style></head>
<body><h1>Libro de Reclamaciones — Hoja de reclamación</h1><p class="sub">Ley N.º 29571, Código de Protección y Defensa del Consumidor</p>
<table>${filas.map(([k, v]) => `<tr><td>${escaparHtml(k)}</td><td>${escaparHtml(v)}</td></tr>`).join('')}</table>
<p class="pie">La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.</p>
<script>window.onload=function(){window.print()}</script></body></html>`
  const ventana = window.open('', '_blank')
  if (!ventana) return false
  ventana.document.open()
  ventana.document.write(html)
  ventana.document.close()
  return true
}

export default function LibroReclamacionesCliente() {
  const { usuario } = useAuth()
  const [proveedor, setProveedor] = useState(null)
  const [formulario, setFormulario] = useState(formularioVacio)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [constancia, setConstancia] = useState(null)
  const [datosEnviados, setDatosEnviados] = useState(null)
  const [avisoImpresion, setAvisoImpresion] = useState('')

  useEffect(() => {
    let vigente = true
    supabase.rpc('datos_proveedor_reclamos').then(({ data }) => {
      if (vigente) setProveedor(Array.isArray(data) ? (data[0] ?? null) : data)
    })
    return () => {
      vigente = false
    }
  }, [])

  // Si hay sesión, se adelanta el correo (la persona puede cambiarlo).
  useEffect(() => {
    if (usuario?.email) {
      setFormulario((anterior) => (anterior.email ? anterior : { ...anterior, email: usuario.email }))
    }
  }, [usuario?.email])

  function actualizar(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function enviar(evento) {
    evento.preventDefault()
    setError('')
    // Honeypot: se finge éxito sin enviar nada.
    if (formulario.sitioWeb) return

    setEnviando(true)
    const { data, error: errorRpc } = await supabase.rpc('registrar_reclamo', {
      p_datos: {
        nombre: formulario.nombre,
        tipo_documento: formulario.tipoDocumento,
        numero_documento: formulario.numeroDocumento,
        domicilio: formulario.domicilio,
        telefono: formulario.telefono,
        email: formulario.email,
        menor_de_edad: formulario.menorDeEdad,
        apoderado_nombre: formulario.apoderadoNombre,
        bien_tipo: formulario.bienTipo,
        bien_descripcion: formulario.bienDescripcion,
        monto_reclamado: formulario.montoReclamado,
        tipo: formulario.tipo,
        detalle: formulario.detalle,
        pedido: formulario.pedido,
        conformidad: formulario.conformidad,
      },
    })
    setEnviando(false)

    if (errorRpc) {
      const esDeValidacion = ['22023', '54000'].includes(errorRpc.code)
      setError(
        esDeValidacion
          ? errorRpc.message
          : 'No se pudo registrar tu reclamo. Revisa tu conexión e intenta de nuevo.',
      )
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    setDatosEnviados(formulario)
    setConstancia(fila)
    window.scrollTo?.({ top: 0 })
  }

  function manejarImprimir() {
    setAvisoImpresion('')
    const abierta = imprimirHoja({ constancia, datos: datosEnviados, proveedor })
    if (!abierta) setAvisoImpresion('Tu navegador bloqueó la ventana. Permite las ventanas emergentes e intenta de nuevo.')
  }

  if (constancia) {
    return (
      <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <div className="liquid-glass rounded-none p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--lw-gold)]" />
            <h1 className="mt-3 text-lg font-semibold text-white">Tu hoja de reclamación fue registrada</h1>
            <p className="mt-1 text-sm text-white/60">Guarda este código para cualquier seguimiento.</p>
            <p className="mt-4 font-mono text-2xl font-semibold text-[var(--lw-gold)]">{constancia.codigo}</p>
            <p className="mt-1 text-xs text-white/50">
              Presentado el {formatoFechaHora.format(new Date(constancia.creado_en))}
            </p>
            <p className="mt-4 text-sm text-white/70">
              Responderemos a <span className="text-white">{datosEnviados.email}</span> a más tardar el{' '}
              <span className="text-white">
                {formatoFecha.format(new Date(`${constancia.fecha_limite}T12:00:00`))}
              </span>{' '}
              (15 días hábiles).
            </p>
            <button
              type="button"
              onClick={manejarImprimir}
              className="mx-auto mt-5 flex items-center gap-2 rounded-full border border-[var(--lw-gold)] px-5 py-2.5 text-sm font-semibold text-[var(--lw-gold)]"
            >
              <Printer className="h-4 w-4" />
              Imprimir o guardar mi copia (PDF)
            </button>
            {avisoImpresion && <p className="mt-3 text-xs text-red">{avisoImpresion}</p>}
          </div>
        </div>
        <PieClienteWeb />
      </div>
    )
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <form onSubmit={enviar} className="mx-auto w-full max-w-2xl space-y-4">
        <div className="liquid-glass flex items-start gap-3 rounded-none p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--lw-gold)]">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-white">Libro de Reclamaciones</h1>
            <p className="mt-0.5 text-xs text-white/50">
              Conforme al Código de Protección y Defensa del Consumidor (Ley N.º 29571).
            </p>
            <p className="mt-2 text-xs text-white/70">
              {proveedor?.razon_social ?? 'Jaise Beauty Academy'}
              {proveedor?.ruc ? ` · RUC ${proveedor.ruc}` : ''}
              {proveedor?.direccion ? ` · ${proveedor.direccion}` : ''}
            </p>
          </div>
        </div>

        <Seccion titulo="1. Identificación del consumidor">
          <div>
            <Etiqueta obligatorio htmlFor="lr-nombre">Nombres y apellidos</Etiqueta>
            <input id="lr-nombre" className={CAMPO} value={formulario.nombre} maxLength={120} required
              autoComplete="name" onChange={(e) => actualizar('nombre', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Etiqueta obligatorio htmlFor="lr-tipodoc">Documento</Etiqueta>
              <select id="lr-tipodoc" className={CAMPO} value={formulario.tipoDocumento}
                onChange={(e) => actualizar('tipoDocumento', e.target.value)}>
                <option className="bg-[#1a1a1a]" value="DNI">DNI</option>
                <option className="bg-[#1a1a1a]" value="CE">C. extranjería</option>
                <option className="bg-[#1a1a1a]" value="PASAPORTE">Pasaporte</option>
              </select>
            </div>
            <div className="col-span-2">
              <Etiqueta obligatorio htmlFor="lr-numdoc">N.º de documento</Etiqueta>
              <input id="lr-numdoc" className={CAMPO} value={formulario.numeroDocumento} required
                inputMode={formulario.tipoDocumento === 'DNI' ? 'numeric' : 'text'}
                maxLength={formulario.tipoDocumento === 'DNI' ? 8 : 20}
                onChange={(e) => actualizar('numeroDocumento', e.target.value)} />
            </div>
          </div>
          <div>
            <Etiqueta obligatorio htmlFor="lr-domicilio">Domicilio</Etiqueta>
            <input id="lr-domicilio" className={CAMPO} value={formulario.domicilio} maxLength={200} required
              autoComplete="street-address" onChange={(e) => actualizar('domicilio', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Etiqueta obligatorio htmlFor="lr-email">Correo electrónico</Etiqueta>
              <input id="lr-email" type="email" className={CAMPO} value={formulario.email} maxLength={160}
                required autoComplete="email" onChange={(e) => actualizar('email', e.target.value)} />
            </div>
            <div>
              <Etiqueta htmlFor="lr-telefono">Teléfono</Etiqueta>
              <input id="lr-telefono" type="tel" className={CAMPO} value={formulario.telefono} maxLength={20}
                autoComplete="tel" onChange={(e) => actualizar('telefono', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={formulario.menorDeEdad}
              onChange={(e) => actualizar('menorDeEdad', e.target.checked)} />
            Soy menor de edad
          </label>
          {formulario.menorDeEdad && (
            <div>
              <Etiqueta obligatorio htmlFor="lr-apoderado">Nombre del padre, madre o tutor</Etiqueta>
              <input id="lr-apoderado" className={CAMPO} value={formulario.apoderadoNombre} maxLength={120}
                required onChange={(e) => actualizar('apoderadoNombre', e.target.value)} />
            </div>
          )}
        </Seccion>

        <Seccion titulo="2. Identificación del bien contratado">
          <div className="grid grid-cols-2 gap-2">
            {[['SERVICIO', 'Servicio'], ['PRODUCTO', 'Producto']].map(([valor, texto]) => (
              <button key={valor} type="button" aria-pressed={formulario.bienTipo === valor}
                onClick={() => actualizar('bienTipo', valor)}
                className={`rounded-full border py-2 text-sm transition-colors ${
                  formulario.bienTipo === valor
                    ? 'border-[var(--lw-gold)] text-[var(--lw-gold)]'
                    : 'border-white/15 text-white/60'
                }`}>
                {texto}
              </button>
            ))}
          </div>
          <div>
            <Etiqueta obligatorio htmlFor="lr-bien">Descripción</Etiqueta>
            <input id="lr-bien" className={CAMPO} value={formulario.bienDescripcion} maxLength={200} required
              placeholder="Ej. Corte y tinte, shampoo reparador…"
              onChange={(e) => actualizar('bienDescripcion', e.target.value)} />
          </div>
          <div>
            <Etiqueta htmlFor="lr-monto">Monto reclamado (S/)</Etiqueta>
            <input id="lr-monto" className={CAMPO} inputMode="decimal" value={formulario.montoReclamado}
              placeholder="Opcional"
              onChange={(e) => actualizar('montoReclamado', e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
        </Seccion>

        <Seccion titulo="3. Detalle de la reclamación">
          <div className="grid grid-cols-2 gap-2">
            {[['RECLAMO', 'Reclamo'], ['QUEJA', 'Queja']].map(([valor, texto]) => (
              <button key={valor} type="button" aria-pressed={formulario.tipo === valor}
                onClick={() => actualizar('tipo', valor)}
                className={`rounded-full border py-2 text-sm transition-colors ${
                  formulario.tipo === valor
                    ? 'border-[var(--lw-gold)] text-[var(--lw-gold)]'
                    : 'border-white/15 text-white/60'
                }`}>
                {texto}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-white/40">
            <strong className="text-white/60">Reclamo:</strong> disconformidad con el producto o servicio.{' '}
            <strong className="text-white/60">Queja:</strong> malestar por la atención recibida, sin que
            afecte el producto o servicio.
          </p>
          <div>
            <Etiqueta obligatorio htmlFor="lr-detalle">Detalle</Etiqueta>
            <textarea id="lr-detalle" rows={5} className={CAMPO} value={formulario.detalle} maxLength={2000}
              required onChange={(e) => actualizar('detalle', e.target.value)} />
          </div>
          <div>
            <Etiqueta obligatorio htmlFor="lr-pedido">Pedido del consumidor</Etiqueta>
            <textarea id="lr-pedido" rows={3} className={CAMPO} value={formulario.pedido} maxLength={1000}
              required placeholder="¿Qué solución esperas?"
              onChange={(e) => actualizar('pedido', e.target.value)} />
          </div>
        </Seccion>

        {/* Honeypot: fuera de pantalla, sin foco ni lectura por lector de pantalla. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            No llenar
            <input tabIndex={-1} autoComplete="off" value={formulario.sitioWeb}
              onChange={(e) => actualizar('sitioWeb', e.target.value)} />
          </label>
        </div>

        <div className="liquid-glass space-y-4 rounded-none p-5">
          <label className="flex items-start gap-2 text-xs text-white/70">
            <input type="checkbox" className="mt-0.5" checked={formulario.conformidad} required
              onChange={(e) => actualizar('conformidad', e.target.checked)} />
            <span>
              Declaro que la información es veraz.<span className="text-red"> *</span>
            </span>
          </label>
          <p className="text-[11px] leading-relaxed text-white/40">
            La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es
            requisito previo para interponer una denuncia ante el INDECOPI. El proveedor debe dar
            respuesta en un plazo no mayor a 15 días hábiles, prorrogable por otros 15 según la
            complejidad del caso.
          </p>
          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}
          <button type="submit" disabled={enviando}
            className="w-full rounded-full border border-[var(--lw-gold)] bg-transparent py-2.5 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40">
            {enviando ? 'Enviando...' : 'Enviar hoja de reclamación'}
          </button>
        </div>
      </form>
      <PieClienteWeb />
    </div>
  )
}
