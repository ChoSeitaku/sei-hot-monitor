self.addEventListener('push', (event) => {
  const payload = event.data?.json() || {};
  const title = payload.title || '热点提醒';
  const options = {
    body: payload.body || '检测到新的 AI 热点，请查看。',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.url || '/',
    timestamp: Date.now()
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const url = event.notification.data || '/';
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
