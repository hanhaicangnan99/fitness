/*!
 * view.settings.js — 「我的」：个人数据、方案切换、数据备份/导入导出、安装引导
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.settings = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, Store = JS.Store;

  function render(ctx) {
    var st = ctx.state, pf = st.profile, cf = st.config;
    var h = [];

    /* ---- 个人数据 ---- */
    h.push(U.card('个人数据',
      '<div class="grid2">' +
      field('height', '身高 cm', pf.height, 'number', 1) +
      field('startWeight', '起始体重 kg', pf.startWeight, 'number', 0.1) +
      '</div><div class="grid2 mt10">' +
      field('startBodyFat', '起始体脂 %', pf.startBodyFat, 'number', 0.1) +
      field('targetWeight', '目标体重 kg', pf.targetWeight, 'number', 0.1) +
      '</div>' +
      '<div class="small muted mt6">改起始值只影响「统计」里的进度百分比，不会改任何一条打卡记录。</div>'));

    /* ---- 方案 ---- */
    var isPpl = cf.planMode === 'ppl';
    h.push(U.card('训练方案',
      U.seg('planmode', [['main', '主方案 · 四分化'], ['ppl', '备选 · 推拉腿']], cf.planMode, { scroll: true }) +
      (isPpl
        ? '<div class="mt10">' + U.kvRows([
          ['当前指针', '下一次训练日 = <b>' + U.esc(P.PPL_NAMES[P.PPL_ORDER[cf.pplCursor % 3]]) + '日</b>'],
          ['顺序', '推 → 拉 → 腿 → 推 …（D10 恒为轻量日）'],
          ['推进规则', '只有标记「完成 / 部分完成」才推进；跳过不推进（不补练，从下一个训练日继续）']
        ]) + '</div>' +
        '<div class="btn-row mt10"><button class="btn sm" data-act="reset-cursor">指针重置为推日</button>' +
        '<button class="btn sm" data-act="show-ppl">看三个训练日的动作</button></div>'
        : '<div class="mt10 small muted">四分化：D3 胸+三头 ／ D5 背+二头 ／ D6 肩+核心 ／ D8 腿 ／ D10 手臂+后束+有氧（轻）。</div>' +
        '<button class="btn sm mt10" data-act="show-ppl">看备选方案的动作</button>') +
      U.note('备选方案更接近谭成义原设计意图：把三轮转依次填入 D3 → D5 → D6 → D8，下一轮从上次停下的地方接着走，' +
        '每 10 天 4 次、每个部位约 1.3 次。主方案的副作用是谭的背日每 10 天只练到 1 次。', 'info')));

    /* ---- 计划微调 ---- */
    h.push(U.card('计划参数',
      U.kvRows([
        ['轮转锚点', 'D1 = ' + U.esc(cf.anchor) + '（' + U.esc(P.weekday(cf.anchor)) + '）' +
          '<div class="small muted">2026-10-01 = 第二个夜班 = D7</div>'],
        ['轮转序列', P.CYCLE.join(' ')],
        ['减载周', (cf.deloadEnabled ? '已开启' : '已关闭') + '<div class="small muted">每 4 周的第 4 周，容量砍 45%（组数减半），重量不变，爬坡走保留</div>']
      ]) +
      '<div class="btn-row mt10">' +
      '<button class="btn sm" data-act="anchor">改锚点</button>' +
      '<button class="btn sm" data-act="toggle-deload">' + (cf.deloadEnabled ? '关闭减载周' : '开启减载周') + '</button>' +
      '</div>'));

    /* ---- 编排训练日 ---- */
    var ovKeys = Object.keys(cf.sessionOverrides || {}).filter(function (k) {
      return (cf.sessionOverrides[k] || []).length;
    });
    h.push(U.card('编排训练日',
      '<div class="small muted mb10">提前把每个训练日的动作排好，到了那天打开「训练」直接练。' +
      '可以换动作、加动作、删动作、调顺序、改组数次数，还带一个"动作类型体检"提醒你别漏了后束 / 中束 / 腘绳。</div>' +
      '<button class="btn primary wide" data-go="editor">进入编排</button>' +
      (ovKeys.length
        ? '<div class="small muted mt10">已改过：' + ovKeys.map(function (k) {
          var s = P.SESSIONS[k];
          return U.esc(s ? s.name : k);
        }).join('、') + '</div>'
        : '')));

    /* ---- 改过的动作清单 ---- */
    h.push(U.card('改过的训练日动作',
      ovKeys.length
        ? U.table(['训练日', '现在的动作'],
          ovKeys.map(function (k) {
            var s = P.SESSIONS[k];
            return [U.esc(s ? s.name : k),
              (cf.sessionOverrides[k] || []).map(function (d) { return U.esc(d[0]); }).join('、')];
          })) +
          '<button class="btn wide mt10" data-act="reset-all-plans">全部恢复默认动作</button>'
        : '<div class="small muted">还没改过，现在是源计划（谭成义体系）的默认动作。</div>'));

    /* ---- 数据 ---- */
    var size = 0;
    try { size = new Blob([Store.exportJSON()]).size; } catch (e) { size = Store.exportJSON().length; }
    h.push(U.card('数据备份与导出',
      U.kvRows([
        ['记录天数', Object.keys(st.days).length + ' 天'],
        ['数据体积', (size / 1024).toFixed(1) + ' KB'],
        ['存储方式', Store.storageName() === 'localStorage' ? '本机浏览器存储（localStorage）' : '⚠ 内存模式（关掉页面就没了）'],
        ['上次导出备份', st.meta.lastBackupAt ? st.meta.lastBackupAt.slice(0, 10) + '（' + daysAgo(st.meta.lastBackupAt) + '）' : '从未导出过']
      ]) +
      U.note('数据只存在你这台手机的浏览器里，不会上传到任何服务器。' +
        '换手机 / 清浏览器数据前，<b>一定先导出 JSON 备份</b>。', 'warn') +
      '<div class="btn-row mt10">' +
      '<button class="btn sm primary" data-act="export-json">导出 JSON 备份</button>' +
      '<button class="btn sm" data-act="import-json">导入 JSON</button>' +
      '</div>' +
      '<div class="btn-row mt10">' +
      '<button class="btn sm" data-act="rollback">回滚到上一版</button>' +
      '</div>' +
      '<div class="sect-title" style="margin-left:0">导出 CSV（Excel 直接打开）</div>' +
      '<div class="btn-row">' +
      '<button class="btn sm" data-act="csv-workout">训练日志</button>' +
      '<button class="btn sm" data-act="csv-diet">饮食打卡</button>' +
      '</div><div class="btn-row mt10">' +
      '<button class="btn sm" data-act="csv-body">体重记录</button>' +
      '<button class="btn sm" data-act="csv-overview">每日总览</button>' +
      '</div>'));

    /* ---- 危险操作 ---- */
    h.push(U.card('危险操作',
      '<div class="btn-row">' +
      '<button class="btn sm" data-act="print">打印 / 存 PDF</button>' +
      '<button class="btn sm" data-act="reload">强制刷新缓存</button>' +
      '</div>' +
      '<button class="btn bad wide mt10" data-act="clear">清空全部数据</button>' +
      '<div class="small muted mt6">清空前会二次确认。清空后可以用「导入 JSON」恢复。</div>'));

    /* ---- 安装 ---- */
    h.push(installCard());
    h.push(U.card('关于',
      U.kvRows([
        ['App', '健身打卡 · 谭成义动作体系' + (ctx.app.version ? ' v' + ctx.app.version : '')],
        ['数据来源', '训练计划表.xlsx / 饮食计划表.xlsx（2026-09-30 生成）'],
        ['动作体系', 'B站 凯圣王-谭成义三分化 BV17ooLBUEqS'],
        ['离线', '首次打开后即可离线使用（Service Worker 缓存）']
      ])));
    return h.join('');
  }

  function field(key, label, val, type, step) {
    return '<div class="cell"><span>' + U.esc(label) + '</span>' +
      '<input type="' + type + '" step="' + step + '" inputmode="decimal" data-bind="profile" data-k="' + key + '" value="' +
      (val == null ? '' : val) + '"></div>';
  }
  function daysAgo(iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '—';
    var d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? '今天' : d + ' 天前';
  }

  function installCard() {
    var standalone = false;
    try {
      standalone = window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    } catch (e) {}
    var ua = navigator.userAgent || '';
    var isAndroid = /Android/i.test(ua);
    var isIOS = /iPhone|iPad|iPod/i.test(ua);

    if (standalone) {
      return U.card('安装状态', U.note('<b>已经装好了。</b>现在是独立窗口模式，桌面有图标，飞行模式下也能用。', 'ok'));
    }
    var body = '';
    if (isAndroid) {
      body = U.kvRows([
        ['① 用 Chrome 打开', '必须是 HTTPS 网址（GitHub Pages 就是）'],
        ['② 右上角菜单 ⋮', '选「安装应用」或「添加到主屏幕」'],
        ['③ 确认', '桌面出现图标，全屏打开，无地址栏'],
        ['④ 想装成真 APK', '托管好后打开 pwabuilder.com，输入网址 → Android → 下载已签名 APK，直接装']
      ]);
    } else if (isIOS) {
      body = U.kvRows([
        ['① 用 Safari 打开', 'Chrome for iOS 不能安装'],
        ['② 点分享按钮', '底部中间的方框 + 向上箭头'],
        ['③ 添加到主屏幕', '确认名字后点「添加」'],
        ['④ 打开', '会全屏运行，断网也能用']
      ]);
    } else {
      body = U.note('请用<b>手机浏览器</b>打开这个网址再安装。电脑上直接当网页用也可以。', 'info');
    }
    return U.card('安装到手机', body +
      (window.__deferredInstall ? '<button class="btn primary wide mt10" data-act="install">立即安装</button>' : ''));
  }

  /* ================= 事件 ================= */
  function mount(rootEl, ctx) {
    U.bindSeg(rootEl, 'planmode', function (v) {
      if (v === ctx.state.config.planMode) return;
      var msg = v === 'ppl'
        ? '切换到备选方案后，D3/D5/D6/D8 会按「推 → 拉 → 腿」依次轮转（当前指针：' +
          P.PPL_NAMES[P.PPL_ORDER[ctx.state.config.pplCursor % 3]] + '日）。已记的训练历史不受影响。'
        : '切回主方案后，D3 胸+三头 / D5 背+二头 / D6 肩+核心 / D8 腿。已记的训练历史不受影响。';
      U.confirmSheet({ title: '切换训练方案', text: msg, okLabel: '切换' }).then(function (yes) {
        if (!yes) { ctx.refresh(); return; }
        Store.touchConfig({ planMode: v });
        U.toast('已切换到' + (v === 'ppl' ? '备选方案' : '主方案'));
        ctx.refresh();
      });
    });

    var t = null;
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.dataset || el.dataset.bind !== 'profile') return;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        var v = U.numVal(el.value);
        if (v == null) return;
        var patch = {};
        patch[el.dataset.k] = v;
        Store.touchProfile(patch);
      }, 300);
    });

    rootEl.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.dataset.act;

      if (act === 'install') { if (window.__deferredInstall) { window.__deferredInstall.prompt(); } return; }
      if (act === 'print') { window.print(); return; }
      if (act === 'show-ppl') { showPpl(); return; }
      if (act === 'reset-all-plans') {
        U.confirmSheet({
          title: '全部恢复默认动作？',
          text: '所有改过的训练日都会回到源计划的动作清单。已记的训练历史不受影响。',
          okLabel: '全部恢复', danger: true
        }).then(function (y) {
          if (!y) return;
          Store.clearAllOverrides();
          U.toast('已恢复默认动作');
          ctx.refresh();
        });
        return;
      }
      if (act === 'reset-cursor') {
        U.confirmSheet({ title: '把指针重置为「推日」？', text: '下一次训练日会做推日。', okLabel: '重置' }).then(function (y) {
          if (!y) return;
          Store.touchConfig({ pplCursor: 0 }); U.toast('指针已重置'); ctx.refresh();
        });
        return;
      }
      if (act === 'toggle-deload') {
        Store.touchConfig({ deloadEnabled: !ctx.state.config.deloadEnabled });
        U.toast(ctx.state.config.deloadEnabled ? '已开启减载周' : '已关闭减载周');
        ctx.refresh();
        return;
      }
      if (act === 'anchor') {
        U.promptSheet({ title: '轮转锚点（D1 的日期）', type: 'date', value: ctx.state.config.anchor,
          sub: '改这个会整体平移轮转序列，所有历史记录的轮转日也会跟着变' }).then(function (v) {
          if (!v) return;
          if (!P.isValidDate(v)) { U.toast('日期格式不对'); return; }
          Store.touchConfig({ anchor: v });
          U.toast('锚点已改为 ' + v); ctx.refresh();
        });
        return;
      }
      if (act === 'export-json') { doExport(ctx); return; }
      if (act === 'import-json') { doImport(ctx); return; }
      if (act === 'rollback') {
        U.confirmSheet({ title: '回滚到上一版数据？', text: '会用上次保存前的快照覆盖当前数据。', okLabel: '回滚', danger: true })
          .then(function (y) {
            if (!y) return;
            var r = Store.rollback();
            U.toast(r.ok ? '已回滚' : r.error);
            ctx.refresh();
          });
        return;
      }
      if (act && act.indexOf('csv-') === 0) {
        var kind = act.slice(4);
        var names = { workout: '训练日志', diet: '饮食打卡', body: '体重记录', overview: '每日总览' };
        U.download('健身打卡-' + names[kind] + '-' + P.todayStr() + '.csv', Store.exportCSV(kind), 'text/csv');
        U.toast('已导出 ' + names[kind] + '.csv');
        return;
      }
      if (act === 'reload') {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(function (r) {
            if (r) r.update();
          });
        }
        U.toast('正在刷新缓存…');
        setTimeout(function () { location.reload(); }, 600);
        return;
      }
      if (act === 'clear') {
        U.confirmSheet({
          title: '清空全部数据？', danger: true, okLabel: '我确定要清空',
          text: '会删掉 ' + Object.keys(ctx.state.days).length + ' 天的全部打卡记录，无法撤销。建议先导出 JSON 备份。'
        }).then(function (y) {
          if (!y) return;
          Store.clearAll();
          U.toast('已清空');
          ctx.refresh();
        });
        return;
      }
    });
  }

  function doExport(ctx) {
    var json = Store.exportJSON();
    var name = '健身打卡-备份-' + P.todayStr() + '.json';
    U.download(name, json, 'application/json');
    Store.get().meta.lastBackupAt = new Date().toISOString();
    Store.saveNow();
    U.toast('已导出 ' + name);
    setTimeout(function () { ctx.refresh(); }, 400);
  }

  function doImport(ctx) {
    U.pickFile('.json,application/json').then(function (f) {
      if (!f) return;
      var apply = function (mode) {
        var r = Store.importJSON(f.text, mode);
        if (!r.ok) { U.toast('导入失败：' + r.error, 4000); return; }
        U.toast(mode === 'merge' ? ('已合并：新增 ' + r.added + ' 天，覆盖 ' + r.updated + ' 天') : ('已替换：共 ' + r.total + ' 天'));
        ctx.refresh();
      };
      var preview = '';
      try {
        var obj = JSON.parse(f.text);
        var n = obj && obj.days ? Object.keys(obj.days).length : 0;
        preview = '<div class="small muted">文件里有 <b>' + n + '</b> 天记录' +
          (obj && obj.meta && obj.meta.createdAt ? '，创建于 ' + String(obj.meta.createdAt).slice(0, 10) : '') + '。</div>';
      } catch (e) {
        U.toast('这不是合法的 JSON 文件', 3000);
        return;
      }
      U.sheet({
        title: '导入 ' + U.esc(f.name),
        sub: '选一种方式',
        body: preview + U.note('<b>覆盖</b>：用文件里的数据整体替换当前数据。<br><b>合并</b>：只覆盖文件里提到的日期，其他保留（推荐，用于多设备回填）。', 'info'),
        actions: [
          { label: '取消' },
          { label: '合并', onClick: function () { apply('merge'); } },
          { label: '覆盖', cls: 'bad', onClick: function () { apply('replace'); } }
        ]
      });
    });
  }

  function showPpl() {
    U.sheet({
      title: '备选方案：谭成义原版推拉腿轮转',
      sub: '每个训练日 5 个动作，RPE 8，离心 3-4 秒',
      body: ['ppl:push', 'ppl:pull', 'ppl:legs'].map(function (k) {
        var s = P.SESSIONS_PPL[k];
        return '<div class="card tight"><div class="card-h"><h3>' + U.esc(s.name) + '</h3></div>' +
          U.table(['顺序', '动作', '组数', '次数', '组间'],
            s.exercises.map(function (e, i) { return [i + 1, U.esc(e[0]), e[1], U.esc(e[2]), e[4] + 's']; })) +
          '<div class="small muted mt6">收尾：' + (P.CARDIO[k].min ? '跑步机爬坡走 ' + P.CARDIO[k].min + ' 分钟' : '不走跑步机，力量做完直接收') + '</div>' +
          '</div>';
      }).join('') + U.note('第 1 轮：D3 推、D5 拉、D6 腿、D8 推　｜　第 2 轮：D3 拉、D5 腿、D6 推、D8 拉　｜　第 3 轮：D3 腿、D5 推、D6 拉、D8 腿。D10 照旧做手臂+后束+有氧（轻）。'),
      actions: [{ label: '关掉' }]
    });
  }

  return { id: 'settings', title: '我的', render: render, mount: mount };
});
