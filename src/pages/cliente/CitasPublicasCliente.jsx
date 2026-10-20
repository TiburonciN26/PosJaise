import { Link } from 'react-router-dom'
import { obtenerContacto, obtenerHorario } from '../../lib/datosNegocioWeb.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { formatearSoles } from '../../lib/moneda.js'
import { useEstadoNegocio } from '../../context/EstadoNegocioContext.jsx'
import { useLectura } from '../../hooks/useLectura.js'
import PieClienteWeb from './PieClienteWeb.jsx'

const TARJETA = 'citas-cliente-tarjeta flex min-w-0 flex-col gap-3 rounded-[10px] border border-white/10 bg-[#111113] p-5'

// Solo información pública del negocio. La agenda, el historial y el saldo
// pertenecen a CitasConSesion y nunca se montan en esta vista.
export default function CitasPublicasCliente() {
  const contacto = useLectura(obtenerContacto).datos
  const horario = useLectura(obtenerHorario).datos
  const { adelantoMinimo, cancelacionPlazoHoras } = useEstadoNegocio()

  return (
    <div className="citas-cliente-scroll flex-1 overflow-y-auto pb-4 md:pb-8">
      <div className="citas-cliente-contenido mx-auto flex w-full max-w-[1400px] flex-col gap-6 lw-gutter-detalle">
        <header className="flex flex-col gap-2">
          <h1 className="sm:text-[48px] lw-titulo-heavitas text-3xl max-sm:text-[1.5rem] uppercase">Mis citas</h1>
          <p className="text-sm text-white/60">Conoce cómo reservar tu próxima visita.</p>
        </header>

        <section className="liquid-glass flex flex-wrap items-center justify-between gap-5 border border-white/10 p-8 max-sm:px-(--separador-vertical-secundario) max-sm:py-(--separador-horizontal-secundario)">
          <div className="flex max-w-[560px] flex-col gap-1.5">
            <h2 className="sm:text-xl text-lg font-semibold text-white">Inicia sesión para ver tus citas</h2>
            <p className="text-sm leading-relaxed text-white/60">
              Accede a tus próximas citas, historial y recompensas, y gestiona tus reservas.
              Mientras tanto, puedes explorar los servicios y consultar la información del salón.
            </p>
          </div>
          <Link to="/login" state={{ desde: '/citas' }} className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]">
            Iniciar sesión
          </Link>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className={TARJETA}>
            <h2 className="sm:text-xl lw-titulo-heavitas text-[15px] uppercase text-white">Cómo reservar</h2>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-white/70">
              <li>Explora los servicios y elige el que quieras reservar.</li>
              <li>Inicia sesión para continuar con tu reserva.</li>
              <li>Elige entre los días y horarios disponibles al agendar.</li>
            </ol>
            <Link to="/servicios" className="mt-auto w-fit text-sm font-medium text-[var(--lw-gold)]">Ver servicios →</Link>
          </section>

          <section className={TARJETA}>
            <h2 className="sm:text-xl lw-titulo-heavitas text-[15px] uppercase text-white">Horario de atención</h2>
            {horario ? (
              <div className="text-sm leading-relaxed text-white/70">
                <p>{formatearDias(horario.dias_atencion)}</p>
                <p>{formatearHora(horario.bloque1_inicio)} – {formatearHora(horario.bloque1_fin)}</p>
                {horario.bloque2_inicio && <p>y {formatearHora(horario.bloque2_inicio)} – {formatearHora(horario.bloque2_fin)}</p>}
              </div>
            ) : <p className="text-sm text-white/60">Consulta el horario de atención con el salón.</p>}
            {contacto?.direccion && <p className="wrap-break-word text-sm text-white/70">{contacto.direccion}</p>}
            {contacto?.telefono && (
              <a href={`https://wa.me/${numeroWhatsapp(contacto.telefono)}`} target="_blank" rel="noopener noreferrer" className="w-fit text-sm font-medium text-[var(--lw-gold)]">Escríbenos por WhatsApp</a>
            )}
          </section>

          <section className={TARJETA}>
            <h2 className="sm:text-xl lw-titulo-heavitas text-[15px] uppercase text-white">Antes de tu cita</h2>
            <p className="text-sm leading-relaxed text-white/70">La disponibilidad se confirma al elegir el servicio, la fecha y la hora de tu reserva.</p>
            {adelantoMinimo != null && <p className="text-sm text-white/70">Adelanto mínimo: {formatearSoles(adelantoMinimo)}.</p>}
            {cancelacionPlazoHoras != null && <p className="text-sm leading-relaxed text-white/70">Puedes cancelar o reprogramar hasta {cancelacionPlazoHoras} horas antes de tu cita.</p>}
            <Link to="/recompensas?seccion=como" className="mt-auto w-fit text-sm font-medium text-[var(--lw-gold)]">Conoce las recompensas →</Link>
          </section>
        </div>
      </div>
      <PieClienteWeb />
    </div>
  )
}
