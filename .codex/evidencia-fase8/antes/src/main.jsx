import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { EstadoNegocioProvider } from './context/EstadoNegocioContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import AvisoActualizacionPWA from './components/AvisoActualizacionPWA.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AvisoActualizacionPWA />
        <AuthProvider>
          <EstadoNegocioProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </EstadoNegocioProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
