/*!
 * stats.js — 统计与校准（纯函数）
 *
 * 全部函数只读 state、返回新对象，不写库、不碰 DOM。
 * 这样 Node 的 selftest.mjs 可以直接 require 进来断言。
 */
(function (root, factory) {
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./data.plan.js') : root.JS,
    (typeof module === 'object' && module.exports) ? null : (root.JS && root.JS.Store)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JS = root.JS || {};
  root.JS.Stats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P, StoreIfBrowser) {
  'use strict';

  var DAY_MS = 86400000;

  /* ---------------- 基础数值 ---------------- */
  function volume(entry) {
    if (!entry || !entry.sets) return 0;
    var v = 0;
    for (var i = 0; i < entry.sets.length; i++) {
      var s = entry.sets[i];
      if (s && s.w != null && s.r != null && isFinite(s.w) && isFinite(s.r)) v += (+s.w) * (+s.r);
    }
    return Math.round(v * 100) / 100;
  }
  function sessionVolume(w) {
    if (!w || !w.exercises) return 0;
    var v = 0;
    for (var i = 0; i < w.exercises.length; i++) v += volume(w.exercises[i]);
    return Math.round(v * 100) / 100;
  }
  /** 完成组数：重量和次数都填了的组 */
  function setCount(entry) {
    if (!entry || !entry.sets) return 0;
    var n = 0;
    for (var i = 0; i < entry.sets.length; i++) {
      var s = entry.sets[i];
      if (s && s.w != null && s.r != null) n++;
    }
    return n;
  }
  function sessionSetCount(w) {
    if (!w || !w.exercises) return 0;
    var n = 0;
    for (var i = 0; i < w.exercises.length; i++) n += setCount(w.exercises[i]);
    return n;
  }
  /** Epley 估算 1RM */
  function e1rm(w, r) {
    if (w == null || r == null || !isFinite(w) || !isFinite(r) || r <= 0) return null;
    if (r === 1) return +w;
    return Math.round((+w) * (1 + (+r) / 30) * 10) / 10;
  }
  /** 某动作当次最好的估算 1RM */
  function entryE1rm(entry) {
    var best = null;
    if (!entry || !entry.sets) return null;
    for (var i = 0; i < entry.sets.length; i++) {
      var s = entry.sets[i];
      var x = e1rm(s && s.w, s && s.r);
      if (x != null && (best == null || x > best)) best = x;
    }
    return best;
  }
  function sessionTop(w, name) {
    var e = findEntry(w, name);
    return e ? entryE1rm(e) : null;
  }
  function findEntry(w, name) {
    if (!w || !w.exercises) return null;
    for (var i = 0; i < w.exercises.length; i++) if (w.exercises[i].name === name) return w.exercises[i];
    return null;
  }

  /* ---------------- 日期范围 ---------------- */
  function rangeDates(from, to) {
    var a = P.dayNum(from), b = P.dayNum(to), out = [];
    for (var n = a; n <= b; n++) out.push(P.fromDayNum(n));
    return out;
  }
  /** 包含 today 的那个 10 天轮回的起止 */
  function cycleWindow(today) {
    var off = P.cycleIndex(today);
    var k = Math.floor(off / 10);
    return { from: P.addDays(P.ANCHOR_D1, k * 10), to: P.addDays(P.ANCHOR_D1, k * 10 + 9) };
  }

  /**
   * 取某天的计划元信息。浏览器里走 Store.resolveDay（吃手动覆盖与 Diet Break），
   * Node 自测时退化成直接查表 —— 两条路径结果一致。
   */
  function dayMeta(state, d) {
    if (StoreIfBrowser) return StoreIfBrowser.resolveDay(d);
    var rec = (state && state.days && state.days[d]) || {};
    var auto = P.dIndex(d);
    var di = rec.dIndex || auto;
    var day = P.DAYS[di];
    var tierKey = rec.tier || day.tier;
    var t = P.TIERS[tierKey];
    return {
      d: di, autoD: auto, day: day, tierKey: tierKey, tierName: t.name,
      kcal: t.kcal, p: t.p, c: t.c, f: t.f, shift: day.shift, slotName: day.slotName,
      isTrainDay: day.slot !== 'rest'
    };
  }

  /* ---------------- 连续性 ---------------- */
  function streak(dates, hitFn, today) {
    var set = {};
    var i;
    for (i = 0; i < dates.length; i++) if (hitFn(dates[i])) set[dates[i]] = true;
    var keys = Object.keys(set).sort();
    if (!keys.length) return { current: 0, best: 0, last: null };

    // 历史最长：按自然日连续段
    var best = 0, run = 0, prevN = null;
    for (i = 0; i < keys.length; i++) {
      var n = P.dayNum(keys[i]);
      if (prevN != null && n === prevN + 1) run++; else run = 1;
      if (run > best) best = run;
      prevN = n;
    }
    // 当前：从今天（或昨天）往回数
    var cur = 0, start = today;
    if (!set[start]) {
      var y = P.addDays(today, -1);
      if (!set[y]) return { current: 0, best: best, last: keys[keys.length - 1] };
      start = y;
    }
    var walk = start;
    while (set[walk]) { cur++; walk = P.addDays(walk, -1); }
    return { current: cur, best: Math.max(best, cur), last: keys[keys.length - 1] };
  }

  /** 训练连续：只在"计划内训练日"上数，跳过今天（今天还没练不算断） */
  function trainingStreak(state, today) {
    var off = P.cycleIndex(today);
    var startOff = Math.max(0, Math.min(off, 3650));
    var trainDates = [];
    for (var i = 0; i <= startOff; i++) {
      var d = P.addDays(P.ANCHOR_D1, i);
      if (dayMeta(state, d).isTrainDay) trainDates.push(d);
    }
    var done = function (d) {
      var r = state.days[d];
      return !!(r && r.workout && (r.workout.status === 'done' || r.workout.status === 'partial'));
    };
    // 从最近的训练日往回：今天没记就跳过今天
    var idx = trainDates.length - 1;
    while (idx >= 0 && trainDates[idx] === today && !done(today)) idx--;
    var cur = 0;
    while (idx >= 0 && done(trainDates[idx])) { cur++; idx--; }
    // 历史最长
    var best = 0, run = 0;
    for (var j = 0; j < trainDates.length; j++) {
      if (done(trainDates[j])) { run++; if (run > best) best = run; } else { run = 0; }
    }
    return { current: cur, best: Math.max(best, cur), planned: trainDates.length };
  }

  /* ---------------- 区间统计 ---------------- */
  function windowStats(state, from, to) {
    var dates = rangeDates(from, to);
    var s = {
      from: from, to: to, days: dates.length,
      plannedTrain: 0, plannedHeavy: 0, plannedLight: 0, done: 0, partial: 0, skipped: 0, missed: 0,
      volume: 0, sets: 0,
      cardioMin: 0, cardioKcal: 0,
      dietDays: 0, dietHit: 0, kcalSum: 0, targetSum: 0, proteinHit: 0, proteinSum: 0,
      bodyDays: 0, kgSum: 0,
      sleepSum: 0, sleepN: 0
    };
    var today = P.todayStr();
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      var m = dayMeta(state, d);
      var r = state.days[d] || {};
      var w = r.workout;
      if (m.isTrainDay) {
        s.plannedTrain++;
        if (m.tierKey === 'light') s.plannedLight++; else s.plannedHeavy++;
        if (w && w.status === 'done') s.done++;
        else if (w && w.status === 'partial') { s.partial++; s.done++; }
        else if (w && w.status === 'skipped') s.skipped++;
        else if (d < today) s.missed++;
      }
      if (w) {
        s.volume += sessionVolume(w);
        s.sets += sessionSetCount(w);
        if (w.cardio && w.cardio.min) {
          s.cardioMin += (+w.cardio.min || 0);
          s.cardioKcal += (+w.cardio.kcal || 0);
        }
      }
      if (r.diet && r.diet.kcal != null) {
        s.dietDays++;
        s.kcalSum += +r.diet.kcal;
        s.targetSum += m.kcal;
        if (m.kcal && Math.abs(r.diet.kcal - m.kcal) / m.kcal <= 0.1) s.dietHit++;
        if (r.diet.p != null) { s.proteinSum += +r.diet.p; if (+r.diet.p >= m.p * 0.9) s.proteinHit++; }
      }
      if (r.body && r.body.kg != null) { s.bodyDays++; s.kgSum += +r.body.kg; }
      if (r.daily && r.daily.sleepHrs != null) { s.sleepSum += +r.daily.sleepHrs; s.sleepN++; }
    }
    s.volume = Math.round(s.volume);
    s.avgKcal = s.dietDays ? Math.round(s.kcalSum / s.dietDays) : null;
    s.avgTarget = s.dietDays ? Math.round(s.targetSum / s.dietDays) : null;
    s.avgKg = s.bodyDays ? Math.round((s.kgSum / s.bodyDays) * 100) / 100 : null;
    s.avgSleep = s.sleepN ? Math.round((s.sleepSum / s.sleepN) * 10) / 10 : null;
    s.trainRate = s.plannedTrain ? Math.round((s.done / s.plannedTrain) * 100) : null;
    s.dietRate = s.dietDays ? Math.round((s.dietHit / s.dietDays) * 100) : null;
    return s;
  }

  /* ---------------- 周桶（体重 / 热量） ---------------- */
  /** 按锚点每 7 天切一桶，桶内的体重均值与缺口 */
  function weekBuckets(state, until) {
    var today = until || P.todayStr();
    var off = P.cycleIndex(today);
    if (off < 0) return [];
    var out = [];
    for (var k = 0; k * 7 <= off; k++) {
      var from = P.addDays(P.ANCHOR_D1, k * 7);
      var to = P.addDays(P.ANCHOR_D1, k * 7 + 6);
      var w = windowStats(state, from, to);
      out.push({
        week: k + 1, from: from, to: to,
        avgKg: w.avgKg, bodyDays: w.bodyDays,
        avgKcal: w.avgKcal, avgTarget: w.avgTarget, dietDays: w.dietDays,
        volume: w.volume, done: w.done, plannedTrain: w.plannedTrain,
        cardioMin: w.cardioMin, phase: P.phaseOf(k * 7).name
      });
    }
    // 相邻周均重差
    for (var i = 0; i < out.length; i++) {
      var prev = null;
      for (var j = i - 1; j >= 0; j--) { if (out[j].avgKg != null) { prev = out[j]; break; } }
      out[i].kgDelta = (out[i].avgKg != null && prev) ? Math.round((out[i].avgKg - prev.avgKg) * 100) / 100 : null;
      out[i].prevWeek = prev ? prev.week : null;
      out[i].incomplete = out[i].bodyDays < 4;
    }
    return out;
  }

  /* ---------------- 校准助手 ---------------- */
  /**
   * 按源文档的"每 2 周校准规则"给建议。
   * 只在有足够体重数据时才给，否则返回 insufficient。
   */
  function calibration(state, today) {
    var buckets = weekBuckets(state, today);
    var withData = [];
    for (var i = 0; i < buckets.length; i++) if (buckets[i].avgKg != null && buckets[i].bodyDays >= 3) withData.push(buckets[i]);
    if (withData.length < 2) {
      return { status: 'insufficient', text: '体重数据不足 2 周，先按 P0 适应期执行；轮班下 TDEE 估算误差大，以周均体重重新校准。' };
    }
    var last = withData[withData.length - 1];
    var prev = withData[withData.length - 2];
    var d1 = Math.round((last.avgKg - prev.avgKg) * 100) / 100;
    var d0 = prev.kgDelta;
    var rate = Math.abs(d1);

    var res = {
      status: 'ok', lastWeek: last.week, prevWeek: prev.week,
      delta: d1, prevDelta: d0, lastAvg: last.avgKg, prevAvg: prev.avgKg
    };
    if (d1 <= -1.0) {
      res.action = 'add_kcal'; res.text = '单周掉了 ' + rate.toFixed(2) + ' kg，掉太快：训练日加 150 kcal 碳水。';
    } else if (d1 <= -0.8) {
      res.action = 'add_kcal'; res.text = '周均降 ' + rate.toFixed(2) + ' kg，略快于目标区间上限 0.8：可加 150 kcal 碳水。';
    } else if (d1 <= -0.4) {
      res.action = 'hold'; res.text = '周均降 ' + rate.toFixed(2) + ' kg，落在 0.4-0.8 的目标区间内 → 不动。';
    } else if (d1 < 0) {
      res.action = 'cut_kcal'; res.text = '周均只降 ' + rate.toFixed(2) + ' kg，慢于 0.4 的目标：减 150 kcal（优先砍非训练日）或加 30 分钟有氧（二选一）。';
    } else {
      res.action = 'cut_kcal'; res.text = '周均体重没降反升 ' + Math.abs(d1).toFixed(2) + ' kg：减 150 kcal（优先砍非训练日），并检查是否执行偏差。';
    }
    if (d1 > -0.3 && d0 != null && d0 > -0.3) {
      res.action = 'cut_kcal';
      res.text = '连续 2 周降幅 < 0.3 kg → 减 150 kcal（优先砍非训练日）或加 30 分钟有氧（二选一）。';
    }
    return res;
  }

  /* ---------------- 训练：上次表现与渐进提示 ---------------- */
  function exerciseHistory(state, name, dates) {
    var list = dates || Object.keys(state.days);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i], r = state.days[d];
      if (!r || !r.workout || !r.workout.exercises) continue;
      var e = findEntry(r.workout, name);
      if (!e) continue;
      var logged = setCount(e) > 0;
      out.push({
        date: d, entry: e, sets: e.sets, logged: logged,
        vol: volume(e), top: entryE1rm(e), best: bestSet(e),
        status: r.workout.status
      });
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }
  function bestSet(entry) {
    var best = null;
    if (!entry || !entry.sets) return null;
    for (var i = 0; i < entry.sets.length; i++) {
      var s = entry.sets[i];
      if (s && s.w != null && s.r != null) {
        var x = e1rm(s.w, s.r);
        if (best == null || x > best.e1rm) best = { w: +s.w, r: +s.r, e1rm: x };
      }
    }
    return best;
  }
  /** 上一次（严格早于 date）有记录的该动作 */
  function lastPerformance(state, name, date) {
    var hist = exerciseHistory(state, name);
    var found = null;
    for (var i = 0; i < hist.length; i++) {
      if (hist[i].date < date && hist[i].logged) found = hist[i];
    }
    return found;
  }
  function isCompound(name) {
    return /卧推|硬拉|深蹲|保加利亚|划船|下拉|推肩|臂屈伸/.test(String(name || ''));
  }
  function repsUpper(reps) {
    var m = String(reps == null ? '' : reps).match(/(\d+)\s*[-~－]\s*(\d+)/);
    if (m) return +m[2];
    var m2 = String(reps == null ? '' : reps).match(/^(\d+)$/);
    return m2 ? +m2[1] : null;
  }
  function repsLower(reps) {
    var m = String(reps == null ? '' : reps).match(/(\d+)\s*[-~－]\s*(\d+)/);
    if (m) return +m[1];
    var m2 = String(reps == null ? '' : reps).match(/^(\d+)$/);
    return m2 ? +m2[1] : null;
  }
  /**
   * 双重渐进提示：所有组都到了次数上限 → 加重；有组低于下限 → 保重或降重。
   * 返回 null 表示数据不够。
   */
  function progressionHint(entry, last) {
    var n = setCount(entry);
    if (!n) return null;
    var up = repsUpper(entry.planned && entry.planned.reps);
    var low = repsLower(entry.planned && entry.planned.reps);
    var allTop = true, below = 0;
    for (var i = 0; i < entry.sets.length; i++) {
      var s = entry.sets[i];
      if (!s || s.w == null || s.r == null) continue;
      if (up != null && +s.r < up) allTop = false;
      if (low != null && +s.r < low) below++;
    }
    var compound = isCompound(entry.name);
    if (allTop && up != null) {
      return { kind: 'up', text: '全部组都到了 ' + up + ' 次上限 → 下次可加重 ' + (compound ? '2.5~5 kg' : '1~2.5 kg') };
    }
    if (below >= Math.ceil(n / 2)) {
      return { kind: 'down', text: '过半数组没到 ' + low + ' 次 → 重量偏大，下次降到能完成下限的重量' };
    }
    return { kind: 'hold', text: '保持当前重量，继续把每组次数推向上限' };
  }

  /* ---------------- 总览 ---------------- */
  function totals(state, today) {
    var t = today || P.todayStr();
    var from = P.ANCHOR_D1;
    // 有记录的最早日期比锚点还早时，从那天算起，避免漏掉早开的日子
    var dates = Object.keys(state.days).sort();
    if (dates.length && dates[0] < from) from = dates[0];
    return windowStats(state, from, t < from ? from : t);
  }

  /** 每 10 天轮回的小结（从锚点起，含未走完的当前轮回） */
  function cycleSummaries(state, today) {
    var off = P.cycleIndex(today);
    if (off < 0) return [];
    var out = [];
    for (var k = 0; k * 10 <= off; k++) {
      var from = P.addDays(P.ANCHOR_D1, k * 10);
      var to = P.addDays(P.ANCHOR_D1, k * 10 + 9);
      var w = windowStats(state, from, to);
      w.cycle = k + 1;
      w.partialCycle = P.dayNum(today) < P.dayNum(to);
      out.push(w);
    }
    return out;
  }

  /** 热量序列：每天一行，带目标 */
  function calorieSeries(state, from, to) {
    var dates = rangeDates(from, to), out = [];
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i], r = state.days[d] || {};
      out.push({ date: d, actual: (r.diet && r.diet.kcal != null) ? +r.diet.kcal : null, target: dayMeta(state, d).kcal });
    }
    return out;
  }

  /** 每次训练的总容量序列 */
  function volumeSeries(state) {
    var dates = Object.keys(state.days).sort(), out = [];
    for (var i = 0; i < dates.length; i++) {
      var r = state.days[dates[i]];
      if (r.workout && sessionSetCount(r.workout) > 0) {
        out.push({
          date: dates[i], volume: sessionVolume(r.workout), sets: sessionSetCount(r.workout),
          sessionKey: r.workout.sessionKey,
          name: (P.SESSIONS[r.workout.sessionKey] || {}).name || r.workout.sessionKey
        });
      }
    }
    return out;
  }

  /** 某动作的 e1RM 序列 */
  function liftSeries(state, name) {
    var hist = exerciseHistory(state, name), out = [];
    for (var i = 0; i < hist.length; i++) if (hist[i].logged && hist[i].top != null) out.push({ date: hist[i].date, e1rm: hist[i].top, vol: hist[i].vol });
    return out;
  }

  /** 出现过的所有动作名（按出现频次降序） */
  function exerciseNames(state) {
    var cnt = {}, dates = Object.keys(state.days), i, j;
    for (i = 0; i < dates.length; i++) {
      var r = state.days[dates[i]];
      if (!r.workout || !r.workout.exercises) continue;
      for (j = 0; j < r.workout.exercises.length; j++) {
        var nm = r.workout.exercises[j].name;
        if (setCount(r.workout.exercises[j]) > 0) cnt[nm] = (cnt[nm] || 0) + 1;
      }
    }
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
  }

  /** 全部有训练记录的动作的最佳组（PR 表） */
  function personalRecords(state) {
    var names = exerciseNames(state), out = [];
    for (var i = 0; i < names.length; i++) {
      var hist = exerciseHistory(state, names[i]);
      var best = null, at = null;
      for (var j = 0; j < hist.length; j++) {
        if (hist[j].best && (best == null || hist[j].best.e1rm > best.e1rm)) { best = hist[j].best; at = hist[j].date; }
      }
      if (best) out.push({ name: names[i], e1rm: best.e1rm, w: best.w, r: best.r, date: at });
    }
    out.sort(function (a, b) { return b.e1rm - a.e1rm; });
    return out;
  }

  return {
    volume: volume, sessionVolume: sessionVolume, setCount: setCount, sessionSetCount: sessionSetCount,
    e1rm: e1rm, entryE1rm: entryE1rm, findEntry: findEntry, bestSet: bestSet,
    rangeDates: rangeDates, cycleWindow: cycleWindow, dayMeta: dayMeta,
    streak: streak, trainingStreak: trainingStreak,
    windowStats: windowStats, totals: totals, cycleSummaries: cycleSummaries,
    weekBuckets: weekBuckets, calibration: calibration,
    exerciseHistory: exerciseHistory, lastPerformance: lastPerformance,
    progressionHint: progressionHint, repsUpper: repsUpper, repsLower: repsLower, isCompound: isCompound,
    calorieSeries: calorieSeries, volumeSeries: volumeSeries, liftSeries: liftSeries,
    exerciseNames: exerciseNames, personalRecords: personalRecords
  };
});
