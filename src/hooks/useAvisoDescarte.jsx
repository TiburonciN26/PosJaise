import { useState } from 'react'
import { useCerrarConEscape } from './useCerrarConEscape.js'
import ModalConfirmarDescarte from '../components/ModalConfirmarDescarte.jsx'

// Salida protegida de un modal con formulario (convención del proyecto, como Editar/Nuevo producto):
//  - `intentarCerrar`: para la X (BotonCerrarModal), «Cancelar» y el clic en el fondo. Si `cambios` tiene algo,
//    abre «¿Descartar los cambios?» con la lista; si no, cierra directo.
//  - Registra el Esc del modal (reemplaza su `useCerrarConEscape(onCerrar)`): Esc también pasa por aquí.
//  - `aviso`: el diálogo de confirmación; se renderiza dentro del modal (`{aviso}`), queda encima (z-40).
// `bloqueado` (p. ej. guardando): no se cierra mientras dura. `activo`: para modales que se montan siempre y se
// muestran según una condición (mismo sentido que en useCerrarConEscape). `variante="web"`: modales del portal de
// clientas (ver ModalConfirmarDescarte).
export function useAvisoDescarte({ cambios, onCerrar, bloqueado = false, activo = true, variante = 'pos' }) {
  const [confirmando, setConfirmando] = useState(false)

  function intentarCerrar() {
    if (bloqueado) return
    if (cambios.length > 0) setConfirmando(true)
    else onCerrar()
  }

  useCerrarConEscape(intentarCerrar, activo)

  const aviso =
    confirmando && activo ? (
      <ModalConfirmarDescarte
        cambios={cambios}
        variante={variante}
        onSeguir={() => setConfirmando(false)}
        onDescartar={() => {
          setConfirmando(false)
          onCerrar()
        }}
      />
    ) : null

  return { intentarCerrar, aviso }
}
