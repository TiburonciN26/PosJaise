import { useId, useRef, useState } from 'react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'
import { formatearSoles } from '../lib/moneda.js'
import { UMBRAL_DNI_BOLETA, dniValido, rucValido, soloDigitos } from '../lib/comprobante.js'

const CLASES_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber'

// Datos del comprador para la factura (RUC, razón social, dirección) o para la
// boleta cuando el total llega al umbral que exige DNI.
export default function ModalDatosComprobante({ tipo, inicial, total, dniObligatorio, onGuardar, onCerrar }) {
  const panelRef = useRef(null)
  const idBase = useId()
  const esFactura = tipo === 'FACTURA'
  const [documento, setDocumento] = useState(inicial?.documento ?? '')
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '')
  const [intento, setIntento] = useState(false)

  useCerrarConEscape(onCerrar)
  useModalA11y(panelRef)

  const documentoOk = esFactura ? rucValido(documento) : dniValido(documento)
  const documentoVacioPermitido = !esFactura && !dniObligatorio && documento === ''
  const nombreOk = !esFactura || Boolean(nombre.trim())
  const valido = (documentoOk || documentoVacioPermitido) && nombreOk

  function guardar(evento) {
    evento.preventDefault()
    setIntento(true)
    if (!valido) return
    onGuardar({
      tipo,
      documento,
      nombre: nombre.trim(),
      direccion: direccion.trim(),
    })
  }

  const errorDocumento =
    intento && !documentoOk && !documentoVacioPermitido
      ? esFactura
        ? 'Escribe un RUC válido de 11 dígitos.'
        : 'Escribe un DNI de 8 dígitos.'
      : null

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        noValidate
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">{esFactura ? 'Datos de la factura' : 'Datos de la boleta'}</h2>
        <p className="mt-1 text-sm text-ink/60">
          {esFactura
            ? 'La factura se emite a nombre de una empresa o persona con RUC.'
            : dniObligatorio
              ? `Las boletas desde ${formatearSoles(UMBRAL_DNI_BOLETA)} piden el DNI del comprador (esta venta: ${formatearSoles(total)}).`
              : 'El DNI es opcional en esta boleta.'}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio={esFactura || dniObligatorio} htmlFor={`${idBase}-doc`}>
              {esFactura ? 'RUC' : 'DNI'}
            </Etiqueta>
            <input
              id={`${idBase}-doc`}
              type="search"
              inputMode="numeric"
              autoComplete="new-password"
              autoFocus
              maxLength={esFactura ? 11 : 8}
              value={documento}
              onChange={(evento) => setDocumento(soloDigitos(evento.target.value))}
              placeholder={esFactura ? '20123456789' : '12345678'}
              className={`${CLASES_INPUT} font-mono`}
            />
            {errorDocumento && <p className="mt-1 text-xs text-red">{errorDocumento}</p>}
          </div>

          {esFactura && (
            <>
              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-nombre`}>
                  Razón social
                </Etiqueta>
                <input
                  id={`${idBase}-nombre`}
                  type="search"
                  autoComplete="new-password"
                  value={nombre}
                  onChange={(evento) => setNombre(evento.target.value)}
                  className={CLASES_INPUT}
                />
                {intento && !nombre.trim() && <p className="mt-1 text-xs text-red">Escribe la razón social.</p>}
              </div>
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
            </>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Volver
          </button>
          <button type="submit" className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg">
            Guardar
          </button>
        </div>
      </form>
    </div>
  )
}
