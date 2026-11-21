import { useState } from 'react'
import { Globe, UserRound } from 'lucide-react'
import { useUrlFotoCliente } from '../../hooks/useUrlFotoCliente.js'
import CampoColapsable from '../CampoColapsable.jsx'
import IconoFlechaDesplegable from '../IconoFlechaDesplegable.jsx'

// Piezas compartidas por la lista de Clientes (tabla de PC y tarjetas del celular) y el perfil de cada clienta.

function iniciales(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

const TAMANOS_AVATAR = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
}

// Solo las clientas registradas por la Web tienen foto (la suben desde Mi Perfil); una manual siempre muestra sus
// iniciales. Estado de error propio por avatar: si una foto no carga, no tumba las demás.
export function AvatarCliente({ cliente, tamano = 'md' }) {
  const [errorFoto, setErrorFoto] = useState(false)
  const urlFirmada = useUrlFotoCliente(cliente.foto_url)
  const urlFoto = !errorFoto ? urlFirmada : null

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-purple-300/30 bg-purple-300/15 font-semibold text-purple-300 ${TAMANOS_AVATAR[tamano]}`}
    >
      {urlFoto ? (
        <img src={urlFoto} alt="" onError={() => setErrorFoto(true)} className="h-full w-full object-cover" />
      ) : (
        iniciales(cliente.nombre)
      )}
    </div>
  )
}

export function CapsulaTipoCliente({ web }) {
  return web ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber/40 bg-amber/15 px-2 py-0.5 text-[11px] font-medium text-amber">
      <Globe className="h-3 w-3" />
      Web
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink/70">
      <UserRound className="h-3 w-3" />
      Manual
    </span>
  )
}

export function Capsula({ estado, className = '' }) {
  if (!estado) return null
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${estado.clase} ${className}`}
    >
      {estado.label}
    </span>
  )
}

// Sección desplegable del perfil. El contenido se monta la PRIMERA vez que se abre (ahí recién pide sus datos) y
// después se queda montado: cerrar y volver a abrir no vuelve a consultar ni pierde lo cargado con «Ver más».
// `abierta` + `onAlternar` (opcionales): la controla el padre, p. ej. el aviso de deuda del perfil abre «Deudas y pagos».
// `seccionRef`: para que el padre la lleve a la vista al abrirla desde otro lado.
export function SeccionPerfil({ icono: Icono, titulo, contador, children, abierta: abiertaControlada, onAlternar, seccionRef }) {
  const [abiertaPropia, setAbiertaPropia] = useState(false)
  const controlada = abiertaControlada !== undefined
  const abierta = controlada ? abiertaControlada : abiertaPropia
  const [visitada, setVisitada] = useState(abierta)
  // Abierta desde fuera por primera vez: se monta el contenido (ajuste de estado durante el render, patrón de React
  // para derivar de una prop sin un efecto extra).
  if (abierta && !visitada) setVisitada(true)

  function alternar() {
    if (controlada) onAlternar?.()
    else setAbiertaPropia((a) => !a)
    setVisitada(true)
  }

  return (
    <section ref={seccionRef} className="scroll-mt-3 rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left"
      >
        <Icono className={`h-4 w-4 shrink-0 ${abierta ? 'text-purple-300' : 'text-ink/60'}`} />
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${abierta ? 'text-purple-300' : 'text-ink'}`}>
          {titulo}
        </span>
        {contador != null && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink/70">{contador}</span>
        )}
        <IconoFlechaDesplegable
          className={`h-3 w-3 shrink-0 text-ink/60 transition-transform duration-300 ${abierta ? 'rotate-180' : ''}`}
        />
      </button>
      <CampoColapsable abierto={abierta}>
        <div className="border-t border-border p-3">{visitada ? children : null}</div>
      </CampoColapsable>
    </section>
  )
}

// Estados comunes de una lista de sección: cargando, error, vacía y «Ver más».
export function EstadoLista({ lista, vacio, children }) {
  if (lista.cargando) return <p className="py-2 font-mono text-xs text-ink/60">Cargando...</p>
  if (lista.error && lista.filas.length === 0) return <p className="py-2 text-sm text-red">No se pudo cargar.</p>
  if (lista.filas.length === 0) return <p className="py-2 text-sm text-ink/60">{vacio}</p>
  return (
    <>
      {children}
      {lista.error && <p className="mt-2 text-sm text-red">No se pudieron cargar más.</p>}
      {lista.hayMas && (
        <button
          type="button"
          onClick={lista.cargarMas}
          disabled={lista.cargandoMas}
          className="mt-3 w-full rounded-lg border border-border-strong py-2 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
        >
          {lista.cargandoMas ? 'Cargando...' : 'Ver más'}
        </button>
      )}
    </>
  )
}

// Tabla simple de las secciones (resúmenes por servicio / producto, movimientos de puntos). En el celular se desplaza
// de costado dentro de su caja en vez de romper el ancho de la página.
export function TablaSeccion({ columnas, children }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-ink/60">
            {columnas.map((columna) => (
              <th
                key={columna.titulo}
                className={`px-2 py-1.5 font-normal ${columna.derecha ? 'text-right' : ''}`}
              >
                {columna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  )
}
