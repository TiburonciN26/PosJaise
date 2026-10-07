import { createClient } from '@supabase/supabase-js'

// Una URL que empieza con "/" (p. ej. /__supabase, modo `vite --mode movil`) es relativa al
// origen de la página: así el celular que entra por un túnel (ngrok) habla con el Supabase
// local a través del proxy de Vite, en vez de con SU propio 127.0.0.1. Las URL absolutas
// (local normal y producción) no cambian.
const urlConfigurada = import.meta.env.VITE_SUPABASE_URL
const supabaseUrl = urlConfigurada?.startsWith('/') ? `${window.location.origin}${urlConfigurada}` : urlConfigurada
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Revisa tu archivo .env (mira .env.example).',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
