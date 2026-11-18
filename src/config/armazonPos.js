import { componenteDiferido } from '../lib/moduloDiferido.js'

// El árbol completo del POS (components/ArmazonPos.jsx) como un chunk aparte: reintentable y precargable, igual que las
// páginas del portal (config/paginasCliente.js). App.jsx espera `precargar()` antes de montarlo, así no se ve el fallback de
// Suspense; precargaTemprana() lo adelanta al arrancar cuando este navegador montó el POS la última vez.
export const ArmazonPos = componenteDiferido(() => import('../components/ArmazonPos.jsx'), 'ArmazonPos')
