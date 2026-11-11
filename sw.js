/* Kit Offline — service worker
   Guarda a página inteira no aparelho para abrir sem internet.
   A IA e a biblioteca NÃO passam por aqui: cada uma guarda os próprios arquivos. */

const CACHE = 'kit-offline-v4';   /* SUBIR ESTE NÚMERO A CADA PUBLICAÇÃO */
const ESSENCIAL = [
  './',
  './index.html',
  './app.js',
  './baixa-zim.js',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './vendor/web-llm.js',
  './vendor/libzim-wasm.js',
  './vendor/libzim-wasm.wasm'
];

/* Só para conferência: quando ligado, o service worker recusa a rede inteira,
   como se o aparelho estivesse em modo avião. */
let SEM_REDE = false;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ESSENCIAL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    /* só apaga versões antigas da página; os caches da IA ficam */
    .then(ks => Promise.all(ks.filter(k => k.startsWith('kit-offline-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.tipo === 'assumir') self.skipWaiting();
  if (d.tipo === 'semrede') {
    SEM_REDE = !!d.ligado;
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ semrede: SEM_REDE });
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  const daCasa = url.origin === self.location.origin;

  if (SEM_REDE) {
    e.respondWith(
      caches.match(req, { ignoreSearch: daCasa })
        .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : null))
        .then(r => r || Response.error())
    );
    return;
  }

  if (req.method !== 'GET') return;
  if (!daCasa) return;
  /* as partes da biblioteca são grandes e vão direto para o arquivo no aparelho:
     guardar aqui também seria ocupar o espaço duas vezes */
  if (url.pathname.includes('/pacotes/')) return;
  /* a página de apresentação (lp/) não é o app: fica fora do cache do app */
  if (url.pathname.includes('/lp/')) return;

  const ehApp = req.mode === 'navigate' || req.destination === 'document' ||
                /\/(index\.html)?$/.test(url.pathname);

  const pedido = ehApp
    ? fetch(new Request(req.url, { cache: 'no-store', credentials: 'same-origin' }))
    : fetch(req);

  e.respondWith(pedido
    .then(res => {
      if (res && res.ok) {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
      }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: true })
      .then(r => r || (ehApp ? caches.match('./index.html') : Response.error()))));
});
