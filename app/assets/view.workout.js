/*!
 * view.workout.js — 「训练」：逐组记重量×次数、有氧、上次参考、渐进提示、降级一键套用
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

  /* ------------------------------------------------------------------ */
  function render(ctx) {
    var info = ctx.info, rec = ctx.state.days[ctx.date] || {};

    if (!info.isTrainDay) return renderRestDay(info, rec, ctx);

    var session = P.SESSIONS[info.sessionKey];
    if (!session) return U.emptyState('·', '课程模板缺失', 'sessionKey = ' + info.sessionKey);

    var w = rec.workout;
    var mismatch = w && w.sessionKey && w.sessionKey !== info.sessionKey && w.status !== 'rest';

    var h = [];
    /* ---- 头部 ---- */
    h.push('<div class="card">' +
      '<div class="card-h"><h2>' + U.esc(session.name) + '</h2>' +
      (w && STATUS[w.status] ? '<span class="chip ' + STATUS[w.status].cls + '">' + STATUS[w.status].text + '</span>' : '') +
      '</div>' +
      '<div class="small muted">' + U.esc(session.src) + '　·　' + U.esc(info.trainTime) + '　·　RPE 8（每组留 2 次余力）</div>' +
      '<div class="small muted mt6">离心 3-4 秒 ／ TUT &gt; 40 秒 ／ 复合组间 90-150 秒、孤立 60-90 秒</div>' +
      (info.deload ? U.note('<b>本周是减载周</b>：容量砍 45%（组数减半），重量不变，爬坡走保留。', 'warn') : '') +
      '</div>');

    if (mismatch) {
      h.push(U.note('这条记录是按 <b>' + U.esc((P.SESSIONS[w.sessionKey] || {}).name || w.sessionKey) +
        '</b> 记的，但今天按计划应该是 <b>' + U.esc(session.name) + '</b>（多半是切换了方案或动了指针）。' +
        '<div class="mt10"><button class="btn sm primary" data-act="rebuild">按今天的课程重建记录</button></div>'));
    }

    if (!w || mismatch) {
      if (!w) {
        h.push('<div class="card">' + U.emptyState('🏋', '还没开始今天的打卡', '点下面的按钮生成记录，逐组填重量×次数') +
          '<button class="btn primary wide mt14" data-act="start">开始打卡</button>' +
          '</div>');
        h.push(planPreview(session));
        h.push(degradeCard(ctx));
        h.push(rulesCard());
        h.push(historyCard(ctx));
        return h.join('');
      }
    }

    /* ---- 总览 ---- */
    var vol = S.sessionVolume(w);
    var sets = S.sessionSetCount(w);
    h.push('<div class="card tight"><div class="row between">' +
      '<div><div class="small muted">本次总容量</div>' +
      '<div class="stat"><span class="n" id="total-vol">' + U.int(vol) + '</span><span class="u">kg</span></div></div>' +
      '<div class="right"><div class="small muted">完成组数</div>' +
      '<div class="stat" style="justify-content:flex-end"><span class="n" id="total-sets">' + sets + '</span>' +
      '<span class="u">/ ' + totalPlannedSets(w) + ' 组</span></div></div>' +
      '</div></div>');

    /* ---- 动作 ---- */
    h.push('<div class="sect-title">按顺序做，每组填「重量 × 次数」</div>');
    h.push('<div class="card">' + w.exercises.map(function (ex, i) {
      return exerciseBlock(ex, i, ctx);
    }).join('') + '</div>');

    /* ---- 有氧 ---- */
    h.push(cardioBlock(w, ctx));

    /* ---- 收尾 ---- */
    h.push('<div class="card"><div class="card-h"><h2>本次小结</h2></div>' +
      '<div class="grid2">' +
      '<div class="cell"><span>整体 RPE</span><input type="number" step="0.5" min="1" max="10" inputmode="decimal" data-bind="rpe" value="' +
      (w.rpe == null ? '' : w.rpe) + '" placeholder="8"></div>' +
      '<div class="cell"><span>总用时（分钟）</span><input type="number" step="5" inputmode="numeric" data-bind="duration" value="' +
      (w.durationMin == null ? '' : w.durationMin) + '" placeholder="120"></div>' +
      '</div>' +
      '<div class="mt10"><span class="small muted">备注</span>' +
      '<textarea data-bind="note" placeholder="状态、器械、疼痛、临时调整…">' + U.esc(w.note || '') + '</textarea></div>' +
      '</div>');

    /* ---- 状态 ---- */
    h.push('<div class="card"><div class="card-h"><h2>标记状态</h2>' +
      (w.degraded ? '<span class="chip warn">已降级：' + U.esc(degradeLabel(w.degraded)) + '</span>' : '') +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn ok" data-status="done">✓ 完成</button>' +
      '<button class="btn" data-status="partial">部分完成</button>' +
      '<button class="btn bad" data-status="skipped">跳过</button>' +
      '</div>' +
      '<div class="small muted mt6">跳过不补练，从下一个训练日继续，别打乱轮转。</div>' +
      '</div>');

    h.push(degradeCard(ctx));
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
  function exerciseBlock(ex, i, ctx) {
    var last = S.lastPerformance(ctx.state, ex.name, ctx.date);
    var vol = S.volume(ex);
    var hint = S.progressionHint(ex, last);
    var ph = P.EXERCISE_LIB.find(function (r) { return r[0] === ex.name; });

    var setsHtml = ex.sets.map(function (st, j) {
      return '<div class="setgrid">' +
        '<div class="sn">' + (j + 1) + '</div>' +
        '<input type="number" step="0.5" inputmode="decimal" data-bind="set" data-ex="' + i + '" data-set="' + j + '" data-f="w" value="' +
        (st.w == null ? '' : st.w) + '" placeholder="' + (last && last.sets[j] && last.sets[j].w != null ? last.sets[j].w : 'kg') + '">' +
        '<input type="number" step="1" inputmode="numeric" data-bind="set" data-ex="' + i + '" data-set="' + j + '" data-f="r" value="' +
        (st.r == null ? '' : st.r) + '" placeholder="' + (last && last.sets[j] && last.sets[j].r != null ? last.sets[j].r : '次') + '">' +
        '</div>';
    }).join('');

    return '<div class="exrow" data-exrow="' + i + '">' +
      '<div class="exhead">' +
      '<div class="idx">' + (i + 1) + '</div>' +
      '<div class="nm">' + U.esc(ex.name) +
      '<div class="plan">' + ex.planned.sets + ' 组 × ' + U.esc(ex.planned.reps) + '　·　离心 ' + U.esc(ex.planned.tempo) +
      '　·　组间 ' + ex.planned.rest + 's　·　' + U.esc(ex.planned.target) + '</div></div>' +
      '<div class="vol" data-vol="' + i + '">' + (vol ? U.int(vol) + 'kg' : '') + '</div>' +
      '</div>' +
      '<div class="setgrid" style="margin-top:6px"><div></div><div class="hd">重量 kg</div><div class="hd">次数</div></div>' +
      setsHtml +
      (last ? '<div class="lastref">上次（' + U.esc(last.date) + '）：' +
        last.sets.filter(function (s) { return s.w != null && s.r != null; })
          .map(function (s) { return U.num(s.w, 1) + '×' + s.r; }).join('　') +
        (last.top ? '　·　估算 1RM ' + U.num(last.top, 1) + 'kg' : '') +
        '<button class="btn sm ghost" style="min-height:26px;padding:0 6px" data-act="copy-last" data-ex="' + i + '">沿用</button>' +
        '</div>' : (ex.sets.length ? '<div class="lastref">首次记录这个动作，没有"上次"可参考</div>' : '')) +
      '<div data-hint="' + i + '">' + (hint ? '<div class="' + (hint.kind === 'up' ? 'hintup' : hint.kind === 'down' ? 'hintdn' : 'lastref') + '">' +
        U.esc(hint.text) + '</div>' : '') + '</div>' +
      (ex.planned.note ? '<div class="exnote">要点：' + U.esc(ex.planned.note) + '</div>' : '') +
      (ph ? '<div class="exnote">替代：' + U.esc(ph[3]) + '　·　器械：' + U.esc(ph[2]) + '</div>' : '') +
      '<div class="row mt6"><input type="number" step="0.5" min="1" max="10" inputmode="decimal" data-bind="exrpe" data-ex="' + i +
      '" value="' + (ex.rpe == null ? '' : ex.rpe) + '" placeholder="RPE" style="max-width:88px">' +
      '<input type="text" data-bind="exnote" data-ex="' + i + '" value="' + U.esc(ex.note || '') + '" placeholder="本动作备注" style="flex:1"></div>' +
      '</div>';
  }

  function cardioBlock(w, ctx) {
    var c = w.cardio || {};
    var plan = P.CARDIO[w.sessionKey] || {};
    if (plan.min === 0 && !c.min) {
      return U.card('有氧', U.note(U.esc(plan.note || '今天不做有氧'), 'info'));
    }
    return U.card('有氧　跑步机爬坡走',
      '<div class="grid4">' +
      '<div class="cell"><span>时长 分</span><input type="number" step="5" inputmode="numeric" data-bind="cardio" data-f="min" value="' + (c.min == null ? '' : c.min) + '"></div>' +
      '<div class="cell"><span>坡度</span><input type="number" step="1" inputmode="numeric" data-bind="cardio" data-f="grade" value="' + (c.grade == null ? '' : c.grade) + '"></div>' +
      '<div class="cell"><span>速度</span><input type="number" step="0.1" inputmode="decimal" data-bind="cardio" data-f="speed" value="' + (c.speed == null ? '' : c.speed) + '"></div>' +
      '<div class="cell"><span>心率</span><input type="number" step="1" inputmode="numeric" data-bind="cardio" data-f="hr" value="' + (c.hr == null ? '' : c.hr) + '"></div>' +
      '</div>' +
      '<div class="mt10"><label class="check"><input type="checkbox" data-bind="cardio-done"' + (c.done ? ' checked' : '') + '>' +
      '<span class="t">有氧已完成<span class="s">实测：坡度 12（上限 15）／速度 4.5 km/h／心率约 138／50 分钟约 348 kcal</span></span></label></div>' +
      (plan.note ? U.note(U.esc(plan.note), 'info') : ''));
  }

  function planPreview(session) {
    return U.card('今天要做的动作', U.table(
      ['顺序', '动作', '组数', '次数', '组间'],
      session.exercises.map(function (e, i) { return [i + 1, U.esc(e[0]), e[1], U.esc(e[2]), e[4] + 's']; })
    ));
  }

  function degradeCard(ctx) {
    return U.card('临时降级', '<div class="small muted mb10">顶班 / 加班 / 太累时用，会按规则改今天的记录。</div>' +
      '<div class="btn-row">' +
      '<button class="btn sm" data-act="d45">只有 45 分钟</button>' +
      '<button class="btn sm" data-act="dsleep">睡眠 &lt; 6h 不训练</button>' +
      '</div>' +
      '<div class="mt10"><button class="btn sm ghost" data-act="rules">看完整降级规则 →</button></div>');
  }

  function rulesCard() {
    return U.card('强度与渐进', U.kvRows(P.RULES.intensity.map(function (r) { return [r[0], U.esc(r[1])]; })));
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
      var vol = S.sessionVolume(w);
      return '<li><button class="btn wide" style="justify-content:space-between;font-weight:500" data-hist="' + d + '">' +
        '<span style="text-align:left"><b>' + U.esc(d) + '</b> <span class="muted small">' + U.esc(P.weekday(d)) + '</span>' +
        '<span class="s small muted" style="display:block">' + U.esc(sess ? sess.name : w.sessionKey) + '</span></span>' +
        '<span class="right nw"><span class="chip ' + STATUS[w.status].cls + '">' + STATUS[w.status].text + '</span>' +
        '<span class="small muted" style="display:block">' + S.sessionSetCount(w) + ' 组 · ' + U.int(vol) + 'kg</span></span>' +
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
    h.push(rulesCard());
    h.push(historyCard(ctx));
    return h.join('');
  }

  /* ------------------------------------------------------------------ */
  function mount(rootEl, ctx) {
    var t = null;
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      var b = el.dataset && el.dataset.bind;
      if (!b) return;
      if (t) clearTimeout(t);
      t = setTimeout(function () { applyInput(el, ctx, rootEl); }, 200);
    });

    rootEl.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act],[data-status],[data-hist]');
      if (!el) return;
      var info = ctx.info;
      if (el.dataset.hist) { openHistory(ctx, el.dataset.hist); return; }
      if (el.dataset.status) { setStatus(ctx, el.dataset.status); return; }

      var act = el.dataset.act;
      if (act === 'start') {
        var halve = info.deload;
        Store.setWorkout(ctx.date, Store.emptyWorkout(info.sessionKey, halve));
        if (halve) { var w0 = Store.get().days[ctx.date].workout; w0.degraded = 'deload'; }
        U.toast(halve ? '已按减载周生成（组数减半）' : '开始打卡，逐组填重量×次数');
        ctx.refresh();
      } else if (act === 'rebuild') {
        doRebuild(ctx);
      } else if (act === 'copy-last') {
        copyLast(ctx, +el.dataset.ex);
      } else if (act === 'd45') {
        applyDegrade45(ctx);
      } else if (act === 'dsleep') {
        applyDegradeSleep(ctx);
      } else if (act === 'rules') {
        openRules();
      } else if (act === 'rest') {
        Store.patchDay(ctx.date, { workout: { status: 'rest', sessionKey: 'rest' } });
        U.toast('已打卡：今日休息'); ctx.refresh();
      } else if (act === 'unrest') {
        var r = Store.ensureDay(ctx.date); delete r.workout; Store.save(); Store.emit();
        ctx.refresh();
      }
    });
  }

  function applyInput(el, ctx, rootEl) {
    var b = el.dataset.bind;
    var rec = Store.ensureDay(ctx.date);
    if (!rec.workout) return;
    var w = rec.workout;

    if (b === 'set') {
      var ei = +el.dataset.ex, si = +el.dataset.set, f = el.dataset.f;
      var ex = w.exercises[ei];
      if (!ex || !ex.sets[si]) return;
      var v = U.numVal(el.value);
      if (v != null && v < 0) v = null;
      ex.sets[si][f] = v;
      Store.save();
      updateExerciseUI(rootEl, ctx, ei);
      updateTotals(rootEl, w);
    } else if (b === 'exrpe') {
      var e2 = w.exercises[+el.dataset.ex];
      if (e2) { e2.rpe = U.numVal(el.value); Store.save(); }
    } else if (b === 'exnote') {
      var e3 = w.exercises[+el.dataset.ex];
      if (e3) { e3.note = el.value; Store.save(); }
    } else if (b === 'rpe') {
      w.rpe = U.numVal(el.value); Store.save();
    } else if (b === 'duration') {
      w.durationMin = U.numVal(el.value); Store.save();
    } else if (b === 'note') {
      w.note = el.value; Store.save();
    } else if (b === 'cardio') {
      w.cardio = w.cardio || {};
      w.cardio[el.dataset.f] = U.numVal(el.value);
      Store.save();
    } else if (b === 'cardio-done') {
      w.cardio = w.cardio || {};
      w.cardio.done = !!el.checked;
      Store.save();
    }
  }

  function updateExerciseUI(rootEl, ctx, ei) {
    var w = Store.get().days[ctx.date].workout;
    var ex = w.exercises[ei];
    var volEl = rootEl.querySelector('[data-vol="' + ei + '"]');
    if (volEl) { var v = S.volume(ex); volEl.textContent = v ? U.int(v) + 'kg' : ''; }
    var hintEl = rootEl.querySelector('[data-hint="' + ei + '"]');
    if (hintEl) {
      var hint = S.progressionHint(ex, S.lastPerformance(ctx.state, ex.name, ctx.date));
      hintEl.innerHTML = hint ? '<div class="' + (hint.kind === 'up' ? 'hintup' : hint.kind === 'down' ? 'hintdn' : 'lastref') + '">' +
        U.esc(hint.text) + '</div>' : '';
    }
  }
  function updateTotals(rootEl, w) {
    var v = rootEl.querySelector('#total-vol'), s = rootEl.querySelector('#total-sets');
    if (v) v.textContent = U.int(S.sessionVolume(w));
    if (s) s.textContent = S.sessionSetCount(w);
  }

  function copyLast(ctx, ei) {
    var w = Store.get().days[ctx.date].workout;
    var ex = w.exercises[ei];
    var last = S.lastPerformance(ctx.state, ex.name, ctx.date);
    if (!last) { U.toast('没有可沿用的记录'); return; }
    var n = 0;
    for (var i = 0; i < ex.sets.length; i++) {
      var src = last.sets[i] || last.sets[last.sets.length - 1];
      if (!src || src.w == null) continue;
      ex.sets[i].w = src.w;
      if (src.r != null && ex.sets[i].r == null) ex.sets[i].r = src.r;
      n++;
    }
    Store.save();
    U.toast('已沿用上次 ' + n + ' 组（可再微调）');
    ctx.refresh();
  }

  function setStatus(ctx, status) {
    var w = Store.get().days[ctx.date].workout;
    if (!w) return;
    w.status = status;
    if (status === 'skipped') {
      w.cardio = w.cardio || {}; w.cardio.min = 0; w.cardio.done = false;
    }
    Store.save();
    if (status === 'done' || status === 'partial') {
      var moved = Store.advancePplIfNeeded(ctx.date);
      Store.saveNow();
      U.toast(moved ? '已完成，' + P.PPL_NAMES[P.PPL_ORDER[Store.get().config.pplCursor % 3]] + '日是下一次' : '已标记' + STATUS[status].text);
    } else {
      Store.saveNow();
      U.toast('已标记跳过（不补练）');
    }
    ctx.refresh();
  }

  function applyDegrade45(ctx) {
    var w = Store.get().days[ctx.date].workout;
    if (!w) { U.toast('先点「开始打卡」'); return; }
    U.confirmSheet({
      title: '只有 45 分钟',
      text: '只做力量的前 3 个动作，有氧砍到 20 分钟。后面动作的组会清空。',
      okLabel: '套用'
    }).then(function (yes) {
      if (!yes) return;
      w.exercises = w.exercises.slice(0, 3);
      w.cardio = w.cardio || {};
      w.cardio.min = 20;
      w.degraded = 'time45';
      Store.saveNow();
      U.toast('已套用：前 3 个动作 + 有氧 20 分钟');
      ctx.refresh();
    });
  }

  function applyDegradeSleep(ctx) {
    var w = Store.get().days[ctx.date].workout;
    U.confirmSheet({
      title: '睡眠不足，今天不训练',
      text: '源计划规则：睡眠 < 6 小时当天不训练、不加有氧，优先补觉。今天会标记为「跳过」，不补练。',
      okLabel: '就按这个来',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      var rec = Store.ensureDay(ctx.date);
      if (!rec.workout) rec.workout = Store.emptyWorkout(ctx.info.sessionKey, ctx.info.deload);
      rec.workout.status = 'skipped';
      rec.workout.degraded = 'sleep';
      rec.workout.cardio = rec.workout.cardio || {};
      rec.workout.cardio.min = 0; rec.workout.cardio.done = false;
      Store.saveNow();
      U.toast('已标记：今天不训练，优先补觉');
      ctx.refresh();
    });
  }

  function openRules() {
    U.sheet({
      title: '降级规则（顶班 / 加班 / 太累时）',
      body: U.table(['情况', '怎么做'], P.RULES.degrade.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })) +
        '<div class="sect-title" style="margin-left:0">有氧总盘</div>' +
        U.table(['项目', '量'], P.RULES.cardio.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })) +
        '<div class="sect-title" style="margin-left:0">强度与渐进</div>' +
        U.table(['项目', '做法'], P.RULES.intensity.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })),
      actions: [{ label: '知道了' }]
    });
  }

  function openHistory(ctx, date) {
    var w = ctx.state.days[date].workout;
    if (!w) return;
    var sess = P.SESSIONS[w.sessionKey];
    var rows = w.exercises.map(function (ex) {
      var s = ex.sets.filter(function (x) { return x.w != null && x.r != null; })
        .map(function (x) { return U.num(x.w, 1) + '×' + x.r; }).join('　');
      return [U.esc(ex.name), s || '<span class="muted">—</span>', U.int(S.volume(ex)), ex.rpe == null ? '' : ex.rpe];
    });
    U.sheet({
      title: date + '　' + (sess ? sess.name : w.sessionKey),
      sub: P.weekday(date) + '　' + (STATUS[w.status] ? STATUS[w.status].text : '') +
        '　总容量 ' + U.int(S.sessionVolume(w)) + ' kg　' + S.sessionSetCount(w) + ' 组' +
        (w.durationMin ? '　用时 ' + w.durationMin + ' 分钟' : ''),
      body: U.table(['动作', '各组 重量×次数', '容量 kg', 'RPE'], rows) +
        (w.cardio && w.cardio.min ? '<div class="note info mt10">有氧 ' + w.cardio.min + ' 分钟' +
          (w.cardio.grade ? '　坡度 ' + w.cardio.grade : '') + (w.cardio.speed ? '　速度 ' + w.cardio.speed : '') +
          (w.cardio.hr ? '　心率 ' + w.cardio.hr : '') + (w.cardio.kcal ? '　约 ' + w.cardio.kcal + ' kcal' : '') + '</div>' : '') +
        (w.note ? '<div class="note mt10">' + U.esc(w.note) + '</div>' : ''),
      actions: [
        { label: '关掉' },
        {
          label: '复制到 ' + ctx.date, cls: 'primary', onClick: function () {
            var src = JSON.parse(JSON.stringify(w));
            src.pplAdvanced = true;
            Store.setWorkout(ctx.date, src);
            U.toast('已复制到 ' + ctx.date);
            ctx.refresh();
          }
        }
      ]
    });
  }

  function doRebuild(ctx) {
    U.confirmSheet({
      title: '重建今天的记录',
      text: '会按今天的课程（' + P.SESSIONS[ctx.info.sessionKey].name + '）重建组，已填的重量和次数会丢。',
      okLabel: '重建', danger: true
    }).then(function (yes) {
      if (!yes) return;
      Store.setWorkout(ctx.date, Store.emptyWorkout(ctx.info.sessionKey, ctx.info.deload));
      Store.saveNow();
      U.toast('已重建');
      ctx.refresh();
    });
  }

  return { id: 'workout', title: '训练', render: render, mount: mount, STATUS: STATUS };
});
