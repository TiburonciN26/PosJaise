# Desplegables (filas, tarjetas, acordeones): deslizamiento suave + cabecera que se pinta

**Regla del proyecto (pedida varias veces por la dueña — no volver a preguntarla):** todo registro/tarjeta/bloque que se
despliega **se desliza suavemente al abrir y al cerrar** y su cabecera **se pinta al abrir y vuelve a la normalidad al cerrar**.
Nunca `{abierto && <Detalle />}` a secas: aparece de golpe y se corta al cerrar.

## Receta (copiar tal cual)

```jsx
import BotonFlechaDesplegable from './BotonFlechaDesplegable.jsx'
import CampoColapsable from './CampoColapsable.jsx'

<li className="rounded-lg border border-border">
  {/* Toda la cabecera abre/cierra; la flechita para la propagación para no alternar dos veces. */}
  <div className="flex cursor-pointer items-center gap-2 px-3 py-2" onClick={alternar}>
    <p className={`min-w-0 flex-1 text-sm font-medium transition-colors duration-300 ${abierto ? 'text-<color del tema>' : 'text-ink'}`}>
      {titulo}
    </p>
    <span className="shrink-0 whitespace-nowrap font-mono text-sm">{monto}</span>
    <BotonFlechaDesplegable abierto={abierto} onClick={(e) => { e.stopPropagation(); alternar() }} />
  </div>
  <CampoColapsable abierto={abierto} diferido>
    <div className="border-t border-border px-3 py-3">{detalle}</div>
  </CampoColapsable>
</li>
```

- **Deslizamiento:** `CampoColapsable` (`src/components/CampoColapsable.jsx`): `grid-template-rows` 0fr ↔ 1fr + fundido, 300 ms
  `ease-in-out`. Con `diferido` el contenido solo existe en el DOM mientras está abierto (más lo que dura el cierre): úsalo en listas.
  Si el contenido ya está montado y solo se oculta (p. ej. «Ver N más»), `inert` cuando está cerrado.
- **Cabecera que se pinta:** el título toma el color del tema de la pantalla al abrir (Inventario/POS: `text-amber`; Dashboard:
  `text-purple-300`; Mi Panel: rosa) con `transition-colors duration-300`, y vuelve a `text-ink` al cerrar.
- **Flecha:** `BotonFlechaDesplegable` (rota 180° con `transition-transform`), que usa `IconoFlechaDesplegable`.
- **Una sola fila al cerrar (móvil):** cerrado = título + monto + flecha, en una línea (`truncate`; abierto se muestra completo con
  `break-words`). Todo lo demás (cálculos, fechas, quién, cuánto) va dentro del desplegable, en una cuadrícula «etiqueta / valor»
  (`grid-cols-2`) y, para listas de movimientos, filas de dos líneas con el monto a la derecha y `cantidad × precio` chico debajo.
  Evitar «1 × S/ 45.00 = S/ 45.00» a media pantalla: ocupa el ancho y rompe el resto en varias líneas.

## Dónde está aplicado
`DetalleDesplegableProducto` / Inventario, `ProveedoresDelProducto` («Ver N más»), `MenuLateral` (subpestañas),
`FilaExpandible` en `DetalleDashboard.jsx`.

## Lista flotante (selector que cae debajo de un botón)
No es un desplegable de contenido: copiar `BotonMes` de `FiltrosFecha.jsx` (botón redondeado con flechita + `ul role="listbox"`
absoluta; se cierra al tocar fuera o con Esc). `SelectorRubro` de `DetalleDashboard.jsx` es otra copia.
