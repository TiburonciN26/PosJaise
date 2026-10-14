# Rollback de las correcciones V2 de la Fase 8 (solo local; nada está commiteado)

Dos niveles: **V2 → V1** (deshace solo estas correcciones) y, si se quiere, **V1 → antes de la Fase 8** con el rollback ya existente (`.codex/evidencia-fase8/rollback-fase8.md`). No hay migraciones, cambios de base de datos ni de hosting.

## 1. V2 → V1

### Archivos modificados por V2 (restaurar la copia V1)

Copias V1 en `rollback/v1/` con sus SHA-256 en `rollback/SHA256-v1.txt`; los SHA-256 del estado V2 están en `rollback/SHA256-v2.txt`.

| Archivo | Origen de la copia V1 |
| --- | --- |
| `src/main.jsx` | idéntica a `.codex/evidencia-fase8/antes/src/main.jsx` (V1 no lo tocó; SHA-256 `c63c6ef8…` registrado en `antes/SHA256.txt`) |
| `vite.config.js`, `src/config/paginasCliente.js` | copia «antes» de la Fase 8 + `parche-fase8.patch` de V1 aplicado con `git apply` en un árbol temporal |
| `src/App.jsx`, `src/components/PestanasCacheadas.jsx`, `src/pages/Ventas.jsx`, `src/pages/PortalCliente.jsx`, `scripts/build-cloudflare.mjs`, `cloudflare/_headers`, `scripts/verificar-fase8.cjs` | deshaciendo exactamente las sustituciones de texto de V2 (`rollback/reconstruir-v1.cjs.txt`) |

```bash
R=.codex/evidencia-fase8-v2/rollback/v1
for f in src/App.jsx src/main.jsx src/components/PestanasCacheadas.jsx src/pages/Ventas.jsx src/pages/PortalCliente.jsx \
         src/config/paginasCliente.js vite.config.js scripts/build-cloudflare.mjs cloudflare/_headers scripts/verificar-fase8.cjs; do
  cp "$R/$f" "$f"
done
rm src/lib/moduloDiferido.js src/components/LimiteCargaDiferida.jsx public/sw-reglas-cache.js scripts/verificar-fase8-v2.cjs
cp .codex/evidencia-fase8-v2/v1/POLITICA-VIDEO-FASE8-V1.md .codex/POLITICA-VIDEO-FASE8.md   # contrato de video V1 (no recomendado: ver F8-03)
```

Alternativa con parche: `git apply -R .codex/evidencia-fase8-v2/rollback/parche-v1-a-v2.patch` (incluye los 4 archivos nuevos; `git apply -R --check` correcto sobre el árbol V2). En Windows Git puede convertir finales de línea; la referencia es la restauración por copia.

### Verificación del rollback (ensayada)

Con las copias V1 restauradas **dentro del propio repositorio** (respaldo previo de los archivos V2 y restauración automática verificada por SHA-256 al terminar), `build-cloudflare` con `VITE_BUILD_ID=v1-a` produjo una salida **idéntica byte a byte** (198 archivos, SHA-256 de cada uno) al build V1 compilado al empezar la sesión antes de cualquier cambio. Un primer ensayo en una copia temporal del árbol difería solo en el CSS (y en cascada en los hashes): Tailwind v4 escanea también archivos fuera de `src/` (`docs/`, `.codex/`, maquetas) que la copia no tenía; normalizando nombres, los 196 archivos restantes eran iguales. Por eso la comprobación de referencia es la hecha en el repositorio.

### Efecto de volver a V1

- Vuelve el riesgo F8-01 (un chunk frío fallido desmonta el POS y pierde la venta) y F8-02 (la regla de imágenes admite cualquier GET del mismo origen con extensión de imagen).
- El SW de V1 no tiene la limpieza al activarse. Las entradas que haya guardado V2 no incluyen nada que V1 no admitiría; las imágenes con hash de `assets/` que V2 guarda en `assets-por-uso` V1 las busca en `imagenes-del-sitio`, así que simplemente no las usa.
- `assets-por-uso` queda con `maxEntries: 160` (V2: 300).

## 2. Hasta antes de la Fase 8

Después del paso 1, aplicar `.codex/evidencia-fase8/rollback-fase8.md` tal cual (sus copias y su parche parten del estado V1).

**Precisión sobre las cachés huérfanas (observación 1 de la revisión V1):** la frase de V1 «quedan huérfanas hasta su expiración (30 días)» no es exacta. La expiración de Workbox se ejecuta cuando la estrategia que la usa lee o actualiza esa caché; si la versión restaurada ya no tiene esas reglas, nada la dispara. `assets-por-uso` (≤ 300 entradas) e `imagenes-del-sitio` (≤ 80) pueden **persistir hasta que se borren los datos del sitio, el navegador las desaloje por cuota o una versión futura las elimine explícitamente** (p. ej. un `caches.delete` acotado a esos dos nombres en el `activate` de esa versión). No contienen datos del negocio (Supabase nunca se cachea) ni, con V2, nada privado; ocupan espacio y no se usan. No se añadió esa limpieza en V2 porque V2 sí usa ambas cachés.
