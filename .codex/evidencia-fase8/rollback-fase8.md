# Rollback de la Fase 8 (solo local; nada está commiteado)

Los cambios son 5 archivos modificados, 1 componente nuevo, 14 imágenes generadas y 4 scripts. **No hay migraciones ni cambios de base de datos ni de hosting.**

## 1. Archivos modificados (restaurar exactamente el estado previo)

Copias byte a byte del estado inmediatamente anterior a la Fase 8 (incluye los cambios de las Fases 4–7, que se conservan) en `.codex/evidencia-fase8/antes/`, con sus SHA-256 en `antes/SHA256.txt`:

| Archivo | Copia previa |
| --- | --- |
| `index.html` | `antes/index.html` |
| `vite.config.js` | `antes/vite.config.js` |
| `src/pages/cliente/InicioCliente.jsx` | `antes/src/pages/cliente/InicioCliente.jsx` |
| `src/pages/cliente/NosotrosCliente.jsx` | `antes/src/pages/cliente/NosotrosCliente.jsx` |
| `src/config/paginasCliente.js` | `antes/src_config_paginasCliente.js` |

```bash
E=.codex/evidencia-fase8/antes
cp $E/index.html index.html
cp $E/vite.config.js vite.config.js
cp $E/src/pages/cliente/InicioCliente.jsx src/pages/cliente/InicioCliente.jsx
cp $E/src/pages/cliente/NosotrosCliente.jsx src/pages/cliente/NosotrosCliente.jsx
cp $E/src_config_paginasCliente.js src/config/paginasCliente.js
```

Alternativa con parche: `git apply -R .codex/evidencia-fase8/parche-fase8.patch` desde la raíz (`git apply -R --check` correcto en el estado actual). En Windows, Git puede convertir finales de línea CRLF/LF al aplicarlo sobre copias fuera del repositorio; la restauración por copia es la referencia. Los archivos `main.jsx` y `AvisoActualizacionPWA.jsx` NO se modificaron (hashes en `SHA256.txt` iguales a los actuales).

## 2. Archivos nuevos a borrar

- `src/components/MapaDiferido.jsx`
- `public/inicio-web/{hero-despues-referencia,hero-antes-referencia}-{640,960,1280,1680}.webp` y `public/inicio-web/{despues-claro,antes-claro}-{640,960,1280}.webp` (14 archivos; los originales JPG/WebP no se tocaron)
- `scripts/generar-hero-responsivo.mjs`, `scripts/medir-fase8.cjs`, `scripts/verificar-fase8.cjs`, `scripts/comparar-visual-fase8.cjs`
- La sección §51 de `implementacionesWed.md` y la fila 8 del registro `.codex/FASES-RENDIMIENTO-CLOUDFLARE.md` (volver a «Pendiente»)

## 3. Efecto de revertir y verificación

Tras revertir, el service worker del siguiente build vuelve a precachear todo el build (≈3,5 MB). Los visitantes que ya tienen el SW nuevo recibirán el aviso «Hay una versión nueva» (con «Actualizar» bloqueado si hay trabajo pendiente, como siempre) y, al actualizar, el caché por uso `assets-por-uso` e `imagenes-del-sitio` queda huérfano hasta su expiración (30 días): no se usa y no afecta a los datos. Verificación mínima: `npm run build` sin errores, `precache 176 entries`, el mapa carga al abrir Inicio (comportamiento original), y `node scripts/verificar-fase5.cjs` (regresión) sin fallos.
Estado: la restauración desde las copias se ensayó sobre un árbol temporal y los 5 SHA-256 coinciden con `antes/SHA256.txt`; el repositorio no se modificó durante el ensayo.
