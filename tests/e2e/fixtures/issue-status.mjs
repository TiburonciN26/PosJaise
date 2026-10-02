// Snapshot read from Notion before this QA campaign.
// Owner clarification: Verificado = defect manually confirmed, not corrected.
export const issueStatus = {
  'QA-019': 'Pendiente',
  'QA-018': 'Pendiente',
  'QA-016': 'Pendiente',
  'QA-017': 'Pendiente',
  "QA-015": "Pendiente",
  "QA-014": "Pendiente",
  "QA-013": "Verificado",
  "QA-012": "Pendiente",
  "QA-011": "Re-test",
  "QA-010": "Verificado",
  "QA-009": "Verificado",
  "QA-008": "Verificado",
  "QA-007": "Pendiente",
  "QA-006": "Verificado",
  "QA-005": "Verificado",
  "QA-004": "Pendiente",
  "QA-003": "Verificado",
  "QA-001": "Pendiente"
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
export const expectedFailureIDs = new Set([
]);
