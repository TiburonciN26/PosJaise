import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowBigDown,
  ArrowRight,
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Info,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  PhoneCall,
  Plus,
  Receipt,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Ticket,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useEstadoNegocio } from '../../context/EstadoNegocioContext.jsx'
import { useCerrarConEscape } from '../../hooks/useCerrarConEscape.js'
import { formatearSoles } from '../../lib/moneda.js'
import { procesarImagen, subirFoto, urlPublicaFoto } from '../../lib/imagenes.js'
import { aLima, anioMesEnLima, claveDiaLima, diaSemanaLima, iniciarDia, iniciarMesLima, sumarDias } from '../../lib/fechas.js'
import TarjetaCupon from '../../components/TarjetaCupon.jsx'
import { estadoEfectivoCupon } from '../../lib/cupones.js'
import CampoSubirArchivo from '../../components/CampoSubirArchivo.jsx'
import Contador from '../../components/Contador.jsx'

const BUCKET_FOTOS_PRODUCTOS = 'fotos-productos'
const BUCKET_COMPROBANTES_PEDIDOS = 'comprobantes-pedidos-web'
const BUCKET_QR_PAGOS = 'qr-pagos'

// Carrito del portal cliente — rediseño completo (docs/diseno-carrito/
// README.md). Fase 4: `confirmar()` ya llama al RPC real
// `confirmar_pedido_productos()` (13 parámetros, tras las migraciones
// 99/100/101 de Fase 3: día/hora, pago+comprobante+cupón,
// comprobante fiscal). Decisiones ya tomadas con el usuario antes de
// construir esto:
// - El carrito queda SOLO para productos — el bloque "Servicios para
//   reservar" que traía el diseño se saca por completo. Reservar
//   servicios pasa a un mini-carrito propio dentro de Citas — tarea
//   aparte, futura.
// - Sin "Efectivo" como método de pago: el pago es 100% obligatorio y
//   con comprobante (Yape/Plin/Transferencia) para cualquier pedido web,
//   nunca "paga al recibir" sin garantía.
// `precio_antes` (Migración 5, 104_precio_antes_productos.sql) ya lee
// de la columna real de productos — antes venía hardcodeado en `null`
// acá mismo. Ya existe además una pantalla propia de "mis pedidos"
// (/mi-perfil/pedidos, PedidosCliente.jsx) — `confirmar()` sigue
// redirigiendo a Inicio después de confirmar, no a esa pantalla, a
// propósito: la clienta recién envió el pedido, todavía no hay nada
// nuevo que ver ahí (sigue Pendiente hasta que el admin verifique el
// pago).

// Horario de ejemplo — mismos 2 bloques reales que ya usa el negocio
// (horario_atencion(), 74_horario_atencion.sql): 10:00-13:00 y
// 15:00-20:30. Fase 3 reemplaza esto por la fila real de esa función +
// probablemente `horarios_disponibles_cita()` o su equivalente para
// pedidos, para no ofrecer una hora que el negocio no puede cumplir.
const HORARIO_EJEMPLO = {
  bloques: [
    { inicio: '10:00', fin: '13:00' },
    { inicio: '15:00', fin: '20:30' },
  ],
  intervaloMin: 60,
}

function generarHorasDelDia({ bloques, intervaloMin }) {
  const horas = []
  for (const bloque of bloques) {
    let [h, m] = bloque.inicio.split(':').map(Number)
    const [hFin, mFin] = bloque.fin.split(':').map(Number)
    while (h * 60 + m < hFin * 60 + mFin) {
      horas.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      m += intervaloMin
      if (m >= 60) {
        h += Math.floor(m / 60)
        m %= 60
      }
    }
  }
  return horas
}

const HORAS_EJEMPLO = generarHorasDelDia(HORARIO_EJEMPLO)

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Misma grilla de 42 celdas (6 semanas) que ya usa el calendario mensual
// de CitasCliente.jsx — mismo criterio de zona horaria (America/Lima vía
// src/lib/fechas.js), para que "hoy" no dependa del reloj del celular.
function construirDiasGrilla(mesActual) {
  const { anio, mes } = anioMesEnLima(mesActual)
  const inicioMes = iniciarMesLima(anio, mes)
  const diaSemanaInicio = diaSemanaLima(inicioMes)
  const offset = diaSemanaInicio === 0 ? 6 : diaSemanaInicio - 1
  const primerDiaGrilla = sumarDias(inicioMes, -offset)
  return Array.from({ length: 42 }, (_, i) => sumarDias(primerDiaGrilla, i))
}

const formatoClaveDia = new Intl.DateTimeFormat('es-PE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

// `claveDiaLima` ya devuelve año/mes/día como los vería alguien en Lima
// (ver src/lib/fechas.js) — reconstruir un Date en UTC directo con esos
// mismos 3 números y formatear con timeZone:'UTC' evita desplazar la
// fecha una segunda vez (que pasaría si se formateara con
// timeZone:'America/Lima' sobre un Date ya corregido).
function formatearClaveDia(clave) {
  if (!clave) return ''
  const [anio, mes, dia] = clave.split('-').map(Number)
  return formatoClaveDia.format(new Date(Date.UTC(anio, mes, dia)))
}

// La clave de SelectorDia es "YYYY-M-D" (mes sin 0-pad, sin cero a la
// izquierda en el día — ver claveDiaLima en src/lib/fechas.js, pensada
// solo para comparar por igualdad, nunca para viajar tal cual a un
// campo `date` de Postgres). El RPC espera una fecha ISO real
// "YYYY-MM-DD" — este helper hace esa única conversión, local a esta
// pantalla.
function claveDiaAISO(clave) {
  const [anio, mes, dia] = clave.split('-').map(Number)
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// Mini-calendario mensual para elegir día de entrega/recojo — a
// diferencia del calendario de Citas (que deja navegar libremente
// cualquier día, incluso pasado, porque ahí solo se están REVISANDO
// citas ya agendadas), acá los días pasados quedan deshabilitados: no
// tiene sentido pedir un delivery para ayer. `diaSeleccionado`/
// `onElegir` trabajan con la misma `claveDiaLima` que ya usa el resto
// del proyecto para agrupar por día — Fase 3 decide el formato real que
// viaja al RPC (probablemente una fecha ISO derivada de esta misma
// clave, no la clave en sí).
function SelectorDia({ diaSeleccionado, onElegir }) {
  const [mesActual, setMesActual] = useState(() => iniciarDia(new Date()))
  const diasGrilla = construirDiasGrilla(mesActual)
  const { anio: anioActual, mes: mesIndiceActual } = anioMesEnLima(mesActual)
  const hoyClave = claveDiaLima(new Date())
  const inicioHoy = iniciarDia(new Date()).getTime()

  function cambiarMes(delta) {
    const { anio, mes } = anioMesEnLima(mesActual)
    setMesActual(iniciarMesLima(anio, mes + delta))
  }

  return (
    <div className="lw-panel p-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <button type="button" onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="p-1.5 text-white/70 transition-colors hover:text-[var(--lw-gold)]">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-white">
          {NOMBRES_MES[mesIndiceActual]} {anioActual}
        </span>
        <button type="button" onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="p-1.5 text-white/70 transition-colors hover:text-[var(--lw-gold)]">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-white/50">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {diasGrilla.map((dia) => {
          const clave = claveDiaLima(dia)
          const { mes } = anioMesEnLima(dia)
          const esDelMes = mes === mesIndiceActual
          const esHoy = clave === hoyClave
          const esSeleccionado = clave === diaSeleccionado
          const esPasado = dia.getTime() < inicioHoy
          return (
            <button
              key={clave}
              type="button"
              onClick={() => onElegir(clave)}
              disabled={esPasado}
              className={`flex aspect-square items-center justify-center rounded-lg text-xs transition-colors ${
                esSeleccionado
                  ? 'bg-[var(--lw-gold)] font-semibold text-black'
                  : esPasado
                    ? 'cursor-not-allowed text-white/15'
                    : esHoy
                      ? 'border border-[var(--lw-gold)] text-[var(--lw-gold)]'
                      : esDelMes
                        ? 'text-white hover:bg-white/5'
                        : 'text-white/30 hover:bg-white/5'
              }`}
            >
              {aLima(dia).getUTCDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Íconos reales en public/icons/ — Plin no tiene uno todavía (solo existe
// yape.svg/transferencia.svg/efectivo.svg/targueta.svg), así que se queda
// con un ícono genérico (Wallet, de lucide) hasta que exista el real.
const METODOS_PAGO = [
  { id: 'YAPE', nombre: 'Yape', conQR: true, icono: 'icons/yape.svg' },
  { id: 'PLIN', nombre: 'Plin', conQR: true, icono: null },
  { id: 'TRANSFERENCIA', nombre: 'Transferencia', conQR: false, icono: 'icons/transferencia.svg' },
]

// QA-054: el descuento de un cupón NUNCA se calcula aquí. Lo valida el servidor (vista_previa_cupon_pedido) con la misma
// lógica que usan el pedido y la venta (alcance, compra mínima, nivel, vigencia, tope, costo conocido y protección
// global). Mientras se valida, o si se rechaza o falla la consulta, no se muestra ningún descuento ni se puede confirmar.
const VALIDACION_NINGUNA = { estado: 'ninguno', descuento: 0, motivo: '', firma: '' }

// QA-057: identidad de una validación = productos marcados + CANTIDADES + precios. Una respuesta del servidor solo vale para la
// firma con la que se pidió; cualquier cambio (cantidad, selección, precio recargado) la deja sin efecto.
const firmaDe = (productos) => productos.map((p) => `${p.id}:${p.cantidad}:${p.precio}`).sort().join(',')
const centavos = (n) => Math.round(Number(n) * 100)

// Carrito tal como está GUARDADO en el servidor (cantidades y precios vigentes).
async function leerCarritoGuardado() {
  const { data, error } = await supabase
    .from('carrito_productos')
    .select('producto_id, cantidad, productos(nombre, precio, precio_antes, stock_actual, categoria, foto_url)')
  if (error) throw error
  return (data ?? [])
    .filter((fila) => fila.productos)
    .map((fila) => ({
      id: fila.producto_id,
      nombre: fila.productos.nombre,
      detalle: fila.productos.categoria ?? '',
      precio: fila.productos.precio,
      precioAntes: fila.productos.precio_antes,
      stock: fila.productos.stock_actual,
      fotoUrl: urlPublicaFoto(BUCKET_FOTOS_PRODUCTOS, fila.productos.foto_url),
      cantidad: fila.cantidad,
      marcado: true, // Por defecto todo marcado — el cliente desmarca lo que no quiere pedir todavía.
    }))
}
const TIEMPO_MAX_VALIDACION_MS = 15000

function TarjetaDireccion({ direccion, seleccionada, mostrarRadio, onElegir }) {
  // El borde azulado (".on") solo tiene sentido cuando hay varias
  // direcciones para elegir (mostrarRadio) — mostrando solo la
  // predeterminada (cerrado) no hay nada que resaltar contra, así que se
  // ve como una tarjeta de info plana, con el mismo borde gris del panel.
  return (
    <label className={`lw-tarjeta-direccion ${mostrarRadio && seleccionada ? 'on' : ''}`}>
      {mostrarRadio && (
        <input
          type="radio"
          name="carrito-direccion"
          className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--lw-gold)]"
          checked={seleccionada}
          onChange={onElegir}
          aria-label={`Entregar en ${direccion.etiqueta}`}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{direccion.etiqueta}</span>
          {direccion.predeterminada && (
            <span className="lw-chip-pred">
              <Star className="h-2.5 w-2.5" fill="currentColor" />
              Predeterminada
            </span>
          )}
        </span>
        <span className="flex items-start gap-1.5 text-sm text-white/70">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
          {direccion.direccion}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-white/55">
          <Phone className="h-3.5 w-3.5 shrink-0 text-white/40" />
          <span className="font-mono">{direccion.celular}</span>
        </span>
        {direccion.referencia && <span className="text-xs text-white/55">{direccion.referencia}</span>}
      </span>
    </label>
  )
}

function SeccionDireccion({ direcciones, direccionId, abierta, onAbrir, onCerrar, onElegir }) {
  const visibles = abierta ? direcciones : direcciones.filter((d) => d.id === direccionId)
  return (
    <section aria-labelledby="carrito-dir-titulo" className="lw-panel flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="carrito-dir-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
          <MapPin className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
          Dirección de entrega
        </h2>
        {!abierta ? (
          <button type="button" onClick={onAbrir} className="text-[13px] font-medium text-[var(--lw-gold)] hover:text-[#d3e4f8]">
            Cambiar
          </button>
        ) : (
          <span className="flex items-center gap-4">
            <Link
              to="/mi-perfil/direcciones"
              className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--lw-gold)] hover:text-[#d3e4f8]"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </Link>
            <button type="button" onClick={onCerrar} className="text-[13px] font-medium text-white/60 hover:text-white">
              Cancelar
            </button>
          </span>
        )}
      </div>
      {abierta && <p className="text-[13px] text-white/60">Elige dónde quieres recibir este pedido.</p>}
      {direcciones.length === 0 ? (
        <Link
          to="/mi-perfil/direcciones"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-3 text-sm text-white/60 transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Agrega una dirección para poder pedir delivery
        </Link>
      ) : (
        visibles.map((direccion) => (
          <TarjetaDireccion
            key={direccion.id}
            direccion={direccion}
            seleccionada={direccion.id === direccionId}
            mostrarRadio={abierta}
            onElegir={() => onElegir(direccion.id)}
          />
        ))
      )}
    </section>
  )
}

function SeccionComprobante({ comprobante, onCambiar, ruc, onRuc, razonSocial, onRazonSocial }) {
  return (
    <section aria-labelledby="carrito-comp-titulo" className="lw-panel flex flex-col gap-4 p-6">
      <h2 id="carrito-comp-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
        <Receipt className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
        Comprobante
      </h2>
      <div role="group" aria-label="Tipo de comprobante" className="flex gap-2.5">
        <button
          type="button"
          onClick={() => onCambiar('BOLETA')}
          aria-pressed={comprobante === 'BOLETA'}
          className={`lw-comprobante-opcion ${comprobante === 'BOLETA' ? 'on' : ''}`}
        >
          Boleta
        </button>
        <button
          type="button"
          onClick={() => onCambiar('FACTURA')}
          aria-pressed={comprobante === 'FACTURA'}
          className={`lw-comprobante-opcion ${comprobante === 'FACTURA' ? 'on' : ''}`}
        >
          Factura
        </button>
      </div>
      {comprobante === 'BOLETA' ? (
        <p className="text-[13px] text-white/60">La boleta se emite a tu nombre y te llega por WhatsApp.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="carrito-ruc" className="mb-1.5 block text-xs text-white/60">
                RUC<span className="text-red-500" aria-hidden="true"> *</span>
              </label>
              <input
                id="carrito-ruc"
                inputMode="numeric"
                maxLength={11}
                placeholder="20XXXXXXXXX"
                value={ruc}
                onChange={(evento) => onRuc(evento.target.value.replace(/\D/g, ''))}
                className="lw-campo font-mono"
              />
            </div>
            <div>
              <label htmlFor="carrito-razon" className="mb-1.5 block text-xs text-white/60">
                Razón social<span className="text-red-500" aria-hidden="true"> *</span>
              </label>
              <input
                id="carrito-razon"
                placeholder="Nombre de la empresa"
                value={razonSocial}
                onChange={(evento) => onRazonSocial(evento.target.value)}
                className="lw-campo"
              />
            </div>
          </div>
          <p className="text-[13px] text-white/60">La factura te llega por WhatsApp.</p>
        </>
      )}
    </section>
  )
}

function FilaProducto({ producto, onAlternar, onCantidad, onQuitar }) {
  const agotado = producto.stock <= 0
  const conDescuento = Boolean(producto.precioAntes) && producto.precioAntes > producto.precio

  return (
    <div className="relative flex gap-3 border-t border-[#1f1f22] py-4 sm:gap-4 sm:py-5">
      {agotado && <span className="lw-capsula-agotado">Producto no disponible</span>}

      <div className={`flex items-center ${agotado ? 'opacity-30' : ''}`}>
        <input
          type="checkbox"
          className="h-[18px] w-[18px] shrink-0 accent-[var(--lw-gold)]"
          checked={!agotado && producto.marcado}
          disabled={agotado}
          onChange={onAlternar}
          aria-label={`Incluir ${producto.nombre} en el pedido`}
        />
      </div>

      <div
        className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-[#1f1f22] bg-[#141416] text-[#4a4a4f] sm:h-[84px] sm:w-[84px] ${agotado ? 'opacity-30' : ''}`}
      >
        {conDescuento && (
          <span className="lw-etq-desc">−{Math.round((1 - producto.precio / producto.precioAntes) * 100)}%</span>
        )}
        <span className="lw-etq-stock">Stock: {producto.stock}</span>
        {producto.fotoUrl ? (
          <img src={producto.fotoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ShoppingBag className="h-6 w-6" />
        )}
      </div>

      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${agotado ? 'opacity-30' : ''}`}>
        <span className="text-sm font-semibold text-white sm:text-[15px]">{producto.nombre}</span>
        <span className="text-xs text-white/60 sm:text-[13px]">{producto.detalle}</span>
        <div className="mt-2">
          <div className="lw-stepper" role="group" aria-label={`Cantidad de ${producto.nombre}`}>
            <button
              type="button"
              onClick={() => onCantidad(producto.cantidad - 1)}
              disabled={agotado || producto.cantidad <= 1}
              aria-label="Quitar uno"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[28px] text-center text-sm font-semibold text-white">
              <Contador valor={producto.cantidad} decimales={0} tamano={14} />
            </span>
            <button
              type="button"
              onClick={() => onCantidad(producto.cantidad + 1)}
              disabled={agotado || producto.cantidad >= producto.stock}
              aria-label="Agregar uno"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className={`flex shrink-0 flex-col items-end justify-between ${agotado ? 'opacity-30' : ''}`}>
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          {conDescuento && (
            <s className="lw-precio-antes text-xs sm:text-[13px]">{formatearSoles(producto.precioAntes * producto.cantidad)}</s>
          )}
          <span className="text-sm font-bold text-white sm:text-base">
            S/ <Contador valor={producto.precio * producto.cantidad} decimales={2} tamano={14} />
          </span>
        </span>
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${producto.nombre} del carrito`}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function SeccionProductos({ productos, onAlternar, onCantidad, onQuitar }) {
  const ordenados = [...productos].sort((a, b) => Number(a.stock <= 0) - Number(b.stock <= 0))

  return (
    <section aria-labelledby="carrito-prod-titulo" className="lw-panel flex flex-col p-6">
      <div className="flex items-center justify-between gap-3 pb-1">
        <h2 id="carrito-prod-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
          <ShoppingBag className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
          Productos
        </h2>
        <span className="hidden text-xs text-white/50 sm:inline">Marca los que quieres pedir ahora</span>
      </div>
      {ordenados.length === 0 ? (
        <p className="border-t border-[#1f1f22] py-4 text-sm text-white/50">
          Todavía no agregaste productos.{' '}
          <Link to="/productos" className="text-[var(--lw-gold)]">
            Ver productos
          </Link>
        </p>
      ) : (
        ordenados.map((producto) => (
          <FilaProducto
            key={producto.id}
            producto={producto}
            onAlternar={() => onAlternar(producto.id)}
            onCantidad={(cantidad) => onCantidad(producto.id, cantidad)}
            onQuitar={() => onQuitar(producto.id)}
          />
        ))
      )}
    </section>
  )
}

function PanelCupones({ errorLectura, disponibles, usados, cuponAplicadoCodigo, codigoManual, onCodigoManual, errorCodigo, onAplicarCodigo, onElegir, onCerrar }) {
  const panelRef = useRef(null)
  useCerrarConEscape(onCerrar)

  return (
    <div className="fixed inset-0 z-40 flex items-end lg:items-stretch lg:justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onCerrar} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="carrito-cupones-titulo"
        className="lw-panel-cupones relative flex max-h-[85vh] w-full flex-col gap-6 overflow-y-auto rounded-t-2xl border-t border-[#232326] bg-[#0f0f11] p-6 lg:max-h-none lg:h-full lg:w-full lg:max-w-[500px] lg:rounded-none lg:border-l lg:border-t-0 lg:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 id="carrito-cupones-titulo" className="lw-titulo-heavitas text-[26px] lg:text-[28px]">
              Tus cupones
            </h2>
            <p className="text-sm leading-relaxed text-white/60">
              Elige uno para este pedido. Se descuenta de tus productos, no del delivery.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar cupones"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="carrito-codigo" className="text-xs uppercase tracking-wider text-white/60">
            ¿Tienes un código?
          </label>
          <div className="flex gap-2">
            <input
              id="carrito-codigo"
              maxLength={6}
              placeholder="Ej. A3F9C1"
              value={codigoManual}
              onChange={(evento) => onCodigoManual(evento.target.value.toUpperCase())}
              className="lw-campo flex-1 font-mono uppercase tracking-widest"
            />
            <button
              type="button"
              onClick={onAplicarCodigo}
              className="h-11 shrink-0 rounded-full border border-[var(--lw-gold)] px-6 text-sm font-semibold text-[var(--lw-gold)] transition-colors hover:bg-white/5"
            >
              Aplicar
            </button>
          </div>
          {errorCodigo && (
            <p role="alert" className="text-[13px] text-red-400">
              {errorCodigo}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-wider text-white/60">Disponibles ({disponibles.length})</span>
          {errorLectura ? (
            <p role="alert" className="text-sm text-white/70">
              No pudimos cargar tus cupones. Esto no significa que no tengas: solo no pudimos leerlos ahora.
            </p>
          ) : disponibles.length === 0 ? (
            <p className="text-sm text-white/50">No tienes cupones disponibles todavía.</p>
          ) : (
            disponibles.map((cupon) => (
              <div key={cupon.codigo} className="flex flex-col gap-1.5">
                <TarjetaCupon cupon={cupon} />
                <div className="flex items-center justify-end gap-3 px-0.5 text-xs text-white/60">
                  <span>Se valida al usarlo</span>
                  <button
                    type="button"
                    onClick={() => onElegir(cupon.codigo)}
                    disabled={cupon.codigo === cuponAplicadoCodigo}
                    className="text-[13px] font-semibold text-[var(--lw-gold)] hover:text-[#d3e4f8] disabled:cursor-default disabled:text-white/50"
                  >
                    {cupon.codigo === cuponAplicadoCodigo ? 'Aplicado' : 'Usar'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {usados.length > 0 && (
          <div className="flex flex-col gap-3">
            <span className="text-xs uppercase tracking-wider text-white/50">Ya usados</span>
            {usados.map((cupon) => (
              <TarjetaCupon key={cupon.codigo} cupon={cupon} />
            ))}
          </div>
        )}

        <div className="mt-auto flex flex-col gap-2.5 border-t border-[#232326] pt-4 text-sm">
          <span className="text-white/60">¿Quieres más cupones?</span>
          <Link to="/mi-perfil/referidos" className="flex items-center justify-between text-white hover:text-[var(--lw-gold)]">
            Invita a una amiga con tu código <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/recompensas?seccion=sellos" className="flex items-center justify-between text-white hover:text-[var(--lw-gold)]">
            Canjea tu fidelización <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function CarritoCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { recargar: recargarCarrito } = useCarritoCliente()
  const { cuentaTransferencia, pagos } = useEstadoNegocio()
  const navigate = useNavigate()

  const [cargando, setCargando] = useState(true)
  const [productos, setProductos] = useState([])
  const [direcciones, setDirecciones] = useState([])
  const [zonas, setZonas] = useState([])
  const [cupones, setCupones] = useState([])
  const [errorCupones, setErrorCupones] = useState(false)

  const [entrega, setEntrega] = useState('DELIVERY')
  const [zonaId, setZonaId] = useState('')
  const [direccionId, setDireccionId] = useState('')
  const [direccionesAbiertas, setDireccionesAbiertas] = useState(false)
  const [comprobante, setComprobante] = useState('BOLETA')
  const [ruc, setRuc] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [dia, setDia] = useState('')
  const [diaAbierto, setDiaAbierto] = useState(false)
  const [hora, setHora] = useState('')
  const [horaAbierta, setHoraAbierta] = useState(false)
  const [metodoPago, setMetodoPago] = useState('YAPE')
  const [captura, setCaptura] = useState('')
  const [capturaPreview, setCapturaPreview] = useState('')
  const [capturaArchivo, setCapturaArchivo] = useState(null)
  const [cuponAplicado, setCuponAplicado] = useState(null)
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const [codigoManual, setCodigoManual] = useState('')
  const [errorCodigo, setErrorCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Validación del cupón por el servidor: 'ninguno' | 'validando' | 'ok' | 'rechazado' | 'error'.
  const [validacion, setValidacion] = useState(VALIDACION_NINGUNA)
  // Sube cuando el carrito del servidor cambió (cantidades, quitar) o cuando hay que volver a validar.
  const [versionCarrito, setVersionCarrito] = useState(0)
  // QA-057: guardados del carrito aún en curso (mientras haya alguno no se valida ni se puede confirmar) y su error visible.
  const [pendientes, setPendientes] = useState(0)
  const [errorGuardado, setErrorGuardado] = useState('')
  const colaGuardado = useRef(Promise.resolve())

  useEffect(() => {
    async function cargar() {
      const [productosCargados, direccionesRes, zonasRes, cuponesRes] = await Promise.all([
        leerCarritoGuardado().catch(() => []),
        supabase
          .from('direcciones_cliente')
          .select('id, etiqueta, direccion, celular, referencia, predeterminada')
          .order('predeterminada', { ascending: false })
          .order('creado_en', { ascending: true }),
        supabase.from('zonas_delivery').select('id, nombre, costo').order('costo'),
        supabase.rpc('mis_cupones'),
      ])

      const direccionesCargadas = direccionesRes.data ?? []
      const zonasCargadas = zonasRes.data ?? []

      setProductos(productosCargados)
      setDirecciones(direccionesCargadas)
      setDireccionId(direccionesCargadas[0]?.id ?? '')
      setZonas(zonasCargadas)
      setZonaId(zonasCargadas[0]?.id ?? '')
      // Una lectura fallida NO es «sin cupones» ni un cupón válido: se avisa y la lista queda vacía.
      setErrorCupones(Boolean(cuponesRes.error))
      setCupones(cuponesRes.error ? [] : (cuponesRes.data ?? []))
      setCargando(false)
    }

    cargar()
  }, [])

  // Vuelve a mostrar el carrito GUARDADO (cantidades y precios del servidor), conservando qué productos estaban marcados.
  const recargarDesdeServidor = useCallback(async () => {
    try {
      const guardados = await leerCarritoGuardado()
      setProductos((anterior) =>
        guardados.map((g) => ({ ...g, marcado: anterior.find((p) => p.id === g.id)?.marcado ?? true })),
      )
    } catch {
      setErrorGuardado('No pudimos leer tu carrito guardado. Recarga la página antes de confirmar.')
    }
  }, [])

  // Al cambiar algo que afecta al cupón, el descuento anterior deja de valer hasta que el servidor lo confirme.
  function invalidarValidacion() {
    setValidacion((v) => (v.estado === 'ninguno' ? v : { ...VALIDACION_NINGUNA, estado: 'validando' }))
  }

  function alternarProducto(id) {
    invalidarValidacion()
    setProductos((anterior) => anterior.map((p) => (p.id === id ? { ...p, marcado: !p.marcado } : p)))
  }

  async function cambiarCantidad(id, cantidad) {
    const producto = productos.find((p) => p.id === id)
    const cantidadFinal = Math.min(producto.stock, Math.max(1, cantidad))
    invalidarValidacion()
    setErrorGuardado('')
    setProductos((anterior) => anterior.map((p) => (p.id === id ? { ...p, cantidad: cantidadFinal } : p)))
    setPendientes((n) => n + 1)
    // QA-057: los guardados van en cola (el último gana en el servidor igual que en pantalla) y cada resultado se COMPRUEBA:
    // si el PATCH falla o no devuelve la cantidad pedida, no se valida como si se hubiese guardado.
    const guardar = async () => {
      const { data, error } = await supabase
        .from('carrito_productos')
        .update({ cantidad: cantidadFinal })
        .eq('cliente_web_id', usuario.id)
        .eq('producto_id', id)
        .select('cantidad')
      if (error || !Array.isArray(data) || data.length !== 1 || data[0].cantidad !== cantidadFinal) {
        throw new Error('cantidad no guardada')
      }
    }
    const paso = colaGuardado.current.then(guardar)
    colaGuardado.current = paso.catch(() => {})
    try {
      await paso
    } catch {
      setErrorGuardado('No pudimos guardar el cambio de cantidad. Te mostramos lo que quedó guardado; inténtalo de nuevo.')
      await recargarDesdeServidor()
    } finally {
      setPendientes((n) => n - 1)
      recargarCarrito()
    }
  }

  async function quitarProducto(id) {
    const producto = productos.find((p) => p.id === id)
    invalidarValidacion()
    setErrorGuardado('')
    setProductos((anterior) => anterior.filter((p) => p.id !== id))
    setPendientes((n) => n + 1)
    const quitar = async () => {
      const { error } = await supabase.from('carrito_productos').delete().eq('cliente_web_id', usuario.id).eq('producto_id', id)
      if (error) throw error
    }
    const paso = colaGuardado.current.then(quitar)
    colaGuardado.current = paso.catch(() => {})
    try {
      await paso
      if (producto) mostrarToast(`${producto.nombre} quitado del carrito`, 'info')
    } catch {
      setErrorGuardado('No pudimos quitar el producto. Te mostramos lo que quedó guardado; inténtalo de nuevo.')
      await recargarDesdeServidor()
    } finally {
      setPendientes((n) => n - 1)
      recargarCarrito()
    }
  }

  function alSubirCaptura(archivo) {
    if (capturaPreview) URL.revokeObjectURL(capturaPreview)
    setCaptura(archivo.name)
    setCapturaPreview(URL.createObjectURL(archivo))
    setCapturaArchivo(archivo)
  }

  function quitarCaptura() {
    if (capturaPreview) URL.revokeObjectURL(capturaPreview)
    setCaptura('')
    setCapturaPreview('')
    setCapturaArchivo(null)
  }

  function aplicarCodigoManual() {
    const codigo = codigoManual.trim().toUpperCase()
    if (!codigo) return
    const encontrado = cupones.find((c) => c.codigo === codigo)
    if (!encontrado) {
      setErrorCodigo('Ese código no existe o ya venció.')
      return
    }
    // QA-078: disponibilidad efectiva (incluye el vencimiento); el servidor igualmente vuelve a validar.
    const efectivo = estadoEfectivoCupon(encontrado)
    if (!efectivo.utilizable) {
      setErrorCodigo(
        efectivo.estado === 'VENCIDO'
          ? 'Ese cupón ya venció.'
          : efectivo.estado === 'DESCONOCIDO'
            ? 'No pudimos comprobar la vigencia de ese cupón. Inténtalo de nuevo.'
            : 'Ese cupón ya fue usado.',
      )
      return
    }
    setCuponAplicado(codigo)
    setErrorCodigo('')
    setCodigoManual('')
    setDrawerAbierto(false)
  }

  function elegirCupon(codigo) {
    const elegido = cupones.find((c) => c.codigo === codigo)
    if (!elegido || !estadoEfectivoCupon(elegido).utilizable) return
    setCuponAplicado(codigo)
    setDrawerAbierto(false)
  }

  async function confirmar() {
    if (ctaDeshabilitado || enviando) return
    setEnviando(true)
    try {
      const { blob, extension } = await procesarImagen(capturaArchivo, { ladoMaximo: 1400, calidad: 0.9 })
      const rutaComprobante = `${usuario.id}/${crypto.randomUUID()}.${extension}`
      await subirFoto(BUCKET_COMPROBANTES_PEDIDOS, rutaComprobante, blob)

      const direccionSeleccionada = direcciones.find((d) => d.id === direccionId)

      const { error } = await supabase.rpc('confirmar_pedido_productos', {
        p_producto_ids: productosMarcados.map((p) => p.id),
        p_tipo_entrega: entrega,
        p_fecha_entrega: claveDiaAISO(dia),
        p_hora_entrega: hora,
        p_metodo_pago: metodoPago,
        p_comprobante_url: rutaComprobante,
        p_zona_delivery_id: entrega === 'DELIVERY' ? zonaId : null,
        p_direccion: entrega === 'DELIVERY' ? direccionSeleccionada?.direccion : null,
        p_celular_entrega: entrega === 'DELIVERY' ? direccionSeleccionada?.celular : null,
        p_codigo_cupon: cupon?.codigo ?? null,
        p_tipo_comprobante: comprobante,
        p_ruc: comprobante === 'FACTURA' ? ruc : null,
        p_razon_social: comprobante === 'FACTURA' ? razonSocial : null,
        // QA-057: lo que la clienta ve y confirma. El servidor recalcula precios, descuento y protección y RECHAZA si no
        // coinciden (sin pedido); nunca se envían precios del navegador para cobrar.
        p_cantidades: productosMarcados.map((p) => ({ producto_id: p.id, cantidad: p.cantidad })),
        p_total_esperado: centavos(total) / 100,
      })

      if (error) throw error

      mostrarToast('¡Pedido enviado! Te confirmamos por WhatsApp en cuanto revisemos tu pago.', 'exito')
      recargarCarrito()
      navigate('/inicio')
    } catch (error) {
      mostrarToast(error.message || 'No se pudo confirmar el pedido.', 'error')
      // Se vuelve a mostrar lo GUARDADO (precios y cantidades vigentes) y, si hay cupón, se revalida.
      await recargarDesdeServidor()
      setVersionCarrito((v) => v + 1)
    } finally {
      setEnviando(false)
    }
  }

  const productosMarcados = productos.filter((p) => p.marcado && p.stock > 0)
  const subtotal = productosMarcados.reduce((suma, p) => suma + p.precio * p.cantidad, 0)
  const subtotalSinDescuento = productosMarcados.reduce((suma, p) => suma + (p.precioAntes ?? p.precio) * p.cantidad, 0)
  const descuentoProductos = subtotalSinDescuento - subtotal
  const zona = zonas.find((z) => z.id === zonaId)
  const costoDelivery = entrega === 'DELIVERY' ? (zona?.costo ?? 0) : 0
  const cupon = cuponAplicado ? cupones.find((c) => c.codigo === cuponAplicado) : null
  // Solo un descuento CONFIRMADO por el servidor entra en el total.
  const firmaCarrito = firmaDe(productosMarcados)
  const hayPendientes = pendientes > 0
  // La validación vale solo para la firma con la que se pidió y sin guardados en curso.
  // QA-078: un cupón vencido (o de vigencia desconocida) nunca llega a ser «validado»: no se anuncia descuento ni total pagable.
  const cuponUtilizable = !cupon || estadoEfectivoCupon(cupon).utilizable
  const cuponValidado = Boolean(cupon) && cuponUtilizable && validacion.estado === 'ok' && validacion.firma === firmaCarrito && !hayPendientes
  const descuentoCupon = cuponValidado ? validacion.descuento : 0
  const total = Math.max(0, subtotal + costoDelivery - descuentoCupon)
  // Con un cupón aplicado, el total solo es el que se paga cuando el servidor lo confirmó; con guardados en curso, nunca.
  const totalConfirmado = !hayPendientes && cuponUtilizable && (!cupon || cuponValidado)
  const totalSinDescuentos = subtotalSinDescuento + costoDelivery
  const hayAhorroTotal = totalSinDescuentos > total
  const cuponesDisponibles = cupones.filter((c) => estadoEfectivoCupon(c).utilizable)
  const cuponesUsados = cupones.filter((c) => !estadoEfectivoCupon(c).utilizable)

  const facturaCompleta = comprobante !== 'FACTURA' || (ruc.length === 11 && razonSocial.trim().length > 0)
  const direccionLista = entrega !== 'DELIVERY' || Boolean(direccionId)
  const faltaPago = !capturaArchivo
  const ctaDeshabilitado =
    productosMarcados.length === 0 || !dia || !hora || !facturaCompleta || !direccionLista || faltaPago || !totalConfirmado || hayPendientes

  const metodoActual = METODOS_PAGO.find((m) => m.id === metodoPago)
  // Número/titular/QR reales del negocio (ContactoWeb.jsx los edita,
  // EstadoNegocioContext los mantiene al día con Realtime) — antes esto
  // era un número y un "[NOMBRE DEL DUEÑO]" de relleno, hardcodeados acá
  // mismo. Si el admin todavía no configuró un método, se avisa en vez
  // de mostrar un dato vacío o inventado.
  const datosMetodoActual =
    metodoPago === 'YAPE'
      ? { numero: pagos.yapeNumero, titular: pagos.yapeTitular, qrUrl: pagos.yapeQrUrl }
      : metodoPago === 'PLIN'
        ? { numero: pagos.plinNumero, titular: pagos.plinTitular, qrUrl: pagos.plinQrUrl }
        : { numero: cuentaTransferencia, titular: '', qrUrl: null }
  const instruccionPago = !datosMetodoActual.numero
    ? `El negocio todavía no configuró ${metodoActual.nombre} — escríbenos por WhatsApp antes de pagar.`
    : metodoPago === 'TRANSFERENCIA'
      ? `Transfiere el total exacto${totalConfirmado ? ` (${formatearSoles(total)})` : hayPendientes ? ' (se mostrará cuando se guarde tu carrito)' : ' (se mostrará cuando se confirme tu cupón)'} a: ${datosMetodoActual.numero}.`
      : `${metodoActual.nombre === 'Yape' ? 'Yapea' : 'Plinea'} el total exacto${totalConfirmado ? ` (${formatearSoles(total)})` : hayPendientes ? ' (se mostrará cuando se guarde tu carrito)' : ' (se mostrará cuando se confirme tu cupón)'} al ${datosMetodoActual.numero}${datosMetodoActual.titular ? ` — ${datosMetodoActual.titular}` : ''}.`

  useEffect(() => {
    if (!cuponAplicado) {
      setValidacion(VALIDACION_NINGUNA)
      return undefined
    }
    if (!firmaCarrito) {
      setValidacion({ ...VALIDACION_NINGUNA, estado: 'rechazado', motivo: 'Selecciona al menos un producto para usar el cupón.' })
      return undefined
    }
    // QA-057: con guardados en curso no se valida (el servidor aún no tiene lo que se ve); se revalida al terminar.
    if (hayPendientes) {
      setValidacion({ ...VALIDACION_NINGUNA, estado: 'validando' })
      return undefined
    }
    let vigente = true
    const firma = firmaCarrito
    const lineas = firma.split(',').map((t) => {
      const [id, cantidad, precio] = t.split(':')
      return { producto_id: id, cantidad: Number(cantidad), precio: Number(precio) }
    })
    const subtotalEsperado = lineas.reduce((suma, l) => suma + centavos(l.precio * l.cantidad), 0)
    setValidacion({ ...VALIDACION_NINGUNA, estado: 'validando' })
    const fallo = { ...VALIDACION_NINGUNA, estado: 'error', motivo: 'No pudimos validar el cupón. Revisa tu conexión e inténtalo de nuevo.' }
    const limite = setTimeout(() => {
      if (vigente) {
        vigente = false
        setValidacion(fallo)
      }
    }, TIEMPO_MAX_VALIDACION_MS)
    supabase
      .rpc('vista_previa_cupon_pedido', {
        p_codigo: cuponAplicado,
        p_producto_ids: lineas.map((l) => l.producto_id),
        p_cantidades: lineas.map(({ producto_id, cantidad }) => ({ producto_id, cantidad })),
      })
      .then(({ data, error }) => {
        if (!vigente) return // respuesta de otra firma (vieja o tardía): nunca reactiva el importe ni el CTA
        clearTimeout(limite)
        const fila = Array.isArray(data) ? data[0] : null
        if (error || !fila) setValidacion(fallo)
        else if (fila.cantidades_coinciden === false || centavos(fila.subtotal) !== subtotalEsperado) {
          // Lo guardado no es lo que se ve (cantidad o precio): se muestra lo guardado y se vuelve a validar.
          setValidacion({ ...fallo, motivo: 'Tu carrito cambió. Te mostramos lo que está guardado; vuelve a intentarlo.' })
          recargarDesdeServidor()
        } else if (fila.valido) setValidacion({ estado: 'ok', descuento: Number(fila.descuento), motivo: '', firma })
        else setValidacion({ estado: 'rechazado', descuento: 0, motivo: fila.motivo || 'Este cupón no se puede aplicar a esta compra.', firma })
      })
      .catch(() => {
        if (!vigente) return
        clearTimeout(limite)
        setValidacion(fallo)
      })
    return () => {
      vigente = false
      clearTimeout(limite)
    }
  }, [cuponAplicado, firmaCarrito, versionCarrito, hayPendientes, recargarDesdeServidor])

  if (cargando) {
    return (
      <div className="landing-web flex flex-1 items-center justify-center bg-[#0b0b0c]">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="landing-web animate-entrada-pestana flex-1 overflow-y-auto bg-[#0b0b0c] p-4 md:p-8 lg:p-10">
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-6 flex items-end justify-between gap-3 lg:mb-8">
          <h1 className="lw-titulo-heavitas text-[28px]">Tu carrito</h1>
          <span className="shrink-0 text-sm text-white/60">{productos.length} artículos</span>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_500px] lg:items-start">
          {/* Columna izquierda */}
          <div className="flex flex-col gap-8">
            {entrega === 'DELIVERY' && (
              <SeccionDireccion
                direcciones={direcciones}
                direccionId={direccionId}
                abierta={direccionesAbiertas}
                onAbrir={() => setDireccionesAbiertas(true)}
                onCerrar={() => setDireccionesAbiertas(false)}
                onElegir={(id) => {
                  setDireccionId(id)
                  setDireccionesAbiertas(false)
                }}
              />
            )}
            <SeccionComprobante
              comprobante={comprobante}
              onCambiar={setComprobante}
              ruc={ruc}
              onRuc={setRuc}
              razonSocial={razonSocial}
              onRazonSocial={setRazonSocial}
            />
            <SeccionProductos
              productos={productos}
              onAlternar={alternarProducto}
              onCantidad={cambiarCantidad}
              onQuitar={quitarProducto}
            />
            <Link to="/productos" className="-mt-4 inline-flex w-fit items-center gap-2 text-sm text-white/60 hover:text-white">
              <ArrowRight className="h-4 w-4 rotate-180" />
              Seguir comprando
            </Link>
          </div>

          {/* Columna derecha */}
          <div className="flex flex-col gap-6">
            <aside className="lw-panel flex flex-col gap-6 p-6 lg:p-7">
              <h2 className="text-lg font-semibold text-white">Resumen del pedido</h2>

              <div className="flex flex-col gap-2.5">
                <span className="text-xs uppercase tracking-wider text-white/60">Entrega</span>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setEntrega('RECOJO_TIENDA')}
                    aria-pressed={entrega === 'RECOJO_TIENDA'}
                    className={`lw-seg ${entrega === 'RECOJO_TIENDA' ? 'on' : ''}`}
                  >
                    <Store className="h-4 w-4" />
                    Recojo en tienda
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntrega('DELIVERY')}
                    aria-pressed={entrega === 'DELIVERY'}
                    className={`lw-seg ${entrega === 'DELIVERY' ? 'on' : ''}`}
                  >
                    <Bike className="h-4 w-4" />
                    Delivery
                  </button>
                </div>
                <div>
                  <span className="mb-1.5 block text-xs text-white/60">
                    {entrega === 'DELIVERY' ? 'Día de entrega' : 'Día de recojo'}
                    <span className="text-red-500" aria-hidden="true"> *</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDiaAbierto((anterior) => !anterior)}
                    aria-expanded={diaAbierto}
                    className="lw-campo flex items-center justify-between text-left"
                  >
                    <span className={dia ? 'text-white' : 'text-white/40'}>
                      {dia ? formatearClaveDia(dia) : 'Elige el día'}
                    </span>
                    <ArrowBigDown className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${diaAbierto ? 'rotate-180' : ''}`} />
                  </button>
                  {diaAbierto && (
                    <div className="mt-2">
                      <SelectorDia
                        diaSeleccionado={dia}
                        onElegir={(clave) => {
                          setDia(clave)
                          setDiaAbierto(false)
                        }}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <span className="mb-1.5 block text-xs text-white/60">
                    {entrega === 'DELIVERY' ? 'Hora de entrega' : 'Hora de recojo'}
                    <span className="text-red-500" aria-hidden="true"> *</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setHoraAbierta((anterior) => !anterior)}
                    aria-expanded={horaAbierta}
                    className="lw-campo flex items-center justify-between text-left"
                  >
                    <span className={hora ? 'text-white font-mono' : 'text-white/40'}>{hora || 'Elige la hora'}</span>
                    <ArrowBigDown className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${horaAbierta ? 'rotate-180' : ''}`} />
                  </button>
                  {horaAbierta && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {HORAS_EJEMPLO.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => {
                            setHora(h)
                            setHoraAbierta(false)
                          }}
                          aria-pressed={hora === h}
                          className={`rounded-lg border px-2 py-1.5 font-mono text-xs transition-colors ${
                            hora === h
                              ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)] font-semibold text-black'
                              : 'border-[#2e2e2e] text-white hover:border-[#4a4a4f]'
                          }`}
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {entrega === 'DELIVERY' ? (
                  <div>
                    <label htmlFor="carrito-zona" className="mb-1.5 block text-xs text-white/60">
                      Zona
                    </label>
                    <select id="carrito-zona" value={zonaId} onChange={(evento) => setZonaId(evento.target.value)} className="lw-campo">
                      {zonas.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.nombre} — {formatearSoles(z.costo)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-[13px] text-white/60">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    Recoges en el salón cuando te confirmemos que está listo.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2.5">
                {!cupon ? (
                  <button type="button" onClick={() => setDrawerAbierto(true)} className="lw-cuponrow">
                    <Ticket className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
                    <span className="flex-1">Agregar cupón</span>
                    <span className="lw-chip">{cuponesDisponibles.length} disponibles</span>
                    <span className="lw-plus">
                      <Plus className="h-4 w-4" />
                    </span>
                  </button>
                ) : (
                  <>
                    <span className="text-xs uppercase tracking-wider text-white/60">Cupón aplicado</span>
                    <TarjetaCupon cupon={cupon} />
                    {!cuponUtilizable && (
                      <div role="alert" className="flex flex-col gap-2 border border-[#d9534f]/60 px-3 py-2.5 text-[13px] text-white/90">
                        <span>
                          {estadoEfectivoCupon(cupon).estado === 'VENCIDO'
                            ? 'Este cupón ya venció y no se puede usar.'
                            : 'No pudimos comprobar que este cupón siga vigente.'}
                        </span>
                        <span className="text-white/60">Quita el cupón o elige otro para continuar. No se consumió.</span>
                      </div>
                    )}
                    {cuponUtilizable && validacion.estado === 'validando' && (
                      <p role="status" className="text-[13px] text-white/70">
                        Validando tu cupón…
                      </p>
                    )}
                    {cuponUtilizable && (validacion.estado === 'rechazado' || validacion.estado === 'error') && (
                      <div role="alert" className="flex flex-col gap-2 border border-[#d9534f]/60 px-3 py-2.5 text-[13px] text-white/90">
                        <span>{validacion.motivo}</span>
                        {validacion.estado === 'error' && (
                          <button type="button" onClick={() => setVersionCarrito((v) => v + 1)} className="w-fit font-semibold text-[var(--lw-gold)]">
                            Reintentar
                          </button>
                        )}
                        <span className="text-white/60">Quita el cupón o elige otro para continuar. No se consumió.</span>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-4 pt-0.5 text-[13px]">
                      <button type="button" onClick={() => setDrawerAbierto(true)} className="font-semibold text-[var(--lw-gold)] hover:text-[#d3e4f8]">
                        Cambiar
                      </button>
                      <button type="button" onClick={() => setCuponAplicado(null)} className="text-white/60 hover:text-white">
                        Quitar
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-[#232326] pt-4 text-sm">
                <div className="flex justify-between text-white/80">
                  <span>Subtotal ({productosMarcados.length} productos)</span>
                  <span>
                    S/ <Contador valor={subtotal} decimales={2} tamano={14} />
                  </span>
                </div>
                <div className="flex justify-between text-white/80">
                  <span>{entrega === 'DELIVERY' ? 'Delivery' : 'Recojo en tienda'}</span>
                  {entrega === 'DELIVERY' ? (
                    <span>
                      S/ <Contador valor={costoDelivery} decimales={2} tamano={14} />
                    </span>
                  ) : (
                    <span>Gratis</span>
                  )}
                </div>
                {descuentoProductos > 0 && (
                  <div className="flex justify-between text-[var(--lw-gold)]">
                    <span>Descuento en productos</span>
                    <span>
                      − S/ <Contador valor={descuentoProductos} decimales={2} tamano={14} />
                    </span>
                  </div>
                )}
                {cuponValidado && (
                  <div className="flex justify-between text-[var(--lw-gold)]">
                    <span>Cupón {cupon.codigo}</span>
                    <span>
                      − S/ <Contador valor={descuentoCupon} decimales={2} tamano={14} />
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-baseline justify-between border-t border-[#232326] pt-4">
                <span className="text-base font-semibold text-white">Total</span>
                <span className="flex items-baseline gap-2.5">
                  {hayAhorroTotal && totalConfirmado && <s className="lw-precio-antes text-base">{formatearSoles(totalSinDescuentos)}</s>}
                  {totalConfirmado ? (
                    <span className="text-[26px] font-bold text-white">
                      S/ <Contador valor={total} decimales={2} tamano={26} />
                    </span>
                  ) : (
                    <span className="text-[16px] font-semibold text-white/60">
                      {validacion.estado === 'validando' ? 'Validando cupón…' : 'Total pendiente del cupón'}
                    </span>
                  )}
                </span>
              </div>

              {errorGuardado && (
                <div role="alert" className="flex flex-col gap-1 border border-[#d9534f]/60 px-3 py-2.5 text-[13px] text-white/90">
                  <span>{errorGuardado}</span>
                </div>
              )}
              {hayPendientes && (
                <p role="status" className="text-[13px] text-white/70">
                  Guardando los cambios de tu carrito…
                </p>
              )}
              <button
                type="button"
                onClick={confirmar}
                disabled={ctaDeshabilitado || enviando}
                className="flex h-14 items-center justify-center gap-2.5 rounded-[10px] bg-[#3ECF6A] text-[18px] font-semibold text-black transition-[filter] hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:brightness-100"
              >
                <Check className="h-[18px] w-[18px]" />
                {enviando ? 'Enviando...' : `Confirmar pedido (${productosMarcados.length})`}
              </button>

              <section aria-labelledby="carrito-pago-titulo" className="flex flex-col gap-4 border-t border-[#232326] pt-4">
                <h2 id="carrito-pago-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
                  <CreditCard className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
                  Método de pago
                </h2>
                <div role="group" aria-label="Elige cómo pagar" className="grid grid-cols-3 gap-2.5">
                  {METODOS_PAGO.map((metodo) => (
                    <button
                      key={metodo.id}
                      type="button"
                      onClick={() => setMetodoPago(metodo.id)}
                      aria-pressed={metodoPago === metodo.id}
                      className={`lw-pago-opcion ${metodoPago === metodo.id ? 'on' : ''}`}
                    >
                      {metodo.icono ? (
                        <img src={`${import.meta.env.BASE_URL}${metodo.icono}`} alt="" className="h-5 w-5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Wallet className="h-5 w-5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="text-sm font-bold">{metodo.nombre}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-col items-center gap-4 rounded-[10px] border border-[#232326] bg-[#0d0d0f] p-5 sm:flex-row">
                  {metodoActual.conQR && (
                    datosMetodoActual.qrUrl ? (
                      <img
                        src={urlPublicaFoto(BUCKET_QR_PAGOS, datosMetodoActual.qrUrl)}
                        alt={`Código QR de ${metodoActual.nombre}`}
                        className="h-28 w-28 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        role="img"
                        aria-label={`Código QR de ${metodoActual.nombre} — todavía no disponible`}
                        className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg bg-[#f1f3f5] p-2 text-center text-[11px] font-medium text-[#0b0b0c]/60"
                      >
                        QR no disponible todavía
                      </div>
                    )
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch">
                    <p className="text-[15px] font-semibold leading-snug text-white">{instruccionPago}</p>
                    <p className="text-[13px] text-white/60">Sube la captura de tu pago para confirmar el pedido.</p>
                    <CampoSubirArchivo
                      nombreArchivo={captura}
                      previewUrl={capturaPreview}
                      etiqueta="Subir captura"
                      etiquetaAdjunto="Captura adjunta"
                      onSeleccionar={alSubirCaptura}
                      onQuitar={quitarCaptura}
                    />
                  </div>
                </div>
                <p className="flex items-center gap-2 text-xs text-white/60">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Por ahora no aceptamos tarjetas de crédito ni débito.
                </p>
              </section>

              <p className="-mt-2 text-center text-xs leading-relaxed text-white/50">
                Revisamos tu comprobante y te confirmamos el pedido.
              </p>
            </aside>

            <div className="flex flex-col gap-4">
              <a href="#" className="lw-wa-ayuda rounded-[10px]">
                <MessageCircle className="h-[18px] w-[18px]" />
                ¿Dudas con tu pedido? Escríbenos
              </a>
              <ul className="flex flex-col gap-2.5 pl-1 text-[13px] text-white/60">
                <li className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-white/50" />
                  Productos 100% originales
                </li>
                <li className="flex items-center gap-2.5">
                  <RotateCcw className="h-4 w-4 shrink-0 text-white/50" />
                  Cambios dentro de 7 días (productos sellados)
                </li>
                <li className="flex items-center gap-2.5">
                  <PhoneCall className="h-4 w-4 shrink-0 text-white/50" />
                  Si no estás en casa, te llamamos antes de volver
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {drawerAbierto && (
        <PanelCupones
          errorLectura={errorCupones}
          disponibles={cuponesDisponibles}
          usados={cuponesUsados}
          cuponAplicadoCodigo={cuponAplicado}
          codigoManual={codigoManual}
          onCodigoManual={setCodigoManual}
          errorCodigo={errorCodigo}
          onAplicarCodigo={aplicarCodigoManual}
          onElegir={elegirCupon}
          onCerrar={() => {
            setDrawerAbierto(false)
            setErrorCodigo('')
          }}
        />
      )}
    </div>
  )
}
