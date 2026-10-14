# Guía: ramas, commits y cómo se publica

Para repasar si se me olvida. Escrita con el ejemplo real que usamos: la pestaña **Chanchito** (en pruebas) y un cambio urgente de color.

---

## 1. Las 3 piezas del flujo

```
Mi PC (npm run dev + Supabase en Docker)   ← programo y pruebo aquí
        │  git push a main
        ▼
GitHub (solo guarda el código)
        │  Cloudflare lo detecta solo
        ▼
Cloudflare Pages (pos-jaise.pages.dev)     ← lo que usan las clientas
        │  habla con
        ▼
Supabase de producción (WedJaiseReact, la base real)
```

- **Git** vive en mi PC. Funciona sin internet.
- **GitHub** es una copia en la nube. Solo recibe lo que yo envío con `git push`.
- **Cloudflare** publica solo cuando llega un push a `main`.
- Supabase **staging** y el Supabase de **Docker** son ensayos: no los ve nadie.

> Importante: un push a `main` publica **el código**, pero **no aplica migraciones** a la base real. Eso se hace aparte, con confirmación explícita.

---

## 2. Qué es una rama (sin enredos)

- Mi carpeta del proyecto es **una sola**. Las ramas no son carpetas distintas.
- Una rama es una **versión guardada** dentro de git. Al cambiar de rama, git reescribe los archivos de mi carpeta para que coincidan con esa versión.
- `main` = lo que está guardado y publicado. Es lo que ve la clienta.
- Una rama nueva **nace como copia exacta** de donde estaba. No nace vacía.

### Escritorio y archivadores
- Los archivos **sueltos** en mi carpeta (sin commit) son como papeles sobre el escritorio.
- El **commit** guarda esos papeles dentro de un archivador (la rama).
- Al cambiar de rama, los papeles guardados en otro archivador **desaparecen del escritorio**, pero no se borran: siguen guardados en su rama.

### Lo que NO sube a ninguna parte
- `git commit` guarda **solo en mi PC**.
- `git push` es lo que envía a GitHub. Sin push, una rama existe solo en mi PC y Cloudflare ni se entera.

---

## 3. Qué hace cada comando

| Comando | Qué hace |
|---|---|
| `git status` | Muestra en qué rama estoy y qué archivos están sueltos |
| `git branch` | Lista las ramas (la que tiene `*` es donde estoy) |
| `git checkout -b chanchito` | **Crea** la rama `chanchito` y me pasa a ella (`-b` = créala) |
| `git checkout main` | Me pasa a `main` (sin `-b`, porque ya existe) |
| `git add archivo1 archivo2` | Elijo qué archivos entran al commit |
| `git commit -m "mensaje"` | Guarda lo elegido en la rama actual (solo en mi PC) |
| `git push` | Envía la rama actual a GitHub |
| `git merge chanchito` | Trae a la rama actual lo que hay en `chanchito` |

**Nunca usar `git add .`** en este repo: la carpeta `.codex/` tiene cientos de archivos sueltos y se colarían en el commit. Siempre `git add` con los archivos concretos.

---

## 4. El caso: Chanchito en pruebas + cambio urgente

Situación: la pestaña Chanchito está a medias, y la clienta pide **ya** un cambio de color. Chanchito no debe verse en producción todavía.

### Paso A: guardar Chanchito en su propia rama
```
git checkout -b chanchito
git add src/components/PestanasCacheadas.jsx src/config/navegacion.js src/components/ModalChanchito.jsx src/pages/Chanchito.jsx supabase/migrations/20261013000002_chanchito_movimientos.sql
git commit -m "Chanchito: pestaña de ahorro del admin (en pruebas)"
```
Sin push. Chanchito queda guardado **solo** en la rama `chanchito`.

### Paso B: volver a main
```
git checkout main
```
Los archivos de Chanchito desaparecen de mi carpeta (siguen guardados en su rama). `main` queda como está en producción.

### Paso C: el cambio urgente
1. Hago el cambio de color.
2. Lo pruebo con `npm run dev`.
3. `git add` de los archivos del cambio, `git commit`, `git push`.
4. Cloudflare publica solo. Compruebo en Cloudflare → `pos-jaise` → Despliegues que aparezca uno nuevo con ✓ y el commit nuevo.

### Paso D: volver a seguir con Chanchito
```
git checkout chanchito
git merge main
```
Los archivos reaparecen. `merge main` le trae el cambio de color, para que la rama no se quede atrasada.

### Paso E: cuando la clienta apruebe Chanchito
```
git checkout main
git merge chanchito
```
Luego:
1. Aplicar la migración de Chanchito a producción (**pidiendo confirmación explícita**, ver sección 6).
2. `git push` → Cloudflare publica la pestaña.

### Dibujo del recorrido
```
Paso A:   main:       A ── B
                            \
          chanchito:         C        (C = Chanchito)

Paso C:   main:       A ── B ── D     (D = color, publicado)
                            \
          chanchito:         C

Paso D:   main:       A ── B ── D
                            \     \
          chanchito:         C ─── E  (E = Chanchito + color)

Paso E:   main:       A ── B ── D ── F   (F = todo junto, publicado)
```

---

## 5. Cosas que me confundieron (y la respuesta)

**"Si creo la rama, ¿no se copia Chanchito a las dos?"**
No. `main` solo tiene lo que tiene **commit**. Chanchito estaba suelto, sin commit, así que `main` no lo tenía. La rama nueva nace como copia de `main` (sin Chanchito); el commit lo guarda solo en `chanchito`.

**"¿Hay que crear la rama antes de crear los archivos?"**
Es lo más limpio, pero no es obligatorio. Los archivos sueltos no pertenecen a ninguna rama hasta el commit. Ojo solo si ya mezclé Chanchito con **otros cambios**: ahí hay que hacer `git add` solo de los archivos de Chanchito. Los demás cambios sin commit me acompañan al volver a `main`. Si un mismo archivo tiene cambios de las dos cosas, se separa con `git add -p`.

**"¿Cómo modifico Chanchito después?"**
Estando en la rama `chanchito` (`git checkout chanchito`). En `main` esos archivos no existen.

**"¿La rama también debe estar en GitHub?"**
No hace falta. Si quiero respaldo en la nube: `git push -u origin chanchito`. Esa rama no se publica (Cloudflare solo mira `main`), pero GitHub volvería a tener 2 ramas. El respaldo no se actualiza solo: hay que repetir `git push` cada vez.

**"Para probar Chanchito con npm run dev, ¿en qué rama estoy?"**
En `chanchito`. En `main` la pestaña no existe.

---

## 6. Migraciones de base de datos

- Viven en `supabase/migrations/` y van **junto a la rama** de su función (la de Chanchito está en la rama `chanchito`).
- Se prueban **primero en el Supabase local de Docker**. Para aplicarla a mano: Studio local (`http://127.0.0.1:54323`) → SQL Editor → pegar el archivo → Run. O por línea de comando:
  ```
  docker exec -i supabase_db_WedJaiseReact psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/ARCHIVO.sql
  ```
- A **producción** solo se aplica con confirmación explícita, después de probarla en local. El push del código no la aplica.
- Si publico código que usa una tabla que aún no existe en producción, esa pantalla falla. Por eso la migración se aplica **antes** (o a la vez) que se publica la pestaña.

---

## 7. Chuleta rápida

```
¿En qué rama estoy y qué hay suelto?   git status
Ver ramas                              git branch
Crear rama y entrar                    git checkout -b nombre
Cambiar de rama                        git checkout nombre
Guardar archivos concretos             git add a.jsx b.jsx
Guardar (solo en mi PC)                git commit -m "mensaje"
Enviar a GitHub (publica si es main)   git push
Traer cambios de otra rama             git merge otra-rama
```

**Reglas de oro**
1. `git status` antes de cada commit.
2. Nunca `git add .`.
3. Lo que llega a `main` y se hace push **se publica solo**.
4. Una migración a producción: siempre con confirmación explícita.
5. Probar en local (`npm run dev` + Docker) antes del push.
