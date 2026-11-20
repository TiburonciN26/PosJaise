// Inserta en <head> el JSON-LD BeautySalon (lib/datosEstructurados.js) mientras Inicio está montado.
// <script type="application/ld+json"> es un bloque de DATOS: el navegador no lo ejecuta, así que la CSP (script-src) no
// aplica y no hace falta hash. Se arma con los mismos datos de contacto y horario que ya pide Inicio (caché de 60 s en
// lib/datosNegocioWeb.js): no añade consultas.
import { useEffect } from 'react'
import { obtenerContacto, obtenerHorario } from '../lib/datosNegocioWeb.js'
import { construirLdSalon } from '../lib/datosEstructurados.js'

const ID = 'ld-salon'

export function useDatosEstructuradosSalon() {
  useEffect(() => {
    let vigente = true
    Promise.all([obtenerContacto(), obtenerHorario()])
      .then(([contacto, semana]) => {
        if (!vigente) return
        const ld = construirLdSalon({ sitio: window.location.origin, contacto, semana })
        if (!ld) return
        document.getElementById(ID)?.remove()
        const script = document.createElement('script')
        script.type = 'application/ld+json'
        script.id = ID
        script.textContent = JSON.stringify(ld)
        document.head.appendChild(script)
      })
      .catch(() => {}) // sin datos estructurados no se rompe nada: es un extra para buscadores
    return () => {
      vigente = false
      document.getElementById(ID)?.remove()
    }
  }, [])
}
