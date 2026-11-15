// Lumio offline support.
// - CORE files are saved on the phone at install, so the app always opens, even with no internet.
// - EXTRA (face tracking, 3D, social; about 19 MB) is saved once in the background when the page
//   asks ('cache-all' message), so face effects and 3D also work offline afterwards.
// - Files are served from the phone first and refreshed in the background when online.
// - Online-only services (Firebase, the AI server) are never cached; the page shows a
//   "turn the internet on" message for them when offline.
const CACHE = 'lumio-v16';
const CORE = ['./', 'index.html', 'grade.js', 'fx.js', 'social-config.js', 'privacy.html', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png', 'og-image.jpg',
  'assets/lens/aviator.jpg', 'assets/lens/capshades.jpg', 'assets/lens/cat.jpg', 'assets/lens/crown.jpg', 'assets/lens/glow.jpg',
  'assets/lens/hearteyes.jpg', 'assets/lens/flowers.jpg', 'assets/lens/mustache.jpg', 'assets/avatars/a1.jpg', 'assets/avatars/a2.jpg'];
const EXTRA = ['lib/face-worker.js', 'lib/vision_bundle.mjs', 'lib/wasm/vision_wasm_internal.js', 'lib/wasm/vision_wasm_internal.wasm',
  'lib/face_landmarker.task', 'lib/fx3d.js', 'lib/social.js'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(n => n !== CACHE).map(async old => {
      // keep big files already downloaded under an older version instead of fetching them again
      const from = await caches.open(old), to = await caches.open(CACHE);
      for (const f of EXTRA) { const hit = await from.match(f); if (hit && !(await to.match(f))) await to.put(f, hit); }
      return caches.delete(old);
    })))
    .then(() => self.clients.claim()));
});
// the page: { type: 'cache-all' } -> save the big files once; answers { type: 'cached-all', ok }
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'cache-all') return;
  e.waitUntil(caches.open(CACHE).then(async c => {
    let ok = true;
    for (const f of EXTRA) {
      if (await c.match(f)) continue;
      try { const r = await fetch(f); if (r.ok) await c.put(f, r); else ok = false; } catch (x) { ok = false; }
    }
    if (e.source) e.source.postMessage({ type: 'cached-all', ok });
  }));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Google Fonts: keep a copy so the Urdu fonts also work offline
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;                 // Firebase, Google sign-in etc.: network only
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.apk')) return;   // AI server, APK: always fresh
  const big = url.pathname.includes('/lib/');               // versioned with the app: keep as is
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    if (hit) { if (!big) e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(async () => (req.mode === 'navigate' ? c.match('index.html') : undefined) || Response.error());
  }));
});
