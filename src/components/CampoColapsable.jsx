// `margen` es para Ventas: además de expandir, anima un margin-top (mt-3/mt-0)
// que las demás pantallas no necesitan. Se separan los dos className completos
// (en vez de armar el string con un ternario) para que Tailwind los detecte
// como clases literales al escanear el código.
export default function CampoColapsable({ abierto, children, margen = false }) {
  if (margen) {
    return (
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-300 ease-in-out ${
          abierto ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
        abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}
