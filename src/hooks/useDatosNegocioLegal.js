import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { obtenerContacto } from '../lib/datosNegocioWeb.js'

// Datos del negocio para las páginas legales públicas (sin sesión). Mismas fuentes
// que ya usa el resto de la web — datos_proveedor_reclamos() (razón social, RUC,
// dirección) y datos_contacto() (teléfono) — para que no se desactualicen escritos
// a mano. Si el admin aún no cargó alguno, ese dato simplemente no aparece.
export function useDatosNegocioLegal() {
  const [datos, setDatos] = useState({ razonSocial: '', ruc: '', direccion: '', telefono: '' })

  useEffect(() => {
    let vigente = true
    Promise.all([supabase.rpc('datos_proveedor_reclamos'), obtenerContacto()]).then(([proveedorRes, contacto]) => {
      if (!vigente) return
      const proveedor = Array.isArray(proveedorRes.data) ? proveedorRes.data[0] : proveedorRes.data
      setDatos({
        razonSocial: proveedor?.razon_social || 'Jaise Beauty Academy',
        ruc: proveedor?.ruc || '',
        direccion: proveedor?.direccion || contacto?.direccion || '',
        telefono: contacto?.telefono || '',
      })
    })
    return () => {
      vigente = false
    }
  }, [])

  return datos
}

// "Jaise Beauty Academy, con RUC …, domicilio en …" sin dejar huecos si falta un dato.
export function descripcionProveedor(datos) {
  return [
    datos.razonSocial,
    datos.ruc && `con RUC ${datos.ruc}`,
    datos.direccion && `domicilio en ${datos.direccion}`,
    datos.telefono && `teléfono/WhatsApp ${datos.telefono}`,
  ]
    .filter(Boolean)
    .join(', ')
}
