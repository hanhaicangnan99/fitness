/*!
 * view.stats.js — 「统计」：连续打卡、完成率、体重趋势与校准、容量/热量/有氧图表、PR、轮回小结
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.stats = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, C = JS.Charts, Store = JS.Store;
  var LIFT = '杠铃卧推';

  function render(ctx) {
    var state = ctx.state;
    var today = P.todayStr();
    var h = [];

    if (!Object.keys(state.days).length) {
      h.push(U.card('', U.emptyState('📊', '还没有任何记录', '先去「今日」打第一个卡，这里就会长出图表')));
      h.push(quickLinks(ctx));
      return h.join('');
    }

    /* ---------- 连续打卡 ---------- */
    var dietStreak = S.streak(Store.sortedDates(), function (d) {
      var r = state.days[d]; return !!(r && r.diet && r.diet.kcal != null);
    }, today);
    var bodyStreak = S.streak(Store.sortedDates(), function (d) {
      var r = state.days[d]; return !!(r && r.body && r.body.kg != null);
    }, today);
    var tStreak = S.trainingStreak(state, today);

    h.push(U.card('连续打卡',
      U.statGrid([
        { l: '训练（按训练日算）', v: tStreak.current, u: '次' },
        { l: '饮食', v: dietStreak.current, u: '天' },
        { l: '体重', v: bodyStreak.current, u: '天' },
        { l: '历史最长训练', v: tStreak.best, u: '次' }
      ]) +
      '<div class="small muted mt6">从锚点 ' + P.ANCHOR_D1 + ' 起算，到今天共 ' + tStreak.planned +
      ' 个计划训练日。今天还没打卡不算断档。</div>'));

    /* ---------- 总览 ---------- */
    var all = S.totals(state, today);
    var cw = S.cycleWindow(today);
    var cyc = S.windowStats(state, cw.from, cw.to);
    var pw = S.cycleWindow(P.addDays(cw.from, -1));
    var pk = S.windowStats(state, pw.from, pw.to);

    h.push(U.card('总览（' + all.from + ' → ' + all.to + '）',
      U.statGrid([
        { l: '记录天数', v: Object.keys(state.days).length, u: '天' },
        { l: '训练完成', v: all.done + '/' + all.plannedTrain, u: '' },
        { l: '饮食达标率', v: all.dietRate == null ? '—' : all.dietRate, u: '%' },
        { l: '累计容量', v: (all.volume / 1000).toFixed(1), u: '吨' }
      ]) +
      U.table(['指标', '值'], [
        ['训练完成率', all.trainRate == null ? '—' : all.trainRate + '%（' + all.done + ' / ' + all.plannedTrain + ' 个训练日）'],
        ['其中 力量日 / 轻量日', all.plannedHeavy + ' / ' + all.plannedLight],
        ['跳过', all.skipped + ' 次　未记录 ' + all.missed + ' 次'],
        ['完成组数', all.sets + ' 组'],
        ['有氧累计', U.time2(all.cardioMin) + '（' + U.int(all.cardioKcal) + ' kcal）'],
        ['饮食记录', all.dietDays + ' 天，达标 ' + all.dietHit + ' 天（' + (all.dietRate == null ? '—' : all.dietRate + '%') + '）'],
        ['蛋白达标天数', all.proteinHit + ' / ' + all.dietDays + '（≥ 目标 90%）'],
        ['日均摄入', all.avgKcal == null ? '—' : all.avgKcal + ' kcal（目标 ' + all.avgTarget + '）'],
        ['日均体重', all.avgKg == null ? '—' : all.avgKg + ' kg'],
        ['日均睡眠', all.avgSleep == null ? '—' : all.avgSleep + ' 小时']
      ])));

    /* ---------- 本轮回 ---------- */
    h.push(U.card('本轮回（' + cw.from + ' → ' + cw.to + '）',
      U.table(['项目', '本轮回', '上一轮回'], [
        ['训练完成', cyc.done + ' / ' + cyc.plannedTrain, pk.done + ' / ' + pk.plannedTrain],
        ['总容量', U.int(cyc.volume) + ' kg', U.int(pk.volume) + ' kg'],
        ['完成组数', cyc.sets, pk.sets],
        ['有氧分钟', cyc.cardioMin + ' / 178', pk.cardioMin + ' / 178'],
        ['饮食达标', cyc.dietHit + ' / ' + cyc.dietDays, pk.dietHit + ' / ' + pk.dietDays],
        ['日均摄入', cyc.avgKcal == null ? '—' : cyc.avgKcal + ' kcal', pk.avgKcal == null ? '—' : pk.avgKcal + ' kcal']
      ]) +
      U.note('每轮回的有氧目标是 <b>178 分钟</b>（D3/D5/D6 各 50 + D10 约 28，D8 练腿日不走跑步机），' +
        '高于减脂所需的 150 分钟。', 'info')));

    /* ---------- 体重 ---------- */
    h.push(weightCard(ctx, today));

    /* ---------- 热量 ---------- */
    h.push(calorieCard(ctx, today, cw));

    /* ---------- 训练量 ---------- */
    h.push(volumeCard(ctx));

    /* ---------- 有氧 ---------- */
    h.push(cardioCard(ctx, today));

    /* ---------- PR ---------- */
    h.push(prCard(ctx));

    /* ---------- 轮回小结 ---------- */
    h.push(U.card('每 10 天轮回小结',
      U.table(['轮回', '区间', '训练', '容量 kg', '有氧 min', '饮食达标', '日均 kcal'],
        S.cycleSummaries(state, today).slice(-6).map(function (c) {
          return ['第 ' + c.cycle + ' 轮' + (c.partialCycle ? '（进行中）' : ''), c.from.slice(5) + '→' + c.to.slice(5),
            c.done + '/' + c.plannedTrain, U.int(c.volume), c.cardioMin,
            c.dietHit + '/' + c.dietDays, c.avgKcal == null ? '—' : c.avgKcal];
        }))));

    /* ---------- 阶段 ---------- */
    h.push(phaseCard(ctx, today));

    h.push(quickLinks(ctx));
    return h.join('');
  }

  /* ================= 体重 ================= */
  function weightCard(ctx, today) {
    var state = ctx.state;
    var series = Store.weightSeries();
    var target = state.profile.targetWeight || 84;
    var start = state.profile.startWeight || 93;
    var h = [];

    if (!series.length) {
      h.push(U.card('体重趋势', U.emptyState('⚖️', '还没有体重记录', '去「今日」→ 打卡 → 体重')));
      return h.join('');
    }

    var xs = series.map(function (s) { return P.dayNum(s.date) - P.dayNum(P.ANCHOR_D1); });
    var kgs = series.map(function (s) { return s.kg; });
    var avg = series.map(function (s) { return s.avg7; });
    var last = series[series.length - 1];
    var first = series[0];
    var lo = Math.min.apply(null, kgs.concat([target]));
    var hi = Math.max.apply(null, kgs);
    var ticks = xTicksFrom(series.map(function (s) { return s.date; }));

    h.push(U.card('体重趋势',
      C.line({
        h: 150, xs: xs,
        series: [
          { name: '每日', color: '#9fb4cf', values: kgs, dots: true, width: 1.3 },
          { name: '7 日均重', color: '#1f3a5f', values: avg, dots: false, width: 2.4 }
        ],
        target: { value: target, label: '目标 ' + target + 'kg', color: '#2e9e5b' },
        yMin: Math.floor(lo - 0.6), yMax: Math.ceil(hi + 0.6),
        xTicks: ticks,
        yFmt: function (v) { return v.toFixed(0); }
      }) +
      U.statGrid([
        { l: '最新 7 日均重', v: U.num(last.avg7, 2), u: 'kg' },
        { l: '累计变化', v: U.signed(last.kg - first.kg, 2), u: 'kg' },
        { l: '距目标 ' + target + 'kg', v: U.num(last.avg7 - target, 1), u: 'kg' },
        { l: '已完成', v: Math.max(0, Math.min(100, Math.round((start - last.avg7) / (start - target) * 100))), u: '%' }
      ]) +
      (last.bf != null ? '<div class="small muted mt6">最新体脂 ' + U.num(last.bf, 1) + '%' +
        (last.waist != null ? '　腰围 ' + U.num(last.waist, 1) + ' cm' : '') + '</div>' : '') +
      '<div class="small muted mt6">看 <b>7 日均重</b>，不看单日波动。</div>'));

    h.push(calibrationCard(ctx, today));

    /* 周均重表格 */
    var buckets = S.weekBuckets(state, today).filter(function (b) { return b.avgKg != null; }).slice(-8);
    if (buckets.length) {
      h.push(U.card('周均重对比', U.table(['周次', '区间', '均重 kg', '较上周', '称重天数', '阶段'],
        buckets.map(function (b) {
          return ['第 ' + b.week + ' 周', b.from.slice(5) + '→' + b.to.slice(5), U.num(b.avgKg, 2),
            b.kgDelta == null ? '—' : '<b style="color:' + (b.kgDelta <= -0.4 && b.kgDelta >= -0.8 ? 'var(--ok)' : b.kgDelta > -0.3 ? 'var(--bad)' : 'var(--warn)') + '">' +
              U.signed(b.kgDelta, 2) + '</b>', b.bodyDays + (b.incomplete ? ' ⚠' : ''), U.esc(b.phase)];
        })) +
        '<div class="small muted mt6">带 ⚠ 说明那周称重不足 4 天，均重参考价值低。</div>'));
    }
    return h.join('');
  }

  function calibrationCard(ctx, today) {
    var cal = S.calibration(ctx.state, today);
    var tone = cal.status === 'insufficient' ? 'info' : cal.action === 'hold' ? 'ok' : 'warn';
    var head = cal.status === 'insufficient' ? '' :
      '<div class="stat"><span class="n" style="font-size:22px">' + U.signed(cal.delta, 2) + '</span>' +
      '<span class="u">kg（第 ' + cal.lastWeek + ' 周 vs 第 ' + cal.prevWeek + ' 周）</span></div>';
    return U.card('校准助手', head + U.note(U.esc(cal.text), tone) +
      U.table(['情况', '怎么做'], P.RULES.calibrate.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })));
  }

  /* ================= 热量 ================= */
  function calorieCard(ctx, today, cw) {
    var state = ctx.state;
    var from = cw.from < P.ANCHOR_D1 ? P.ANCHOR_D1 : cw.from;
    var ser = S.calorieSeries(state, from, cw.to);
    var items = ser.map(function (s) {
      return {
        label: s.date.slice(8),
        value: s.actual,
        target: s.target,
        color: s.actual == null ? '#e4e9f0'
          : Math.abs(s.actual - s.target) / s.target <= 0.1 ? '#2e9e5b'
            : s.actual > s.target ? '#d9534f' : '#e09b28'
      };
    });
    return U.card('本轮回每日热量',
      C.bars({ h: 150, items: items, yFmt: function (v) { return (v / 1000).toFixed(1) + 'k'; } }) +
      '<div class="legend"><span><i style="background:#2e9e5b"></i>达标（±10%）</span>' +
      '<span><i style="background:#d9534f"></i>超标</span><span><i style="background:#e09b28"></i>不足</span>' +
      '<span><i style="background:#e4e9f0"></i>没记录</span><span><i style="background:#1f3a5f"></i>当日目标</span></div>' +
      '<div class="small muted mt6">柱高是当日<b>实际</b>摄入，<b>深蓝小横线</b>是那一档的目标' +
      '（训练日 2500 ／ 轻度日 2300 ／ 非训练日 2100，Diet Break 周另有上调）。</div>');
  }

  /* ================= 训练量 ================= */
  function volumeCard(ctx) {
    var state = ctx.state;
    var vs = S.volumeSeries(state).slice(-20);
    var h = [];
    if (vs.length) {
      h.push(U.card('每次训练总容量',
        C.bars({
          h: 150,
          items: vs.map(function (v, i) {
            return {
              label: v.date.slice(5), value: v.volume,
              color: v.sessionKey === 'D10' || v.sessionKey === 'ppl:legs' ? '#2f9e8f' : '#2f6fd0'
            };
          }),
          yFmt: function (v) { return (v / 1000).toFixed(1) + 't'; }
        }) +
        U.table(['日期', '课程', '组数', '容量 kg'],
          vs.slice().reverse().slice(0, 8).map(function (v) { return [v.date, U.esc(v.name), v.sets, U.int(v.volume)]; }))));
    }

    var names = S.exerciseNames(state);
    var pick = names.indexOf(LIFT) >= 0 ? LIFT : names[0];
    if (pick) {
      var ls = S.liftSeries(state, pick);
      if (ls.length >= 2) {
        h.push(U.card(pick + ' 的估算 1RM',
          C.line({
            h: 140, xs: ls.map(function (x) { return P.dayNum(x.date) - P.dayNum(P.ANCHOR_D1); }),
            series: [{ name: '估算 1RM', color: '#9a4bbf', values: ls.map(function (x) { return x.e1rm; }), area: true }],
            xTicks: xTicksFrom(ls.map(function (x) { return x.date; })),
            yFmt: function (v) { return v.toFixed(0); }
          }) +
          '<div class="small muted mt6">Epley 公式 重量 ×(1 + 次数/30)。看趋势，不当真值用。' +
          '主要动作连降 2 周 → 训练日加 200 kcal 碳水，或提前进 Diet Break。</div>'));
      }
      if (names.length > 1) {
        h.push('<div class="card tight"><div class="small muted mb6">换个动作看 1RM 趋势</div>' +
          '<select id="liftpick">' + names.map(function (n) {
            return '<option value="' + U.esc(n) + '"' + (n === pick ? ' selected' : '') + '>' + U.esc(n) + '</option>';
          }).join('') + '</select></div>');
      }
    }
    return h.join('');
  }

  /* ================= 有氧 ================= */
  function cardioCard(ctx, today) {
    var state = ctx.state;
    var sums = S.cycleSummaries(state, today);
    if (!sums.length) return '';
    return U.card('每轮回有氧分钟',
      C.bars({
        h: 140,
        items: sums.slice(-8).map(function (c) {
          return { label: '第' + c.cycle + '轮', value: c.cardioMin, color: c.cardioMin >= 178 ? '#2e9e5b' : '#e09b28' };
        }),
        target: { value: 178, label: '目标 178', color: '#1f3a5f' },
        yFmt: function (v) { return v.toFixed(0); }
      }) +
      U.table(['项目', '量'], P.RULES.cardio.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })));
  }

  /* ================= PR ================= */
  function prCard(ctx) {
    var prs = S.personalRecords(ctx.state);
    if (!prs.length) return '';
    return U.card('个人最好成绩（按估算 1RM）',
      U.table(['动作', '最佳组', '估算 1RM', '日期'],
        prs.slice(0, 12).map(function (p) {
          return [U.esc(p.name), U.num(p.w, 1) + ' kg × ' + p.r, U.num(p.e1rm, 1) + ' kg', p.date];
        })));
  }

  /* ================= 阶段 ================= */
  function phaseCard(ctx, today) {
    var off = P.cycleIndex(today);
    var total = 119;
    var pctv = Math.max(0, Math.min(1, off / total));
    var ph = P.phaseOf(off);
    return U.card('阶段进度',
      '<div class="row" style="gap:14px;align-items:center">' +
      C.ring(pctv, { center: Math.round(pctv * 100) + '%', sub: ph.short, color: '#2f6fd0', size: 92 }) +
      '<div class="grow">' + U.kvRows([
        ['当前', '<b>' + U.esc(ph.name) + '</b>　第 ' + P.weekOf(off) + ' 周'],
        ['已完成', off + ' 天 / 计划 119 天（17 周）'],
        ['下一个节点', nextMilestone(off)]
      ]) + '</div></div>' +
      U.table(['阶段', '内容'], P.RULES.phase.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })) +
      U.table(['项目', '做法'], P.RULES.other.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; })));
  }
  function nextMilestone(off) {
    if (off < 7) return '第 2 周进入 P1 减脂（还有 ' + (7 - off) + ' 天）';
    if (off < 63) return '第 10 周进入 Diet Break（还有 ' + (63 - off) + ' 天）';
    if (off < 70) return 'Diet Break 结束还有 ' + (70 - off) + ' 天';
    if (off < 119) return '第 18 周进入维持期（还有 ' + (119 - off) + ' 天）';
    return '已进入维持期';
  }

  function quickLinks(ctx) {
    return '<div class="card"><div class="card-h"><h2>计划原文</h2></div>' +
      '<div class="btn-row">' +
      '<button class="btn sm" data-act="show-plan">训练计划全文</button>' +
      '<button class="btn sm" data-act="show-diet">饮食计划全文</button>' +
      '</div>' +
      '<div class="btn-row mt10">' +
      '<button class="btn sm" data-act="print">打印 / 存 PDF</button>' +
      '</div>' +
      '<div class="small muted mt6">打印会用 A4 版式，自动隐藏导航栏。</div></div>';
  }

  function xTicksFrom(dates) {
    if (!dates.length) return [];
    var out = [];
    var step = Math.max(1, Math.ceil(dates.length / 6));
    for (var i = 0; i < dates.length; i += step) {
      out.push({ x: P.dayNum(dates[i]) - P.dayNum(P.ANCHOR_D1), label: dates[i].slice(5).replace('-', '/') });
    }
    var last = dates[dates.length - 1];
    if (out.length && out[out.length - 1].x !== P.dayNum(last) - P.dayNum(P.ANCHOR_D1)) {
      out.push({ x: P.dayNum(last) - P.dayNum(P.ANCHOR_D1), label: last.slice(5).replace('-', '/') });
    }
    return out;
  }

  /* ================= 事件 ================= */
  function mount(rootEl, ctx) {
    var pick = U.$('#liftpick', rootEl);
    if (pick) pick.addEventListener('change', function () { LIFT = pick.value; ctx.refresh(); });

    rootEl.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      if (el.dataset.act === 'print') { window.print(); return; }
      if (el.dataset.act === 'show-plan') openPlanSheet('training');
      if (el.dataset.act === 'show-diet') openPlanSheet('diet');
    });
  }

  function openPlanSheet(which) {
    var body;
    if (which === 'training') {
      body = U.table(['训练日', '部位', '动作（每个训练日 5 个）'],
        [['Day 1', '胸肩三头', '杠铃卧推、哑铃上斜卧推、双杠臂屈伸（含退阶）、仰卧屈伸、Y字侧平举'],
         ['Day 2', '背 · 三角肌后束 · 二头', '单手钢线下拉、单手器械划船、对握下拉、开肘下拉、钢线弯举'],
         ['Day 3', '腿（股四头肌 + 腘绳肌）', '单腿硬拉、单腿保加利亚蹲、高脚杯深蹲、杠铃罗马尼亚硬拉、山羊挺身']]) +
        U.note('<b>本计划是适配版，不是谭成义原计划。</b>谭成义原计划是推 / 拉 / 腿三分化（练 3 休 1）。' +
          'D3 = 谭的推日、D5 = 谭的拉日、D8 = 谭的腿日；<b>D6「肩+核心」是从谭的动作池里抽出肩/后束动作 + 补的核心</b>，' +
          '谭原计划里没有独立肩日与核心训练。副作用是谭的背日每 10 天只练到 1 次。', 'warn') +
        '<div class="sect-title" style="margin-left:0">备选：谭成义原版推拉腿轮转</div>' +
        U.note('把三轮转依次填入 D3 → D5 → D6 → D8，<b>下一轮从上次停下的地方接着走</b>。' +
          '第 1 轮：D3 推、D5 拉、D6 腿、D8 推　｜　第 2 轮：D3 拉、D5 腿、D6 推、D8 拉　｜　第 3 轮：D3 腿、D5 推、D6 拉、D8 腿。' +
          '<br>在「我的」里可以切换到这个方案。') +
        U.table(['内容', '出处'], P.RULES.sources.map(function (r) { return [U.esc(r[0]), U.esc(r[1])]; }));
    } else {
      body = U.table(['日型', '适用轮转日', '热量 kcal', '蛋白 g', '碳水 g', '脂肪 g', '当日 TDEE', '缺口 kcal'],
        [['训练日', 'D3 / D5 / D6', 2500, 190, 280, 69, 3240, 740],
         ['训练日 D8', 'D8（练腿日，不走跑步机）', 2500, 190, 280, 69, 2990, 490],
         ['轻度日', 'D10', 2300, 185, 235, 70, 2990, 690],
         ['工作/非训练日', 'D1 / D2 / D4 / D7 / D9', 2100, 185, 180, 72, 2540, 440]]) +
        (function () {
          var k = 0, t = 0;
          for (var d = 1; d <= 10; d++) { k += P.TIERS[P.DAYS[d].tier].kcal; t += P.DAYS[d].tdee; }
          var gap = Math.round((t - k) / 10);
          return U.note('10 天均值：摄入 <b>' + Math.round(k / 10) + ' kcal</b>　TDEE <b>' + Math.round(t / 10) +
            ' kcal</b>　缺口 <b>' + gap + ' kcal/天</b> → 约 <b>−' + (gap * 7 / 7700).toFixed(2) + ' kg/周</b>。' +
            '（这是按三档目标现算的；源文档里写的 2297/543 与 578/−0.53 两处互相打架，以现算为准。）', 'info');
        })() +
        U.kvRows([
          ['去脂体重', '68.8 kg（93 × (1−26%)）'],
          ['基础代谢 BMR', '1951 kcal（Mifflin-St Jeor）'],
          ['基础活动', 'PAL 1.30（班车通勤 + 轮班工作，久坐为主）→ 2536 kcal'],
          ['训练消耗', '力量 60 分钟 ≈ 350 kcal ／ 爬坡走 50 分钟 = 348 kcal（实测）／ D8 练腿日无有氧'],
          ['通勤怎么算', '按「通勤不产生额外热量」算（班车）。夏天骑车那天会多约 340 kcal，不用改摄入']
        ]);
    }
    U.sheet({
      title: which === 'training' ? '训练计划全文' : '饮食计划全文',
      body: body, actions: [{ label: '关掉' }]
    });
  }

  return { id: 'stats', title: '统计', render: render, mount: mount };
});
