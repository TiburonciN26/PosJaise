import { Component } from 'react'

// Sin esto, cualquier error de render en cualquier pestaña deja la pantalla
// en blanco (React desmonta todo el árbol) sin ninguna pista para el usuario.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Error no capturado:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
          <p className="text-lg font-semibold text-ink">Algo salió mal</p>
          <p className="max-w-sm text-sm text-ink/60">
            Ocurrió un error inesperado. Intenta recargar la página; si el problema continúa,
            avisa al administrador.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-bg"
          >
            Recargar
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
