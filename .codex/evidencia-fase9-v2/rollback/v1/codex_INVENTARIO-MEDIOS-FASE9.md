# Inventario de medios · Fase 9

Fecha: 2026-10-12. Ambiente inventariado: **Supabase Local** (`127.0.0.1:54321`, verificado por el puerto del contenedor `supabase_kong_WedJaiseReact`), en transacción `READ ONLY`. **No es un inventario de producción**: Local tiene datos de prueba y casi ningún objeto real. El de producción requiere ejecutar `scripts/migracion-medios/inventario.sql` (solo lectura) en ese ambiente, con autorización (§4). Datos completos: `evidencia-fase9/inventario-local.json` (sin valores ni rutas de comprobantes).

## 1. Columnas con referencias a medios

| Columna | Filas | No nulos | Clasificación | Formatos | Migrables | Observación |
| --- | ---: | ---: | --- | --- | ---: | --- |
| `productos.foto_url` | 3.245 | 16 | público catálogo | ruta de Storage 16 | **1** | 15 rotas: `ruta/p.webp`, sin objeto |
| `producto_fotos.foto_url` | 0 | 0 | público catálogo | — | 0 | |
| `servicios.foto_url` | 3.340 | 1 | público catálogo | ruta 1 | **1** | |
| `servicio_fotos.foto_url` | 2 | 2 | público catálogo | ruta 2 | **2** | |
| `galeria_web.antes_url` | 39 | 39 | público catálogo | URL de Storage 3, recurso del build 36 | **3** | 35 apuntan a `TEST/antes.png`, que no existe en `public/`; 1 recurso real (`inicio-web/…`) |
| `galeria_web.despues_url` | 39 | 39 | público catálogo | URL de Storage 3, recurso del build 36 | **3** | ídem |
| `usuarios.foto_url` | 36 | 1 | público **personal** | ruta 1 | 0 | fuera de alcance |
| `clientes.foto_url` | 4.749 | 0 | público **personal** | — | 0 | |
| `asistentes.foto_url` | 12 | 3 | público **personal** | ruta 3 | 0 | fuera de alcance (fotos del equipo en el portal) |
| `estado_negocio.yape_qr_url` / `plin_qr_url` | 1 / 1 | 1 / 0 | público del negocio | ruta 1 | 0 | fuera de alcance |
| `mobiliario.foto_url` | 43 | 0 | valor directo | — | 0 | |
| `pedidos_web.comprobante_url` | 429 | 429 | **privado** | ruta 429 | 0 | excluido siempre |
| `citas.comprobante_url` | 299 | 46 | **privado** | ruta 46 | 0 | excluido siempre |

Totales: 577 referencias no nulas, de las cuales **10 son migrables** y corresponden a **10 objetos** distintos. Hay 85 referencias rotas dentro del catálogo (15 de productos y 70 de galería) y 475 referencias privadas. No apareció ningún valor `r2:`, ni URL de Storage de otro proyecto, ni URL externa.

## 2. Objetos de Storage por bucket

| Bucket | Clasificación | Objetos | Bytes | Referenciados | Sin referencia |
| --- | --- | ---: | ---: | ---: | ---: |
| `fotos-productos` | público catálogo | 1 | 78.016 | 1 | 0 |
| `fotos-servicios` | público catálogo | 3 | 122.528 | 3 | 0 |
| `fotos-galeria` | público catálogo | 6 | 397.504 | 6 | 0 |
| `fotos-usuarios` | personal | 1 | 2.572 | 1 | 0 |
| `fotos-asistentes` | personal | 3 | 114.482 | 3 | 0 |
| `qr-pagos` | negocio | 1 | 87.746 | 1 | 0 |
| `comprobantes-pedidos-web` | **privado** | 380 | 6.174.776 | 371 | 9 |
| `comprobantes-citas-web` | **privado** | 46 | 191.832 | 46 | 0 |

`fotos-clientes` existe y está vacío. Los «sin referencia» privados se informan solo como conteo: esta fase no los trata ni lista sus rutas.

## 3. Planificación de los 10 objetos reales (solo lectura)

`planificar` descargó los 10 objetos por su URL pública, calculó el SHA-256 de los bytes y sus medidas, y `copiar` **sin `--aplicar`** generó las variantes. No se subió nada ni se cambió ninguna fila (huella de la base idéntica). Los 10 son WebP producidos por la app, con un máximo de 1050×1400 px, y todos cumplen las condiciones para que su `g` sea el **original sin recodificar**. `m` ocupa entre 1,3 y 13,9 kB. Detalle en `evidencia-fase9/manifiesto-dataset.json`.

## 4. Inventario de otro ambiente (no ejecutado)

1. Con autorización, ejecutar `scripts/migracion-medios/inventario.sql` en el editor SQL del ambiente. Es una transacción `READ ONLY` y devuelve un solo JSON. Guardar la salida fuera del repositorio si contiene datos reales.
2. Ejecutar `node scripts/migracion-medios/medios-migracion.mjs inventariar --desde-json=<salida> --env-file=<entorno de ese ambiente> --salida=<informe>`. Esto solo clasifica y no se conecta a nada.
3. Revisar en particular:
   - **referencias rotas**: no se migran;
   - **URL de Storage de otro proyecto**: filas copiadas entre ambientes, a revisión manual;
   - objetos sin referencia, que no se copian;
   - los perfiles, para la decisión pendiente;
   - el volumen total, para la caché local y el tiempo.

El MCP de Supabase no estaba disponible en esta sesión y la autorización excluye operar en remoto, así que no se leyó staging ni producción.
