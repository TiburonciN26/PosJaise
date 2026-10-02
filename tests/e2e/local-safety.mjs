import { execFileSync } from 'node:child_process';

export const appURL = 'http://localhost:5173';
export const supabaseURL = 'http://127.0.0.1:54321';

export async function assertLocalTest() {
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (branch !== 'testing') throw new Error('QA suite requires branch testing; refusing mutations.');
  const response = await fetch(`${appURL}/src/lib/supabase.js`, { redirect: 'error' });
  if (!response.ok) throw new Error('Local Vite module unavailable; refusing mutations.');
  const text = await response.text();
  const configured = text.match(/"VITE_SUPABASE_URL"\s*:\s*"([^"]+)"/)?.[1];
  if (configured !== supabaseURL) throw new Error('Supabase URL is not positively verified LOCAL; refusing mutations.');
}

export async function localNetworkOnly(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (![appURL, supabaseURL].includes(url.origin)) return route.abort('blockedbyclient');
    return route.continue();
  });
}

export function localServiceKey() {
  // Only used by local Auth provisioning. Never passed to a browser or persisted.
  if (process.env.QA_LOCAL_SERVICE_ROLE_KEY) return process.env.QA_LOCAL_SERVICE_ROLE_KEY;
  const container = 'supabase_kong_WedJaiseReact';
  const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
  const path = info.Config.Env.find(value => value.startsWith('KONG_DECLARATIVE_CONFIG='))?.slice('KONG_DECLARATIVE_CONFIG='.length);
  if (!path) throw new Error('Local Auth provisioning key unavailable. No data setup attempted.');
  const yaml = execFileSync('docker', ['exec', container, 'cat', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tokens = [...yaml.matchAll(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g)].map(match => match[0]);
  const token = tokens.find(value => JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).role === 'service_role');
  if (!token) throw new Error('Local service_role key unavailable.');
  return token;
}
