/* Neuralbase v2 Supabase client.
   The SDK is loaded from an ESM import map (see the <script type="importmap"> in the HTML),
   so this module uses a bare specifier. It is imported lazily and only when config is present,
   which keeps demo mode and the bun test suite free of any network or CDN dependency.

   getClient() is synchronous: the client is created once at module load (top-level await). */

import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO } from '../config.js';

/* Tests must be hermetic: they run in demo mode regardless of what config.js holds,
   so a real key in the repo can never make the suite touch the network. Set by
   tests/setup.js through bunfig's test preload. */
function forcedDemo() {
  return typeof globalThis !== 'undefined' && globalThis.__NEURALBASE_FORCE_DEMO__ === true;
}

let client = null;

if (!DEMO && !forcedDemo()) {
  try {
    const mod = await import('@supabase/supabase-js');
    client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    });
  } catch (e) {
    console.warn('[cortex] Supabase client failed to load:', e && e.message ? e.message : e);
  }
}

export function isDemo() {
  return DEMO || forcedDemo();
}

export function getClient() {
  return client;
}
