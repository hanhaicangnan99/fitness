/*!
 * charts.js — 零依赖 SVG 图表
 *
 * 全部返回 SVG 字符串，由调用方塞进 innerHTML。
 * 固定 viewBox + width:100%;height:auto，所以在 360px 窄屏也不溢出。
 * 所有函数对空数据 / 全 null / 单点 / 值全相等 都要有确定行为，不能吐 NaN。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JS = root.JS || {};
  root.JS.Charts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var W = 340;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r1(v) { return Math.round(v * 10) / 10; }

  function niceScale(min, max, ticks) {
    ticks = ticks || 4;
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var raw = span / ticks;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var out = [];
    for (var v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : r2(v));
    return { min: lo, max: hi, step: step, ticks: out };
  }

  function emptyBox(text, h) {
    return '<div class="chart-empty">' + esc(text || '还没有数据') + '</div>';
  }

  /* ------------------------------------------------------------------
   * 折线图
   * opts = {
   *   h, xs:[number], series:[{name, color, values:[num|null], dash, dots, area}],
   *   target:{value, color, label}, yMin, yMax, yTicks, xTicks:[{x,label}],
   *   yFmt, unit, legend:true
   * }
   * ------------------------------------------------------------------ */
  function line(opts) {
    opts = opts || {};
    var h = opts.h || 142;
    var xs = opts.xs || [];
    var series = (opts.series || []).filter(function (s) { return s && s.values && s.values.length; });
    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (num(v) != null) all.push(v); }); });
    if (opts.target && num(opts.target.value) != null) all.push(opts.target.value);
    if (!all.length || !xs.length) return emptyBox(opts.emptyText, h);

    var pad = opts.pad || { l: 36, r: 10, t: 12, b: 22 };
    var yMin = num(opts.yMin), yMax = num(opts.yMax);
    var lo = yMin != null ? yMin : Math.min.apply(null, all);
    var hi = yMax != null ? yMax : Math.max.apply(null, all);
    if (yMin == null && yMax == null) {
      var padY = (hi - lo) * 0.12 || Math.max(0.5, Math.abs(hi) * 0.03);
      lo -= padY; hi += padY;
    }
    var sc = niceScale(lo, hi, opts.yTicks || 4);
    var iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
    var xMin = xs[0], xMax = xs[xs.length - 1];
    if (xMin === xMax) { xMin -= 1; xMax += 1; }

    function X(v) { return pad.l + (v - xMin) / (xMax - xMin) * iw; }
    function Y(v) { return pad.t + ih - (v - sc.min) / (sc.max - sc.min) * ih; }
    var fmt = opts.yFmt || function (v) { return String(r1(v)); };

    var g = [];
    // 网格 + y 轴刻度
    sc.ticks.forEach(function (t) {
      var y = r1(Y(t));
      g.push('<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y +
        '" stroke="#eef1f5" stroke-width="1"/>');
      g.push('<text x="' + (pad.l - 5) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" fill="#8494a8">' +
        esc(fmt(t)) + '</text>');
    });
    // x 轴刻度
    (opts.xTicks || []).forEach(function (t) {
      var x = r1(X(t.x));
      g.push('<line x1="' + x + '" y1="' + (pad.t + ih) + '" x2="' + x + '" y2="' + (pad.t + ih + 3) + '" stroke="#cfd8e3"/>');
      if (t.label) {
        g.push('<text x="' + x + '" y="' + (h - 6) + '" text-anchor="middle" font-size="9" fill="#8494a8">' +
          esc(t.label) + '</text>');
      }
    });
    // 目标线
    if (opts.target && num(opts.target.value) != null) {
      var ty = r1(Y(opts.target.value));
      g.push('<line x1="' + pad.l + '" y1="' + ty + '" x2="' + (W - pad.r) + '" y2="' + ty +
        '" stroke="' + (opts.target.color || '#e09b28') + '" stroke-width="1.2" stroke-dasharray="5 3"/>');
      if (opts.target.label) {
        g.push('<text x="' + (W - pad.r) + '" y="' + (ty - 4) + '" text-anchor="end" font-size="9" fill="' +
          (opts.target.color || '#e09b28') + '">' + esc(opts.target.label) + '</text>');
      }
    }
    // 各条线
    series.forEach(function (s) {
      var col = s.color || '#2f6fd0';
      var segs = [], cur = [], areaPts = [];
      for (var i = 0; i < s.values.length; i++) {
        var v = num(s.values[i]);
        if (v == null) { if (cur.length) { segs.push(cur); cur = []; } continue; }
        cur.push([r1(X(xs[i])), r1(Y(v))]);
      }
      if (cur.length) segs.push(cur);
      if (s.area && segs.length) {
        var big = segs.reduce(function (a, b) { return b.length > a.length ? b : a; }, []);
        if (big.length > 1) {
          var d = 'M' + big[0][0] + ',' + (pad.t + ih) +
            big.map(function (p) { return 'L' + p[0] + ',' + p[1]; }).join('') +
            'L' + big[big.length - 1][0] + ',' + (pad.t + ih) + 'Z';
          g.push('<path d="' + d + '" fill="' + col + '" fill-opacity="0.10" stroke="none"/>');
        }
      }
      segs.forEach(function (seg) {
        if (seg.length === 1) {
          g.push('<circle cx="' + seg[0][0] + '" cy="' + seg[0][1] + '" r="2.4" fill="' + col + '"/>');
        } else {
          g.push('<path d="M' + seg.map(function (p) { return p[0] + ',' + p[1]; }).join('L') +
            '" fill="none" stroke="' + col + '" stroke-width="' + (s.width || 2) + '"' +
            (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') +
            ' stroke-linejoin="round" stroke-linecap="round"/>');
        }
      });
      if (s.dots !== false) {
        segs.forEach(function (seg) {
          seg.forEach(function (p, idx) {
            // 点多的时候只画首尾和每第 n 个，避免糊成一团
            if (seg.length > 14 && idx !== 0 && idx !== seg.length - 1 && idx % 3 !== 0) return;
            g.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.9" fill="#fff" stroke="' + col + '" stroke-width="1.4"/>');
          });
        });
      }
    });

    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + h + '" role="img" preserveAspectRatio="xMidYMid meet">' +
      g.join('') + '</svg>';
    return svg + (opts.legend === false ? '' : legendOf(series, opts.unit));
  }

  function legendOf(series, unit) {
    var named = series.filter(function (s) { return s.name; });
    if (named.length < 2) return '';
    return '<div class="legend">' + named.map(function (s) {
      return '<span><i style="background:' + (s.color || '#2f6fd0') + '"></i>' + esc(s.name) +
        (unit ? '（' + esc(unit) + '）' : '') + '</span>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------
   * 柱状图（每日热量、每轮回有氧分钟、每次训练容量）
   * opts = { h, items:[{label, value, color, note}], target:{value,color,label},
   *          yFmt, unit, labelEvery }
   * ------------------------------------------------------------------ */
  function bars(opts) {
    opts = opts || {};
    var h = opts.h || 142;
    var items = (opts.items || []).filter(function (i) { return i; });
    var vals = items.map(function (i) { return num(i.value); }).filter(function (v) { return v != null; });
    if (!items.length || !vals.length) return emptyBox(opts.emptyText, h);

    var pad = { l: 36, r: 10, t: 12, b: 22 };
    var lo = 0, hi = Math.max.apply(null, vals);
    if (num(opts.target && opts.target.value) != null) hi = Math.max(hi, opts.target.value);
    if (opts.yMax != null) hi = Math.max(hi, opts.yMax);
    var sc = niceScale(lo, hi, opts.yTicks || 4);
    var iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
    function Y(v) { return pad.t + ih - (v - sc.min) / (sc.max - sc.min) * ih; }
    var fmt = opts.yFmt || function (v) { return String(r1(v)); };

    var step = iw / items.length;
    var bw = Math.max(2, Math.min(step - 2, 22));
    var g = [];
    sc.ticks.forEach(function (t) {
      var y = r1(Y(t));
      g.push('<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="#eef1f5"/>');
      g.push('<text x="' + (pad.l - 5) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" fill="#8494a8">' +
        esc(fmt(t)) + '</text>');
    });
    if (opts.target && num(opts.target.value) != null) {
      var ty = r1(Y(opts.target.value));
      g.push('<line x1="' + pad.l + '" y1="' + ty + '" x2="' + (W - pad.r) + '" y2="' + ty +
        '" stroke="' + (opts.target.color || '#e09b28') + '" stroke-width="1.2" stroke-dasharray="5 3"/>');
      if (opts.target.label) {
        g.push('<text x="' + (W - pad.r) + '" y="' + (ty - 4) + '" text-anchor="end" font-size="9" fill="' +
          (opts.target.color || '#e09b28') + '">' + esc(opts.target.label) + '</text>');
      }
    }
    var every = opts.labelEvery || Math.ceil(items.length / 7);
    items.forEach(function (it, i) {
      var v = num(it.value);
      var cx = r1(pad.l + step * i + step / 2);
      var label = null;
      if (v != null) {
        var y = Y(Math.max(v, 0));
        var bh = Math.max(1.5, pad.t + ih - y);
        g.push('<rect x="' + r1(cx - bw / 2) + '" y="' + r1(y) + '" width="' + r1(bw) + '" height="' + r1(bh) +
          '" rx="2" fill="' + (it.color || '#2f6fd0') + '"/>');
      } else {
        g.push('<rect x="' + r1(cx - bw / 2) + '" y="' + (pad.t + ih - 3) + '" width="' + r1(bw) +
          '" height="3" rx="1.5" fill="#e4e9f0"/>');
      }
      // 每天各自的目，用小横线标在柱子上（比一根全局虚线诚实：目标本来就是逐日变的）
      if (num(it.target) != null) {
        var ty2 = r1(Y(it.target));
        g.push('<line x1="' + r1(cx - bw / 2 - 1) + '" y1="' + ty2 + '" x2="' + r1(cx + bw / 2 + 1) + '" y2="' + ty2 +
          '" stroke="#1f3a5f" stroke-width="2" stroke-linecap="round"/>');
      }
      if (i % every === 0 || i === items.length - 1) {
        label = it.label;
        g.push('<text x="' + cx + '" y="' + (h - 6) + '" text-anchor="middle" font-size="9" fill="#8494a8">' +
          esc(label) + '</text>');
      }
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + h + '" role="img" preserveAspectRatio="xMidYMid meet">' +
      g.join('') + '</svg>' +
      (opts.unit ? '<div class="legend"><span>单位：' + esc(opts.unit) + '</span></div>' : '');
  }

  /* ------------------------------------------------------------------
   * 横向进度条（阶段进度、目标进度、部位分布）
   * rows = [{label, value, max, text, color}]
   * ------------------------------------------------------------------ */
  function hbars(rows, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r; });
    if (!rows.length) return emptyBox(opts.emptyText);
    return '<div>' + rows.map(function (r) {
      var max = num(r.max) || Math.max.apply(null, rows.map(function (x) { return num(x.value) || 0; })) || 1;
      var pct = Math.max(0, Math.min(100, (num(r.value) || 0) / max * 100));
      return '<div style="margin-top:8px">' +
        '<div class="row between" style="font-size:12.5px;margin-bottom:3px">' +
        '<span class="grow">' + esc(r.label) + '</span>' +
        '<span class="muted nowrap">' + esc(r.text != null ? r.text : (r.value + ' / ' + max)) + '</span></div>' +
        '<div style="height:7px;border-radius:4px;background:#eef1f5;overflow:hidden">' +
        '<i style="display:block;height:100%;width:' + r1(pct) + '%;background:' + (r.color || '#2f6fd0') + ';border-radius:4px"></i>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------
   * 环形进度（距离目标）
   * ------------------------------------------------------------------ */
  function ring(pct, opts) {
    opts = opts || {};
    var size = opts.size || 96, sw = opts.stroke || 9;
    var r = (size - sw) / 2, c = 2 * Math.PI * r;
    var p = Math.max(0, Math.min(1, num(pct) || 0));
    var col = opts.color || '#2f6fd0';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" style="width:' + size + 'px;height:' + size + 'px">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#eef1f5" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-dasharray="' + r1(c * p) + ' ' + r1(c) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="' + size / 2 + '" y="' + (size / 2 + 1) + '" text-anchor="middle" font-size="' + (opts.fontSize || 20) +
      '" font-weight="700" fill="#16202b">' + esc(opts.center != null ? opts.center : Math.round(p * 100) + '%') + '</text>' +
      (opts.sub ? '<text x="' + size / 2 + '" y="' + (size / 2 + 16) + '" text-anchor="middle" font-size="10" fill="#8494a8">' +
        esc(opts.sub) + '</text>' : '') +
      '</svg>';
  }

  return {
    W: W, line: line, bars: bars, hbars: hbars, ring: ring,
    emptyBox: emptyBox, niceScale: niceScale, esc: esc
  };
});
