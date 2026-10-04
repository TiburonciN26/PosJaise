import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Package, Pencil, Scissors } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useDebounce } from '../hooks/useDebounce.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
import { patronIlike } from '../lib/buscarClientes.js'
import { SELECT_PRODUCTOS, SELECT_SERVICIOS } from '../lib/columnasCatalogo.js'
import { consultaListadoServicios, TAMANO_PAGINA_SERVICIOS } from '../lib/buscarServicios.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalProducto from '../components/ModalProducto.jsx'
import ModalServicio from '../components/ModalServicio.jsx'

// Web → Catálogo → Productos / Servicios — solo ADMINISTRADOR (la ruta y el backend lo exigen; no se cambió ningún permiso).
// Edita el contenido EDITORIAL y de configuración Web de las MISMAS fichas que el POS (no duplica productos, servicios
// ni precios). Cada formulario guarda solo sus columnas: guardar aquí conserva lo del POS y viceversa. El precio real es
// compartido y aquí es de solo lectura. La protección económica de servicios sigue en Recompensas Web.
//
// Navegación: «Editar en Web» desde Inventario/Servicios llega con ?tab=…&id=<ficha>&desde=<ruta> y abre la ficha por ID.
// Esta pestaña (como el POS) queda montada: el borrador del modal, la búsqueda, la pestaña y la página cargada siguen ahí al
// volver. Nunca se guarda ni se descarta nada en silencio: pedir otra ficha con cambios pendientes pide confirmación.

const PESTANAS = [
  { id: 'productos', label: 'Productos', icono: Package },
  { id: 'servicios', label: 'Servicios', icono: Scissors },
]
const ORIGENES = { '/inventario': 'Inventario', '/servicios': 'Servicios' }
const TAMANO_PAGINA = 50

function consultaProductos(termino) {
  let consulta = supabase.from('productos_vista').select(SELECT_PRODUCTOS).eq('activo', true)
  if (termino.trim()) consulta = consulta.ilike('nombre', patronIlike(termino))
  return consulta.order('nombre').order('id')
}

async function fichaPorId(tipo, id) {
  const consulta =
    tipo === 'productos'
      ? supabase.from('productos_vista').select(SELECT_PRODUCTOS).eq('id', id).maybeSingle()
      : supabase.from('servicios').select(SELECT_SERVICIOS).eq('id', id).maybeSingle()
  const { data, error } = await consulta
  if (error) throw error
  return data
}

// QA-049: la decisión sobre un borrador pendiente vive en su PROPIO diálogo, por encima del modal de la ficha abierta
// (z-40 > z-30): antes era un aviso en la página que quedaba detrás del overlay y no se podía pulsar ni alcanzar con
// el teclado. Escape = conservar (la opción segura); el foco inicial está en «Seguir con la ficha abierta».
function DialogoConflictoBorrador({ abierta, onSeguir, onDescartar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onSeguir)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div ref={panelRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-ink">Hay una ficha abierta con cambios sin guardar</h2>
        <p className="mt-2 text-sm text-ink/70">
          Tienes abierta «{abierta}» y pediste abrir otra ficha. No se guardó ni se descartó nada.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            onClick={onSeguir}
            className="rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-red hover:text-red"
          >
            Seguir con la ficha abierta
          </button>
          <button
            type="button"
            onClick={onDescartar}
            className="rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10"
          >
            Abrir la solicitada (descarta los cambios sin guardar)
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CatalogoWeb({ activo = true }) {
  const { mostrarToast } = useToast()
  const [params, setParams] = useSearchParams()
  const tab = PESTANAS.some((p) => p.id === params.get('tab')) ? params.get('tab') : 'productos'
  const idSolicitado = params.get('id')
  const desdeParam = params.get('desde')
  const desde = desdeParam && ORIGENES[desdeParam] ? desdeParam : null

  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [filas, setFilas] = useState([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // { tipo, fila }
  const [aviso, setAviso] = useState(null) // { texto, tipo: 'noEncontrada' | 'error' | 'conflicto', id? }
  const vigenteRef = useRef({ actual: true })
  const tamano = tab === 'servicios' ? TAMANO_PAGINA_SERVICIOS : TAMANO_PAGINA

  const consulta = useCallback(
    () =>
      tab === 'servicios'
        ? consultaListadoServicios(supabase, { termino: busquedaDebounced, orden: 'nombre-asc', columnas: SELECT_SERVICIOS })
        : consultaProductos(busquedaDebounced),
    [tab, busquedaDebounced],
  )

  const cargar = useCallback(
    async (vigente = { actual: true }, silencioso = false) => {
      if (!silencioso) setCargando(true)
      const { data, error: errorConsulta } = await consulta().range(0, tamano - 1)
      if (!vigente.actual) return
      if (errorConsulta) {
        setError('No se pudo cargar el catálogo.')
        setFilas([])
        setHayMas(false)
      } else {
        setError(null)
        setFilas(data ?? [])
        setHayMas((data ?? []).length === tamano)
      }
      setCargando(false)
    },
    [consulta, tamano],
  )

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    cargar(vigente)
    return () => {
      vigente.actual = false
    }
  }, [activo, cargar])

  async function cargarMas() {
    if (cargandoMas || !hayMas) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { data, error: errorMas } = await consulta().range(filas.length, filas.length + tamano - 1)
    setCargandoMas(false)
    if (!vigente.actual) return
    if (errorMas) {
      mostrarToast('No se pudieron cargar más fichas.', 'error')
      return
    }
    setFilas((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === tamano)
  }

  function cambiarParametros(cambios) {
    const siguiente = new URLSearchParams(params)
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === null) siguiente.delete(clave)
      else siguiente.set(clave, valor)
    }
    setParams(siguiente, { replace: true })
  }

  function irA(nueva) {
    if (nueva === tab) return
    // Cambiar de pestaña con un borrador abierto no lo descarta: el modal sigue siendo el mismo (su tipo manda).
    setBusqueda('')
    cambiarParametros({ tab: nueva, id: null })
  }

  function abrirPorId(id, sigueVigente = () => true) {
    setAviso(null)
    fichaPorId(tab, id).then(
      (fila) => {
        if (!sigueVigente()) return
        if (fila) setModal({ tipo: tab, fila })
        else setAviso({ tipo: 'noEncontrada', texto: 'No se encontró esa ficha (puede estar desactivada o eliminada).' })
      },
      () => sigueVigente() && setAviso({ tipo: 'error', texto: 'No se pudo abrir la ficha. Reintenta.', id }),
    )
  }

  // Abrir por ID (acceso directo o «Editar en Web»). Con cambios pendientes en OTRA ficha no se reemplaza nada en
  // silencio: se avisa y se deja elegir.
  useEffect(() => {
    if (!activo || !idSolicitado) return undefined
    if (modal && modal.fila.id === idSolicitado && modal.tipo === tab) return undefined
    if (modal) {
      setAviso({ tipo: 'conflicto', id: idSolicitado, tab, texto: `Hay una ficha abierta con cambios sin guardar: «${modal.fila.nombre}».` })
      return undefined
    }
    let vigente = true
    abrirPorId(idSolicitado, () => vigente)
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, idSolicitado, tab])

  function cerrarModal() {
    setModal(null)
    setAviso(null)
    if (idSolicitado) cambiarParametros({ id: null })
  }

  // Conservar: la ficha abierta sigue intacta (sin abrir la solicitada ni guardar) y la URL vuelve a describirla.
  function seguirConLaAbierta() {
    setAviso(null)
    if (modal) cambiarParametros({ tab: modal.tipo, id: modal.fila.id })
  }

  function abrirSolicitadaDescartando() {
    // Acción EXPLÍCITA del usuario: descarta el borrador abierto y abre la ficha pedida.
    const id = aviso?.id
    setModal(null)
    setAviso(null)
    if (id) abrirPorId(id)
  }

  const etiquetaTab = tab === 'servicios' ? 'servicios' : 'productos'

  return (
    <div className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-5xl" style={{ '--color-foco': 'var(--color-red)' }}>
      <h1 className="mt-3 text-base font-semibold text-red">Catálogo Web</h1>
      {desde && (
        <Link to={desde} className="mt-1 inline-block text-sm text-ink/70 underline hover:text-red">
          ← Volver a {ORIGENES[desde]}
        </Link>
      )}
      <p className="mt-1 text-xs text-ink/60">
        Contenido editorial y configuración Web de las mismas fichas del POS. El precio real, el stock y la protección económica no se
        editan aquí.
      </p>

      <div role="tablist" aria-label="Catálogo Web" className="mt-3 flex gap-2">
        {PESTANAS.map((p) => {
          const Icono = p.icono
          const seleccionada = p.id === tab
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={seleccionada}
              onClick={() => irA(p.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                seleccionada ? 'border-red bg-red/10 text-red' : 'border-border text-ink/70 hover:border-border-strong'
              }`}
            >
              <Icono className="h-4 w-4" />
              {p.label}
            </button>
          )
        })}
      </div>

      {aviso && aviso.tipo !== 'conflicto' && (
        <div role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          <p>{aviso.texto}</p>
          {aviso.tipo === 'error' && (
            <button type="button" onClick={() => abrirPorId(aviso.id)} className="mt-2 rounded-lg border border-red/40 px-3 py-1 text-xs">
              Reintentar
            </button>
          )}
        </div>
      )}

      <div className="sticky top-0 z-10 -mx-3 mt-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder={tab === 'servicios' ? 'Buscar servicio...' : 'Buscar producto...'}
          tema="red"
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={3} />
      ) : filas.length === 0 && error ? null : filas.length === 0 ? (
        <EstadoVacio icono={tab === 'servicios' ? Scissors : Package} mensaje={`No se encontraron ${etiquetaTab}.`} />
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {filas.map((fila) => (
              <li key={fila.id} className="flex items-center justify-between gap-3 px-3 py-2.5" data-ficha-id={fila.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{fila.nombre}</p>
                  <p className="font-mono text-xs text-ink/60">
                    {formatearSoles(fila.precio)}
                    {fila.categoria ? ` · ${fila.categoria}` : ''}
                  </p>
                </div>
                <BotonAccion
                  icono={Pencil}
                  texto="Contenido Web"
                  color="celeste"
                  onClick={() => {
                    if (modal) return
                    setModal({ tipo: tab, fila })
                  }}
                />
              </li>
            ))}
          </ul>
          {hayMas && (
            <button
              type="button"
              onClick={cargarMas}
              disabled={cargandoMas}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-red hover:text-red disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}

      {aviso?.tipo === 'conflicto' && modal && (
        <DialogoConflictoBorrador
          abierta={modal.fila.nombre}
          onSeguir={seguirConLaAbierta}
          onDescartar={abrirSolicitadaDescartando}
        />
      )}

      {modal?.tipo === 'servicios' && (
        <ModalServicio
          modo="web"
          servicio={modal.fila}
          onCerrar={cerrarModal}
          onGuardado={() => {
            mostrarToast('Contenido Web del servicio guardado.', 'exito')
            cerrarModal()
            cargar(vigenteRef.current, true)
          }}
        />
      )}
      {modal?.tipo === 'productos' && (
        <ModalProducto
          modo="web"
          producto={modal.fila}
          onCerrar={cerrarModal}
          onGuardado={() => {
            mostrarToast('Contenido Web del producto guardado.', 'exito')
            cerrarModal()
            cargar(vigenteRef.current, true)
          }}
        />
      )}
    </div>
  )
}
