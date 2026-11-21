import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Pencil,
  Trash2,
  MessageCircle,
  Lock,
  Phone,
  Mail,
  Cake,
  Hourglass,
  MapPin,
  StickyNote,
  IdCard,
  Venus,
  Mars,
  Users,
  CalendarPlus,
  Ticket,
  AlertTriangle,
  CalendarDays,
  Scissors,
  ShoppingBag,
  CalendarClock,
  Coins,
  HandCoins,
  Gift,
  Star,
  Globe,
  HeartPulse,
} from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { numeroWhatsapp } from '../../lib/contactoNegocio.js'
import {
  diaCorto,
  edad,
  fechaCorta,
  fechaHora,
  haceDias,
  numero,
  soles,
  NIVELES,
} from '../../lib/perfilCliente.js'
import BotonAccion from '../BotonAccion.jsx'
import TextoDeslizante from '../TextoDeslizante.jsx'
import { AvatarCliente, Capsula, CapsulaTipoCliente, SeccionPerfil } from './PiezasPerfil.jsx'
import SeccionVisitas from './SeccionVisitas.jsx'
import { SeccionProductos, SeccionServicios } from './SeccionesResumen.jsx'
import SeccionCitas from './SeccionCitas.jsx'
import SeccionPuntos from './SeccionPuntos.jsx'
import SeccionDeudas from './SeccionDeudas.jsx'
import SeccionCupones from './SeccionCupones.jsx'
import SeccionResenas from './SeccionResenas.jsx'
import SeccionPedidos from './SeccionPedidos.jsx'

const SELECT_PERFIL =
  'id, nombre, telefono, sexo, direccion, cumpleanos, notas, foto_url, cliente_web_id, dni, ' +
  'codigo_referido, creado_en, clientes_web(email, creado_en, direcciones_cliente(id, etiqueta, direccion, referencia, predeterminada))'

// `chico`: para valores de texto (fecha y hora, nombre de servicio) que no caben en el tamaño de una cifra.
function Kpi({ etiqueta, valor, detalle, claseValor = 'text-ink', chico = false }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="truncate text-xs text-ink/60">{etiqueta}</p>
      <p className={`mt-0.5 truncate font-semibold ${chico ? 'py-0.5 text-sm' : 'font-mono text-lg'} ${claseValor}`}>{valor}</p>
      {detalle && <p className="truncate text-xs text-ink/50">{detalle}</p>}
    </div>
  )
}

// `destacado`: ícono, etiqueta y valor en amarillo (Cumpleaños). Es el mismo amarillo de las estrellas de reseñas del
// portal de clientas (#facc15, InicioCliente.jsx), no el ámbar del POS, que tira a naranja.
function Dato({ icono: Icono, etiqueta, children, mono, destacado = false }) {
  const vacio = children == null || children === '' || children === false
  const claseValor = destacado ? 'text-[#facc15]' : vacio ? 'text-ink/40' : 'text-ink'
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icono className={`mt-0.5 h-4 w-4 shrink-0 ${destacado ? 'text-[#facc15]' : 'text-ink/50'}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] uppercase tracking-wide ${destacado ? 'text-[#facc15]' : 'text-ink/50'}`}>{etiqueta}</p>
        <div className={`break-words text-sm ${claseValor} ${mono && !vacio ? 'font-mono' : ''}`}>
          {vacio ? 'Sin registrar' : children}
        </div>
      </div>
    </div>
  )
}

// Perfil completo de una clienta (pestaña Clientes, `?cliente=<id>`). Junta en una sola vista sus datos y todo lo que
// tiene relación con ella: visitas, servicios, productos, citas, puntos, deudas, cupones y referidos, reseñas y pedidos
// web. El encabezado sale de perfil_cliente_resumen() (una llamada); cada sección pide sus datos recién al abrirse.
//
// Editar y Eliminar los maneja la pestaña (mismos modales que antes): `version` sube después de guardar y vuelve a leer.
export default function PerfilCliente({ clienteId, version, onVolver, onEditar, onEliminar, onAbrirCliente }) {
  const [estado, setEstado] = useState({ cargando: true, error: null, cliente: null, resumen: null })
  // «Deudas y pagos» la puede abrir/cerrar también el aviso de deuda pendiente del encabezado.
  const [deudasAbierta, setDeudasAbierta] = useState(false)
  const deudasRef = useRef(null)

  function alternarDeudasDesdeAviso() {
    const abrir = !deudasAbierta
    setDeudasAbierta(abrir)
    if (abrir) requestAnimationFrame(() => deudasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  useEffect(() => {
    const vigente = { actual: true }
    setEstado((a) => ({ ...a, cargando: true, error: null }))
    Promise.all([
      supabase.from('clientes_admin').select(SELECT_PERFIL).eq('id', clienteId).maybeSingle(),
      supabase.rpc('perfil_cliente_resumen', { p_cliente_id: clienteId }),
    ]).then(([clienteRes, resumenRes]) => {
      if (!vigente.actual) return
      if (clienteRes.error || resumenRes.error) {
        setEstado({ cargando: false, error: 'No se pudo cargar el perfil de la clienta.', cliente: null, resumen: null })
        return
      }
      if (!clienteRes.data) {
        setEstado({ cargando: false, error: 'Esta clienta ya no existe.', cliente: null, resumen: null })
        return
      }
      setEstado({ cargando: false, error: null, cliente: clienteRes.data, resumen: resumenRes.data })
    })
    return () => {
      vigente.actual = false
    }
  }, [clienteId, version])

  const { cliente, resumen } = estado
  const botonVolver = (
    <button
      type="button"
      onClick={onVolver}
      className="inline-flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm text-ink/70 transition-colors hover:text-purple-300"
    >
      <ArrowLeft className="h-4 w-4" />
      Clientes
    </button>
  )

  if (estado.cargando && !cliente) {
    return (
      <div className="pt-(--separador-horizontal)">
        {botonVolver}
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando perfil...</p>
      </div>
    )
  }

  if (estado.error || !cliente) {
    return (
      <div className="pt-(--separador-horizontal)">
        {botonVolver}
        <p className="mt-4 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{estado.error}</p>
      </div>
    )
  }

  const esWeb = Boolean(cliente.cliente_web_id)
  const direccionesWeb = cliente.clientes_web?.direcciones_cliente ?? []
  const conteos = resumen?.conteos ?? {}
  const anios = edad(cliente.cumpleanos)
  const IconoSexo = cliente.sexo === 'Femenino' ? Venus : cliente.sexo === 'Masculino' ? Mars : Users
  const nivel = esWeb ? NIVELES[resumen?.puntos?.nivel] : null
  const deuda = Number(resumen?.deuda_pendiente ?? 0)
  const proxima = resumen?.proxima_cita

  return (
    <div className={`pb-6 pt-(--separador-horizontal) transition-opacity ${estado.cargando ? 'opacity-60' : ''}`}>
      {botonVolver}

      {/* Encabezado */}
      <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
        <AvatarCliente cliente={cliente} tamano="lg" />
        <div className="min-w-0 flex-1">
          <TextoDeslizante texto={cliente.nombre} className="text-lg font-semibold text-ink" />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <CapsulaTipoCliente web={esWeb} />
            {nivel && <Capsula estado={nivel} />}
            {cliente.creado_en && <span className="text-xs text-ink/50">Cliente desde {fechaCorta(cliente.creado_en)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {cliente.telefono && (
            <BotonAccion
              icono={MessageCircle}
              texto="WhatsApp"
              color="verde"
              href={`https://wa.me/${numeroWhatsapp(cliente.telefono)}`}
              target="_blank"
              rel="noopener noreferrer"
              sinBorde
              fondo
            />
          )}
          {esWeb ? (
            <span className="flex max-w-[11rem] items-center gap-1.5 text-xs text-ink/50">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Se registró por la Web: edita su perfil desde ahí.
            </span>
          ) : (
            <>
              <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={() => onEditar(cliente)} sinBorde fondo />
              <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={() => onEliminar(cliente)} sinBorde fondo />
            </>
          )}
        </div>
      </div>

      {deuda > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            Tiene una deuda pendiente de <span className="font-mono font-semibold">{soles(deuda)}</span>.
            {/* El activador es solo este texto: abre/cierra «Deudas y pagos». */}
            <button
              type="button"
              onClick={alternarDeudasDesdeAviso}
              aria-expanded={deudasAbierta}
              className="ml-4 font-medium underline underline-offset-2 transition-colors hover:text-ink"
            >
              {deudasAbierta ? 'Ocultar detalle' : 'Ver detalle'}
            </button>
          </p>
        </div>
      )}

      {/* Indicadores */}
      {resumen && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi etiqueta="Total gastado" valor={soles(resumen.total_gastado)} claseValor="text-green" detalle={`${resumen.ventas} pagos`} />
          <Kpi
            etiqueta="Visitas"
            valor={resumen.visitas}
            claseValor="text-purple-300"
            detalle={resumen.primera_visita ? `días que vino · desde ${diaCorto(resumen.primera_visita)}` : 'Sin visitas'}
          />
          <Kpi etiqueta="Ticket promedio" valor={soles(resumen.ticket_promedio)} />
          <Kpi
            etiqueta="Última visita"
            valor={resumen.ultima_visita ? diaCorto(resumen.ultima_visita) : '—'}
            detalle={haceDias(resumen.dias_desde_ultima)}
            claseValor={resumen.dias_desde_ultima > 60 ? 'text-amber' : 'text-ink'}
          />
          <Kpi
            etiqueta="Puntos"
            valor={esWeb ? numero(resumen.puntos?.monedas) : '—'}
            detalle={esWeb ? `${nivel?.label ?? 'Básico'} · ${resumen.puntos?.sellos ?? 0} sellos` : 'Sin cuenta web'}
            claseValor="text-purple-300"
          />
          <Kpi etiqueta="Deuda pendiente" valor={soles(deuda)} claseValor={deuda > 0 ? 'text-red' : 'text-ink/60'} />
          <Kpi
            etiqueta="Próxima cita"
            valor={proxima ? fechaHora(proxima.fecha_hora) : '—'}
            detalle={proxima?.asistente ?? `${resumen.citas?.no_asistio ?? 0} no asistió · ${resumen.citas?.canceladas ?? 0} canceladas`}
            chico
          />
          <Kpi
            etiqueta="Le gusta"
            valor={resumen.servicio_frecuente?.nombre ?? '—'}
            detalle={resumen.asistente_favorita ? `con ${resumen.asistente_favorita.nombre}` : null}
            chico
          />
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        {/* Datos personales */}
        <section className="rounded-lg border border-border bg-surface p-3 lg:sticky lg:top-3">
          <h2 className="mb-3 text-sm font-semibold text-ink">Datos personales</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Dato icono={Phone} etiqueta="Celular / WhatsApp" mono>{cliente.telefono}</Dato>
            <Dato icono={Mail} etiqueta="Correo electrónico" mono>{cliente.clientes_web?.email}</Dato>
            <Dato icono={IconoSexo} etiqueta="Sexo">{cliente.sexo}</Dato>
            <Dato icono={Cake} etiqueta="Cumpleaños" destacado>{cliente.cumpleanos && diaCorto(cliente.cumpleanos)}</Dato>
            <Dato icono={Hourglass} etiqueta="Edad">{anios != null && `${anios} ${anios === 1 ? 'año' : 'años'}`}</Dato>
            <Dato icono={IdCard} etiqueta="DNI" mono>{cliente.dni}</Dato>
            <Dato icono={MapPin} etiqueta={direccionesWeb.length > 1 ? 'Direcciones' : 'Dirección'}>
              {direccionesWeb.length > 0
                ? direccionesWeb.map((dir) => (
                    <p key={dir.id}>
                      <span className="font-medium text-ink/80">{dir.etiqueta}:</span> {dir.direccion}
                      {dir.referencia && <span className="text-ink/50"> ({dir.referencia})</span>}
                      {dir.predeterminada && <span className="ml-1 text-amber">★</span>}
                    </p>
                  ))
                : cliente.direccion}
            </Dato>
            <Dato icono={Ticket} etiqueta="Código de referido" mono>{cliente.codigo_referido}</Dato>
            {esWeb && (
              <Dato icono={Globe} etiqueta="Cuenta web desde">
                {cliente.clientes_web?.creado_en && fechaCorta(cliente.clientes_web.creado_en)}
              </Dato>
            )}
            <Dato icono={CalendarPlus} etiqueta="Cliente desde">{cliente.creado_en && fechaCorta(cliente.creado_en)}</Dato>
            <div className="sm:col-span-2 lg:col-span-1">
              <Dato icono={StickyNote} etiqueta="Notas">
                {cliente.notas && <p className="whitespace-pre-line">{cliente.notas}</p>}
              </Dato>
            </div>
          </div>
        </section>

        {/* Historiales */}
        <div className="space-y-2 lg:col-span-2">
          <SeccionPerfil icono={CalendarDays} titulo="Historial de visitas" contador={resumen?.visitas}>
            <SeccionVisitas clienteId={cliente.id} />
          </SeccionPerfil>
          <SeccionPerfil icono={Scissors} titulo="Servicios" contador={conteos.servicios}>
            <SeccionServicios clienteId={cliente.id} />
          </SeccionPerfil>
          <SeccionPerfil icono={ShoppingBag} titulo="Productos comprados" contador={conteos.productos}>
            <SeccionProductos clienteId={cliente.id} />
          </SeccionPerfil>
          <SeccionPerfil icono={CalendarClock} titulo="Citas" contador={resumen?.citas?.total}>
            <SeccionCitas clienteId={cliente.id} />
          </SeccionPerfil>
          <SeccionPerfil icono={Coins} titulo="Puntos y recompensas" contador={esWeb ? conteos.movimientos_puntos : null}>
            <SeccionPuntos clienteId={cliente.id} esWeb={esWeb} puntos={resumen?.puntos} />
          </SeccionPerfil>
          <SeccionPerfil
            icono={HandCoins}
            titulo="Deudas y pagos"
            contador={conteos.deudas}
            abierta={deudasAbierta}
            onAlternar={() => setDeudasAbierta((a) => !a)}
            seccionRef={deudasRef}
          >
            <SeccionDeudas clienteId={cliente.id} nombreCliente={cliente.nombre} />
          </SeccionPerfil>
          <SeccionPerfil icono={Gift} titulo="Cupones y referidos" contador={conteos.cupones}>
            <SeccionCupones
              clienteId={cliente.id}
              codigoReferido={cliente.codigo_referido}
              referidaPor={resumen?.referida_por}
              onAbrirCliente={onAbrirCliente}
            />
          </SeccionPerfil>
          <SeccionPerfil icono={Star} titulo="Reseñas" contador={conteos.resenas}>
            <SeccionResenas clienteId={cliente.id} />
          </SeccionPerfil>
          <SeccionPerfil icono={Globe} titulo="Pedidos web" contador={conteos.pedidos}>
            <SeccionPedidos clienteId={cliente.id} />
          </SeccionPerfil>
          <SeccionPerfil icono={HeartPulse} titulo="Historial médico">
            <p className="text-sm text-ink/60">
              Próximamente: alergias (tintes, químicos, medicamentos), medicamentos actuales, condiciones de piel y cuero
              cabelludo, tratamientos químicos previos, prueba de parche y consentimiento firmado.
            </p>
          </SeccionPerfil>
        </div>
      </div>
    </div>
  )
}
