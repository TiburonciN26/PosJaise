// Quién puede REGISTRAR una clienta nueva desde los modales de Ventas, Citas y Mis atenciones. Módulo puro (sin React ni
// Supabase) para probarlo con node --test (tests/e2e/permisos-clientes.test.mjs). El servidor lo vuelve a exigir en
// crear_cliente_personal() (migración 20261124000006): esto solo decide si se OFRECE el botón «Registrar como cliente nuevo».
// Editar una ficha existente sigue siendo solo de la administradora; PERSONAL_APOYO no registra clientas.
const ROLES_QUE_REGISTRAN_CLIENTES = ['ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA']

export function puedeRegistrarClientes(rol) {
  return ROLES_QUE_REGISTRAN_CLIENTES.includes(rol)
}
