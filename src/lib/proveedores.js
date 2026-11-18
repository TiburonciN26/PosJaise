// Proveedores (migración 20261112000014_proveedores): definición única de los campos de la ficha. La usan el formulario
// (ModalProveedor), la vista «solo lo que tiene datos» (DatosProveedor) y las consultas, para que agregar un campo sea
// cambiar UNA lista.
import { numeroWhatsapp } from './contactoNegocio.js'

export const GRUPOS_PROVEEDOR = [
  { id: 'principal', titulo: null },
  { id: 'contacto', titulo: 'Contacto' },
  { id: 'ubicacion', titulo: 'Ubicación' },
  { id: 'empresa', titulo: 'Datos de la empresa' },
  { id: 'comercial', titulo: 'Condiciones comerciales' },
  { id: 'otros', titulo: 'Otros' },
]

export const CAMPOS_PROVEEDOR = [
  { clave: 'nombre', etiqueta: 'Nombre comercial', grupo: 'principal', obligatorio: true, placeholder: 'Ej. Distribuidora Belleza Total' },
  { clave: 'rubro', etiqueta: 'Qué vende (rubro)', grupo: 'principal', placeholder: 'Ej. Tintes, shampoo, uñas' },
  { clave: 'contacto_nombre', etiqueta: 'Persona de contacto', grupo: 'principal', placeholder: 'Ej. Carla (vendedora)' },
  { clave: 'celular', etiqueta: 'Celular / WhatsApp', grupo: 'principal', inputMode: 'tel', mono: true, placeholder: 'Ej. 987 654 321' },
  { clave: 'telefono', etiqueta: 'Teléfono fijo u otro', grupo: 'contacto', inputMode: 'tel', mono: true },
  { clave: 'email', etiqueta: 'Correo', grupo: 'contacto', inputMode: 'email', placeholder: 'Ej. ventas@proveedor.com' },
  { clave: 'web', etiqueta: 'Página web', grupo: 'contacto', inputMode: 'url', placeholder: 'Ej. www.proveedor.com' },
  { clave: 'redes', etiqueta: 'Redes sociales', grupo: 'contacto', placeholder: 'Ej. @proveedor en Instagram' },
  { clave: 'direccion', etiqueta: 'Dirección', grupo: 'ubicacion' },
  { clave: 'ciudad', etiqueta: 'Distrito / ciudad', grupo: 'ubicacion' },
  { clave: 'razon_social', etiqueta: 'Razón social', grupo: 'empresa' },
  { clave: 'ruc', etiqueta: 'RUC', grupo: 'empresa', inputMode: 'numeric', mono: true, placeholder: '11 dígitos' },
  { clave: 'condiciones_pago', etiqueta: 'Condiciones de pago', grupo: 'comercial', placeholder: 'Ej. Contado / crédito 15 días' },
  { clave: 'dias_entrega', etiqueta: 'Días o tiempo de entrega', grupo: 'comercial', placeholder: 'Ej. Martes y jueves · 48 h' },
  { clave: 'pedido_minimo', etiqueta: 'Pedido mínimo', grupo: 'comercial', placeholder: 'Ej. S/ 200' },
  { clave: 'datos_pago', etiqueta: 'Datos para pagarle', grupo: 'comercial', tipo: 'textarea', placeholder: 'Ej. BCP 191-…, CCI …, Yape 987…' },
  { clave: 'notas', etiqueta: 'Notas', grupo: 'otros', tipo: 'textarea' },
]

export const COLUMNAS_PROVEEDOR = ['id', 'activo', 'creado_en', ...CAMPOS_PROVEEDOR.map((campo) => campo.clave)].join(', ')

export function formularioProveedor(proveedor) {
  const formulario = { activo: proveedor?.activo ?? true }
  for (const { clave } of CAMPOS_PROVEEDOR) formulario[clave] = proveedor?.[clave] ?? ''
  return formulario
}

// Los errores pensados para el usuario llegan con errcode P0001 (validación) o 42501 (permiso).
export function mensajeErrorProveedor(error, generico) {
  if (error?.code === 'P0001' || error?.code === '42501') return error.message
  return generico
}

export function enlaceWhatsapp(celular) {
  const numero = celular ? numeroWhatsapp(celular) : ''
  return numero ? `https://wa.me/${numero}` : null
}

export function enlaceTelefono(telefono) {
  const limpio = String(telefono ?? '').replace(/[^\d+]/g, '')
  return limpio ? `tel:${limpio}` : null
}
