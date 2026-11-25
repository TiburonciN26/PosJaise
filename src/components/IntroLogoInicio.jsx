import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Duración total de la coreografía (ver .intro-logo-inicio en styles/21-portal-ajustes.css): el logo aparece, las dos
// mitades salen volando hacia los lados y el fondo se disuelve dejando ver Inicio. Un poco más que la última animación.
export const DURACION_INTRO_INICIO_MS = 2300
// Cuánto esperan los bloques del hero antes de armarse: arrancan cuando el fondo del intro ya se está abriendo, para que su
// entrada se vea y no ocurra tapada.
export const DESFASE_HERO_INTRO_MS = 900

// Intro del logo al cargar Inicio (antes vivía en el login). Se muestra UNA vez por carga de la página —no cada vez que se
// vuelve a Inicio navegando— y no se muestra con «reducir movimiento». La decisión la toma InicioCliente (useIntroInicio),
// porque el hero necesita el mismo dato para desfasar su propia entrada.
//
// Va portado a `.landing-web` del portal (no a document.body: ahí no existen las variables del portal; ni dentro de la
// página: <main> tiene overflow-hidden y recortaría un `fixed`), mismo patrón que BarraTuCitaFlotante.
export default function IntroLogoInicio({ onTermino }) {
  const [destino, setDestino] = useState(null)

  useLayoutEffect(() => {
    setDestino(document.querySelector('.landing-web'))
  }, [])

  useEffect(() => {
    const temporizador = setTimeout(onTermino, DURACION_INTRO_INICIO_MS)
    return () => clearTimeout(temporizador)
  }, [onTermino])

  if (!destino) return null
  return createPortal(
    <div className="intro-logo-inicio" aria-hidden="true">
      <div className="intro-logo-inicio__marca">
        <span className="intro-logo-inicio__nombre">
          JAISE<span className="intro-logo-inicio__grado">˚</span>
        </span>
        <span className="intro-logo-inicio__academia">BEAUTY ACADEMY</span>
      </div>
    </div>,
    destino,
  )
}
