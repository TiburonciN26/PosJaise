import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { EstadoNegocioProvider } from './context/EstadoNegocioContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { TemaWebProvider } from './context/TemaWebContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import AvisoActualizacionPWA from './components/AvisoActualizacionPWA.jsx'
import { precargaTemprana } from './config/paginasCliente.js'
import { instalarReporteDeErrores, opcionesDeRaiz } from './lib/reportarError.js'

// Registro de errores en producción (lib/reportarError.js → tabla errores_cliente, la lee solo el admin). Se instala antes de
// montar React para no perder un fallo temprano; los errores que atrapan los límites de React llegan por `opcionesDeRaiz`.
instalarReporteDeErrores()

// Visitante (o clienta que ya usó el portal en este navegador): el portal y la página de la URL empiezan a descargarse YA, en
// paralelo con la lectura de la sesión, en vez de después (ver precargaTemprana). El POS no descarga nada de esto.
precargaTemprana()

// Fase 8 V2 (F8-01): el aviso de versión nueva queda FUERA del límite de error de la app. Antes compartía el ErrorBoundary
// global: un error que llegaba hasta ahí desmontaba también el aviso, y desaparecía el único botón «Actualizar» (el que respeta
// el trabajo pendiente). Las pantallas y ventanas que se cargan aparte tienen además su propio límite local
// (LimiteCargaDiferida): un fallo de descarga ya no llega a este nivel.
createRoot(document.getElementById('root'), opcionesDeRaiz).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AvisoActualizacionPWA />
        <ErrorBoundary>
          <AuthProvider>
            <EstadoNegocioProvider>
              <ToastProvider>
                <TemaWebProvider>
                  <App />
                </TemaWebProvider>
              </ToastProvider>
            </EstadoNegocioProvider>
          </AuthProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
