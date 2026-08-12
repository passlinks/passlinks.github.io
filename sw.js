/* Passlink offline shell.

   Network-first, with the cache as fallback — deliberately not cache-first.
   Cache-first keeps serving whatever was stored until the worker itself is
   replaced, and Chrome only replaces it when this file's bytes differ. Keeping
   that correct meant stamping the page's content hash in here on every deploy,
   and forgetting even once left installed users on an old build with nothing
   shown to say so. Measured: four consecutive loads kept serving the stale
   page, and the fix deployed in between was lost for good.

   Network-first deletes that whole class of mistake. Online, the page is always
   fresh — for the one round trip it already cost before any of this existed.
   Offline, the cached copy answers. Nothing here depends on the page's
   contents, so there is nothing to rebuild when the page changes.

   The URL fragment is never sent in a request, so it never arrives here: this
   one cached copy answers every #blob link.

   Trade-off taken knowingly: on a live but very slow connection this waits for
   the network where cache-first would have painted instantly. */

const CACHE = 'passlink';

/* The registration scope rather than a filename, so renaming the page on deploy
   needs no edit here. */
const SHELL = self.registration.scope;

/* Pre-cached so someone who visits once and then goes offline still has it: the
   worker does not control the load that registers it, so without this the cache
   would not fill until a second visit. Allowed to fail without taking install
   down with it — a missed pre-cache costs one visit, a failed install costs the
   whole feature. */
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE)
    .then(c => c.add(new Request(SHELL, {cache: 'reload'})))
    .catch(() => {})
    .then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  /* Every navigation is stored under the one canonical key regardless of the
     path it arrived on, so the offline copy is refreshed by every online
     visit rather than frozen at whatever install fetched. */
  const key = e.request.mode === 'navigate' ? SHELL : e.request;

  /* A 404 or a 502 resolves rather than rejects. Treating those as success
     would replace a working offline copy with an error page. */
  const network = fetch(e.request).then(res => {
    if (!res.ok) throw new Error(res.status);
    return res;
  });

  /* waitUntil and respondWith are both called synchronously, before any await:
     called later they can be rejected for arriving after the event dispatch.
     The clone happens the moment the response lands, before anything reads it. */
  e.waitUntil(network
    .then(res => {
      const copy = res.clone();
      return caches.open(CACHE).then(c => c.put(key, copy));
    })
    .catch(() => {}));

  e.respondWith(network.catch(async () => {
    const hit = await caches.match(key);
    if (hit) return hit;
    throw new Error('offline, and nothing cached for ' + e.request.url);
  }));
});

/* No 'message' listener, deliberately. Nothing needs one, and it is the single
   thing that would let an injected script reach the network: the page's
   connect-src 'none' does not apply to a worker, and a worker on static hosting
   cannot be given a policy of its own. Measured both ways — with a handler the
   secret left the machine, without one there is no channel. */
