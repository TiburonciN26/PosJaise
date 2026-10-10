// El service worker generado debe excluir /medios del fallback de navegación (navigateFallbackDenylist), para que abrir
// una foto nunca devuelva el index.html de la SPA. Comprueba la PROPIEDAD y el patrón exactos, no la mera aparición de
// la palabra «medios» (que podría venir del nombre de un asset). `/medios-extra` no debe quedar excluido.
const DENYLIST = /denylist\s*:\s*\[([^\]]*)\]/g

export function swExcluyeMedios(texto) {
  for (const m of String(texto).matchAll(DENYLIST)) {
    const patrones = m[1].split(/,(?=\s*\/)/).map((p) => p.trim())
    if (patrones.includes(String.raw`/^\/medios(?:\/|$)/`)) return true
  }
  return false
}
