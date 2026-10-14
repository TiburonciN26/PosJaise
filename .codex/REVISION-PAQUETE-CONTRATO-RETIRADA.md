# Revisión del paquete candidato: contrato de retirada

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura.

**Veredicto técnico: paquete de cinco archivos apto para que Claude solicite la autorización humana de commit y push a `feat/cloudflare-pages`. Sin bloqueos.** Este veredicto no sustituye esa autorización ni autoriza escrituras de pruebas remotas.

## Comprobación

Rama local: `feat/cloudflare-pages`. HEAD: `08a740e9ff39646161ea9c45ea2fe37866d5758f`.

Los cuatro archivos de código/pruebas/verificadores conservan exactamente los hashes de la revisión V2. No cambió su comportamiento desde aquella aprobación. `git diff --check` termina con exit 0. B sigue desactivada; los envoltorios no la fuerzan.

El documento nuevo incorpora la precisión editorial: §1 identifica los 300 s del navegador como estado publicado anterior; §6c marca como histórico el pendiente de los verificadores y remite a §6d. SHA-256 del documento: `fd16842432e77f3587c396c0a0fe7d9958f3b18f2e72890cb22c9d1a12e52909`.

La lista candidata es coherente con lo revisado:

1. `cloudflare/medios-pages/entrega.js`
2. `cloudflare/medios-pages/test/probar-entrega.mjs`
3. `scripts/verificar-medios-pages-cache.cjs`
4. `scripts/verificar-interfaz-r2-preview.cjs`
5. `docs/evidencia-rendimiento/fase-3/DISENO-CONTRATO-RETIRADA-MEDIOS.md`

Mantener fuera `.codex/`, `.env*`, el informe de clon limpio pendiente y cualquier otro archivo. Usar la lista explícita al preparar el commit.

## Condiciones de la siguiente acción

Si el usuario autoriza commit y push, Claude debe validar el commit exacto en checkout limpio antes del push y detenerlo ante fallo de build, archivos inesperados o comprobaciones de entorno fallidas. Publicar únicamente en la rama de preview; mantener B desactivada y no cambiar variables/binding, producción, `main` ni GitHub Pages.

Un push incorpora un cambio real en las cabeceras de la Function. La evidencia de caché 27/27 e interfaz 23/23 se conserva como evidencia histórica de sus artefactos; no acredita el nuevo deployment. Identificar el nuevo build y validar la entrega efectiva antes de ensayos reales. Las escrituras en staging requieren autorización humana aparte.

No repetí pruebas sin cambios. No hice commit, push, build, despliegue, acceso remoto ni cambios de código/configuración/datos. La evidencia nueva de esta inspección queda en `evidencia-paquete-retirada/inspeccion.json`.
