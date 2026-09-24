Con lo que ya está construido (Inicio, Servicios, Citas, Mi Perfil, Historial, Fidelización, Ofertas) tenemos resuelta toda la parte transaccional — agendar, comprar, acumular. Lo que le falta a una web de salón "completa" es la parte de marca/confianza: quién es el negocio, quién te va a atender, y qué dicen otras clientas. Te propongo estas pestañas nuevas, en orden de impacto:

1. Equipo (nueva pestaña o subpágina del avatar)
Tarjetas por asistente: foto, especialidad, años de experiencia. Hoy al agendar solo eliges un asistente de una lista desplegable sin cara ni contexto — esto le da peso a esa decisión y reutiliza el mismo mecanismo de tarjeta "iridiscente" que ya tiene Servicios (tilt 3D + brillo dorado/rosa), así se siente parte de la misma familia visual.

2. Galería (antes/después, portafolio)
Grid tipo masonry con fotos de trabajos reales, con lightbox al tocar una foto. Es la pestaña de mayor impacto para "vender" visualmente el salón, pero depende 100% de que me pases fotos reales — no voy a inventar ni buscar imágenes de stock para esto.

3. Reseñas (ya existe como "Próximamente" en el menú del avatar — es hora de construirla)
Testimonios de clientas reales. Reutilizaría el componente de revelado de texto palabra-por-palabra que ya armamos en Inicio, rotando entre varias reseñas, con estrellas de calificación.

4. Nosotros / Contacto
Historia corta del salón, dirección con mapa, horario, WhatsApp — con contadores animados tipo "+500 clientas" o "10 años" que se activan al hacer scroll (count-up).

5. Referidos (ya estaba en el roadmap, §2.8 de implementacionesWed.md, nunca se construyó)
Código/link para compartir, con recompensa ligada a Fidelización — reutiliza el botón de compartir por WhatsApp que ya funciona en Servicios.

En cuanto a animaciones, todas seguirían el lenguaje que ya tenemos (Framer Motion + .liquid-glass + acentos dorado/rosa + Instrument Serif), no algo nuevo:

Galería y Equipo: aparición escalonada por scroll (useInView, el mismo patrón de las 4 secciones de Inicio).
Reseñas: el revelado palabra-por-palabra que ya existe.
Nosotros: números que suben animados al entrar en pantalla.
¿Con cuál empezamos? Mi recomendación sería Equipo primero (es la más simple, reutiliza casi todo lo que ya existe, y mejora directamente el flujo de agendar) y dejar Galería para cuando tengas las fotos reales listas.