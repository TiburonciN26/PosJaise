// Service worker de retirada de github.io. Lo recogen las PWA ya instaladas al revisar actualizaciones
// (sw.js en la misma ruta que el anterior). Solo cambia lo que se ve al ABRIR la app: toda navegación
// muestra el aviso. No borra cachés ni recarga páginas, para no romper una venta abierta: las pantallas
// ya cargadas siguen sirviéndose de lo guardado por el service worker anterior.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))

const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pos Jaise cambió de dirección</title><body style="font-family:system-ui;padding:24px"><h1>Pos Jaise tiene una nueva dirección</h1><p>Abre <a href="https://pos-jaise.pages.dev/">https://pos-jaise.pages.dev/</a>, inicia sesión e instala la app nueva.</p>'

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      fetch(new URL('index.html', self.registration.scope).href, { cache: 'no-store' }).catch(
        () => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      ),
    )
    return
  }
  // Archivos de una sesión ya abierta: primero lo que dejó guardado el service worker anterior.
  evento.respondWith(caches.match(peticion).then((guardado) => guardado || fetch(peticion)))
})
