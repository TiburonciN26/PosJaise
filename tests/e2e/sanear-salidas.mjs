// Higiene de las salidas del arnés (QA-048). Playwright escribe un `error-context.md` (snapshot de accesibilidad)
// cuando un caso falla, y si el fallo ocurre con el formulario de login lleno, el snapshot puede incluir el VALOR del
// campo Contraseña: en línea («- textbox "Contraseña" [ref=e5]: valor»), en varias líneas (valor como hijo
// «- text: valor» o «- /value: valor»), serializado dentro de un JSON (saltos de línea escapados) o dentro de anexos
// base64 del reporte. Este módulo redacta ese valor SIN imprimirlo, con o sin QA_TEST_PASSWORD en el entorno:
//   1) por patrón (siempre), 2) por coincidencia literal del secreto (si la variable existe), incluyendo su forma
//   escapada para JSON y para URL.
// Solo toca texto. Las capturas PNG no se pueden redactar: requieren REVISIÓN MANUAL antes de publicarlas.
// Importable sin efectos: el CLI solo corre cuando el archivo se ejecuta directamente.
//   node tests/e2e/sanear-salidas.mjs [carpeta ...]
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXTENSIONES = new Set(['.md', '.json', '.txt', '.html', '.js', '.log', '.yml', '.yaml']);
export const MARCA = '[contraseña redactada]';

const ETIQUETA_CONTRASENA = /(?:ontrase|assword)/i;
// Línea de nodo de snapshot: «<sangría>- textbox "<nombre>"<atributos>[:[ valor]]»
const LINEA_TEXTBOX = /^(\s*)- textbox\s+"([^"\n]*)"([^\n:]*)(:?)(.*)$/;
const LINEA_HIJO_VALOR = /^(\s*- (?:text|\/value|\/text):\s*)(.*)$/;

function sangria(linea) {
  return linea.length - linea.trimStart().length;
}

// Snapshot de accesibilidad (texto con saltos de línea reales): redacta el valor del textbox de contraseña,
// sea en la misma línea o en las líneas hijas más sangradas.
function sanearSnapshot(texto) {
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i += 1) {
    const m = LINEA_TEXTBOX.exec(lineas[i]);
    if (!m || !ETIQUETA_CONTRASENA.test(m[2])) continue;
    const [, sang, nombre, atributos, dosPuntos, resto] = m;
    if (dosPuntos && resto.trim()) lineas[i] = `${sang}- textbox "${nombre}"${atributos}: ${MARCA}`;
    for (let j = i + 1; j < lineas.length && (lineas[j].trim() === '' || sangria(lineas[j]) > sang.length); j += 1) {
      const h = LINEA_HIJO_VALOR.exec(lineas[j]);
      if (h && h[2].trim()) lineas[j] = `${h[1]}${MARCA}`;
    }
  }
  return lineas.join('\n');
}

function formasDelSecreto(secreto) {
  if (secreto.length < 4) return [];
  const formas = new Set([secreto, JSON.stringify(secreto).slice(1, -1), encodeURIComponent(secreto)]);
  return [...formas].filter((f) => f.length >= 4);
}

export function sanearTexto(texto, secreto = process.env.QA_TEST_PASSWORD ?? '') {
  let salida = sanearSnapshot(texto.replace(/\r\n/g, '\n'));
  for (const forma of formasDelSecreto(secreto)) salida = salida.split(forma).join(MARCA);
  return salida;
}

// JSON (reportes, diagnósticos): se parsea para sanear CADA cadena ya decodificada (los snapshots serializados
// llevan los saltos de línea escapados, así que el texto crudo no sirve) y los anexos base64 de texto.
const TIPOS_TEXTO = /^(text\/|application\/(json|xml|x-ndjson)|application\/.*\+json)/i;

export function sanearAdjuntoBase64(contentType, base64, secreto) {
  if (!TIPOS_TEXTO.test(contentType ?? '')) return base64; // binarios (PNG, PDF…): sin cambios
  const original = Buffer.from(base64, 'base64').toString('utf8');
  const nuevo = sanearTexto(original, secreto);
  return nuevo === original ? base64 : Buffer.from(nuevo, 'utf8').toString('base64');
}

function sanearValor(valor, secreto, clave) {
  if (typeof valor === 'string') return sanearTexto(valor, secreto);
  if (Array.isArray(valor)) return valor.map((v) => sanearValor(v, secreto, clave));
  if (valor && typeof valor === 'object') {
    const salida = {};
    for (const [k, v] of Object.entries(valor)) {
      salida[k] = k === 'body' && typeof v === 'string' && typeof valor.contentType === 'string'
        ? sanearAdjuntoBase64(valor.contentType, v, secreto)
        : sanearValor(v, secreto, k);
    }
    return salida;
  }
  return valor;
}

export function sanearJSONTexto(texto, secreto = process.env.QA_TEST_PASSWORD ?? '') {
  try {
    return JSON.stringify(sanearValor(JSON.parse(texto), secreto), null, 2);
  } catch {
    return sanearTexto(texto, secreto); // no era JSON válido: se trata como texto
  }
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
      if ((await stat(ruta)).size > 100 * 1024 * 1024) continue;
      revisados += 1;
      const original = await readFile(ruta, 'utf8');
      const esJson = ruta.toLowerCase().endsWith('.json');
      const nuevo = esJson ? sanearJSONTexto(original) : sanearTexto(original);
      let referencia = original;
      if (esJson) {
        try {
          referencia = JSON.stringify(JSON.parse(original), null, 2); // mismo formato que sanearJSONTexto
        } catch {
          referencia = original;
        }
      }
      if (nuevo !== referencia && nuevo !== original) {
        await writeFile(ruta, nuevo);
        modificados += 1;
      }
    }
  }
  return { revisados, modificados };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const carpetas = process.argv.slice(2);
  const { revisados, modificados } = await sanearCarpetas(carpetas.length ? carpetas : ['tests/e2e/artifacts', 'tests/e2e/results']);
  console.log(`Salidas revisadas: ${revisados}; redactadas: ${modificados}.`);
}
