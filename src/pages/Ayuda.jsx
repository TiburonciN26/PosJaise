import { useState } from 'react'
import { ArrowBigDown, CircleHelp } from 'lucide-react'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import { UMBRAL_DNI_BOLETA } from '../lib/comprobante.js'

// Preguntas frecuentes de quien cobra y no maneja el tema de comprobantes. Cada respuesta es una lista de párrafos
// (texto plano, para poder buscar en ellos); un párrafo que empieza con «• » se muestra como viñeta.
//
// Reglas que se dan por sentadas (y que la contadora de la clienta debe confirmar):
//  · el negocio está en el régimen MYPE: paga el IGV por todas sus ventas, con o sin boleta o factura;
//  · los plazos de envío a SUNAT son 3 días para facturas y 7 para boletas, contados desde el día siguiente;
//  · el POS no emite ante SUNAT: guarda lo que el comprador pidió y la contadora emite el comprobante legal.
const SECCIONES = [
  {
    titulo: 'Al cobrar',
    preguntas: [
      {
        pregunta: '¿Cuándo uso Boleta y cuándo Factura?',
        respuesta: [
          'Boleta: cuando quien compra es una persona que compra para sí misma. Es lo normal en casi todas las ventas.',
          'Factura: solo si quien compra la pide a nombre de una empresa o negocio con RUC, porque la usa para sus gastos y para recuperar el IGV.',
          'Para quitar la que elegiste, vuelve a tocar el botón.',
        ],
      },
      {
        pregunta: '¿Qué datos pido en una boleta?',
        respuesta: [
          `• Menos de S/ ${UMBRAL_DNI_BOLETA}: ninguno. El documento y el nombre son opcionales.`,
          `• Desde S/ ${UMBRAL_DNI_BOLETA} (total con IGV): el documento del comprador y sus nombres y apellidos. Normalmente es el DNI; si es extranjero, su carné de extranjería o su pasaporte (en la ventana se elige el tipo).`,
          `Con S/ ${UMBRAL_DNI_BOLETA} o más no se puede cobrar con boleta si faltan esos datos.`,
        ],
      },
      {
        pregunta: '¿Qué datos pido en una factura?',
        respuesta: [
          '• RUC de 11 dígitos.',
          '• Razón social: el nombre de la empresa tal como figura en SUNAT.',
          '• Dirección fiscal (opcional).',
          'Pídelos antes de cobrar y repásalos con la persona: un RUC mal escrito obliga a corregir el comprobante.',
        ],
      },
      {
        pregunta: 'Quiere factura pero no tiene RUC',
        respuesta: [
          'Sin RUC no se puede hacer factura. Ofrécele una boleta. Con boleta no podrá usar el IGV como crédito fiscal ni sustentar gasto.',
        ],
      },
      {
        pregunta: '¿Y si el cliente no pide ningún comprobante?',
        respuesta: [
          'Puedes cobrar sin tocar Boleta ni Factura, pero esa venta no sale en la lista que se le pasa a la contadora.',
          'Según SUNAT, toda venta a un consumidor final debe llevar boleta (las menores a S/ 5 pueden agruparse en una boleta resumen al final del día). Habla con tu contadora cómo quieren manejar esas ventas.',
        ],
      },
      {
        pregunta: '¿Es válida la boleta que sale impresa?',
        respuesta: [
          'Es un documento del POS con numeración propia (B-000001 para boletas, F-000001 para facturas) y trae al pie la leyenda de documento de control interno.',
          'El comprobante electrónico legal lo emite la contadora. El del POS no lo reemplaza: al cliente se le envía después, en PDF, por WhatsApp.',
        ],
      },
      {
        pregunta: '¿Por qué piden el celular al hacer boleta o factura?',
        respuesta: [
          'Para enviarle por WhatsApp el PDF oficial del comprobante. El ticket que se lleva al pagar dice en cuánto tiempo le llegará: facturas en 1 día hábil y boletas en 1 a 3 días hábiles.',
          '• Si elegiste un cliente con el botón de cliente y ya tiene celular, se usa ese y no se pide nada.',
          '• Si no elegiste ningún cliente de la base, o el cliente no tiene celular, se pide en la ventana del comprobante (9 dígitos, empieza con 9).',
          'Revisa el número con la persona: si está mal, el PDF no le llegará.',
        ],
      },
      {
        pregunta: 'Se me olvidó tocar Boleta o Factura al cobrar',
        respuesta: [
          'La administradora puede registrarlo después: Historial → abrir la venta → Registrar boleta o Registrar factura. Si no eres administradora, pídeselo a ella.',
        ],
      },
    ],
  },
  {
    titulo: 'Pasar los datos a la contadora',
    preguntas: [
      {
        pregunta: '¿Cómo le paso las boletas y facturas?',
        respuesta: [
          'Entra a Historial, elige el período con los filtros de fecha y descarga el archivo de boletas y facturas: en PC es el ícono de documento de la barra; en el celular, la rueda → Descargar boletas y facturas. Solo la administradora ve esa descarga.',
          'El archivo trae: fecha, código de venta, tipo, número interno, tipo de documento y documento del comprador, nombre o razón social, dirección, celular, detalle de lo vendido, subtotal, descuento, Op. gravada, IGV, total, método de pago y estado (pendiente o emitida).',
        ],
      },
      {
        pregunta: '¿Cada cuánto se lo paso? (plazos)',
        respuesta: [
          'Según SUNAT, las facturas deben enviarse dentro de 3 días y las boletas dentro de 7 días, contados desde el día siguiente a la venta.',
          '• Facturas: pásalas el mismo día o al siguiente.',
          '• Boletas: al menos cada 2 o 3 días.',
          'Si pasa más tiempo, la contadora emite fuera de plazo y puede haber multas. Mientras no llegue la factura de la contadora, el documento del POS no le sirve a la empresa para su crédito fiscal. Confirma los plazos con tu contadora.',
        ],
      },
      {
        pregunta: '¿Qué significan «Pendiente de emitir» y «Emitida»?',
        respuesta: [
          'Pendiente (etiqueta ámbar en el Historial): se pidió boleta o factura y la contadora todavía no la emitió.',
          'Emitida (etiqueta verde): la contadora ya la emitió.',
          'La administradora la marca así en Historial → abrir la venta → Marcar emitida, y puede escribir el número que le dio la contadora. Con Volver a pendiente se deshace.',
        ],
      },
      {
        pregunta: 'La contadora ya emitió: ¿cómo marco muchas de una vez?',
        respuesta: [
          'No necesita cuenta en el POS. Pídele que te devuelva el mismo archivo que le descargaste, con la columna numero_emitido llena (por ejemplo B001-1234) en cada venta que ya emitió.',
          'Luego, la administradora entra a Historial y toca el ícono de subir (en PC) o la rueda → Importar números emitidos (en celular) y elige ese archivo. Todas las ventas con número quedan como Emitidas; el aviso dice cuántas se marcaron y cuáles no se encontraron.',
          'Solo se marcan las que estaban pendientes: las que ya estaban emitidas no se tocan.',
        ],
      },
      {
        pregunta: '¿Cómo le mando el PDF oficial al cliente por WhatsApp?',
        respuesta: [
          'La administradora entra a Historial, abre la venta y toca Adjuntar PDF oficial (el PDF que le dio la contadora, de hasta 5 MB). Después toca Enviar por WhatsApp.',
          'Se abre WhatsApp con el chat del cliente y un mensaje listo con un enlace seguro al PDF; solo falta tocar enviar. El enlace funciona por 30 días.',
          'Si dice sin celular, toca Editar datos y escríbelo. Con Cambiar PDF se reemplaza un archivo equivocado.',
        ],
      },
      {
        pregunta: 'Me equivoqué en el RUC, el documento o el nombre',
        respuesta: [
          'La administradora lo corrige mientras esté pendiente: Historial → abrir la venta → Editar datos. Si ya estaba emitida, primero Volver a pendiente, y avisa a la contadora para que corrija el comprobante legal.',
        ],
      },
      {
        pregunta: 'Se anuló una venta que tenía boleta o factura',
        respuesta: [
          'Una venta anulada ya no sale en la lista para la contadora. Si ella ya había emitido el comprobante legal, avísale para que lo anule.',
        ],
      },
    ],
  },
  {
    titulo: 'IGV (18 %)',
    preguntas: [
      {
        pregunta: '¿Pierdo el 18 % cuando es boleta?',
        respuesta: [
          'No. Como MYPE, el IGV que va incluido en tus precios lo declaras y pagas a SUNAT por todas tus ventas, con boleta, con factura o sin comprobante. Es el mismo monto.',
          'Lo que cambia es del lado de quien compra: con factura, la empresa usa ese IGV como crédito fiscal y sustenta su gasto; con boleta no puede.',
          'El 18 % es 16 % de IGV más 2 % de IPM. El POS supone que todo lleva IGV: si algún producto o servicio fuera exonerado, avísale a tu contadora.',
        ],
      },
      {
        pregunta: '¿Qué IGV recupero yo?',
        respuesta: [
          'El de tus compras. Cuando compras insumos, productos para vender o servicios para el salón y pides la factura a nombre de tu RUC, ese IGV se resta del que debes pagar por tus ventas.',
          'Con boleta no se puede. Por eso, al comprar, pide siempre factura con tu RUC.',
        ],
      },
    ],
  },
]

// Sin tildes ni mayúsculas, para que «boleta», «Boleta» y «bóleta» encuentren lo mismo.
const normalizar = (texto) =>
  String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

function coincide(item, consulta) {
  if (!consulta) return true
  return normalizar(`${item.pregunta} ${item.respuesta.join(' ')}`).includes(consulta)
}

function Pregunta({ item, abierta, onAlternar }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierta}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <span className={`text-sm font-medium transition-colors duration-300 ${abierta ? 'text-amber' : 'text-ink'}`}>
          {item.pregunta}
        </span>
        <ArrowBigDown
          className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${abierta ? 'rotate-180' : ''}`}
        />
      </button>
      <CampoColapsable abierto={abierta}>
        <div className="space-y-2 px-3 pb-3 text-sm text-ink/80">
          {item.respuesta.map((parrafo) =>
            parrafo.startsWith('• ') ? (
              <p key={parrafo} className="pl-3 -indent-3">
                {parrafo}
              </p>
            ) : (
              <p key={parrafo}>{parrafo}</p>
            ),
          )}
        </div>
      </CampoColapsable>
    </div>
  )
}

export default function Ayuda() {
  const [busqueda, setBusqueda] = useState('')
  const [abiertas, setAbiertas] = useState(() => new Set())
  const consulta = normalizar(busqueda.trim())

  function alternar(pregunta) {
    setAbiertas((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(pregunta)) siguiente.delete(pregunta)
      else siguiente.add(pregunta)
      return siguiente
    })
  }

  const secciones = SECCIONES.map((seccion) => ({
    ...seccion,
    preguntas: seccion.preguntas.filter((item) => coincide(item, consulta)),
  })).filter((seccion) => seccion.preguntas.length > 0)

  return (
    <div className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      <div className="flex items-center gap-2 pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar en las preguntas frecuentes..."
          tema="amber"
          sinBorde
          sinVoz
        />
      </div>

      <p className="mt-1 text-xs text-ink/60">
        Preguntas frecuentes sobre boletas, facturas y cómo pasarle los datos a la contadora. Orientan el uso del POS y no
        reemplazan la asesoría de tu contadora.
      </p>

      {secciones.length === 0 ? (
        <EstadoVacio icono={CircleHelp} mensaje="No encontramos preguntas con esas palabras." />
      ) : (
        secciones.map((seccion) => (
          <section key={seccion.titulo} className="mt-5">
            <h2 className="mb-1.5 font-mono text-xs uppercase tracking-wider text-ink/60">{seccion.titulo}</h2>
            <div className="rounded-lg border border-border bg-bg">
              {seccion.preguntas.map((item) => (
                <Pregunta
                  key={item.pregunta}
                  item={item}
                  abierta={abiertas.has(item.pregunta)}
                  onAlternar={() => alternar(item.pregunta)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
