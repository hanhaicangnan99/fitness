/*!
 * store.js — 持久化、迁移、导入导出
 *
 * 存储：localStorage 单键 jianshen:v1。记录按需创建（没碰过的日期不落库），
 * 所以体积 ≈ 实际使用天数 × 1.5KB，3 年也远小于配额。
 *
 * 同样用 UMD 包装，Node 自测时可 require（此时 localStorage 不存在，自动走内存态）。
 */
(function (root, factory) {
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./data.plan.js') : root.JS
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JS = root.JS || {};
  root.JS.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';

  var KEY = 'jianshen:v1';
  var BACKUP_KEY = 'jianshen:backup';
  var SCHEMA = 1;

  /* ---------------- 存储后端：localStorage 优先，失败降级为内存 ---------------- */
  var mem = {};
  var backend = null;
  var backendName = 'memory';
  var persistError = null;

  function probe() {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : null;
      if (!ls) return null;
      var k = '__js_probe__';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return ls;
    } catch (e) { return null; }
  }
  function init() {
    backend = probe();
    backendName = backend ? 'localStorage' : 'memory';
    return backendName;
  }
  function rawGet(k) {
    try { return backend ? backend.getItem(k) : (mem[k] || null); } catch (e) { return mem[k] || null; }
  }
  function rawSet(k, v) {
    mem[k] = v;
    if (!backend) return false;
    try { backend.setItem(k, v); return true; }
    catch (e) { persistError = e; return false; }
  }

  /* ---------------- 状态 ---------------- */
  function defaultState() {
    return {
      version: SCHEMA,
      profile: { height: 185, startWeight: 93, startBodyFat: 26, targetWeight: 84, age: 28, sex: '男' },
      config: {
        anchor: P.ANCHOR_D1, planMode: 'main', pplCursor: 0, deloadEnabled: true,
        restRecipeStart: 0,
        /** 永久改过的训练日动作：[name, sets, reps, tempo, rest, target, note][] */
        sessionOverrides: {}
      },
      days: {},
      meta: { createdAt: null, lastBackupAt: null }
    };
  }

  var state = defaultState();
  var listeners = [];
  var saveTimer = null;

  function migrate(s) {
    if (!s || typeof s !== 'object') return defaultState();
    var d = defaultState();
    // 逐字段补齐，未知字段保留（前向兼容）
    for (var k in d) if (!(k in s)) s[k] = d[k];
    for (var k2 in d.profile) if (!(k2 in s.profile)) s.profile[k2] = d.profile[k2];
    for (var k3 in d.config) if (!(k3 in s.config)) s.config[k3] = d.config[k3];
    if (!s.days || typeof s.days !== 'object' || Array.isArray(s.days)) s.days = {};
    if (!s.meta || typeof s.meta !== 'object') s.meta = d.meta;
    if (!s.config.sessionOverrides || typeof s.config.sessionOverrides !== 'object') s.config.sessionOverrides = {};

    // 夹紧可能被外部 JSON 污染的值 —— 一份坏备份不该让 App 白屏
    s.config.planMode = (s.config.planMode === 'ppl') ? 'ppl' : 'main';
    var cur = Math.round(+s.config.pplCursor);
    s.config.pplCursor = isFinite(cur) ? ((cur % 3) + 3) % 3 : 0;
    s.config.deloadEnabled = s.config.deloadEnabled !== false;
    if (!P.isValidDate(s.config.anchor)) s.config.anchor = P.ANCHOR_D1;
    ['height', 'startWeight', 'startBodyFat', 'targetWeight', 'age'].forEach(function (f) {
      var v = +s.profile[f];
      if (!isFinite(v) || v <= 0 || v > 1000) s.profile[f] = d.profile[f];
    });

    // 逐日清洗：dIndex / tier 非法就丢掉，让它回落到按日期自动计算
    for (var date in s.days) {
      var r = s.days[date];
      if (!r || typeof r !== 'object' || !P.isValidDate(date)) { delete s.days[date]; continue; }
      if (r.dIndex != null) {
        var di = Math.round(+r.dIndex);
        if (!(di >= 1 && di <= 10)) delete r.dIndex; else r.dIndex = di;
      }
      if (r.tier != null && !P.TIERS[r.tier]) delete r.tier;
      if (r.workout && typeof r.workout !== 'object') delete r.workout;
      else if (r.workout) normalizeWorkout(r.workout);
      if (r.diet && typeof r.diet !== 'object') delete r.diet;
      else if (r.diet) normalizeDiet(r.diet);
      if (r.body && typeof r.body !== 'object') delete r.body;
      if (r.daily && typeof r.daily !== 'object') delete r.daily;
    }
    s.version = SCHEMA;
    return s;
  }

  /**
   * 老饮食记录的兼容：早期只有 4 个手填的总数，没有逐餐的食物清单。
   * 补齐 items 结构，并做基本清洗（坏条目直接丢掉，别让渲染炸）。
   */
  function normalizeDiet(d) {
    if (!d.items || typeof d.items !== 'object' || Array.isArray(d.items)) {
      d.items = { m1: [], m2: [], shake: [] };
    }
    for (var i = 0; i < P.MEALS.length; i++) {
      var k = P.MEALS[i].key;
      if (!Array.isArray(d.items[k])) { d.items[k] = []; continue; }
      d.items[k] = d.items[k].filter(function (it) {
        if (!it || typeof it !== 'object') return false;
        if (typeof it.n !== 'string' || !it.n) return false;
        if (!Array.isArray(it.per) || it.per.length !== 4) return false;
        if (!isFinite(+it.g) || +it.g <= 0) return false;
        it.g = +it.g;
        it.per = it.per.map(function (x) { return isFinite(+x) ? +x : 0; });
        return true;
      });
    }
    // 有食物清单就以清单为准重算总数，避免导入别人的备份时数字对不上
    var all = [];
    for (var j = 0; j < P.MEALS.length; j++) all = all.concat(d.items[P.MEALS[j].key]);
    if (all.length) {
      var t = P.sumItems(all);
      d.kcal = Math.round(t.k);
      d.p = Math.round(t.p * 10) / 10;
      d.c = Math.round(t.c * 10) / 10;
      d.f = Math.round(t.f * 10) / 10;
    }
    return d;
  }

  /**
   * 老训练记录的兼容：把「有没有填过重量次数」补成显式的 done 标记。
   * 极简模式（只打勾）是后加的，早期记录里没有 done 字段。
   */
  function normalizeWorkout(w) {
    if (!w || !Array.isArray(w.exercises)) {
      if (w && !Array.isArray(w.exercises)) w.exercises = [];
      return w;
    }
    for (var i = 0; i < w.exercises.length; i++) {
      var ex = w.exercises[i];
      if (!ex || typeof ex !== 'object') continue;
      if (!Array.isArray(ex.sets)) ex.sets = [];
      var filled = false;
      for (var j = 0; j < ex.sets.length; j++) {
        var st = ex.sets[j];
        if (st && st.w != null && st.r != null) { filled = true; break; }
      }
      if (ex.done == null) ex.done = filled;
      if (ex.detail == null) ex.detail = filled;
    }
    if (w.cardio && typeof w.cardio === 'object') {
      if (w.cardio.done == null) w.cardio.done = !!(w.cardio.min > 0);
    }
    return w;
  }

  function load() {
    var txt = rawGet(KEY);
    if (!txt) { state = defaultState(); state.meta.createdAt = new Date().toISOString(); return state; }
    try { state = migrate(JSON.parse(txt)); }
    catch (e) { state = defaultState(); }
    if (!state.meta.createdAt) state.meta.createdAt = new Date().toISOString();
    return state;
  }

  function serialize() { return JSON.stringify(state); }

  function flush() {
    saveTimer = null;
    var prev = rawGet(KEY);
    if (prev) rawSet(BACKUP_KEY, prev);          // 保留上一版快照，供回滚
    var ok = rawSet(KEY, serialize());
    if (!ok && backend) { backend = null; backendName = 'memory'; }
    return ok;
  }
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function saveNow() { if (saveTimer) { clearTimeout(saveTimer); } return flush(); }

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](state); } catch (e) {} } }
  function subscribe(fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

  /* ---------------- 日期解析 ---------------- */
  /**
   * 把日期解析成当日计划：轮转日、班次、热量档、课程。
   * 手动覆盖只影响这一天，不改全局锚点。
   */
  function resolveDay(dateStr) {
    var rec = state.days[dateStr];
    var autoD = P.dIndex(dateStr);
    var d = autoD;
    if (rec && rec.dIndex != null) {
      var di = Math.round(+rec.dIndex);
      if (di >= 1 && di <= 10) d = di;
    }
    var autoTier = P.DAYS[d].tier;
    var tierKey = autoTier;
    if (rec && rec.tier && P.TIERS[rec.tier]) tierKey = rec.tier;

    var off = P.cycleIndex(dateStr);
    var phase = P.phaseOf(off);
    var tierDef = P.TIERS[tierKey];
    var inDb = phase.key === 'DB';
    var kcal = inDb ? P.TIERS_DB[tierKey] : tierDef.kcal;

    var day = P.DAYS[d];
    var sessionKey = resolveSessionKey(dateStr, d, tierKey);
    return {
      date: dateStr, off: off, d: d, autoD: autoD, day: day, dayOverridden: d !== autoD,
      shift: day.shift, dayLabel: day.label, wake: day.wake,
      m1: day.m1, m1alt: day.m1alt, m2: day.m2, shake: day.shake, tip: day.tip,
      tierKey: tierKey, tierName: tierDef.name, tierOverridden: tierKey !== autoTier,
      kcal: kcal, p: tierDef.p, c: tierDef.c, f: tierDef.f, tdee: day.tdee,
      week: P.weekOf(off), phase: phase, deload: state.config.deloadEnabled && P.isDeload(off),
      isTrainDay: day.slot !== 'rest', sessionKey: sessionKey,
      slotName: day.slotName, trainTime: day.trainTime
    };
  }

  function resolveSessionKey(dateStr, d, tierKey) {
    var day = P.DAYS[d];
    if (day.slot === 'rest') return 'rest';
    if (state.config.planMode === 'ppl') {
      var c = Math.round(+state.config.pplCursor);
      if (!isFinite(c)) c = 0;
      return P.PPL_ORDER[((c % 3) + 3) % 3];
    }
    return day.slot;
  }

  /* ---------------- 记录读写 ---------------- */
  function day(dateStr, create) {
    if (!state.days[dateStr]) {
      if (!create) return null;
      state.days[dateStr] = {};
    }
    return state.days[dateStr];
  }
  function ensureDay(dateStr) { day(dateStr, true); return state.days[dateStr]; }

  /* ---------------- 课程动作：支持永久改动 ---------------- */
  /** 把 [name,sets,reps,tempo,rest,target,note] 补全成 7 元组 */
  function normalizeDef(d) {
    if (Array.isArray(d)) {
      return [d[0], d[1] || 3, d[2] || '8-12', d[3] || '3秒', d[4] || 75, d[5] || '', d[6] || ''];
    }
    var p = d.planned || {};
    return [d.name, p.sets || 3, p.reps || '8-12', p.tempo || '3秒', p.rest || 75, p.target || '', p.note || ''];
  }

  /**
   * 某个训练日当前有效的动作清单。
   * 优先用「永久改动」（config.sessionOverrides），没有再回落到内置模板。
   */
  function sessionExercises(sessionKey) {
    var ov = state.config.sessionOverrides && state.config.sessionOverrides[sessionKey];
    if (ov && ov.length) return ov.map(normalizeDef);
    var s = P.SESSIONS[sessionKey];
    return s ? s.exercises.map(normalizeDef) : [];
  }
  function hasOverride(sessionKey) {
    var ov = state.config.sessionOverrides && state.config.sessionOverrides[sessionKey];
    return !!(ov && ov.length);
  }
  function setSessionOverride(sessionKey, defs) {
    if (!state.config.sessionOverrides) state.config.sessionOverrides = {};
    state.config.sessionOverrides[sessionKey] = defs.map(normalizeDef);
    save(); emit();
  }
  function clearSessionOverride(sessionKey) {
    if (state.config.sessionOverrides) delete state.config.sessionOverrides[sessionKey];
    save(); emit();
  }
  function clearAllOverrides() { state.config.sessionOverrides = {}; saveNow(); emit(); }

  function emptyWorkout(sessionKey, halve) {
    var defs = sessionExercises(sessionKey);
    var ex = [];
    for (var i = 0; i < defs.length; i++) {
      var e = defs[i];
      var n = halve ? Math.max(1, Math.ceil(e[1] / 2)) : e[1];
      var sets = [];
      for (var j = 0; j < n; j++) sets.push({ w: null, r: null });
      ex.push({
        name: e[0],
        planned: { sets: e[1], reps: e[2], tempo: e[3], rest: e[4], target: e[5], note: e[6] },
        sets: sets, done: false, detail: false, rpe: null, note: ''
      });
    }
    var card = P.CARDIO[sessionKey] || { min: 0, grade: 0, speed: 0, hr: 0, kcal: 0, note: '' };
    return {
      status: '', sessionKey: sessionKey, exercises: ex,
      cardio: { min: card.min, grade: card.grade, speed: card.speed, hr: card.hr, kcal: card.kcal, done: card.min === 0 },
      durationMin: null, degraded: null, pplAdvanced: false, note: ''
    };
  }

  /** 把一个动作换成另一个（保留已填的重量次数，组数按新计划调整） */
  function swapExercise(w, index, def) {
    if (!w || !w.exercises || !w.exercises[index]) return null;
    var old = w.exercises[index];
    var nd = normalizeDef(def);
    var n = nd[1];
    var sets = [];
    for (var j = 0; j < n; j++) sets.push(old.sets[j] ? old.sets[j] : { w: null, r: null });
    w.exercises[index] = {
      name: nd[0],
      planned: { sets: nd[1], reps: nd[2], tempo: nd[3], rest: nd[4], target: nd[5], note: nd[6] },
      sets: sets, done: old.done, detail: old.detail, rpe: old.rpe, note: old.note || ''
    };
    return w.exercises[index];
  }
  function insertExercise(w, index, def) {
    if (!w || !w.exercises) return null;
    var nd = normalizeDef(def);
    var sets = [];
    for (var j = 0; j < nd[1]; j++) sets.push({ w: null, r: null });
    var entry = {
      name: nd[0],
      planned: { sets: nd[1], reps: nd[2], tempo: nd[3], rest: nd[4], target: nd[5], note: nd[6] },
      sets: sets, done: false, detail: false, rpe: null, note: ''
    };
    w.exercises.splice(index, 0, entry);
    return entry;
  }
  function moveExercise(w, index, delta) {
    if (!w || !w.exercises) return false;
    var to = index + delta;
    if (to < 0 || to >= w.exercises.length) return false;
    var t = w.exercises[index];
    w.exercises[index] = w.exercises[to];
    w.exercises[to] = t;
    return true;
  }
  function removeExercise(w, index) {
    if (!w || !w.exercises || w.exercises.length <= 1) return false;
    w.exercises.splice(index, 1);
    return true;
  }
  /** 当前动作清单 → 可持久化的 7 元组数组 */
  function defsFromWorkout(w) {
    return (w.exercises || []).map(function (ex) {
      var p = ex.planned || {};
      return [ex.name, p.sets, p.reps, p.tempo, p.rest, p.target, p.note];
    });
  }

  function setWorkout(dateStr, w) {
    var r = ensureDay(dateStr);
    r.workout = w;
    save(); emit();
    return r.workout;
  }
  function setDiet(dateStr, v) { var r = ensureDay(dateStr); r.diet = v; save(); emit(); return r.diet; }
  function setBody(dateStr, v) {
    var r = ensureDay(dateStr);
    if (!v || (v.kg == null && v.bf == null && v.waist == null)) delete r.body; else r.body = v;
    save(); emit();
    return r.body;
  }
  function setDaily(dateStr, v) {
    var r = ensureDay(dateStr);
    if (!v || (v.sleepHrs == null && v.steps == null && !v.note)) delete r.daily; else r.daily = v;
    save(); emit();
    return r.daily;
  }
  function patchDay(dateStr, patch) {
    var r = ensureDay(dateStr);
    for (var k in patch) r[k] = patch[k];
    save(); emit();
    return r;
  }
  function removeDay(dateStr) { delete state.days[dateStr]; save(); emit(); }

  function touchProfile(patch) { for (var k in patch) state.profile[k] = patch[k]; save(); emit(); }
  function touchConfig(patch) { for (var k in patch) state.config[k] = patch[k]; save(); emit(); }

  /* ---------------- 备选方案：推拉腿指针 ---------------- */
  /**
   * 打卡完成时推进指针。跳过不推进（对齐"某天没练成不补，从下一个训练日继续"）。
   * pplAdvanced 防止同一天反复点完成把指针推飞。
   */
  function advancePplIfNeeded(dateStr) {
    if (state.config.planMode !== 'ppl') return false;
    var r = state.days[dateStr];
    if (!r || !r.workout) return false;
    var w = r.workout;
    if (w.status !== 'done') return false;
    if (w.pplAdvanced) return false;
    if (P.PPL_ORDER.indexOf(w.sessionKey) < 0) return false;
    w.pplAdvanced = true;
    state.config.pplCursor = (state.config.pplCursor + 1) % 3;
    return true;
  }

  /* ---------------- 导入导出 ---------------- */
  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(text, mode) {
    var incoming;
    try { incoming = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法的 JSON：' + e.message }; }
    if (!incoming || typeof incoming !== 'object' || typeof incoming.days !== 'object') {
      return { ok: false, error: '结构不对：缺少 days 字段，这不像本 App 导出的备份' };
    }
    incoming = migrate(incoming);
    if (mode === 'merge') {
      var added = 0, updated = 0;
      for (var d in incoming.days) {
        if (typeof incoming.days[d] !== 'object') continue;
        if (state.days[d]) { updated++; } else { added++; }
        // 逐字段覆盖：导入的字段赢，但没提到的字段保留
        var tgt = state.days[d] || (state.days[d] = {});
        for (var f in incoming.days[d]) tgt[f] = incoming.days[d][f];
      }
      // 配置与资料：只在导入方有显式值时覆盖
      if (incoming.config) for (var c in incoming.config) state.config[c] = incoming.config[c];
      if (incoming.profile) for (var p2 in incoming.profile) state.profile[p2] = incoming.profile[p2];
      saveNow(); emit();
      return { ok: true, mode: 'merge', added: added, updated: updated };
    }
    state = incoming;
    flush(); emit();
    return { ok: true, mode: 'replace', total: Object.keys(state.days).length };
  }

  function rollback() {
    var txt = rawGet(BACKUP_KEY);
    if (!txt) return { ok: false, error: '没有可回滚的快照' };
    try { state = migrate(JSON.parse(txt)); }
    catch (e) { return { ok: false, error: '快照损坏：' + e.message }; }
    flush(); emit();
    return { ok: true };
  }

  function clearAll() {
    state = defaultState();
    state.meta.createdAt = new Date().toISOString();
    saveNow(); emit();
  }

  /* ---------------- CSV ---------------- */
  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(headers, rows) {
    var out = [headers.map(csvCell).join(',')];
    for (var i = 0; i < rows.length; i++) out.push(rows[i].map(csvCell).join(','));
    return '\uFEFF' + out.join('\r\n');           // BOM：Excel 打开不乱码
  }
  function sortedDates() { return Object.keys(state.days).sort(); }

  function exportCSV(kind) {
    var dates = sortedDates(), i, d, r, res;
    if (kind === 'workout') {
      res = [['日期', '轮转日', '班次', '课程', '状态', '动作', '组序', '重量kg', '次数', '容量kg', 'RPE', '备注']];
      for (i = 0; i < dates.length; i++) {
        d = dates[i]; r = state.days[d];
        if (!r.workout) continue;
        var info = resolveDay(d);
        var w = r.workout;
        var s = P.SESSIONS[w.sessionKey];
        if (!w.exercises || !w.exercises.length) {
          res.push([d, 'D' + info.d, info.shift, s ? s.name : w.sessionKey, statusText(w.status), '', '', '', '', '', '', w.note || '']);
          continue;
        }
        for (var e = 0; e < w.exercises.length; e++) {
          var ex = w.exercises[e];
          for (var k = 0; k < ex.sets.length; k++) {
            var st = ex.sets[k];
            res.push([d, 'D' + info.d, info.shift, s ? s.name : w.sessionKey, statusText(w.status),
              ex.name, k + 1, st.w == null ? '' : st.w, st.r == null ? '' : st.r,
              (st.w != null && st.r != null) ? st.w * st.r : '', ex.rpe == null ? '' : ex.rpe, ex.note || '']);
          }
        }
        if (w.cardio && w.cardio.min) {
          res.push([d, 'D' + info.d, info.shift, '有氧', statusText(w.status), '跑步机爬坡走', 1, '', w.cardio.min, '', '',
            '坡度' + w.cardio.grade + ' 速度' + w.cardio.speed + ' 心率' + (w.cardio.hr || '') + ' ' + (w.cardio.kcal || '') + 'kcal']);
        }
      }
    } else if (kind === 'diet') {
      res = [['日期', '轮转日', '班次', '日型', '目标kcal', '实际kcal', '蛋白g', '碳水g', '脂肪g', '达标', '套餐', '正餐1', '正餐2', '补口', '饮水', '纤维']];
      for (i = 0; i < dates.length; i++) {
        d = dates[i]; r = state.days[d];
        if (!r.diet) continue;
        var inf = resolveDay(d), dt = r.diet;
        var hit = dt.kcal ? (Math.abs(dt.kcal - inf.kcal) / inf.kcal <= 0.1 ? '达标' : '偏差>10%') : '';
        res.push([d, 'D' + inf.d, inf.shift, inf.tierName, inf.kcal, dt.kcal == null ? '' : Math.round(dt.kcal),
          dt.p == null ? '' : dt.p, dt.c == null ? '' : dt.c, dt.f == null ? '' : dt.f, hit,
          dt.recipeId || '', dt.m1 ? '✓' : '', dt.m2 ? '✓' : '', dt.shake ? '✓' : '', dt.water ? '✓' : '', dt.fiber ? '✓' : '']);
      }
    } else if (kind === 'body') {
      res = [['日期', '体重kg', '体脂%', '腰围cm', '7日均重', '距目标kg']];
      var series = weightSeries();
      for (i = 0; i < series.length; i++) {
        var s2 = series[i];
        res.push([s2.date, s2.kg == null ? '' : s2.kg, s2.bf == null ? '' : s2.bf, s2.waist == null ? '' : s2.waist,
          s2.avg7 == null ? '' : s2.avg7, (s2.avg7 != null) ? rnd1(s2.avg7 - state.profile.targetWeight) : '']);
      }
    } else {
      res = [['日期', '星期', '轮转日', '班次', '周次', '阶段', '训练槽位', '热量档', '训练状态', '实际kcal', '体重kg', '睡眠h', '步数']];
      for (i = 0; i < dates.length; i++) {
        d = dates[i]; r = state.days[d];
        var I = resolveDay(d);
        res.push([d, P.weekday(d), 'D' + I.d, I.shift, '第' + I.week + '周', I.phase.name,
          I.slotName, I.tierName + ' ' + I.kcal,
          r.workout ? statusText(r.workout.status) : '',
          r.diet && r.diet.kcal != null ? Math.round(r.diet.kcal) : '',
          r.body && r.body.kg != null ? r.body.kg : '',
          r.daily && r.daily.sleepHrs != null ? r.daily.sleepHrs : '',
          r.daily && r.daily.steps != null ? r.daily.steps : '']);
      }
    }
    return toCSV(res[0], res.slice(1));
  }

  function rnd1(n) { return Math.round(n * 10) / 10; }
  function statusText(s) {
    return { done: '完成', partial: '部分完成', skipped: '跳过', rest: '休息日', '': '未记录' }[s] || s;
  }

  /** 体重序列（含 7 日均重），供统计与 CSV 共用 */
  function weightSeries() {
    var dates = sortedDates(), out = [], i;
    var pts = [];
    for (i = 0; i < dates.length; i++) {
      var r = state.days[dates[i]];
      if (r.body && r.body.kg != null && isFinite(r.body.kg)) {
        pts.push({ date: dates[i], kg: +r.body.kg, bf: r.body.bf == null ? null : +r.body.bf, waist: r.body.waist == null ? null : +r.body.waist });
      }
    }
    for (i = 0; i < pts.length; i++) {
      var sum = 0, n = 0;
      for (var j = i; j >= 0 && n < 7; j--) { sum += pts[j].kg; n++; }
      out.push({
        date: pts[i].date, kg: pts[i].kg, bf: pts[i].bf, waist: pts[i].waist,
        avg7: n >= 1 ? Math.round((sum / n) * 100) / 100 : null
      });
    }
    return out;
  }

  /* ---------------- 对外 ---------------- */
  return {
    KEY: KEY, SCHEMA: SCHEMA,
    init: init, load: load, save: save, saveNow: saveNow, flush: flush,
    subscribe: subscribe, emit: emit,
    get: function () { return state; },
    setState: function (s) { state = s; },
    defaultState: defaultState, migrate: migrate,
    normalizeWorkout: normalizeWorkout, normalizeDiet: normalizeDiet,
    resolveDay: resolveDay, resolveSessionKey: resolveSessionKey,
    day: day, ensureDay: ensureDay, patchDay: patchDay, removeDay: removeDay,
    setWorkout: setWorkout, setDiet: setDiet, setBody: setBody, setDaily: setDaily,
    emptyWorkout: emptyWorkout,
    sessionExercises: sessionExercises, hasOverride: hasOverride,
    setSessionOverride: setSessionOverride, clearSessionOverride: clearSessionOverride,
    clearAllOverrides: clearAllOverrides,
    swapExercise: swapExercise, insertExercise: insertExercise,
    moveExercise: moveExercise, removeExercise: removeExercise, defsFromWorkout: defsFromWorkout,
    touchProfile: touchProfile, touchConfig: touchConfig,
    advancePplIfNeeded: advancePplIfNeeded,
    exportJSON: exportJSON, importJSON: importJSON, rollback: rollback, clearAll: clearAll,
    exportCSV: exportCSV, weightSeries: weightSeries, statusText: statusText,
    sortedDates: sortedDates, ensureDayRecord: ensureDay,
    storageName: function () { return backendName; },
    persistError: function () { return persistError; }
  };
});
