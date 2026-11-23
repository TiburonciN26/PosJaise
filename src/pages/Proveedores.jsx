import { useEffect, useState } from 'react'
import { ArrowRight, Pencil, Plus, Trash2, Truck, Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import { useProveedores } from '../hooks/useProveedores.js'
import { useMediaQuery } from '../hooks/useMediaQuery.js'
import { useEncabezadoTablaPegado } from '../hooks/useEncabezadoTablaPegado.js'
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
import BotonFlechaDesplegable from '../components/BotonFlechaDesplegable.jsx'
import IconoFlechaDesplegable from '../components/IconoFlechaDesplegable.jsx'

// Proveedores (migración 20261112000014; cuelga de Inventario en el menú, solo administradora). Registro dedicado: aquí se
// crean, editan y eliminan proveedores libremente, sin vincularlos a ningún producto. Se vinculan desde el modal del
// producto («Agregar proveedor») o solos al registrar un ingreso de stock con ese proveedor.

const OPCIONES_ORDEN = [
  { id: 'recientes', label: 'Últimos agregados' },
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
]

const CAMPOS_BUSQUEDA = ['nombre', 'rubro', 'contacto_nombre', 'ruc', 'celular', 'ciudad', 'razon_social']

function ordenar(lista, orden) {
  const copia = [...lista]
  if (orden === 'recientes') return copia.sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))
  copia.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  return orden === 'nombre-desc' ? copia.reverse() : copia
}

// Productos vinculados a un proveedor: se pide solo al desplegar la tarjeta.
function ProductosDelProveedor({ proveedorId, className = 'mt-3' }) {
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
    <div className={className}>
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

// Cabecera de un registro abierto: lo que se pinta de ámbar son SUS ELEMENTOS (textos, íconos y flecha), no el fondo. El fondo
// sigue siendo el normal (opaco, porque además la cabecera queda pegada arriba y no puede dejar ver lo de debajo).
// Alto fijo de la fila de títulos de la tabla de PC (h-8): el registro abierto se pega justo debajo de ella.
const ALTO_TITULOS_PX = 32
const COLUMNAS_TABLA = 'grid-cols-[repeat(5,minmax(0,1fr))_4rem]'

// Contenido del desplegable. Móvil: lo que más importa —los productos que distribuye— va siempre visible; los datos del
// proveedor quedan ocultos tras «Datos del proveedor» y la usuaria decide si verlos. Escritorio: datos y productos lado a lado.
// Editar/Eliminar van arriba (con 200 productos abajo del todo no se alcanzarían).
function DetalleProveedor({ proveedor, escritorio, onEditar, onEliminar }) {
  const [verDatos, setVerDatos] = useState(false)
  const acciones = (
    <div className="flex shrink-0 gap-2">
      <BotonAccion sinBorde relleno icono={Pencil} texto="Editar" color="celeste" onClick={() => onEditar(proveedor)} />
      <BotonAccion sinBorde relleno icono={Trash2} texto="Eliminar" color="rojo" onClick={() => onEliminar(proveedor)} />
    </div>
  )

  if (escritorio) {
    return (
      <>
        <div className="flex justify-end">{acciones}</div>
        <div className="mt-3 grid grid-cols-2 items-start gap-8">
          <DatosProveedor proveedor={proveedor} />
          <ProductosDelProveedor proveedorId={proveedor.id} className="" />
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setVerDatos((visible) => !visible)}
          aria-expanded={verDatos}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs text-ink transition-colors hover:bg-surface-3 ${
            verDatos ? 'bg-surface-3' : 'bg-boton-icono'
          }`}
        >
          <span>Datos del proveedor</span>
          <IconoFlechaDesplegable className={`h-3 w-3 transition-transform duration-300 ${verDatos ? 'rotate-180' : ''}`} />
        </button>
        {acciones}
      </div>
      <CampoColapsable abierto={verDatos} diferido>
        <div className="pt-3">
          <DatosProveedor proveedor={proveedor} />
        </div>
      </CampoColapsable>
      <ProductosDelProveedor proveedorId={proveedor.id} className="mt-3" />
    </>
  )
}

function EtiquetaInactivo() {
  return (
    <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[11px] font-normal text-ink/60">
      Inactivo
    </span>
  )
}

export default function Proveedores({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { lista, cargado, recargar } = useProveedores({ activo: activo && esAdmin })
  const [busqueda, setBusqueda] = useEstadoVista('/proveedores:busqueda', '')
  const [orden, setOrden] = useEstadoVista('/proveedores:orden', 'recientes')
  const esEscritorio = useMediaQuery('(min-width: 1024px)') // monta lista móvil O tabla, no las dos
  const { barraRef, encabezadoRef, claseTh, estiloTh } = useEncabezadoTablaPegado([lista, cargado, esEscritorio])
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

  // `nodo`: el elemento que recibió el clic/tecla, para ubicar el registro en pantalla. Si se cierra un registro cuya
  // cabecera está pegada arriba (se estaba muy abajo en su detalle largo), se devuelve el scroll hasta el sitio natural de la
  // cabecera: así al plegarse el detalle la cabecera no se pierde y todo vuelve a la normalidad.
  function alternarAbierto(id, nodo) {
    if (abiertos.has(id) && nodo) {
      const registro = nodo.closest('[data-registro]')
      const cabecera = registro?.querySelector('[data-cabecera]')
      const main = registro?.closest('main')
      if (cabecera && main) {
        const pegado = cabecera.getBoundingClientRect().top - registro.getBoundingClientRect().top
        if (pegado > 1) main.scrollTop -= pegado
      }
    }
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  const alActivar = (id) => (evento) => alternarAbierto(id, evento.currentTarget)
  const alTeclear = (id) => (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return
    evento.preventDefault()
    alternarAbierto(id, evento.currentTarget)
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
      <div
        ref={barraRef}
        className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)"
      >
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

      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-ink/60">
        <span>
          {lista.length - inactivos} activos{inactivos > 0 ? ` · ${inactivos} inactivos` : ''}
        </span>
        <div className="flex items-center gap-4">
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
          <Link
            to="/inventario"
            className="inline-flex items-center gap-1 text-sm text-amber transition-colors hover:text-amber/80"
          >
            Ir a inventario
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
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
        <>
          {/* Celular: lista separada por rayitas, como Historial. Fila cerrada = una línea (nombre, nº de productos,
              WhatsApp y flecha). Abierta: sus elementos (nombre, nº de productos, flecha) se pintan de ámbar y, si el detalle es largo, queda pegada bajo el
              buscador para poder cerrarlo sin subir; al cerrar vuelve a la normalidad. */}
          {!esEscritorio && (
            <div className="mt-4 -mx-3 border-t border-border">
              {visibles.map((proveedor, indice) => {
                const abierto = abiertos.has(proveedor.id)
                const productos = conteoProductos.get(proveedor.id) ?? 0
                const esUltimo = indice === visibles.length - 1
                return (
                  <div key={proveedor.id} data-registro className={esUltimo ? '' : 'border-b border-border'}>
                    <div
                      data-cabecera
                      onClick={alActivar(proveedor.id)}
                      onKeyDown={alTeclear(proveedor.id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={abierto}
                      style={abierto ? { top: estiloTh.top } : undefined}
                      className={`flex cursor-pointer touch-manipulation items-center justify-between gap-2 px-3 py-2 transition-colors duration-300 ${
                        abierto ? 'sticky z-[6] bg-bg' : 'bg-bg hover:bg-surface-2'
                      }`}
                    >
                      <p
                        className={`flex min-w-0 items-center text-sm font-medium transition-colors duration-300 ${
                          abierto ? 'text-amber' : proveedor.activo ? 'text-ink' : 'text-ink/60'
                        }`}
                      >
                        <span className="truncate">{proveedor.nombre}</span>
                        {!proveedor.activo && <EtiquetaInactivo />}
                      </p>
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(evento) => evento.stopPropagation()}
                        onKeyDown={(evento) => evento.stopPropagation()}
                      >
                        <span
                          className={`mr-1 flex items-center gap-1 font-mono text-xs transition-colors duration-300 ${
                            abierto ? 'text-amber' : 'text-ink/60'
                          }`}
                          title={`${productos} ${productos === 1 ? 'producto' : 'productos'}`}
                        >
                          <Package className="h-3 w-3" aria-hidden="true" />
                          {productos}
                          <span className="sr-only">{productos === 1 ? 'producto' : 'productos'}</span>
                        </span>
                        <ContactoProveedor celular={proveedor.celular} />
                        <BotonFlechaDesplegable
                          plano
                          abierto={abierto}
                          onClick={alActivar(proveedor.id)}
                          color={abierto ? 'text-amber' : 'text-ink'}
                        />
                      </div>
                    </div>

                    <CampoColapsable abierto={abierto} diferido>
                      <div className="px-3 pb-6 pt-3">
                        <DetalleProveedor
                          proveedor={proveedor}
                          escritorio={false}
                          onEditar={setModalProveedor}
                          onEliminar={setProveedorAEliminar}
                        />
                      </div>
                    </CampoColapsable>
                  </div>
                )
              })}
            </div>
          )}

          {/* PC: «tabla» hecha con filas de cuadrícula (cada registro es un bloque propio, así su cabecera puede quedar pegada
              solo mientras dure su detalle). Las 5 columnas se reparten el ancho por igual y todo va centrado; el detalle
              completo se despliega debajo de la fila. */}
          {esEscritorio && (
            <div role="table" className="mt-4 overflow-x-clip border-y border-border">
              <div
                ref={encabezadoRef}
                role="row"
                style={estiloTh}
                className={`${claseTh} grid h-8 ${COLUMNAS_TABLA} items-center text-center font-mono text-xs font-semibold uppercase tracking-wider text-ink/60`}
              >
                <div role="columnheader" className="px-3">Proveedor</div>
                <div role="columnheader" className="px-3">Rubro</div>
                <div role="columnheader" className="px-3">Contacto</div>
                <div role="columnheader" className="px-3">Celular / WhatsApp</div>
                <div role="columnheader" className="px-3">Productos</div>
                <div role="columnheader" className="px-3">
                  <span className="sr-only">Detalle</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {visibles.map((proveedor) => {
                  const abierto = abiertos.has(proveedor.id)
                  const productos = conteoProductos.get(proveedor.id) ?? 0
                  return (
                    <div key={proveedor.id} data-registro role="rowgroup">
                      <div
                        data-cabecera
                        onClick={alActivar(proveedor.id)}
                        onKeyDown={alTeclear(proveedor.id)}
                        role="row"
                        tabIndex={0}
                        aria-expanded={abierto}
                        style={abierto ? { top: estiloTh.top + ALTO_TITULOS_PX } : undefined}
                        className={`grid ${COLUMNAS_TABLA} cursor-pointer touch-manipulation items-center py-2.5 text-center transition-colors duration-300 ${
                          abierto ? 'sticky z-[6] bg-tabla' : 'bg-tabla hover:bg-surface-2/60'
                        }`}
                      >
                        <div role="cell" className="min-w-0 px-3">
                          <p
                            className={`flex min-w-0 items-center justify-center transition-colors duration-300 ${
                              abierto ? 'text-amber' : proveedor.activo ? 'text-ink' : 'text-ink/60'
                            }`}
                          >
                            <span className="truncate">{proveedor.nombre}</span>
                            {!proveedor.activo && <EtiquetaInactivo />}
                          </p>
                        </div>
                        <div role="cell" className={`truncate px-3 transition-colors duration-300 ${abierto ? 'text-amber' : 'text-ink/70'}`}>
                          {proveedor.rubro || '—'}
                        </div>
                        <div role="cell" className={`truncate px-3 transition-colors duration-300 ${abierto ? 'text-amber' : 'text-ink/70'}`}>
                          {proveedor.contacto_nombre || '—'}
                        </div>
                        <div
                          role="cell"
                          className="min-w-0 px-3"
                          onClick={(evento) => evento.stopPropagation()}
                          onKeyDown={(evento) => evento.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span className={`truncate font-mono transition-colors duration-300 ${abierto ? 'text-amber' : 'text-ink/80'}`}>
                              {proveedor.celular || '—'}
                            </span>
                            <ContactoProveedor celular={proveedor.celular} />
                          </div>
                        </div>
                        <div role="cell" className={`px-3 font-mono transition-colors duration-300 ${abierto ? 'text-amber' : 'text-ink/70'}`}>
                          {productos}
                        </div>
                        <div role="cell" className="flex justify-center px-3">
                          <BotonFlechaDesplegable
                            abierto={abierto}
                            color={abierto ? 'text-amber' : 'text-ink'}
                            onClick={(evento) => {
                              evento.stopPropagation()
                              alternarAbierto(proveedor.id, evento.currentTarget)
                            }}
                          />
                        </div>
                      </div>

                      <CampoColapsable abierto={abierto} diferido>
                        <div className="bg-bg px-8 pb-8 pt-4 text-left">
                          <DetalleProveedor
                            proveedor={proveedor}
                            escritorio
                            onEditar={setModalProveedor}
                            onEliminar={setProveedorAEliminar}
                          />
                        </div>
                      </CampoColapsable>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
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
