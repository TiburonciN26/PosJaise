// Estados de Notion usados SOLO para anotar los reportes (knownIssue). Primer corte: antes de la
// campaña; actualizado el 2026-10-03 con el estado tras el re-test independiente de Codex
// (90 aprobados, 1 omitido): Verificado en QA-001, QA-003 a QA-019 y QA-024 a QA-032;
// QA-020 a QA-023 siguen pendientes de re-test de rendimiento.
// Verificado NO deriva expectedFailureIDs: esa lista (abajo) es explícita e independiente.
export const issueStatus = {
  'QA-034': 'Pendiente',
  'QA-033': 'Pendiente', // corregido en Local, a la espera de re-test independiente
  'QA-032': 'Verificado',
  'QA-031': 'Verificado',
  'QA-030': 'Verificado',
  'QA-029': 'Verificado',
  'QA-028': 'Verificado',
  'QA-027': 'Verificado',
  'QA-026': 'Verificado',
  'QA-025': 'Verificado',
  'QA-024': 'Verificado',
  'QA-023': 'Pendiente',
  'QA-022': 'Pendiente',
  'QA-021': 'Pendiente',
  'QA-020': 'Pendiente',
  'QA-019': 'Verificado',
  'QA-018': 'Verificado',
  'QA-016': 'Verificado',
  'QA-017': 'Verificado',
  "QA-015": 'Verificado',
  "QA-014": 'Verificado',
  "QA-013": "Verificado",
  "QA-012": 'Verificado',
  "QA-011": 'Verificado',
  "QA-010": "Verificado",
  "QA-009": "Verificado",
  "QA-008": "Verificado",
  "QA-007": 'Verificado',
  "QA-006": "Verificado",
  "QA-005": "Verificado",
  "QA-004": 'Verificado',
  "QA-003": "Verificado",
  "QA-001": 'Verificado'
};

// Explicitly uncorrected issues, independent of the owner's Notion labels.
// Remove an ID only after a correction is confirmed by a healthy re-test.
//
// Re-test 2026-10-02 (rama testing con fix/qa-correcciones integrada,
// Supabase Local): retirados por re-test sano (primero "Expected to fail, but
// passed" y luego pasada de confirmación con 39 aprobados): QA-001, 003, 004,
// 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 019. Cada ID tenía un
// único caso; un unexpected pass no prueba por sí solo todas las variantes.
// - QA-004: la prueba se adaptó al RPC atómico guardar_cita_pos (corte de red
//   tras ejecutarse en el servidor + recarga); QA-019: timeout 300 s y
//   readCoupon espera networkidle (errores del arnés, no de la aplicación).
// - QA-005 falló una vez en preparación (la promoción TEST no era visible por
//   otra promoción vigente con prioridad) y pasó sana en la repetición.
// Quedan pendientes solo los del Grupo 6 (accesibilidad).
// 2026-10-03: QA-033 (solo ADMINISTRADOR y CAJERA crean/anulan ventas) corregido en Local con la
// migración 20261002000007; sus tres pruebas específicas (qa-033-ventas-roles.spec.mjs) pasan de verdad,
// así que se retiró de la lista. Vacía NO significa que todo esté resuelto en Notion.
export const expectedFailureIDs = new Set([
]);
