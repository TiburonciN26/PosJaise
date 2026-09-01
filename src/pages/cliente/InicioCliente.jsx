import { useAuth } from '../../context/AuthContext.jsx'

export default function InicioCliente() {
  const { usuario } = useAuth()

  return (
    <div className="animate-entrada-pestana flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-base font-semibold text-ink">
        ¡Bienvenido{usuario?.email ? `, ${usuario.email}` : ''}!
      </p>
      <p className="max-w-xs text-sm text-ink/60">
        Estamos construyendo tu portal: historial de visitas, tarjetas de
        fidelización, descuentos y más — muy pronto. Empieza completando tu
        perfil.
      </p>
    </div>
  )
}
