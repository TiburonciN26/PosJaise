import { useRef, useState } from 'react'

// Fila del ticket de Ventas: nombre, precio unitario, +/− con tope de stock, subtotal y quitar (✕ en PC, deslizar en táctil).
// Movido sin cambios desde pages/Ventas.jsx (auditoría 2026-11-20, hallazgo 1.1). La duración de salida (duration-300)
// debe coincidir con DURACION_SALIDA de Ventas.jsx.

// Deslizar (izquierda o derecha) una fila del carrito más de esto la
// elimina, igual que tocar el botón ✕ que reemplaza en táctil.
const UMBRAL_ARRASTRE_ELIMINAR = 90
// Movimiento mínimo antes de considerarlo un arrastre y no un tap sobre
// la fila (nombre/precio, no los controles con su propio onClick).
const UMBRAL_ARRASTRE_INICIO = 8

export default function FilaTicket({
  item,
  stockDisponible,
  resaltada,
  saliendo,
  esTactil,
  onCambiarCantidad,
  onQuitar,
}) {
  const subtotal = item.cantidad * item.precioUnitario
  const esProducto = item.tipo === 'PRODUCTO'
  const superaStock = esProducto && item.cantidad > stockDisponible
  const enElLimite = esProducto && item.cantidad >= stockDisponible

  // Deslizar para eliminar (reemplaza el botón ✕ en táctil, ver esTactil
  // más abajo): arrastreX sigue al dedo 1:1 mientras se arrastra, y se
  // usa también para el tinte rojo de fondo (progreso hacia el umbral).
  // touch-pan-y en el contenedor deja el scroll vertical de la lista
  // intacto — solo el gesto horizontal lo captura este handler.
  const [arrastreX, setArrastreX] = useState(0)
  const [arrastrando, setArrastrando] = useState(false)
  const inicioRef = useRef({ x: 0, iniciado: false, ignorar: false })

  function manejarPointerDown(evento) {
    if (!esTactil || saliendo) return
    // Empezar el gesto sobre +/-/precio no debe interpretarse como
    // swipe — esos controles ya tienen su propio onClick.
    const ignorar = Boolean(evento.target.closest('button, input'))
    inicioRef.current = { x: evento.clientX, iniciado: false, ignorar }
    if (!ignorar) evento.currentTarget.setPointerCapture?.(evento.pointerId)
  }

  function manejarPointerMove(evento) {
    if (!esTactil || saliendo || inicioRef.current.ignorar || evento.buttons === 0) return
    const deltaX = evento.clientX - inicioRef.current.x

    if (!inicioRef.current.iniciado) {
      if (Math.abs(deltaX) < UMBRAL_ARRASTRE_INICIO) return
      inicioRef.current.iniciado = true
      setArrastrando(true)
    }

    setArrastreX(Math.max(-140, Math.min(140, deltaX)))
  }

  function soltar(evento) {
    evento.currentTarget.releasePointerCapture?.(evento.pointerId)
    if (!inicioRef.current.iniciado) return
    inicioRef.current.iniciado = false
    setArrastrando(false)

    if (Math.abs(arrastreX) >= UMBRAL_ARRASTRE_ELIMINAR) {
      setArrastreX(0)
      onQuitar(item.id)
    } else {
      setArrastreX(0)
    }
  }

  const progresoEliminar = Math.min(1, Math.abs(arrastreX) / UMBRAL_ARRASTRE_ELIMINAR)

  return (
    <div
      onPointerDown={manejarPointerDown}
      onPointerMove={manejarPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      style={
        saliendo
          ? undefined
          : {
              transform: arrastreX ? `translateX(${arrastreX}px)` : undefined,
              backgroundColor: `color-mix(in srgb, var(--color-red) ${Math.round(progresoEliminar * 85)}%, transparent)`,
              transition: arrastrando ? 'none' : undefined,
            }
      }
      className={`${esTactil ? 'grid-cols-[1fr_5rem_auto]' : 'grid-cols-[minmax(0,1fr)_5rem_5rem_1.5rem]'} touch-pan-y grid items-center gap-5 overflow-hidden px-(--separador-vertical) py-2 sm:px-6 transition-[transform_300ms_ease-in,opacity_150ms_ease-in_150ms,background-color_150ms_ease-out] ${
        saliendo ? 'pointer-events-none -translate-x-full opacity-0 animate-flash-rojo' : 'translate-x-0 opacity-100'
      } ${resaltada ? 'animate-flash-verde' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {item.tipo === 'SERVICIO' && (
            <span className="rounded border border-blue/40 bg-blue/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue">
              Servicio
            </span>
          )}
          <span className="truncate text-sm text-ink">{item.nombre}</span>
        </div>
        {item.tipo === 'SERVICIO' ? (
          (item.clienteNombre || item.atendidoPor) && (
            <div className="mt-0.5 text-[11px] leading-tight text-ink/50">
              {item.clienteNombre && <p className="truncate">Para: {item.clienteNombre}</p>}
              {item.atendidoPor && <p className="truncate">Hecho por: {item.atendidoPor}</p>}
            </div>
          )
        ) : (
          <span className="font-mono text-xs text-ink/60">
            S/ {item.precioUnitario.toFixed(1)} c/u
          </span>
        )}
        {(superaStock || enElLimite) && (
          <p className="font-mono text-[11px] text-red">
            {superaStock ? 'Stock insuficiente' : `Stock máx: ${stockDisponible}`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5">
        {esProducto ? (
          <>
            {item.cantidad > 1 && (
              <button
                type="button"
                onClick={() => onCambiarCantidad(item.id, -1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-border-strong text-ink/70 transition-colors hover:border-amber"
              >
                −
              </button>
            )}
            <span className="w-4 text-center font-mono text-sm text-ink">{item.cantidad}</span>
            <button
              type="button"
              onClick={() => onCambiarCantidad(item.id, 1)}
              disabled={enElLimite}
              className="flex h-6 w-6 items-center justify-center rounded border border-border-strong text-ink/70 transition-colors hover:border-amber disabled:pointer-events-none disabled:opacity-30"
            >
              +
            </button>
          </>
        ) : (
          <span className="w-4 text-center font-mono text-sm text-ink/60">1</span>
        )}
      </div>

      <span className="whitespace-nowrap text-right font-mono text-sm text-ink">
        {subtotal.toFixed(1)}
      </span>

      {!esTactil && (
        <button
          type="button"
          onClick={() => onQuitar(item.id)}
          aria-label="Quitar"
          className="text-ink/30 transition-colors hover:text-red"
        >
          ✕
        </button>
      )}
    </div>
  )
}
