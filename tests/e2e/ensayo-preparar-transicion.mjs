// Deja la base «transicion» de la instancia desechable en su estado inicial del ensayo: copia de QA (volcado en /tmp/qa.dump
// del contenedor del ensayo) + marca de instancia desechable + borrador de la apertura. Solo opera en la instancia desechable.
// El ensayo de transición CONSUME la base: ejecutar esto antes de cada repetición.
import { readFileSync } from 'node:fs';
import { restaurarBase, ejecutarEnsayo } from './ensayo-destino.mjs';

await restaurarBase('/tmp/qa.dump', 'transicion', { marcar: true });
const borrador = readFileSync(new URL('../../docs/recompensas-fase2/transicion/apertura-borrador.sql', import.meta.url), 'utf8');
const r = await ejecutarEnsayo('transicion', borrador);
if (!r.ok) { console.error(r.err); process.exit(1); }
console.log('transicion lista (copia + marca + borrador)');
