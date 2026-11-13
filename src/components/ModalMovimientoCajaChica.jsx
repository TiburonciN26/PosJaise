import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles, leerImporte, redondear2, soloImporte } from '../lib/moneda.js'
import { mensajeErrorCajaChica } from '../lib/cajaChica.js'
import Etiqueta from './Etiqueta.jsx'

// Un solo modal para lo que se escribe en Caja chica (migración 20261112000012):
//   · SALIDA     → administradora, cajera o encargada: monto + en qué se gastó. Crea solo su gasto variable del mes.
//   · REPOSICION → solo administradora: dinero que vuelve a la cajita (propone lo que falta para llenar el fondo).
//   · CONTEO     → solo administradora: cuánto efectivo hay de verdad; el servidor registra faltante / sobrante.
//   · FONDO      → solo administradora: cuánto debería haber con la caja llena.
// Quién y cuándo los pone el servidor (auth.uid() y now()), no el formulario.

const TEXTOS = {
  SALIDA: { titulo: 'Registrar salida', boton: 'Registrar salida', etiqueta: 'Monto que sale (S/)' },
  REPOSICION: { titulo: 'Reponer caja chica', boton: 'Reponer', etiqueta: 'Monto que entra (S/)' },
  CONTEO: { titulo: 'Contar caja', boton: 'Guardar conteo', etiqueta: 'Efectivo contado (S/)' },
  FONDO: { titulo: 'Fondo de caja chica', boton: 'Guardar fondo', etiqueta: 'Monto del fondo (S/)' },
}

const CLASE_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300'

function montoInicial(tipo, saldo, fondo) {
  if (tipo === 'REPOSICION') {
    const falta = redondear2(fondo - saldo)
    return falta > 0 ? falta.toFixed(2) : ''
  }
  if (tipo === 'FONDO') return fondo > 0 ? fondo.toFixed(2) : ''
  return ''
}

export default function ModalMovimientoCajaChica({ tipo, saldo, fondo, onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const textos = TEXTOS[tipo]
  const [monto, setMonto] = useState(() => montoInicial(tipo, saldo, fondo))
  const [motivo, setMotivo] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Mientras guarda, Esc no cierra; el modal sigue en la pila para que tampoco cierre el de abajo.
  useCerrarConEscape(() => {
    if (!guardando) onCerrar()
  })

  const montoNumerico = leerImporte(monto)
  const diferenciaConteo = tipo === 'CONTEO' && !Number.isNaN(montoNumerico) ? redondear2(montoNumerico - saldo) : null

  async function guardar(evento) {
    evento.preventDefault()

    const permiteCero = tipo === 'CONTEO' || tipo === 'FONDO'
    if (Number.isNaN(montoNumerico) || (!permiteCero && montoNumerico <= 0)) {
      setError(
        permiteCero
          ? 'Escribe un monto válido (ej. 150 o 150.50; 0 si no hay nada).'
          : 'Escribe un monto mayor a 0 (ej. 15 o 15.50).',
      )
      return
    }
    if (tipo === 'SALIDA') {
      if (!motivo.trim()) {
        setError('Escribe en qué se gastó.')
        return
      }
      if (montoNumerico > saldo) {
        setError(`Solo quedan ${formatearSoles(saldo)} en caja chica.`)
        return
      }
    }

    setGuardando(true)
    setError(null)
    let respuesta
    if (tipo === 'SALIDA') {
      respuesta = await supabase.rpc('registrar_salida_caja_chica', { p_monto: montoNumerico, p_motivo: motivo, p_nota: nota })
    } else if (tipo === 'REPOSICION') {
      respuesta = await supabase.rpc('reponer_caja_chica', { p_monto: montoNumerico, p_nota: nota })
    } else if (tipo === 'CONTEO') {
      respuesta = await supabase.rpc('contar_caja_chica', { p_contado: montoNumerico, p_nota: nota })
    } else {
      respuesta = await supabase.rpc('guardar_fondo_caja_chica', { p_monto: montoNumerico })
    }
    setGuardando(false)

    if (respuesta.error) {
      setError(mensajeErrorCajaChica(respuesta.error, 'No se pudo guardar. Intenta de nuevo.'))
      return
    }
    onGuardado(Number(respuesta.data))
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">{textos.titulo}</h2>
        {tipo === 'FONDO' ? (
          <p className="mt-1 text-sm text-ink/60">Lo que debería haber en la caja cuando está llena.</p>
        ) : (
          <p className="mt-1 font-mono text-xs text-ink/60">
            {tipo === 'CONTEO' ? 'Según el sistema debería haber' : 'Saldo actual'}: {formatearSoles(saldo)}
          </p>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor="caja-monto">
              {textos.etiqueta}
            </Etiqueta>
            <input
              id="caja-monto"
              type="search"
              inputMode="decimal"
              autoComplete="new-password"
              value={monto}
              onChange={(evento) => setMonto(soloImporte(evento.target.value))}
              autoFocus
              className={`${CLASE_INPUT} font-mono`}
            />
            {tipo === 'REPOSICION' && fondo > 0 && (
              <p className="mt-1 text-xs text-ink/50">Con esto el saldo llega al fondo de {formatearSoles(fondo)}.</p>
            )}
            {diferenciaConteo !== null && (
              <p
                className={`mt-1 text-xs ${
                  diferenciaConteo === 0 ? 'text-green' : diferenciaConteo < 0 ? 'text-orange-400' : 'text-blue'
                }`}
              >
                {diferenciaConteo === 0
                  ? 'La caja cuadra.'
                  : diferenciaConteo < 0
                    ? `Faltante de ${formatearSoles(-diferenciaConteo)}: se anotará como gasto variable del mes.`
                    : `Sobrante de ${formatearSoles(diferenciaConteo)}.`}
              </p>
            )}
          </div>

          {tipo === 'SALIDA' && (
            <div>
              <Etiqueta obligatorio htmlFor="caja-motivo">
                ¿En qué se gastó?
              </Etiqueta>
              <input
                id="caja-motivo"
                type="text"
                value={motivo}
                maxLength={80}
                onChange={(evento) => setMotivo(evento.target.value)}
                placeholder="Ej: Taxi al banco"
                className={CLASE_INPUT}
              />
              <p className="mt-1 text-xs text-ink/50">Se anota solo en Gastos variables del mes.</p>
            </div>
          )}

          {tipo !== 'FONDO' && (
            <div>
              <Etiqueta htmlFor="caja-nota">Nota</Etiqueta>
              <input
                id="caja-nota"
                type="search"
                autoComplete="new-password"
                value={nota}
                maxLength={200}
                onChange={(evento) => setNota(evento.target.value)}
                className={CLASE_INPUT}
              />
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : textos.boton}
          </button>
        </div>
      </form>
    </div>
  )
}
