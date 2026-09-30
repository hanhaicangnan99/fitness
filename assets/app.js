/*!
 * app.js — 外壳：路由、日期条、标签栏、日历、安装引导、Service Worker
 */
(function (root) {
  'use strict';
  var P = root.JS, U = root.JS.UI, Store = root.JS.Store;

  var App = {
    version: '1.0.0',
    date: P.todayStr(),
    view: 'today',
    state: null,
    cal: null
  };
  root.JS.App = App;
  root.__APP__ = App;      // 单文件版和调试用

  var VIEWS = ['today', 'workout', 'diet', 'stats', 'settings', 'editor'];
  // 不在底部标签栏里、但属于某个标签的二级页面
  var VIEW_PARENT = { editor: 'settings' };
  var TABS = [
    { id: 'today', icon: '☀', label: '今日' },
    { id: 'workout', icon: '🏋', label: '训练' },
    { id: 'diet', icon: '🍚', label: '饮食' },
    { id: 'stats', icon: '📈', label: '统计' },
    { id: 'settings', icon: '☰', label: '我的' }
  ];

  var elView, elAppbar, elTitle, elSub, elDatebar, elTabbar, elBanner;

  /* ================= 启动 ================= */
  function boot() {
    elAppbar = U.$('#appbar');
    elTitle = U.$('#title');
    elSub = U.$('#subtitle');
    elDatebar = U.$('#datebar');
    elView = U.$('#view');
    elTabbar = U.$('#tabbar');
    elBanner = U.$('#banner');

    Store.init();
    App.state = Store.load();

    renderTabs();
    bindGlobals();

    var h = (location.hash || '').replace(/^#\/?/, '');
    if (VIEWS.indexOf(h) >= 0) App.view = h;
    var m = (location.hash || '').match(/[?&]d=(\d{4}-\d{2}-\d{2})/);
    if (m && P.isValidDate(m[1])) App.date = m[1];

    Store.subscribe(function () { App.state = Store.get(); });
    render();
    maybeBackupReminder();
    registerSW();
    wireInstall();
  }

  /* ================= 渲染 ================= */
  function ctx() {
    var info = Store.resolveDay(App.date);
    return {
      app: App, date: App.date, today: P.todayStr(), info: info, state: App.state,
      refresh: function (noScrollTop) { render(noScrollTop); },
      go: function (v) { App.go(v); }
    };
  }

  function render(keepScroll) {
    var y = window.scrollY;
    App.state = Store.get();
    var view = root.JS.Views[App.view] || root.JS.Views.today;
    var c = ctx();

    elView.innerHTML = '';
    var frag = U.frag('<div></div>');
    var holder = frag.firstElementChild;
    holder.innerHTML = view.render(c);
    elView.appendChild(holder);
    if (view.mount) view.mount(holder, c);

    renderAppbar(c.info);
    renderTabs();
    renderBanner();
    if (keepScroll) window.scrollTo(0, Math.min(y, document.body.scrollHeight));
    else window.scrollTo(0, 0);
  }

  function renderAppbar(info) {
    elTitle.textContent = {
      today: '今日', workout: '训练', diet: '饮食', stats: '统计', settings: '我的', editor: '编排训练日'
    }[App.view] || '健身打卡';
    var pf = App.state.profile;
    elSub.textContent = '身高 ' + pf.height + 'cm · ' + pf.startWeight + '→' + pf.targetWeight + 'kg　·　谭成义动作体系';
    var dl = App.date === P.todayStr() ? '' :
      '<span class="chip ghost">不是今天</span>';
    elDatebar.innerHTML =
      '<button class="nav" data-d="-1" aria-label="前一天">‹</button>' +
      '<div class="label" data-act="calendar">' + App.date + '　' + P.weekday(App.date) + dl +
      '<small>' +
      (App.date === P.todayStr() ? '今天' : relativeDay(App.date)) +
      '　·　D' + info.d + (info.dayLabel ? ' ' + U.esc(info.dayLabel) : '') +
      '　·　' + U.esc(info.shift) + '班　·　' + info.kcal + ' kcal' +
      '</small></div>' +
      '<button class="nav" data-d="1" aria-label="后一天">›</button>' +
      '<button class="nav" data-act="today" aria-label="回到今天">◉</button>';

    var ib = U.$('.btn-install', elAppbar);
    if (ib) ib.hidden = !root.__deferredInstall;
  }

  function relativeDay(d) {
    var n = P.daysBetween(P.todayStr(), d);
    if (n === 1) return '明天';
    if (n === -1) return '昨天';
    if (n > 1) return n + ' 天后';
    return Math.abs(n) + ' 天前';
  }

  function renderTabs() {
    var active = VIEW_PARENT[App.view] || App.view;
    elTabbar.innerHTML = TABS.map(function (t) {
      return '<button data-tab="' + t.id + '" class="' + (active === t.id ? 'on' : '') + '">' +
        '<span class="ic">' + t.icon + '</span>' + t.label + '</button>';
    }).join('');
  }

  function renderBanner() {
    if (Store.storageName() !== 'memory') { elBanner.hidden = true; elBanner.innerHTML = ''; return; }
    elBanner.hidden = false;
    elBanner.innerHTML = '<span class="grow">⚠ 本浏览器不让存数据（隐私模式？），现在只存在内存里，关掉页面就没了。</span>' +
      '<button data-act="backup-now">导出备份</button>';
  }

  /* ================= 事件 ================= */
  function bindGlobals() {
    elTabbar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) App.go(b.dataset.tab);
    });

    elDatebar.addEventListener('click', function (e) {
      var t = e.target.closest('[data-d],[data-act]');
      if (!t) return;
      if (t.dataset.d) { App.shiftDate(+t.dataset.d); return; }
      if (t.dataset.act === 'today') { App.setDate(P.todayStr()); return; }
      if (t.dataset.act === 'calendar') { openCalendar(); }
    });

    elBanner.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="backup-now"]')) {
        U.download('健身打卡-备份-' + P.todayStr() + '.json', Store.exportJSON(), 'application/json');
        Store.get().meta.lastBackupAt = new Date().toISOString();
        Store.saveNow();
        U.toast('已导出备份');
      }
    });

    var ib = U.$('.btn-install', elAppbar);
    if (ib) ib.addEventListener('click', function () {
      if (root.__deferredInstall) root.__deferredInstall.prompt();
    });

    // 任何视图里的「跳到某个标签页」按钮都由这里统一处理。
    // 以前是每个视图各写一遍，结果 view.workout / view.settings 漏了 ——
    // 按钮渲染出来了但点了没反应。挂到 document 上，以后不会再漏。
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go]');
      if (!t) return;
      var id = t.dataset.go;
      if (VIEWS.indexOf(id) < 0) return;
      App.go(id);
    });

    window.addEventListener('hashchange', function () {
      var h = (location.hash || '').replace(/^#\/?/, '');
      if (VIEWS.indexOf(h) >= 0 && h !== App.view) { App.view = h; render(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') U.closeTop();
    });

    // 左右滑动切日期（避开弹层与横向表格）
    var sx = 0, sy = 0, sw = false;
    document.addEventListener('touchstart', function (e) {
      if (U.$('.mask')) { sw = false; return; }
      if (e.target.closest('.tbl-wrap, input, textarea, select, .sheet')) { sw = false; return; }
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; sw = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!sw) return;
      sw = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 52) return;
      App.shiftDate(dx < 0 ? 1 : -1);
    }, { passive: true });

    // 页面隐藏时立刻落盘，避免防抖窗口内丢数据
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') Store.saveNow();
    });
    window.addEventListener('pagehide', function () { Store.saveNow(); });
  }

  App.go = function (id) {
    if (VIEWS.indexOf(id) < 0) id = 'today';
    App.view = id;
    try { history.replaceState(null, '', '#/' + id); } catch (e) { location.hash = '#/' + id; }
    render();
  };
  App.setDate = function (d) {
    if (!P.isValidDate(d)) return;
    App.date = d;
    render();
  };
  App.shiftDate = function (n) { App.setDate(P.addDays(App.date, n)); };
  App.refresh = function () { render(true); };

  /* ================= 日历 ================= */
  function openCalendar() {
    App.cal = App.cal || { y: +App.date.slice(0, 4), m: +App.date.slice(5, 7) };
    U.sheet({
      title: '日历', sub: '点任意一天跳到那天的打卡；圆点 = 训练 / 饮食 / 体重',
      body: '<div id="calhost"></div>',
      onMount: function (rootEl) { drawCal(U.$('#calhost', rootEl)); },
      actions: [
        { label: '回到今天', onClick: function () { App.setDate(P.todayStr()); } },
        { label: '关掉' }
      ]
    });
  }

  function drawCal(host) {
    var cal = App.cal;
    var first = new Date(Date.UTC(cal.y, cal.m - 1, 1));
    var dow = (first.getUTCDay() + 6) % 7;             // 周一为一周之首
    var days = new Date(Date.UTC(cal.y, cal.m, 0)).getUTCDate();
    var startN = P.dayNum(cal.y + '-' + P.pad2(cal.m) + '-01');
    var today = P.todayStr();

    var cells = [];
    var i;
    for (i = 0; i < dow; i++) {
      cells.push('<div class="d out"></div>');
    }
    for (i = 1; i <= days; i++) {
      var ds = P.fromDayNum(startN + i - 1);
      var rec = App.state.days[ds] || {};
      var idx = P.dIndex(ds);
      var day = P.DAYS[idx];
      var marks = [];
      var w = rec.workout;
      if (w && (w.status === 'done' || w.status === 'partial')) marks.push('<i class="w"></i>');
      if (rec.diet && rec.diet.kcal != null) marks.push('<i class="d"></i>');
      if (rec.body && rec.body.kg != null) marks.push('<i class="b"></i>');
      var shiftCls = day.shift === '休' ? 'off' : 'hasshift';
      cells.push('<div class="d ' + shiftCls + (ds === today ? ' today' : '') + (ds === App.date ? ' sel' : '') +
        '" data-day="' + ds + '">' +
        '<span class="dd">' + i + '</span>' +
        '<span class="lb">D' + idx + (day.shift !== '休' ? ' ' + day.shift : '') + '</span>' +
        '<span class="marks">' + marks.join('') + '</span>' +
        '</div>');
    }
    var heads = ['一', '二', '三', '四', '五', '六', '日'].map(function (x) {
      return '<div class="wd">' + x + '</div>';
    }).join('');

    host.innerHTML =
      '<div class="row between mb10">' +
      '<button class="btn sm" data-cal="-1">‹ 上月</button>' +
      '<b>' + cal.y + ' 年 ' + cal.m + ' 月</b>' +
      '<button class="btn sm" data-cal="1">下月 ›</button>' +
      '</div>' +
      '<div class="cal">' + heads + cells.join('') + '</div>' +
      '<div class="legend"><span><i style="background:#2f6fd0"></i>训练</span>' +
      '<span><i style="background:#2e9e5b"></i>饮食</span>' +
      '<span><i style="background:#d98324"></i>体重</span>' +
      '<span>D 数字 = 轮转日</span></div>';

    host.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-cal]');
      if (nav) {
        cal.m += +nav.dataset.cal;
        if (cal.m < 1) { cal.m = 12; cal.y--; }
        if (cal.m > 12) { cal.m = 1; cal.y++; }
        drawCal(host);
        return;
      }
      var d = e.target.closest('[data-day]');
      if (d) {
        U.closeTop();
        App.setDate(d.dataset.day);
      }
    });
  }

  /* ================= 备份提醒 ================= */
  function maybeBackupReminder() {
    var meta = App.state.meta || {};
    if (!meta.lastBackupAt) return;
    var days = Math.floor((Date.now() - new Date(meta.lastBackupAt).getTime()) / 86400000);
    if (days >= 7 && Object.keys(App.state.days).length >= 3) {
      U.toast('已经 ' + days + ' 天没导出备份了，去「我的」导一份', 4000);
    }
  }

  /* ================= Service Worker / 安装 ================= */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;      // 单文件离线版：静默跳过
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {});
      }, function (err) {
        console.warn('SW 注册失败（不影响使用）：', err && err.message);
      });
    });
  }

  function wireInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      root.__deferredInstall = e;
      var ib = U.$('.btn-install', elAppbar);
      if (ib) ib.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      root.__deferredInstall = null;
      var ib = U.$('.btn-install', elAppbar);
      if (ib) ib.hidden = true;
      U.toast('已安装到桌面');
    });
  }

  /* ================= go ================= */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
