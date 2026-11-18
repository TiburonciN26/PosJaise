import { useLayoutEffect, useRef } from 'react'

// "Counter" de React Bits (registro `@react-bits`, `npx shadcn view @react-bits/Counter-JS-TW`): cada dígito es una columna
// 0–9 que rueda hasta el valor nuevo con un resorte, y da la vuelta de 9 a 0 por el camino más corto.
//
// El original lo anima con `useSpring`/`useTransform` de framer-motion. Aquí el resorte es propio (unas 30 líneas): este
// componente era, junto a un `motion.div` de Nosotros, lo único que usaba framer-motion, y por eso los dos carritos cargaban
// ~123 kB de librería (≈40 kB comprimidos). Se conserva la mecánica tal cual:
// - mismo resorte: rigidez 220, amortiguación 28, masa 1 (casi crítico: llega sin rebote visible);
// - si el valor cambia a mitad de camino, sigue desde la posición y la velocidad que llevaba (no reinicia);
// - mismo cálculo de desplazamiento por fila y mismo truco de «camino más corto».
// Diferencias deliberadas: el resorte termina cuando está a menos de 0,005 dígitos del destino (framer cortaba a 0,5 en saltos
// grandes y remataba con un pequeño brinco), y con «reducir movimiento» activado en el sistema el número cambia sin rodar,
// como el resto de animaciones del portal.
//
// Cambios sobre el componente original que ya venían de antes:
// - Prop `value` (número crudo) → `valor` + `decimales`: el original calcula sus `places` a partir de `value.toString()`,
//   que recorta los ceros finales (`(45).toString()` da `"45"`, nunca `"45.00"`) — para montos en soles eso da un ancho
//   inconsistente. `calcularPlaces()` fuerza siempre la misma cantidad de decimales.
// - Sin las props de estilo que no hacían falta aquí (gradientes de desvanecido, `containerStyle`, etc.).
const RIGIDEZ = 220
const AMORTIGUACION = 28
// Paso fijo de integración: con pasos de 1/240 s el resultado no depende de los Hz de la pantalla.
const PASO_S = 1 / 240
// Tope por cuadro: al volver de una pestaña en segundo plano el resorte continúa, no salta.
const MAX_CUADRO_S = 0.064
const REPOSO_DISTANCIA = 0.005
const REPOSO_VELOCIDAD = 0.01

const consultaReducir =
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

// Coloca las 10 filas (0–9) de una columna para un valor `posicion` que puede estar a mitad de camino entre dos dígitos.
function colocarFilas(filas, posicion, alto) {
  const valorEnPosicion = posicion % 10
  for (let numero = 0; numero < 10; numero += 1) {
    const fila = filas[numero]
    if (!fila) continue
    const offset = (10 + numero - valorEnPosicion) % 10
    let y = offset * alto
    // Camino más corto: sin esto, pasar de 9 a 0 se vería «girar hacia atrás» 9 pasos en vez de avanzar 1.
    if (offset > 5) y -= 10 * alto
    fila.style.transform = `translateY(${y}px)`
  }
}

function normalizarCercanoAEntero(numero) {
  const cercano = Math.round(numero)
  const tolerancia = 1e-9 * Math.max(1, Math.abs(numero))
  return Math.abs(numero - cercano) < tolerancia ? cercano : numero
}

function valorRedondeadoAPosicion(valor, posicion) {
  return Math.floor(normalizarCercanoAEntero(valor / posicion))
}

function Digito({ posicion, valor, alto }) {
  const esPunto = posicion === '.'
  const objetivo = esPunto ? 0 : valorRedondeadoAPosicion(valor, posicion)
  const filasRef = useRef([])
  // Estado del resorte, fuera de React: se escribe directo en el DOM cuadro a cuadro (sin renders).
  const resorteRef = useRef(null)

  // useLayoutEffect: la primera colocación ocurre antes del primer pintado (las filas no se ven apiladas ni un cuadro).
  useLayoutEffect(() => {
    if (esPunto) return undefined
    let resorte = resorteRef.current
    // Al montar no hay animación: el dígito aparece ya en su valor.
    if (!resorte) resorte = resorteRef.current = { pos: objetivo, vel: 0 }

    const enReposo = () =>
      Math.abs(resorte.vel) < REPOSO_VELOCIDAD && Math.abs(objetivo - resorte.pos) < REPOSO_DISTANCIA

    if (consultaReducir?.matches || enReposo()) {
      resorte.pos = objetivo
      resorte.vel = 0
      colocarFilas(filasRef.current, objetivo, alto)
      return undefined
    }

    colocarFilas(filasRef.current, resorte.pos, alto)
    let ultimo = performance.now()
    let cuadro = requestAnimationFrame(function avanzar(ahora) {
      let restante = Math.min(Math.max((ahora - ultimo) / 1000, 0), MAX_CUADRO_S)
      ultimo = ahora
      while (restante > 0) {
        const paso = Math.min(restante, PASO_S)
        resorte.vel += (RIGIDEZ * (objetivo - resorte.pos) - AMORTIGUACION * resorte.vel) * paso
        resorte.pos += resorte.vel * paso
        restante -= paso
      }
      if (enReposo()) {
        resorte.pos = objetivo
        resorte.vel = 0
      } else {
        cuadro = requestAnimationFrame(avanzar)
      }
      colocarFilas(filasRef.current, resorte.pos, alto)
    })
    // Si el valor cambia a mitad de camino, este efecto se relanza y sigue desde `resorte.pos`/`resorte.vel`.
    return () => cancelAnimationFrame(cuadro)
  }, [objetivo, alto, esPunto])

  if (esPunto) {
    return (
      <span className="relative inline-flex items-center justify-center" style={{ height: alto }}>
        .
      </span>
    )
  }

  return (
    <span
      className="relative inline-flex overflow-hidden"
      style={{ height: alto, width: '1ch', fontVariantNumeric: 'tabular-nums' }}
    >
      {Array.from({ length: 10 }, (_, numero) => (
        <span
          key={numero}
          ref={(nodo) => {
            filasRef.current[numero] = nodo
          }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {numero}
        </span>
      ))}
    </span>
  )
}

// Siempre `decimales` dígitos después del punto, sin importar si el
// valor termina en ceros — ver el comentario grande de arriba.
function calcularPlaces(valor, decimales) {
  const parteEntera = Math.max(1, Math.floor(Math.abs(valor)).toString().length)
  const places = Array.from({ length: parteEntera }, (_, i) => 10 ** (parteEntera - 1 - i))
  if (decimales > 0) {
    places.push('.')
    for (let i = 1; i <= decimales; i++) places.push(10 ** -i)
  }
  return places
}

// `tamano` (px) — igual que el `fontSize` del original: la animación
// mueve cada fila `numero * tamano` píxeles, así que tiene que ser un
// NÚMERO, no un string tipo "1em" (un primer intento acá multiplicaba
// por ese string y rompía la cuenta — corregido antes de que llegara a
// verse mal). Se pasa a mano en cada lugar donde se usa Contador, uno
// por cada tamaño de letra real del texto que lo rodea.
export default function Contador({ valor, decimales = 0, tamano = 16, className = '' }) {
  const alto = tamano
  const places = calcularPlaces(valor, decimales)

  return (
    <span className={`inline-flex ${className}`} style={{ lineHeight: 1, fontSize: tamano }}>
      {places.map((posicion, indice) => (
        <Digito key={`${posicion}-${indice}`} posicion={posicion} valor={valor} alto={alto} />
      ))}
    </span>
  )
}
