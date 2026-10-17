import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { obtenerContacto, obtenerHorario } from '../../lib/datosNegocioWeb.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { RUTAS_LEGALES } from '../../config/legal.js'
import './PieClienteWeb.css'

// Pie de página del portal cliente — solo en Inicio y las pestañas
// principales de la barra (Servicios/Productos/Citas/Nosotros), a
// pedido del usuario; las subpáginas de cuenta (Mi Perfil, Carrito,
// etc.) no lo llevan. Mismas fuentes que SeccionContacto
// (NosotrosCliente.jsx): datos_contacto()/horario_atencion(). Si el
// admin todavía no cargó dirección/teléfono/redes desde ContactoWeb.jsx
// (POS), esas líneas simplemente no aparecen — nada se inventa ni se
// deja como placeholder tipo "Próximamente".
export default function PieClienteWeb() {
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)

  useEffect(() => {
    let vigente = true

    Promise.all([obtenerContacto(), obtenerHorario()]).then(([fila, filaHorario]) => {
      if (!vigente) return
      setContacto(fila)
      setHorario(filaHorario)
    })

    return () => {
      vigente = false
    }
  }, [])

  const redes = [
    { url: contacto?.instagram_url, label: 'Instagram', icono: 'InstagramColor.svg' },
    { url: contacto?.facebook_url, label: 'Facebook', icono: 'facebookColor.svg' },
    { url: contacto?.tiktok_url, label: 'TikTok', icono: 'tiktokColor.svg' },
  ].filter((red) => red.url)

  return (
    <footer className="pie-cliente">
      <div className="pie-cliente__interior">
        <div className="pie-cliente__columnas">
          <div className="pie-cliente__marca">
            <p className="pie-cliente__nombre">Jaise Beauty Academy</p>
            {redes.length > 0 && (
              <div className="pie-cliente__redes">
                {redes.map((red) => (
                  <a
                    key={red.label}
                    href={red.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pie-cliente__red"
                    aria-label={red.label}
                  >
                    <img src={`${import.meta.env.BASE_URL}icons/${red.icono}`} alt="" width="15" height="15" />
                    <span className="pie-cliente__red-nombre">{red.label}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {(contacto?.direccion || contacto?.telefono) && (
            <section className="pie-cliente__seccion" aria-label="Contacto">
              <h2 className="pie-cliente__titulo">Contacto</h2>
              <div className="pie-cliente__contacto-datos">
                {contacto?.direccion && (
                  <p className="pie-cliente__dato">
                    <span
                      className="pie-cliente__ubicacion"
                      aria-hidden="true"
                      style={{ '--pie-ubicacion': `url(${import.meta.env.BASE_URL}icons/ubicacion.svg)` }}
                    />
                    <span>{contacto.direccion}</span>
                  </p>
                )}
                {contacto?.telefono && (
                  <a
                    href={`https://wa.me/${numeroWhatsapp(contacto.telefono)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pie-cliente__dato pie-cliente__enlace"
                  >
                    <img className="pie-cliente__icono-contacto" src={`${import.meta.env.BASE_URL}icons/whatsappColor.svg`} alt="" width="15" height="15" />
                    {contacto.telefono}
                  </a>
                )}
              </div>
            </section>
          )}

          {horario && (
            <section className="pie-cliente__seccion" aria-label="Horario de atención">
              <h2 className="pie-cliente__titulo">Horario de atención</h2>
              <div className="pie-cliente__dato">
                <p>
                  <span className="pie-cliente__horario">{formatearDias(horario.dias_atencion)}</span>
                  <span className="pie-cliente__turnos">
                    <span className="pie-cliente__horario">
                      {formatearHora(horario.bloque1_inicio)} - {formatearHora(horario.bloque1_fin)}
                    </span>
                    {horario.bloque2_inicio && (
                      <span className="pie-cliente__horario">
                        y {formatearHora(horario.bloque2_inicio)} - {formatearHora(horario.bloque2_fin)}
                      </span>
                    )}
                  </span>
                </p>
              </div>
            </section>
          )}

          {/* Culqi exige estos enlaces visibles para afiliar la pasarela. */}
          <nav aria-label="Información legal" className="pie-cliente__seccion">
            <h2 className="pie-cliente__titulo">Información legal</h2>
            <Link to={RUTAS_LEGALES.terminos} className="pie-cliente__enlace">
              Términos y condiciones
            </Link>
            <Link to={RUTAS_LEGALES.cambios} className="pie-cliente__enlace">
              Cambios y devoluciones
            </Link>
            <Link to={RUTAS_LEGALES.privacidad} className="pie-cliente__enlace">
              Privacidad
            </Link>

            {/* Obligatorio por ley (INDECOPI): visible en el pie de la web. */}
            <Link
              to={RUTAS_LEGALES.reclamos}
              className="pie-cliente__reclamos pie-cliente__enlace"
            >
              <BookOpen aria-hidden="true" />
              Libro de Reclamaciones
            </Link>
          </nav>
        </div>

        <p className="pie-cliente__copyright">
          © {new Date().getFullYear()} Jaise Beauty Academy
        </p>
      </div>
    </footer>
  )
}
