import IconoMartillo from '../components/IconoMartillo.jsx'

export default function Web() {
  return (
    <div
      className="animate-entrada-pestana flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <IconoMartillo animando className="h-10 w-10 text-red" />
      <p className="text-base font-semibold text-red">Web... Próximamente</p>
      <p className="max-w-xs text-sm text-ink/60">Esta sección todavía se está construyendo.</p>
    </div>
  )
}
