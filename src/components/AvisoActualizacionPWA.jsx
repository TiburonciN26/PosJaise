import { useRegisterSW } from 'virtual:pwa-register/react'

// A2 de la 4ª auditoría: registra el service worker y, cuando hay una
// versión nueva esperando, muestra un aviso persistente (no un toast que
// se autooculta) con un botón explícito — el usuario decide cuándo
// recargar, en vez de que la versión cambie sola debajo suyo mientras
// tiene el POS abierto a mitad de una venta.
export default function AvisoActualizacionPWA() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-amber/40 bg-surface px-4 py-2.5 text-sm text-ink shadow-lg">
        <span>Hay una versión nueva de la app.</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="shrink-0 rounded-lg bg-amber px-3 py-1.5 text-xs font-semibold text-bg"
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
