# Pages Preview: variables VITE_MEDIOS_* — traspaso de Claude a Codex

Fecha: 10 de octubre de 2026.

El usuario autorizó (mensaje tras `REVISION-R2-REAL-Y-COMMIT-FASE-3.md`): corregir los dos detalles, validar el commit exacto, commit y push únicamente a `feat/cloudflare-pages`, y **configurar las variables solo en Pages Preview**, manteniendo todo conectado a staging y sin tocar `main` ni producción.

## Hecho por Claude

- R2-R1: parche de rollback regenerado con `.gitignore`; `git apply -R --check` completo pasa (no aplicado).
- R2-R2: B6 del verificador compara ahora el contenido completo (y SHA-256) de las variantes m y g; evidencia regenerada contra el entorno real: 30/30, 4 fotos × 2 variantes byte a byte idénticas, bucket vacío al terminar (DELETE 200 y lectura 404).
- Commit exacto: **`ba07a32a78bc`** en `feat/cloudflare-pages` con **39 archivos** (los 38 de tu listado + `scripts/probar-clon-limpio.mjs`, que ahora admite `--medios` para validar con las variables R2). Barrido de secretos con los valores reales de `.env.staging.local`: sin coincidencias.
- Validación del commit exacto desde un checkout limpio (`git archive` + `npm ci` + `build:cloudflare` con staging y las tres variables R2): build correcto, 179 archivos, sin `404.html`, ref de staging presente, **ref del negocio, Supabase local, `sb_secret_`/`service_role` y credenciales R2/S3 ausentes**. La comparación con mi árbol difiere únicamente por 2 reglas CSS (`.row-1`, `.row-2`) que Tailwind genera al escanear informes sin versionar de `.codex/` (p. ej. `VERIFICACION-FASE-3-V2.md`); no existen en el commit. Detalle en `docs/evidencia-rendimiento/fase-3/clon-limpio-commit.json` (todavía sin versionar).
- Push: `9405105..ba07a32` solo a `feat/cloudflare-pages`. Remotos: `main` `0dc629e`, `testing` `ce21b89` sin cambios.
- Build de Cloudflare Pages para `ba07a32`: éxito. El alias `https://feat-cloudflare-pages.pos-jaise.pages.dev` sirve `build-id = ba07a32a`. Como las variables aún no existen, **el bundle no contiene las URLs de R2** y las subidas siguen yendo a Supabase.

## Lo que necesito de Codex (Claude no tiene herramientas de Pages ni navegador)

En el proyecto **pos-jaise → Settings → Variables and Secrets → entorno *Preview*** (NO Production), añadir como variables de texto plano (son públicas):

| Variable | Valor |
|---|---|
| `VITE_MEDIOS_PROVEEDOR` | `r2` |
| `VITE_MEDIOS_API_URL` | `https://pos-jaise-medios-staging.jdeostuas2.workers.dev` |
| `VITE_MEDIOS_PUBLIC_URL` | `https://pub-b248edba3e19402382b557a35b33c674.r2.dev` |

Reglas:

1. **Production no se toca** (solo `RAMA_PRODUCCION=main`). Conservar las variables de Preview existentes (`RAMA_PRODUCCION`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
2. Sin barras finales en las URLs. No usar ninguna clave de R2 ni token (no existen en este diseño).
3. Las variables `VITE_*` se incorporan **al compilar**: tras guardarlas hace falta un build nuevo. Opciones: *Retry deployment* del último de la rama, o que Claude empuje un commit (documentación) a `feat/cloudflare-pages` cuando Codex avise de que ya están guardadas. Claude prefiere la segunda para que el commit publicado incluya la evidencia de validación y poder revalidar ese commit exacto antes del push.
4. Al terminar, indicar aquí qué hizo y confirmar las tres variables en la pantalla *Preview* (sin captura de valores secretos; son públicos).

## Después (Claude)

Verificar que el nuevo alias contiene las URLs de R2 y solo el Supabase de staging, y preparar la prueba de la interfaz con datos QA ficticios (sesiones, fotos nuevas y antiguas, edición/borrado, actualización PWA). No se tocan pagos ni operaciones del negocio. Siguen abiertos: dominio propio/CDN y `nosniff` definitivo, muestra del catálogo, Firefox/Safari/móvil, purga de caché, recolector destructivo y migración inversa; la fila residual de staging y las cuentas QA permanecen intactas.
