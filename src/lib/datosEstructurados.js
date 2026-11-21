// Datos estructurados schema.org del salón (auditoría 2026-11-20, hallazgo 19.1). Google los usa para la ficha del
// negocio en búsquedas locales («uñas cerca de mí»): dirección, teléfono, horario y redes. Módulo PURO (sin Supabase ni
// navegador) para poder probarlo con node --test; lo monta hooks/useDatosEstructuradosSalon.js en Inicio.
//
// Calle, teléfono, redes y horario vienen de la base (datos_contacto(), horario_atencion_semanal()); lo que falta, se
// omite. La ciudad no está en la base (la dirección guardada es solo «Av. Argentina H-12»): la confirmó el negocio el
// 2026-11-20 y vive en UBICACION_NEGOCIO. Si el salón se muda, cambiarla aquí (y en los textos SEO de index.html).

export const NOMBRE_NEGOCIO = 'Jaise Beauty Academy'
export const UBICACION_NEGOCIO = { localidad: 'Nuevo Chimbote', region: 'Áncash', pais: 'PE' }
const DIAS_SCHEMA = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] // índice = día ISO

/** Teléfono peruano a formato internacional: 9 dígitos que empiezan con 9 → +51…; cualquier otro, tal cual (solo dígitos y +). */
export function telefonoInternacional(telefono) {
  const digitos = String(telefono ?? '').replace(/[^\d+]/g, '')
  if (!digitos) return null
  if (/^9\d{8}$/.test(digitos)) return `+51${digitos}`
  if (/^51(9\d{8})$/.test(digitos)) return `+${digitos}`
  return digitos
}

/** semana normalizada ([{ dia, turnos: [{ inicio, fin }] }]) → OpeningHoursSpecification agrupando días con los mismos turnos. */
export function horarioSchema(semana) {
  const grupos = new Map()
  for (const { dia, turnos } of semana ?? []) {
    for (const { inicio, fin } of turnos ?? []) {
      if (!inicio || !fin || !DIAS_SCHEMA[dia]) continue
      const clave = `${inicio}-${fin}`
      if (!grupos.has(clave)) grupos.set(clave, { opens: inicio, closes: fin, dias: [] })
      grupos.get(clave).dias.push(DIAS_SCHEMA[dia])
    }
  }
  return [...grupos.values()]
    .sort((a, b) => a.opens.localeCompare(b.opens))
    .map(({ opens, closes, dias }) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: dias, opens, closes }))
}

/** Objeto JSON-LD BeautySalon. `sitio` = origen público (https://…). Devuelve null si no hay sitio. */
export function construirLdSalon({ sitio, contacto, semana }) {
  if (!sitio) return null
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    name: NOMBRE_NEGOCIO,
    url: `${sitio}/inicio`,
    image: `${sitio}/og-jaise.jpg`,
    logo: `${sitio}/icon-512.png`,
  }
  const telefono = telefonoInternacional(contacto?.telefono)
  if (telefono) ld.telephone = telefono
  ld.address = {
    '@type': 'PostalAddress',
    ...(contacto?.direccion?.trim() ? { streetAddress: contacto.direccion.trim() } : {}),
    addressLocality: UBICACION_NEGOCIO.localidad,
    addressRegion: UBICACION_NEGOCIO.region,
    addressCountry: UBICACION_NEGOCIO.pais,
  }
  const redes = [contacto?.instagram_url, contacto?.facebook_url, contacto?.tiktok_url].filter((u) => /^https:\/\//.test(u ?? ''))
  if (redes.length) ld.sameAs = redes
  const horario = horarioSchema(semana)
  if (horario.length) ld.openingHoursSpecification = horario
  return ld
}
