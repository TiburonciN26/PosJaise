import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePerfilClienteOpcional } from '../../context/PerfilClienteContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { SECCIONES } from './recompensas/datos.js'
import { useRecursosRecompensas } from './recompensas/useRecursosRecompensas.js'
import { AvisoError, Cargando } from './recompensas/ui.jsx'
import SeccionTarjeta from './recompensas/SeccionTarjeta.jsx'
import SeccionCanje from './recompensas/SeccionCanje.jsx'
import SeccionSellos from './recompensas/SeccionSellos.jsx'
import SeccionCupones from './recompensas/SeccionCupones.jsx'
import SeccionMovimientos from './recompensas/SeccionMovimientos.jsx'
import SeccionComo from './recompensas/SeccionComo.jsx'

function PuertaSesion() {
  return (
    <section className="liquid-glass flex flex-wrap items-center justify-between gap-5 rounded-none p-8">
      <div className="flex max-w-[560px] flex-col gap-1.5">
        <h2 className="text-lg font-semibold text-white">Esta sección es solo para clientas con sesión</h2>
        <p className="text-sm leading-relaxed text-white/60">
          Inicia sesión para ver tu información personal. No mostramos datos de otras clientas. Mientras tanto
          puedes explorar «Canjear puntos» y «Cómo funciona».
        </p>
      </div>
      <Link
        to="/login"
        className="inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
      >
        Iniciar sesión
      </Link>
    </section>
  )
}

const idTab = (clave) => `recompensas-tab-${clave}`
const idPanel = (clave) => `recompensas-panel-${clave}`

// "Recompensas" (Club Jaise) — pestaña del portal que reúne lo que antes
// eran tres pantallas sueltas: Mis puntos (tarjeta), Fidelización
// (sellos) y Cupones y ofertas. Diseño aprobado en
// docs/diseno-recompensas/; esta es la Fase 1 (solo frontend): usa lo que
// ya existe en el backend — mis_puntos(), mi_fidelizacion(),
// mi_historial_fidelizacion(), generar_cupon_fidelizacion(), mis_cupones()
// y la tabla promociones — y marca como "Próximamente"/"Propuesta" lo
// que no (catálogo y canje de puntos, movimientos, puntos de
// clasificación aparte del saldo).
//
// La subpestaña vive en la URL (?seccion=...): así /mis-puntos,
// /fidelizacion y /ofertas (rutas viejas) redirigen a la sección que
// corresponde y el botón "atrás" del navegador funciona entre secciones.
//
// `publico` (QA-037): la misma pantalla sin sesión, montada fuera del
// portal (ver RecompensasPublica.jsx). Ahí nunca se consulta ni se
// muestra nada personal, aunque hubiera una sesión a medio resolver.
//
// Cada consulta es un recurso con su propio estado (QA-039, ver
// useRecursosRecompensas.js): un fallo parcial se avisa en su sección,
// con reintento solo de ese recurso, y no bloquea las demás.
export default function RecompensasCliente({ publico = false }) {
  const { session } = useAuth()
  const perfilCtx = usePerfilClienteOpcional()
  const perfil = perfilCtx?.perfil ?? null
  const { mostrarToast } = useToast()
  const [params, setParams] = useSearchParams()
  const [generando, setGenerando] = useState(false)
  const tabsRef = useRef([])

  const userId = publico ? null : (session?.user?.id ?? null)
  const sesion = Boolean(userId)
  const { recursos, cargar } = useRecursosRecompensas(userId)

  const claveParam = params.get('seccion')
  const indiceActivo = Math.max(
    0,
    SECCIONES.findIndex((s) => s.clave === claveParam),
  )
  const seccion = SECCIONES[indiceActivo]

  async function generarCupon() {
    setGenerando(true)
    const { data, error } = await supabase.rpc('generar_cupon_fidelizacion')
    setGenerando(false)

    if (error) {
      mostrarToast(error.message ?? 'No se pudo generar el cupón.', 'error')
      return
    }

    const cupon = data?.[0]
    mostrarToast(
      cupon ? `¡Cupón ${cupon.codigo} generado! Lo encuentras en «Mis cupones».` : 'Cupón generado.',
      'exito',
    )
    // Refetch completo (no ajuste optimista): que quede exactamente lo que
    // el servidor validó — recompensas_disponibles baja con datos frescos
    // y el cupón nuevo aparece en Mis cupones. Si la actualización falla se
    // conserva lo que ya se veía y se avisa (el cupón ya se creó).
    const [sellosOk, cuponesOk] = await Promise.all([
      cargar('fidelizacion', { silencioso: true }),
      cargar('cupones', { silencioso: true }),
    ])
    if (!sellosOk || !cuponesOk) {
      mostrarToast('El cupón se creó, pero no pudimos actualizar la pantalla. Recarga para verlo.', 'error')
    }
  }

  function irA(clave) {
    if (clave !== seccion.clave) setParams({ seccion: clave })
  }

  // Patrón WAI-ARIA de pestañas (QA-038): flechas izquierda/derecha
  // (circular) e Inicio/Fin; la pestaña se activa al recibir el foco.
  function alTeclear(evento, indice) {
    const total = SECCIONES.length
    let destino = null
    if (evento.key === 'ArrowRight') destino = (indice + 1) % total
    else if (evento.key === 'ArrowLeft') destino = (indice - 1 + total) % total
    else if (evento.key === 'Home') destino = 0
    else if (evento.key === 'End') destino = total - 1
    if (destino === null) return
    evento.preventDefault()
    irA(SECCIONES[destino].clave)
    tabsRef.current[destino]?.focus()
  }

  let contenido
  const { puntos, fidelizacion, historial, cupones, promociones } = recursos
  if (seccion.personal && !sesion) {
    contenido = <PuertaSesion />
  } else {
    switch (seccion.clave) {
      case 'tarjeta':
        if (puntos.estado === 'cargando') contenido = <Cargando />
        else if (puntos.estado === 'error') {
          contenido = (
            <AvisoError
              titulo="No pudimos cargar tu saldo de puntos"
              texto="Tu saldo y tu nivel no cambiaron; solo no pudimos leerlos ahora. Inténtalo de nuevo."
              onReintentar={() => cargar('puntos')}
            />
          )
        } else contenido = <SeccionTarjeta datos={puntos.datos} nombre={perfil?.nombre ?? ''} />
        break
      case 'canje':
        contenido = <SeccionCanje sesion={sesion} puntos={puntos} onReintentarPuntos={() => cargar('puntos')} />
        break
      case 'sellos':
        if (fidelizacion.estado === 'cargando') contenido = <Cargando />
        else if (fidelizacion.estado === 'error') {
          contenido = (
            <AvisoError
              titulo="No pudimos cargar tus sellos"
              texto="Tus sellos y visitas no cambiaron; solo no pudimos leerlos ahora. Inténtalo de nuevo."
              onReintentar={() => cargar('fidelizacion')}
            />
          )
        } else {
          contenido = (
            <SeccionSellos
              datos={fidelizacion.datos}
              historial={historial}
              generando={generando}
              onGenerarCupon={generarCupon}
              onReintentarHistorial={() => cargar('historial')}
            />
          )
        }
        break
      case 'cupones':
        contenido = (
          <SeccionCupones
            cupones={cupones}
            promociones={promociones}
            onReintentarCupones={() => cargar('cupones')}
            onReintentarPromociones={() => cargar('promociones')}
          />
        )
        break
      case 'movimientos':
        contenido = <SeccionMovimientos />
        break
      default:
        contenido = <SeccionComo />
    }
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-[1200px]">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-6 pt-2 md:pt-6">
          <div className="flex flex-col gap-3.5">
            <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Club Jaise</span>
            <h1 className="lw-titulo-heavitas text-4xl uppercase md:text-5xl">Recompensas</h1>
            <p className="max-w-[560px] text-[15px] leading-relaxed text-white/60">
              Tus visitas y compras suman puntos y sellos. Cámbialos por cupones y beneficios.
            </p>
          </div>
          {sesion && perfil?.nombre && (
            <div className="flex flex-col gap-1 text-right">
              <span className="text-xs text-white/50">Sesión iniciada como</span>
              <span className="text-base font-semibold text-white">{perfil.nombre}</span>
            </div>
          )}
        </header>

        <div role="tablist" aria-label="Secciones de Recompensas" className="mb-6 flex flex-wrap gap-2">
          {SECCIONES.map((s, indice) => {
            const activa = indice === indiceActivo
            return (
              <button
                key={s.clave}
                ref={(el) => {
                  tabsRef.current[indice] = el
                }}
                id={idTab(s.clave)}
                type="button"
                role="tab"
                aria-selected={activa}
                aria-controls={activa ? idPanel(s.clave) : undefined}
                tabIndex={activa ? 0 : -1}
                onClick={() => irA(s.clave)}
                onKeyDown={(evento) => alTeclear(evento, indice)}
                className={`min-h-11 whitespace-nowrap rounded-full border px-[18px] text-sm font-semibold transition-colors ${
                  activa
                    ? 'border-white bg-white text-[#0b0b0c]'
                    : 'border-[#3a3a3f] bg-transparent text-white hover:border-[var(--lw-gold)]'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>

        <div role="tabpanel" id={idPanel(seccion.clave)} aria-labelledby={idTab(seccion.clave)}>
          {contenido}
        </div>
      </div>
    </div>
  )
}
