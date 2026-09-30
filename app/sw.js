/*!
 * sw.js — Service Worker：App Shell 预缓存 + 离线可用
 *
 * 改版本号即可让所有客户端在下一次打开时换新缓存（旧缓存会自动清掉）。
 * 预缓存清单由 tools/build-app.mjs 校验：清单里的文件必须真实存在，实际文件也必须都在清单里，
 * 否则离线时会白屏。
 */
var VERSION = 'v23d245d9f8';
var CACHE = 'jianshen-' + VERSION;

/* 相对路径：部署到 /repo/ 或 /repo/app/ 都能正确解析 */
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/data.plan.js',
  './assets/store.js',
  './assets/stats.js',
  './assets/charts.js',
  './assets/ui.js',
  './assets/view.today.js',
  './assets/view.workout.js',
  './assets/view.diet.js',
  './assets/view.stats.js',
  './assets/view.settings.js',
  './assets/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 逐个加，单个失败不影响整体安装（比如某个图标暂时 404）
      return Promise.all(ASSETS.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf('jianshen-') === 0) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;      // 跨域不插手

  e.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        // 离线：导航请求兜底到缓存的首页
        if (req.mode === 'navigate') return caches.match('./index.html');
        return hit || Response.error();
      });
      return hit || net;
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
  if (e.data === 'version') e.source && e.source.postMessage({ version: VERSION });
});
