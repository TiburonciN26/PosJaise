import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePerfilClienteOpcional } from '../../context/PerfilClienteContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useRegistrarMigajas } from '../../context/MigajasExtraContext.jsx'
import AyudaCampo from '../../components/AyudaCampo.jsx'
import SelectorDesplegable from './recompensas/SelectorDesplegable.jsx'
import { useProgramaRecompensas } from '../../hooks/useProgramaRecompensas.js'
import { SECCIONES } from './recompensas/datos.js'
import { useCatalogoPublico, useRecursosRecompensas } from './recompensas/useRecursosRecompensas.js'
import { AvisoError, Cargando } from './recompensas/ui.jsx'
import SeccionTarjeta from './recompensas/SeccionTarjeta.jsx'
import SeccionCanje from './recompensas/SeccionCanje.jsx'
import SeccionSellos from './recompensas/SeccionSellos.jsx'
import SeccionSellosReal from './recompensas/SeccionSellosReal.jsx'
import SeccionCupones from './recompensas/SeccionCupones.jsx'
import SeccionMovimientos from './recompensas/SeccionMovimientos.jsx'
import SeccionComo from './recompensas/SeccionComo.jsx'

function PuertaSesion() {
  return (
    <section className="liquid-glass flex flex-wrap items-center justify-between gap-5 rounded-none p-8">
      <div className="flex max-w-[560px] flex-col gap-1.5">
        <h2 className="sm:text-xl text-lg font-semibold text-white">Esta sección es solo para clientas con sesión</h2>
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

// Fase 5: recursos personales que necesita cada subpestaña (se piden al entrar, no todos al abrir la pantalla). «Cómo funciona»
// y el catálogo público no leen nada personal. Mis sellos depende de si el programa nuevo está activo (saldo): con él lee el
// catálogo y los movimientos de sellos; apagado, la tarjeta heredada (fidelizacion, historial y el % del cupón).
function recursosDeSeccion(clave, programaReal) {
  switch (clave) {
    case 'tarjeta':
      return ['puntos', 'saldo']
    case 'canje':
      return ['puntos', 'saldo', 'catalogoMonedas']
    case 'sellos':
      if (programaReal === null) return ['saldo']
      return programaReal ? ['saldo', 'catalogoSellos', 'sellosMovs'] : ['saldo', 'fidelizacion', 'historial', 'cuponSellos']
    case 'cupones':
      return ['saldo', 'cupones']
    case 'movimientos':
      return programaReal ? ['saldo', 'movimientos'] : ['saldo']
    default:
      return []
  }
}

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
// `publico` (QA-037): la misma pantalla para el visitante sin sesión (App.jsx la
// monta dentro del portal con publico={!usuario}). Ahí nunca se consulta ni se
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

  const userId = publico ? null : (session?.user?.id ?? null)
  const sesion = Boolean(userId)
  const { recursos, cargar, asegurar } = useRecursosRecompensas(userId)
  // Reglas vigentes (pública y mínima): «Cómo funciona» y los textos que dependen del programa. Con sesión se lee además el saldo
  // propio, pero esta pantalla ya lo carga con sus recursos (saldo), así que aquí solo importan las reglas.
  const programa = useProgramaRecompensas(null)

  const claveParam = params.get('seccion')
  const indiceActivo = Math.max(
    0,
    SECCIONES.findIndex((s) => s.clave === claveParam),
  )
  const seccion = SECCIONES[indiceActivo]
  // Catálogo público (QA-037): solo sin sesión y solo al entrar a «Canjear puntos»; nunca se consulta nada personal.
  const { catalogoPublico, recargarCatalogoPublico } = useCatalogoPublico(!sesion && seccion.clave === 'canje')

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

  // La sección «actual» para decidir una navegación sale de la URL REAL, no del último render (BrowserRouter actualiza
  // window.location de forma síncrona), así dos selecciones seguidas no se comparan contra una sección vieja.
  function claveVigente() {
    const clave = new URLSearchParams(window.location.search).get('seccion')
    return SECCIONES.some((s) => s.clave === clave) ? clave : SECCIONES[0].clave
  }

  function irA(clave) {
    if (clave !== claveVigente()) setParams({ seccion: clave })
  }

  // null = todavía no se sabe si el programa nuevo está activo (el saldo no llegó); true / false cuando ya se leyó.
  const programaReal = recursos.saldo.estado === 'ok' ? Boolean(recursos.saldo.datos?.activo) : null
  useEffect(() => {
    if (seccion.personal && !sesion) return
    asegurar(recursosDeSeccion(seccion.clave, programaReal))
  // `userId` en las dependencias: si la identidad cambia con la pantalla montada (otra pestaña cierra sesión y entra otra clienta), el
  // hook olvida lo pedido por la cuenta anterior y esto vuelve a pedir los recursos de la subpestaña a nombre de la nueva.
  }, [seccion.clave, seccion.personal, sesion, userId, programaReal, asegurar])

  let contenido
  const { puntos, fidelizacion, historial, cupones, saldo, catalogoMonedas, catalogoSellos, movimientos, sellosMovs, cuponSellos } = recursos
  // Fase 2: con el programa activo, saldo/sellos/movimientos salen del libro del servidor.
  const saldoReal = saldo.estado === 'ok' && saldo.datos?.activo ? saldo.datos : null
  // Programa activo según lo que se haya podido leer (saldo propio o reglas públicas); null mientras no se sepa.
  const programaActivo = saldoReal ? true : programa.activo
  // Tras un canje (o una respuesta recuperada) se vuelve a leer todo lo que cambia, en silencio.
  const alCanjear = () =>
    Promise.all(['saldo', 'catalogoMonedas', 'catalogoSellos', 'cupones', 'movimientos', 'sellosMovs'].map((k) => cargar(k, { silencioso: true })))
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
        } else contenido = <SeccionTarjeta datos={puntos.datos} nombre={perfil?.nombre ?? ''} saldoReal={saldoReal} />
        break
      case 'canje':
        contenido = (
          <SeccionCanje
            sesion={sesion}
            userId={userId}
            puntos={puntos}
            onReintentarPuntos={() => cargar('puntos')}
            saldo={saldo}
            catalogo={catalogoMonedas}
            catalogoPublico={catalogoPublico}
            onReintentarSaldo={() => cargar('saldo')}
            onReintentarCatalogo={() => cargar('catalogoMonedas')}
            onReintentarCatalogoPublico={recargarCatalogoPublico}
            onCanjeExitoso={alCanjear}
          />
        )
        break
      case 'sellos':
        if (saldo.estado === 'cargando') contenido = <Cargando />
        else if (saldo.estado === 'error') {
          contenido = (
            <AvisoError
              titulo="No pudimos cargar tus sellos"
              texto="Tus sellos no cambiaron; solo no pudimos leerlos ahora. Inténtalo de nuevo."
              onReintentar={() => cargar('saldo')}
            />
          )
        } else if (saldoReal) {
          contenido = (
            <SeccionSellosReal
              saldo={saldoReal}
              catalogo={catalogoSellos}
              movimientos={sellosMovs}
              userId={userId}
              onReintentarCatalogo={() => cargar('catalogoSellos')}
              onReintentarMovimientos={() => cargar('sellosMovs')}
              onCanjeExitoso={alCanjear}
            />
          )
        } else if (fidelizacion.estado === 'cargando') contenido = <Cargando />
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
              cuponSellos={cuponSellos}
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
            onReintentarCupones={() => cargar('cupones')}
            programaActivo={Boolean(saldoReal)}
          />
        )
        break
      case 'movimientos':
        contenido = saldoReal ? (
          <SeccionMovimientos real movimientos={movimientos} onReintentar={() => cargar('movimientos')} />
        ) : (
          <SeccionMovimientos />
        )
        break
      default:
        contenido = <SeccionComo programa={programa} />
    }
  }

  // Migaja del header: «Inicio | Recompensas | <subpestaña actual>» (mismo rótulo que el selector).
  useRegistrarMigajas([{ titulo: programaActivo && seccion.clave === 'canje' ? 'Canjear monedas' : seccion.label }])

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto pb-4 md:pb-8">
      <div className="mx-auto w-full max-w-[1400px] lw-gutter-detalle">
        <header className="flex items-center justify-between gap-2 pb-6 sm:justify-start">
          <div className="flex shrink-0 items-center gap-2">
            <h1 className="sm:text-[48px] lw-titulo-heavitas text-4xl uppercase">Recompensas</h1>
            <AyudaCampo etiqueta="Cómo funcionan las recompensas">
              Tus visitas y compras suman puntos y sellos. Cámbialos por cupones y beneficios.
            </AyudaCampo>
          </div>
          <SelectorDesplegable className="max-w-[45%]" valor={seccion.clave} onSeleccionar={irA}
            etiqueta="Sección de recompensas" etiquetaLista="Secciones de recompensas"
            opciones={SECCIONES.map(s => ({ ...s, label: programaActivo && s.clave === 'canje' ? 'Canjear monedas' : s.label }))} />
        </header>

        <div>
          {contenido}
        </div>
      </div>
    </div>
  )
}
