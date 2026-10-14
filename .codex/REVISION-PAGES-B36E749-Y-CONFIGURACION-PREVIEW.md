# Pages b36e749: publicación verificada y configuración de Preview preparada

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**La publicación del commit b36e749 queda verificada dentro de su alcance actual.** El alias sirve la marca exacta `b36e7495`; la Function está disponible y sus respuestas de error cumplen las cabeceras previstas. El cliente sigue configurado para leer de r2.dev. No se valida todavía lectura de objetos mediante el binding, caché real o integración UI con `/medios`.

Commit local: `b36e7495c013b3cff8f167655de051a899ce77cf`. Alias: `https://feat-cloudflare-pages.pos-jaise.pages.dev`. `main` local conserva `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hice fetch, commit, push ni modificaciones de ramas o recursos.

## Verificación independiente en línea

Solo GET/HEAD públicos, sin iniciar sesión, sin cookies y sin escrituras. Resultado del verificador: correcto.

- HTML y SW responden 200; HTML tiene marca `b36e7495`, revalidación y noindex; SW tiene no-cache.
- Los 140 scripts únicos encontrados en el precache/entrada responden 200. Escaneo de texto: backend de staging presente; ref del negocio y Supabase local ausentes; sin hallazgos de claves privilegiadas/JWT no permitidos. No se imprimen claves ni bundles.
- El bundle conserva proveedor R2, Worker de staging y base pública r2.dev. Esta revisión no cambia la entrega que usa el cliente.
- `/ventas` y `/medios-extra` siguen devolviendo el HTML SPA; manifest con scope/start_url `/`, sin 404.html precacheado.
- El SW servido cumple `swExcluyeMedios`: tiene la denylist específica. Esta lectura del SW generado no equivale a ejecutar la ronda PWA en un navegador controlado.
- `https://pos-jaise.pages.dev/` sigue devolviendo 404. No se sustituye por eso la inspección de ajustes de producción o del hosting de GitHub.

| Ruta | GET | HEAD | Cabeceras |
| --- | --- | --- | --- |
| `/medios` | 404, «No encontrado» | 404, cero bytes | no-store, nosniff, noindex |
| `/medios/` | 404, «No encontrado» | 404, cero bytes | iguales |
| Forma válida de catálogo con UUID ficticio | 404, «No encontrado» | 404, cero bytes | iguales |
| Destino ajeno al catálogo | 404, «No encontrado» | 404, cero bytes | iguales |

El 404 de una clave válida **es compatible con ausencia del binding o del objeto**. No inspeccioné el dashboard en este turno; no afirmo haber comprobado directamente si existe MEDIOS en el panel. No se subió un objeto para distinguir esas causas.

## Commit y evidencia local

El commit contiene **16 archivos en total**, contando el parche: quince del paquete/documentación más el rollback. Su lista no incluye `.codex`, `.env` ni las capturas antiguas de Fase 1.

Los SHA-256 de los once archivos de implementación/pruebas/build coinciden con los registrados en la revisión local aprobada: cero diferencias. No repetí las suites de 94 casos porque el código coincide y el nuevo trabajo era verificar publicación. `git apply -R --check docs/evidencia-rendimiento/fase-3/rollback/medios-pages-functions.patch` pasa sin aplicar el parche.

Leí el informe sin versionar `clon-limpio-b36e749.json`: identifica el commit exacto, 180 archivos por salida y cero diferencias de contenido; once diferencias solo de fin de línea. Es evidencia producida por Claude; no ejecuté npm ci ni recompilé el checkout en esta revisión.

## Configuración exacta preparada — NO guardada

Proyecto Pages: **pos-jaise**. Entorno: **Preview únicamente**. No crear recursos del negocio ni editar Production.

| Tipo | Nombre | Valor previsto |
| --- | --- | --- |
| Binding R2 | `MEDIOS` | bucket existente `pos-jaise-medios-staging` |
| Variable de compilación | `VITE_MEDIOS_PUBLIC_URL` | `https://feat-cloudflare-pages.pos-jaise.pages.dev/medios` |
| Variable de compilación | `VITE_MEDIOS_BASES_RECONOCIDAS` | `https://pub-b248edba3e19402382b557a35b33c674.r2.dev` |

La base Pages configurada ya se agrega a la lista de reconocimiento; la variable extra mantiene el reconocimiento de URLs antiguas de r2.dev. No hace falta listar de nuevo la base Pages. Son valores públicos, sin tokens ni claves nuevos.

Comprobar antes de guardar: selector Preview, bucket exacto y valores efectivos. Conservar `VITE_MEDIOS_PROVEEDOR=r2`, `VITE_MEDIOS_API_URL` del Worker de staging, backend de staging y demás ajustes existentes. No editar variables de Production.

Después de guardar el binding y las dos variables, **reconstruir el preview**: las VITE_* se incrustan al compilar y el binding entra en el despliegue. Puede reconstruirse el mismo commit; conservará el mismo build-id aunque cambiarán el bundle y el SW. Registrar el nuevo ID/URL de deployment y hashes para distinguir ambas publicaciones, y usar un contexto de navegador nuevo para las pruebas. No atribuir a la primera publicación las variables que solo tenga la segunda.

En este turno se dejó preparada la configuración; no se accedió ni se guardó en el dashboard. Aplicarla y reconstruir son cambios externos separados de la revisión, sujetos a la autorización humana acordada.

## Prueba siguiente y límites

Primero confirmar el nuevo artefacto: base `/medios`, ambas bases reconocidas, solo staging, marca/identidad exactas y rutas SPA intactas. Luego validar, con autorización de las escrituras ficticias aplicable, objetos propios de prueba, GET/HEAD, bytes/ETag, HIT/MISS, borrado según TTL de 300 segundos, recorrido UI y PWA. Distinguir conteos/latencia de métricas reales del panel; aún no se midieron CPU/cuota.

No reutilizar sin adaptación el verificador anterior que solo admite r2.dev y exige 404 público inmediato tras DELETE. La nueva entrega admite un HIT positivo durante el TTL; separar ausencia en el inventario R2 de expiración en la caché. La limpieza conserva el principio de borrar solo las filas y objetos propios confirmados.

Fase 3 completa, rollback de URLs de Galería en staging, purga, recolector, migración inversa, fotos reales, otros navegadores/móvil y producción siguen pendientes. Comprar dominio sigue siendo opcional/futuro.

Evidencia: `.codex/evidencia-pages-b36e749/verificacion-alias.json` y reproducción `.txt`. El JSON guarda los ocho GET/HEAD de medios, resultados del escaneo, cabeceras y hashes de los 140 scripts. No contiene credenciales ni sus cuerpos. No se obtuvo UUID de deployment del panel; no se inventa uno.
