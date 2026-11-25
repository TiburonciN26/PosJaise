// Métodos de pago del POS (botones de «Método de pago» en Ventas y «¿Cómo se pagó el adelanto?» en Citas). Un solo lugar para que
// el nombre (lo que se guarda en la base: ventas.metodo_pago / citas.adelanto_metodo), el ícono y los colores no diverjan.
// Rutas con BASE_URL (no "/icons/..." a secas): Vite no reescribe strings dentro de JSX.
export const METODOS_PAGO = [
  {
    nombre: 'Efectivo',
    nombreCorto: 'Efect.',
    icono: `${import.meta.env.BASE_URL}icons/efectivo.svg`,
    clasesActivo: 'border-green bg-green/10 text-green',
    clasesHover: 'hover:border-green',
  },
  {
    nombre: 'Tarjeta',
    nombreCorto: 'Tarjeta',
    icono: `${import.meta.env.BASE_URL}icons/targueta.svg`,
    clasesActivo: 'border-blue bg-blue/10 text-blue',
    clasesHover: 'hover:border-blue',
  },
  {
    nombre: 'Transferencia',
    nombreCorto: 'Transf.',
    icono: `${import.meta.env.BASE_URL}icons/transferencia.svg`,
    clasesActivo: 'border-gray-300 bg-gray-300/10 text-gray-300',
    clasesHover: 'hover:border-gray-300',
  },
  {
    nombre: 'Yape',
    nombreCorto: 'Yape',
    icono: `${import.meta.env.BASE_URL}icons/yape.svg`,
    clasesActivo: 'border-purple-300 bg-purple-300/10 text-purple-300',
    clasesHover: 'hover:border-purple-300',
  },
]
