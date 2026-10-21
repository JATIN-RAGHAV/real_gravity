// Cloudflare Worker that serves the built game (dist/) from Workers Static
// Assets. Every request runs through here (run_worker_first in wrangler.jsonc)
// so the headers below apply to all responses. There is no server-side
// computation: the Worker only hands the asset back with a few headers added.

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
    }

    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);

    // Vite writes content-hashed files under /assets/; they never change, so
    // let browsers keep them for a year. index.html stays revalidated.
    if (url.pathname.startsWith('/assets/')) {
      res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    return res;
  },
};
