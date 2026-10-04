// Higiene de las salidas del arnés: Playwright escribe un `error-context.md` (snapshot de accesibilidad de la página)
// cuando un caso falla, y si el fallo ocurre con el formulario de login lleno, el snapshot puede incluir el VALOR del
// campo Contraseña. Este script recorre las salidas generadas (artifacts/, results/) y redacta ese valor SIN imprimirlo:
//   1) toda aparición literal de QA_TEST_PASSWORD (si está en el entorno del proceso);
//   2) por patrón (funciona aunque la variable no esté): líneas de snapshot «textbox "Contraseña…": <valor>».
// Solo toca archivos de texto. Las capturas PNG no se pueden redactar: los campos de contraseña salen enmascarados
// (type=password) y no se publican capturas de una pantalla de login sin revisarlas.
// Uso (antes de archivar o publicar evidencia):  node tests/e2e/sanear-salidas.mjs [carpeta ...]
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const EXTENSIONES = new Set(['.md', '.json', '.txt', '.html', '.js', '.log', '.yml', '.yaml']);
const MARCA = '[contraseña redactada]';
// Línea de snapshot de Playwright: «- textbox "Contraseña" [ref=e12]: valor»  (con o sin atributos entre medias).
const PATRON_SNAPSHOT = /(textbox\s+"[^"\n]*(?:ontrase[^"\n]*|assword[^"\n]*)"[^\n:]*:\s*)([^\n]+)/g;

export function sanearTexto(texto, secreto = process.env.QA_TEST_PASSWORD ?? '') {
  let salida = texto.replace(PATRON_SNAPSHOT, (_m, antes) => `${antes}${MARCA}`);
  if (secreto.length >= 4) salida = salida.split(secreto).join(MARCA);
  return salida;
}

async function* archivos(carpeta) {
  let entradas;
  try {
    entradas = await readdir(carpeta, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) yield* archivos(ruta);
    else if (EXTENSIONES.has(e.name.slice(e.name.lastIndexOf('.')).toLowerCase())) yield ruta;
  }
}

export async function sanearCarpetas(carpetas) {
  let revisados = 0;
  let modificados = 0;
  for (const carpeta of carpetas) {
    for await (const ruta of archivos(carpeta)) {
      if ((await stat(ruta)).size > 50 * 1024 * 1024) continue;
      revisados += 1;
      const original = await readFile(ruta, 'utf8');
      const nuevo = sanearTexto(original);
      if (nuevo !== original) {
        await writeFile(ruta, nuevo);
        modificados += 1;
      }
    }
  }
  return { revisados, modificados };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const carpetas = process.argv.slice(2);
  const { revisados, modificados } = await sanearCarpetas(carpetas.length ? carpetas : ['tests/e2e/artifacts', 'tests/e2e/results']);
  console.log(`Salidas revisadas: ${revisados}; redactadas: ${modificados}.`);
}
