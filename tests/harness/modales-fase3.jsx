// Arnés SOLO PARA PRUEBAS (Fase 3): monta los modales REALES de Producto, Servicio y
// Galería sin la aplicación, para que el script de verificación los maneje con el
// navegador. No forma parte del build de la aplicación (vite solo empaqueta index.html).
import '../../src/index.css'
import { createRoot } from 'react-dom/client'
import ModalProducto from '../../src/components/ModalProducto.jsx'
import ModalServicio from '../../src/components/ModalServicio.jsx'
import ModalGaleriaWeb from '../../src/components/ModalGaleriaWeb.jsx'
import { supabase } from '../../src/lib/supabase.js'
import { ToastProvider } from '../../src/context/ToastContext.jsx'

const modales = { producto: ModalProducto, servicio: ModalServicio, galeria: ModalGaleriaWeb }
let raiz = null

window.__eventos = []
window.__supabase = supabase
window.__montar = (tipo, props) => {
  window.__eventos = []
  raiz?.unmount()
  const contenedor = document.getElementById('raiz')
  contenedor.innerHTML = ''
  raiz = createRoot(contenedor)
  const Modal = modales[tipo]
  raiz.render(
    <ToastProvider>
      <Modal
        {...props}
        onGuardado={(valor) => window.__eventos.push({ tipo: 'guardado', valor: valor ?? null })}
        onCerrar={() => window.__eventos.push({ tipo: 'cerrado' })}
      />
    </ToastProvider>,
  )
}
window.__desmontar = () => {
  raiz?.unmount()
  raiz = null
}
