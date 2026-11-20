import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, Truck, Package } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { useProveedores } from '../hooks/useProveedores.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import ContactoProveedor from '../components/ContactoProveedor.jsx'
import DatosProveedor from '../components/DatosProveedor.jsx'
import ModalProveedor from '../components/ModalProveedor.jsx'
import ModalEliminarProveedor from '../components/ModalEliminarProveedor.jsx'
import IconoFlechaDesplegable from '../components/IconoFlechaDesplegable.jsx'

// Proveedores (migración 20261112000014; cuelga de Inventario en el menú, solo administradora). Registro dedicado: aquí se
// crean, editan y eliminan proveedores libremente, sin vincularlos a ningún producto. Se vinculan desde el modal del
// producto («Agregar proveedor») o solos al registrar un ingreso de stock con ese proveedor.

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'recientes', label: 'Últimos agregados' },
]

const CAMPOS_BUSQUEDA = ['nombre', 'rubro', 'contacto_nombre', 'ruc', 'celular', 'ciudad', 'razon_social']

function ordenar(lista, orden) {
  const copia = [...lista]
  if (orden === 'recientes') return copia.sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))
  copia.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  return orden === 'nombre-desc' ? copia.reverse() : copia
}

// Productos vinculados a un proveedor: se pide solo al desplegar la tarjeta.
function ProductosDelProveedor({ proveedorId }) {
  const [estado, setEstado] = useState({ cargando: true, error: false, filas: [] })

  useEffect(() => {
    let vigente = true
    supabase
      .from('producto_proveedores')
      .select('principal, productos(id, nombre)')
      .eq('proveedor_id', proveedorId)
      .then(({ data, error }) => {
        if (!vigente) return
        const filas = (data ?? [])
          .filter((fila) => fila.productos)
          .sort((a, b) => a.productos.nombre.localeCompare(b.productos.nombre, 'es'))
        setEstado({ cargando: false, error: Boolean(error), filas })
      })
    return () => {
      vigente = false
    }
  }, [proveedorId])

  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink/50">Productos que provee</p>
      {estado.cargando ? (
        <p className="mt-1 font-mono text-xs text-ink/50">Cargando...</p>
      ) : estado.error ? (
        <p className="mt-1 text-xs text-red">No se pudieron cargar los productos.</p>
      ) : estado.filas.length === 0 ? (
        <p className="mt-1 text-xs text-ink/50">Todavía no está vinculado a ningún producto.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {estado.filas.map(({ principal, productos: producto }) => (
            <li key={producto.id} className="flex items-center gap-1.5 text-sm text-ink/70">
              <Package className="h-3.5 w-3.5 shrink-0 text-ink/40" aria-hidden="true" />
              <span className="truncate">{producto.nombre}</span>
              {principal && <span className="shrink-0 text-[11px] text-amber">· principal</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Proveedores({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { lista, cargado, recargar } = useProveedores({ activo: activo && esAdmin })
  const [busqueda, setBusqueda] = useEstadoVista('/proveedores:busqueda', '')
  const [orden, setOrden] = useEstadoVista('/proveedores:orden', 'nombre-asc')
  const [verInactivos, setVerInactivos] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [modalProveedor, setModalProveedor] = useState(null) // null | 'nuevo' | proveedor
  const [proveedorAEliminar, setProveedorAEliminar] = useState(null)
  const [conteoProductos, setConteoProductos] = useState(() => new Map())

  // Cuántos productos tiene cada proveedor (para la cabecera de la tarjeta). Se recalcula con cada recarga de la lista.
  useEffect(() => {
    if (!activo || !esAdmin || !cargado) return undefined
    let vigente = true
    supabase
      .from('producto_proveedores')
      .select('proveedor_id')
      .then(({ data }) => {
        if (!vigente) return
        const conteo = new Map()
        for (const { proveedor_id: id } of data ?? []) conteo.set(id, (conteo.get(id) ?? 0) + 1)
        setConteoProductos(conteo)
      })
    return () => {
      vigente = false
    }
  }, [activo, esAdmin, cargado, lista])

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  const termino = busqueda.trim().toLowerCase()
  const inactivos = lista.filter((p) => !p.activo).length
  const visibles = ordenar(
    lista.filter(
      (p) =>
        (verInactivos || p.activo) &&
        (!termino || CAMPOS_BUSQUEDA.some((clave) => String(p[clave] ?? '').toLowerCase().includes(termino))),
    ),
    orden,
  )

  if (!esAdmin) {
    return <EstadoVacio icono={Truck} mensaje="Solo la administradora puede ver los proveedores." />
  }

  return (
    <div className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      <div className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar proveedor, rubro, RUC..."
          tema="amber"
          sinBorde
        />
        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" sinBorde seleccionado />
        <button
          type="button"
          onClick={() => setModalProveedor('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-amber px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nuevo proveedor</span>
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink/60">
        <span>
          {lista.length - inactivos} activos{inactivos > 0 ? ` · ${inactivos} inactivos` : ''}
        </span>
        {inactivos > 0 && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={verInactivos}
              onChange={(evento) => setVerInactivos(evento.target.checked)}
              className="h-3.5 w-3.5 accent-amber"
            />
            Ver inactivos
          </label>
        )}
      </div>

      {!cargado ? (
        <EsqueletoLista columnas={3} />
      ) : visibles.length === 0 ? (
        <EstadoVacio
          icono={Truck}
          mensaje={termino ? 'Ningún proveedor coincide con la búsqueda.' : 'Todavía no hay proveedores registrados.'}
          accion={{ label: '+ Nuevo proveedor', onClick: () => setModalProveedor('nuevo') }}
        />
      ) : (
        <div className="mt-3 grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((proveedor) => {
            const abierto = abiertos.has(proveedor.id)
            const productos = conteoProductos.get(proveedor.id) ?? 0
            return (
              <div
                key={proveedor.id}
                className={`rounded-lg border border-border bg-surface transition-colors hover:border-amber/40 ${
                  proveedor.activo ? '' : 'opacity-60'
                }`}
              >
                <div className="flex items-center gap-2 p-2">
                  <div
                    onClick={() => alternarAbierto(proveedor.id)}
                    onKeyDown={manejarActivacionTeclado(() => alternarAbierto(proveedor.id))}
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
                    className="min-w-0 flex-1 cursor-pointer touch-manipulation"
                  >
                    <p className="truncate text-sm font-medium text-ink">
                      {proveedor.nombre}
                      {!proveedor.activo && (
                        <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[11px] font-normal text-ink/60">
                          Inactivo
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink/50">
                      {[proveedor.rubro, `${productos} ${productos === 1 ? 'producto' : 'productos'}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <ContactoProveedor celular={proveedor.celular} />
                  <button
                    type="button"
                    onClick={() => alternarAbierto(proveedor.id)}
                    aria-label={abierto ? 'Contraer' : 'Expandir'}
                    className="shrink-0 p-1.5"
                  >
                    <IconoFlechaDesplegable
                      className={`h-3 w-3 text-ink/60 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                <CampoColapsable abierto={abierto} diferido>
                  <div className="border-t border-border p-3">
                    <DatosProveedor proveedor={proveedor} />
                    <ProductosDelProveedor proveedorId={proveedor.id} />
                    <div className="mt-3 flex justify-start gap-2">
                      <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={() => setModalProveedor(proveedor)} />
                      <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={() => setProveedorAEliminar(proveedor)} />
                    </div>
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
      )}

      <BotonFlotanteAgregar onClick={() => setModalProveedor('nuevo')} label="Nuevo proveedor" />

      {modalProveedor && (
        <ModalProveedor
          proveedor={modalProveedor === 'nuevo' ? null : modalProveedor}
          nombreInicial={modalProveedor === 'nuevo' ? busqueda : ''}
          onCerrar={() => setModalProveedor(null)}
          onGuardado={() => {
            mostrarToast(modalProveedor === 'nuevo' ? 'Proveedor creado.' : 'Proveedor actualizado.', 'exito')
            setModalProveedor(null)
            recargar()
          }}
        />
      )}

      {proveedorAEliminar && (
        <ModalEliminarProveedor
          proveedor={proveedorAEliminar}
          onCerrar={() => setProveedorAEliminar(null)}
          onEliminado={() => {
            setProveedorAEliminar(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}
