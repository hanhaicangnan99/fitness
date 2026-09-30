/*!
 * view.workout.js — 「训练」
 *
 * 默认极简：每个动作一个 ✓，点一下就算做了；顶端一个「全部完成」一键收工。
 * 重量 × 次数是**可选的**，点开某个动作才记（想跑容量/1RM 趋势的人再填）。
 * 动作可以换 / 加 / 删 / 挪，改完问一句「只今天」还是「以后都这样」。
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.workout = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, Store = JS.Store;

  var STATUS = {
    done: { text: '完成', cls: 'ok' },
    partial: { text: '部分完成', cls: 'warn' },
    skipped: { text: '跳过', cls: 'bad' },
    rest: { text: '休息日', cls: '' }
  };

  function wOf(ctx) {
    var r = Store.get().days[ctx.date];
    return (r && r.workout) ? r.workout : null;
  }
  function save() { Store.save(); }

  /* ================================================================== */
  function render(ctx) {
    var info = ctx.info, rec = ctx.state.days[ctx.date] || {};

    if (!info.isTrainDay) return renderRestDay(info, rec, ctx);

    var session = P.SESSIONS[info.sessionKey];
    if (!session) return U.emptyState('·', '课程模板缺失', 'sessionKey = ' + info.sessionKey);

    var w = rec.workout;
    var mismatch = w && w.sessionKey && w.sessionKey !== info.sessionKey && w.status !== 'rest';

    var defs = Store.sessionExercises(info.sessionKey);
    var overridden = Store.hasOverride(info.sessionKey);

    var h = [];

    /* ---- 头部 ---- */
    h.push('<div class="card">' +
      '<div class="card-h"><h2>' + U.esc(session.name) + '</h2>' +
      (w && STATUS[w.status] && w.status ? '<span class="chip ' + STATUS[w.status].cls + '">' + STATUS[w.status].text + '</span>' : '') +
      '</div>' +
      '<div class="small muted">' + U.esc(session.src) + '　·　' + U.esc(info.trainTime) + '</div>' +
      (overridden ? '<div class="small muted mt6">动作清单已按你的改动调整　' +
        '<button class="btn sm ghost" style="min-height:26px;padding:0 6px" data-act="reset-plan">恢复默认</button></div>' : '') +
      (info.deload ? U.note('<b>本周是减载周</b>：容量砍 45%（组数减半），重量不变，爬坡走保留。', 'warn') : '') +
      '</div>');

    if (mismatch) {
      h.push(U.note('这条记录是按 <b>' + U.esc((P.SESSIONS[w.sessionKey] || {}).name || w.sessionKey) +
        '</b> 记的，但今天按计划应该是 <b>' + U.esc(session.name) + '</b>。' +
        '<div class="mt10"><button class="btn sm primary" data-act="rebuild">按今天的课程重建记录</button></div>'));
    }

    /* ---- 还没开始 ---- */
    if (!w || mismatch) {
      if (!w) {
        h.push('<div class="card">' +
          '<div class="btn-row">' +
          '<button class="btn ok" data-act="start">开始打卡</button>' +
          '<button class="btn primary" data-act="start-all">✓ 今天全做完了</button>' +
          '</div>' +
          '<div class="small muted mt6">「开始打卡」后每个动作一个 ✓，点一下就完事；想记重量再点开。</div>' +
          '</div>');
        h.push(planPreview(defs, ctx));
        h.push(historyCard(ctx));
        return h.join('');
      }
    }

    var doneN = S.exerciseDoneCount(w), totalN = S.exerciseTotal(w);
    var allDone = totalN > 0 && doneN === totalN;
    var anyDetail = w.exercises.some(function (e) { return e.detail; });

    /* ---- 一键区 ---- */
    h.push('<div class="card">' +
      '<div class="row between mb10">' +
      '<div><div class="small muted">动作完成</div>' +
      '<div class="stat"><span class="n" id="done-count">' + doneN + '</span><span class="u">/ ' + totalN + ' 个</span></div></div>' +
      (doneN ? '<div class="right"><button class="btn sm" data-act="tick-none">全部取消</button></div>' : '') +
      '</div>' +
      (allDone
        ? '<button class="btn wide" data-act="tick-none">↺ 取消全部</button>'
        : '<button class="btn primary wide" data-act="tick-all">✓ 全部完成（' + (totalN - doneN) + ' 个待勾）</button>') +
      '<div class="mt10"><button class="btn ghost wide" data-act="toggle-detail">' +
      (anyDetail ? '收起重量记录' : '逐组记重量 / 次数（可选）') + '</button></div>' +
      '</div>');

    /* ---- 动作列表 ---- */
    h.push('<div class="sect-title">' + (anyDetail ? '点 ✓ 打卡，下面记重量' : '点一下 ✓ 就算做了') + '</div>');
    h.push('<div class="card" id="exlist">' + w.exercises.map(function (ex, i) {
      return exerciseRow(ex, i, ctx);
    }).join('') +
      '<div class="exrow" style="padding-top:10px">' +
      '<button class="btn sm wide" data-act="add-ex">＋ 添加动作</button>' +
      '</div></div>');

    /* ---- 有氧 ---- */
    h.push(cardioCard(w, ctx));

    /* ---- 收尾（折叠） ---- */
    h.push('<details class="card"><summary style="cursor:pointer;font-size:15px;font-weight:600">本次小结（可选）</summary>' +
      '<div class="grid2 mt10">' +
      '<div class="cell"><span>整体 RPE</span><input type="number" step="0.5" min="1" max="10" inputmode="decimal" data-bind="rpe" value="' +
      (w.rpe == null ? '' : w.rpe) + '" placeholder="8"></div>' +
      '<div class="cell"><span>总用时（分钟）</span><input type="number" step="5" inputmode="numeric" data-bind="duration" value="' +
      (w.durationMin == null ? '' : w.durationMin) + '" placeholder="120"></div>' +
      '</div>' +
      '<div class="mt10"><span class="small muted">备注</span>' +
      '<textarea data-bind="note" placeholder="状态、器械、疼痛、临时调整…">' + U.esc(w.note || '') + '</textarea></div>' +
      '</details>');

    /* ---- 状态 ---- */
    h.push('<div class="card"><div class="card-h"><h2>状态</h2>' +
      (w.degraded ? '<span class="chip warn">已降级：' + U.esc(degradeLabel(w.degraded)) + '</span>' : '') +
      '</div>' +
      '<div class="small muted mb10">勾 ✓ 会自动同步状态（全勾=完成，勾一半=部分完成）。下面可以手动覆盖。</div>' +
      '<div class="btn-row">' +
      '<button class="btn' + (w.status === 'partial' ? ' primary' : '') + '" data-status="partial">部分完成</button>' +
      '<button class="btn bad" data-status="skipped">今天没练</button>' +
      (w.status ? '<button class="btn" data-status="">清除状态</button>' : '') +
      '</div>' +
      '<div class="small muted mt6">跳过 / 没练不补，从下一个训练日继续，别打乱轮转。</div>' +
      '</div>');

    h.push(degradeCard(ctx));
    h.push('<div class="card tight"><button class="btn wide" data-go="editor">编排这一天的动作（长期）</button>' +
      '<div class="small muted mt6">提前把清单排好，下次练到它直接照着练。当天的临时改动用上面的 ⋯。</div></div>');
    h.push(historyCard(ctx));

    return h.join('');
  }

  function totalPlannedSets(w) {
    var n = 0;
    for (var i = 0; i < w.exercises.length; i++) n += (w.exercises[i].sets || []).length;
    return n;
  }
  function degradeLabel(k) {
    return { time45: '只有 45 分钟', sleep: '睡眠不足不训练', deload: '减载周' }[k] || k;
  }

  /* ------------------------------------------------------------------ */
  function exerciseRow(ex, i, ctx) {
    var last = S.lastPerformance(ctx.state, ex.name, ctx.date);
    var numbers = ex.sets.filter(function (s) { return s.w != null && s.r != null; })
      .map(function (s) { return U.num(s.w, 1) + '×' + s.r; }).join('　');
    var vol = S.volume(ex);
    var ph = P.EXERCISE_LIB_MAP[ex.name];
    var grp = P.groupFor(ex.name);

    var sub = ex.planned.sets + ' 组 × ' + ex.planned.reps +
      (ex.planned.rest ? '　·　组间 ' + ex.planned.rest + 's' : '') +
      (ex.planned.target ? '　·　' + ex.planned.target : '');

    var h = ['<div class="exrow" data-ex="' + i + '">'];
    h.push('<div class="exline">' +
      '<button class="extick' + (ex.done ? ' on' : '') + '" data-tick="' + i + '" aria-label="标记' + U.esc(ex.name) + '完成">✓</button>' +
      '<div class="grow" data-toggle="' + i + '">' +
      '<div class="exname' + (ex.done ? ' done' : '') + '">' + U.esc(ex.name) + '</div>' +
      '<div class="explan">' + (numbers ? numbers + '　·　' + U.int(vol) + 'kg' : sub) + '</div>' +
      '</div>' +
      '<button class="exmore" data-more="' + i + '" aria-label="动作选项">⋯</button>' +
      '</div>');

    h.push('<div class="exdet" data-det="' + i + '"' + (ex.detail ? '' : ' style="display:none"') + '>');
    if (last) {
      h.push('<div class="lastref">上次（' + U.esc(last.date) + '）：' +
        last.sets.filter(function (s) { return s.w != null && s.r != null; })
          .map(function (s) { return U.num(s.w, 1) + '×' + s.r; }).join('　') +
        (last.top ? '　·　约 1RM ' + U.num(last.top, 1) + 'kg' : '') + '</div>');
    } else {
      h.push('<div class="lastref">这个动作还没有历史记录</div>');
    }
    h.push('<div class="setgrid" style="margin-top:6px"><div></div><div class="hd">重量 kg</div><div class="hd">次数</div></div>');
    h.push(ex.sets.map(function (st, j) {
      return '<div class="setgrid">' +
        '<div class="sn">' + (j + 1) + '</div>' +
        '<input type="number" step="0.5" inputmode="decimal" data-bind="set" data-ex="' + i + '" data-set="' + j + '" data-f="w" value="' +
        (st.w == null ? '' : st.w) + '" placeholder="' + (last && last.sets[j] && last.sets[j].w != null ? last.sets[j].w : 'kg') + '">' +
        '<input type="number" step="1" inputmode="numeric" data-bind="set" data-ex="' + i + '" data-set="' + j + '" data-f="r" value="' +
        (st.r == null ? '' : st.r) + '" placeholder="' + (last && last.sets[j] && last.sets[j].r != null ? last.sets[j].r : '次') + '">' +
        '</div>';
    }).join(''));

    h.push('<div class="btn-row mt10">' +
      (last ? '<button class="btn sm" data-act="copy-last" data-ex="' + i + '">沿用上次</button>' : '') +
      '<button class="btn sm" data-act="fill-row" data-ex="' + i + '">整行同值</button>' +
      (numbers ? '<button class="btn sm" data-act="clear-sets" data-ex="' + i + '">清空数字</button>' : '') +
      '</div>');

    h.push('<div data-hint="' + i + '">' + hintHtml(ex, ctx) + '</div>');

    if (ex.planned.note) h.push('<div class="exnote">要点：' + U.esc(ex.planned.note) + '</div>');
    if (ph && ph[2]) h.push('<div class="exnote">器械：' + U.esc(ph[2]) + '</div>');
    if (grp) {
      h.push('<div class="exnote">同类替代：' +
        grp.options.filter(function (o) { return o[0] !== ex.name; }).map(function (o) { return U.esc(o[0]); }).join('、') +
        '　—— 点右上角 ⋯ 一键换</div>');
    }

    h.push('<div class="row mt6"><input type="number" step="0.5" min="1" max="10" inputmode="decimal" data-bind="exrpe" data-ex="' + i +
      '" value="' + (ex.rpe == null ? '' : ex.rpe) + '" placeholder="RPE" style="max-width:88px">' +
      '<input type="text" data-bind="exnote" data-ex="' + i + '" value="' + U.esc(ex.note || '') + '" placeholder="这个动作的备注" style="flex:1"></div>');
    h.push('</div></div>');
    return h.join('');
  }

  function hintHtml(ex, ctx) {
    var hint = S.progressionHint(ex, S.lastPerformance(ctx.state, ex.name, ctx.date));
    if (!hint) return '';
    return '<div class="' + (hint.kind === 'up' ? 'hintup' : hint.kind === 'down' ? 'hintdn' : 'lastref') + '">' +
      U.esc(hint.text) + '</div>';
  }

  function cardioCard(w, ctx) {
    var c = w.cardio || {};
    var plan = P.CARDIO[w.sessionKey] || {};
    if (plan.min === 0) {
      return U.card('有氧', U.note(U.esc(plan.note || '今天不做有氧'), 'info'));
    }
    return '<div class="card">' +
      '<div class="exline">' +
      '<button class="extick' + (c.done ? ' on' : '') + '" data-cardio-tick aria-label="有氧打卡">✓</button>' +
      '<div class="grow">' +
      '<div class="exname' + (c.done ? ' done' : '') + '">跑步机爬坡走</div>' +
      '<div class="explan">' + (c.done ? (c.min || plan.min) + ' 分钟已计入统计' : '计划 ' + plan.min + ' 分钟 · 坡度 12 · 速度 4.5') + '</div>' +
      '</div></div>' +
      '<details class="mt10"><summary class="small muted" style="cursor:pointer">改时长 / 坡度 / 速度 / 心率</summary>' +
      '<div class="grid4 mt10">' +
      '<div class="cell"><span>时长 分</span><input type="number" step="5" inputmode="numeric" data-bind="cardio" data-f="min" value="' + (c.min == null ? '' : c.min) + '"></div>' +
      '<div class="cell"><span>坡度</span><input type="number" step="1" inputmode="numeric" data-bind="cardio" data-f="grade" value="' + (c.grade == null ? '' : c.grade) + '"></div>' +
      '<div class="cell"><span>速度</span><input type="number" step="0.1" inputmode="decimal" data-bind="cardio" data-f="speed" value="' + (c.speed == null ? '' : c.speed) + '"></div>' +
      '<div class="cell"><span>心率</span><input type="number" step="1" inputmode="numeric" data-bind="cardio" data-f="hr" value="' + (c.hr == null ? '' : c.hr) + '"></div>' +
      '</div>' + (plan.note ? U.note(U.esc(plan.note), 'info') : '') + '</details>' +
      '</div>';
  }

  function planPreview(defs, ctx) {
    return U.card('今天要做的动作', U.table(
      ['', '动作', '组数', '次数', '组间'],
      defs.map(function (e, i) { return [i + 1, U.esc(e[0]), e[1], U.esc(e[2]), e[4] + 's']; })
    ) + '<div class="small muted mt6">开始打卡后可以点 ⋯ 换动作、加动作、删动作。</div>');
  }

  function degradeCard(ctx) {
    return U.card('临时降级', '<div class="small muted mb10">顶班 / 加班 / 太累时用，会按规则改今天的记录。</div>' +
      '<div class="btn-row">' +
      '<button class="btn sm" data-act="d45">只有 45 分钟</button>' +
      '<button class="btn sm" data-act="dsleep">睡眠 &lt; 6h 不训练</button>' +
      '</div>');
  }

  /* ------------------------------------------------------------------ */
  function historyCard(ctx) {
    var dates = Store.sortedDates().filter(function (d) {
      var w = ctx.state.days[d].workout;
      return w && (w.status === 'done' || w.status === 'partial' || w.status === 'skipped') && w.exercises && w.exercises.length;
    }).reverse().slice(0, 15);

    if (!dates.length) return U.card('训练历史', U.emptyState('📋', '还没有训练记录'));
    return U.card('训练历史', '<ul class="list">' + dates.map(function (d) {
      var w = ctx.state.days[d].workout;
      var sess = P.SESSIONS[w.sessionKey];
      var dn = S.exerciseDoneCount(w), tn = S.exerciseTotal(w);
      return '<li><button class="btn wide" style="justify-content:space-between;font-weight:500" data-hist="' + d + '">' +
        '<span style="text-align:left"><b>' + U.esc(d) + '</b> <span class="muted small">' + U.esc(P.weekday(d)) + '</span>' +
        '<span class="s small muted" style="display:block">' + U.esc(sess ? sess.name : w.sessionKey) + '</span></span>' +
        '<span class="right nw"><span class="chip ' + STATUS[w.status].cls + '">' + STATUS[w.status].text + '</span>' +
        '<span class="small muted" style="display:block">' + dn + '/' + tn + ' 动作' +
        (S.sessionSetCount(w) ? ' · ' + U.int(S.sessionVolume(w)) + 'kg' : '') + '</span></span>' +
        '</button></li>';
    }).join('') + '</ul>' +
      (ctx.state.config.planMode === 'ppl'
        ? '<div class="small muted mt10">备选方案指针：下一次轮到 <b>' + U.esc(P.PPL_NAMES[P.PPL_ORDER[ctx.state.config.pplCursor % 3]]) + '日</b></div>' : ''));
  }

  function renderRestDay(info, rec, ctx) {
    var w = rec.workout;
    var h = [];
    var shift = P.SHIFT_TIME[info.shift];
    h.push('<div class="card">' +
      '<div class="card-h"><h2>今天不训练</h2>' +
      (w && w.status === 'rest' ? '<span class="chip ok">已打卡</span>' : '') + '</div>' +
      '<div class="small muted">D' + info.d + '　' + U.esc(info.shift) + '班' + (shift !== '—' ? '　' + U.esc(shift) : '') +
      '　·　' + U.esc(info.phase.name) + ' 第 ' + info.week + ' 周</div>' +
      '</div>');
    h.push(U.card('为什么不练',
      U.kvRows([
        ['D1 / D2', '白班 10:00-19:00，起床 09:00 就要赶 09:30 班车，排不进 2 小时训练'],
        ['D4 / D7', '夜班 02:30-10:30，起床 00:30；下班后优先补觉'],
        ['D9', '中班 18:30-次日 03:30，起床 12:30，且当天的第二餐在岗上'],
        ['规律', '不补练。某天没练成，从下一个训练日继续，别打乱轮转']
      ])));
    if (w && w.status === 'rest') {
      h.push('<button class="btn bad wide mt10" data-act="unrest">撤销"今日休息"打卡</button>');
    } else {
      h.push('<button class="btn primary wide mt10" data-act="rest">今日休息 ✓</button>');
    }
    h.push(U.card('还是想练？', U.note('源计划的降级规则：<b>只剩 2 天</b>就上肢体 + 下肢体各一次，复合动作全上；<b>只有 45 分钟</b>就只做前 3 个动作 + 有氧 20 分钟。<br>真要练，先去「今日」把轮转日改成对应的训练日再打卡。', 'info')));
    h.push(U.card('强度与渐进', U.kvRows(P.RULES.intensity.map(function (r) { return [r[0], U.esc(r[1])]; }))));
    h.push(historyCard(ctx));
    return h.join('');
  }

  /* ==================================================================
   * 事件
   * ================================================================== */
  function mount(rootEl, ctx) {
    var t = null;
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.dataset || !el.dataset.bind) return;
      if (t) clearTimeout(t);
      t = setTimeout(function () { applyInput(el, ctx, rootEl); }, 220);
    });

    rootEl.addEventListener('click', function (e) {
      var el = e.target.closest('[data-tick],[data-more],[data-toggle],[data-cardio-tick],[data-act],[data-status],[data-hist]');
      if (!el) return;

      if (el.dataset.hist) { openHistory(ctx, el.dataset.hist); return; }
      if (el.dataset.tick != null && el.dataset.tick !== '') { tickExercise(ctx, +el.dataset.tick); return; }
      if (el.hasAttribute('data-cardio-tick')) { toggleCardio(ctx); return; }
      if (el.dataset.more != null && el.dataset.more !== '') { openExerciseMenu(ctx, +el.dataset.more); return; }
      if (el.dataset.toggle != null && el.dataset.toggle !== '') { toggleDetail(ctx, +el.dataset.toggle); return; }
      if (el.dataset.status != null) { setStatus(ctx, el.dataset.status); return; }
      if (el.dataset.act) { doAction(el.dataset.act, el, ctx, rootEl); }
    });
  }

  function doAction(act, el, ctx, rootEl) {
    var info = ctx.info;
    if (act === 'start') { startWorkout(ctx, false); return; }
    if (act === 'start-all') { startWorkout(ctx, true); return; }
    if (act === 'tick-all') { tickAll(ctx, true); return; }
    if (act === 'tick-none') { tickAll(ctx, false); return; }
    if (act === 'toggle-detail') { setAllDetail(ctx); return; }
    if (act === 'add-ex') { addExercise(ctx, -1); return; }
    if (act === 'copy-last') { copyLast(ctx, +el.dataset.ex); return; }
    if (act === 'fill-row') { fillRow(ctx, +el.dataset.ex); return; }
    if (act === 'clear-sets') { clearSets(ctx, +el.dataset.ex); return; }
    if (act === 'd45') { applyDegrade45(ctx); return; }
    if (act === 'dsleep') { applyDegradeSleep(ctx); return; }
    if (act === 'rebuild') { doRebuild(ctx); return; }
    if (act === 'reset-plan') { resetPlan(ctx); return; }
    if (act === 'rest') {
      Store.patchDay(ctx.date, { workout: { status: 'rest', sessionKey: 'rest' } });
      U.toast('已打卡：今日休息'); ctx.refresh(); return;
    }
    if (act === 'unrest') {
      var r = Store.ensureDay(ctx.date); delete r.workout; Store.save(); Store.emit();
      ctx.refresh(); return;
    }
  }

  /* ---- 打卡状态 ---- */
  function startWorkout(ctx, markAll) {
    var w = Store.emptyWorkout(ctx.info.sessionKey, ctx.info.deload);
    if (ctx.info.deload) w.degraded = 'deload';
    Store.setWorkout(ctx.date, w);
    if (markAll) {
      tickAll(ctx, true, true);
      U.toast('已记录：今天全部完成');
    } else {
      U.toast('开始打卡，点 ✓ 就算做了');
    }
    ctx.refresh();
  }

  function syncStatus(w) {
    if (w.status === 'skipped') return;
    var n = S.exerciseDoneCount(w), t = S.exerciseTotal(w);
    w.status = (t && n === t) ? 'done' : (n > 0 ? 'partial' : '');
  }

  function tickExercise(ctx, i) {
    var w = wOf(ctx);
    if (!w || !w.exercises[i]) return;
    w.exercises[i].done = !w.exercises[i].done;
    syncStatus(w);
    Store.save();
    if (w.status === 'done') Store.advancePplIfNeeded(ctx.date);
    Store.saveNow();
    // 只更新受影响的部分，避免整页重绘导致滚动跳
    var row = document.querySelector('[data-ex="' + i + '"]');
    if (row) {
      var btn = row.querySelector('[data-tick]');
      var nm = row.querySelector('.exname');
      if (btn) btn.classList.toggle('on', !!w.exercises[i].done);
      if (nm) nm.classList.toggle('done', !!w.exercises[i].done);
    }
    var dc = document.getElementById('done-count');
    if (dc) dc.textContent = S.exerciseDoneCount(w);
    if (w.status === 'done' && !w.__toasted) { w.__toasted = true; U.toast('全部动作完成 ✓'); }
    if (w.status !== 'done') delete w.__toasted;
  }

  function tickAll(ctx, on, silent) {
    var w = wOf(ctx);
    if (!w) return;
    w.exercises.forEach(function (ex) { ex.done = !!on; });
    w.cardio = w.cardio || {};
    if (on) { w.cardio.done = true; if (!w.cardio.min) w.cardio.min = (P.CARDIO[w.sessionKey] || {}).min || 0; }
    else { w.cardio.done = (P.CARDIO[w.sessionKey] || {}).min === 0; }
    w.status = on ? 'done' : '';
    if (on) Store.advancePplIfNeeded(ctx.date);
    Store.saveNow();
    if (!silent) { U.toast(on ? '全部完成 ✓' : '已全部取消'); ctx.refresh(); }
  }

  function toggleCardio(ctx) {
    var w = wOf(ctx);
    if (!w) return;
    w.cardio = w.cardio || {};
    w.cardio.done = !w.cardio.done;
    if (w.cardio.done && !w.cardio.min) w.cardio.min = (P.CARDIO[w.sessionKey] || {}).min || 0;
    Store.saveNow();
    U.toast(w.cardio.done ? '有氧 ' + (w.cardio.min || 0) + ' 分钟已计入统计' : '已取消有氧打卡');
    ctx.refresh();
  }

  function setStatus(ctx, status) {
    var w = wOf(ctx);
    if (!w) return;
    w.status = status;
    if (status === 'skipped') {
      w.exercises.forEach(function (ex) { ex.done = false; });
      w.cardio = w.cardio || {}; w.cardio.done = false;
      Store.saveNow(); U.toast('已标记：今天没练（不补）'); ctx.refresh(); return;
    }
    if (status === 'partial') { w.status = 'partial'; }
    if (status === 'done') Store.advancePplIfNeeded(ctx.date);
    Store.saveNow();
    ctx.refresh();
  }

  function toggleDetail(ctx, i) {
    var w = wOf(ctx);
    if (!w || !w.exercises[i]) return;
    var open = !w.exercises[i].detail;
    w.exercises[i].detail = open;
    Store.save();
    var box = document.querySelector('[data-det="' + i + '"]');
    if (box) box.style.display = open ? '' : 'none';
  }

  function setAllDetail(ctx) {
    var w = wOf(ctx);
    if (!w) return;
    var any = w.exercises.some(function (e) { return e.detail; });
    w.exercises.forEach(function (e) { e.detail = !any; });
    Store.saveNow();
    ctx.refresh();
  }

  /* ---- 数字输入 ---- */
  function applyInput(el, ctx, rootEl) {
    var b = el.dataset.bind;
    var w = wOf(ctx);
    if (!w) return;

    if (b === 'set') {
      var ei = +el.dataset.ex, si = +el.dataset.set, f = el.dataset.f;
      var ex = w.exercises[ei];
      if (!ex || !ex.sets[si]) return;
      var v = U.numVal(el.value);
      if (v != null && v < 0) v = null;
      ex.sets[si][f] = v;
      // 填了数字就视为做了
      if (v != null && !ex.done) { ex.done = true; syncStatus(w); }
      Store.save();
      refreshRow(ctx, ei);
    } else if (b === 'exrpe') {
      var e2 = w.exercises[+el.dataset.ex];
      if (e2) { e2.rpe = U.numVal(el.value); Store.save(); }
    } else if (b === 'exnote') {
      var e3 = w.exercises[+el.dataset.ex];
      if (e3) { e3.note = el.value; Store.save(); }
    } else if (b === 'rpe') { w.rpe = U.numVal(el.value); Store.save(); }
    else if (b === 'duration') { w.durationMin = U.numVal(el.value); Store.save(); }
    else if (b === 'note') { w.note = el.value; Store.save(); }
    else if (b === 'cardio') { w.cardio[el.dataset.f] = U.numVal(el.value); Store.save(); }
  }

  function refreshRow(ctx, i) {
    var w = wOf(ctx);
    var ex = w.exercises[i];
    var row = document.querySelector('[data-ex="' + i + '"]');
    if (row) {
      var expl = row.querySelector('.explan');
      var numbers = ex.sets.filter(function (s) { return s.w != null && s.r != null; })
        .map(function (s) { return U.num(s.w, 1) + '×' + s.r; }).join('　');
      if (expl) {
        expl.textContent = numbers ? numbers + '　·　' + U.int(S.volume(ex)) + 'kg'
          : ex.planned.sets + ' 组 × ' + ex.planned.reps;
      }
      var tick = row.querySelector('[data-tick]');
      if (tick) tick.classList.toggle('on', !!ex.done);
      var hint = row.querySelector('[data-hint="' + i + '"]');
      if (hint) hint.innerHTML = hintHtml(ex, ctx);
    }
    var dc = document.getElementById('done-count');
    if (dc) dc.textContent = S.exerciseDoneCount(w);
  }

  function copyLast(ctx, ei) {
    var w = wOf(ctx);
    var ex = w.exercises[ei];
    var last = S.lastPerformance(ctx.state, ex.name, ctx.date);
    if (!last) { U.toast('没有可沿用的记录'); return; }
    var n = 0;
    for (var i = 0; i < ex.sets.length; i++) {
      var src = last.sets[i] || last.sets[last.sets.length - 1];
      if (!src || src.w == null) continue;
      ex.sets[i].w = src.w;
      if (src.r != null) ex.sets[i].r = src.r;
      n++;
    }
    ex.done = true;
    syncStatus(w);
    Store.saveNow();
    U.toast('已沿用上次 ' + n + ' 组');
    ctx.refresh();
  }

  function fillRow(ctx, ei) {
    var w = wOf(ctx);
    var ex = w.exercises[ei];
    var last = S.lastPerformance(ctx.state, ex.name, ctx.date);
    U.sheet({
      title: '整行同值', sub: U.esc(ex.name),
      body: '<div class="grid2">' +
        '<div class="cell"><span>重量 kg</span><input type="number" step="0.5" inputmode="decimal" id="fw" value="' +
        (last && last.sets[0] && last.sets[0].w != null ? last.sets[0].w : '') + '"></div>' +
        '<div class="cell"><span>次数</span><input type="number" step="1" inputmode="numeric" id="fr" value="' +
        (S.repsUpper(ex.planned.reps) || '') + '"></div>' +
        '</div>' + U.note('所有 ' + ex.sets.length + ' 组都用这两个数。', 'info'),
      actions: [
        { label: '取消' },
        {
          label: '填上', cls: 'primary', onClick: function (rootEl) {
            var wv = U.numVal(U.$('#fw', rootEl).value), rv = U.numVal(U.$('#fr', rootEl).value);
            if (wv == null && rv == null) { U.toast('至少填一个'); return false; }
            for (var i = 0; i < ex.sets.length; i++) {
              if (wv != null) ex.sets[i].w = wv;
              if (rv != null) ex.sets[i].r = rv;
            }
            ex.done = true;
            syncStatus(w);
            Store.saveNow();
            U.toast('已填 ' + ex.sets.length + ' 组');
            ctx.refresh();
          }
        }
      ]
    });
  }

  function clearSets(ctx, ei) {
    var w = wOf(ctx);
    var ex = w.exercises[ei];
    ex.sets.forEach(function (s) { s.w = null; s.r = null; });
    Store.saveNow();
    ctx.refresh();
  }

  /* ---- 动作编辑 ---- */
  function openExerciseMenu(ctx, i) {
    var w = wOf(ctx);
    if (!w || !w.exercises[i]) return;
    var ex = w.exercises[i];
    var grp = P.groupFor(ex.name);
    var alts = grp ? grp.options.filter(function (o) { return o[0] !== ex.name; }) : [];

    var body = '<div class="small muted mb10">' + U.esc(ex.planned.sets + ' 组 × ' + ex.planned.reps +
      (ex.planned.target ? '　·　' + ex.planned.target : '')) + '</div>' +
      (alts.length ? '<div class="small muted mb6">同类替代（' + U.esc(grp.area) + '）</div>' +
        '<div class="btn-row mb10">' + alts.map(function (o) {
          return '<button class="btn sm" style="flex:1 1 46%" data-alt="' + U.esc(o[0]) + '">' + U.esc(o[0]) + '</button>';
        }).join('') + '</div>' : '') +
      '<div class="btn-row">' +
      '<button class="btn sm primary" data-m="pick">看全部动作库</button>' +
      '<button class="btn sm" data-m="custom">自定义名称</button>' +
      '</div>' +
      '<div class="btn-row mt10">' +
      '<button class="btn sm" data-m="insert">在下面插入</button>' +
      '<button class="btn sm" data-m="up">上移</button>' +
      '<button class="btn sm" data-m="down">下移</button>' +
      '</div>' +
      '<button class="btn bad wide mt10" data-m="del">删除这个动作</button>';

    U.sheet({
      title: ex.name, sub: '第 ' + (i + 1) + ' 个动作　·　共 ' + w.exercises.length + ' 个',
      body: body,
      actions: [{ label: '取消' }],
      onMount: function (rootEl, close) {
        rootEl.addEventListener('click', function (e) {
          var alt = e.target.closest('[data-alt]');
          if (alt) { close(); swapWith(ctx, i, alt.dataset.alt); return; }
          var m = e.target.closest('[data-m]');
          if (!m) return;
          var kind = m.dataset.m;
          if (kind === 'del') {
            close();
            if (!Store.removeExercise(w, i)) { U.toast('至少留一个动作'); return; }
            Store.saveNow(); afterStructuralChange(ctx, '已删除'); return;
          }
          if (kind === 'up' || kind === 'down') {
            close();
            if (!Store.moveExercise(w, i, kind === 'up' ? -1 : 1)) { U.toast('已经到顶/到底了'); return; }
            Store.saveNow(); afterStructuralChange(ctx, '已移动'); return;
          }
          if (kind === 'pick') { close(); pickExercise(ctx, ex.name, function (name) { swapWith(ctx, i, name); }); return; }
          if (kind === 'custom') {
            close();
            U.promptSheet({ title: '动作名称', value: ex.name }).then(function (v) {
              if (v == null || !String(v).trim()) return;
              swapWith(ctx, i, String(v).trim(), true);
            });
            return;
          }
          if (kind === 'insert') { close(); addExercise(ctx, i); return; }
        });
      }
    });
  }

  function swapWith(ctx, i, name, keepPlanned) {
    var w = wOf(ctx);
    var old = w.exercises[i];
    var def = findDef(name);
    if (!def) def = [name, old.planned.sets, old.planned.reps, old.planned.tempo, old.planned.rest, old.planned.target, old.planned.note];
    if (keepPlanned) def = [name, old.planned.sets, old.planned.reps, old.planned.tempo, old.planned.rest, def[5], def[6]];
    Store.swapExercise(w, i, def);
    Store.saveNow();
    afterStructuralChange(ctx, '已换成 ' + name);
  }

  function addExercise(ctx, afterIndex) {
    pickExercise(ctx, null, function (name) {
      var w = wOf(ctx);
      var def = findDef(name) || [name, 3, '8-12', '3秒', 75, '', ''];
      Store.insertExercise(w, afterIndex + 1, def);
      var nw = w.exercises[afterIndex + 1];
      if (nw) nw.detail = true;
      Store.saveNow();
      afterStructuralChange(ctx, '已添加 ' + name);
    });
  }

  /** 动作库里按名字找默认参数（先查动作库，再退回任意课程里的同名动作） */
  function findDef(name) {
    var d = P.exDef(name);
    if (d) return d;
    var keys = Object.keys(P.SESSIONS);
    for (var k = 0; k < keys.length; k++) {
      var exs = P.SESSIONS[keys[k]].exercises;
      for (var i = 0; i < exs.length; i++) if (exs[i][0] === name) return exs[i].slice();
    }
    return null;
  }

  /**
   * 动作选择器：把「同类替代」放在最前面（这是最常用的），
   * 下面再给完整动作库（按动作类型分组）。
   */
  function pickExercise(ctx, current, onPick) {
    var g = current ? P.groupFor(current) : null;
    var h = [];

    if (g) {
      h.push('<div class="sect-title" style="margin:12px 0 6px 0">同类替代（推荐）</div>');
      h.push('<div class="small muted mb10">' + U.esc(g.area) + '　·　目标：' + U.esc(g.muscle) +
        '　·　换的是<strong>同一个动作模式</strong>，不会改变训练内容</div>');
      h.push(g.options.map(function (o) {
        var on = o[0] === current;
        return '<button class="btn wide mb6" style="justify-content:flex-start;text-align:left;' +
          (on ? 'border-color:var(--navy);background:var(--info-bg)' : '') + '" data-pick="' + U.esc(o[0]) + '">' +
          '<span style="flex:1"><b>' + U.esc(o[0]) + '</b>' + (on ? ' <span class="chip">当前</span>' : '') +
          '<span class="s small muted" style="display:block">' + U.esc(o[6]) + '　·　' + o[1] + ' 组 × ' + U.esc(o[2]) + '</span>' +
          '<span class="s small muted" style="display:block">' + U.esc(o[7]) + '</span></span>' +
          '</button>';
      }).join(''));
    }

    h.push('<div class="sect-title" style="margin:16px 0 6px 0">' + (g ? '或者从别的动作类型里挑' : '全部动作库') + '</div>');
    h.push(P.EX_GROUPS.map(function (gg) {
      return '<div class="small muted" style="margin-top:10px">' + U.esc(gg.area) + '　·　' + U.esc(gg.muscle) + '</div>' +
        '<div class="btn-row">' + gg.options.map(function (o) {
          var on = o[0] === current;
          return '<button class="btn sm" style="flex:1 1 46%;' + (on ? 'border-color:var(--navy);color:var(--navy)' : '') +
            '" data-pick="' + U.esc(o[0]) + '">' + U.esc(o[0]) + '</button>';
        }).join('') + '</div>';
    }).join(''));

    U.sheet({
      title: current ? '换成哪个动作？' : '添加哪个动作？',
      sub: current ? '当前：' + current : '组数 / 次数会按动作库自动带出来',
      body: h.join('') + U.note('找不到想要的？关掉这个窗口，用「自定义名称」手输一个。', 'info'),
      actions: [{ label: '取消' }],
      onMount: function (rootEl, close) {
        rootEl.addEventListener('click', function (e) {
          var b = e.target.closest('[data-pick]');
          if (!b) return;
          close();
          onPick(b.dataset.pick);
        });
      }
    });
  }

  /**
   * 结构性改动之后问一句：只今天，还是以后都这样。
   * 用户选「以后都这样」就把它写进计划（config.sessionOverrides）。
   */
  function afterStructuralChange(ctx, toastText) {
    var w = wOf(ctx);
    var key = ctx.info.sessionKey;
    var settled = false;
    U.sheet({
      title: '这个改动以后也保留吗？',
      sub: toastText,
      body: U.note(
        '<b>只今天</b>：只影响 ' + ctx.date + ' 这条记录，计划不动。<br>' +
        '<b>以后都这样</b>：把这个训练日（' + U.esc((P.SESSIONS[key] || {}).name || key) + '）的动作清单改成现在这样，' +
        '下次再练到它会直接用新的。想撤回去，在「我的」里点「恢复默认动作」。', 'info'),
      actions: [
        {
          label: '只今天', onClick: function () {
            if (settled) return; settled = true;
            U.toast('只改了 ' + ctx.date);
            ctx.refresh();
          }
        },
        {
          label: '以后都这样', cls: 'primary', onClick: function () {
            if (settled) return; settled = true;
            Store.setSessionOverride(key, Store.defsFromWorkout(w));
            U.toast('已写入计划，以后都按这个来');
            ctx.refresh();
          }
        }
      ],
      onClose: function () {
        if (settled) return; settled = true;
        ctx.refresh();
      }
    });
  }

  function resetPlan(ctx) {
    var key = ctx.info.sessionKey;
    U.confirmSheet({
      title: '恢复默认动作？',
      text: '「' + ((P.SESSIONS[key] || {}).name || key) + '」会回到源计划的动作清单。已记的训练历史不受影响。',
      okLabel: '恢复默认'
    }).then(function (yes) {
      if (!yes) return;
      Store.clearSessionOverride(key);
      U.toast('已恢复默认动作');
      ctx.refresh();
    });
  }

  /* ---- 降级 ---- */
  function applyDegrade45(ctx) {
    var w = wOf(ctx);
    if (!w) { U.toast('先点「开始打卡」'); return; }
    U.confirmSheet({
      title: '只有 45 分钟',
      text: '只做力量的前 3 个动作，有氧砍到 20 分钟。后面动作会从今天的记录里去掉（计划本身不动）。',
      okLabel: '套用'
    }).then(function (yes) {
      if (!yes) return;
      w.exercises = w.exercises.slice(0, 3);
      w.cardio = w.cardio || {};
      w.cardio.min = 20; w.cardio.done = true;
      w.degraded = 'time45';
      Store.saveNow();
      U.toast('已套用：前 3 个动作 + 有氧 20 分钟');
      ctx.refresh();
    });
  }

  function applyDegradeSleep(ctx) {
    U.confirmSheet({
      title: '睡眠不足，今天不训练',
      text: '源计划规则：睡眠 < 6 小时当天不训练、不加有氧，优先补觉。今天会标记为「没练」，不补。',
      okLabel: '就按这个来', danger: true
    }).then(function (yes) {
      if (!yes) return;
      var rec = Store.ensureDay(ctx.date);
      if (!rec.workout) rec.workout = Store.emptyWorkout(ctx.info.sessionKey, ctx.info.deload);
      rec.workout.status = 'skipped';
      rec.workout.degraded = 'sleep';
      rec.workout.exercises.forEach(function (ex) { ex.done = false; });
      rec.workout.cardio = rec.workout.cardio || {};
      rec.workout.cardio.done = false;
      Store.saveNow();
      U.toast('已标记：今天不训练，优先补觉');
      ctx.refresh();
    });
  }

  function doRebuild(ctx) {
    U.confirmSheet({
      title: '重建今天的记录',
      text: '会按今天的课程（' + P.SESSIONS[ctx.info.sessionKey].name + '）重建，已勾的和已填的数字会丢。',
      okLabel: '重建', danger: true
    }).then(function (yes) {
      if (!yes) return;
      Store.setWorkout(ctx.date, Store.emptyWorkout(ctx.info.sessionKey, ctx.info.deload));
      Store.saveNow();
      U.toast('已重建');
      ctx.refresh();
    });
  }

  /* ---- 历史 ---- */
  function openHistory(ctx, date) {
    var w = ctx.state.days[date].workout;
    if (!w) return;
    var sess = P.SESSIONS[w.sessionKey];
    var dn = S.exerciseDoneCount(w), tn = S.exerciseTotal(w);
    var rows = w.exercises.map(function (ex) {
      var s = ex.sets.filter(function (x) { return x.w != null && x.r != null; })
        .map(function (x) { return U.num(x.w, 1) + '×' + x.r; }).join('　');
      return [(ex.done ? '✓ ' : '') + U.esc(ex.name), s || '<span class="muted">—</span>',
        S.volume(ex) ? U.int(S.volume(ex)) : '', ex.rpe == null ? '' : ex.rpe];
    });
    U.sheet({
      title: date + '　' + (sess ? sess.name : w.sessionKey),
      sub: P.weekday(date) + '　' + (STATUS[w.status] ? STATUS[w.status].text : '') +
        '　' + dn + '/' + tn + ' 个动作' +
        (S.sessionSetCount(w) ? '　' + S.sessionSetCount(w) + ' 组 · ' + U.int(S.sessionVolume(w)) + ' kg' : '') +
        (w.durationMin ? '　用时 ' + w.durationMin + ' 分钟' : ''),
      body: U.table(['动作', '各组 重量×次数', '容量 kg', 'RPE'], rows) +
        (w.cardio && w.cardio.min ? '<div class="note ' + (w.cardio.done ? 'ok' : '') + ' mt10">有氧 ' + w.cardio.min + ' 分钟' +
          (w.cardio.done ? '（已打卡）' : '（未打卡，不计入统计）') + '</div>' : '') +
        (w.note ? '<div class="note mt10">' + U.esc(w.note) + '</div>' : ''),
      actions: [{ label: '关掉' }]
    });
  }

  return {
    id: 'workout', title: '训练', render: render, mount: mount, STATUS: STATUS,
    totalPlannedSets: totalPlannedSets
  };
});
