import { Fragment, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Download, FileText, Filter, History, MessageCircle, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { calcularRango, formatearFechaISO, sumarDias } from '../lib/fechas.js'
import { formatearSoles } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { aCSV, descargarArchivo, parsearCSV } from '../lib/csv.js'
import { adjuntarPdfComprobante, enviarPdfPorWhatsApp, verPdfComprobante } from '../lib/comprobantesPdf.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import TicketImprimible from '../components/TicketImprimible.jsx'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import MenuOpcionesHistorial from '../components/MenuOpcionesHistorial.jsx'
import { useEncabezadoTablaPegado } from '../hooks/useEncabezadoTablaPegado.js'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalDatosComprobante from '../components/ModalDatosComprobante.jsx'
import {
  boletaRequiereDni,
  desglosarIGV,
  etiquetaDocumento,
  formatearCelular,
  nombreComprobante,
  normalizarCelular,
} from '../lib/comprobante.js'
import { useEstadoVista } from '../lib/estadoVista.js'
import IconoFlechaDesplegable from '../components/IconoFlechaDesplegable.jsx'

const OPCIONES_ORDEN = [
  { id: 'fecha-desc', label: 'Más recientes primero' },
  { id: 'fecha-asc', label: 'Más antiguas primero' },
  { id: 'total-desc', label: 'Monto mayor' },
  { id: 'total-asc', label: 'Monto menor' },
]

const OPCIONES_METODO = [
  { id: 'todos', label: 'Todos los métodos' },
  { id: 'Efectivo', label: 'Efectivo' },
  { id: 'Tarjeta', label: 'Tarjeta' },
  { id: 'Transferencia', label: 'Transferencia' },
  { id: 'Yape', label: 'Yape' },
  { id: 'Plin', label: 'Plin' },
]

const TAMANO_PAGINA = 50

const SELECT_VENTAS =
  'id, codigo, fecha, estado, total, metodo_pago, comprobante_tipo, comprobante_numero, comprobante_estado, clientes(nombre), venta_items(tipo, cantidad)'

const SELECT_DETALLE_VENTA =
  'id, codigo, fecha, estado, total, descuento_pct, descuento_monto, adelanto_monto, adelanto_metodo, metodo_pago, monto_recibido, vendedor_id, comprobante_tipo, comprobante_numero, comprobante_tipo_doc, comprobante_documento, comprobante_nombre, comprobante_direccion, comprobante_celular, comprobante_pdf, comprobante_estado, comprobante_legal, clientes(nombre, telefono)'

// Para la lista que se le pasa a la contadora: una fila por venta con boleta/factura.
// `pedidos_web` trae lo que la clienta eligió en la web (tipo, RUC, razón social).
const SELECT_VENTAS_COMPROBANTES =
  'codigo, fecha, total, metodo_pago, comprobante_tipo, comprobante_numero, comprobante_tipo_doc, comprobante_documento, comprobante_nombre, comprobante_direccion, comprobante_celular, comprobante_estado, comprobante_legal, clientes(nombre, telefono), venta_items(tipo, nombre, cantidad, precio_unitario, subtotal), pedidos_web(tipo_comprobante, ruc, razon_social)'

// Select propio para exportarCSV(): la lista paginada no necesita
// monto_recibido/vendedor_id ni los detalles de cada item, pero el CSV sí
// declara esas columnas — reutilizar SELECT_VENTAS ahí las dejaba vacías sin
// ningún error visible (C1 de la 2ª auditoría). "id"/"cliente_id" no hacen
// falta: el código ya identifica la venta y el cliente va embebido por nombre.
const SELECT_VENTAS_EXPORT =
  'codigo, fecha, estado, total, metodo_pago, monto_recibido, vendedor_id, clientes(nombre), venta_items(tipo, nombre, cantidad, precio_unitario, subtotal)'

const RESUMEN_VACIO = { cantidadVentas: 0, totalRecaudado: 0, productosVendidos: 0 }

function filtrarPorMetodo(ventas, metodo) {
  return metodo === 'todos' ? ventas : ventas.filter((venta) => venta.metodo_pago === metodo)
}

function ordenarVentas(ventas, orden) {
  const ordenadas = [...ventas]
  switch (orden) {
    case 'fecha-asc':
      return ordenadas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    case 'total-desc':
      return ordenadas.sort((a, b) => b.total - a.total)
    case 'total-asc':
      return ordenadas.sort((a, b) => a.total - b.total)
    default:
      return ordenadas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
  }
}

const CLASE_METODO_PAGO_PILL = {
  Efectivo: 'border border-green/40 bg-green/15 text-green',
  Tarjeta: 'border border-blue/40 bg-blue/15 text-blue',
  Transferencia: 'border border-gray-300/40 bg-gray-300/15 text-gray-300',
  Yape: 'border border-purple-300/40 bg-purple-300/15 text-purple-300',
  Plin: 'border border-cyan-300/40 bg-cyan-300/15 text-cyan-300',
}

// Color del ícono del filtro de método: el mismo texto de la cápsula del método elegido; «Todos» queda ámbar.
const CLASE_ICONO_FILTRO_METODO = {
  todos: 'text-amber',
  Efectivo: 'text-green',
  Tarjeta: 'text-blue',
  Transferencia: 'text-gray-300',
  Yape: 'text-purple-300',
  Plin: 'text-cyan-300',
}

// Solo cambia lo que se muestra (VEN007 -> V007) — el código real en la
// base de datos y en el CSV exportado no se toca.
function codigoCorto(codigo) {
  return codigo.replace(/^VEN/, 'V')
}

function formatearFechaHora(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(fecha)
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} ${horaStr}`
}

const redondearCentimos = (valor) => Math.round(valor * 100) / 100

// Una sola celda legible con lo vendido: «2 x Corte (servicio) a S/ 25.00 | 1 x Shampoo a S/ 30.00».
function detalleParaContadora(items) {
  return items
    .map(
      (item) =>
        `${item.cantidad} x ${item.nombre}${item.tipo === 'SERVICIO' ? ' (servicio)' : ''} a S/ ${Number(item.precio_unitario).toFixed(2)}`,
    )
    .join(' | ')
}

function nombreClienteDeVenta(venta) {
  const clientes = venta?.clientes
  if (!clientes) return ''
  return Array.isArray(clientes) ? (clientes[0]?.nombre ?? '') : (clientes.nombre ?? '')
}

// Etiqueta «Boleta»/«Factura» de la fila: ámbar mientras la contadora no la emitió, verde cuando sí.
function PildoraComprobante({ venta }) {
  if (!venta.comprobante_tipo) return null
  const emitido = venta.comprobante_estado === 'EMITIDO'
  return (
    <span
      title={`${nombreComprobante(venta.comprobante_tipo)} ${venta.comprobante_numero ?? ''} · ${
        emitido ? 'emitida por la contadora' : 'pendiente de emitir'
      }`}
      className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[10px] font-medium ${
        emitido ? 'border-green/40 bg-green/10 text-green' : 'border-amber/40 bg-amber/10 text-amber'
      }`}
    >
      {nombreComprobante(venta.comprobante_tipo)}
      <span className="sr-only">{emitido ? ' emitida' : ' pendiente de emitir'}</span>
    </span>
  )
}

// Boleta/factura de la venta: datos del comprador, estado frente a la contadora y,
// para la admin, registrar / corregir / marcar como emitida.
function BloqueComprobante({
  detalle,
  esAdmin,
  onRegistrar,
  onEditar,
  onCambiarEstado,
  onAdjuntarPdf,
  onVerPdf,
  onEnviarWhatsApp,
}) {
  const [numeroLegal, setNumeroLegal] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [trabajandoPdf, setTrabajandoPdf] = useState(false)
  const inputPdfRef = useRef(null)
  const anulada = detalle.estado === 'ANULADA'

  async function cambiarEstado(emitido) {
    if (guardando) return
    setGuardando(true)
    await onCambiarEstado(emitido, numeroLegal)
    setGuardando(false)
    setNumeroLegal('')
  }

  // Ojo con el orden: tanto «Ver PDF» como «Enviar por WhatsApp» abren una ventana, y el navegador solo lo permite si
  // ocurre dentro del clic, antes de cualquier espera.
  async function conPdf(accion) {
    if (trabajandoPdf) return
    setTrabajandoPdf(true)
    await accion()
    setTrabajandoPdf(false)
  }

  async function alElegirPdf(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (archivo) await conPdf(() => onAdjuntarPdf(archivo))
  }

  if (!detalle.comprobante_tipo) {
    if (!esAdmin || anulada) return null
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink/60">
        <span>Sin comprobante.</span>
        {['BOLETA', 'FACTURA'].map((tipo) => (
          <button
            key={tipo}
            type="button"
            onClick={() => onRegistrar(tipo)}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Registrar {nombreComprobante(tipo).toLowerCase()}
          </button>
        ))}
      </div>
    )
  }

  const emitido = detalle.comprobante_estado === 'EMITIDO'
  const esFactura = detalle.comprobante_tipo === 'FACTURA'
  const { base, igv } = desglosarIGV(detalle.total)
  // El celular del comprobante manda; si la venta no lo guardó (p. ej. una venta web) se usa el del cliente.
  const celularEnvio = normalizarCelular(detalle.comprobante_celular ?? detalle.clientes?.telefono)
  const tienePdf = Boolean(detalle.comprobante_pdf)

  return (
    <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">
          {nombreComprobante(detalle.comprobante_tipo)}{' '}
          <span className="font-mono text-amber">{detalle.comprobante_numero}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            emitido ? 'bg-green/15 text-green' : 'bg-amber/15 text-amber'
          }`}
        >
          {emitido ? 'Emitida por la contadora' : 'Pendiente de emitir'}
        </span>
      </div>

      <div className="mt-1.5 space-y-0.5 text-ink/60">
        {detalle.comprobante_documento && (
          <p>
            {etiquetaDocumento(esFactura ? 'RUC' : (detalle.comprobante_tipo_doc ?? 'DNI'))}: <span className="font-mono text-ink/80">{detalle.comprobante_documento}</span>
          </p>
        )}
        {detalle.comprobante_nombre && (
          <p>
            {esFactura ? 'Razón social' : 'Nombre'}: <span className="text-ink/80">{detalle.comprobante_nombre}</span>
          </p>
        )}
        {detalle.comprobante_direccion && (
          <p>
            Dirección: <span className="text-ink/80">{detalle.comprobante_direccion}</span>
          </p>
        )}
        <p>
          WhatsApp:{' '}
          {celularEnvio ? (
            <span className="font-mono text-ink/80">{formatearCelular(celularEnvio)}</span>
          ) : (
            <span className="text-amber">sin celular</span>
          )}
        </p>
        <p>
          Op. gravada <span className="font-mono text-ink/80">{formatearSoles(base)}</span> · IGV{' '}
          <span className="font-mono text-ink/80">{formatearSoles(igv)}</span>
        </p>
        {emitido && detalle.comprobante_legal && (
          <p>
            N° emitido: <span className="font-mono text-ink/80">{detalle.comprobante_legal}</span>
          </p>
        )}
      </div>

      {esAdmin && !anulada && (
        <>
          {/* PDF oficial que devuelve la contadora + envío por WhatsApp. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={inputPdfRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={alElegirPdf}
              aria-label="Elegir el PDF oficial del comprobante"
            />
            {tienePdf ? (
              <>
                <button
                  type="button"
                  onClick={() => conPdf(onVerPdf)}
                  disabled={trabajandoPdf}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  Ver PDF oficial
                </button>
                <button
                  type="button"
                  onClick={() => inputPdfRef.current?.click()}
                  disabled={trabajandoPdf}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  Cambiar PDF
                </button>
                <button
                  type="button"
                  onClick={() => conPdf(() => onEnviarWhatsApp(celularEnvio))}
                  disabled={trabajandoPdf || !celularEnvio}
                  title={celularEnvio ? 'Abrir WhatsApp con el PDF' : 'Falta el celular: edita los datos del comprobante'}
                  className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Enviar por WhatsApp
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => inputPdfRef.current?.click()}
                disabled={trabajandoPdf}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
              >
                {trabajandoPdf ? 'Subiendo...' : 'Adjuntar PDF oficial'}
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!emitido ? (
              <>
                <button
                  type="button"
                  onClick={onEditar}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber"
                >
                  Editar datos
                </button>
                <input
                  type="search"
                  autoComplete="new-password"
                  value={numeroLegal}
                  onChange={(evento) => setNumeroLegal(evento.target.value)}
                  placeholder="N° emitido (opcional)"
                  aria-label="Número del comprobante emitido por la contadora"
                  className="w-52 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-amber"
                />
                <button
                  type="button"
                  onClick={() => cambiarEstado(true)}
                  disabled={guardando}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  Marcar emitida
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => cambiarEstado(false)}
                disabled={guardando}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
              >
                Volver a pendiente
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DetalleVenta({
  estado,
  esAdmin,
  onImprimir,
  onIniciarAnular,
  onCancelarAnular,
  onConfirmarAnular,
  onRegistrarComprobante,
  onEditarComprobante,
  onCambiarEstadoComprobante,
  onAdjuntarPdf,
  onVerPdf,
  onEnviarWhatsApp,
}) {
  const { cargando, error, detalle, items, vendedorNombre, confirmandoAnular, anulando } = estado
  // Cliente/asistente por servicio: dato adicional, no molesta si se
  // muestra siempre — se oculta detrás de un toggle por fila (sin ícono,
  // solo el propio botón) en vez de ensuciar la fila compacta de siempre.
  const [itemsAbiertos, setItemsAbiertos] = useState(() => new Set())

  function alternarItem(id) {
    setItemsAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  if (cargando) {
    return <p className="py-4 text-center font-mono text-sm text-ink/60">Cargando detalle...</p>
  }

  if (error) {
    return (
      <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
        {error}
      </p>
    )
  }

  if (!detalle) return null

  const anulada = detalle.estado === 'ANULADA'
  // Lo cobrado en ESE ticket: el total de la venta menos el adelanto que la clienta ya había entregado.
  const cobradoHoy = detalle.total - (Number(detalle.adelanto_monto) || 0)
  const vuelto = detalle.monto_recibido != null ? detalle.monto_recibido - cobradoHoy : null

  const nombreCliente = nombreClienteDeVenta(detalle)

  return (
    <div className="px-[14px] pb-[26px] pt-0">
      <div>
      <p className="text-xs text-ink/60">
        Vendedor: <span className="text-ink/80">{vendedorNombre ?? '—'}</span>
      </p>
      {nombreCliente && (
        <p className="mt-0.5 text-xs text-ink/60">
          Cliente: <span className="text-ink/80">{nombreCliente}</span>
        </p>
      )}

      {/* Items */}
      <div className="mt-3 rounded-lg border border-border bg-bg">
        <div className="grid grid-cols-[1fr_3rem_4.5rem] lg:grid-cols-[1fr_5rem_6rem] gap-2 border-b border-border px-3 py-2 lg:gap-4 lg:px-6 font-mono text-xs uppercase tracking-wider text-ink/60">
          <span>Producto</span>
          <span className="text-center">
            <span className="lg:hidden">Cant.</span>
            <span className="hidden lg:inline">Cantidad</span>
          </span>
          <span className="text-right">Subtotal</span>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => {
            const contenidoFila = (
              <>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {item.tipo === 'SERVICIO' && (
                      <span className="rounded border border-blue/40 bg-blue/10 px-1 py-0.5 font-mono text-[11px] font-medium text-blue">
                        Servicio
                      </span>
                    )}
                    <span className="truncate text-sm text-ink">{item.nombre}</span>
                  </div>
                  {item.tipo !== 'SERVICIO' && (
                    <span className="font-mono text-[11px] text-ink/60">
                      {formatearSoles(item.precio_unitario)} c/u
                    </span>
                  )}
                </div>
                <span className="text-center font-mono text-sm text-ink">{item.cantidad}</span>
                <span className="text-right font-mono text-sm text-ink">
                  {formatearSoles(item.subtotal)}
                </span>
              </>
            )

            if (item.tipo !== 'SERVICIO') {
              return (
                <div key={item.id} className="grid grid-cols-[1fr_3rem_4.5rem] lg:grid-cols-[1fr_5rem_6rem] items-center gap-2 px-3 py-2 lg:gap-4 lg:px-6">
                  {contenidoFila}
                </div>
              )
            }

            const abierto = itemsAbiertos.has(item.id)
            return (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => alternarItem(item.id)}
                  aria-expanded={abierto}
                  className="grid w-full grid-cols-[1fr_3rem_4.5rem] lg:grid-cols-[1fr_5rem_6rem] items-center gap-2 px-3 py-2 text-left lg:gap-4 lg:px-6 transition-colors hover:bg-surface-2"
                >
                  {contenidoFila}
                </button>
                <CampoColapsable abierto={abierto}>
                  <div className="space-y-1 bg-surface-2/60 px-3 py-2 text-xs text-ink/60">
                    <p>
                      Cliente: <span className="text-ink/80">{item.clientes?.nombre ?? '—'}</span>
                    </p>
                    <p>
                      Realizado por:{' '}
                      <span className="text-ink/80">{item.asistentes?.nombres_completos ?? '—'}</span>
                    </p>
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
      </div>

      <BloqueComprobante
        detalle={detalle}
        esAdmin={esAdmin}
        onRegistrar={onRegistrarComprobante}
        onEditar={onEditarComprobante}
        onCambiarEstado={onCambiarEstadoComprobante}
        onAdjuntarPdf={onAdjuntarPdf}
        onVerPdf={onVerPdf}
        onEnviarWhatsApp={onEnviarWhatsApp}
      />

      </div>

      {/* Botones a la izquierda; descuento y pago a la derecha, bajo el carrito */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          {!confirmandoAnular && !anulada && (
            <>
              <button
                type="button"
                onClick={onIniciarAnular}
                className="rounded-lg border border-red bg-transparent px-4 py-2.5 text-sm font-semibold text-red transition-colors hover:bg-red/10"
              >
                Anular venta
              </button>
              {/* Reimprimir oculto en ventas anuladas (se podría reactivar más adelante) */}
              <button
                type="button"
                onClick={onImprimir}
                className="rounded-lg border border-border-strong px-4 py-2.5 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
              >
                Reimprimir ticket
              </button>
            </>
          )}
        </div>

      {(detalle.descuento_pct > 0 || detalle.descuento_monto > 0 || detalle.adelanto_monto > 0 || detalle.monto_recibido != null) && (
        <div className="ml-auto space-y-2">
          {detalle.adelanto_monto > 0 && (
            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-ink/60">Adelanto de la cita</span>
              <span className="font-mono font-medium text-blue">-{formatearSoles(detalle.adelanto_monto)}</span>
              {/* Con qué se pagó el adelanto (lo anotó quien agendó la cita; es solo informativo). */}
              {detalle.adelanto_metodo && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink/70">{detalle.adelanto_metodo}</span>
              )}
            </div>
          )}
          {detalle.descuento_pct > 0 && (
            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-ink/60">Descuento</span>
              <span className="font-mono font-medium text-red">{detalle.descuento_pct}%</span>
            </div>
          )}
          {detalle.descuento_monto > 0 && (
            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-ink/60">Descuento</span>
              <span className="font-mono font-medium text-red">{formatearSoles(detalle.descuento_monto)}</span>
            </div>
          )}
          {detalle.adelanto_monto > 0 && (
            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-ink/60">Cobrado en caja ese día</span>
              <span className="font-mono font-medium text-ink">{formatearSoles(cobradoHoy)}</span>
            </div>
          )}
          {detalle.monto_recibido != null && (
            <>
              <div className="flex items-center justify-end gap-3 text-sm">
                <span className="text-ink/60">Recibido</span>
                <span className="font-mono text-ink">{formatearSoles(detalle.monto_recibido)}</span>
              </div>
              <div className="flex items-center justify-end gap-3 text-sm">
                <span className="text-ink/60">Vuelto</span>
                <span className="font-mono text-green">{formatearSoles(vuelto)}</span>
              </div>
            </>
          )}
        </div>
      )}
      </div>

      {confirmandoAnular && (
        <div className="mt-4 rounded-lg border border-red/40 bg-red/5 p-3">
          <p className="text-sm text-ink">
            ¿Seguro que quieres anular la venta{' '}
            <span className="font-mono text-red">{codigoCorto(detalle.codigo)}</span>? Esto devolverá el stock
            de los productos.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onCancelarAnular}
              disabled={anulando}
              className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={onConfirmarAnular}
              disabled={anulando}
              className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {anulando ? 'Anulando...' : 'Sí, anular'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Historial({ activo = true }) {
  const { rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { mostrarToast } = useToast()

  const [filtro, setFiltro] = useEstadoVista('/historial:filtro', 'mes')
  const [personalizado, setPersonalizado] = useEstadoVista('/historial:personalizado', () => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [ventas, setVentas] = useState([])
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/historial:busqueda', '')
  const [orden, setOrden] = useEstadoVista('/historial:orden', 'fecha-desc')
  const [filtroMetodo, setFiltroMetodo] = useEstadoVista('/historial:filtroMetodo', 'todos')

  const [abiertos, setAbiertos] = useState(() => new Set())
  const [detalles, setDetalles] = useState({})
  const [ventaParaImprimir, setVentaParaImprimir] = useState(null)
  const [exportando, setExportando] = useState(false)
  const [exportandoComprobantes, setExportandoComprobantes] = useState(false)
  const [importando, setImportando] = useState(false)
  const inputImportarRef = useRef(null)
  // Modal de datos del comprador: { ventaId, tipo, total, inicial } o null.
  const [modalComprobante, setModalComprobante] = useState(null)
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: cargarMasVentas no llevaba el mismo guard
  // `vigente` que ya usa la carga inicial — si cambiabas de filtro/búsqueda
  // mientras la página siguiente viajaba, esa respuesta vieja se appendeaba
  // igual sobre la lista ya reemplazada por el filtro nuevo, mezclando
  // ventas de dos períodos. Este ref guarda el token vigente actual (el
  // mismo que crea el efecto de carga) para que cargarMasVentas pueda
  // descartar una respuesta que llegó tarde.
  const vigenteRef = useRef({ actual: true })

  async function cargarDetalleVenta(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { cargando: true, error: null, detalle: null, items: [], vendedorNombre: null },
    }))

    const [ventaRes, itemsRes] = await Promise.all([
      supabase.from('ventas').select(SELECT_DETALLE_VENTA).eq('id', ventaId).single(),
      supabase
        .from('venta_items')
        .select(
          'id, tipo, nombre, cantidad, precio_unitario, subtotal, clientes(nombre), asistentes(nombres_completos)',
        )
        .eq('venta_id', ventaId)
        .order('id'),
    ])

    if (ventaRes.error || itemsRes.error) {
      setDetalles((anterior) => ({
        ...anterior,
        [ventaId]: {
          ...anterior[ventaId],
          cargando: false,
          error: 'No se pudo cargar el detalle de la venta.',
        },
      }))
      return
    }

    let vendedorNombre = null
    if (ventaRes.data?.vendedor_id) {
      const { data: usuarioData } = await supabase
        .from('usuarios')
        .select('nombre_completo')
        .eq('id', ventaRes.data.vendedor_id)
        .maybeSingle()
      vendedorNombre = usuarioData?.nombre_completo ?? null
    }

    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: {
        cargando: false,
        error: null,
        detalle: ventaRes.data,
        items: itemsRes.data ?? [],
        vendedorNombre,
        confirmandoAnular: false,
        anulando: false,
      },
    }))
  }

  function alternarAbierto(ventaId) {
    const yaAbierto = abiertos.has(ventaId)
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (yaAbierto) siguiente.delete(ventaId)
      else siguiente.add(ventaId)
      return siguiente
    })
    if (!yaAbierto && !detalles[ventaId]) {
      cargarDetalleVenta(ventaId)
    }
  }

  function imprimirVenta(ventaId) {
    const info = detalles[ventaId]
    if (!info?.detalle) return
    setVentaParaImprimir({ detalle: info.detalle, items: info.items })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print())
    })
  }

  function iniciarAnular(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { ...anterior[ventaId], confirmandoAnular: true },
    }))
  }

  function cancelarAnular(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { ...anterior[ventaId], confirmandoAnular: false },
    }))
  }

  async function confirmarAnular(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { ...anterior[ventaId], anulando: true },
    }))

    const { error: errorAnular } = await supabase.rpc('anular_venta', { p_venta_id: ventaId })

    if (errorAnular) {
      setDetalles((anterior) => ({
        ...anterior,
        [ventaId]: { ...anterior[ventaId], anulando: false },
      }))
      mostrarToast(errorAnular.message, 'error')
      return
    }

    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: {
        ...anterior[ventaId],
        anulando: false,
        confirmandoAnular: false,
        detalle: { ...anterior[ventaId].detalle, estado: 'ANULADA' },
      },
    }))
    mostrarToast('Venta anulada. Se devolvió el stock.', 'exito')
    cargarVentas(vigenteRef.current, true)
  }

  function abrirModalComprobante(ventaId, tipo) {
    const detalle = detalles[ventaId]?.detalle
    if (!detalle) return
    const mismoTipo = detalle.comprobante_tipo === tipo
    setModalComprobante({
      ventaId,
      tipo,
      total: detalle.total,
      celularCliente: normalizarCelular(detalle.clientes?.telefono),
      inicial: mismoTipo
        ? {
            celular: detalle.comprobante_celular ?? '',
            tipoDocumento: detalle.comprobante_tipo_doc ?? 'DNI',
            documento: detalle.comprobante_documento ?? '',
            nombre: detalle.comprobante_nombre ?? '',
            direccion: detalle.comprobante_direccion ?? '',
          }
        : null,
    })
  }

  // Registra el comprobante de una venta que no lo tiene, o corrige los datos de uno pendiente.
  async function guardarComprobante(datos) {
    if (!modalComprobante) return
    const { ventaId } = modalComprobante
    const { error: errorRpc } = await supabase.rpc('registrar_comprobante_venta', {
      p_venta_id: ventaId,
      p_tipo: datos.tipo,
      p_tipo_documento: datos.tipo === 'BOLETA' ? datos.tipoDocumento : null,
      p_documento: datos.documento || null,
      p_celular: datos.celular || null,
      p_nombre: datos.nombre || null,
      p_direccion: datos.direccion || null,
    })
    if (errorRpc) {
      mostrarToast(errorRpc.message, 'error')
      return
    }
    setModalComprobante(null)
    mostrarToast('Comprobante guardado.')
    cargarDetalleVenta(ventaId)
    cargarVentas(vigenteRef.current, true)
  }

  async function cambiarEstadoComprobante(ventaId, emitido, numeroLegal) {
    const { error: errorRpc } = await supabase.rpc('actualizar_estado_comprobante', {
      p_venta_id: ventaId,
      p_emitido: emitido,
      p_numero_legal: numeroLegal?.trim() || null,
    })
    if (errorRpc) {
      mostrarToast(errorRpc.message, 'error')
      return
    }
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: {
        ...anterior[ventaId],
        detalle: {
          ...anterior[ventaId].detalle,
          comprobante_estado: emitido ? 'EMITIDO' : 'PENDIENTE',
          comprobante_legal: emitido ? numeroLegal?.trim() || null : null,
        },
      },
    }))
    mostrarToast(emitido ? 'Comprobante marcado como emitido.' : 'Comprobante vuelto a pendiente.')
    cargarVentas(vigenteRef.current, true)
  }

  async function adjuntarPdf(ventaId, archivo) {
    const { error: errorPdf } = await adjuntarPdfComprobante(ventaId, archivo)
    if (errorPdf) {
      mostrarToast(errorPdf, 'error')
      return
    }
    mostrarToast('PDF adjuntado.')
    cargarDetalleVenta(ventaId)
  }

  async function verPdf(ventaId) {
    const ruta = detalles[ventaId]?.detalle?.comprobante_pdf
    if (!ruta) return
    if (!(await verPdfComprobante(ruta))) mostrarToast('No se pudo abrir el PDF.', 'error')
  }

  // Sin esperas antes de enviarPdfPorWhatsApp: abre la ventana dentro del clic (si no, el navegador la bloquea).
  async function enviarWhatsApp(ventaId, celular) {
    const detalle = detalles[ventaId]?.detalle
    if (!detalle?.comprobante_pdf) {
      mostrarToast('Adjunta primero el PDF oficial.', 'error')
      return
    }
    if (!celular) {
      mostrarToast('Falta el celular: edita los datos del comprobante.', 'error')
      return
    }
    const salio = await enviarPdfPorWhatsApp({
      rutaPdf: detalle.comprobante_pdf,
      celular,
      tipo: detalle.comprobante_tipo,
      numeroLegal: detalle.comprobante_legal,
      nombre: detalle.comprobante_nombre || nombreClienteDeVenta(detalle),
    })
    if (!salio) mostrarToast('No se pudo preparar el mensaje de WhatsApp.', 'error')
  }

  // Lo que devuelve la contadora: el mismo CSV que se le exportó, con la columna «numero_emitido» llena. Marca como
  // emitidas, de una vez, las ventas con comprobante pendiente que tengan número.
  async function importarNumerosEmitidos(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo || importando) return
    if (archivo.size > 2 * 1024 * 1024) {
      mostrarToast('El archivo es demasiado grande.', 'error')
      return
    }
    setImportando(true)
    try {
      const filas = parsearCSV(await archivo.text())
      if (filas.length === 0 || !('codigo' in filas[0]) || !('numero_emitido' in filas[0])) {
        mostrarToast('El archivo debe ser el CSV de boletas y facturas, con las columnas «codigo» y «numero_emitido».', 'error')
        return
      }
      const { data, error: errorRpc } = await supabase.rpc('importar_numeros_comprobantes', {
        p_filas: filas.map((fila) => ({ codigo: fila.codigo, numero_legal: fila.numero_emitido })),
      })
      if (errorRpc) {
        mostrarToast(errorRpc.message, 'error')
        return
      }
      const lista = (codigos) => codigos.slice(0, 3).join(', ') + (codigos.length > 3 ? '…' : '')
      const partes = [`${data.actualizadas} marcadas como emitidas`]
      if (data.ya_emitidas.length) partes.push(`${data.ya_emitidas.length} ya estaban emitidas`)
      if (data.no_encontradas.length) partes.push(`no existen: ${lista(data.no_encontradas)}`)
      if (data.sin_comprobante.length) partes.push(`sin comprobante: ${lista(data.sin_comprobante)}`)
      if (data.anuladas.length) partes.push(`anuladas: ${lista(data.anuladas)}`)
      if (data.invalidas.length) partes.push(`número inválido: ${lista(data.invalidas)}`)
      mostrarToast(`${partes.join(' · ')}.`, data.actualizadas > 0 ? 'exito' : 'error')
      // Las filas abiertas muestran el estado anterior: se vuelven a pedir.
      abiertos.forEach((ventaId) => cargarDetalleVenta(ventaId))
      cargarVentas(vigenteRef.current, true)
    } finally {
      setImportando(false)
    }
  }

  const filtroEfectivo = esAdmin ? filtro : 'hoy'
  // Debounced: filtroActivo decide si se pagina o se trae el período
  // completo (ver comentario abajo), así que el primer carácter no puede
  // disparar ese refetch pesado de inmediato — solo tras una pausa al
  // escribir (mismo patrón que Inventario/Clientes). El filtrado en pantalla
  // de `ventasFiltradas` sigue usando `busqueda` sin debounce: se siente
  // instantáneo sobre lo que ya está cargado mientras se espera el refetch.
  const busquedaDebounced = useDebounce(busqueda, 300)
  // Con búsqueda de texto o filtro por método activos, paginar rompería el
  // resultado (podría "no encontrar" algo que existe más adelante, sin
  // cargar). En esos casos se trae todo el período (ya acotado por la fecha)
  // en vez de paginar; si no hay ningún filtro activo, sí se pagina de verdad.
  const filtroActivo = Boolean(busquedaDebounced.trim()) || filtroMetodo !== 'todos'

  async function cargarVentas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)
    // Una recarga silenciosa (tras anular) conserva las filas ya cargadas con «Cargar más» para que el scroll no salte.
    const cantidad = silencioso ? Math.min(Math.max(ventas.length, TAMANO_PAGINA), 1000) : TAMANO_PAGINA

    let consultaVentas = supabase
      .from('ventas')
      .select(SELECT_VENTAS)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (!filtroActivo) {
      consultaVentas = consultaVentas.range(0, cantidad - 1)
    }

    const [ventasRes, resumenRes] = await Promise.all([
      consultaVentas,
      supabase.rpc('resumen_historial', {
        p_desde: desde.toISOString(),
        p_hasta: hasta.toISOString(),
      }),
    ])

    if (!vigente.actual) return

    if (ventasRes.error) {
      setError('No se pudo cargar el historial.')
      setVentas([])
      setCargando(false)
      return
    }

    setError(null)
    setVentas(ventasRes.data ?? [])
    setHayMas(!filtroActivo && (ventasRes.data ?? []).length === cantidad)

    const filaResumen = resumenRes.data?.[0]
    setResumen(
      filaResumen
        ? {
            cantidadVentas: filaResumen.cantidad_ventas ?? 0,
            totalRecaudado: filaResumen.total_recaudado ?? 0,
            productosVendidos: filaResumen.productos_vendidos ?? 0,
          }
        : RESUMEN_VACIO,
    )

    setCargando(false)
  }

  async function cargarMasVentas() {
    if (cargandoMas || !hayMas || filtroActivo) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    const { data, error: errorMas } = await supabase
      .from('ventas')
      .select(SELECT_VENTAS)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })
      .range(ventas.length, ventas.length + TAMANO_PAGINA - 1)

    setCargandoMas(false)
    // El filtro/búsqueda pudo cambiar mientras esta página viajaba — una
    // respuesta que llega tarde de un período/filtro que ya no está activo
    // se descarta en vez de appendearse sobre la lista ya reemplazada.
    if (!vigente.actual) return

    if (errorMas) {
      mostrarToast('No se pudieron cargar más ventas.', 'error')
      return
    }

    setVentas((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA)
  }

  // A diferencia de cargarVentas/cargarMasVentas (paginadas), acá siempre se
  // trae el período completo sin .range() — un export parcial sin avisar
  // sería peor que el problema que esto intenta resolver (M7 de la auditoría).
  async function exportarCSV() {
    if (exportando) return
    setExportando(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    const { data, error: errorExport } = await supabase
      .from('ventas')
      .select(SELECT_VENTAS_EXPORT)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (errorExport) {
      setExportando(false)
      mostrarToast('No se pudo exportar el historial.', 'error')
      return
    }

    const ventasExport = data ?? []

    // vendedor_id no viene embebido (mismo motivo que cargarDetalleVenta):
    // se resuelve aparte para no dejar un UUID en crudo en el CSV.
    const idsVendedores = [...new Set(ventasExport.map((v) => v.vendedor_id).filter(Boolean))]
    let nombrePorVendedor = new Map()
    if (idsVendedores.length > 0) {
      const { data: usuariosData } = await supabase
        .from('usuarios')
        .select('id, nombre_completo')
        .in('id', idsVendedores)
      nombrePorVendedor = new Map((usuariosData ?? []).map((u) => [u.id, u.nombre_completo]))
    }

    setExportando(false)

    // Un solo archivo, una fila por producto/servicio vendido (los datos de
    // la venta se repiten en cada fila) — antes eran 2 archivos separados
    // (ventas.csv + venta_items.csv), y el segundo download quedaba
    // bloqueado por el navegador salvo que el usuario aprobara "descargas
    // múltiples" (M6 de la 2ª auditoría).
    const filas = ventasExport.flatMap((venta) =>
      (venta.venta_items ?? []).map((item) => ({
        codigo: venta.codigo,
        fecha: venta.fecha,
        estado: venta.estado,
        metodo_pago: venta.metodo_pago,
        monto_recibido: venta.monto_recibido,
        vendedor: nombrePorVendedor.get(venta.vendedor_id) ?? '',
        cliente: nombreClienteDeVenta(venta),
        total_venta: venta.total,
        tipo_item: item.tipo,
        producto_servicio: item.nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal_item: item.subtotal,
      })),
    )

    const sufijo = `${formatearFechaISO(desde)}_a_${formatearFechaISO(sumarDias(hasta, -1))}`
    descargarArchivo(
      `ventas_${sufijo}.csv`,
      aCSV(filas, [
        'codigo',
        'fecha',
        'estado',
        'metodo_pago',
        'monto_recibido',
        'vendedor',
        'cliente',
        'total_venta',
        'tipo_item',
        'producto_servicio',
        'cantidad',
        'precio_unitario',
        'subtotal_item',
      ]),
    )
    mostrarToast(`Exportadas ${ventasExport.length} ventas (${filas.length} filas).`, 'exito')
  }

  // Lista para la contadora: una fila por venta (activa) del período con boleta o
  // factura. Las ventas que vienen de un pedido web y no se registraron en el POS
  // salen con lo que la clienta eligió en la web y estado «SIN REGISTRAR».
  async function exportarComprobantes() {
    if (exportandoComprobantes) return
    setExportandoComprobantes(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    const { data, error: errorExport } = await supabase
      .from('ventas')
      .select(SELECT_VENTAS_COMPROBANTES)
      .eq('estado', 'ACTIVA')
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: true })

    setExportandoComprobantes(false)

    if (errorExport) {
      mostrarToast('No se pudo exportar los comprobantes.', 'error')
      return
    }

    const filas = []
    for (const venta of data ?? []) {
      const pedido = Array.isArray(venta.pedidos_web) ? venta.pedidos_web[0] : venta.pedidos_web
      const tipo = venta.comprobante_tipo ?? pedido?.tipo_comprobante
      if (!tipo) continue

      const registrado = Boolean(venta.comprobante_tipo)
      const documento = registrado
        ? venta.comprobante_documento
        : tipo === 'FACTURA'
          ? pedido?.ruc
          : null
      const { base, igv } = desglosarIGV(venta.total)
      const items = venta.venta_items ?? []
      const subtotalItems = redondearCentimos(items.reduce((acumulado, item) => acumulado + Number(item.subtotal), 0))
      filas.push({
        fecha: formatearFechaHora(venta.fecha),
        codigo: venta.codigo,
        origen: pedido ? 'WEB' : 'POS',
        tipo: nombreComprobante(tipo).toUpperCase(),
        numero_interno: venta.comprobante_numero ?? '',
        tipo_documento: documento
          ? tipo === 'FACTURA'
            ? 'RUC'
            : registrado
              ? (venta.comprobante_tipo_doc ?? 'DNI')
              : 'DNI'
          : '',
        documento: documento ?? '',
        nombre_razon_social: registrado
          ? (venta.comprobante_nombre ?? nombreClienteDeVenta(venta))
          : (pedido?.razon_social ?? nombreClienteDeVenta(venta)),
        direccion: venta.comprobante_direccion ?? '',
        celular: normalizarCelular(venta.comprobante_celular ?? venta.clientes?.telefono) ?? '',
        detalle: detalleParaContadora(items),
        subtotal_items: subtotalItems.toFixed(2),
        descuento: Math.max(0, redondearCentimos(subtotalItems - Number(venta.total))).toFixed(2),
        cargo_adicional: Math.max(0, redondearCentimos(Number(venta.total) - subtotalItems)).toFixed(2),
        op_gravada: base.toFixed(2),
        igv: igv.toFixed(2),
        total: Number(venta.total).toFixed(2),
        metodo_pago: venta.metodo_pago,
        estado_comprobante: registrado
          ? venta.comprobante_estado === 'EMITIDO'
            ? 'EMITIDO'
            : 'PENDIENTE'
          : 'SIN REGISTRAR',
        numero_emitido: venta.comprobante_legal ?? '',
      })
    }

    if (filas.length === 0) {
      mostrarToast('No hay boletas ni facturas en este período.', 'error')
      return
    }

    const sufijo = `${formatearFechaISO(desde)}_a_${formatearFechaISO(sumarDias(hasta, -1))}`
    descargarArchivo(
      `comprobantes_${sufijo}.csv`,
      aCSV(filas, [
        'fecha',
        'codigo',
        'origen',
        'tipo',
        'numero_interno',
        'tipo_documento',
        'documento',
        'nombre_razon_social',
        'direccion',
        'celular',
        'detalle',
        'subtotal_items',
        'descuento',
        'cargo_adicional',
        'op_gravada',
        'igv',
        'total',
        'metodo_pago',
        'estado_comprobante',
        'numero_emitido',
      ]),
    )
    mostrarToast(`Exportados ${filas.length} comprobantes para la contadora.`)
  }

  // useEffectEvent: el efecto corre solo cuando cambian sus dependencias, pero llama a la versión más reciente
  // de cargarVentas (lee los filtros actuales) sin volver a dispararse cada vez que esa función se recrea.
  const cargarDesdeEfecto = useEffectEvent((vigente, silencioso) => cargarVentas(vigente, silencioso))
  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDesdeEfecto(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, filtroEfectivo, personalizado.desde, personalizado.hasta, filtroActivo])

  const ventasFiltradas = busqueda.trim()
    ? ventas.filter((venta) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          venta.codigo.toLowerCase().includes(texto) ||
          codigoCorto(venta.codigo).toLowerCase().includes(texto) ||
          nombreClienteDeVenta(venta).toLowerCase().includes(texto)
        )
      })
    : ventas
  const ventasOrdenadas = ordenarVentas(filtrarPorMetodo(ventasFiltradas, filtroMetodo), orden)

  const { barraRef, encabezadoRef, claseTh, estiloTh } = useEncabezadoTablaPegado([ventas, cargando])

  return (
    <div className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      {/* Buscador + orden: fijos arriba al hacer scroll, siempre debajo del header */}
      <div ref={barraRef} className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por código o cliente..."
          tema="amber"
          sinBorde
        />
        {/* Orden, filtro y descargas: en PC y tablet van sueltos; en celular se agrupan tras la rueda. */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" sinBorde />
          <SelectorOrden
            opciones={OPCIONES_METODO}
            valor={filtroMetodo}
            onCambiar={setFiltroMetodo}
            tema="amber"
            sinBorde
            icono={Filter}
            seleccionado
            claseIcono={CLASE_ICONO_FILTRO_METODO[filtroMetodo] ?? 'text-amber'}
            ariaLabel="Filtrar por método de pago"
          />

          {esAdmin && (
            <button
              type="button"
              onClick={exportarCSV}
              disabled={exportando}
              aria-label="Exportar CSV del período"
              title="Exportar CSV del período"
              className="flex shrink-0 items-center justify-center rounded-lg border border-transparent p-2.5 text-ink/70 transition-colors hover:text-amber disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          {esAdmin && (
            <button
              type="button"
              onClick={exportarComprobantes}
              disabled={exportandoComprobantes}
              aria-label="Exportar boletas y facturas del período para la contadora"
              title="Exportar boletas y facturas para la contadora"
              className="flex shrink-0 items-center justify-center rounded-lg border border-transparent p-2.5 text-ink/70 transition-colors hover:text-amber disabled:opacity-40"
            >
              <FileText className="h-4 w-4" />
            </button>
          )}
          {esAdmin && (
            <button
              type="button"
              onClick={() => inputImportarRef.current?.click()}
              disabled={importando}
              aria-label="Importar números emitidos por la contadora"
              title="Importar números emitidos (CSV devuelto por la contadora)"
              className="flex shrink-0 items-center justify-center rounded-lg border border-transparent p-2.5 text-ink/70 transition-colors hover:text-amber disabled:opacity-40"
            >
              <Upload className="h-4 w-4" />
            </button>
          )}
        </div>

        {esAdmin && (
          <input
            ref={inputImportarRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={importarNumerosEmitidos}
            aria-label="Elegir el CSV con los números emitidos"
          />
        )}

        <MenuOpcionesHistorial
          opcionesOrden={OPCIONES_ORDEN}
          orden={orden}
          onOrden={setOrden}
          opcionesMetodo={OPCIONES_METODO}
          metodo={filtroMetodo}
          onMetodo={setFiltroMetodo}
          claseIconoMetodo={CLASE_ICONO_FILTRO_METODO[filtroMetodo] ?? 'text-amber'}
          esAdmin={esAdmin}
          onExportarVentas={exportarCSV}
          exportandoVentas={exportando}
          onExportarComprobantes={exportarComprobantes}
          exportandoComprobantes={exportandoComprobantes}
          onImportar={() => inputImportarRef.current?.click()}
          importando={importando}
        />
      </div>

      {/* Resumen del período: viene de una función SQL (resumen_historial),
          no del array cargado — así sigue exacto aunque la lista de abajo
          esté paginada */}
      <div className="grid grid-cols-3 gap-3">
        <TarjetaResumen
          etiqueta="Ventas realizadas"
          valor={resumen.cantidadVentas}
          compacto
          padding="p-1"
        />
        <TarjetaResumen
          etiqueta="Total recaudado"
          valor={resumen.totalRecaudado.toFixed(2)}
          claseValor="text-green"
          compacto
          apilarCompacto
          padding="p-1"
        />
        <TarjetaResumen
          etiqueta="Productos vendidos"
          valor={resumen.productosVendidos}
          claseValor="text-purple-300"
          compacto
          padding="p-1"
        />
      </div>

      {/* Filtros de fecha */}
      <div className="mt-4">
        {esAdmin ? (
          <FiltrosFecha
            filtro={filtro}
            onCambiarFiltro={setFiltro}
            personalizado={personalizado}
            onCambiarPersonalizado={setPersonalizado}
            tema="amber"
          />
        ) : (
          <p className="font-mono text-xs text-ink/60">Mostrando ventas de hoy</p>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={6} />
      ) : ventasOrdenadas.length === 0 ? (
        <EstadoVacio
          icono={History}
          mensaje={busqueda.trim() ? 'No se encontraron ventas.' : 'No hay ventas en este período.'}
        />
      ) : (
        <>
          {/* Lista: solo móvil */}
          <div className="mt-4 -mx-3 border-t border-border lg:hidden">
            {ventasOrdenadas.map((venta, indice) => {
              const anulada = venta.estado === 'ANULADA'
              const esUltimo = indice === ventasOrdenadas.length - 1
              const abierto = abiertos.has(venta.id)
              const infoDetalle = detalles[venta.id] ?? { cargando: false }

              return (
                <div
                  key={venta.id}
                  className={
                    anulada ? 'm-2 rounded-lg border border-red/40 bg-red/5' : !esUltimo ? 'border-b border-border' : ''
                  }
                >
                  <div
                    onClick={() => alternarAbierto(venta.id)}
                    onKeyDown={manejarActivacionTeclado(() => alternarAbierto(venta.id))}
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
                    className="flex cursor-pointer items-center justify-between gap-2 px-3 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 font-mono text-sm font-semibold ${
                          anulada ? 'text-red' : 'text-amber'
                        }`}
                      >
                        {codigoCorto(venta.codigo)}
                      </span>
                      <PildoraComprobante venta={venta} />
                      <span
                        className={`truncate font-mono text-xs transition-colors duration-300 ${
                          anulada ? 'text-red line-through' : abierto ? 'text-green' : 'text-ink/60'
                        }`}
                      >
                        {formatearFechaHora(venta.fecha)}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`font-mono text-sm font-semibold ${
                          anulada ? 'text-red line-through' : 'text-green'
                        }`}
                      >
                        {formatearSoles(venta.total)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          anulada
                            ? 'bg-red/15 text-red line-through'
                            : (CLASE_METODO_PAGO_PILL[venta.metodo_pago] ?? 'bg-surface-2 text-ink/60')
                        }`}
                      >
                        {venta.metodo_pago}
                      </span>
                      <IconoFlechaDesplegable
                        className={`h-3 w-3 shrink-0 text-ink/60 transition-transform duration-300 ${
                          abierto ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </div>

                  <CampoColapsable abierto={abierto}>
                    {/* Solo se monta el detalle de filas que se abrieron
                        alguna vez — no las 50 de la página, evita duplicar
                        nodos DOM (tabla de items + botones) por cada fila
                        que nadie llegó a expandir. */}
                    {(abierto || detalles[venta.id]) && (
                      <DetalleVenta
                        estado={infoDetalle}
                        esAdmin={esAdmin}
                        onImprimir={() => imprimirVenta(venta.id)}
                        onIniciarAnular={() => iniciarAnular(venta.id)}
                        onCancelarAnular={() => cancelarAnular(venta.id)}
                        onConfirmarAnular={() => confirmarAnular(venta.id)}
                        onRegistrarComprobante={(tipo) => abrirModalComprobante(venta.id, tipo)}
                        onEditarComprobante={() => abrirModalComprobante(venta.id, infoDetalle.detalle?.comprobante_tipo)}
                        onCambiarEstadoComprobante={(emitido, numero) =>
                          cambiarEstadoComprobante(venta.id, emitido, numero)
                        }
                        onAdjuntarPdf={(archivo) => adjuntarPdf(venta.id, archivo)}
                        onVerPdf={() => verPdf(venta.id)}
                        onEnviarWhatsApp={(celular) => enviarWhatsApp(venta.id, celular)}
                      />
                    )}
                  </CampoColapsable>
                </div>
              )
            })}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-clip border-y border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead ref={encabezadoRef}>
                <tr className="font-mono text-xs uppercase tracking-wider text-ink/60">
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Código</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Fecha</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Método</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Items</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Total</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ventasOrdenadas.map((venta) => {
                  const anulada = venta.estado === 'ANULADA'
                  const cantidadItems = (venta.venta_items ?? []).length
                  const abierto = abiertos.has(venta.id)
                  const infoDetalle = detalles[venta.id] ?? { cargando: false }

                  return (
                    <Fragment key={venta.id}>
                      <tr
                        onClick={() => alternarAbierto(venta.id)}
                        onKeyDown={manejarActivacionTeclado(() => alternarAbierto(venta.id))}
                        role="button"
                        tabIndex={0}
                        aria-expanded={abierto}
                        className={`cursor-pointer bg-tabla transition-colors hover:bg-surface-2 ${
                          anulada ? 'bg-red/5' : ''
                        }`}
                      >
                        <td
                          className={`px-3 py-2.5 font-mono ${
                            anulada ? 'text-red line-through' : 'text-amber'
                          }`}
                        >
                          <span>{codigoCorto(venta.codigo)}</span>
                          {venta.comprobante_tipo && (
                            <span className="ml-2 align-middle">
                              <PildoraComprobante venta={venta} />
                            </span>
                          )}
                          {/* El tachado/rojo no lo anuncia un lector de pantalla; en móvil hay una píldora «Anulada» visible. */}
                          {anulada && <span className="sr-only">Anulada</span>}
                        </td>
                        <td
                          className={`px-3 py-2.5 font-mono transition-colors duration-300 ${
                            anulada ? 'text-red line-through' : abierto ? 'text-green' : 'text-ink/60'
                          }`}
                        >
                          {formatearFechaHora(venta.fecha)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              anulada
                                ? 'bg-red/15 text-red line-through'
                                : (CLASE_METODO_PAGO_PILL[venta.metodo_pago] ?? 'bg-surface-2 text-ink/60')
                            }`}
                          >
                            {venta.metodo_pago}
                          </span>
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono ${
                            anulada ? 'text-red line-through' : 'text-ink/60'
                          }`}
                        >
                          {cantidadItems}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-semibold ${
                            anulada ? 'text-red line-through' : 'text-green'
                          }`}
                        >
                          {formatearSoles(venta.total)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <IconoFlechaDesplegable
                            className={`ml-auto h-3 w-3 text-ink/60 transition-transform duration-300 ${
                              abierto ? 'rotate-180' : ''
                            }`}
                          />
                        </td>
                      </tr>
                      <tr className="bg-tabla">
                        <td colSpan={6} className="p-0">
                          <CampoColapsable abierto={abierto}>
                            {(abierto || detalles[venta.id]) && (
                              <DetalleVenta
                                estado={infoDetalle}
                                esAdmin={esAdmin}
                                onImprimir={() => imprimirVenta(venta.id)}
                                onIniciarAnular={() => iniciarAnular(venta.id)}
                                onCancelarAnular={() => cancelarAnular(venta.id)}
                                onConfirmarAnular={() => confirmarAnular(venta.id)}
                                onRegistrarComprobante={(tipo) => abrirModalComprobante(venta.id, tipo)}
                                onEditarComprobante={() =>
                                  abrirModalComprobante(venta.id, infoDetalle.detalle?.comprobante_tipo)
                                }
                                onCambiarEstadoComprobante={(emitido, numero) =>
                                  cambiarEstadoComprobante(venta.id, emitido, numero)
                                }
                                onAdjuntarPdf={(archivo) => adjuntarPdf(venta.id, archivo)}
                                onVerPdf={() => verPdf(venta.id)}
                                onEnviarWhatsApp={(celular) => enviarWhatsApp(venta.id, celular)}
                              />
                            )}
                          </CampoColapsable>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasVentas}
              disabled={cargandoMas}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}

      {modalComprobante && (
        <ModalDatosComprobante
          tipo={modalComprobante.tipo}
          inicial={modalComprobante.inicial}
          total={modalComprobante.total}
          celularCliente={modalComprobante.celularCliente}
          dniObligatorio={modalComprobante.tipo === 'BOLETA' && boletaRequiereDni(modalComprobante.total)}
          onGuardar={guardarComprobante}
          onCerrar={() => setModalComprobante(null)}
        />
      )}

      <TicketImprimible
        detalle={ventaParaImprimir?.detalle ?? null}
        items={ventaParaImprimir?.items ?? []}
      />
    </div>
  )
}
