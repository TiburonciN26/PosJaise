import { Link } from 'react-router-dom'
import { Encabezado, AvisoError, Cargando } from './ui.jsx'
import { REGLA_CUPONES, REGLA_MONEDAS, REGLA_PROTECCION } from './lib.js'
import { formatearCantidad, reglaSellos, textoTasa } from '../../../lib/programaRecompensas.js'

// Programa activo: las cifras salen de las reglas vigentes (recompensas_reglas_publicas()), nunca del código.
const PASOS_ACTIVO = [
  ['Compras y reservas', 'Usa tu cuenta al reservar y comprar para que todo quede vinculado a ti.'],
  ['Sumas monedas y sellos', 'Las monedas salen del importe neto de tu compra confirmada. El sello, de una venta confirmada con servicios, venga o no de una cita web.'],
  ['Canjeas por un cupón', 'Eliges un premio y gastas tus monedas (o tus sellos). Obtienes un cupón con su código.'],
  ['Usas el cupón', 'En una compra posterior lo aplicas y se descuenta el beneficio, según sus condiciones.'],
]

const CONDICIONES_ACTIVO = [
  'La compra está vinculada a tu cuenta.',
  'Cuenta el importe neto elegible: lo que pagas después de descuentos y cupones.',
  'Se acredita cuando la venta queda confirmada: reservar o completar una atención por sí solos no suman.',
  'No dan monedas: envío, recargos, partidas gratuitas ni compras anuladas.',
  'Una misma operación nunca da monedas dos veces.',
]

// Programa apagado: solo lo que rige hoy y un aviso claro de qué pertenece al programa nuevo. No se anuncia ninguna tasa, umbral ni
// beneficio del programa nuevo mientras no esté activo.
const PASOS_APAGADO = [
  ['Compras y reservas', 'Usa tu cuenta al reservar y comprar para que todo quede vinculado a ti.'],
  ['Sumas puntos y sellos', 'Los puntos salen de los servicios que te atendemos. Los sellos, de los días en que te atendemos.'],
  ['Canjeas por un cupón', 'Cuando se active el canje, eliges una recompensa y obtienes un cupón con su código.'],
  ['Usas el cupón', 'En una compra posterior lo aplicas y se descuenta el beneficio, según sus condiciones.'],
]

function Pasos({ pasos }) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
      {pasos.map(([titulo, texto], i) => (
        <div key={titulo} className="liquid-glass flex flex-col gap-2 rounded-none p-5">
          <span className="text-[28px] font-bold text-[var(--lw-gold)]">{i + 1}</span>
          <strong className="text-white">{titulo}</strong>
          <span className="text-[13px] leading-relaxed text-white/60">{texto}</span>
        </div>
      ))}
    </div>
  )
}

function Bloque({ titulo, children }) {
  return (
    <div className="liquid-glass flex flex-col gap-2.5 rounded-none p-6">
      <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">{titulo}</span>
      {children}
    </div>
  )
}

// Cómo funciona — texto explicativo del programa. `programa` viene de useProgramaRecompensas(): { estado, activo, reglas, recargar }.
//   · cargando → no se muestra ninguna cifra;
//   · error    → aviso con reintento (no se muestra una tasa de reemplazo);
//   · apagado  → solo lo vigente y el aviso del programa nuevo;
//   · activo   → tasas, umbrales y sellos de la configuración vigente.
export default function SeccionComo({ programa }) {
  const reglas = programa.reglas
  return (
    <section className="flex flex-col gap-6">
      <Encabezado titulo="Cómo funciona Club Jaise" texto="En cuatro pasos." />

      {programa.estado === 'cargando' && <Cargando />}

      {programa.estado === 'error' && (
        <AvisoError
          titulo="No pudimos cargar las reglas del programa"
          texto="No mostramos tasas ni beneficios hasta poder leerlos; así evitamos decirte algo que no es. Inténtalo de nuevo."
          onReintentar={programa.recargar}
        />
      )}

      {programa.estado === 'ok' && !programa.activo && (
        <>
          <Pasos pasos={PASOS_APAGADO} />
          <Bloque titulo="Programa de monedas y sellos">
            <p role="status" className="text-sm leading-relaxed text-white/80">
              El programa nuevo de monedas, clasificación y sellos todavía no está activo. Mientras tanto siguen rigiendo tus
              puntos y sellos actuales. Cuando se active, aquí verás sus tasas, niveles y reglas vigentes.
            </p>
          </Bloque>
        </>
      )}

      {programa.estado === 'ok' && programa.activo && reglas && (
        <>
          <Pasos pasos={PASOS_ACTIVO} />

          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
            <div className="liquid-glass flex flex-col gap-3.5 rounded-none p-6">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Cómo se ganan las monedas</span>
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-1.5 border-b border-white/10 pb-2.5">
                  <span className="font-semibold text-white">Servicios</span>
                  <strong className="text-lg text-white">{textoTasa(reglas.tasaServ)}</strong>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                  <span className="font-semibold text-white">Productos</span>
                  <strong className="text-lg text-white">{textoTasa(reglas.tasaProd)}</strong>
                </div>
              </div>
              <p className="text-[13px] leading-relaxed text-white/60">
                Las tasas son sobre el importe neto que pagas. Las compras pequeñas también acumulan avance: no se pierden las
                fracciones entre compras.
              </p>
            </div>

            <Bloque titulo="Condiciones para sumar">
              <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] leading-snug text-white/80">
                {CONDICIONES_ACTIVO.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Bloque>
          </div>

          <Bloque titulo="Monedas y nivel">
            <p className="text-sm leading-relaxed text-white/80">
              Tus <strong className="text-white">monedas disponibles</strong> son las que puedes gastar en premios. Tu{' '}
              <strong className="text-white">clasificación</strong> es aparte: es lo que has acumulado en compras confirmadas y
              define tu nivel — Básico desde 0, Premium desde {formatearCantidad(reglas.umbralPremium)} y VIP desde {formatearCantidad(reglas.umbralVip)} puntos de
              clasificación. Gastar monedas no baja tu nivel ni tu avance.
            </p>
          </Bloque>

          <Bloque titulo="Si anulan una compra">
            <p className="text-sm leading-relaxed text-white/80">
              Se revierten las monedas y, si corresponde, el sello que esa compra te dio, y lo verás en «Movimientos». Solo una
              compra anulada puede restar de tu clasificación. Si usaste un cupón en esa compra, se rehabilita según sus
              condiciones. Si el ajuste deja tu saldo de monedas en negativo, lo verás claro y no podrás canjear hasta
              compensarlo con nuevas compras; no es una deuda de dinero y no impide comprar ni reservar.
            </p>
          </Bloque>

          <Bloque titulo="Reglas del programa">
            <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] leading-snug text-white/80">
              <li>{REGLA_MONEDAS}</li>
              <li>{REGLA_CUPONES}</li>
              <li>Cada cupón indica a qué se aplica (servicios, productos o ambos), su compra mínima, su vigencia y, si tiene, su límite de canjes.</li>
              <li>{REGLA_PROTECCION}</li>
              <li>{reglaSellos(reglas)}</li>
              <li>Los premios de sellos y sus beneficios son los que ves en «Mis sellos»; pueden cambiar.</li>
            </ul>
          </Bloque>
        </>
      )}

      <div>
        <Link
          to="/recompensas?seccion=canje"
          className="inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
        >
          Ver recompensas
        </Link>
      </div>
    </section>
  )
}
