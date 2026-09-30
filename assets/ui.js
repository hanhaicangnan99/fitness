/*!
 * ui.js — DOM 小工具、弹层、Toast、格式化
 * 不引任何库；所有用户输入都过 esc() 再进 innerHTML。
 */
(function (root, factory) {
  var api = factory(root.JS && root.JS.Charts);
  root.JS = root.JS || {};
  root.JS.UI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Charts) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function frag(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content;
  }
  function node(html) {
    var f = frag(html);
    return f.firstElementChild;
  }

  /* ---------------- 格式化 ---------------- */
  function num(v, digits) {
    if (v == null || !isFinite(v)) return '—';
    var d = digits == null ? 1 : digits;
    var s = (+v).toFixed(d);
    if (d > 0) s = s.replace(/\.?0+$/, '');
    return s;
  }
  function int(v) { return (v == null || !isFinite(v)) ? '—' : String(Math.round(v)); }
  function signed(v, digits) {
    if (v == null || !isFinite(v)) return '—';
    var s = num(Math.abs(v), digits == null ? 2 : digits);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
  }
  function pct(v) { return (v == null || !isFinite(v)) ? '—' : Math.round(v * 100) + '%'; }
  function time2(mins) {
    if (mins == null) return '—';
    var m = Math.round(mins);
    if (m < 60) return m + ' 分钟';
    var hh = Math.floor(m / 60), mm = m % 60;
    return mm ? hh + ' 小时 ' + mm + ' 分' : hh + ' 小时';
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var old = $('.toast');
    if (old) old.remove();
    var n = node('<div class="toast">' + esc(msg) + '</div>');
    document.body.appendChild(n);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.remove(); }, ms || 2000);
  }

  /* ---------------- 底部弹层 ---------------- */
  var openSheets = [];
  /**
   * sheet({ title, sub, body, actions:[{label, cls, onClick(root)->bool|void, close}], onMount(root), wide })
   * onClick 返回 false 表示不关闭。
   */
  function sheet(opt) {
    opt = opt || {};
    var mask = node('<div class="mask"></div>');
    var actionsHtml = (opt.actions || []).map(function (a, i) {
      return '<button class="btn ' + (a.cls || '') + '" data-i="' + i + '">' + esc(a.label) + '</button>';
    }).join('');
    var sh = node(
      '<div class="sheet" role="dialog" aria-modal="true">' +
      '<div class="grip"></div>' +
      (opt.title ? '<h3>' + esc(opt.title) + '</h3>' : '') +
      (opt.sub ? '<div class="sub">' + esc(opt.sub) + '</div>' : '') +
      '<div class="sbody">' + (opt.body || '') + '</div>' +
      (actionsHtml ? '<div class="actions">' + actionsHtml + '</div>' : '') +
      '</div>');
    mask.appendChild(sh);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    $$('.actions .btn', sh).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = opt.actions[+b.dataset.i];
        var keep = a.onClick ? a.onClick(sh) : undefined;
        if (keep === false || a.close === false) return;
        close();
      });
    });

    var closed = false;
    // pushState 让安卓返回键能关弹层，而不是退出页面
    var pushed = false;
    try { history.pushState({ __sheet: true }, ''); pushed = true; } catch (e) {}
    function close(fromPop) {
      if (closed) return;
      closed = true;
      mask.remove();
      var i = openSheets.indexOf(close);
      if (i >= 0) openSheets.splice(i, 1);
      if (pushed && !fromPop) { try { history.back(); } catch (e) {} }
      if (opt.onClose) opt.onClose(fromPop);
    }
    openSheets.push(close);
    document.body.appendChild(mask);
    if (opt.onMount) opt.onMount(sh, close);
    return close;
  }
  function closeTop() { var f = openSheets[openSheets.length - 1]; if (f) { f(); return true; } return false; }
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', function () {
      var f = openSheets[openSheets.length - 1];
      if (f) f(true);
    });
  }

  function confirmSheet(opt) {
    return new Promise(function (resolve) {
      sheet({
        title: opt.title || '确认',
        sub: opt.text || '',
        body: opt.body || '',
        onClose: function () { resolve(false); },
        actions: [
          { label: opt.cancelLabel || '取消', onClick: function () { resolve(false); } },
          {
            label: opt.okLabel || '确定', cls: opt.danger ? 'bad' : 'primary',
            onClick: function () { resolve(true); }
          }
        ]
      });
    });
  }

  /** 让用户改一个数字/文本，返回 Promise<value|null> */
  function promptSheet(opt) {
    return new Promise(function (resolve) {
      var input = '<input type="' + (opt.type || 'text') + '" id="__p" ' +
        (opt.step ? 'step="' + opt.step + '" ' : '') +
        (opt.min != null ? 'min="' + opt.min + '" ' : '') +
        (opt.max != null ? 'max="' + opt.max + '" ' : '') +
        'placeholder="' + esc(opt.placeholder || '') + '" value="' + esc(opt.value == null ? '' : opt.value) + '">';
      var resolved = false;
      sheet({
        title: opt.title || '', sub: opt.sub || '',
        body: (opt.label ? '<div class="small muted mb6">' + esc(opt.label) + '</div>' : '') + input,
        onClose: function () { if (!resolved) resolve(null); },
        onMount: function (rootEl) {
          var el = $('#__p', rootEl);
          setTimeout(function () { el.focus(); if (el.select) el.select(); }, 60);
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { resolved = true; resolve(el.value); closeTop(); }
          });
        },
        actions: [
          { label: '取消', onClick: function () { if (!resolved) { resolved = true; resolve(null); } } },
          {
            label: '确定', cls: 'primary',
            onClick: function (rootEl) {
              var v = $('#__p', rootEl).value;
              if (!resolved) { resolved = true; resolve(v); }
            }
          }
        ]
      });
    });
  }

  /* ---------------- 常用片段 ---------------- */
  function card(title, bodyHtml, opt) {
    opt = opt || {};
    return '<div class="card' + (opt.tight ? ' tight' : '') + '">' +
      (title ? '<div class="card-h"><h2>' + esc(title) + '</h2>' +
        (opt.right || '') + '</div>' : '') + bodyHtml + '</div>';
  }
  function kvRows(rows) {
    return rows.filter(Boolean).map(function (r) {
      return '<div class="kv"><div class="k">' + esc(r[0]) + '</div><div class="v">' + r[1] + '</div></div>';
    }).join('');
  }
  function table(heads, rows, opt) {
    opt = opt || {};
    var cls = opt.cls || '';
    return '<div class="tbl-wrap"><table class="tbl ' + cls + '"><thead><tr>' +
      heads.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var rc = r.__cls || '';
        return '<tr class="' + rc + '">' + r.map(function (c) { return '<td>' + (c == null ? '' : c) + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }
  function statGrid(cells) {
    return '<div class="statgrid">' + cells.map(function (c) {
      return '<div><div class="lbl">' + esc(c.l) + '</div><div class="val">' + c.v +
        (c.u ? ' <small>' + esc(c.u) + '</small>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  function note(text, cls) { return '<div class="note ' + (cls || '') + '">' + text + '</div>'; }
  function emptyState(icon, text, sub) {
    return '<div class="empty"><span class="big">' + esc(icon || '—') + '</span>' +
      esc(text || '还没有数据') + (sub ? '<div class="small mt6">' + esc(sub) + '</div>' : '') + '</div>';
  }
  /** 分段控件：返回 HTML，绑事件用 bindSeg。opt.scroll=true 时横向可滑（标签多/长） */
  function seg(name, options, value, opt) {
    return '<div class="seg' + (opt && opt.scroll ? ' scroll' : '') + '" data-seg="' + esc(name) + '">' + options.map(function (o) {
      return '<button type="button" data-v="' + esc(o[0]) + '"' +
        (String(o[0]) === String(value) ? ' class="on"' : '') + '>' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function bindSeg(rootEl, name, onChange) {
    var box = rootEl.querySelector('[data-seg="' + name + '"]');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('button', box).forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      onChange(b.dataset.v);
    });
  }

  /** 数字输入的取值：空串 → null */
  function numVal(v) {
    if (v === '' || v == null) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /** 输入框绑定：input 事件防抖后回调 */
  function bindInputs(rootEl, handler, delay) {
    var t = null;
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.dataset || !el.dataset.bind) return;
      if (t) clearTimeout(t);
      t = setTimeout(function () { handler(el.dataset.bind, el.value, el); }, delay || 260);
    });
    rootEl.addEventListener('change', function (e) {
      var el = e.target;
      if (el.tagName === 'SELECT' && el.dataset.bind) handler(el.dataset.bind, el.value, el);
    });
  }

  /** 下载文本为文件 */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  /** 复制到剪贴板（带降级） */
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      ta.remove(); return ok;
    } catch (e) { return false; }
  }

  /** 读取用户选择的文件 */
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept || '.json,application/json';
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) { resolve(null); inp.remove(); return; }
        var fr = new FileReader();
        fr.onload = function () { resolve({ name: f.name, text: String(fr.result) }); inp.remove(); };
        fr.onerror = function () { resolve(null); inp.remove(); };
        fr.readAsText(f, 'utf-8');
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  return {
    esc: esc, $: $, $$: $$, frag: frag, node: node,
    num: num, int: int, signed: signed, pct: pct, time2: time2, numVal: numVal,
    toast: toast, sheet: sheet, closeTop: closeTop, confirmSheet: confirmSheet, promptSheet: promptSheet,
    card: card, kvRows: kvRows, table: table, statGrid: statGrid, note: note, emptyState: emptyState,
    seg: seg, bindSeg: bindSeg, bindInputs: bindInputs,
    download: download, copy: copy, pickFile: pickFile,
    charts: Charts
  };
});
