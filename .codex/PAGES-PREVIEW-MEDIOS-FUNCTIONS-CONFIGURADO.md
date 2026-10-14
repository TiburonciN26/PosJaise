# Preview: binding R2 y entrega por Pages configurados

Fecha: 10 de octubre de 2026, America/Lima. Configuración externa autorizada expresamente por el usuario; resto del trabajo de Codex en solo lectura.

## Hecho y verificado

El usuario respondió **«Sí, aplicar y reconstruir solo Preview»** a la pregunta que identificaba el binding y las dos variables, excluyendo escrituras de pruebas y cambios de producción. Aplicado por el navegador integrado en Settings/Preview de Pages **pos-jaise**, sin tokens nuevos ni revelar la clave cifrada existente.

| Elemento | Valor guardado SOLO en Preview |
| --- | --- |
| Binding R2 `MEDIOS` | bucket existente `pos-jaise-medios-staging` |
| `VITE_MEDIOS_PUBLIC_URL` | `https://feat-cloudflare-pages.pos-jaise.pages.dev/medios` |
| `VITE_MEDIOS_BASES_RECONOCIDAS` | `https://pub-b248edba3e19402382b557a35b33c674.r2.dev` |

Conservados proveedor R2, API del Worker de staging, backend de staging, RAMA_PRODUCCION y clave pública cifrada. Después de guardar y recargar, el panel de Preview muestra siete variables y MEDIOS ligado al bucket indicado. La inspección posterior de Production muestra únicamente RAMA_PRODUCCION, sin MEDIOS, y despliegues automáticos deshabilitados, igual que antes.

Se ejecutó **Retry deployment** del preview de la rama `feat/cloudflare-pages` y commit `b36e7495c013b3cff8f167655de051a899ce77cf`.

- Deployment nuevo: **`4d23d410-61a8-4617-b224-cc9bc9396624`**.
- URL inmutable: **`https://4d23d410.pos-jaise.pages.dev`**.
- Alias: **`https://feat-cloudflare-pages.pos-jaise.pages.dev`**.
- Estado en el panel: **success**, duración **42 segundos**.
- Marca del documento: **`b36e7495`**, la misma que antes de cambiar variables porque el commit es el mismo.
- Deployment anterior con r2.dev como base configurada: `4d334b5d-a9aa-42d2-8121-c4c823f4b5b8`, `https://4d334b5d.pos-jaise.pages.dev`.

No hice commit/push ni edité archivos del proyecto salvo este informe y su evidencia. No subí/borré objetos ni modifiqué filas de staging. La autorización de este turno no incluye esas pruebas con escritura.

## Artefacto público independiente

Verificador externo con GET/HEAD, sin login ni cookies: **correcto**. Los 140 scripts precacheados/entrada responden 200; la configuración compilada usa **Pages `/medios` como publicUrl** y **r2.dev como base adicional reconocida**. Proveedor R2 y Worker de staging presentes. Solo backend de staging: no aparece el ref del negocio ni Supabase local; escaneo sin claves privilegiadas/JWT no permitidos, sin imprimir sus valores.

HTML: revalida y tiene noindex; SW: no-cache, exclusión específica de medios y sin 404.html precacheado. `/ventas` y `/medios-extra` mantienen el HTML SPA; manifest scope/start_url `/`. `pos-jaise.pages.dev` de producción conserva 404.

GET/HEAD de `/medios`, `/medios/`, clave ficticia inexistente y destino inválido: 404, no-store, nosniff y noindex; HEAD sin cuerpo. **No se probó un objeto real existente**, por lo que no se atribuye a estas comprobaciones validación de head del binding, caché positiva o bytes de una foto. El binding se confirma en el panel y su lectura con objeto existente queda para el recorrido autorizado siguiente.

Identidad del SW, SHA-256:

- Anterior: `64bd81f2c9773b349685f2265bea473ba2d654ee6b3edbe082c45693b6706493`.
- Alias nuevo e inmutable nuevo: `4c3d38c262bc6f00879681c535548bd45d0e8cf440d2206222df247be39bca42`.

Son distintos aun con la misma marca del commit. Para pruebas de interfaz usar contexto nuevo; para PWA entre versiones, registrar identidades/artefactos exactos, no solo afirmar que cambia el build-id cuando se recompila el mismo commit.

## Revisión del verificador adaptado: IP-P1 (P2)

Repetí **43/43 guardas**, cero fallos, y oxlint de los dos scripts cambiados pasa. El modo pages selecciona una base pública cerrada, conserva r2.dev en los destinos permitidos, exige cabeceras de Pages para las cuatro variantes de Producto y usa inventario del Worker para borrados. La limpieza recibe la base elegida. No cambia las reglas comerciales ni el código publicado de la Function.

**El verificador aún no queda aprobado para ejecutar sus escrituras con el modo nuevo:** falta distinguir la configuración de entrega antes de autenticar/escribir. `scripts/verificar-interfaz-r2-preview.cjs:114` llama a G.preflight con build-id/backend/cuenta/clave, pero no valida ENTREGA/PUBLICO ni la identidad del bundle/configuración servidos. A continuación inicia sesión y luego modifica los fixtures.

En este mismo trabajo existen dos deployments reales con marca `b36e7495` y distinta publicUrl: antiguo r2.dev y nuevo Pages. Por tanto, la marca sola no prueba que el artefacto tenga la configuración que exige `--entrega=pages`. Si el alias sigue en un build incompatible o el cambio de variables no se aplicó, el script puede empezar a escribir y detectar el fallo después de las subidas. La limpieza de Galería solo reconoce la base elegida: no debe confiarse en ella como sustituto del preflight.

**Reproducción independiente sin red:** G.preflight recibió una configuración de prueba que pedía pages y un documento con la misma marca y una entrada ficticia de versión anterior r2dev. Aceptó el documento con una llamada al doble HTML. No se ejecutó login ni una escritura; la reproducción demuestra la ausencia del control de entrega, no una pérdida de datos observada. Evidencia en `diagnostico-preflight-entrega.json`.

**Corrección recomendada a Claude antes del recorrido real:** añadir al preflight una validación de configuración/artefacto esperado de medios (p. ej. bundle/hash esperado y configuración efectiva), además del commit/backend, antes de login y escrituras. Para pages debe confirmar base exacta `/medios`, reconocimiento de la base anterior y el artefacto actual; para r2dev, su base correspondiente. No usar la mera presencia de ambos strings como prueba: el nuevo bundle contiene los dos con propósitos distintos. Conservar las listas de orígenes y rechazo de redirects. Regresión: misma marca con entrega equivocada o artefacto anterior aborta sin login ni writes; artefacto/configuración correctos pasan.

Este hallazgo afecta al **verificador de QA**, no revoca la implementación local de la Function ni la configuración recién aplicada, que sí se verificó de forma independiente. No hace falta publicar un nuevo commit de aplicación para demostrar esa corrección del script local.

## Traspaso para continuar

La configuración y reconstrucción solicitadas están terminadas. Claude debe corregir IP-P1 y preparar la prueba de caché real; los objetos/filas ficticios de esas pruebas requieren la autorización de escrituras correspondiente. No ejecuté `verificar-interfaz-r2-preview.cjs`, el futuro verificador de caché ni el script PWA que puede publicar commits.

Pendientes: GET de objeto existente, head real, MISS/HIT/expiración/borrado con TTL de 300 segundos, CPU/cuota, recorrido UI con la nueva base, PWA, rollback de URLs de Galería sobre filas ficticias, purga, fotos reales/otros navegadores/móvil, carga, recolector y migración inversa. Producción del negocio/GitHub Pages siguen fuera de esta activación de staging; el dominio propio sigue opcional y futuro.

## Evidencia y rollback de configuración

Evidencia nueva en `.codex/evidencia-pages-medios-configurado/`: `verificacion-entrega-pages.json`, reproducción de lectura `.txt`, diagnóstico del preflight y capturas `preview-configurado.png` / `deployment-correcto.png`. Las capturas muestran valores públicos y la clave cifrada, sin revelarla. El JSON contiene hashes y comprobaciones, no los bundles ni claves.

Para volver a la entrega anterior, restaurar **solo Preview** a la publicUrl r2.dev y reconstruir. No retirar la Function/binding mientras existan filas con URLs de Pages; aplicar antes el procedimiento de rollback ficticio aprobado y confirmar su lectura/gestión. No ejecuté rollback. Ningún recurso, cuenta o deployment fue eliminado.
