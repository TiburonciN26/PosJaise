// Pago con tarjeta (Culqi) en el navegador.
//
// El formulario de Culqi (Checkout Custom) tokeniza la tarjeta: los datos de la
// tarjeta van de la clienta a Culqi y NUNCA pasan por nuestro código ni por
// Supabase. Aquí solo se recibe un token de un solo uso (`tkn_…`). Quien cobra
// es la Edge Function `crear-cargo`, con la llave privada, y el monto lo lee
// del pedido en el servidor: lo que mande el navegador no decide cuánto se cobra.
//
// Solo se usa la llave PÚBLICA (VITE_CULQI_PUBLIC_KEY); no puede cobrar.

const URL_SCRIPT = 'https://js.culqi.com/checkout-js'
const LLAVE_PUBLICA = import.meta.env.VITE_CULQI_PUBLIC_KEY

// Sin llave pública (p. ej. un build sin la variable) el método Tarjeta no se ofrece.
export const culqiConfigurado = Boolean(LLAVE_PUBLICA)

let cargaScript = null

function cargarScript() {
  if (window.CulqiCheckout) return Promise.resolve()
  if (!cargaScript) {
    cargaScript = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = URL_SCRIPT
      script.async = true
      script.onload = () =>
        window.CulqiCheckout ? resolve() : reject(new Error('No pudimos iniciar el formulario de pago.'))
      script.onerror = () => {
        cargaScript = null
        reject(new Error('No pudimos cargar el formulario de pago. Revisa tu conexión e inténtalo de nuevo.'))
      }
      document.head.appendChild(script)
    })
  }
  return cargaScript
}

// Adelanta la descarga del script al elegir "Tarjeta" para que abrir el
// formulario sea inmediato. Si falla, se reintenta al pagar.
export function precargarCulqi() {
  if (culqiConfigurado) cargarScript().catch(() => {})
}

// Abre el formulario de tarjeta. Si la clienta lo cierra sin pagar no pasa
// nada (no hay callback). Con un token válido llama a `onToken(tokenId)`.
export async function abrirCheckoutCulqi({ titulo, montoCentavos, email, onToken, onError }) {
  if (!culqiConfigurado) throw new Error('El pago con tarjeta no está disponible todavía.')
  await cargarScript()

  const config = {
    settings: { title: titulo, currency: 'PEN', amount: montoCentavos },
    client: { email },
    options: {
      lang: 'es',
      modal: true,
      installments: false,
      // Solo tarjeta: Yape/Plin siguen siendo los métodos manuales de la tienda.
      paymentMethods: { tarjeta: true, yape: false, billetera: false, bancaMovil: false, agente: false, cuotealo: false },
    },
    appearance: { theme: 'default', buttonCardPayText: 'Pagar' },
  }

  const culqi = new window.CulqiCheckout(LLAVE_PUBLICA, config)
  culqi.culqi = () => {
    if (culqi.token) {
      const tokenId = culqi.token.id
      culqi.close()
      onToken(tokenId)
    } else if (culqi.error) {
      // El formulario sigue abierto para que la clienta corrija o pruebe otra tarjeta.
      console.error('Culqi error', culqi.error)
      const detalle = culqi.error.user_message || culqi.error.merchant_message
      onError(
        detalle ||
          `No pudimos validar tu tarjeta.${import.meta.env.DEV ? ` [${culqi.error.code ?? culqi.error.type ?? 'sin código'}]` : ''}`,
      )
    }
  }
  culqi.open()
}

// Pide al servidor que cobre el pedido con el token. Lanza Error con el
// mensaje que ve la clienta si el cobro no se hace.
export async function cobrarPedidoConTarjeta(supabase, pedidoId, tokenId) {
  const { data, error } = await supabase.functions.invoke('crear-cargo', {
    body: { pedido_id: pedidoId, token_id: tokenId },
  })
  if (error) {
    let mensaje = null
    try {
      mensaje = (await error.context.json()).error
    } catch {
      // respuesta sin JSON: se usa el mensaje genérico
    }
    throw new Error(mensaje || 'No pudimos procesar el pago.')
  }
  return data
}
