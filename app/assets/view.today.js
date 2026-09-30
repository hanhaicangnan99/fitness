/*!
 * view.today.js — 「今日」：当天计划、时间轴、三张打卡卡、上下文提醒
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.today = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, Store = JS.Store;

  /* 从 '早餐 09:15（训前）' 这种字符串里抠出 HH:MM */
  function clockOf(text) {
    var m = String(text || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return { h: +m[1], m: +m[2], min: +m[1] * 60 + +m[2], raw: m[1].padStart(2, '0') + ':' + m[2] };
  }
  function trimTime(text) {
    return String(text || '').replace(/^\S*?\s*(\d{1,2}:\d{2})/, '$1');
  }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  function shiftChipClass(shift) {
    return { '白': 'day', '夜': 'night', '中': 'mid', '休': 'off' }[shift] || 'off';
  }

  /** 当日时间轴条目 */
  function timelineOf(info, rec) {
    var items = [];
    var wake = clockOf(info.wake);
    items.push({ key: 'wake', min: wake ? wake.min : -1, time: info.wake, text: '起床', done: false, kind: 'wake' });

    var m1 = clockOf(info.m1);
    items.push({ key: 'm1', min: m1 ? m1.min : -1, time: m1 ? m1.raw : '', text: mealText('正餐1', info.m1),
      done: !!(rec.diet && rec.diet.m1), kind: 'diet' });

    if (info.isTrainDay) {
      var t = clockOf(info.trainTime);
      var sess = P.SESSIONS[info.sessionKey];
      items.push({ key: 'train', min: t ? t.min : -1, time: t ? t.raw : '', kind: 'train',
        text: (sess ? sess.name : info.slotName) + '　' + info.trainTime,
        sub: sess ? sess.exercises.length + ' 个动作 · 共 ' + sess.exercises.reduce(function (a, e) { return a + e[1]; }, 0) + ' 组' : '',
        done: !!(rec.workout && (rec.workout.status === 'done' || rec.workout.status === 'partial')) });
    }

    var shake = clockOf(info.shake);
    items.push({ key: 'shake', min: shake ? shake.min : -1, time: shake ? shake.raw : '', text: '蛋白补口',
      done: !!(rec.diet && rec.diet.shake), kind: 'diet' });

    var m2 = clockOf(info.m2);
    items.push({ key: 'm2', min: m2 ? m2.min : -1, time: m2 ? m2.raw : '', text: mealText('正餐2', info.m2),
      done: !!(rec.diet && rec.diet.m2), kind: 'diet' });

    items.sort(function (a, b) { return a.min - b.min; });
    return items;
  }
  /** '早餐 09:15（训前）' → '正餐1 · 训前'；没有括号说明就只显示 '正餐1' */
  function mealText(label, raw) {
    var q = String(raw || '')
      .replace(/^[^\d]*\d{1,2}:\d{2}\s*/, '')
      .replace(/^[（(]\s*/, '')
      .replace(/\s*[）)]\s*$/, '')
      .trim();
    return q ? label + ' · ' + q : label;
  }

  /** 当日需要提醒的事 */
  function alertsFor(info, rec, isToday) {
    var out = [];
    if (rec.daily && rec.daily.sleepHrs != null && rec.daily.sleepHrs < 6) {
      out.push(['bad', '<b>睡眠 ' + U.num(rec.daily.sleepHrs, 1) + ' 小时 &lt; 6</b>：今天不训练、不加有氧，优先补觉。']);
    }
    if (info.d === 6) out.push(['warn', '<b>D6：21:00 前必须睡</b>（今夜 00:30 起上夜班），18:00 那餐要早；心率控制不好就把爬坡走降到 30 分钟。']);
    if (info.d === 8) out.push(['warn', '<b>D8 是 09:00 干到次日 03:30 的 19 小时长日</b>：练腿日不走跑步机，力量 60 分钟做完就收（训练共 75 分钟）；17:50 到站点坐 18:00 班车。']);
    if (info.d === 9) out.push(['info', '<b>D9：早餐要轻、蛋白优先</b>，到 19:20 岗上那餐只隔 6 小时。']);
    if (info.d === 4 || info.d === 7) out.push(['info', '<b>夜班：</b>07:00 岗上那餐是当天最大一餐，碳水主力放这里；22:00-02:00 避免高脂高糖；05:30 后禁用咖啡因。']);
    if (info.d === 10) out.push(['info', '<b>D10 复适应日：</b>起床不晚于 13:00，23:00 前睡（明天白班 10:00 上工）。']);
    if (info.d === 1 || info.d === 2) out.push(['info', '<b>赶班车只有 20 分钟吃饭：</b>前一天把燕麦分装好、牛奶鸡蛋放冰箱。']);
    if (info.deload) out.push(['warn', '<b>本周是减载周（第 ' + info.week + ' 周）</b>：容量砍 45%（组数减半），重量不变，爬坡走保留。']);
    if (info.tierOverridden) out.push(['info', '今天的<b>热量档被手动改过</b>（' + info.tierName + ' ' + info.kcal + ' kcal）——顶班 / 轮转打乱时用，不影响别的日期。']);
    if (info.dayOverridden) out.push(['info', '今天的<b>轮转日被手动改过</b>（D' + info.d + '，自动算是 D' + info.autoD + '）。']);
    return out;
  }

  function render(ctx) {
    var info = ctx.info, rec = ctx.state.days[ctx.date] || {};
    var isToday = ctx.date === P.todayStr();
    var h = [];

    /* ---- 头部概览 ---- */
    var sess = info.isTrainDay ? P.SESSIONS[info.sessionKey] : null;
    h.push('<div class="card">');
    h.push('<div class="row" style="gap:6px;flex-wrap:wrap">' +
      '<span class="chip ' + (info.tierKey === 'train' ? 'train' : info.tierKey === 'light' ? 'light' : '') + '">D' + info.d +
      (info.dayLabel ? ' ' + U.esc(info.dayLabel) : '') + '</span>' +
      '<span class="chip ' + shiftChipClass(info.shift) + '">' + U.esc(info.shift) + '班' +
      (P.SHIFT_TIME[info.shift] !== '—' ? ' ' + U.esc(P.SHIFT_TIME[info.shift]) : '') + '</span>' +
      '<span class="chip">第 ' + info.week + ' 周</span>' +
      '<span class="chip">' + U.esc(info.phase.name) + '</span>' +
      '</div>');

    h.push('<div class="row between mt14">' +
      '<div class="grow"><div class="lbl small muted">当日热量档</div>' +
      '<div class="stat"><span class="n">' + info.kcal + '</span><span class="u">kcal</span>' +
      '<span class="d muted small">P' + info.p + ' / C' + info.c + ' / F' + info.f + '</span></div></div>' +
      '</div>');
    h.push('<div class="small muted mt6">当日 TDEE ≈ ' + info.tdee + ' kcal　·　缺口 ≈ ' +
      (info.tdee - info.kcal) + ' kcal</div>');

    h.push('<div class="row between mt10" style="align-items:flex-start">' +
      '<div class="grow"><div class="small">' + (sess
        ? '<b>' + U.esc(sess.name) + '</b>　' + U.esc(sess.src)
        : '<b>无训练</b>　' + U.esc(P.SHIFT_TIME[info.shift] !== '—' ? '上班日，按班次节奏走' : '休息日')) + '</div>' +
      (sess ? '<div class="small muted mt6">' + U.esc(info.trainTime) + '　热身 8 分钟 → 力量 60 分钟 → ' +
        (P.CARDIO[info.sessionKey] && P.CARDIO[info.sessionKey].min ? '爬坡走 ' + P.CARDIO[info.sessionKey].min + ' 分钟' : '不走跑步机') +
        '</div>' : '') + '</div>' +
      '</div>');
    h.push('</div>');

    /* ---- 时间轴 ---- */
    var tl = timelineOf(info, rec);
    var now = nowMinutes();
    var nextSet = false;
    var tlHtml = tl.map(function (it) {
      var cls = it.done ? 'done' : '';
      if (isToday && !it.done && !nextSet && it.min >= 0 && it.min >= now - 45) { cls += ' next'; nextSet = true; }
      return '<div class="tl-item ' + cls + '">' +
        '<div class="tl-time">' + U.esc(it.time || '') + '</div>' +
        '<div class="tl-text">' + U.esc(it.text) + '</div>' +
        (it.sub ? '<div class="small muted">' + U.esc(it.sub) + '</div>' : '') + '</div>';
    }).join('');
    h.push(U.card('今天的时间表（' + U.esc(P.weekday(ctx.date)) + '）', '<div class="timeline">' + tlHtml + '</div>'));

    /* ---- 三张打卡卡 ---- */
    var w = rec.workout;
    var trainStatus, trainChip, trainBtn;
    if (!info.isTrainDay) {
      trainStatus = w && w.status === 'rest' ? '已确认休息' : '休息日 / 上班日';
      trainChip = w && w.status === 'rest' ? '<span class="chip ok">已打卡</span>' : '';
      trainBtn = w && w.status === 'rest'
        ? '<button class="btn sm" data-act="unrest">撤销</button>'
        : '<button class="btn sm primary" data-act="rest">今日休息 ✓</button>';
    } else if (w && (w.status === 'done' || w.status === 'partial')) {
      trainStatus = (w.status === 'done' ? '完成' : '部分完成') + '　容量 ' + U.int(S.sessionVolume(w)) + ' kg';
      trainChip = '<span class="chip ok">✓ ' + (w.status === 'done' ? '完成' : '部分') + '</span>';
      trainBtn = '<button class="btn sm" data-go="workout">查看 / 修改</button>';
    } else if (w && w.status === 'skipped') {
      trainStatus = '已标记跳过（不补练，从下一个训练日继续）';
      trainChip = '<span class="chip bad">跳过</span>';
      trainBtn = '<button class="btn sm" data-go="workout">改回来</button>';
    } else {
      trainStatus = sess ? sess.exercises.length + ' 个动作 · 共 ' +
        sess.exercises.reduce(function (a, e) { return a + e[1]; }, 0) + ' 组' : '';
      trainChip = '';
      trainBtn = '<button class="btn sm primary" data-go="workout">去打卡</button>';
    }

    var d = rec.diet;
    var dietHit = d && d.kcal != null ? Math.abs(d.kcal - info.kcal) / info.kcal <= 0.1 : null;
    var dietStatus = d && d.kcal != null
      ? '实际 ' + U.int(d.kcal) + ' kcal　目标 ' + info.kcal
      : '目标 ' + info.kcal + ' kcal　还没记';
    var dietChip = d && d.kcal != null
      ? '<span class="chip ' + (dietHit ? 'ok' : 'warn') + '">' + (dietHit ? '达标' : '偏差>10%') + '</span>'
      : '';
    var slotDone = [d && d.m1, d && d.m2, d && d.shake].filter(Boolean).length;

    var b = rec.body;
    var bodyStatus = b && b.kg != null ? '体重 ' + U.num(b.kg, 1) + ' kg' +
      (b.bf != null ? '　体脂 ' + U.num(b.bf, 1) + '%' : '') +
      (b.waist != null ? '　腰围 ' + U.num(b.waist, 1) + ' cm' : '')
      : '早上起床排空后、同一状态下称重';
    var bodyChip = b && b.kg != null ? '<span class="chip ok">✓ 已记</span>' : '';

    h.push(U.card('打卡', '<ul class="list">' +
      checkinRow('训练', trainStatus, trainChip, trainBtn) +
      checkinRow('饮食', dietStatus + (slotDone ? '　·　餐次 ' + slotDone + '/3' : ''), dietChip,
        '<button class="btn sm" data-go="diet">' + (d && d.kcal != null ? '修改' : '去打卡') + '</button>') +
      checkinRow('体重', bodyStatus, bodyChip, '<button class="btn sm" data-act="body">' + (b && b.kg != null ? '修改' : '记录') + '</button>') +
      '</ul>'));

    /* ---- 提醒 ---- */
    var alerts = alertsFor(info, rec, isToday);
    if (info.tip) {
      h.push('<div class="note info">' + U.esc(info.tip) + '</div>');
    }
    alerts.forEach(function (a) { h.push(U.note(a[1], a[0])); });

    /* ---- 覆盖 / 备注 ---- */
    h.push('<div class="card"><div class="card-h"><h2>今日微调</h2>' +
      '<span class="hint">顶班 / 轮转打乱时用</span></div>' +
      '<div class="btn-row">' +
      '<button class="btn sm" data-act="override-day">改轮转日</button>' +
      '<button class="btn sm" data-act="override-tier">改热量档</button>' +
      '<button class="btn sm" data-act="sleep">记睡眠</button>' +
      '<button class="btn sm" data-act="note">写备注</button>' +
      '</div>' +
      (rec.daily && (rec.daily.sleepHrs != null || rec.daily.steps != null || rec.daily.note)
        ? '<div class="mt10">' + U.kvRows([
          rec.daily.sleepHrs != null ? ['睡眠', U.num(rec.daily.sleepHrs, 1) + ' 小时' + (rec.daily.sleepHrs < 6 ? ' <span class="chip bad">不足 6h</span>' : '')] : null,
          rec.daily.steps != null ? ['步数', U.int(rec.daily.steps) + (rec.daily.steps < 8000 ? ' <span class="muted">（工作日保底 8000）</span>' : '')] : null,
          rec.daily.note ? ['备注', U.esc(rec.daily.note)] : null
        ]) + '</div>' : '') +
      '</div>');

    return h.join('');
  }

  function checkinRow(title, text, chip, btn) {
    return '<li><div class="row" style="align-items:center">' +
      '<div class="grow"><div style="font-size:14px;font-weight:600">' + U.esc(title) + ' ' + (chip || '') + '</div>' +
      '<div class="small muted">' + U.esc(text) + '</div></div>' +
      '<div style="flex:none">' + btn + '</div>' +
      '</div></li>';
  }

  function mount(rootEl, ctx) {
    rootEl.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go],[data-act]');
      if (!t) return;
      if (t.dataset.go) { ctx.app.go(t.dataset.go); return; }
      var act = t.dataset.act;
      var info = ctx.info, rec = Store.get().days[ctx.date] || {};

      if (act === 'rest') {
        Store.patchDay(ctx.date, { workout: { status: 'rest', sessionKey: 'rest' } });
        U.toast('已打卡：今日休息'); ctx.refresh();
      } else if (act === 'unrest') {
        var r = Store.ensureDay(ctx.date);
        delete r.workout;
        Store.save(); Store.emit(); ctx.refresh();
      } else if (act === 'body') {
        openBodySheet(ctx);
      } else if (act === 'sleep') {
        var cur = (rec.daily && rec.daily.sleepHrs) || '';
        U.promptSheet({ title: '昨晚睡了多久？', label: '小时（可填小数，如 6.5）', type: 'number',
          step: '0.5', min: 0, max: 24, value: cur, sub: '睡眠 < 6 小时当天不训练、不加有氧' })
          .then(function (v) {
            if (v == null) return;
            var n = U.numVal(v);
            if (n == null) { U.toast('请填数字'); return; }
            var dd = (rec.daily) || {};
            Store.setDaily(ctx.date, { sleepHrs: n, steps: dd.steps == null ? null : dd.steps, note: dd.note || '' });
            U.toast('已记录睡眠 ' + U.num(n, 1) + ' 小时'); ctx.refresh();
          });
      } else if (act === 'note') {
        U.promptSheet({ title: '当日备注', value: (rec.daily && rec.daily.note) || '' }).then(function (v) {
          if (v == null) return;
          var dd = rec.daily || {};
          Store.setDaily(ctx.date, { sleepHrs: dd.sleepHrs == null ? null : dd.sleepHrs, steps: dd.steps == null ? null : dd.steps, note: String(v).trim() });
          U.toast('已保存'); ctx.refresh();
        });
      } else if (act === 'override-day') {
        openDayOverride(ctx);
      } else if (act === 'override-tier') {
        openTierOverride(ctx);
      }
    });
  }

  function openBodySheet(ctx) {
    var b = (Store.get().days[ctx.date] || {}).body || {};
    var html = '<div class="grid3">' +
      '<div class="cell"><span>体重 kg</span><input type="number" step="0.1" id="b_kg" value="' + (b.kg == null ? '' : b.kg) + '" inputmode="decimal"></div>' +
      '<div class="cell"><span>体脂 %</span><input type="number" step="0.1" id="b_bf" value="' + (b.bf == null ? '' : b.bf) + '" inputmode="decimal"></div>' +
      '<div class="cell"><span>腰围 cm</span><input type="number" step="0.1" id="b_waist" value="' + (b.waist == null ? '' : b.waist) + '" inputmode="decimal"></div>' +
      '</div>' +
      U.note('每天早上起床排空后、同一状态下称重。体重波动看 <b>7 日均重</b>，不看单日。', 'info');
    U.sheet({
      title: '体重 / 体脂 / 腰围', sub: ctx.date + '　' + P.weekday(ctx.date),
      body: html,
      actions: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: function (rootEl) {
            var kg = U.numVal(U.$('#b_kg', rootEl).value);
            var bf = U.numVal(U.$('#b_bf', rootEl).value);
            var ws = U.numVal(U.$('#b_waist', rootEl).value);
            if (kg != null && (kg < 30 || kg > 250)) { U.toast('体重看起来不对'); return false; }
            if (bf != null && (bf < 3 || bf > 60)) { U.toast('体脂看起来不对'); return false; }
            Store.setBody(ctx.date, { kg: kg, bf: bf, waist: ws });
            U.toast(kg != null ? '已记录 ' + U.num(kg, 1) + ' kg' : '已清空');
            ctx.refresh();
          }
        }
      ]
    });
  }

  function openDayOverride(ctx) {
    var info = ctx.info;
    var opts = [];
    for (var i = 1; i <= 10; i++) {
      opts.push('<button type="button" class="btn sm" data-d="' + i + '"' + (i === info.d ? ' style="border-color:var(--navy);color:var(--navy)"' : '') + '>D' + i + '</button>');
    }
    U.sheet({
      title: '手动指定轮转日', sub: '只影响 ' + ctx.date + ' 这一天，不改全局锚点',
      body: '<div class="small muted mb6">自动算出来是 D' + info.autoD + '（' + U.esc(P.DAYS[info.autoD].slotName) + '）</div>' +
        '<div class="btn-row" id="dayopts">' + opts.join('') + '</div>' +
        '<div class="mt14 small muted">选 D1 起算：D1/D2 白班、D3 休①、D4 夜班、D5 休②、D6 休③、D7 夜班、D8 中①、D9 中②、D10 休④</div>',
      actions: [
        {
          label: '恢复自动', onClick: function () {
            var r = Store.ensureDay(ctx.date); delete r.dIndex; Store.save(); Store.emit();
            U.toast('已恢复按日期自动计算'); ctx.refresh();
          }
        },
        { label: '取消' }
      ],
      onMount: function (rootEl, close) {
        U.$('#dayopts', rootEl).addEventListener('click', function (e) {
          var btn = e.target.closest('button[data-d]');
          if (!btn) return;
          var r = Store.ensureDay(ctx.date);
          r.dIndex = +btn.dataset.d;
          Store.save(); Store.emit();
          close();
          U.toast('已设为 D' + btn.dataset.d); ctx.refresh();
        });
      }
    });
  }

  function openTierOverride(ctx) {
    var info = ctx.info;
    var list = [['train', '训练日'], ['light', '轻度日'], ['rest', '非训练日']];
    U.sheet({
      title: '手动指定热量档', sub: '按"今天实际是否训练"选，不按日期死抠',
      body: '<div class="small muted mb6">自动算是「' + U.esc(info.tierName) + ' ' + info.kcal + ' kcal」</div>' +
        '<ul class="list">' + list.map(function (t) {
          var d = P.TIERS[t[0]];
          return '<li><button class="btn wide" data-tier="' + t[0] + '"' +
            (t[0] === info.tierKey ? ' style="border-color:var(--navy)"' : '') + '>' +
            U.esc(t[1]) + '　' + d.kcal + ' kcal　<span class="muted small">P' + d.p + '/C' + d.c + '/F' + d.f + '</span></button></li>';
        }).join('') + '</ul>',
      actions: [
        {
          label: '恢复自动', onClick: function () {
            var r = Store.ensureDay(ctx.date); delete r.tier; Store.save(); Store.emit();
            U.toast('已恢复自动'); ctx.refresh();
          }
        },
        { label: '取消' }
      ],
      onMount: function (rootEl, close) {
        rootEl.addEventListener('click', function (e) {
          var btn = e.target.closest('button[data-tier]');
          if (!btn) return;
          var r = Store.ensureDay(ctx.date);
          r.tier = btn.dataset.tier;
          Store.save(); Store.emit();
          close();
          U.toast('已改为' + P.TIERS[btn.dataset.tier].name); ctx.refresh();
        });
      }
    });
  }

  return { id: 'today', title: '今日', render: render, mount: mount, clockOf: clockOf, shiftChipClass: shiftChipClass };
});
