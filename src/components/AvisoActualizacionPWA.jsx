import { useRegisterSW } from 'virtual:pwa-register/react'
import { usePendientes } from '../lib/trabajoPendiente.js'

// A2 de la 4ª auditoría: registra el service worker y, cuando hay una
// versión nueva esperando, muestra un aviso persistente (no un toast que
// se autooculta) con un botón explícito — el usuario decide cuándo
// recargar, en vez de que la versión cambie sola debajo suyo mientras
// tiene el POS abierto a mitad de una venta.
//
// Fase 2B (B4): «Actualizar» recarga la página y el trabajo en memoria
// (venta en curso en la caja, ventanas/formularios abiertos) se perdería.
// Mientras haya trabajo pendiente registrado (lib/trabajoPendiente.js) el
// botón queda deshabilitado y el aviso lo explica; al terminar o cancelar
// ese trabajo se habilita solo. Sin trabajo pendiente, funciona igual que antes.
export default function AvisoActualizacionPWA() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const pendientes = [...new Set(usePendientes())]

  if (!needRefresh) return null

  const bloqueado = pendientes.length > 0

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        role="status"
        className="pointer-events-auto flex max-w-md flex-col gap-2 rounded-lg border border-amber/40 bg-surface px-4 py-2.5 text-sm text-ink shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span>Hay una versión nueva de la app.</span>
          <button
            type="button"
            disabled={bloqueado}
            aria-disabled={bloqueado}
            onClick={() => updateServiceWorker(true)}
            className="shrink-0 rounded-lg bg-amber px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Actualizar
          </button>
        </div>
        {bloqueado && (
          <p data-testid="aviso-actualizacion-bloqueada" className="text-xs text-ink/70">
            Tienes {pendientes.join(' y ')}. Termina o cancela eso primero: actualizar recargaría la página y
            lo perderías.
          </p>
        )}
      </div>
    </div>
  )
}
