export default function PlaceholderPagina({ titulo }) {
  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold text-ink">{titulo}</h1>
      <p className="mt-2 font-mono text-sm text-ink/60">Próximamente...</p>
    </div>
  )
}
