import { useId, useRef, useState } from 'react'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { listarCambios } from '../lib/cambiosFormulario.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'
import { formatearSoles } from '../lib/moneda.js'
import {
  TIPOS_DOCUMENTO_BOLETA,
  UMBRAL_DNI_BOLETA,
  documentoValido,
  esDocumentoAlfanumerico,
  etiquetaDocumento,
  limpiarDocumento,
  formatearCelular,
  longitudMaximaDocumento,
  normalizarCelular,
  soloDigitos,
} from '../lib/comprobante.js'

const CLASES_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber'

// Datos del comprador para la factura (RUC, razón social, dirección) o para la boleta:
// opcionales debajo del umbral y obligatorios (documento + nombre) desde el umbral.
// En la boleta el documento puede ser DNI, carné de extranjería o pasaporte.
// Celular (para enviar el PDF por WhatsApp): si el cliente elegido en Ventas ya tiene uno (`celularCliente`, 9 dígitos) se usa ese y
// no se pide; si no hay cliente o no tiene celular, se pide aquí.
export default function ModalDatosComprobante({ tipo, inicial, total, dniObligatorio, celularCliente = null, onGuardar, onCerrar }) {
  const panelRef = useRef(null)
  const idBase = useId()
  const esFactura = tipo === 'FACTURA'
  const [tipoDocumento, setTipoDocumento] = useState(esFactura ? 'RUC' : (inicial?.tipoDocumento ?? 'DNI'))
  const [documento, setDocumento] = useState(inicial?.documento ?? '')
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '')
  const [celular, setCelular] = useState(inicial?.celular ?? '')
  const [intento, setIntento] = useState(false)

  useModalA11y(panelRef)

  const documentoOk = documentoValido(tipoDocumento, documento)
  const documentoVacioPermitido = !esFactura && !dniObligatorio && documento === ''
  // Factura: razón social siempre. Boleta: nombre solo desde el umbral.
  const nombreObligatorio = esFactura || dniObligatorio
  const nombreOk = !nombreObligatorio || Boolean(nombre.trim())
  const celularEfectivo = celularCliente ?? normalizarCelular(celular)
  const celularOk = Boolean(celularEfectivo)
  const valido = (documentoOk || documentoVacioPermitido) && nombreOk && celularOk

  function cambiarTipoDocumento(nuevo) {
    setTipoDocumento(nuevo)
    setDocumento((actual) => limpiarDocumento(nuevo, actual))
  }

  function guardar(evento) {
    evento.preventDefault()
    setIntento(true)
    if (!valido) return
    onGuardar({
      tipo,
      tipoDocumento: documento ? tipoDocumento : null,
      documento,
      nombre: nombre.trim(),
      direccion: direccion.trim(),
      celular: celularEfectivo,
    })
  }

  const etiquetaDoc = etiquetaDocumento(tipoDocumento)
  const errorDocumento =
    intento && !documentoOk && !documentoVacioPermitido
      ? esFactura
        ? 'Escribe un RUC válido de 11 dígitos.'
        : tipoDocumento === 'DNI'
          ? 'Escribe un DNI de 8 dígitos.'
          : `Escribe el número de ${etiquetaDoc.toLowerCase()} (letras o números, hasta 12).`
      : null

  // X, «Cancelar» y Esc: con cambios sin guardar se pregunta antes de cerrar y se dice qué se perdería.
  const valoresFormulario = { tipoDocumento, documento, nombre, direccion, celular }
  const valoresBase = useRef(valoresFormulario)
  const cambios = listarCambios(valoresBase.current, valoresFormulario, {
    tipoDocumento: 'Tipo de documento',
    documento: 'Documento',
    nombre: 'Nombre',
    direccion: 'Dirección',
    celular: 'Celular',
  })
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar })

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        noValidate
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{esFactura ? 'Datos de la factura' : 'Datos de la boleta'}</h2>
          <BotonCerrarModal onClick={intentarCerrar} />
        </div>
        <p className="mt-1 text-sm text-ink/60">
          {esFactura
            ? 'La factura se emite a nombre de una empresa o persona con RUC.'
            : dniObligatorio
              ? `Las boletas desde ${formatearSoles(UMBRAL_DNI_BOLETA)} piden el documento y el nombre del comprador (esta venta: ${formatearSoles(total)}).`
              : 'El documento y el nombre son opcionales en esta boleta.'}
        </p>

        <div className="mt-4 space-y-3">
          {!esFactura && (
            <div>
              <Etiqueta>Tipo de documento</Etiqueta>
              <div className="mt-1 grid grid-cols-3 gap-1.5" role="group" aria-label="Tipo de documento">
                {TIPOS_DOCUMENTO_BOLETA.map((opcion) => (
                  <button
                    key={opcion.id}
                    type="button"
                    aria-pressed={tipoDocumento === opcion.id}
                    onClick={() => cambiarTipoDocumento(opcion.id)}
                    className={`rounded-lg border px-1.5 py-1.5 text-xs transition-colors ${
                      tipoDocumento === opcion.id
                        ? 'border-amber bg-amber/10 text-amber'
                        : 'border-border bg-bg text-ink hover:border-border-strong'
                    }`}
                  >
                    {opcion.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Etiqueta obligatorio={esFactura || dniObligatorio} htmlFor={`${idBase}-doc`}>
              {esFactura ? 'RUC' : etiquetaDoc}
            </Etiqueta>
            <input
              id={`${idBase}-doc`}
              type="search"
              inputMode={esDocumentoAlfanumerico(tipoDocumento) ? 'text' : 'numeric'}
              autoComplete="new-password"
              autoFocus
              maxLength={longitudMaximaDocumento(tipoDocumento)}
              value={documento}
              onChange={(evento) => setDocumento(limpiarDocumento(tipoDocumento, evento.target.value))}
              placeholder={esFactura ? '20123456789' : tipoDocumento === 'DNI' ? '12345678' : 'Número de documento'}
              className={`${CLASES_INPUT} font-mono`}
            />
            {errorDocumento && <p className="mt-1 text-xs text-red">{errorDocumento}</p>}
          </div>

          <div>
            <Etiqueta obligatorio={nombreObligatorio} htmlFor={`${idBase}-nombre`}>
              {esFactura ? 'Razón social' : 'Nombres y apellidos'}
            </Etiqueta>
            <input
              id={`${idBase}-nombre`}
              type="search"
              autoComplete="new-password"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              className={CLASES_INPUT}
            />
            {intento && !nombreOk && (
              <p className="mt-1 text-xs text-red">
                {esFactura ? 'Escribe la razón social.' : 'Escribe los nombres y apellidos del comprador.'}
              </p>
            )}
          </div>

          {celularCliente ? (
            <p className="text-xs text-ink/60">
              El PDF se enviará por WhatsApp al celular del cliente:{' '}
              <span className="font-mono text-ink/80">{formatearCelular(celularCliente)}</span>.
            </p>
          ) : (
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-celular`}>
                Celular del comprador (WhatsApp)
              </Etiqueta>
              <input
                id={`${idBase}-celular`}
                type="search"
                inputMode="tel"
                autoComplete="new-password"
                maxLength={11}
                value={celular}
                onChange={(evento) => setCelular(soloDigitos(evento.target.value))}
                placeholder="987654321"
                className={`${CLASES_INPUT} font-mono`}
              />
              <p className="mt-1 text-xs text-ink/60">Aquí se le enviará el PDF del comprobante.</p>
              {intento && !celularOk && (
                <p className="mt-1 text-xs text-red">Escribe un celular de 9 dígitos que empiece con 9.</p>
              )}
            </div>
          )}

          {esFactura && (
            <div>
              <Etiqueta htmlFor={`${idBase}-direccion`}>Dirección fiscal</Etiqueta>
              <input
                id={`${idBase}-direccion`}
                type="search"
                autoComplete="new-password"
                value={direccion}
                onChange={(evento) => setDireccion(evento.target.value)}
                className={CLASES_INPUT}
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={intentarCerrar}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Volver
          </button>
          <button type="submit" className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg">
            Guardar
          </button>
        </div>
      </form>
      {aviso}
    </div>
  )
}
