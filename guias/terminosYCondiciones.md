# Guía: Términos y Condiciones + Política de cambios y devoluciones (requisito de Culqi)

> Objetivo: que la web de clientas tenga las páginas legales que Culqi exige para activar la pasarela de pago con tarjeta, y que la clienta **acepte** esos términos antes de pagar.
> Esta guía es técnica y de contenido. **No es asesoría legal**: los borradores de la sección 5 son una base razonable; conviene que un abogado (o al menos tú, leyéndolo con calma) los valide antes de publicar.

---

## 1. ¿Es gratuito?

**Sí, hacerlo es gratis.**

| Qué | Costo |
|---|---|
| Redactar los textos tú mismo (con esta guía) | S/ 0 |
| Crear las páginas en la web (código, ya tienes el stack) | S/ 0 |
| Libro de Reclamaciones virtual | S/ 0 — **ya lo tienes hecho** (`/libro-de-reclamaciones`) |
| Culqi: pedirte estos textos | S/ 0 (es un requisito de verificación, no se cobra por ello) |
| *Opcional:* que un abogado revise los textos | De pago (suele ser una consulta única, ~S/ 150–500 según el estudio) |
| *Opcional:* generadores online de plantillas | Hay gratis y de pago; no son necesarios |

Lo que **sí** tiene costo (y ya conocías) es la comisión de Culqi por cada cobro con tarjeta, no los textos legales.

---

## 2. Qué suele pedir Culqi

Culqi (como casi toda pasarela) revisa que tu web sea un comercio real y transparente. Para el comercio en línea piden, en general:

1. **Términos y Condiciones** de uso/compra, visibles en la web.
2. **Política de cambios y devoluciones** (incluye qué pasa con los reembolsos de pagos con tarjeta).
3. **Política de privacidad / protección de datos personales.**
4. **Libro de Reclamaciones** accesible desde la web (obligatorio por ley en Perú) — ✅ ya existe.
5. **Datos del comercio visibles**: razón social, RUC, dirección, teléfono/WhatsApp, correo. — parcialmente ya (pie de página usa `datos_contacto()`).
6. **Precios en soles (S/) con IGV incluido** (o indicado), y costo de delivery visible antes de pagar.
7. **Descripción clara de productos/servicios** y del proceso de entrega/atención.
8. Logos de medios de pago aceptados (Visa, Mastercard, etc.) y del procesador (opcional pero común).
9. Dominio propio con **HTTPS**.

> ⚠️ El listado exacto puede variar y cambia con el tiempo. **Antes de implementar, pídele a tu ejecutivo/a de Culqi (o revisa tu panel de comercio) su lista de verificación actual** y contrástala con esta. Si Culqi te dio una lista por correo, pégala al final de este archivo como "Checklist oficial".

---

## 3. Qué debe contener cada documento

### 3.1 Términos y Condiciones (`/terminos-y-condiciones`)

Secciones mínimas recomendadas:

1. **Identificación del proveedor**: razón social / nombre comercial ("Jaise Beauty Academy"), RUC, domicilio fiscal, correo, teléfono.
2. **Aceptación de los términos** y capacidad (mayores de edad; menores con apoderado).
3. **Objeto**: qué ofrece la web (venta de productos, reserva de servicios/citas, cuenta de clienta, puntos/recompensas).
4. **Registro y cuenta**: datos veraces, responsabilidad de la clave, suspensión por uso indebido.
5. **Precios y moneda**: soles, IGV incluido, el negocio puede actualizar precios (el precio válido es el mostrado al confirmar).
6. **Medios de pago**: tarjeta (procesada por Culqi), Yape/Plin/transferencia (con comprobante), efectivo si aplica. Indicar que **los datos de tarjeta no pasan ni se guardan en nuestros servidores** (esto es verdad en tu implementación: el token lo genera Culqi).
7. **Comprobantes**: boleta/factura, cuándo y cómo se emiten (ya tienes selección Boleta/Factura con RUC).
8. **Compra de productos**: confirmación del pedido, stock, entrega (delivery con zonas y costos / recojo en tienda), plazos de entrega, zonas de cobertura.
9. **Servicios y citas**: reserva, adelanto (si aplica), puntualidad/tolerancia, reprogramación, cancelación, inasistencia ("no show"), qué pasa con el adelanto.
10. **Cupones, promociones y puntos/sellos**: condiciones de uso, vigencia, no canjeables por dinero, no acumulables si así es, derecho a anular por fraude.
11. **Reseñas y contenido de la clienta**: solo de servicios realmente recibidos, licencia para mostrarlas, moderación.
12. **Propiedad intelectual**: marca, logos, fotos y textos son del negocio.
13. **Limitación de responsabilidad** (sin excluir lo que la ley no permite excluir).
14. **Protección de datos**: remitir a la Política de privacidad.
15. **Libro de Reclamaciones**: enlace y mención de INDECOPI.
16. **Modificaciones** de los términos y cómo se avisa; **fecha de última actualización** y versión.
17. **Ley aplicable y jurisdicción**: leyes del Perú; tribunales del domicilio del consumidor (el Código del Consumidor protege esto; no lo restrinjas).

### 3.2 Política de cambios y devoluciones (`/politica-de-cambios-y-devoluciones`)

Debe ser **específica a tu negocio** (belleza: productos de higiene + servicios que no se "devuelven"). Contenido mínimo:

**A. Productos**
- Plazo para solicitar cambio/devolución (ej. 7 días calendario desde la recepción — define tú el plazo y respétalo).
- Condiciones: sin uso, sellado, empaque original, con comprobante. **Excepciones razonables** por higiene/seguridad: productos abiertos, usados o de uso personal (tintes, cosméticos abiertos) no admiten devolución salvo defecto.
- Producto defectuoso o equivocado: cambio o devolución sin costo para la clienta (el negocio asume el recojo/envío).
- Cómo solicitarlo (WhatsApp / correo / formulario) y qué datos enviar (n.º de pedido, fotos).
- Quién paga el envío de devolución según el caso.

**B. Servicios / citas**
- Un servicio ya prestado **no es reembolsable**; si hay insatisfacción → reclamo y, según el caso, repetición del servicio o compensación.
- Cancelación/reprogramación: con cuántas horas de anticipación, sin costo.
- Adelanto: si se cancela a tiempo se devuelve/abona a otra cita; si no asiste, se pierde (decide y escríbelo).

**C. Reembolsos**
- **Pago con tarjeta**: el reembolso se hace **a la misma tarjeta** vía Culqi; plazo estimado para que el banco lo refleje (suele ser varios días hábiles; el negocio solo controla cuándo lo solicita). Indica que el monto es el cobrado (menos nada que la ley no permita descontar).
- **Yape/Plin/transferencia/efectivo**: reembolso por el mismo medio o transferencia a cuenta de la clienta, con plazo.
- Plazo máximo en que el negocio **procesa** el reembolso (ej. 7 días hábiles tras aprobar la devolución).
- Cómo se tratan **cupones y puntos** usados en un pedido devuelto (se revierten o no — dilo claro).

**D. Contacto y reclamos**: datos de contacto + enlace al Libro de Reclamaciones.

> Nota legal a verificar: la normativa peruana de protección al consumidor (**Ley 29571**) reconoce derechos en compras a distancia, incluido en ciertos casos un plazo de arrepentimiento/desistimiento y la obligación de informar. Hay excepciones (bienes personalizados, de higiene abiertos, servicios ya ejecutados). **Pide a un abogado que confirme tu texto contra el Código vigente** para que la política no sea "más restrictiva que la ley".

### 3.3 Política de privacidad (`/politica-de-privacidad`) — Culqi suele pedirla también

Mínimo: qué datos recoges (nombre, celular, correo, direcciones, historial de citas/pedidos, fotos de perfil, capturas de pago), para qué (atender pedidos/citas, comprobantes, notificaciones, puntos), con quién se comparten (Culqi para el pago, servicio de hosting/BD como proveedores — Supabase), cuánto tiempo, **derechos ARCO** (acceso, rectificación, cancelación, oposición) y cómo ejercerlos, cookies/almacenamiento local, y consentimiento. Marco: **Ley 29733 de Protección de Datos Personales** y su reglamento (confirma con un abogado si debes inscribir el banco de datos ante la Autoridad Nacional de Protección de Datos Personales).

---

## 4. Cómo implementarlo en este proyecto

### 4.1 Archivos nuevos (todo en la zona **pública** del portal cliente)

Sigue el patrón de `LibroReclamacionesCliente.jsx` (ruta pública, ya registrada en `App.jsx`, línea ~140, **antes** del bloque que exige sesión). Las clientas sin cuenta y el revisor de Culqi deben poder abrirlas sin iniciar sesión.

```
src/pages/cliente/TerminosCliente.jsx
src/pages/cliente/PoliticaCambiosCliente.jsx
src/pages/cliente/PrivacidadCliente.jsx
src/components/DocumentoLegal.jsx        <- plantilla común (título, "Última actualización", índice, secciones)
src/config/legal.js                      <- VERSION_LEGAL = '2026-10-08' + enlaces/rutas
```

Rutas (en `App.jsx`, junto a `libro-de-reclamaciones`):

```jsx
<Route path="terminos-y-condiciones" element={<TerminosCliente />} />
<Route path="politica-de-cambios-y-devoluciones" element={<PoliticaCambiosCliente />} />
<Route path="politica-de-privacidad" element={<PrivacidadCliente />} />
```

Revisa también `src/config/paginasCliente.js` / `navegacionCliente.js`: si cada ruta pública se declara ahí (títulos, SEO, menú), registra las tres allí **sin** meterlas en el menú lateral (solo en el pie).

> Decisión recomendada: **texto estático dentro del código (JSX)**, no en base de datos. Es más simple, versionado por git, cero migraciones y el revisor de Culqi las ve siempre. Solo pasarías a BD si quisieras que la admin edite el texto desde el panel (no es necesario ahora).

### 4.2 Datos del negocio sin duplicar

Ya existe `datos_contacto()` (RPC) y el Libro de Reclamaciones muestra `razon_social` y `ruc`. En las páginas legales, **lee esos mismos datos** (RPC) en vez de escribirlos a mano, para que no queden desactualizados. Si `datos_contacto()` aún no devuelve `razon_social`/`ruc`/`direccion`, revisa de dónde los saca `LibroReclamacionesCliente.jsx` (`proveedor`) y reutiliza esa fuente.

### 4.3 Enlaces en el pie (`PieClienteWeb.jsx`, junto al botón del Libro de Reclamaciones)

Añadir tres `<Link>` (Términos y condiciones · Cambios y devoluciones · Privacidad). El pie ya es visible en todo el portal, que es lo que Culqi revisa.

### 4.4 Aceptación explícita antes de pagar (importante)

Culqi/INDECOPI valoran que la clienta **acepte** los términos, no solo que existan:

1. **`CarritoCliente.jsx`** (productos) y **`CarritoServiciosCliente.jsx`** (citas con adelanto): checkbox
   `☐ He leído y acepto los Términos y condiciones y la Política de cambios y devoluciones` (con enlaces que abren en pestaña nueva), obligatorio para habilitar el botón de pagar/confirmar. Usa la convención del repo: label + `*` rojo (`<Etiqueta obligatorio>`). El botón verde `#3ECF6A` de "Confirmar pedido" queda deshabilitado hasta marcarlo.
2. **Registro de cuenta** (`Login.jsx`/alta de clienta): mismo checkbox con Términos + Privacidad.
3. Mostrar, cerca del botón de pago con tarjeta, una línea: *"Pago seguro procesado por Culqi. No guardamos los datos de tu tarjeta."* + logos de tarjetas.

### 4.5 (Opcional pero recomendable) Guardar la prueba de aceptación

Para poder demostrar ante un reclamo que la clienta aceptó una versión concreta:

- Migración nueva en `supabase/migrations/YYYYMMDDHHMMSS_aceptacion_terminos.sql` (envuelta en `begin; ... commit;`, con comentarios de **por qué**). **No** en `supabase/sql/`.
- Opción simple: columnas `terminos_version text` y `terminos_aceptados_at timestamptz` en `pedidos_web` (y en `perfiles`/clientas si se acepta al registrarse). Se rellenan en la RPC que ya confirma el pedido, con `VERSION_LEGAL` enviada desde el cliente.
- **Recuerda las reglas del repo**: si la tabla da `SELECT/INSERT/UPDATE` a nivel tabla, la columna hereda el grant; si no, grant explícito (en este proyecto `authenticated` no recibe grants por defecto). Y `productos` es la excepción con grants por columna (no tocarla aquí).
- Flujo QA: primero `supabase migration up` en Local; **a producción solo con tu confirmación explícita** (vía MCP).

Si no quieres tocar la BD ahora, puedes saltarte 4.5: el checkbox obligatorio en el front ya cumple lo que pide la pasarela. Es una mejora de defensa legal, no un requisito de Culqi.

### 4.6 Qué NO hacer

- No copiar términos de otra empresa sin adaptarlos (mencionarían otra razón social, plazos y reglas que no son las tuyas).
- No prometer plazos de reembolso que no controlas (el banco decide cuándo se ve en la tarjeta).
- No dejar `[CORCHETES]` o "lorem ipsum" publicados.
- No poner los textos detrás de login.

---

## 5. Borradores de texto (para adaptar)

Reemplaza todo lo que está en `[CORCHETES]` con tus datos reales y **ajusta cada número (plazos, horas, porcentajes) a lo que de verdad vas a cumplir**.

### 5.1 Términos y Condiciones — borrador

```
TÉRMINOS Y CONDICIONES — Jaise Beauty Academy
Última actualización: [fecha]  ·  Versión: [2026-10-08]

1. Quiénes somos
[RAZÓN SOCIAL], con RUC [RUC], domicilio en [DIRECCIÓN], correo [CORREO] y
WhatsApp [TELÉFONO] (en adelante, "Jaise Beauty Academy", "nosotros"),
administra este sitio web, donde puedes comprar productos y reservar
servicios de belleza.

2. Aceptación
Al crear una cuenta, reservar una cita o realizar una compra declaras que
eres mayor de edad (o actúas con autorización de tu apoderado), que leíste
estos términos y que los aceptas. Si no estás de acuerdo, no uses el sitio.

3. Tu cuenta
Debes dar datos verdaderos y mantener tu contraseña en reserva. Eres
responsable de lo que se haga con tu cuenta. Podemos suspenderla ante uso
fraudulento o abusivo.

4. Precios y pagos
Los precios están en soles (S/) e incluyen IGV [confirmar]. El precio válido
es el que ves al confirmar tu compra. Aceptamos [tarjeta de débito/crédito,
Yape, Plin, transferencia, efectivo en tienda]. Los pagos con tarjeta son
procesados por Culqi; nosotros no recibimos ni guardamos los datos de tu
tarjeta. Emitimos boleta o factura según tu elección.

5. Compra de productos
Un pedido se considera confirmado cuando [el pago es validado / te lo
confirmamos]. Sujeto a stock; si un producto no está disponible, te
avisaremos y reembolsaremos lo pagado. Entregamos por delivery en las zonas y
costos indicados al momento de la compra, o puedes recoger en tienda. Plazo
estimado: [X] días hábiles / [mismo día en zonas A].

6. Reserva de servicios
Puedes reservar fecha y hora en el sitio. [Se requiere un adelanto de S/ X /
X% del servicio.] Tolerancia de llegada: [X] minutos. Puedes cancelar o
reprogramar sin costo hasta [X] horas antes. Si cancelas fuera de plazo o no
asistes, [el adelanto no se devuelve / se pierde]. Si nosotros cancelamos, te
ofrecemos otra fecha o la devolución íntegra de lo pagado.

7. Cupones, promociones y puntos
Se rigen por las condiciones indicadas en cada uno (vigencia, monto mínimo,
combinabilidad). No son canjeables por dinero. Podemos anularlos ante fraude
o uso indebido.

8. Reseñas
Solo puedes reseñar servicios que realmente recibiste. Podemos moderar o
retirar contenido ofensivo, falso o ilegal, y mostrar tus reseñas en el sitio.

9. Cambios, devoluciones y reembolsos
Se rigen por nuestra Política de cambios y devoluciones: [enlace].

10. Datos personales
Tratamos tus datos según nuestra Política de privacidad: [enlace].

11. Propiedad intelectual
Marca, logos, fotos y textos pertenecen a Jaise Beauty Academy. No puedes
usarlos sin autorización escrita.

12. Responsabilidad
Respondemos conforme a la ley. No somos responsables por interrupciones del
sitio ajenas a nuestro control ni por el uso que hagas de la información.

13. Reclamos
Contamos con Libro de Reclamaciones virtual: [enlace /libro-de-reclamaciones].
También puedes acudir a INDECOPI.

14. Cambios a estos términos
Podemos actualizarlos; publicaremos la nueva versión con su fecha. Las
compras ya realizadas se rigen por la versión vigente al comprar.

15. Ley aplicable
Leyes de la República del Perú. Para cualquier controversia, puedes acudir a
los tribunales competentes de tu domicilio y a INDECOPI.
```

### 5.2 Política de cambios y devoluciones — borrador

```
POLÍTICA DE CAMBIOS Y DEVOLUCIONES — Jaise Beauty Academy
Última actualización: [fecha]

1. PRODUCTOS
1.1 Plazo: puedes solicitar un cambio o devolución dentro de [7] días
    calendario desde que recibes el producto.
1.2 Condiciones: producto sin uso, sellado y en su empaque original, con tu
    comprobante de pago.
1.3 No aceptamos devolución de productos abiertos, usados o de uso personal
    (por higiene y seguridad), salvo que tengan defecto de fábrica.
1.4 Producto defectuoso, dañado o distinto al pedido: lo cambiamos o te
    devolvemos el dinero, y asumimos el costo del recojo/envío.
1.5 Cómo solicitarlo: escríbenos por WhatsApp [TELÉFONO] o a [CORREO]
    indicando tu número de pedido y adjuntando fotos si hay daño.

2. SERVICIOS
2.1 Un servicio ya realizado no es reembolsable. Si no quedaste conforme,
    escríbenos dentro de [48 horas / 7 días]: evaluaremos repetirlo o una
    compensación.
2.2 Cancelación o reprogramación: sin costo hasta [X] horas antes de tu cita.
2.3 Adelanto: [se devuelve / se abona a tu nueva cita] si cancelas a tiempo;
    [no se devuelve] si cancelas fuera de plazo o no asistes.
2.4 Si nosotros cancelamos la cita, te devolvemos el adelanto completo o lo
    abonamos a la nueva fecha, como prefieras.

3. REEMBOLSOS
3.1 Aprobada la devolución, procesamos el reembolso en un máximo de [7] días
    hábiles.
3.2 Pagos con tarjeta: se reembolsa a la misma tarjeta mediante Culqi. El
    tiempo en que el banco refleja el abono depende de tu entidad financiera
    (normalmente [X] días hábiles adicionales).
3.3 Pagos con Yape, Plin o transferencia: devolvemos por el mismo medio o a
    la cuenta que nos indiques.
3.4 Cupones y puntos usados en un pedido devuelto: [se restituyen /
    se descuentan los puntos ganados].

4. Contacto
[CORREO] · [TELÉFONO] · Libro de Reclamaciones: [/libro-de-reclamaciones]
```

### 5.3 Política de privacidad — borrador (esqueleto)

```
POLÍTICA DE PRIVACIDAD — Jaise Beauty Academy
Última actualización: [fecha]

1. Responsable: [RAZÓN SOCIAL], RUC [RUC], [DIRECCIÓN], [CORREO].
2. Datos que recopilamos: nombre, celular, correo, direcciones de entrega,
   historial de citas y pedidos, comprobantes de pago, fotos que subas.
3. Finalidad: gestionar tus compras y citas, emitir comprobantes, enviarte
   avisos de tu cuenta, administrar puntos y cupones, atender reclamos.
   [Marketing solo si lo autorizas.]
4. Con quién los compartimos: Culqi (procesamiento de pagos con tarjeta),
   proveedores tecnológicos que alojan el sitio y la base de datos
   (Supabase), y autoridades cuando la ley lo exija. No vendemos tus datos.
5. Los datos de tu tarjeta los captura Culqi; no los almacenamos.
6. Conservación: mientras tengas cuenta y el tiempo que exija la ley
   tributaria/contable.
7. Tus derechos (acceso, rectificación, cancelación, oposición): escríbenos a
   [CORREO]. Puedes reclamar ante la Autoridad Nacional de Protección de
   Datos Personales.
8. Almacenamiento local/cookies: usamos [almacenamiento del navegador] para
   mantener tu sesión y preferencias.
9. Cambios: publicaremos la nueva versión con su fecha.
```

---

## 6. Checklist final (antes de volver a Culqi)

- [ ] Datos del negocio completos y correctos: razón social, RUC, dirección, teléfono, correo (en `datos_contacto()` / Libro de Reclamaciones).
- [ ] Las 3 páginas existen, abren **sin iniciar sesión** y no tienen `[CORCHETES]`.
- [ ] Enlaces visibles en el pie de **todas** las páginas del portal.
- [ ] Checkbox obligatorio de aceptación en carrito de productos, carrito de citas y registro.
- [ ] Menciona claramente cómo se reembolsa un pago con tarjeta.
- [ ] Precios en S/ y costo de delivery visibles antes de pagar.
- [ ] Mensaje "Pago seguro con Culqi" y logos de tarjetas cerca del botón Tarjeta.
- [ ] `npm run build` pasa sin errores.
- [ ] Probado a mano con `npm run dev` (no hay automatización de navegador en este entorno): abrir las 3 rutas, ver el pie, marcar/desmarcar el checkbox y comprobar que bloquea el pago.
- [ ] Revisión (tuya o de un abogado) de los plazos y condiciones: que sean **reales y cumplibles**.
- [ ] Pasar a Culqi las URLs finales de las 3 páginas + Libro de Reclamaciones cuando las pida el formulario de verificación.
- [ ] Anotar el cambio en `implementacionesWed.md` (nueva sección numerada).

## 7. Orden de trabajo sugerido

1. Decidir tus reglas reales (plazo de devolución, horas de cancelación, adelanto, plazo de reembolso). **Esto es lo único que solo tú puedes decidir.**
2. Completar los borradores de la sección 5.
3. Crear `DocumentoLegal` + las 3 páginas + rutas + enlaces en el pie.
4. Agregar checkbox de aceptación en los 3 puntos (carrito, citas, registro).
5. (Opcional) migración para guardar versión/fecha de aceptación (local primero; producción con tu confirmación).
6. Build + prueba manual + enviar URLs a Culqi.

## 8. Checklist oficial de Culqi

Comentarle que para la afiliación a Culqionline es necesario que su pagina cumpla con los siguientes requisitos:  
1️⃣ Tener mínimo 5 productos con fotos o imágenes claras 🖼️🛍️.  
2️⃣ Contar con una descripción detallada de los productos 📝✨.  
3️⃣ Mostrar el precio de cada producto de forma visible 💰🛒.  
4️⃣ Incluir un carrito de compras o botón de pago visible 🛍️💳.  
5️⃣ Contar con certificado SSL 🔒🌐 (garantiza la seguridad de su sitio web).  
6️⃣ Incluir en su web los siguientes enlaces visibles:  
📱 Redes sociales  
📄 Términos y condiciones  
🔄 Políticas de cambio y devoluciones  
📚 Libro de reclamaciones
