const CACHE_NAME = 'obraflow-shell-v20260804-1625';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './mobile-responsive.css',
  './manifest.webmanifest',
  './logo-obraflow.svg',
  './icon-192.svg',
  './icon-512.svg',
  './icon-maskable.svg',
  './app.js',
  './route-features.js',
  './pwa-install.js',
  './notification-center.js',
  './receipt-notification-fallback.js',
  './quantity-rounding-fix.js',
  './production-status-label.js'
];

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './#estoque', self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const sameOrigin = clients.find(client => new URL(client.url).origin === self.location.origin);
      if (sameOrigin) {
        return sameOrigin.focus().then(client => {
          if ('navigate' in client) return client.navigate(targetUrl);
          return client;
        });
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

try {
  importScripts(
    'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js'
  );

  firebase.initializeApp({
    apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
    authDomain: 'sistemsquared.firebaseapp.com',
    databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
    projectId: 'sistemsquared',
    storageBucket: 'sistemsquared.firebasestorage.app',
    messagingSenderId: '43452051582',
    appId: '1:43452051582:web:08a19296448eb66d0b282f'
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const data = payload.data || payload.notification || {};
    const title = data.title || 'Atualização do ObraFlow';
    const type = data.type || 'receipt';
    const tag = data.notificationId || `${type}-${data.projectId || 'obraflow'}`;
    const options = {
      body: data.body || '',
      icon: './icon-192.svg?v=20260803-2255',
      badge: './icon-192.svg?v=20260803-2255',
      tag,
      renotify: type === 'category_complete' || type === 'project_receipts_complete',
      data: {
        url: data.url || './#estoque',
        projectId: data.projectId || '',
        materialId: data.materialId || '',
        notificationId: data.notificationId || ''
      }
    };
    return self.registration.showNotification(title, options);
  });
} catch (error) {
  console.error('Não foi possível iniciar as notificações em segundo plano:', error);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('obraflow-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(async () => (
          await caches.match(request)
          || await caches.match('./index.html')
          || await caches.match('./')
        ))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
