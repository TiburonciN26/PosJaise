import { useEffect, useState } from 'react'
import { FOTOS_LOGIN_RESPALDO } from '../config/fotosLogin.js'

// Compartido por el login público y la vista previa del administrador.
export default function FotosLogin({ fotos, pausadas = false, children, style }) {
  const [fallidas, setFallidas] = useState(() => new Set())
  const [indice, setIndice] = useState(0)
  const [reducido, setReducido] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const disponibles = (fotos ?? []).filter((f) => f.url && !fallidas.has(f.url))
  const respaldo = FOTOS_LOGIN_RESPALDO.filter((f) => !fallidas.has(f.url))
  const visibles = disponibles.length ? disponibles : respaldo.length ? respaldo : FOTOS_LOGIN_RESPALDO
  const clave = visibles.map((f) => `${f.id}:${f.url}`).join('|')

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cambiar = () => setReducido(media.matches)
    media.addEventListener('change', cambiar)
    return () => media.removeEventListener('change', cambiar)
  }, [])
  useEffect(() => { setIndice(0) }, [clave])
  useEffect(() => {
    if (pausadas || reducido || visibles.length < 2) return undefined
    const reloj = setInterval(() => setIndice((previo) => (previo + 1) % visibles.length), 6000)
    return () => clearInterval(reloj)
  }, [pausadas, reducido, clave, visibles.length])

  return (
    <section className="lgn-fotos" aria-label="Fotos y redes sociales de Jaise" style={style}>
      {visibles.map((foto, posicion) => (
        <img
          key={foto.id}
          src={foto.url}
          alt=""
          aria-hidden="true"
          draggable="false"
          className={`lgn-diapositiva ${foto.clase ?? ''}`}
          data-activa={posicion === indice % visibles.length}
          onError={() => setFallidas((previas) => previas.has(foto.url) ? previas : new Set([...previas, foto.url]))}
        />
      ))}
      <div className="lgn-fotos__velo" aria-hidden="true" />
      {children}
    </section>
  )
}
