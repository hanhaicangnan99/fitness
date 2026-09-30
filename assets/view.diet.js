/*!
 * view.diet.js — 「饮食」
 *
 * 打卡 tab 现在是真正的食物记录：每餐自己加「吃了什么 + 多少克」，
 * 自动算这一餐的 热量 / 蛋白 / 碳水 / 脂肪，跟该餐目标比，告诉你什么超了什么缺了。
 * 推荐套餐照旧保留 —— 一键把整套食谱灌进清单，之后可以改克重、加菜、删菜。
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.diet = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, Store = JS.Store;

  var TAB = 'checkin';   // checkin | swap | out

  var MACRO_ORDER = ['k', 'p', 'c', 'f'];
  var TOL = P.MACRO_TOL;

  function r0(v) { return Math.round(v); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function fmt(v, dec) { return dec ? U.num(v, dec) : U.int(v); }

  /* 对比与建议都放在数据层（data.plan.js），这样能被 Node 测试直接覆盖 */
  var compare = P.compareMacros;
  var advice = P.macroAdvice;

  /* ---------------- 记录读写 ---------------- */
  function emptyDiet(info) {
    return {
      m1: false, m2: false, shake: false,
      items: { m1: [], m2: [], shake: [] },
      kcal: null, p: null, c: null, f: null,
      recipeId: P.recipeFor(info.date, info.day), water: false, fiber: false, note: ''
    };
  }
  function itemsOf(d, key) { return (d.items && d.items[key]) || []; }
  function allItems(d) {
    var out = [];
    P.MEALS.forEach(function (m) { out = out.concat(itemsOf(d, m.key)); });
    return out;
  }
  /** 有食物清单就以清单为准写回总数；没清单就保留手工填的值 */
  function recompute(d) {
    var all = allItems(d);
    if (!all.length) return;
    var t = P.sumItems(all);
    d.kcal = r0(t.k); d.p = r1(t.p); d.c = r1(t.c); d.f = r1(t.f);
  }

  /** 实际 vs 目标：交给数据层，这里只是个转发 */
  function compareLocal(actual, target) { return P.compareMacros(actual, target); }

  function toneChip(tone) { return tone === 'ok' ? 'ok' : tone === 'over' ? 'warn' : 'bad'; }

  function adviceHtml(rows) {
    return P.macroAdvice(rows).map(function (a) {
      return U.note(U.esc(a.text), a.tone === 'ok' ? 'ok' : a.tone === 'over' ? 'warn' : 'info');
    }).join('');
  }

  /* ================================================================== */
  function render(ctx) {
    var info = ctx.info;
    var rec = ctx.state.days[ctx.date] || {};
    var d = rec.diet ? rec.diet : emptyDiet(info);
    var h = [];

    /* ---- 目标 ---- */
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

    /* ---- 三档目标速查 ---- */
    h.push('<div class="card tight"><div class="small muted mb10">每餐的目标（按日型切分）</div>' +
      U.table(['餐次', 'kcal', 'P', 'C', 'F'],
        P.MEALS.map(function (m) {
          var t = P.SPLIT[info.tierKey][m.key];
          return [m.label, t[0], t[1], t[2], t[3]];
        }).concat([Object.assign(['合计', info.kcal, info.p, info.c, info.f], { __cls: 'total' })]),
        { cls: 'tight' }) +
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
    var sp = P.SPLIT[info.tierKey];

    h.push('<div class="card tight"><div class="row between">' +
      '<div class="grow small muted">每餐自己记「吃了什么 + 多少克」，下面自动算并对比目标</div>' +
      '<button class="btn sm primary" data-act="recipe">套用套餐</button>' +
      '</div></div>');

    P.MEALS.forEach(function (m) {
      h.push(mealCard(ctx, info, d, m, sp[m.key]));
    });

    h.push(totalCard(ctx, info, d));
    h.push(otherCard(ctx, d));

    var rid = d.recipeId || P.recipeFor(info.date, info.day);
    var rec = P.recipeById(rid);
    if (rec) {
      h.push(U.card('今天的推荐套餐：' + rec.id,
        recipeTable(rec) +
        '<div class="small muted mt6">' + U.esc(rec.title) + '　合计 ' + rec.total[0] + ' kcal ／ 蛋白 ' + rec.total[1] +
        'g ／ 碳水 ' + rec.total[2] + 'g ／ 脂肪 ' + rec.total[3] + 'g</div>' +
        '<button class="btn sm primary wide mt10" data-act="apply-recipe" data-rid="' + rec.id + '">' +
        '把这一套灌进食物清单（之后可以改克重）</button>'));
    }

    return h.join('');
  }

  /* ---- 单餐卡 ---- */
  function mealCard(ctx, info, d, meal, target) {
    var list = itemsOf(d, meal.key);
    var sum = P.sumItems(list);
    var has = list.length > 0;
    var timeText = { m1: info.m1, m2: info.m2, shake: info.shake }[meal.key] || '';
    var ticked = !!d[meal.key];

    var h = [];
    h.push('<div class="card">');
    h.push('<div class="card-h">' +
      '<button class="extick sm' + (ticked ? ' on' : '') + '" data-tick-meal="' + meal.key + '" aria-label="' + meal.label + '已吃">✓</button>' +
      '<div class="grow"><h2 style="font-size:15px">' + meal.label + '</h2>' +
      '<div class="small muted">' + U.esc(timeText) + '　·　目标 ' + target[0] + ' kcal ｜ P' + target[1] +
      ' C' + target[2] + ' F' + target[3] + '</div></div>' +
      '</div>');

    /* 食物清单 */
    if (has) {
      h.push('<div class="foodlist">' + list.map(function (it, i) {
        var m = P.itemMacros(it);
        return '<div class="foodrow">' +
          '<div class="fw"><span class="fn">' + U.esc(it.n) + '</span>' +
          '<button class="fx" data-del-food="' + i + '" data-meal="' + meal.key + '" aria-label="删除">✕</button></div>' +
          '<div class="fw mt6">' +
          '<input type="number" class="fg" step="5" min="0" inputmode="decimal" data-food-g="' + i + '" data-meal="' + meal.key +
          '" value="' + r0(it.g) + '"><span class="small muted">g</span>' +
          '<span class="fm">' + r0(m.k) + ' kcal ｜ P' + r1(m.p) + ' C' + r1(m.c) + ' F' + r1(m.f) + '</span>' +
          '</div></div>';
      }).join('') + '</div>');
    } else {
      h.push('<div class="small muted" style="padding:6px 0">还没记。点下面加食物，或用上面的「套用套餐」一键灌进来。</div>');
    }

    h.push('<div class="btn-row mt10">' +
      '<button class="btn sm primary" data-add-food="' + meal.key + '">＋ 添加食物</button>' +
      '<button class="btn sm" data-custom-food="' + meal.key + '">自定义</button>' +
      (has ? '<button class="btn sm" data-clear-meal="' + meal.key + '">清空</button>' : '') +
      '</div>');

    /* 小计 + 对比 */
    if (has) {
      var rows = compare({ k: sum.k, p: sum.p, c: sum.c, f: sum.f }, target);
      h.push('<div class="mt10"><div class="small muted mb6">这一餐</div>' +
        '<div class="meal-diff">' + diffTableHtml(rows) + '</div>' +
        '<div class="meal-advice">' + adviceHtml(rows) + '</div>' +
        '</div>');
    }

    h.push('</div>');
    return h.join('');
  }

  function adviceHtml(rows) {
    return advice(rows).map(function (a) {
      return U.note(U.esc(a.text), a.tone === 'ok' ? 'ok' : a.tone === 'over' ? 'warn' : 'info');
    }).join('');
  }

  /* ---- 全天合计 ---- */
  function totalCard(ctx, info, d) {
    var all = allItems(d);
    var has = all.length > 0;
    var actual = has
      ? (function () { var t = P.sumItems(all); return { k: t.k, p: t.p, c: t.c, f: t.f }; })()
      : { k: d.kcal == null ? 0 : d.kcal, p: d.p == null ? 0 : d.p, c: d.c == null ? 0 : d.c, f: d.f == null ? 0 : d.f };
    var target = [info.kcal, info.p, info.c, info.f];
    var rows = compare(actual, target);
    var hit = rows[0].tone === 'ok';

    var h = ['<div class="card"><div class="card-h"><h2>全天合计</h2>' +
      (has ? '<span class="chip ' + (hit ? 'ok' : 'warn') + '">' + (hit ? '达标' : '偏差>10%') + '</span>' : '') +
      '</div>'];

    if (has) {
      h.push('<div class="small muted mb6">按 ' + all.length + ' 条食物记录自动算</div>');
      h.push('<div class="total-diff">' + diffTableHtml(rows) + '</div>');
      h.push('<div class="total-advice">' + adviceHtml(rows) + '</div>');
      h.push('<div class="btn-row mt10">' +
        '<button class="btn sm" data-act="manual">改成手动填</button></div>' +
        '<div class="small muted mt6">达标线：当日热量落在目标 ±10%（' +
        r0(info.kcal * 0.9) + ' - ' + r0(info.kcal * 1.1) + ' kcal）。</div>');
    } else {
      h.push('<div class="small muted mb6">没记食物的时候，可以直接填总数</div>');
      h.push('<div class="grid2">' +
        macroCell('kcal', '热量', d.kcal, info.kcal) +
        macroCell('p', '蛋白 g', d.p, info.p) +
        '</div><div class="grid2 mt10">' +
        macroCell('c', '碳水 g', d.c, info.c) +
        macroCell('f', '脂肪 g', d.f, info.f) +
        '</div>');
      h.push('<div class="small muted mt6">加了食物记录之后，这几个数会自动算，不用手填。</div>');
    }

    h.push('</div>');
    return h.join('');
  }

  function macroCell(f, label, val, target) {
    return '<div class="cell"><span>' + U.esc(label) + '（目标 ' + target + '）</span>' +
      '<input type="number" step="1" inputmode="decimal" data-bind="macro" data-f="' + f + '" value="' +
      (val == null ? '' : val) + '" placeholder="' + target + '"></div>';
  }

  function otherCard(ctx, d) {
    return U.card('其他', '<label class="check"><input type="checkbox" data-bind="flag" data-k="water"' + (d.water ? ' checked' : '') + '>' +
      '<span class="t">饮水 3-3.5 L<span class="s">爬坡走那 50 分钟额外补 500ml</span></span></label>' +
      '<label class="check"><input type="checkbox" data-bind="flag" data-k="fiber"' + (d.fiber ? ' checked' : '') + '>' +
      '<span class="t">纤维 30-40 g<span class="s">蔬菜每天 ≥500g</span></span></label>' +
      '<div class="mt10"><span class="small muted">备注</span>' +
      '<textarea data-bind="note" placeholder="应酬、外食、临时加餐…">' + U.esc(d.note || '') + '</textarea></div>');
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
        U.note('食堂这一餐只有 400-500 kcal，离正餐2 的目标（950-1250）有差距，回来再加一份蛋白补口和主食补足。' +
          '可以直接在打卡里用「自定义」把这一餐估个总数记上。', 'info')) +
      U.card('夜班便利店 / 外卖清单（D4 / D7 07:00 岗上餐）',
        U.kvRows(P.RULES.store.map(function (r) { return [r[0], U.esc(r[1])]; }))) +
      U.card('夜班专项（D4 / D7）', U.kvRows(P.RULES.night.map(function (r) { return [r[0], U.esc(r[1])]; }))) +
      U.card('中班专项（D8 / D9）', U.kvRows(P.RULES.midshift.map(function (r) { return [r[0], U.esc(r[1])]; })));
  }

  /* ==================================================================
   * 事件
   * ================================================================== */
  function ensure(ctx) {
    var rec = Store.ensureDay(ctx.date);
    if (!rec.diet) { rec.diet = emptyDiet(ctx.info); }
    else Store.normalizeDiet(rec.diet);
    return rec.diet;
  }
  function commit(ctx, d) {
    recompute(d);
    Store.saveNow();
    ctx.refresh(true);
  }

  function mount(rootEl, ctx) {
    U.bindSeg(rootEl, 'diet-tab', function (v) { TAB = v; ctx.refresh(true); });

    var t = null;
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      // 食物克重：只更新那一行的数字，不整页重绘（否则输入框会失去焦点）
      if (el.dataset && el.dataset.foodG != null && el.dataset.foodG !== '') {
        if (t) clearTimeout(t);
        t = setTimeout(function () { setFoodGrams(ctx, el.dataset.meal, +el.dataset.foodG, el.value, el); }, 400);
        return;
      }
      if (el.id === 'foodg' || el.tagName === 'SELECT') return;
      if (!el.dataset || !el.dataset.bind) return;
      if (el.dataset.bind === 'note') {
        if (t) clearTimeout(t);
        t = setTimeout(function () { var d = ensure(ctx); d.note = el.value; Store.saveNow(); }, 240);
        return;
      }
      if (el.dataset.bind !== 'macro' && el.dataset.bind !== 'slot' && el.dataset.bind !== 'flag') return;
      applyField(ctx, el);
    });
    rootEl.addEventListener('change', function (e) {
      var el = e.target;
      if (el.dataset && el.dataset.bind === 'slot') applyField(ctx, el);
      if (el.dataset && el.dataset.bind === 'flag') applyField(ctx, el);
      if (el.dataset && el.dataset.foodG != null && el.dataset.foodG !== '') {
        setFoodGrams(ctx, el.dataset.meal, +el.dataset.foodG, el.value, el);
      }
    });

    rootEl.addEventListener('click', function (e) {
      var tick = e.target.closest('[data-tick-meal]');
      if (tick) { var d0 = ensure(ctx); d0[tick.dataset.tickMeal] = !d0[tick.dataset.tickMeal]; Store.saveNow(); ctx.refresh(true); return; }

      var del = e.target.closest('[data-del-food]');
      if (del) {
        var d1 = ensure(ctx);
        d1.items[del.dataset.meal].splice(+del.dataset.delFood, 1);
        commit(ctx, d1);
        U.toast('已删除'); return;
      }
      var clr = e.target.closest('[data-clear-meal]');
      if (clr) {
        var d2 = ensure(ctx);
        d2.items[clr.dataset.clearMeal] = [];
        commit(ctx, d2);
        U.toast('已清空这一餐'); return;
      }
      var add = e.target.closest('[data-add-food]');
      if (add) { openFoodPicker(ctx, add.dataset.addFood); return; }
      var cus = e.target.closest('[data-custom-food]');
      if (cus) { openCustomFood(ctx, cus.dataset.customFood); return; }

      var el = e.target.closest('[data-act]');
      if (el) {
        var act = el.dataset.act;
        if (act === 'recipe') { openRecipePicker(ctx); return; }
        if (act === 'apply-recipe') { applyRecipe(ctx, el.dataset.rid); return; }
        if (act === 'manual') {
          var d3 = ensure(ctx);
          d3.items = { m1: [], m2: [], shake: [] };
          Store.saveNow(); ctx.refresh(true);
          U.toast('已清空食物清单，现在可以手填总数'); return;
        }
        if (act === 'clear') {
          U.confirmSheet({ title: '清空今天的饮食记录？', text: '只清 ' + ctx.date + '，别的日期不动。', okLabel: '清空', danger: true })
            .then(function (yes) {
              if (!yes) return;
              var r = Store.ensureDay(ctx.date); delete r.diet; Store.saveNow(); Store.emit();
              U.toast('已清空'); ctx.refresh();
            });
          return;
        }
      }
      if (e.target.closest('#calcbtn')) runCalc(rootEl);
    });

    var sel = U.$('#foodsel', rootEl);
    if (sel) {
      sel.addEventListener('change', function () { runCalc(rootEl); });
      var g = U.$('#foodg', rootEl);
      if (g) g.addEventListener('input', function () { runCalc(rootEl); });
      runCalc(rootEl);
    }
  }

  function applyField(ctx, el) {
    var d = ensure(ctx);
    var b = el.dataset.bind;
    if (b === 'macro') d[el.dataset.f] = U.numVal(el.value);
    else if (b === 'flag') d[el.dataset.k] = !!el.checked;
    else if (b === 'slot') d[el.dataset.k] = !!el.checked;
    Store.save();
    if (b === 'flag') { Store.saveNow(); ctx.refresh(true); }
  }

  /** 改某条食物的克重：就地更新那一行的数字，不整页重绘（保住输入焦点） */
  function setFoodGrams(ctx, mealKey, idx, raw, inputEl) {
    var d = ensure(ctx);
    var it = d.items[mealKey][idx];
    if (!it) return;
    var g = U.numVal(raw);
    if (g == null || g <= 0) return;
    it.g = g;
    recompute(d);
    Store.saveNow();
    var row = inputEl.closest('.foodrow');
    if (row) {
      var m = P.itemMacros(it);
      var fm = row.querySelector('.fm');
      if (fm) fm.textContent = r0(m.k) + ' kcal ｜ P' + r1(m.p) + ' C' + r1(m.c) + ' F' + r1(m.f);
    }
    updateMealSummary(ctx, mealKey);
  }

  function updateMealSummary(ctx, mealKey) {
    var card = document.querySelector('[data-tick-meal="' + mealKey + '"]');
    card = card ? card.closest('.card') : null;
    if (!card) return;
    var d = Store.get().days[ctx.date].diet;
    var sp = P.SPLIT[ctx.info.tierKey][mealKey];
    var sum = P.sumItems(itemsOf(d, mealKey));
    var rows = compare({ k: sum.k, p: sum.p, c: sum.c, f: sum.f }, sp);
    var tbl = card.querySelector('.meal-diff');
    if (tbl) tbl.innerHTML = diffTableHtml(rows);
    var notes = card.querySelector('.meal-advice');
    if (notes) notes.innerHTML = adviceHtml(rows);
    // 全天合计也跟着动
    var tot = document.querySelector('.total-diff');
    if (tot) {
      var all = allItems(d);
      var t = P.sumItems(all);
      var tr = compare({ k: t.k, p: t.p, c: t.c, f: t.f }, [ctx.info.kcal, ctx.info.p, ctx.info.c, ctx.info.f]);
      tot.innerHTML = diffTableHtml(tr);
      var tadv = document.querySelector('.total-advice');
      if (tadv) tadv.innerHTML = adviceHtml(tr);
    }
  }

  function diffTableHtml(rows) {
    return U.table(['', '吃了', '目标', '差'],
      rows.map(function (r) {
        var sign = r.diff > 0 ? '+' : (r.diff < 0 ? '−' : '');
        return [r.label,
          '<b>' + fmt(r.actual, r.dec) + '</b>',
          fmt(r.target, r.dec),
          '<span class="chip ' + toneChip(r.tone) + '">' + sign + fmt(Math.abs(r.diff), r.dec) + r.unit + '</span>'];
      }), { cls: 'tight' });
  }

  /* ---- 添加食物 ---- */
  function recentFoods() {
    var cnt = {}, days = Store.get().days;
    Object.keys(days).forEach(function (dt) {
      var d = days[dt].diet;
      if (!d || !d.items) return;
      P.MEALS.forEach(function (m) {
        (d.items[m.key] || []).forEach(function (it) { cnt[it.n] = (cnt[it.n] || 0) + 1; });
      });
    });
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 10);
  }

  function addFood(ctx, mealKey, name) {
    var d = ensure(ctx);
    var it = P.itemFrom(name);
    if (!it) { U.toast('食物库里没有这个'); return; }
    d.items[mealKey].push(it);
    d[mealKey] = true;
    commit(ctx, d);
    U.toast('已加 ' + name + ' ' + r0(it.g) + 'g（点克重可以改）');
  }

  function openFoodPicker(ctx, mealKey) {
    var meal = P.MEALS.find(function (m) { return m.key === mealKey; });
    var recents = recentFoods();

    function listHtml(q) {
      q = String(q || '').trim();
      var h = '';
      if (!q && recents.length) {
        h += '<div class="sect-title" style="margin:10px 0 4px 0">常吃</div><div class="btn-row">' +
          recents.map(function (n) {
            return '<button class="btn sm" style="flex:1 1 46%" data-food="' + U.esc(n) + '">' + U.esc(n) + '</button>';
          }).join('') + '</div>';
      }
      var hit = 0;
      P.FOOD_CATS.forEach(function (c) {
        var fs = P.FOODS.filter(function (f) {
          return f[0] === c && (!q || f[1].indexOf(q) >= 0);
        });
        if (!fs.length) return;
        hit += fs.length;
        h += '<div class="sect-title" style="margin:12px 0 4px 0">' + U.esc(c) + '</div><div class="btn-row">' +
          fs.map(function (f) {
            return '<button class="btn sm" style="flex:1 1 46%;flex-direction:column;align-items:flex-start;padding:6px 9px;min-height:auto" ' +
              'data-food="' + U.esc(f[1]) + '"><span>' + U.esc(f[1]) + '</span>' +
              '<span class="small muted" style="font-weight:400">' + U.esc(f[2]) +
              (f[4] ? '　' + f[4] + ' kcal' : '') + '</span></button>';
          }).join('') + '</div>';
      });
      if (!hit) h += '<div class="empty">没找到「' + U.esc(q) + '」<div class="small mt6">用下面的「自定义」手输一条</div></div>';
      return h;
    }

    U.sheet({
      title: '添加食物 · ' + meal.label,
      sub: '点一下就加进这一餐，默认按参考份量，加完可以改克重',
      body: '<input type="text" id="fs" placeholder="搜索食物名…" autocomplete="off" autocorrect="off">' +
        '<div id="flist" class="mt10"></div>',
      actions: [
        { label: '自定义食物', onClick: function () { setTimeout(function () { openCustomFood(ctx, mealKey); }, 150); } },
        { label: '关掉' }
      ],
      onMount: function (rootEl, close) {
        var box = U.$('#flist', rootEl);
        box.innerHTML = listHtml('');
        U.$('#fs', rootEl).addEventListener('input', function (e) { box.innerHTML = listHtml(e.target.value); });
        box.addEventListener('click', function (e) {
          var b = e.target.closest('[data-food]');
          if (!b) return;
          close();
          addFood(ctx, mealKey, b.dataset.food);
        });
      }
    });
  }

  function openCustomFood(ctx, mealKey) {
    var meal = P.MEALS.find(function (m) { return m.key === mealKey; });
    U.sheet({
      title: '自定义食物 · ' + meal.label,
      sub: '列表里没有的（外卖、食堂、别人做的），按包装或估算填',
      body: '<div class="cell"><span>名称</span><input type="text" id="c_n" placeholder="比如 食堂清蒸鱼"></div>' +
        '<div class="cell mt10"><span>这一份多少克</span><input type="number" step="10" inputmode="decimal" id="c_g" value="150"></div>' +
        '<div class="grid2 mt10">' +
        '<div class="cell"><span>热量 kcal</span><input type="number" step="10" inputmode="decimal" id="c_k" placeholder="留空自动算"></div>' +
        '<div class="cell"><span>蛋白 g</span><input type="number" step="1" inputmode="decimal" id="c_p" value="0"></div>' +
        '</div><div class="grid2 mt10">' +
        '<div class="cell"><span>碳水 g</span><input type="number" step="1" inputmode="decimal" id="c_c" value="0"></div>' +
        '<div class="cell"><span>脂肪 g</span><input type="number" step="1" inputmode="decimal" id="c_f" value="0"></div>' +
        '</div>' +
        U.note('热量留空的话按 <b>蛋白×4 + 碳水×4 + 脂肪×9</b> 自动算。', 'info'),
      actions: [
        { label: '取消' },
        {
          label: '加进这一餐', cls: 'primary', onClick: function (rootEl) {
            var n = String(U.$('#c_n', rootEl).value || '').trim();
            var g = U.numVal(U.$('#c_g', rootEl).value);
            var p = U.numVal(U.$('#c_p', rootEl).value) || 0;
            var c = U.numVal(U.$('#c_c', rootEl).value) || 0;
            var f = U.numVal(U.$('#c_f', rootEl).value) || 0;
            var k = U.numVal(U.$('#c_k', rootEl).value);
            if (!n) { U.toast('给它起个名字'); return false; }
            if (!(g > 0)) { U.toast('填一下克重'); return false; }
            if (p <= 0 && c <= 0 && f <= 0 && !(k > 0)) { U.toast('至少填一个宏量或热量'); return false; }
            if (!(k > 0)) k = p * 4 + c * 4 + f * 9;
            var d = ensure(ctx);
            d.items[mealKey].push(P.itemCustom(n, g, k, p, c, f));
            d[mealKey] = true;
            commit(ctx, d);
            U.toast('已加 ' + n);
          }
        }
      ]
    });
  }

  /* ---- 套用套餐 ---- */
  function applyRecipe(ctx, rid) {
    var rec = P.recipeById(rid);
    if (!rec) return;
    var d = ensure(ctx);
    P.MEALS.forEach(function (m, i) {
      var rm = rec.meals[i];
      if (!rm) return;
      d.items[m.key] = rm.items.map(P.itemFromRecipe).filter(Boolean);
      if (d.items[m.key].length) d[m.key] = true;
    });
    d.recipeId = rid;
    recompute(d);
    Store.saveNow();
    U.toast('已灌入 ' + rid + '：' + r0(d.kcal) + ' kcal（可以改克重、加菜、删菜）');
    ctx.refresh(true);
  }

  function openRecipePicker(ctx) {
    var info = ctx.info;
    var ids = P.RECIPE_IDS[info.tierKey] || [];
    var recs = ids.map(function (x) { return P.recipeById(x); }).filter(Boolean);
    var body = '<div class="small muted mb10">今日日型：' + U.esc(info.tierName) +
      '。推荐 <b>' + P.recipeFor(info.date, info.day) + '</b>。' +
      '灌进去之后可以改克重、加菜、删菜 —— 相当于给你一个起点，不用从零加。</div>' +
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
          '</b>，需要 <b>' + d.name + ' ' + needG + 'g</b>。</div>'
        : '<div class="note mt10">这个食物不含' + ({ c: '碳水', p: '蛋白', f: '脂肪' }[mode]) + '，算不出克重。</div>') +
      '<div class="small muted mt6">同类互换：' +
      (P.SUBS.find(function (s) { return s.unit === mode; }) || { rows: [] }).rows.slice(0, 5)
        .map(function (x) { return U.esc(x[0]) + ' ' + U.esc(x[1]); }).join('　·　') + '</div>';
  }

  return {
    id: 'diet', title: '饮食', render: render, mount: mount,
    emptyDiet: emptyDiet, recompute: recompute, compare: compare, advice: advice
  };
});
