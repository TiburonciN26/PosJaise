# Punto de equilibrio — diseño «Aurora» (Dashboard POS)

`Punto de equilibrio — Dashboard.html` es el export del lienzo, con dos tableros:
**escritorio** (1200 px) y **móvil** (390 px). Es un archivo empaquetado: las páginas
van comprimidas dentro del `<script type="__bundler/manifest">`. Sirve de referencia;
no se pega en React tal cual.

Implementado en `src/components/TarjetaPuntoEquilibrio.jsx` (usado por `Dashboard.jsx`) y en las clases `.pe-*` de
`src/index.css` (2026-11-12, sección 65 de `implementacionesWed.md`).

## Estados

| Estado | Cuándo | Qué se ve |
|---|---|---|
| Aún no cubre | ingreso neto < meta | Tarjeta neutra (`surface` / `border`). Barra de 8 px con degradado lavanda (`--color-purple-300`) y perilla blanca luminosa al final del relleno. Montos `ingreso / meta` (la meta, atenuada) y el % en lavanda y negrita. |
| Meta cumplida | ingreso neto ≥ meta | Borde aurora de 1 px que gira (6 s). Dos manchas de luz a la deriva (lavanda 9 s, rosa 11 s). Barra arcoíris que fluye (5 s) con destello (3,4 s). El % va en una pastilla verde con flecha que sube. Cada 8 s, pastilla «¡Meta cumplida!» (carita que se menea) y confeti. |

## Disposición

- **PC (lg+):** una fila: título y subtítulo · barra (flex) · montos. Cada lado mide al menos 190 px.
  La pastilla y el confeti nacen del final de la barra.
- **Móvil:** título y montos arriba (montos alineados a la derecha) y la barra debajo, a lo ancho.
  La pastilla se ancla arriba a la derecha de la tarjeta y el confeti sale de esa esquina.

## Notas de implementación

- Las etiquetas «Aún no cubre · 30%» / «Meta superada · 135%» del lienzo son
  anotaciones del tablero, no parte de la tarjeta.
- La pastilla y el confeti sobresalen por arriba. Con la meta cumplida, el Dashboard reserva
  `pt-8` sobre la tarjeta (en PC, sobre toda la fila), e `isolate` evita que se pinten encima de
  los filtros sticky.
- Los colores del arcoíris y de la aurora son fijos en ambos temas. El lavanda de la barra sigue a
  `--color-purple-300`, que en el tema claro pasa a rosa, como el resto de ese acento.
- `prefers-reduced-motion` apaga todas las animaciones. La pastilla y el confeti quedan ocultos.
