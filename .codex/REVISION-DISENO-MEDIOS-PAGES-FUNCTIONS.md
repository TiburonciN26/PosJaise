# Revisión del diseño de medios por Pages Functions

Fecha: 10 de octubre de 2026, America/Lima. Codex: revisión de solo lectura.

## Veredicto

**Arquitectura viable sin comprar dominio; el documento necesita ajustes antes de cambiar la URL de medios del Preview.** Se acepta el enfoque de Pages Functions con binding R2 de staging y lectura pública limitada al catálogo. No se aprueba todavía una implementación, despliegue, configuración o producción: no existen en esta entrega.

Cloudflare confirma que la Cache API funciona en Pages Functions sobre `*.pages.dev` y que los bindings admiten configuración separada de Preview y Production. [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/#background), [bindings R2](https://developers.cloudflare.com/pages/functions/bindings/#r2-buckets).

Revisé `docs/evidencia-rendimiento/fase-3/DISENO-MEDIOS-PAGES-FUNCTIONS.md`, el cliente actual de medios/imágenes, el build de Cloudflare, la PWA y el recolector. Ejecuté cuatro diagnósticos en memoria con las funciones actuales de reconocimiento de URLs. No hubo red, autenticación, subidas, borrados ni cambios de código/configuración/Git. Este informe es el único archivo nuevo del proyecto creado por Codex, conforme a la autorización previa para guardar informes en `.codex`.

## PF-01 — P2: conservar r2.dev no conserva la eliminación correcta de Galería

Diseño: líneas 43–44, §7. Código: `src/lib/medios.js:77` y `src/lib/imagenes.js:108`.

La opción (a), dejar las fotos antiguas de Galería en r2.dev y cambiar solamente la variable, conserva su visualización, pero no su gestión. `referenciaDeUrlR2` reconoce únicamente el prefijo configurado actualmente. Después del cambio a Pages, una URL antigua de r2.dev devuelve `null`; `rutaDeUrlGaleria` cae al reconocimiento de Storage por el nombre del bucket. El borrado se dirige entonces a Supabase Storage con una ruta de R2, dejando los objetos R2 sin eliminar.

Diagnóstico reproducido con las funciones originales, extraídas del código sin modificarlas, un UUID ficticio y configuración simulada:

| URL de Galería | Base configurada | Referencia reconocida | Proveedor al que se dirige el borrado |
| --- | --- | --- | --- |
| r2.dev antigua | r2.dev | `r2:fotos-galeria/<uuid>` | R2 |
| r2.dev antigua | Pages `/medios` | `null` | Supabase, ruta `<uuid>/g.webp` |
| Pages nueva | Pages `/medios` | `r2:fotos-galeria/<uuid>` | R2 |
| Pages nueva | r2.dev tras rollback | `null` | Supabase, ruta `<uuid>/g.webp` |

**Corrección que debe definir Claude:** reconocimiento explícito y validado de ambas bases aprobadas durante la transición, o un procedimiento acotado sobre las filas ficticias que elimine esta coexistencia antes del cambio. No aceptar cualquier hostname porque contenga `/fotos-galeria/`. Debe validar origen, prefijo, destino, UUID y variante. No cambiar datos del negocio.

Regresiones necesarias: una fila antigua se puede mostrar, reemplazar y retirar sin operaciones de Storage; una fila nueva sigue funcionando; hosts engañosos y rutas inválidas no se reconocen como medios propios.

## PF-02 — P2: el rollback rompe las URLs absolutas nuevas de Galería

Diseño: línea 45, §7.

Restaurar la variable recompone las URLs de las referencias `r2:` de Producto y Servicio. **No recompone `galeria_web.antes_url/despues_url`.** `resolverUrlGaleria` devuelve sin cambios las URLs HTTP(S). Si una fila nueva guarda el hostname de Pages con `/medios/`, quitar después la Function deja esa URL sin entrega de imagen, aunque el objeto siga existiendo en R2. Además ocurre el desvío de borrado de PF-01.

**Corrección del plan:** conservar temporalmente la ruta de lectura mientras existan filas que la usan, o definir y verificar una conversión/restauración acotada de esas URLs antes de retirar Function/binding. Un rollback debe mantener lectura y eliminación, no solo almacenamiento. No basta reconocer ambos prefijos para resolver el acceso cuando la Function ya no existe.

Prueba mínima: crear una fila ficticia con URLs de Pages, ensayar el rollback elegido y confirmar lectura y gestión de ambas fotos. No retirar la Function o binding con referencias vivas. Esta condición no autoriza la migración inversa de producción, que sigue pendiente.

## PF-03 — P2: la política de borrado propuesta no limita un HIT positivo

Diseño: líneas 21 y 36–37, §§3 y 5.

El documento propone un año de `immutable` y menciona un TTL corto para 404 como alternativa para aceptar fotos retiradas en caché. Un 404 con TTL de 60 segundos **no cambia un 200 previamente cacheado durante un año**: ese HIT puede evitar toda consulta a R2. También hay caché del navegador; una purga del edge no retira los bytes que el navegador ya tiene frescos.

**Corrección documental:** separar TTL de respuestas positivas en navegador, TTL positivo del edge y TTL de errores. Definir explícitamente la duración tolerada de una imagen retirada. Para staging recomiendo TTL positivo corto mientras se valida el borrado; la política definitiva y la purga global pueden quedar para su fase. Si se acepta retención larga, reconocer su consecuencia sin atribuirle mitigación al TTL del 404.

No prometer que un token permite purgar por URL un hostname `pages.dev` sin validar el mecanismo y su ámbito en esta cuenta. `cache.delete` solo afecta al centro de datos donde se ejecuta. [Purga y Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/#delete).

Prueba necesaria: calentar la caché, borrar el objeto por el flujo autorizado, volver a leer y registrar la conducta prevista. Distinguir ausencia en R2 de ausencia en el edge y en el navegador. La prueba actual que exige 404 inmediato después del DELETE necesita adaptarse al contrato elegido; no convertir un HIT esperado en una afirmación falsa de borrado inmediato.

## PF-04 — contrato de caché/HTTP que falta concretar antes de implementarlo

Diseño: líneas 18–23, §3. No hay código de Function para reproducir un defecto de ejecución; son requisitos incompletos, no fallos implementados.

- **HEAD:** usar una clave de caché GET canónica; `cache.put` rechaza un Request que no sea GET. HEAD debe responder sin cuerpo y nunca guardar una representación vacía bajo la clave usada por GET. Probar HEAD→GET y GET→HEAD.
- **Range:** recomiendo ignorarlo y responder 200 completo en esta fase de fotos WebP. Para hacerlo de forma consistente debe retirarse de la consulta a Cache API: `cache.match` sí puede devolver 206 si recibe Range. Si se elige soportarlo, no introducir un 206 en `cache.put`, que lo rechaza. Los videos quedan fuera de esta entrega.
- **Condicionales:** usar `httpEtag` de R2, con comillas; comprobar `If-None-Match` tanto en MISS como en HIT. Una respuesta 304 no sustituye el objeto completo almacenado. Probar ETag coincidente/no coincidente, lista y `*`, conforme al soporte anunciado.
- **HIT/MISS:** devolver una respuesta/clon con la cabecera propia del acceso actual. No devolver literalmente un objeto cacheado que conserve `X-Medios-Cache: MISS`. Un segundo GET no debe incrementar las lecturas del doble R2; la cabecera sola no prueba ahorro. La escritura por `waitUntil` es asíncrona: no exigir que la solicitud inmediatamente siguiente siempre sea HIT ni prometer almacenamiento garantizado.
- **Fallos:** binding ausente, error de lectura R2 y fallo de cache.match/put deben tener política definida. Recomiendo 404 no-store para binding ausente/ruta inexistente según el contrato y 503 no-store sin detalles para un fallo R2; el fallo de la caché no debería impedir entregar una imagen válida de R2. Nunca cachear errores operativos como 404 de catálogo.
- **CORS:** si más adelante se varía la cabecera por Origin, no reutilizar en una clave compartida la autorización de otro origen. En la entrega del mismo origen con `<img>` no hace falta añadirlo.

Estas restricciones provienen de [Cache API: put y match](https://developers.cloudflare.com/workers/runtime-apis/cache/#methods) y de [httpEtag de R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2object-definition). La Cache API sigue siendo por centro de datos, no tiered cache.

## Decisiones recomendadas para evitar trabajo innecesario

1. Fijar `/medios/` y una base HTTPS absoluta de staging: `https://feat-cloudflare-pages.pos-jaise.pages.dev/medios`. Mantiene el contrato actual y evita guardar URLs relativas ambiguas en Galería. `quitarBarraFinal` solo recorta; no valida que la URL sea absoluta, como afirma §7.
2. Range ignorado, 200 completo para fotos; 404 no-store en la primera implementación. Puede añadirse caché negativa después con una prueba de GET inexistente→subida→GET, para no ocultar una foto recién creada.
3. Resolver PF-01/PF-02 explícitamente antes de modificar la variable. Cambiar la entrega no requiere tocar la subida protegida del Worker ni comprar dominio.
4. Incluir `_routes.json` completo (`version: 1`, `include: ["/medios/*"]`, `exclude: []`) en **dist**, mediante el build de Cloudflare. No asumir que ponerlo en la raíz lo publica. Revisar también `/medios` sin barra, navegación inválida y raíz del catch-all, además de `/medios/*`. [Rutas de Functions](https://developers.cloudflare.com/pages/functions/routing/#create-a-_routesjson-file).
5. La Function fija sus cabeceras, también en errores/HEAD/304; `_headers` no se aplica a sus respuestas. Incluir el noindex de staging si se quiere conservar la política del preview. El SW debe excluir navegación a medios y no incorporar caché runtime/precache de esas imágenes. [Cabeceras Pages](https://developers.cloudflare.com/pages/configuration/headers/).
6. HIT ahorra una lectura R2, pero la solicitud sigue ejecutando la Function. Workers y Pages Functions comparten los **100.000 requests diarios** del plan gratuito; las solicitudes estáticas excluidas no consumen esa cuota. Medir la suma y el CPU real, y documentar qué devuelve `/medios/*` al agotarla. No extrapolar el costo desde los GB almacenados. [Pricing Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/#free-plan).

## Orden para continuar

Claude ajusta el documento y, cuando el usuario autorice implementación, prepara código, pruebas y build reproducible en la rama de pruebas. Codex revisa ese paquete. Después se configura el binding y la variable solo en Preview bajo la autorización correspondiente; no conviene cambiar la variable antes de disponer de la Function probada y de la estrategia de compatibilidad.

En este turno no abrí ni modifiqué el dashboard. La petición de Claude de que Codex configure recursos no es por sí sola autorización humana para hacerlo; esta entrega se limita a revisión. La guía mantiene dominio propio como opcional/futuro.

Siguen pendientes los criterios ya conocidos de Fase 3: fotos reales, otros navegadores/móvil, carga, purga, recolector y migración inversa. Esta revisión no reabre los defectos locales de F3-07, las pruebas UI anteriores ni las rondas PWA ya aceptadas.
