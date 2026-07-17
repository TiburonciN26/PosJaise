// A2 de la auditoría frontend: reemplaza el "Cargando..." de texto plano
// (idéntico en las 11 pantallas con lista) por placeholders con la forma
// real del contenido — reduce el salto de layout entre el estado de carga
// y los datos, y baja la sensación de espera aunque el tiempo real no
// cambie. `animate-pulse` respeta prefers-reduced-motion automáticamente
// (Tailwind lo define con la animación deshabilitada bajo esa media query).
function Bloque({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-surface-3 ${className}`} />
}

// Tarjetas (móvil): misma estructura que las tarjetas reales de
// Inventario/Servicios/Clientes/Asistentes/etc. — nombre + subtítulo a la
// izquierda, un valor destacado a la derecha, una fila de datos abajo.
export function EsqueletoTarjetas({ cantidad = 5 }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 lg:hidden" aria-hidden="true">
      {Array.from({ length: cantidad }).map((_, indice) => (
        <div key={indice} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Bloque className="h-4 w-2/3" />
              <Bloque className="h-3 w-1/3" />
            </div>
            <Bloque className="h-5 w-14 shrink-0" />
          </div>
          <div className="mt-3 flex gap-4">
            <Bloque className="h-3 w-14" />
            <Bloque className="h-3 w-14" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Tabla (escritorio): filas con anchos escalonados para que no se vea
// como una grilla perfecta (eso lee más "placeholder de verdad" que una
// fila de rectángulos idénticos).
export function EsqueletoFilas({ columnas = 4, filas = 7 }) {
  return (
    <div className="mt-4 hidden overflow-hidden rounded-lg border border-border lg:block" aria-hidden="true">
      <table className="w-full">
        <tbody className="divide-y divide-border">
          {Array.from({ length: filas }).map((_, f) => (
            <tr key={f}>
              {Array.from({ length: columnas }).map((__, c) => (
                <td key={c} className="px-3 py-3">
                  <Bloque className={`h-4 ${c === 0 ? 'w-3/4' : 'w-1/2'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Caso común a las 8 pantallas con patrón tarjetas↔tabla: un solo
// componente que ya trae las dos formas y deja que el CSS (lg:hidden /
// hidden lg:block) decida cuál se ve, igual que el contenido real.
export default function EsqueletoLista({ cantidad = 5, columnas = 4 }) {
  return (
    <>
      <EsqueletoTarjetas cantidad={cantidad} />
      <EsqueletoFilas columnas={columnas} filas={cantidad} />
    </>
  )
}

// Lista de grupos/acordeones (MiPanel, Auditoría, Gastos: días o
// secciones colapsables, cada uno una card con encabezado + total).
export function EsqueletoGrupos({ cantidad = 5 }) {
  return (
    <div className="mt-4 space-y-3" aria-hidden="true">
      {Array.from({ length: cantidad }).map((_, indice) => (
        <div key={indice} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <Bloque className="h-4 w-1/3" />
            <Bloque className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Grilla de tarjetas de resumen (Dashboard/Estadísticas): etiqueta chica +
// valor grande, como TarjetaResumen.
export function EsqueletoResumen({ cantidad = 6 }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
      {Array.from({ length: cantidad }).map((_, indice) => (
        <div key={indice} className="rounded-lg border border-border bg-surface p-2.5">
          <Bloque className="h-3 w-2/3" />
          <Bloque className="mt-2 h-6 w-1/2" />
        </div>
      ))}
    </div>
  )
}
