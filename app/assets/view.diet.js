/*!
 * view.diet.js — 「饮食」：三档热量、餐次打卡、套用套餐、等价替换换算器、食堂/便利店
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.diet = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, Store = JS.Store;

  var TAB = 'checkin';   // checkin | swap | out

  function emptyDiet(info) {
    var sp = P.SPLIT[info.tierKey];
    return {
      m1: false, m2: false, shake: false,
      kcal: null, p: null, c: null, f: null,
      recipeId: P.recipeFor(info.date, info.day), water: false, fiber: false, note: ''
    };
  }

  function hit(actual, target) {
    if (actual == null || !target) return null;
    return Math.abs(actual - target) / target <= 0.1;
  }

  function render(ctx) {
    var info = ctx.info;
    var rec = ctx.state.days[ctx.date] || {};
    var d = rec.diet || emptyDiet(info);
    var h = [];

    /* ---- 目标 ---- */
    var sp = P.SPLIT[info.tierKey];
    h.push('<div class="card">' +
      '<div class="row between"><div><div class="small muted">今日目标</div>' +
      '<div class="stat"><span class="n">' + info.kcal + '</span><span class="u">kcal</span>' +
      '<span class="d muted small">P' + info.p + ' / C' + info.c + ' / F' + info.f + '</span></div></div>' +
      '<div class="right"><span class="chip ' + (info.tierKey === 'train' ? 'train' : info.tierKey === 'light' ? 'light' : '') + '">' +
      U.esc(info.tierName) + '</span></div></div>' +
      '<div class="small muted mt6">当日 TDEE ≈ ' + info.tdee + ' kcal　·　缺口 ≈ ' + (info.tdee - info.kcal) + ' kcal' +
      '　·　' + U.esc(info.phase.name) + ' 第 ' + info.week + ' 周</div>' +
      (info.kcal !== P.TIERS[info.tierKey].kcal
        ? U.note('Diet Break：' + U.esc(info.tierName) + ' 的热量已上调到 <b>' + info.kcal + ' kcal</b>（训练量不减）。', 'info')
        : '') +
      '</div>');

    h.push('<div class="card tight"><div class="small muted mb10">两餐 + 蛋白补口的切分</div>' +
      U.table(['餐次', 'kcal', 'P', 'C', 'F'], [
        ['正餐1', sp.m1[0], sp.m1[1], sp.m1[2], sp.m1[3]],
        ['正餐2', sp.m2[0], sp.m2[1], sp.m2[2], sp.m2[3]],
        ['蛋白补口', sp.shake[0], sp.shake[1], sp.shake[2], sp.shake[3]],
        Object.assign(['合计', info.kcal, info.p, info.c, info.f], { __cls: 'total' })
      ], { cls: 'tight' }) +
      '</div>');

    /* ---- 页签 ---- */
    h.push('<div class="mt14">' + U.seg('diet-tab', [
      ['checkin', '打卡'], ['swap', '替换'], ['out', '外食 / 夜班']
    ], TAB) + '</div>');

    if (TAB === 'checkin') h.push(checkinTab(ctx, info, d));
    else if (TAB === 'swap') h.push(swapTab(ctx));
    else h.push(outTab());

    return h.join('');
  }

  /* ================= 打卡 ================= */
  function checkinTab(ctx, info, d) {
    var h = [];
    var rows = [
      ['m1', '正餐1', info.m1, d.m1],
      ['m2', '正餐2', info.m2, d.m2],
      ['shake', '蛋白补口', info.shake, d.shake]
    ];
    h.push(U.card('餐次打卡', '<ul class="list">' + rows.map(function (r) {
      return '<li><label class="check"><input type="checkbox" data-bind="slot" data-k="' + r[0] + '"' + (r[3] ? ' checked' : '') + '>' +
        '<span class="t">' + U.esc(r[1]) + '<span class="s">' + U.esc(r[2]) + '</span></span></label></li>';
    }).join('') + '</ul>'));

    var hitOk = hit(d.kcal, info.kcal);
    h.push('<div class="card"><div class="card-h"><h2>实际摄入</h2>' +
      (d.kcal != null ? '<span class="chip ' + (hitOk ? 'ok' : 'warn') + '">' + (hitOk ? '达标' : '偏差>10%') + '</span>' : '') +
      '</div>' +
      '<div class="grid2">' +
      macroCell('kcal', '热量', d.kcal, info.kcal) +
      macroCell('p', '蛋白 g', d.p, info.p) +
      '</div><div class="grid2 mt10">' +
      macroCell('c', '碳水 g', d.c, info.c) +
      macroCell('f', '脂肪 g', d.f, info.f) +
      '</div>' +
      '<div class="small muted mt6">达标线：当日实际热量落在目标 ±10% 以内（' +
      Math.round(info.kcal * 0.9) + ' - ' + Math.round(info.kcal * 1.1) + ' kcal）。</div>' +
      '<div class="btn-row mt10">' +
      '<button class="btn sm primary" data-act="recipe">套用套餐</button>' +
      '<button class="btn sm" data-act="clear">清空</button>' +
      '</div>' +
      '</div>');

    h.push(U.card('其他', '<label class="check"><input type="checkbox" data-bind="flag" data-k="water"' + (d.water ? ' checked' : '') + '>' +
      '<span class="t">饮水 3-3.5 L<span class="s">爬坡走那 50 分钟额外补 500ml</span></span></label>' +
      '<label class="check"><input type="checkbox" data-bind="flag" data-k="fiber"' + (d.fiber ? ' checked' : '') + '>' +
      '<span class="t">纤维 30-40 g<span class="s">蔬菜每天 ≥500g</span></span></label>' +
      '<div class="mt10"><span class="small muted">备注</span>' +
      '<textarea data-bind="note" placeholder="应酬、外食、临时加餐…">' + U.esc(d.note || '') + '</textarea></div>'));

    var rid = d.recipeId || P.recipeFor(info.date, info.day);
    var rec = P.recipeById(rid);
    if (rec) {
      h.push(U.card('今天的推荐套餐：' + rec.id,
        recipeTable(rec) +
        '<div class="small muted mt6">' + U.esc(rec.title) + '　合计 ' + rec.total[0] + ' kcal ／ 蛋白 ' + rec.total[1] +
        'g ／ 碳水 ' + rec.total[2] + 'g ／ 脂肪 ' + rec.total[3] + 'g</div>' +
        '<button class="btn sm primary wide mt10" data-act="apply-recipe" data-rid="' + rec.id + '">按这套填进实际摄入</button>'));
    }

    h.push(U.card('为什么要加蛋白补口',
      U.note('① 单餐要装下 1250 kcal、95g 蛋白，一餐 95g 蛋白的吸收利用率不如分两次；<br>' +
        '② 白班日 12:30 午餐到次日 09:15 早餐隔 21 小时，加一个补口能保住肌肉。', 'info') +
      U.table(['补口固定内容', ''], [['乳清蛋白粉', '30-45g 冲水'], ['无糖希腊酸奶', '200-250g'], ['无糖酸奶+茶叶蛋', '200g + 1 个']])));

    return h.join('');
  }

  function macroCell(f, label, val, target) {
    return '<div class="cell"><span>' + U.esc(label) + '（目标 ' + target + '）</span>' +
      '<input type="number" step="1" inputmode="decimal" data-bind="macro" data-f="' + f + '" value="' +
      (val == null ? '' : val) + '" placeholder="' + target + '"></div>';
  }

  function recipeTable(rec) {
    var rows = [];
    rec.meals.forEach(function (m) {
      m.items.forEach(function (i) {
        rows.push([U.esc(m.name), U.esc(i.n), U.esc(i.g), i.k, i.p, i.c, i.f]);
      });
      var sub = m.items.reduce(function (a, i) { return [a[0] + i.k, a[1] + i.p, a[2] + i.c, a[3] + i.f]; }, [0, 0, 0, 0]);
      rows.push({ __cls: 'sub', 0: '', 1: '小计', 2: '', 3: Math.round(sub[0]), 4: Math.round(sub[1]), 5: Math.round(sub[2]), 6: Math.round(sub[3]) });
    });
    var cells = rows.map(function (r) {
      if (r.__cls) return ['', r[1], '', r[3], r[4], r[5], r[6]];
      return r;
    });
    cells.push(['', '合计', '', rec.total[0], rec.total[1], rec.total[2], rec.total[3]]);
    return U.table(['餐次', '食物', '克重', 'kcal', 'P g', 'C g', 'F g'], cells, { cls: 'tight' });
  }

  /* ================= 替换 ================= */
  function swapTab(ctx) {
    var h = [];
    h.push(U.card('换算器',
      '<div class="small muted mb6">选食物 → 填克重 → 直接出宏量；或反过来按目标宏量算该吃多少克。</div>' +
      '<select data-bind="food" id="foodsel">' +
      P.FOOD_CATS.map(function (c) {
        return '<optgroup label="' + U.esc(c) + '">' + P.FOODS.filter(function (f) { return f[0] === c; })
          .map(function (f) { return '<option value="' + U.esc(f[1]) + '">' + U.esc(f[1]) + '（' + U.esc(f[2]) + '）</option>'; })
          .join('') + '</optgroup>';
      }).join('') + '</select>' +
      '<div class="grid2 mt10">' +
      '<div class="cell"><span>克重 / 毫升</span><input type="number" step="5" inputmode="decimal" id="foodg" value="100"></div>' +
      '<div class="cell"><span>按目标算克重</span>' +
      '<div class="row" style="gap:6px"><select id="navtarget" style="flex:1">' +
      '<option value="c">碳水 40g</option><option value="p">蛋白 25g</option><option value="f">脂肪 10g</option></select>' +
      '<button class="btn sm" id="calcbtn">算</button></div></div>' +
      '</div>' +
      '<div id="calcresult" class="mt10"></div>'));

    h.push(U.card('等价替换表', '<div class="small muted mb10">同组内可等量互换（比如不想吃鸡胸，换 115g 瘦牛肉或 140g 龙利鱼，热量蛋白几乎一致）；跨组不可换。</div>' +
      P.SUBS.map(function (g) {
        return '<div class="sect-title" style="margin:12px 0 4px 0">' + U.esc(g.title) + '</div>' +
          U.table(['食物', '份量', 'kcal', '蛋白 g', '碳水 g', '脂肪 g'],
            g.rows.map(function (r) { return [U.esc(r[0]), U.esc(r[1]), r[2], r[3], r[4], r[5]]; }), { cls: 'tight' });
      }).join('') +
      '<div class="small muted mt10">源表对照：主食组按 40g 碳水配、蛋白组按 25g 蛋白配；脂肪组标题写「≈10g 脂肪」但实际是按 ≈90 kcal 配的（脂肪 5.9-10g），照着吃不用抠太细。</div>'));

    h.push(U.card('食物库', '<div class="small muted mb10">改克重怎么算：目标宏量 ÷ 食物每 100g 数值 × 100 = 你的克重。</div>' +
      P.FOOD_CATS.slice(0, 6).map(function (c) {
        return '<div class="sect-title" style="margin:12px 0 4px 0">' + U.esc(c) + '</div>' +
          U.table(['食物', '参考份量', 'kcal', '蛋白', '碳水', '脂肪', '每100g kcal'],
            P.FOODS.filter(function (f) { return f[0] === c; }).map(function (f) {
              var d = P.foodDetail(f);
              return [U.esc(d.name), U.esc(d.portion), d.kcal, d.p, d.c, d.f, d.k100];
            }), { cls: 'tight' });
      }).join('')));
    return h.join('');
  }

  /* ================= 外食 / 夜班 ================= */
  function outTab() {
    return U.card('食堂选菜规则（D1 / D2 午餐 12:30）',
      U.kvRows(P.RULES.canteen.map(function (r) { return [r[0], U.esc(r[1])]; }))) +
      U.card('食堂组合示例（每套 ≈ 400-500 kcal，P50-60）',
        U.table(['编号', '主食', '蛋白', '蔬菜', '估算 kcal'],
          P.RULES.canteenSets.map(function (r) { return [U.esc(r[0]), U.esc(r[1]), U.esc(r[2]), U.esc(r[3]), r[4]]; })) +
        U.note('食堂这一餐只有 400-500 kcal，离正餐2 的目标（950-1250）有差距，回办公室后用蛋白补口 + 下午加主食补足。', 'info')) +
      U.card('夜班便利店 / 外卖清单（D4 / D7 07:00 岗上餐）',
        U.kvRows(P.RULES.store.map(function (r) { return [r[0], U.esc(r[1])]; }))) +
      U.card('夜班专项（D4 / D7）', U.kvRows(P.RULES.night.map(function (r) { return [r[0], U.esc(r[1])]; }))) +
      U.card('中班专项（D8 / D9）', U.kvRows(P.RULES.midshift.map(function (r) { return [r[0], U.esc(r[1])]; })));
  }

  /* ================= 事件 ================= */
  function mount(rootEl, ctx) {
    U.bindSeg(rootEl, 'diet-tab', function (v) { TAB = v; ctx.refresh(true); });

    var t = null;
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'foodg' || el.tagName === 'SELECT') return;
      if (!el.dataset || !el.dataset.bind) return;
      if (el.dataset.bind === 'note') {
        if (t) clearTimeout(t);
        t = setTimeout(function () { var d = ensure(ctx); d.note = el.value; Store.save(); }, 240);
        return;
      }
      if (el.dataset.bind !== 'macro' && el.dataset.bind !== 'slot' && el.dataset.bind !== 'flag') return;
      applyField(ctx, el);
    });
    rootEl.addEventListener('change', function (e) {
      var el = e.target;
      if (el.dataset && el.dataset.bind === 'slot') applyField(ctx, el);
      if (el.dataset && el.dataset.bind === 'flag') applyField(ctx, el);
    });

    rootEl.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (el) {
        var act = el.dataset.act;
        if (act === 'recipe') { openRecipePicker(ctx); return; }
        if (act === 'clear') {
          U.confirmSheet({ title: '清空今天的饮食记录？', text: '只清 ' + ctx.date + '，别的日期不动。', okLabel: '清空', danger: true })
            .then(function (yes) {
              if (!yes) return;
              var r = Store.ensureDay(ctx.date); delete r.diet; Store.save(); Store.emit();
              U.toast('已清空'); ctx.refresh();
            });
          return;
        }
        if (act === 'apply-recipe') { applyRecipe(ctx, el.dataset.rid); return; }
      }
      if (e.target.closest('#calcbtn')) { runCalc(rootEl); }
    });

    var sel = U.$('#foodsel', rootEl);
    if (sel) {
      sel.addEventListener('change', function () { runCalc(rootEl); });
      var g = U.$('#foodg', rootEl);
      if (g) g.addEventListener('input', function () { runCalc(rootEl); });
      runCalc(rootEl);
    }
  }

  function ensure(ctx) {
    var rec = Store.ensureDay(ctx.date);
    if (!rec.diet) rec.diet = emptyDiet(ctx.info);
    return rec.diet;
  }

  function applyField(ctx, el) {
    var d = ensure(ctx);
    var b = el.dataset.bind;
    if (b === 'slot') d[el.dataset.k] = !!el.checked;
    else if (b === 'flag') d[el.dataset.k] = !!el.checked;
    else if (b === 'macro') d[el.dataset.f] = U.numVal(el.value);
    Store.save();
    if (b === 'slot' || b === 'flag') { Store.saveNow(); ctx.refresh(); }
    else updateBadge(ctx, el);
  }

  function updateBadge(ctx, el) {
    var card = el.closest('.card');
    if (!card) return;
    var d = Store.get().days[ctx.date].diet;
    var chip = U.$('.card-h .chip', card);
    var ok = hit(d.kcal, ctx.info.kcal);
    if (chip) {
      chip.className = 'chip ' + (d.kcal == null ? '' : ok ? 'ok' : 'warn');
      chip.textContent = d.kcal == null ? '' : (ok ? '达标' : '偏差>10%');
      if (d.kcal == null) chip.remove();
    } else if (d.kcal != null) {
      var h = U.$('.card-h', card);
      if (h) {
        var s = document.createElement('span');
        s.className = 'chip ' + (ok ? 'ok' : 'warn');
        s.textContent = ok ? '达标' : '偏差>10%';
        h.appendChild(s);
      }
    }
  }

  function applyRecipe(ctx, rid) {
    var rec = P.recipeById(rid);
    if (!rec) return;
    var d = ensure(ctx);
    d.kcal = rec.total[0]; d.p = rec.total[1]; d.c = rec.total[2]; d.f = rec.total[3];
    d.m1 = true; d.m2 = true; d.shake = true;
    d.recipeId = rid;
    Store.saveNow();
    U.toast('已套用 ' + rid + '：' + rec.total[0] + ' kcal');
    ctx.refresh();
  }

  function openRecipePicker(ctx) {
    var info = ctx.info;
    var ids = P.RECIPE_IDS[info.tierKey] || [];
    var recs = ids.map(function (x) { return P.recipeById(x); }).filter(Boolean);
    var body = '<div class="small muted mb10">今日日型：' + U.esc(info.tierName) +
      '。推荐 <b>' + P.recipeFor(info.date, info.day) + '</b>。' +
      '训练日轮换 T1→T2→T3（D3=T1、D5=T2、D6=T3、D8=T1）；非训练日 O1→O2→O3 循环；D10 固定 L1。</div>' +
      recs.map(function (r) {
        return '<div class="card tight"><div class="row between mb6">' +
          '<div class="grow"><b>' + U.esc(r.id) + '</b>　' + U.esc(r.title) +
          '<div class="small muted">' + r.total[0] + ' kcal ／ P' + r.total[1] + ' ／ C' + r.total[2] + ' ／ F' + r.total[3] + '</div></div>' +
          '<button class="btn sm primary" data-rid="' + r.id + '">用这套</button></div>' +
          r.meals.map(function (m) {
            return '<div class="small"><span class="muted">' + U.esc(m.name) + '：</span>' +
              m.items.map(function (i) { return U.esc(i.n) + ' ' + U.esc(i.g); }).join('、') + '</div>';
          }).join('') +
          '</div>';
      }).join('');
    U.sheet({
      title: '套用套餐', sub: ctx.date, body: body,
      actions: [{ label: '取消' }],
      onMount: function (rootEl, close) {
        rootEl.addEventListener('click', function (e) {
          var b = e.target.closest('[data-rid]');
          if (!b) return;
          close();
          applyRecipe(ctx, b.dataset.rid);
        });
      }
    });
  }

  /* ---- 换算器 ---- */
  function runCalc(rootEl) {
    var sel = U.$('#foodsel', rootEl), gEl = U.$('#foodg', rootEl), out = U.$('#calcresult', rootEl);
    if (!sel || !out) return;
    var f = P.FOODS.find(function (x) { return x[1] === sel.value; });
    if (!f) { out.innerHTML = ''; return; }
    var d = P.foodDetail(f);
    var g = U.numVal(gEl && gEl.value);
    if (g == null || g <= 0) g = d.portionG;
    var r = 100 / d.portionG;
    var kk = Math.round(d.kcal * g * r / 100);
    var pp = Math.round(d.p * g * r / 100 * 10) / 10;
    var cc = Math.round(d.c * g * r / 100 * 10) / 10;
    var ff = Math.round(d.f * g * r / 100 * 10) / 10;

    var nav = U.$('#navtarget', rootEl);
    var mode = nav ? nav.value : 'c';
    var targetVal = mode === 'c' ? 40 : mode === 'p' ? 25 : 10;
    var per100 = mode === 'c' ? d.c100 : mode === 'p' ? d.p100 : d.f100;
    var needG = per100 > 0 ? Math.round(targetVal / per100 * 100) : null;

    out.innerHTML = U.table(['项目', '本次', '每 100g'],
      [['热量 kcal', kk, d.k100], ['蛋白 g', pp, d.p100], ['碳水 g', cc, d.c100], ['脂肪 g', ff, d.f100]]) +
      (needG != null
        ? '<div class="note info mt10">要吃够 <b>' + targetVal + 'g ' + ({ c: '碳水', p: '蛋白', f: '脂肪' }[mode]) +
          '</b>，需要 <b>' + d.name + ' ' + needG + 'g</b>。' +
          '<div class="mt10"><button class="btn sm" id="useg">用这个克重</button></div></div>'
        : '<div class="note mt10">这个食物不含' + ({ c: '碳水', p: '蛋白', f: '脂肪' }[mode]) + '，算不出克重。</div>') +
      '<div class="small muted mt6">同类互换：' +
      (P.SUBS.find(function (s) { return s.unit === mode; }) || { rows: [] }).rows.slice(0, 5)
        .map(function (x) { return U.esc(x[0]) + ' ' + U.esc(x[1]); }).join('　·　') + '</div>';

    var ub = U.$('#useg', out);
    if (ub) ub.addEventListener('click', function () {
      var gg = U.$('#foodg', rootEl);
      gg.value = needG;
      runCalc(rootEl);
    });
  }

  return { id: 'diet', title: '饮食', render: render, mount: mount, emptyDiet: emptyDiet, hit: hit };
});
