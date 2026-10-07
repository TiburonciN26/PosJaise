// Sirve un frontend (la rama indicada) contra la instancia desechable «JaiseEnsayo» con un Vite aparte, para ensayar la
// compatibilidad entre versiones de frontend y de backend. La URL y la clave del ensayo se pasan solo por el entorno del
// proceso hijo (no se escriben en ningún .env ni se imprimen). Rechaza cualquier destino que no sea el ensayo.
//   node tests/e2e/ensayo-servir-front.mjs <directorio-del-frontend> <puerto>
import { spawn } from 'node:child_process';
import { clavesDelEnsayo, supabaseURL } from './ensayo-destino.mjs';

const [dir, puerto] = process.argv.slice(2);
if (!dir || !/^\d{4}$/.test(puerto ?? '')) throw new Error('Uso: ensayo-servir-front.mjs <directorio> <puerto>');
if (!supabaseURL.startsWith('http://127.0.0.1:56321')) throw new Error('El destino no es el del ensayo.');
if (['5173', '5174'].includes(puerto)) throw new Error(`El puerto ${puerto} es del entorno de QA/móvil.`);
const { anon } = clavesDelEnsayo();
const hijo = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', puerto, '--strictPort', '--mode', 'ensayo'], {
  cwd: dir, stdio: 'inherit', shell: true,
  env: { ...process.env, VITE_SUPABASE_URL: supabaseURL, VITE_SUPABASE_ANON_KEY: anon },
});
hijo.on('exit', (c) => process.exit(c ?? 0));
