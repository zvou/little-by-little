// The offline layer. Pages come from the network when possible, so updates arrive
// straight away, and from the cache otherwise. Built files have a hash in their
// name and never change, so those come from the cache first.
// Your data isn't here: it lives in IndexedDB, which works offline by itself.

// Change this to clear everything cached by earlier versions.
const CACHE = 'planner-v1';

const shellUrl = self.registration.scope;
const STATIC_FILES = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

function assetUrlsIn(html) {
  return [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map(
    (match) => new URL(match[1], shellUrl).href,
  );
}

/** Saves the page and the files it uses, so it works offline from the very first visit. */
async function cacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch(shellUrl, { cache: 'no-cache' });
  const html = await response.clone().text();
  await cache.put(shellUrl, response);
  const files = STATIC_FILES.map((file) => new URL(file, shellUrl).href);
  await cache.addAll([...assetUrlsIn(html), ...files]);
}

/** Removes built files that the newest version of the page no longer uses. */
async function pruneAssets(cache, html) {
  const inUse = new Set(assetUrlsIn(html));
  for (const request of await cache.keys()) {
    if (request.url.includes('/assets/') && !inUse.has(request.url)) await cache.delete(request);
  }
}

async function handlePage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(shellUrl, response.clone());
      await pruneAssets(cache, await response.clone().text());
      return response;
    }
    // A host without single-page routing answers a deep link with a 404: the app can handle it.
    return (await cache.match(shellUrl)) ?? response;
  } catch (error) {
    const cached = await cache.match(shellUrl);
    if (cached) return cached;
    throw error;
  }
}

async function handleFile(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? handlePage(request) : handleFile(request));
});

// Tapping a notification opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      return open ? open.focus() : self.clients.openWindow(shellUrl);
    }),
  );
});
