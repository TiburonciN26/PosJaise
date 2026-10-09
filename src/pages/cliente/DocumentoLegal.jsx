import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { FECHA_LEGAL, RUTAS_LEGALES, VERSION_LEGAL } from '../../config/legal.js'
import PieClienteWeb from './PieClienteWeb.jsx'

// Plantilla común de las páginas legales públicas (sin sesión, como el Libro de
// Reclamaciones). Los datos del negocio los da hooks/useDatosNegocioLegal.js.
//
// `secciones`: [{ titulo, bloques: [string | string[]] }]; un string es un párrafo
// y un arreglo de strings es una lista con viñetas.

const OTROS_DOCUMENTOS = [
  { ruta: RUTAS_LEGALES.terminos, texto: 'Términos y condiciones' },
  { ruta: RUTAS_LEGALES.cambios, texto: 'Cambios y devoluciones' },
  { ruta: RUTAS_LEGALES.privacidad, texto: 'Privacidad' },
  { ruta: RUTAS_LEGALES.reclamos, texto: 'Libro de Reclamaciones' },
]

export default function DocumentoLegal({ titulo, introduccion, secciones, rutaActual }) {
  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <article className="mx-auto w-full max-w-3xl space-y-4">
        <header className="liquid-glass flex items-start gap-3 rounded-none p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--lw-gold)]">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-white">{titulo}</h1>
            <p className="mt-0.5 text-xs text-white/50">
              Última actualización: {FECHA_LEGAL} · Versión {VERSION_LEGAL}
            </p>
            {introduccion && <p className="mt-3 text-sm leading-relaxed text-white/70">{introduccion}</p>}
          </div>
        </header>

        {secciones.map((seccion, indice) => (
          <section key={seccion.titulo} className="liquid-glass space-y-2.5 rounded-none p-5">
            <h2 className="text-sm font-semibold text-white">
              {indice + 1}. {seccion.titulo}
            </h2>
            {seccion.bloques.map((bloque, i) =>
              Array.isArray(bloque) ? (
                <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/70">
                  {bloque.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="text-sm leading-relaxed text-white/70">
                  {bloque}
                </p>
              ),
            )}
          </section>
        ))}

        <nav aria-label="Otros documentos" className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs">
          {OTROS_DOCUMENTOS.filter((doc) => doc.ruta !== rutaActual).map((doc) => (
            <Link key={doc.ruta} to={doc.ruta} className="text-white/60 underline-offset-2 hover:text-white hover:underline">
              {doc.texto}
            </Link>
          ))}
        </nav>
      </article>
      <PieClienteWeb />
    </div>
  )
}
