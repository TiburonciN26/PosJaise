# Entrega 10B · lote exacto de producción

Fecha: 2026-10-13, America/Lima. Rama `feat/cloudflare-pages`, HEAD `9c83f23`. **Nada se ha aplicado todavía.**

## Base del lote

**Inventario:** [inventario-produccion.txt](evidencia-fase10b/inventario-produccion.txt), `ESTADO|COMPLETO`, corrida `20261013T204913Z-48c584`, `solo_lectura|on`.

**Corrección previa del inventario (`9c83f23`):**
- La primera corrida por el Session pooler salió INCOMPLETO con `solo_lectura|off`: Supavisor no reenvía `PGOPTIONS`.
- Toda la consulta va ahora en `begin transaction read only … rollback`.
- Las pruebas Local ya no usan `PGOPTIONS`. Resultado: 41/41 = 39 sin red + 2 Local. Con el inventario anterior fallan esos 3 casos.

**Respaldo:** corrida `C:\JaiseBackups\Produccion\corrida_20261013T201324Z`.
- Paso 5 repetido con `e1fd053`; manifiesto escrito a las 20:36 UTC.
- El aplicador lo valida antes de pedir credenciales.
- Ventana de 24 h: hasta el 2026-10-14 hacia las 20:36 UTC.

## Estado de producción según el inventario

- **Las 23 versiones requeridas** (`20261002000001` a `20261008000002`) están presentes. Total de migraciones: 82.
- **Ninguna versión de la 10B (`2026100900000x` a `20261013000001`).** Faltan `deuda_pagos`, `libro_reclamaciones`, `pasarela_eventos`, `resenas_moderacion` y `cupones_gestion`, las funciones de vitrina, reclamos, pasarela y medios, y los triggers de compatibilidad.
- **Deudas:** 2 en total, 1 COBRADA y 1 PENDIENTE.
- **Recompensas:** `recompensas_activo` = false.
- **Fotos de productos:** `fotos_productos` da supabase=0 y r2=0, así que no hay referencias `r2:`. Producción se publica sin `VITE_MEDIOS_*`.

## Lote

Son las 12 versiones pendientes, en el orden real y en **11 transacciones**. Coinciden byte a byte con las de `-SoloGenerar` revisadas en V1 y V2.

1. `20261009000001` a `20261009000005`: transacciones 01–05.
2. **`20261010000001` + `20261013000001`**: transacción 06. Es el par atómico de deudas con compatibilidad D11-A.
3. `20261011000001`, `20261011000002`, `20261012000001`, `20261012000002` y `20261012000003`: transacciones 07–11.

**Estado esperado al terminar:**
- 94 migraciones;
- las 35 versiones requeridas por `Comprobar-Final`;
- triggers `deudas_compat_antes` y `deudas_compat_despues`;
- `deuda_pagos` con 1 pago, el registrado para la deuda COBRADA;
- 0 deudas incoherentes;
- `cobradas_sin_pagos` = 0.

Después, un inventario nuevo lo confirma.

## Ejecución prevista

1. Claude ejecuta el aplicador **sin modificarlo**, con el host del Session pooler.
   - La contraseña se toma de un archivo local ignorado por Git, cargado como `PGPASSWORD` sin mostrarlo.
   - La confirmación escrita del usuario en el chat sustituye a la escritura de `APLICAR`, mediante `-LeerTexto`, que solo se usa para la confirmación.
2. Inventario posterior.
3. Publicación:
   - Merge fast-forward de la rama a `main`. El workflow de GitHub Pages queda solo manual: github.io conserva `0dc629e`.
   - Variables de Production en Pages: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del negocio, y `RAMA_PRODUCCION=main`. Sin Culqi ni `VITE_MEDIOS_*`.
   - Despliegue de `main` y verificación del deployment exacto.
4. Añadir `https://pos-jaise.pages.dev` a las Redirect URLs de Supabase Auth.
