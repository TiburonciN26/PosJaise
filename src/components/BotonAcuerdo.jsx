import { Handshake } from 'lucide-react'

// «La manito»: confirmar que dos personas llegaron a un acuerdo (discrepancia de una atención en Mis atenciones). Es un botón de ícono
// con tres estados visibles, para que se entienda de un vistazo en qué punto está el acuerdo:
//   · 'pendiente' — nadie confirmó: ícono celeste con saludo suave; se puede pulsar.
//   · 'parcial'   — una parte confirmó: verde con latido. Si ya confirmé YO no hace nada más (`yaConfirme`); si confirmó la
//                   otra, el botón sigue activo para que confirme yo también.
//   · 'resuelto'  — las dos confirmaron: verde sólido, con «pop», sin acción.
export default function BotonAcuerdo({ estado, yaConfirme = false, ocupado = false, conTextoPc = false, onClick }) {
  const resuelto = estado === 'resuelto'
  const parcial = estado === 'parcial'
  const deshabilitado = resuelto || ocupado || (parcial && yaConfirme)

  const etiqueta = resuelto
    ? 'Acuerdo confirmado por ambas partes'
    : parcial && yaConfirme
      ? 'Acuerdo enviado: falta la otra parte'
      : 'Confirmar que llegaron a un acuerdo'

  // `conTextoPc`: en PC (lg) el botón se alarga en píldora y dice qué hace («Confirmar acuerdo» / «Acuerdo enviado»).
  const textoPc = resuelto ? 'Acuerdo confirmado' : parcial && yaConfirme ? 'Acuerdo enviado' : 'Confirmar acuerdo'

  const clases = resuelto
    ? 'border-green bg-green text-bg animate-manito-pop'
    : parcial
      ? `border-green bg-green/15 text-green ${yaConfirme ? 'animate-manito-pulso' : ''}`
      : 'border-blue/60 bg-blue/10 text-blue hover:border-blue hover:bg-blue/20'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      title={etiqueta}
      aria-label={etiqueta}
      aria-pressed={resuelto || (parcial && yaConfirme)}
      className={`flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-default ${
        conTextoPc ? 'lg:w-auto lg:gap-1.5 lg:px-3' : ''
      } ${clases}`}
    >
      <Handshake
        aria-hidden="true"
        className={`h-5 w-5 ${estado === 'pendiente' && !ocupado ? 'animate-manito-saludo origin-bottom' : ''}`}
      />
      {conTextoPc && <span className="text-xs font-medium max-lg:hidden">{textoPc}</span>}
    </button>
  )
}
