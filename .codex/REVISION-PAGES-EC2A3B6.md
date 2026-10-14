# Verificación de publicación ec2a3b6 y preparación del ensayo B

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura.

**Resultado: nuevo despliegue confirmado. Apto para que el usuario autorice una ejecución acotada de la prueba de caché `--contrato=b` sobre staging.** No se ejecutó dicha prueba ni se autoriza con este informe; tampoco se acredita todavía el comportamiento real de retirada B con objetos existentes.

## Marca correcta y revisión existente

- Commit: `ec2a3b64b4fe7ad96e29d43bf9aef61ea2aa1c04`.
- Rama: `feat/cloudflare-pages`.
- **Build ID real: `ec2a3b64`**, ocho caracteres. El comando propuesto por Claude con `--build-id=ec2a3b6` utiliza el hash corto de siete caracteres y no coincide con la marca que exige el preflight. Corregir ese argumento antes del ensayo.
- Deployment: `8c3771da-74a9-4ffc-ae2a-c8a217985eb3`, **success**, duración **47 s** en el panel.
- Inmutable: https://8c3771da.pos-jaise.pages.dev
- Alias: https://feat-cloudflare-pages.pos-jaise.pages.dev
- SHA-256 de SW: `d02e5c8ed449c7232148b57cb041b27e3cb596e966d07859b89a5a023eebf990`, idéntico en alias/inmutable y distinto del anterior d16d816f.

**CB-01 ya fue revisado y cerrado en local** en `.codex/REVISION-CB-01-RETIRADA-B-V2.md` (13 regresiones repetidas y 6 escenarios de cableado). La afirmación de Claude de que sigue pendiente esa revisión está desactualizada. Los hashes actuales de Function, helper y CLI coinciden con los del material aprobado. No se repitieron suites sin cambios.

## Comprobaciones de publicación

Lecturas GET/HEAD sin sesión de HTML, SW, manifest, rutas y **140 módulos JS**: todo correcto. La configuración efectiva conserva R2, Worker de staging, base pública Pages `/medios`, base antigua de `r2.dev` reconocida y backend de staging. No hubo archivos fallidos ni hallazgos del escáner de backend del negocio/local o tipos de claves privilegiadas.

SPA `/ventas` y `/medios-extra` correcta, manifest en raíz, SW excluye `/medios`, sin `404.html` en precache. Ocho solicitudes GET/HEAD de rutas de medios inválidas/inexistentes devuelven 404 `no-store`, `nosniff`, `noindex`; HEAD sin cuerpo. Son verificaciones de routing/error, no un ensayo de borrado con caché caliente.

El commit contiene exactamente siete archivos, incluyendo el helper y sus regresiones. La fuente confirmada exporta `REVOCAR_CON_R2=true` y mantiene la política de navegador de revalidación. El reporte de clon limpio de Claude identifica el commit exacto y registra 180 archivos, cero diferencias de contenido y 11 de finales de línea; Codex lo leyó, no repitió instalación/build.

`main` local continúa en `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No se hizo fetch de ramas remotas. El panel conserva producción pausada/sin deployment y la raíz de producción respondió 404. No se comprobó GitHub Pages en esta sesión.

## Alcance aconsejado de la autorización humana

Una ejecución del verificador con `--build-id=ec2a3b64 --contrato=b`, salida nueva en `.codex`, únicamente contra el alias/Worker/Supabase de staging aprobados. Crea **un grupo UUID propio de fotos-galeria, con dos variantes ficticias m/g (2 PUT)**, lo calienta, comprueba retirada y borra solo ese grupo; no escribe filas de BD. Exige inventario final igual al inicial.

Si cambia el POP, falta evidencia, aparece un fallo o la limpieza no queda confirmada: registrar el resultado y detenerse. Una corrida inconclusa no constituye retirada acreditada. No repetir indefinidamente ni atribuirle éxito; cualquier repetición debe tener límite y alcance autorizados.

Esta autorización propuesta no incluye recorrido de interfaz 23/23, nuevas filas QA, cierres de `r2.dev`, eliminación de deployments antiguos, cambios de variables/binding, commits/pushes adicionales, producción ni GitHub Pages. Estos accesos alternativos siguen pendientes del plan V2.

## Evidencia y acciones de Codex

Resultado: `evidencia-pages-ec2a3b6/verificacion-entrega-pages.json`; estado de panel: `dashboard.txt`; reproducción como texto: `verificar-publicacion.txt`.

No se usaron credenciales ni se escribió en staging, R2 o Cloudflare. No hubo commit/push, cambio de configuración ni modificación de fuentes. Solo se guardan este informe y evidencia nuevos en `.codex` conforme a la instrucción del usuario.
