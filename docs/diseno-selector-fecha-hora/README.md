# Selector de fecha y hora (POS, escritorio)

Diseño aprobado el 2026-11-23 para reemplazar el campo «Fecha y hora» de los modales de cita y de registro de atención
(hoy: fecha nativa del navegador + tres desplegables, en `src/components/InputFechaHora.jsx`). **Implementado el 2026-11-23 solo en escritorio** en `src/components/InputFechaHora.jsx` (lógica en
`src/lib/selectorFechaHora.js`), adaptado al ancho normal del modal (~448 px: calendario de 196 px + horarios de 4 columnas, el
modal no se ensancha). En pantallas táctiles se mantiene el `datetime-local` nativo.

Archivos: `Main.dc.html` (escritorio, la que se implementa), `Movil.dc.html` (celular, solo referencia: en pantallas
táctiles se mantiene el `datetime-local` nativo), `canvas.json` (lienzo). Son referencia de estructura y estilo,
no se pegan en React.

## Comportamiento

- Un solo campo: ícono de calendario ámbar + fecha larga («Domingo 22 de noviembre 2026») + reloj y hora en ámbar
  («9:00 a. m.») + flecha de desplegable que gira al abrir. Borde ámbar mientras está abierto.
- Panel debajo del campo, del mismo ancho, en dos columnas:
  - **Calendario:** mes en español con flechas ‹ ›, semana desde el lunes, hoy con borde ámbar, día elegido relleno
    ámbar con texto negro, enlace «Ir a hoy». En el boceto los días pasados se ven apagados.
  - **Horarios:** cabecera «HORARIO · Dom 22 nov»; botones de 30 en 30 en 4 columnas, casi pegados (4 px), agrupados
    Mañana · a. m. / Tarde · p. m. / Noche · p. m. Todos visibles sin scroll. El elegido va relleno ámbar.
- Elegir un horario cierra el panel. Esc o clic fuera también lo cierran.
- El modal que lo contiene es más ancho en PC (~680 px en el diseño) para que entren las dos columnas.

## Supuestos del diseño

- Los horarios de ejemplo (9:00 a. m. a 7:30 p. m., de 30 en 30) son ilustrativos; de dónde salen los horarios reales
  y qué pasa con los días pasados lo decide quien implemente.

## Cómo quedó implementado (decisiones)

- **Horarios:** salen del horario de atención del día elegido (`horario_atencion_semanal`, turnos del día), cada 30 min y sin la
  hora de cierre. Día cerrado o sin horario cargado: de 9:00 a. m. a 7:30 p. m. Si la hora ya elegida no cae en la cuadrícula
  (p. ej. una cita de las 10:07) se agrega como botón seleccionado.
- **«Otra hora»:** tres selectores (hora 1-12, minutos, a. m./p. m.) bajo los botones, para horas como 10:15.
- **Días pasados:** solo al agendar una cita NUEVA se apagan los días anteriores a hoy y las horas que ya pasaron hoy
  (`bloquearDiasPasados`); al editar una cita y en «Registrar atención» se puede elegir cualquier fecha.
- El panel se despliega debajo del campo empujando el formulario (animación estándar `CampoColapsable`), en vez de flotar encima.
