# Evidencia · Fase 1 · Cupones sin saturación continua (PERF-01)

Fecha: 2026-10-09 · Entorno: Windows, Chromium (Playwright del repo), Supabase Local `http://127.0.0.1:54321` verificado, dataset local existente (208 promociones / 183 y 92 cupones en Referidos y Fidelización). Sin producción, sin migraciones, sin tocar infraestructura.

## Método
- Dos builds de producción del mismo árbol de trabajo (base `/PosJaise/`), servidos con `scripts/servir-dist-base.cjs`: **antes** (código original, fuentes en `antes-fuentes/`) y **después**.
- `scripts/medir-cupones-reposo.cjs`: cuenta ADMINISTRADOR ficticia creada y borrada en Supabase Local; por pantalla × tema (oscuro/claro): carga en frío, 3,5 s de estabilización, y **3 repeticiones** de una ventana de reposo de **2,5 s con CPU 4×** (viewport 1440×900, service worker bloqueado, sin interacción).
- Métrica: `TaskDuration` de CDP (incluye sobrecosto de instrumentación; **no** es % de CPU del equipo, y a CPU 4× el valor ≈ ventana = hilo saturado), tareas largas (PerformanceObserver) y animaciones CSS activas (`document.getAnimations()`).
- Mediciones preliminares de Claude: la aceptación depende de la verificación independiente de Codex.

## Resultado (mediana de 3; muestras individuales en `antes.json` / `despues.json`)
Ver `tabla.md`. Resumen: reducción de **94,0 % a 98,7 %** del trabajo en reposo (meta propuesta ≥ 80 %); animaciones CSS activas 837 → 5 (Promociones); ninguna tarea larga en reposo después (antes hasta 144 ms). Las 5 restantes se identificaron por nombre: son el martillo del encabezado (`martillar` + 4 `chispa-martillo`, `IconoMartillo`), no cupones; animaciones de cupones en reposo = 0.
Nota de variabilidad: en `despues` la primera ventana de algunas pantallas muestra 150–240 ms (residuo de carga/imágenes); las otras dos 24–70 ms. La mediana es la reportada.

## Funcional / visual (`scripts/verificar-cupones-fase1.cjs` → `capturas/despues-verificacion.json`)
33 comprobaciones, todas OK en oscuro/claro × normal/reduced-motion: reposo quieto (destello y chispas), chispas ocultas en cupones apagados, hover → `cupon-sheen-pasada` + `cupon-titilar`, fin del hover vuelve a quieto, reduced-motion sin animación ni en hover, sin errores de página. Capturas `antes-referidos-oscuro.png` / `despues-referidos-*.png`: acabado metálico y legibilidad equivalentes; las chispas siguen visibles (estáticas) en cupones activos.

## Limitaciones
- No se verificó en dispositivo móvil físico ni se midió consumo/GPU. No se midió Lighthouse (no pedido en esta fase).
- Hover/foco: en táctil el destello corre al tocar (foco dentro del cupón); no se probó en hardware táctil.
- `.cupon-rojo` de Inicio (1 tarjeta, glow + destello por `left` + texto brillante) sigue animado: fuera del alcance de la Fase 1 (auditoría: 192 → 23 ms en 2,5 s, un orden menor). Candidato para una fase posterior si Codex lo pide.
- El estado "antes" de la prueba `niveles-visuales-helpers.mjs` quedaba obsoleto; se actualizó, pero la suite Playwright de QA (`qa-recompensas-037-040.spec.mjs`) NO se ejecutó aquí (requiere global-setup que escribe en Local).
- Lint: `npm run lint` 2 errores (fixtures de Playwright, preexistentes) + 44 advertencias = igual que la línea base de la auditoría. `node --test tests/e2e/niveles-visuales.test.mjs` 9/9. Build OK.

## Archivos modificados
- `src/index.css` — destello `::after` sin animación en reposo; `.cupon-chispa-lista`, `.cupon-envoltura-apagada`; `@keyframes cupon-sheen-pasada` (transform); reglas hover/focus-within bajo `prefers-reduced-motion: no-preference`.
- `src/components/EnvolturaCupon.jsx` — clases `cupon-envoltura`, `cupon-envoltura-apagada`, `cupon-chispa-lista`.
- `tests/e2e/niveles-visuales-helpers.mjs` — aserciones adaptadas.
- Nuevos: `scripts/medir-cupones-reposo.cjs`, `scripts/verificar-cupones-fase1.cjs`, `scripts/servir-dist-base.cjs`, `docs/evidencia-rendimiento/fase-1/*`, sección 44 de `implementacionesWed.md`.
- El árbol ya tenía ~137 archivos modificados sin confirmar antes de esta fase; para aislar mi cambio: `diff` contra `antes-fuentes/*.antes`.

## Rollback
Restaurar los dos archivos de fuente desde `antes-fuentes/` (`index.css.antes` → `src/index.css` y `EnvolturaCupon.jsx.antes` → `src/components/EnvolturaCupon.jsx`; ojo: `index.css.antes` es el estado previo completo, incluyendo cambios sin confirmar de otras sesiones, por lo que es seguro solo si nadie más editó index.css desde entonces) o revertir manualmente los bloques descritos arriba. Sin migraciones ni recursos externos que revertir. Para el test: revertir `tests/e2e/niveles-visuales-helpers.mjs`.

## Datos / recursos creados y limpieza
Solo cuentas `perf-fase1*@test.local` en Supabase Local, borradas por los scripts en `finally`. Builds temporales en el scratchpad de la sesión (fuera del repo). Servidores de medición detenidos.

---
## Verificación independiente de Codex (Fase 1: APROBADA)
Informe (fuera del repositorio, por el rol de solo lectura de Codex): `C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/fase1-verificacion/VERIFICACION-FASE-1.md` (evidencias: `EVIDENCIAS-FASE-1.zip` en esa carpeta). Si corresponde a la entrega, copiarlo al proyecto lo decide el usuario.

**Dos mediciones distintas — no mezclarlas:**
| Fuente | Reducción del trabajo en reposo | Notas |
|---|---|---|
| Mediciones de Claude (este README, `tabla.md`) | **94,0 % – 98,7 %** (mediana de 3, 6 combinaciones pantalla × tema, CPU 4×) | Preliminares; hechas por quien implementó el cambio |
| Mediciones independientes de Codex | **91,3 % – 96,5 %** (p. ej. Promociones oscuro 2620,4 → 227,6 ms; Referidos oscuro 2524,2 → 87,1 ms) | Conductores y cuentas propios; son las que valen para la aceptación |
Ambas superan el mínimo propuesto del 80 %. Las cifras de Claude no sustituyen a las de Codex.
