// Estados de Notion usados SOLO para anotar los reportes (knownIssue); no controlan ninguna expectativa.
// Sincronizado el 2026-10-03 leyendo la vista de Notion: Verificado en QA-001 y QA-003 a QA-034 (los re-tests
// independientes de Codex incluyen QA-020 a QA-023 y QA-034); Re-test en QA-035 (corregido en Local, pendiente de verificación independiente).
// Verificado NO deriva expectedFailureIDs: esa lista (abajo) es explícita e independiente de estos estados.
// 2026-10-04 (re-tests independientes de Codex): Verificado en QA-043, QA-044, QA-045, QA-046 y QA-047. Los demás rótulos de esta
// tabla no se re-sincronizaron en bloque (QA-035 a QA-040 conservan el último rótulo conocido); QA-041/QA-042 no figuran aquí.
export const issueStatus = {
  'QA-047': 'Verificado',
  'QA-046': 'Verificado',
  'QA-045': 'Verificado',
  'QA-044': 'Verificado',
  'QA-043': 'Verificado',
  'QA-037': 'Re-test',
  'QA-038': 'Re-test',
  'QA-039': 'Re-test',
  'QA-040': 'Re-test',
  'QA-035': 'Re-test',
  'QA-036': 'Re-test',
  'QA-034': 'Verificado',
  'QA-033': 'Verificado',
  'QA-032': 'Verificado',
  'QA-031': 'Verificado',
  'QA-030': 'Verificado',
  'QA-029': 'Verificado',
  'QA-028': 'Verificado',
  'QA-027': 'Verificado',
  'QA-026': 'Verificado',
  'QA-025': 'Verificado',
  'QA-024': 'Verificado',
  'QA-023': 'Verificado',
  'QA-022': 'Verificado',
  'QA-021': 'Verificado',
  'QA-020': 'Verificado',
  'QA-019': 'Verificado',
  'QA-018': 'Verificado',
  'QA-017': 'Verificado',
  'QA-016': 'Verificado',
  'QA-015': 'Verificado',
  'QA-014': 'Verificado',
  'QA-013': 'Verificado',
  'QA-012': 'Verificado',
  'QA-011': 'Verificado',
  'QA-010': 'Verificado',
  'QA-009': 'Verificado',
  'QA-008': 'Verificado',
  'QA-007': 'Verificado',
  'QA-006': 'Verificado',
  'QA-005': 'Verificado',
  'QA-004': 'Verificado',
  'QA-003': 'Verificado',
  'QA-001': 'Verificado'
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
// 2026-10-03: QA-035 (solo ADMINISTRADOR y CAJERA agregan stock; historial solo por la RPC) corregido en Local con la
// migración 20261002000008; sus cuatro pruebas específicas (qa-autorizacion-configuracion.spec.mjs) pasan de verdad,
// así que se retiró de la lista (la lista queda vacía; en Notion sigue en Re-test hasta que Codex lo verifique).
// 2026-10-03: QA-037 a QA-040 (Recompensas Fase 1) se reprodujeron antes de corregir (6 de sus casos fallaban por la razón
// esperada) y se corrigieron en Local; sus casos (qa-recompensas-037-040.spec.mjs) pasan de verdad, así que no figuran aquí
// (en Notion: Re-test hasta que Codex los verifique).
export const expectedFailureIDs = new Set([]);
