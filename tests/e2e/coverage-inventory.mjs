// Inventory from existing navigation and forms, reviewed read-only.
export const staffRoutes = [
  ['/ventas',['ADMINISTRADOR','CAJERA']], ['/inventario',['ADMINISTRADOR','CAJERA']],
  ['/historial',['ADMINISTRADOR','CAJERA']], ['/servicios',['ADMINISTRADOR','CAJERA']],
  ['/dashboard',['ADMINISTRADOR']], ['/mi-panel',['ADMINISTRADOR','ASISTENTE']],
  ['/citas',['ADMINISTRADOR','CAJERA','ASISTENTE']], ['/estadisticas',['ADMINISTRADOR']],
  ['/auditoria',['ADMINISTRADOR']], ['/clientes',['ADMINISTRADOR']], ['/deudas',['ADMINISTRADOR']],
  ['/porcentajes',['ADMINISTRADOR']], ['/gastos',['ADMINISTRADOR','CAJERA']],
  ['/asistentes',['ADMINISTRADOR']], ['/mobiliario',['ADMINISTRADOR']], ['/web',['ADMINISTRADOR']],
  ...['promociones','pedidos-web','resenas-web','contacto-web','puntos-web','referidos-web','fidelizacion-web','galeria-web'].map(p=>[`/${p}`,['ADMINISTRADOR']]),
];
export const clientRoutes = ['/inicio','/mi-perfil','/servicios','/productos','/citas','/historial',
  '/fidelizacion','/ofertas','/nosotros','/carrito','/citas/carrito','/mis-resenas','/mis-puntos',
  '/mi-perfil/direcciones','/mi-perfil/pedidos','/mi-perfil/notificaciones','/mi-perfil/seguridad','/mi-perfil/referidos'];
export const requiredForms = [
  ['/inventario','Nuevo producto','Nuevo producto','El nombre es obligatorio.'],
  ['/servicios','Nuevo servicio','Nuevo servicio','El nombre es obligatorio.'],
  ['/clientes','Nuevo cliente','Nuevo cliente','El nombre completo es obligatorio.'],
  ['/asistentes','Nueva asistente','Nueva asistente','Los nombres completos son obligatorios.'],
  ['/mobiliario','Nuevo mueble','Nuevo mueble','El nombre es obligatorio.'],
  ['/gastos','Nuevo gasto var.','Nuevo gasto variable','El nombre es obligatorio.'],
  ['/promociones','Nueva promoción','Nueva promoción','El título es obligatorio.'],
  ['/deudas','Nueva deuda','Nueva deuda','Selecciona un cliente.'],
];
