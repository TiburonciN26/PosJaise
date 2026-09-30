import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'

// "Counter" real de React Bits — esta vez SÍ es un port fiel del código
// real (no una reconstrucción a ciegas como el primer intento): se
// encontró vía el registro `@react-bits` ya configurado en
// components.json, consultable con las herramientas MCP de shadcn
// (`npx shadcn view @react-bits/Counter-JS-TW`) — reactbits.dev en sí no
// tiene MCP propio, pero distribuye sus componentes por el protocolo de
// registro de shadcn, que sí estaba conectado.
//
// Cambios sobre el original, todos deliberados:
// - `motion/react` → `framer-motion`: el proyecto ya tiene instalado
//   `framer-motion` (no el paquete `motion` nuevo) — mismos hooks
//   (`useSpring`/`useTransform`), solo cambia de dónde se importan.
// - Prop `value` (número crudo) → `valor` + `decimales` nuevo: el
//   original calcula sus `places` por default a partir de
//   `value.toString()`, que en JS le recorta los ceros finales
//   (`(45).toString()` da `"45"`, nunca `"45.00"`) — para montos en
//   soles eso da un ancho inconsistente (a veces con decimales, a veces
//   sin). `calcularPlaces()` fuerza siempre la misma cantidad de
//   decimales, sea cual sea el valor.
// - Se sacaron las props de estilo que no hacían falta para este uso
//   (gradientes de desvanecido arriba/abajo, `containerStyle` a medida,
//   etc.) — la mecánica real (el resorte por dígito + el truco de
//   "camino más corto" al dar la vuelta de 9 a 0) se mantiene intacta,
//   que es la parte que de verdad valía la pena traer fiel.
function FilaDigito({ resorte, numero, alto }) {
  const y = useTransform(resorte, (ultimo) => {
    const valorEnPosicion = ultimo % 10
    const offset = (10 + numero - valorEnPosicion) % 10
    let memo = offset * alto
    // Camino más corto: sin esto, pasar de 9 a 0 se vería "girar hacia
    // atrás" 9 pasos en vez de avanzar 1 — mismo truco que ya trae el
    // componente real.
    if (offset > 5) memo -= 10 * alto
    return memo
  })

  return (
    <motion.span className="absolute inset-0 flex items-center justify-center" style={{ y }}>
      {numero}
    </motion.span>
  )
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
  const valorEnPosicion = esPunto ? 0 : valorRedondeadoAPosicion(valor, posicion)
  const valorAnimado = useSpring(valorEnPosicion, { stiffness: 220, damping: 28 })

  useEffect(() => {
    if (!esPunto) valorAnimado.set(valorEnPosicion)
  }, [valorAnimado, valorEnPosicion, esPunto])

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
      {Array.from({ length: 10 }, (_, i) => (
        <FilaDigito key={i} resorte={valorAnimado} numero={i} alto={alto} />
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
