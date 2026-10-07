// Colores/variables por nivel — recreación de la referencia animada que
// trajo el usuario ("Niveles de Tarjeta Rewards"). Básico = plata,
// Premium = oro, VIP = diamante (mismo orden que los cupones:
// Plata < Oro < Diamante). Nombres reales del programa: mis_puntos().
export const NIVELES_PUNTOS = {
  BASICO: {
    etiqueta: 'BÁSICO',
    vars: {
      '--tp-g': 'linear-gradient(135deg,#6f757b 0%,#b9bec4 18%,#f4f6f8 34%,#8e949a 50%,#dde1e5 66%,#747a80 84%,#c8cdd2 100%)',
      '--tp-gb': 'linear-gradient(225deg,#6f757b 0%,#b9bec4 18%,#f4f6f8 34%,#8e949a 50%,#dde1e5 66%,#747a80 84%,#c8cdd2 100%)',
      '--tp-ink': '#25292d',
      '--tp-inkhi': 'rgba(255,255,255,.6)',
      '--tp-glow': 'rgba(210,216,222,.16)',
      '--tp-franja': 'linear-gradient(180deg,#1c1f22,#3a3f44 50%,#1c1f22)',
      '--tp-iri': 0,
    },
  },
  PREMIUM: {
    etiqueta: 'PREMIUM',
    vars: {
      '--tp-g': 'linear-gradient(135deg,#6e5214 0%,#c9a24a 18%,#f6e1a1 34%,#b48a2e 50%,#e9c874 66%,#8c6a1c 84%,#d9b660 100%)',
      '--tp-gb': 'linear-gradient(225deg,#6e5214 0%,#c9a24a 18%,#f6e1a1 34%,#b48a2e 50%,#e9c874 66%,#8c6a1c 84%,#d9b660 100%)',
      '--tp-ink': '#3b2a06',
      '--tp-inkhi': 'rgba(255,240,195,.55)',
      '--tp-glow': 'rgba(233,200,116,.18)',
      '--tp-franja': 'linear-gradient(180deg,#2a1d04,#4a3509 50%,#2a1d04)',
      '--tp-iri': 0,
    },
  },
  VIP: {
    etiqueta: 'VIP',
    vars: {
      '--tp-g': 'linear-gradient(135deg,#8ea6bd 0%,#cfe2f3 18%,#ffffff 34%,#a9c3da 50%,#eaf4ff 66%,#93adc6 84%,#d8e8f7 100%)',
      '--tp-gb': 'linear-gradient(225deg,#8ea6bd 0%,#cfe2f3 18%,#ffffff 34%,#a9c3da 50%,#eaf4ff 66%,#93adc6 84%,#d8e8f7 100%)',
      '--tp-ink': '#1b2a3b',
      '--tp-inkhi': 'rgba(255,255,255,.7)',
      '--tp-glow': 'rgba(190,225,255,.22)',
      '--tp-franja': 'linear-gradient(180deg,#132030,#2c4560 50%,#132030)',
      '--tp-iri': 0.55,
    },
  },
}
