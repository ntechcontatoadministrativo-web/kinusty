// Service worker: recebe as notificações do servidor mesmo com o site fechado
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Kinusty Volleyball', {
    body: d.corpo || '',
    icon: '/img/icone-192.png',
    badge: '/img/icone-192.png',
    tag: d.tag,
    renotify: !!d.tag,
    vibrate: [200, 100, 200],
    data: { url: d.url || '/aluno.html' },
  }));
});

// Ao tocar na notificação: abre a área do aluno (ou foca a aba que já está aberta)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/aluno.html', self.location.origin).href;
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aba = abertas.find(c => new URL(c.url).pathname === '/aluno.html');
    if (aba) { await aba.focus(); return aba.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
