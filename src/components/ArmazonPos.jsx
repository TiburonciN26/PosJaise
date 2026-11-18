import Layout from './Layout.jsx'
import PestanasCacheadas from './PestanasCacheadas.jsx'

// Todo el POS detrás de UN import(): el armazón (Layout: encabezado, menú lateral, CarritoProvider) y las pestañas
// (PestanasCacheadas, que trae Ventas). Antes viajaban en el JS de entrada, así que cada visitante y cada clienta del portal
// descargaba y evaluaba el código de Ventas y sus ventanas sin usarlo nunca.
//
// Lo carga App.jsx (config/armazonPos.js) antes de montar el árbol del POS. Sigue en el precaché de la PWA: vite.config.js
// lo lista en RAICES_DE_ATERRIZAJE, así que el POS abre sin red igual que cuando iba en la entrada.
//
// PestanasCacheadas se queda montada mientras dure la sesión del POS (la ruta de App.jsx es un único comodín): es ella la
// que decide qué pestaña mostrar y a dónde mandar una ruta que el rol no puede ver (incluida «/»).
export default function ArmazonPos() {
  return (
    <Layout>
      <PestanasCacheadas />
    </Layout>
  )
}
