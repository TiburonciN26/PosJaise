import { useState } from 'react'
import { Cake, MapPin, Pencil, Phone } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePerfilCliente } from '../../context/PerfilClienteContext.jsx'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import ModalEditarPerfilCliente from '../../components/ModalEditarPerfilCliente.jsx'

const BUCKET_FOTOS = 'fotos-clientes'
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function iniciales(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  return (
    partes
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

function formatearFechaLarga(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  const nombreMes = MESES[Number(mes) - 1]
  return `${Number(dia)} de ${nombreMes.charAt(0).toUpperCase()}${nombreMes.slice(1)}, ${anio}`
}

function DatoPerfil({ icono: Icono, etiqueta, valor }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink/70">
        <Icono className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink/60">{etiqueta}</p>
        <p className="truncate text-sm font-medium text-ink">{valor || 'Sin registrar'}</p>
      </div>
    </div>
  )
}

// Vista de solo lectura — el tema y "Cerrar sesión" viven en el menú del
// avatar (MenuUsuarioCliente), no acá (pedido puntual). El botón "Editar"
// abre ModalEditarPerfilCliente, la única puerta de escritura.
export default function MiPerfil() {
  const { usuario } = useAuth()
  const { perfil, cargando } = usePerfilCliente()
  const [editando, setEditando] = useState(false)
  const [errorFoto, setErrorFoto] = useState(false)

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-ink/60">Cargando...</p>
      </div>
    )
  }

  const urlFoto = !errorFoto ? urlPublicaFoto(BUCKET_FOTOS, perfil?.foto_url) : null

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber/30 bg-amber/15 text-xl font-semibold text-amber">
            {urlFoto ? (
              <img
                src={urlFoto}
                alt=""
                onError={() => setErrorFoto(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              iniciales(perfil?.nombre)
            )}
          </div>
          <p className="mt-3 text-lg font-semibold text-ink">
            Hola, {perfil?.nombre || 'completa tu perfil'}
          </p>
          <p className="text-sm text-ink/60">{usuario?.email}</p>
        </div>

        <div className="mt-6 space-y-4">
          <DatoPerfil icono={Phone} etiqueta="Teléfono" valor={perfil?.telefono} />
          <DatoPerfil icono={MapPin} etiqueta="Dirección" valor={perfil?.direccion} />
          <DatoPerfil
            icono={Cake}
            etiqueta="Cumpleaños"
            valor={formatearFechaLarga(perfil?.cumpleanos)}
          />
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="flex items-center gap-1.5 rounded-full bg-amber px-4 py-2 text-sm font-semibold text-bg"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </button>
        </div>
      </div>

      {editando && <ModalEditarPerfilCliente onCerrar={() => setEditando(false)} />}
    </div>
  )
}
