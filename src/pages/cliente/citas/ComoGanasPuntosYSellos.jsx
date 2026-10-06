import { Link } from 'react-router-dom'
import { Check, Info, Sparkles, Stamp } from 'lucide-react'
import { AvisoError } from '../recompensas/ui.jsx'
import { formatearCantidad, textoTasa } from '../../../lib/programaRecompensas.js'

// «Cómo ganas puntos y sellos» de Citas. Dos mundos que NO se mezclan:
//   · programa apagado (heredado): puntos y sellos como hasta ahora, con la fórmula de config_puntos y sin prometer nada del programa
//     nuevo ni un porcentaje fijo;
//   · programa activo: monedas (gastables), clasificación (nivel) y sellos con las cifras VIGENTES de recompensas_reglas_publicas().
// Mientras las reglas cargan no hay cifras; si fallan, un aviso con reintento — nunca una tasa de reemplazo.
// `heredado` trae lo leído del programa antiguo (null en cada dato si no se pudo leer): { cfg, umbrales, sellosMeta }.
function Caja({ children }) {
  return <div className="flex flex-col gap-3.5 pt-8 first:pt-0 lg:pt-0">{children}</div>
}

function Titulo({ icono: Icono, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--lw-gold)]/10 text-[var(--lw-gold)]">
        <Icono className="h-[18px] w-[18px]" />
      </span>
      <h3 className="lw-titulo-heavitas text-[15px] uppercase">{children}</h3>
    </div>
  )
}

const P = ({ children }) => <p className="text-[13px] leading-relaxed text-white/75">{children}</p>
const B = ({ children }) => <strong className="text-white">{children}</strong>

function Niveles({ premium, vip }) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="flex flex-1 flex-col gap-0.5 rounded-lg border border-white/15 px-2.5 py-2 text-[11px] text-white/50">
        <strong className="text-[13px] text-white">Básico</strong>desde 0 pts
      </div>
      <div className="flex flex-1 flex-col gap-0.5 rounded-lg border border-white/15 px-2.5 py-2 text-[11px] text-white/50">
        <strong className="text-[13px] text-white">Premium</strong>desde {formatearCantidad(premium)} pts
      </div>
      <div className="flex flex-1 flex-col gap-0.5 rounded-lg border border-white/15 px-2.5 py-2 text-[11px] text-white/50">
        <strong className="text-[13px] text-white">VIP</strong>desde {formatearCantidad(vip)} pts
      </div>
    </div>
  )
}

function Paso({ titulo, texto, ultimo = false, completado = false }) {
  return (
    <div className="relative flex gap-3">
      {!ultimo && <span className="absolute left-[11px] top-[22px] h-[calc(100%+8px)] w-px bg-white/15" />}
      {completado ? (
        <span className="z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-green text-black">
          <Check className="h-3 w-3" />
        </span>
      ) : (
        <span className="z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-white/25 bg-[#0b0b0c]" />
      )}
      <span className={`flex flex-col gap-0.5 text-xs ${ultimo ? '' : 'pb-4'} ${completado ? '' : 'text-white/50'}`}>
        <strong className={`text-[13px] ${completado ? 'text-green' : 'text-white/80'}`}>{titulo}</strong>
        {completado ? <span className="text-white/60">{texto}</span> : texto}
      </span>
    </div>
  )
}

function Nota({ children }) {
  return (
    <div className="mt-8 flex gap-2.5 rounded-[10px] border border-dashed border-white/15 bg-white/[0.03] p-4 text-[13px] leading-relaxed text-white/60">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
      <span>{children}</span>
    </div>
  )
}

export default function ComoGanasPuntosYSellos({ programa, heredado, reducirMovimiento, retrasoMs }) {
  const activo = programa.estado === 'ok' && programa.activo === true && programa.reglas
  const apagado = programa.estado === 'ok' && programa.activo === false
  const reglas = programa.reglas
  const { cfg, umbrales, sellosMeta } = heredado

  const puntosPorDia = cfg ? Number(cfg.puntos_por_visita) : null
  const solesPorPunto = cfg && Number(cfg.puntos_por_sol_gastado) > 0 ? Math.round(1 / Number(cfg.puntos_por_sol_gastado)) : null

  return (
    <section
      aria-labelledby="citas-como-ganas-titulo"
      className={`mt-8 rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:p-8 ${
        reducirMovimiento ? '' : 'in-up'
      }`}
      style={reducirMovimiento ? undefined : { animationDelay: `${retrasoMs}ms` }}
    >
      <h2 id="citas-como-ganas-titulo" className="lw-titulo-heavitas text-xl uppercase">
        {activo ? 'Cómo ganas monedas y sellos' : 'Cómo ganas puntos y sellos'}
      </h2>
      <p className="mt-1.5 text-[13px] text-white/50">Así funciona tu tarjeta de fidelización en Jaise.</p>

      {programa.estado === 'cargando' && (
        <p aria-busy="true" className="mt-6 text-[13px] text-white/50">
          Cargando las reglas del programa…
        </p>
      )}

      {programa.estado === 'error' && (
        <div className="mt-6">
          <AvisoError
            titulo="No pudimos cargar las reglas del programa"
            texto="No mostramos tasas ni beneficios hasta poder leerlos; así evitamos decirte algo que no es. Inténtalo de nuevo."
            onReintentar={programa.recargar}
          />
        </div>
      )}

      {apagado && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-8 divide-y divide-white/10 lg:grid-cols-3 lg:gap-10 lg:divide-y-0">
            <Caja>
              <Titulo icono={Sparkles}>Puntos</Titulo>
              {puntosPorDia !== null ? (
                <>
                  <P>
                    <B>
                      {formatearCantidad(puntosPorDia)} {puntosPorDia === 1 ? 'punto' : 'puntos'}
                    </B>{' '}
                    por cada día que te atiendes.
                  </P>
                  {solesPorPunto !== null && (
                    <P>
                      1 punto por cada <B>S/ {solesPorPunto}</B> que pagas en servicios.
                    </P>
                  )}
                </>
              ) : (
                <P>No pudimos leer ahora cuántos puntos suma cada visita. Tus puntos reales los ves en Recompensas.</P>
              )}
              {umbrales && (
                <>
                  <P>Con más puntos sube tu tarjeta de nivel:</P>
                  <Niveles premium={umbrales.premium} vip={umbrales.vip} />
                </>
              )}
            </Caja>

            <Caja>
              <Titulo icono={Stamp}>Sellos</Titulo>
              <P>
                <B>1 sello por día</B> que te atiendes, aunque ese día tengas varias citas a distintas horas.
              </P>
              <P>
                {sellosMeta ? (
                  <>
                    Al juntar <B>{sellosMeta} sellos</B> puedes generar un <B>cupón de fidelidad</B> desde Recompensas y usarlo al pagar
                    en caja.
                  </>
                ) : (
                  <>
                    Al completar tu tarjeta de sellos puedes generar un <B>cupón de fidelidad</B> desde Recompensas y usarlo al pagar en
                    caja.
                  </>
                )}
              </P>
              <P>
                El canje de recompensas por cupones se activará próximamente; mientras tanto puedes ver el catálogo en{' '}
                <Link to="/recompensas?seccion=canje" className="font-semibold text-[var(--lw-gold)] underline underline-offset-2">
                  Recompensas
                </Link>
                .
              </P>
              {sellosMeta && (
                <P>
                  Cada {sellosMeta} sellos se llena una tarjeta y empieza otra. Los cupones que aún no generaste te siguen esperando.
                </P>
              )}
            </Caja>

            <Caja>
              <Titulo icono={Check}>Cuándo se suman</Titulo>
              <div className="flex flex-col">
                <Paso titulo="Pendiente" texto="Reservaste tu cita. Aún no suma." />
                <Paso titulo="Confirmada" texto="El salón aceptó tu cita. Aún no suma." />
                <Paso
                  completado
                  ultimo
                  titulo="Completada"
                  texto="Te atendimos y se registró en caja: aquí se suman tus puntos y tu sello."
                />
              </div>
            </Caja>
          </div>
          <Nota>
            <strong className="text-white">No suman</strong> las citas canceladas, las citas a las que no asististe ni las compras de
            productos. Si un servicio se anula en caja, se descuentan sus puntos y su sello.
          </Nota>
        </>
      )}

      {activo && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-8 divide-y divide-white/10 lg:grid-cols-3 lg:gap-10 lg:divide-y-0">
            <Caja>
              <Titulo icono={Sparkles}>Monedas y nivel</Titulo>
              <P>
                <B>{textoTasa(reglas.tasaServ)}</B> en servicios.
              </P>
              <P>
                <B>{textoTasa(reglas.tasaProd)}</B> en productos.
              </P>
              <P>
                Se calculan sobre el importe neto que pagas, después de descuentos y cupones. Gastar monedas no baja tu nivel: este
                depende de tu <B>clasificación</B> acumulada.
              </P>
              <Niveles premium={reglas.umbralPremium} vip={reglas.umbralVip} />
              <P>Los niveles se miden en puntos de clasificación, no en monedas.</P>
            </Caja>

            <Caja>
              <Titulo icono={Stamp}>Sellos</Titulo>
              <P>
                <B>1 sello por día de Perú</B> en que se confirma una venta que incluye servicios, venga o no de una cita web. Los
                productos solos no dan sello.
              </P>
              <P>
                Al juntar <B>{reglas.sellosPorPremio} sellos</B> canjeas un premio de sellos desde{' '}
                <Link to="/recompensas?seccion=sellos" className="font-semibold text-[var(--lw-gold)] underline underline-offset-2">
                  Recompensas
                </Link>
                . Guardas hasta {reglas.sellosMax} sellos.
              </P>
              <P>Los premios y sus beneficios son los del catálogo vigente; los ves en «Mis sellos».</P>
            </Caja>

            <Caja>
              <Titulo icono={Check}>Cuándo se suman</Titulo>
              <div className="flex flex-col">
                <Paso titulo="Pendiente" texto="Reservaste tu cita. Aún no suma." />
                <Paso titulo="Confirmada" texto="El salón aceptó tu cita. Aún no suma." />
                <Paso titulo="Atendida" texto="Completar la atención no suma por sí sola: falta confirmar el cobro." />
                <Paso
                  completado
                  ultimo
                  titulo="Venta confirmada"
                  texto="Se acreditan tus monedas y, si la venta incluyó servicios, tu sello."
                />
              </div>
            </Caja>
          </div>
          <Nota>
            <strong className="text-white">No suman</strong> las citas canceladas ni a las que no asististe. Si una venta se anula, se
            revierten sus monedas y su sello; tu saldo de monedas puede quedar en negativo hasta compensarlo con nuevas compras.
          </Nota>
        </>
      )}
    </section>
  )
}
