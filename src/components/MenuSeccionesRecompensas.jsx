import { SECCIONES } from '../pages/cliente/recompensas/datos.js'
import { useProgramaRecompensas } from '../hooks/useProgramaRecompensas.js'
import MenuSeccionesPestana from './MenuSeccionesPestana.jsx'

// Pestaña «Recompensas» del header con su lista de secciones. Rotula «Canjear monedas» igual que la pantalla (lectura pública y mínima de las reglas).
export default function MenuSeccionesRecompensas() {
  const programa = useProgramaRecompensas(null)
  const secciones = SECCIONES.map((s) => ({ clave: s.clave, label: programa.activo && s.clave === 'canje' ? 'Canjear monedas' : s.label }))
  return <MenuSeccionesPestana ruta="/recompensas" label="Recompensas" secciones={secciones} etiqueta="Secciones de Recompensas" />
}
