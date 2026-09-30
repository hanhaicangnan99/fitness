/*!
 * view.editor.js — 「编排训练日」
 *
 * 提前把每个训练日的动作清单排好，到了那天打开训练页直接练。
 * 编的是"计划"（config.sessionOverrides），不是某一天的记录 —— 所以做完就是长期的。
 * 带一个"体检表"：按 DAY_BLUEPRINT 检查动作类型有没有漏、有没有重复。
 */
(function (root, factory) {
  root.JS = root.JS || {};
  root.JS.Views = root.JS.Views || {};
  root.JS.Views.editor = factory(root.JS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JS) {
  'use strict';
  var P = JS, S = JS.Stats, U = JS.UI, Store = JS.Store;

  var KEY = 'D3';        // 当前正在编的训练日

  function keysOf() {
    return Store.get().config.planMode === 'ppl' ? P.PPL_ORDER : ['D3', 'D5', 'D6', 'D8', 'D10'];
  }
  function labelOf(k) {
    var b = P.DAY_BLUEPRINT[k];
    var s = P.SESSIONS[k];
    return (s ? s.name : k) + '（' + (b ? b.name : k) + '）';
  }
  function defs() { return Store.sessionExercises(KEY).map(function (d) { return d.slice(); }); }
  function commit(list) {
    Store.setSessionOverride(KEY, list);
    Store.saveNow();
  }

  /* ================================================================== */
  function render(ctx) {
    var keys = keysOf();
    if (keys.indexOf(KEY) < 0) KEY = keys[0];
    var list = defs();
    var overridden = Store.hasOverride(KEY);
    var bp = P.DAY_BLUEPRINT[KEY] || { expect: [] };

    var h = [];

    h.push('<div class="card"><div class="card-h"><h2>编排训练日</h2>' +
      '<button class="btn sm" data-go="settings">返回</button></div>' +
      '<div class="small muted">把每个训练日的动作提前排好，到了那天打开「训练」直接练。<br>' +
      '这里改的是<b>长期计划</b>，不是某一天的记录 —— 已记的训练历史不受影响。</div>' +
      '</div>');

    /* ---- 选训练日 ---- */
    h.push('<div class="card tight"><div class="small muted mb10">选一个训练日来编</div>' +
      U.seg('ed-key', keys.map(function (k) {
        return [k, k.indexOf('ppl:') === 0 ? P.PPL_NAMES[k] : k];
      }), KEY, { scroll: true }) +
      '<div class="mt10"><b>' + U.esc((P.SESSIONS[KEY] || {}).name || KEY) + '</b>' +
      (bp.name ? '　·　' + U.esc(bp.name) : '') +
      (overridden ? '　<span class="chip warn">已改过</span>' : '　<span class="chip">默认</span>') +
      '</div></div>');

    /* ---- 动作清单 ---- */
    h.push('<div class="sect-title">' + U.esc(bp.name || KEY) + '　·　' + list.length + ' 个动作</div>');
    h.push('<div class="card" id="edlist">' + list.map(function (d, i) {
      return row(d, i, list.length);
    }).join('') +
      '<div class="exrow" style="padding-top:10px">' +
      '<button class="btn sm wide" data-act="ed-add">＋ 添加动作</button>' +
      '</div></div>');

    /* ---- 体检表 ---- */
    h.push(checkCard(list, bp));

    /* ---- 操作 ---- */
    h.push('<div class="card"><div class="btn-row">' +
      '<button class="btn" data-act="ed-reset" ' + (overridden ? '' : 'disabled') + '>恢复这一天的默认动作</button>' +
      '</div>' +
      (overridden
        ? '<div class="small muted mt6">恢复后这一天的动作会回到源计划（谭成义体系）的清单。</div>'
        : '<div class="small muted mt6">这一天现在就是源计划的默认动作，没有改动。</div>') +
      '</div>');

    /* ---- 同步到某天 ---- */
    h.push(syncCard(ctx));

    return h.join('');
  }

  function row(d, i, total) {
    var g = P.groupFor(d[0]);
    return '<div class="exrow" data-ex="' + i + '">' +
      '<div class="exline">' +
      '<div class="idx" style="width:22px;height:22px;border-radius:7px;background:var(--navy);color:#fff;' +
      'font-size:12px;font-weight:700;display:grid;place-items:center;flex:none">' + (i + 1) + '</div>' +
      '<div class="grow">' +
      '<div class="exname">' + U.esc(d[0]) + '</div>' +
      '<div class="explan">' + d[1] + ' 组 × ' + U.esc(d[2]) +
      (d[4] ? '　·　组间 ' + d[4] + 's' : '') +
      (d[5] ? '　·　' + U.esc(d[5]) : '') +
      (g ? '　·　' + U.esc(g.area) : '') + '</div>' +
      '</div>' +
      '<button class="exmore" data-edmore="' + i + '" aria-label="动作选项">⋯</button>' +
      '</div></div>';
  }

  /** 体检表：漏了哪些动作类型、哪些重复了 */
  function checkCard(list, bp) {
    var repeatOk = bp.repeatOk || [];
    var used = {}, dup = [], order = [];
    list.forEach(function (d) {
      var g = P.groupFor(d[0]);
      var area = g ? g.area : '（自定义动作）';
      if (used[area]) { used[area].push(d[0]); } else { used[area] = [d[0]]; order.push(area); }
    });
    // 像手臂日这种一天里多个同类动作是有意的，blueprint 里用 repeatOk 标出来
    order.forEach(function (a) {
      if (used[a].length > 1 && repeatOk.indexOf(a) < 0) dup.push(a + '：' + used[a].join('、'));
    });
    var missing = (bp.expect || []).filter(function (a) { return !used[a]; });
    var covered = (bp.expect || []).filter(function (a) { return used[a]; });

    var rows = (bp.expect || []).map(function (a) {
      return [used[a] ? '✓' : '—', U.esc(a), used[a] ? U.esc(used[a].join('、')) : '<span class="muted">没安排</span>'];
    });
    var extra = order.filter(function (a) {
      return (bp.expect || []).indexOf(a) < 0 && a !== '（自定义动作）';
    });

    var h = ['<div class="card"><div class="card-h"><h2>动作类型体检</h2>' +
      (missing.length ? '<span class="chip warn">漏了 ' + missing.length + ' 类</span>' : '<span class="chip ok">覆盖完整</span>') +
      '</div>'];
    if (rows.length) h.push(U.table(['', '应有', '现在的动作'], rows, { cls: 'tight' }));
    if (extra.length) {
      h.push('<div class="small muted mt10">额外加进来的类型：' + extra.map(U.esc).join('、') + '</div>');
    }
    if (dup.length) {
      h.push(U.note('<b>同一动作模式重复了：</b><br>' + dup.map(U.esc).join('<br>') +
        '<br>一天里同一模式做两个，等于把别的部位挤掉。留一个就够。', 'warn'));
    }
    if (missing.length) {
      h.push(U.note('<b>建议补上：</b>' + missing.map(U.esc).join('、') +
        '<br>后束 / 中束 / 腘绳是最常被漏掉的三类。', 'info'));
    }
    if (!rows.length && !dup.length) {
      h.push('<div class="small muted">轻量日不检查覆盖，随便排。</div>');
    }
    h.push('</div>');
    return h.join('');
  }

  function syncCard(ctx) {
    var today = P.todayStr();
    var rec = Store.get().days[today];
    var info = Store.resolveDay(today);
    var sameKey = info.sessionKey === KEY;
    var hasRec = rec && rec.workout && rec.workout.exercises && rec.workout.exercises.length;
    if (!hasRec || !sameKey) {
      return '<div class="card"><div class="small muted">编排保存后立刻生效：下次练到 <b>' +
        U.esc(labelOf(KEY)) + '</b> 时，训练页会自动用这份清单。</div></div>';
    }
    return '<div class="card"><div class="card-h"><h2>今天的记录</h2></div>' +
      '<div class="small muted mb10">今天（' + today + '）正好是' + U.esc(labelOf(KEY)) +
      '，而且已经有一条记录了。要不要把这份新清单也同步到今天的记录？</div>' +
      '<button class="btn wide" data-act="ed-sync-today">同步到今天（会重建今天的动作，已勾的会丢）</button>' +
      '</div>';
  }

  /* ==================================================================
   * 事件
   * ================================================================== */
  function mount(rootEl, ctx) {
    U.bindSeg(rootEl, 'ed-key', function (v) { KEY = v; ctx.refresh(); });

    rootEl.addEventListener('click', function (e) {
      // data-go（返回 / 跳标签页）由 app.js 全局处理，这里只管自己的 data-act / data-edmore
      var more = e.target.closest('[data-edmore]');
      if (more) { openMenu(ctx, +more.dataset.edmore); return; }

      var act = e.target.closest('[data-act]');
      if (!act) return;
      act = act.dataset.act;

      if (act === 'ed-add') { pick(ctx, null, function (name) { addAt(ctx, defs().length, name); }); return; }
      if (act === 'ed-reset') {
        U.confirmSheet({
          title: '恢复这一天的默认动作？',
          text: U.esc(labelOf(KEY)) + ' 会回到源计划的动作清单。已记的训练历史不受影响。',
          okLabel: '恢复默认'
        }).then(function (y) {
          if (!y) return;
          Store.clearSessionOverride(KEY);
          U.toast('已恢复默认');
          ctx.refresh();
        });
        return;
      }
      if (act === 'ed-sync-today') {
        U.confirmSheet({
          title: '同步到今天的记录？',
          text: '今天的动作清单会被这份新清单替换，已经勾的、填过的重量都会丢。',
          okLabel: '同步', danger: true
        }).then(function (y) {
          if (!y) return;
          var today = P.todayStr();
          Store.setWorkout(today, Store.emptyWorkout(KEY, Store.resolveDay(today).deload));
          Store.saveNow();
          U.toast('已同步到今天');
          ctx.app.setDate(today);
          ctx.app.go('workout');
        });
        return;
      }
    });
  }

  function openMenu(ctx, i) {
    var list = defs();
    var d = list[i];
    if (!d) return;
    var g = P.groupFor(d[0]);
    var alts = g ? g.options.filter(function (o) { return o[0] !== d[0]; }) : [];

    var body = '<div class="small muted mb10">' + d[1] + ' 组 × ' + U.esc(d[2]) +
      (d[5] ? '　·　' + U.esc(d[5]) : '') + '</div>' +
      (alts.length ? '<div class="small muted mb6">同类替代</div><div class="btn-row mb10">' +
        alts.map(function (o) {
          return '<button class="btn sm" style="flex:1 1 46%" data-swap="' + U.esc(o[0]) + '">' + U.esc(o[0]) + '</button>';
        }).join('') + '</div>' : '') +
      '<div class="btn-row">' +
      '<button class="btn sm primary" data-m="pick">看全部动作库</button>' +
      '<button class="btn sm" data-m="sets">改组数 / 次数</button>' +
      '</div><div class="btn-row mt10">' +
      '<button class="btn sm" data-m="insert">在下面插入</button>' +
      '<button class="btn sm" data-m="up">上移</button>' +
      '<button class="btn sm" data-m="down">下移</button>' +
      '</div>' +
      '<button class="btn bad wide mt10" data-m="del">从这一天删掉</button>';

    U.sheet({
      title: d[0], sub: '第 ' + (i + 1) + ' 个　·　共 ' + list.length + ' 个',
      body: body,
      actions: [{ label: '取消' }],
      onMount: function (rootEl, close) {
        rootEl.addEventListener('click', function (e) {
          var sw = e.target.closest('[data-swap]');
          if (sw) { close(); swapAt(ctx, i, sw.dataset.swap); return; }
          var m = e.target.closest('[data-m]');
          if (!m) return;
          var k = m.dataset.m;
          if (k === 'pick') { close(); pick(ctx, d[0], function (name) { swapAt(ctx, i, name); }); return; }
          if (k === 'sets') { close(); editSets(ctx, i); return; }
          if (k === 'insert') { close(); pick(ctx, null, function (name) { addAt(ctx, i + 1, name); }); return; }
          if (k === 'up' || k === 'down') {
            close();
            var to = i + (k === 'up' ? -1 : 1);
            if (to < 0 || to >= list.length) { U.toast('已经到顶/到底了'); return; }
            var t = list[i]; list[i] = list[to]; list[to] = t;
            commit(list); U.toast('已调整顺序'); ctx.refresh();
            return;
          }
          if (k === 'del') {
            close();
            if (list.length <= 1) { U.toast('至少留一个动作'); return; }
            list.splice(i, 1);
            commit(list); U.toast('已删掉'); ctx.refresh();
            return;
          }
        });
      }
    });
  }

  function swapAt(ctx, i, name) {
    var list = defs();
    var def = P.exDef(name);
    if (!def) def = [name, list[i][1], list[i][2], list[i][3], list[i][4], list[i][5], list[i][6]];
    list[i] = def;
    commit(list);
    U.toast('已换成 ' + name);
    ctx.refresh();
  }
  function addAt(ctx, idx, name) {
    var list = defs();
    var def = P.exDef(name) || [name, 3, '8-12', '3秒', 75, '', ''];
    list.splice(Math.min(idx, list.length), 0, def);
    commit(list);
    U.toast('已添加 ' + name);
    ctx.refresh();
  }
  function editSets(ctx, i) {
    var list = defs();
    var d = list[i];
    U.sheet({
      title: '改组数 / 次数', sub: d[0],
      body: '<div class="grid3">' +
        '<div class="cell"><span>组数</span><input type="number" step="1" min="1" max="10" inputmode="numeric" id="s1" value="' + d[1] + '"></div>' +
        '<div class="cell"><span>次数</span><input type="text" id="s2" value="' + U.esc(d[2]) + '" placeholder="8-10"></div>' +
        '<div class="cell"><span>组间 秒</span><input type="number" step="5" min="15" max="300" inputmode="numeric" id="s3" value="' + (d[4] || 75) + '"></div>' +
        '</div>' +
        U.note('次数可以写区间（如 8-10）或固定值（如 12）。<br>' +
          '复合动作组间 90-150 秒，孤立动作 60-90 秒。', 'info'),
      actions: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: function (rootEl) {
            var sets = U.numVal(U.$('#s1', rootEl).value);
            var reps = String(U.$('#s2', rootEl).value || '').trim();
            var rest = U.numVal(U.$('#s3', rootEl).value);
            if (sets == null || sets < 1) { U.toast('组数不对'); return false; }
            if (!reps) { U.toast('填一下次数'); return false; }
            list[i] = [d[0], sets, reps, d[3], rest == null ? 75 : rest, d[5], d[6]];
            commit(list);
            U.toast('已更新');
            ctx.refresh();
          }
        }
      ]
    });
  }

  /** 动作选择器：同类替代优先，下面是完整动作库 */
  function pick(ctx, current, onPick) {
    var g = current ? P.groupFor(current) : null;
    var h = [];
    if (g) {
      h.push('<div class="sect-title" style="margin:12px 0 6px 0">同类替代（推荐）</div>');
      h.push('<div class="small muted mb10">' + U.esc(g.area) + '　·　' + U.esc(g.muscle) + '</div>');
      h.push(g.options.map(function (o) {
        var on = o[0] === current;
        return '<button class="btn wide mb6" style="justify-content:flex-start;text-align:left;' +
          (on ? 'border-color:var(--navy);background:var(--info-bg)' : '') + '" data-pick="' + U.esc(o[0]) + '">' +
          '<span style="flex:1"><b>' + U.esc(o[0]) + '</b>' + (on ? ' <span class="chip">当前</span>' : '') +
          '<span class="s small muted" style="display:block">' + U.esc(o[6]) + '　·　' + o[1] + ' 组 × ' + U.esc(o[2]) + '</span>' +
          '<span class="s small muted" style="display:block">' + U.esc(o[7]) + '</span></span></button>';
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
      body: h.join('') + U.note('共 ' + P.EXERCISE_LIB.length + ' 个动作，按动作类型分组。', 'info'),
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

  return { id: 'editor', title: '编排训练日', render: render, mount: mount };
});
