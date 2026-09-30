/* 每周作业小管家 —— 纯前端应用（localStorage 持久化 + 可选云同步） */
(function () {
  'use strict';

  /* ==================== 常量 ==================== */
  var SUBJECTS = {
    '语文': { icon: '📖', color: '#f97316' },
    '数学': { icon: '🔢', color: '#3b82f6' },
    '英语': { icon: '🔤', color: '#8b5cf6' }
  };
  var SUBJECT_KEYS = ['语文', '数学', '英语'];
  var TYPES = [
    { k: '预习', i: '🔍' }, { k: '写', i: '✍️' }, { k: '读', i: '📚' },
    { k: '背', i: '🎤' }, { k: '说', i: '🗣️' }, { k: '听', i: '🎧' },
    { k: '准备', i: '🎒' }, { k: '复习', i: '🔁' }, { k: '其他', i: '📌' }
  ];
  // 旧类型 -> 新类型（"做" 合并进 "写"）
  var TYPE_MIGRATE = { '做': '写' };
  var TYPE_KEYS = TYPES.map(function (t) { return t.k; });
  function typeIcon(k) {
    var t = TYPES.filter(function (x) { return x.k === k; })[0];
    return t ? t.i : '📌';
  }
  // 智能识别：按优先级匹配关键词（顺序很重要，"听写" 要命中"写"而不是"听"）
  var TYPE_RULES = [
    ['预习', /预习/],
    ['背', /背诵|背熟|背课文|背古诗|背《|背出/],
    ['读', /朗读|诵读|读熟|读课文|\S读/],
    ['写', /听写|抄写|默写|写字|作文|练字|写/],
    ['准备', /自备|准备|购买|带上|带齐|带/],
    ['说', /复述|口头|说一说|讲述|说/],
    ['听', /听力|听录音|音频|听/],
    ['复习', /复习|回顾/]
  ];
  var SUBJECT_RULES = [
    ['数学', /数学|口算|计算|应用题|算式|竖式|单位换算/],
    ['英语', /英语|单词|字母|english|let's|unit/i]
  ];
  function guessType(text) {
    for (var i = 0; i < TYPE_RULES.length; i++) {
      if (TYPE_RULES[i][1].test(text)) return TYPE_RULES[i][0];
    }
    return '其他';
  }
  function guessSubject(text, fallback) {
    for (var i = 0; i < SUBJECT_RULES.length; i++) {
      if (SUBJECT_RULES[i][1].test(text)) return SUBJECT_RULES[i][0];
    }
    return fallback || '语文';
  }
  // "周一返校时上交" / "带回学校" / "交老师" → 需要上交
  function guessSubmit(text) { return /上交|交给|带回|提交|交老师|返校时交|要交/.test(text); }

  // 其他事项分类（除作业外：待办 / 课程 / 提醒 / 其他），与作业共用周/月/年视图
  var EVENT_META = {
    todo:     { icon: '📝', color: '#f59e0b', label: '待办' },
    course:   { icon: '📚', color: '#8b5cf6', label: '课程' },
    reminder: { icon: '⏰', color: '#ef4444', label: '提醒' },
    other:    { icon: '📌', color: '#64748b', label: '其他' }
  };
  var EVENT_CATS = ['todo', 'course', 'reminder', 'other'];
  function eventMeta(k) { return EVENT_META[k] || EVENT_META.other; }

  // 把一整段作业文字拆成多条
  function parseHomework(raw) {
    var text = String(raw || '').replace(/\r/g, '');
    if (!text.trim()) return [];
    var lines = text.split('\n');

    // 先看是否存在 "1." "2、" "①" "(1)" 这类编号
    var numbered = [];
    var buf = null;
    var numRe = /^\s*(?:[（(]?(\d{1,2})[)）]?\s*[.、．)）:：]|([①-⑳])\s*)/;
    lines.forEach(function (ln) {
      var m = ln.match(numRe);
      if (m) {
        if (buf) numbered.push(buf);
        buf = ln.replace(numRe, '').trim();
      } else if (buf != null) {
        // 续行：属于上一条（例如听写词语另起一行的情况）
        buf += (buf ? '\n' : '') + ln.trim();
      } else if (ln.trim()) {
        buf = ln.trim();
      }
    });
    if (buf) numbered.push(buf);

    var parts;
    if (numbered.length >= 2) {
      parts = numbered;
    } else {
      // 没有编号：按换行 / 中文分号 / 句号拆分
      parts = [];
      text.split(/[\n；;]/).forEach(function (s) {
        var t = s.trim().replace(/^[0-9]+\s*[.、．)）]\s*/, '');
        if (t) parts.push(t);
      });
      if (parts.length === 1) {
        // 只有一句：再按 "。" 拆，避免整段变成一条
        var byPeriod = parts[0].split('。').map(function (s) { return s.trim(); }).filter(Boolean);
        if (byPeriod.length > 1) parts = byPeriod.map(function (s, i) { return i === byPeriod.length - 1 ? s : s + '。'; });
      }
    }

    return parts
      .map(function (s) { return s.replace(/\s+$/, '').trim(); })
      .filter(function (s) { return s.length > 0; })
      .map(function (s) {
        return {
          content: s,
          type: guessType(s),
          subject: guessSubject(s, null),
          submit: guessSubmit(s)
        };
      });
  }
  var WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var STORE_KEY = 'homework-buddy.v1';

  /* ===== 内置云端配置（Supabase）=====
     预置好项目地址、anon key 和家庭码，打开就直接用云端数据，无需手动填写。
     在「设置 → 云端存储」里改过之后，就不会再被这里的默认值覆盖。 */
  var CLOUD_DEFAULTS = {
    syncType: 'supabase',
    sbUrl: 'https://wkjbojpazpqajiqmgonn.supabase.co',
    sbKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndramJvanBhenBxYWppcW1nb25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwOTUzNjgsImV4cCI6MjA3ODY3MTM2OH0.7syQZWKVkkI48v_bS2jQE9jzBqCfVnJmliHxDOwDnNw',
    syncApi: '',
    syncCode: 'Wangzhining0922',
    syncOn: true
  };
  // 内置配置版本号：以后要换云端项目时改上面的值并把这里 +1，老设备会自动升级
  var CFG_VERSION = 1;

  /* ==================== 日期工具 ==================== */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var w = (x.getDay() + 6) % 7;
    return addDays(x, -w);
  }
  function todayKey() { return toKey(new Date()); }
  function md(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  /* ==================== 存储层 ==================== */
  var store = {
    data: {
      items: [],
      settings: { syncType: 'supabase', sbUrl: '', sbKey: '', syncApi: '', syncCode: '', syncOn: false }
    },
    load: function () {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var p = JSON.parse(raw);
          this.data.items = Array.isArray(p.items) ? p.items : [];
          if (p.settings) {
            for (var k in p.settings) {
              if (Object.prototype.hasOwnProperty.call(p.settings, k)) this.data.settings[k] = p.settings[k];
            }
          }
          // 旧版本只有 syncApi / syncCode / syncOn，推断出存储方式
          if (!this.data.settings.syncType) {
            this.data.settings.syncType = (this.data.settings.syncApi || this.data.settings.syncOn) ? 'rest' : 'none';
          }
        }
      } catch (e) { console.warn('读取本地数据失败', e); }

      // 首次打开或老版本数据：套用内置云端配置（已手动改过设置的设备不受影响）
      if (this.data.settings.cfgVersion !== CFG_VERSION) {
        for (var key in CLOUD_DEFAULTS) {
          if (Object.prototype.hasOwnProperty.call(CLOUD_DEFAULTS, key)) {
            this.data.settings[key] = CLOUD_DEFAULTS[key];
          }
        }
        this.data.settings.cfgVersion = CFG_VERSION;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* 忽略 */ }
      }
    },
    save: function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); }
      catch (e) { toast('保存失败：浏览器存储空间不足'); }
    }
  };

  // 把历史数据里的旧作业类型迁移到新类型（例如 "做" -> "写"）
  function migrateTypes() {
    var changed = 0;
    var now = new Date().toISOString();
    store.data.items.forEach(function (it) {
      if (it && TYPE_MIGRATE[it.type]) {
        it.type = TYPE_MIGRATE[it.type];
        it.updatedAt = now;
        changed++;
      }
    });
    if (changed) store.save();
    return changed;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function alive() {
    return store.data.items.filter(function (it) { return !it.deleted; });
  }
  function findItem(id) {
    for (var i = 0; i < store.data.items.length; i++) {
      if (store.data.items[i].id === id) return store.data.items[i];
    }
    return null;
  }

  /* ==================== 视图状态 ==================== */
  var view = {
    monday: mondayOf(new Date()),
    cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // 月/年视图定位用
    period: 'week', // week | month | year
    subject: 'all',
    status: 'all',
    histRange: '4',
    histSubject: 'all',
    histStatus: 'all',
    editing: null,
    dayKey: null
  };

  /* ==================== DOM 快捷方式 ==================== */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // 把内容里的《课文名》渲染成高亮标签（用 DOM 拼接，不用 innerHTML，避免注入）
  function fillContent(node, text) {
    String(text).split(/(《[^》]*》)/g).forEach(function (p) {
      if (!p) return;
      if (p.charAt(0) === '《') node.appendChild(el('span', 'hl-book', p));
      else node.appendChild(document.createTextNode(p));
    });
  }

  // textarea 随内容自动增高（长作业不会被挤在小框里）
  function autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
  }

  // 截止日期快捷按钮 -> 日期字符串
  function quickDueKey(kind) {
    var t = new Date();
    var mon = mondayOf(t);
    if (kind === 'tomorrow') return toKey(addDays(t, 1));
    if (kind === 'fri') return toKey(addDays(mon, 4));
    if (kind === 'nextmon') return toKey(addDays(mon, 7));
    return toKey(t);
  }

  // 长内容展开 / 收起
  function toggleExpand(card) {
    var box = card.querySelector('.hw-content');
    var btn = card.querySelector('.hw-more');
    if (!box) return;
    var open = box.classList.toggle('is-open');
    if (btn) btn.textContent = open ? '收起 ▴' : '展开全部 ▾';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2200);
  }

  /* ==================== 渲染：本周看板 ==================== */
  function weekItems() {
    var list = alive().filter(function (it) {
      var d = parseKey(it.date);
      return toKey(mondayOf(d)) === toKey(view.monday);
    });
    if (view.subject !== 'all') {
      // 科目筛选只针对作业；选了具体科目时，其他事项一并隐藏，避免界面混乱
      list = list.filter(function (it) { return (it.kind && it.kind !== 'homework') ? false : it.subject === view.subject; });
    }
    if (view.status === 'done') list = list.filter(function (it) { return it.done; });
    if (view.status === 'todo') list = list.filter(function (it) { return !it.done; });
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    return list;
  }

  // 判断是否要把这条作业显示在某一列
  // 勾选「周末作业」后，在周六、周日两列都显示，避免只看一天而漏掉
  function matchDay(it, key, idx, mon) {
    if (it.weekend) {
      if (toKey(mondayOf(parseKey(it.date))) !== toKey(mon)) return false;
      return idx === 5 || idx === 6;
    }
    return it.date === key;
  }

  function renderWeek() {
    var mon = view.monday, sun = addDays(mon, 6);
    var isThis = toKey(mon) === toKey(mondayOf(new Date()));
    $('weekRange').textContent = md(mon) + ' — ' + md(sun);
    $('weekSub').textContent = (isThis ? '本周' : '') + (mon.getFullYear() + '年') + ' · 按周查看';

    var list = weekItems();
    var board = $('board');
    board.innerHTML = '';
    board.className = 'board week-list';

    if (!list.length) {
      board.appendChild(el('div', 'week-empty', '📭 这一周还没有作业，点下面的「＋ 添加本周作业」开始'));
    } else {
      list.forEach(function (it) { board.appendChild(cardNode(it)); });
    }

    var add = el('button', 'week-add', '＋ 添加作业 / 事项');
    add.setAttribute('data-add', 'week');
    board.appendChild(add);

    renderStats(list);
  }

  /* ==================== 渲染：月历 ==================== */
  function renderMonth() {
    var cur = view.cursor;
    var y = cur.getFullYear(), m = cur.getMonth();
    $('periodTitle').textContent = y + '年' + (m + 1) + '月';
    var first = new Date(y, m, 1);
    var startMon = mondayOf(first);
    var grid = $('monthGrid');
    grid.innerHTML = '';
    WEEKDAY.forEach(function (w) { grid.appendChild(el('div', 'mc-h', w)); });
    for (var i = 0; i < 42; i++) {
      var d = addDays(startMon, i);
      var key = toKey(d);
      var inMonth = d.getMonth() === m;
      var cell = el('div', 'mc-cell' + (inMonth ? '' : ' is-out'));
      cell.setAttribute('data-date', key);
      cell.appendChild(el('div', 'mc-num', String(d.getDate())));
      if (key === todayKey()) cell.classList.add('is-today');
      var dayItems = alive().filter(function (it) { return it.date === key; });
      if (dayItems.length) {
        var wrap = el('div', 'mc-items');
        dayItems.slice(0, 3).forEach(function (it) {
          var ic = it.kind && it.kind !== 'homework' ? eventMeta(it.category).icon : (SUBJECTS[it.subject] || { icon: '📌' }).icon;
          var label = it.kind && it.kind !== 'homework' ? (it.title || '').slice(0, 6) : (it.subject || '');
          wrap.appendChild(el('span', 'mc-chip' + (it.done ? ' is-done' : ''), ic + ' ' + label));
        });
        cell.appendChild(wrap);
        if (dayItems.length > 3) cell.appendChild(el('div', 'mc-more', '+' + (dayItems.length - 3)));
      }
      var add = el('button', 'mc-add', '＋');
      add.setAttribute('data-date', key);
      add.setAttribute('title', '在这一天添加');
      cell.appendChild(add);
      grid.appendChild(cell);
    }
  }

  /* ==================== 渲染：年历 ==================== */
  function renderYear() {
    var y = view.cursor.getFullYear();
    $('periodTitle').textContent = y + '年';
    var box = $('yearGrid');
    box.innerHTML = '';
    for (var m = 0; m < 12; m++) {
      var mini = el('div', 'ym-card');
      mini.setAttribute('data-month', String(m));
      mini.appendChild(el('div', 'ym-title', (m + 1) + '月'));
      var cal = el('div', 'ym-cal');
      var first = new Date(y, m, 1);
      var startMon = mondayOf(first);
      WEEKDAY.forEach(function (w) { cal.appendChild(el('span', 'ym-h', w.charAt(1))); });
      for (var i = 0; i < 42; i++) {
        var d = addDays(startMon, i);
        var key = toKey(d);
        var inM = d.getMonth() === m;
        var cnt = alive().filter(function (it) { return it.date === key; }).length;
        var c = el('span', 'ym-d' + (inM ? '' : ' is-out') + (cnt ? ' has' : ''));
        c.textContent = inM ? String(d.getDate()) : '';
        if (cnt) c.setAttribute('title', cnt + ' 项');
        if (key === todayKey()) c.classList.add('is-today');
        cal.appendChild(c);
      }
      mini.appendChild(cal);
      box.appendChild(mini);
    }
  }

  function cardNode(it) {
    var isEvent = !!(it.kind && it.kind !== 'homework');
    var accent = isEvent ? eventMeta(it.category) : (SUBJECTS[it.subject] || { icon: '📌', color: '#94a3b8' });
    var wrap = el('div', 'hw' + (it.done ? ' is-done' : '') + (isEvent ? ' is-event' : ''));
    wrap.style.borderLeftColor = accent.color;
    wrap.setAttribute('data-id', it.id);

    // 逾期：作业看截止日，事项看当天
    var isOverdue = isEvent
      ? (!it.done && it.date && it.date < todayKey())
      : (!it.done && it.due && it.due < todayKey());
    if (isOverdue) wrap.classList.add('is-overdue');

    var chk = el('button', 'hw-check' + (it.done ? ' is-on' : ''), it.done ? '✓' : '');
    chk.setAttribute('data-act', 'toggle');
    chk.setAttribute('aria-label', it.done ? '标记为未完成' : '标记为已完成');
    wrap.appendChild(chk);

    var main = el('div', 'hw-main');
    main.setAttribute('data-act', 'edit');
    var top = el('div', 'hw-top');
    var badge = el('span', 'hw-subject', accent.icon + ' ' + (isEvent ? eventMeta(it.category).label : it.subject));
    badge.style.background = accent.color;
    top.appendChild(badge);
    if (isEvent) {
      if (it.time) top.appendChild(el('span', 'hw-type', '🕒 ' + it.time));
    } else {
      top.appendChild(el('span', 'hw-type', typeIcon(it.type) + ' ' + it.type));
      if (it.submit) top.appendChild(el('span', 'hw-flag is-submit', '📤 需上交'));
      if (it.weekend) top.appendChild(el('span', 'hw-flag is-weekend', '🗓️ 周末'));
    }
    // 安排到周几的小标签（因为不再按天分列，这里标注一下）
    var dIdx = (parseKey(it.date).getDay() + 6) % 7;
    top.appendChild(el('span', 'hw-day', '📅 ' + (WEEKDAY[dIdx] || '')));
    main.appendChild(top);

    var ctext = isEvent ? (it.title || '（未命名事项）') : (it.content || '（无内容）');
    var cbox = el('div', 'hw-content');
    fillContent(cbox, ctext);
    var isLong = ctext.length > 60 || ctext.split('\n').length > 2;
    if (isLong) cbox.classList.add('is-clamped');
    main.appendChild(cbox);
    if (isLong) {
      var more = el('button', 'hw-more', '展开全部 ▾');
      more.setAttribute('data-act', 'expand');
      main.appendChild(more);
    }

    // 事件的备注作为次要说明
    if (isEvent && it.note) {
      var note = el('div', 'hw-note');
      fillContent(note, '📝 ' + it.note);
      main.appendChild(note);
    }

    if (it.attachments && it.attachments.length) {
      var gal = el('div', 'hw-attach');
      it.attachments.forEach(function (a, ai) {
        var im = el('img', 'hw-thumb');
        im.src = a.data;
        im.alt = a.name || '附件图片';
        im.setAttribute('data-act', 'attach');
        im.setAttribute('data-idx', ai);
        gal.appendChild(im);
      });
      main.appendChild(gal);
    }

    var meta = el('div', 'hw-meta');
    if (!isEvent) {
      if (it.due && it.due !== it.date) {
        var due = el('span', isOverdue ? 'overdue' : '', '截止 ' + md(parseKey(it.due)) + (isOverdue ? '（已逾期）' : ''));
        meta.appendChild(due);
      } else if (isOverdue) {
        meta.appendChild(el('span', 'overdue', '已逾期'));
      }
    } else if (isOverdue) {
      meta.appendChild(el('span', 'overdue', '已过期'));
    }
    if (it.done && it.doneAt) meta.appendChild(el('span', '', '完成于 ' + md(parseKey(it.doneAt.slice(0, 10)))));
    if (meta.childNodes.length) main.appendChild(meta);

    wrap.appendChild(main);

    var acts = el('div', 'hw-actions');
    var ed = el('button', 'mini-btn', '✏️');
    ed.setAttribute('data-act', 'edit');
    ed.title = '编辑';
    acts.appendChild(ed);
    wrap.appendChild(acts);

    return wrap;
  }

  function renderStats(list) {
    var total = list.length;
    var done = list.filter(function (it) { return it.done; }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    $('ringPct').textContent = pct + '%';
    $('statDone').textContent = done;
    $('statTotal').textContent = total;
    var C = 2 * Math.PI * 52;
    $('ringFg').style.strokeDashoffset = String(C * (1 - pct / 100));

    var box = $('subjectBars');
    box.innerHTML = '';
    SUBJECT_KEYS.forEach(function (s) {
      var arr = list.filter(function (it) { return it.subject === s; });
      var d = arr.filter(function (it) { return it.done; }).length;
      var p = arr.length ? Math.round(d / arr.length * 100) : 0;
      var row = el('div', 'sbar');
      row.appendChild(el('div', 'sbar-name', SUBJECTS[s].icon + ' ' + s));
      var track = el('div', 'sbar-track');
      var fill = el('div', 'sbar-fill');
      fill.style.width = p + '%';
      fill.style.background = SUBJECTS[s].color;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'sbar-num', d + '/' + arr.length));
      box.appendChild(row);
    });
  }

  /* ==================== 渲染：历史统计 ==================== */
  function renderHistory() {
    var all = alive();
    var filtered = all.filter(function (it) {
      if (view.histSubject !== 'all' && it.subject !== view.histSubject) return false;
      if (view.histStatus === 'done' && !it.done) return false;
      if (view.histStatus === 'todo' && it.done) return false;
      return true;
    });

    // 按周分组
    var map = {};
    filtered.forEach(function (it) {
      var k = toKey(mondayOf(parseKey(it.date)));
      if (!map[k]) map[k] = [];
      map[k].push(it);
    });
    var keys = Object.keys(map).sort().reverse();

    if (view.histRange !== 'all') {
      var n = parseInt(view.histRange, 10);
      keys = keys.slice(0, n);
    }

    var sumTotal = 0, sumDone = 0;
    keys.forEach(function (k) {
      sumTotal += map[k].length;
      sumDone += map[k].filter(function (it) { return it.done; }).length;
    });

    var sum = $('histSummary');
    sum.innerHTML = '';
    [
      { k: '统计周数', v: keys.length + ' 周', c: '#3b82f6' },
      { k: '作业总数', v: sumTotal + ' 项', c: '#64748b' },
      { k: '已完成', v: sumDone + ' 项', c: '#16a34a' },
      { k: '总完成率', v: (sumTotal ? Math.round(sumDone / sumTotal * 100) : 0) + '%', c: '#16a34a' }
    ].forEach(function (s) {
      var b = el('div', 'sum-box');
      b.appendChild(el('div', 'k', s.k));
      var v = el('div', 'v', s.v);
      v.style.color = s.c;
      b.appendChild(v);
      sum.appendChild(b);
    });

    var box = $('historyList');
    box.innerHTML = '';
    if (!keys.length) {
      box.appendChild(emptyNode('📭', '这个范围内还没有作业记录'));
      return;
    }

    keys.forEach(function (k) {
      var arr = map[k];
      var mon = parseKey(k), sun = addDays(mon, 6);
      var done = arr.filter(function (it) { return it.done; }).length;
      var pct = Math.round(done / arr.length * 100);

      var row = el('div', 'hist-item');
      row.setAttribute('data-week', k);

      var wl = el('div', 'hist-week');
      wl.appendChild(el('div', 't', md(mon) + ' — ' + md(sun)));
      var diff = Math.floor(daysBetween(mon, mondayOf(new Date())) / 7);
      wl.appendChild(el('div', 's', diff === 0 ? '本周' : (diff > 0 ? diff + ' 周前' : '未来第 ' + (-diff) + ' 周')));
      row.appendChild(wl);

      var bar = el('div', 'hist-bar');
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = pct + '%';
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(el('div', 'lbl', '已完成 ' + done + ' / ' + arr.length + ' 项'));
      row.appendChild(bar);

      row.appendChild(el('div', 'hist-pct', pct + '%'));

      var detail = el('div', 'hist-detail');
      SUBJECT_KEYS.forEach(function (s) {
        var n2 = arr.filter(function (it) { return it.subject === s; }).length;
        if (n2) detail.appendChild(el('span', '', SUBJECTS[s].icon + s + ' ' + n2 + ' 项　'));
      });
      row.appendChild(detail);

      box.appendChild(row);
    });
  }

  function emptyNode(emoji, text) {
    var d = el('div', 'empty');
    d.appendChild(el('span', 'emoji', emoji));
    d.appendChild(el('div', '', text));
    return d;
  }

  function renderAll() {
    renderPeriod();
    renderHistory();
    renderSettings();
  }

  // 根据当前选择的周期（周/月/年）渲染对应面板
  function renderPeriod() {
    if (view.period === 'month') renderMonth();
    else if (view.period === 'year') renderYear();
    else renderWeek();
  }

  function setPeriod(p) {
    view.period = p;
    Array.prototype.forEach.call(document.querySelectorAll('#periodSeg .seg-btn'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-period') === p);
    });
    $('periodNav').hidden = (p === 'week');
    $('panelWeek').hidden = (p !== 'week');
    $('panelMonth').hidden = (p !== 'month');
    $('panelYear').hidden = (p !== 'year');
    renderPeriod();
  }

  /* ==================== 增删改 ==================== */
  function saveItem(payload) {
    var now = new Date().toISOString();
    var kind = payload.kind === 'event' ? 'event' : 'homework';
    var it;
    if (payload.id) {
      it = findItem(payload.id);
      if (!it) return;
      it.kind = kind;
      it.date = payload.date;
      it.done = payload.done;
      it.doneAt = payload.done ? (it.doneAt || todayKey()) : null;
      it.attachments = payload.attachments || [];
      it.updatedAt = now;
      if (kind === 'homework') {
        it.subject = payload.subject;
        it.type = payload.type;
        it.content = payload.content;
        it.due = payload.due;
        it.submit = !!payload.submit;
        it.weekend = !!payload.weekend;
        it.category = undefined; it.title = undefined; it.time = undefined; it.note = undefined;
      } else {
        it.category = payload.category || 'other';
        it.title = payload.title;
        it.time = payload.time || '';
        it.note = payload.note || '';
        it.subject = undefined; it.type = undefined; it.content = undefined;
        it.due = undefined; it.submit = false; it.weekend = false;
      }
    } else {
      it = {
        id: uid(),
        kind: kind,
        date: payload.date,
        done: !!payload.done,
        doneAt: payload.done ? todayKey() : null,
        attachments: payload.attachments || [],
        createdAt: now,
        updatedAt: now,
        deleted: false
      };
      if (kind === 'homework') {
        it.subject = payload.subject;
        it.type = payload.type;
        it.content = payload.content;
        it.due = payload.due;
        it.submit = !!payload.submit;
        it.weekend = !!payload.weekend;
      } else {
        it.category = payload.category || 'other';
        it.title = payload.title;
        it.time = payload.time || '';
        it.note = payload.note || '';
      }
      store.data.items.push(it);
    }
    persist();
    toast(payload.id ? '已保存修改 ✏️' : (kind === 'homework' ? '作业已添加 ✅' : '事项已添加 ✅'));
  }

  function toggleItem(id) {
    var it = findItem(id);
    if (!it) return;
    it.done = !it.done;
    it.doneAt = it.done ? todayKey() : null;
    it.updatedAt = new Date().toISOString();
    persist();
    renderPeriod();
    toast(it.done ? '太棒了，完成一项！🎉' : '已改回未完成');
  }

  function deleteItem(id) {
    var it = findItem(id);
    if (!it) return;
    var name = it.kind && it.kind !== 'homework' ? (it.title || '这条事项') : (it.content || '这条作业');
    if (!confirm('确定要删除吗？\n\n「' + name.slice(0, 30) + '」')) return;
    it.deleted = true;
    it.updatedAt = new Date().toISOString();
    persist();
    toast('已删除');
  }

  /* ==================== 数据变更入口 ==================== */
  var syncTimer = null, autoTimer = null, syncing = false, pending = false, lastSyncAt = null;

  function persist() {
    store.save();
    renderPeriod();
    renderHistory();
    scheduleSync();
  }

  function scheduleSync() {
    var s = store.data.settings;
    if (!s.syncOn || !hasCloud()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { sync('both', true); }, 1200);
  }

  /* ==================== 云同步 ==================== */
  function apiBase() {
    var b = (store.data.settings.syncApi || '').trim();
    return b ? b.replace(/\/+$/, '') : '/api';
  }
  function syncUrl() {
    return apiBase() + '/state?code=' + encodeURIComponent(store.data.settings.syncCode || '');
  }
  function setSyncState(txt, ok) {
    var n = $('syncState');
    n.textContent = txt;
    n.style.color = ok === false ? '#ef4444' : (ok === true ? '#16a34a' : '#64748b');
  }
  function timeText() {
    var d = lastSyncAt || new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // 顶部横幅：告诉用户现在能不能跨设备看到同一份数据
  function updateBanner(text, kind) {
    var b = $('syncBanner');
    if (!text) { b.hidden = true; return; }
    b.hidden = false;
    b.className = 'banner ' + (kind || 'warn');
    $('syncBannerText').textContent = text;
  }

  function merge(remoteItems) {
    var local = store.data.items;
    var idx = {};
    local.forEach(function (it, i) { idx[it.id] = i; });
    var changed = 0;
    (remoteItems || []).forEach(function (r) {
      if (!r || !r.id) return;
      var i = idx[r.id];
      if (i == null) {
        local.push(r);
        idx[r.id] = local.length - 1;
        changed++;
      } else {
        var a = local[i].updatedAt || '';
        var b = r.updatedAt || '';
        if (b > a) { local[i] = r; changed++; }
      }
    });
    return changed;
  }

  function hasFetch() { return typeof window.fetch === 'function'; }

  function extend(a, b) {
    for (var k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; }
    return a;
  }

  // 是否已选择云端存储
  function hasCloud() {
    var s = store.data.settings;
    return !!s.syncType && s.syncType !== 'none' && !!s.syncCode;
  }
  // 云端配置是否填写完整
  function cloudReady() {
    var s = store.data.settings;
    if (s.syncType === 'supabase') return !!(s.sbUrl && s.sbKey && s.syncCode);
    if (s.syncType === 'rest') return !!s.syncCode;
    return false;
  }
  function sbBase() {
    return (store.data.settings.sbUrl || '').trim().replace(/\/+$/, '');
  }
  // 部署在 Netlify 上时，改走同域函数代理去连 Supabase：
  // 国内手机直连 supabase.co 常被墙 / 超时，而 Netlify 本身可达，由服务端转发即可绕开墙与跨域。
  // 本地或其他托管仍直连，保持原有行为。
  function sbProxyOn() {
    try {
      var h = (location.hostname || '');
      if (/netlify\.(app|com)$/.test(h)) return true;
    } catch (e) {}
    return !!(store.data.settings.useProxy);
  }
  function sbFetchUrl(path) {
    if (sbProxyOn()) {
      var base = (store.data.settings.sbUrl || CLOUD_DEFAULTS.sbUrl || '').trim().replace(/\/+$/, '');
      return '/.netlify/functions/sb-proxy?u=' + encodeURIComponent(base + path);
    }
    return sbBase() + path;
  }
  function sbHeaders() {
    var k = (store.data.settings.sbKey || '').trim();
    return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  // 从云端读取全部作业
  function cloudPull() {
    var s = store.data.settings;
    if (s.syncType === 'supabase') {
      var u = sbFetchUrl('/rest/v1/homework?code=eq.' + encodeURIComponent(s.syncCode) + '&select=items,updated_at');
      return fetch(u, { headers: sbHeaders(), cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (rows) {
          var row = rows && rows[0];
          return (row && Array.isArray(row.items)) ? row.items : [];
        });
    }
    return fetch(syncUrl(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (res) { return (res && Array.isArray(res.items)) ? res.items : []; });
  }

  // 写入云端（整份覆盖，调用方已保证先合并过）
  function cloudPush(items) {
    var s = store.data.settings;
    if (s.syncType === 'supabase') {
      return fetch(sbFetchUrl('/rest/v1/homework'), {
        method: 'POST',
        headers: extend(sbHeaders(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{ code: s.syncCode, items: items, updated_at: new Date().toISOString() }])
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return true;
      });
    }
    return fetch(apiBase() + '/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: s.syncCode, items: items })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function errText(e) {
    var msg = ((e && e.message) || '未知错误').trim();
    var t = store.data.settings.syncType;
    if (/401|403/.test(msg)) {
      return t === 'supabase' ? 'key 不对或没有权限（' + msg + '）：请检查 anon public key 是否复制完整' : '没有权限（' + msg + '）';
    }
    if (/404/.test(msg)) {
      return t === 'supabase' ? '找不到 homework 表（404）：请先在 SQL Editor 里执行建表语句' : '找不到同步接口（404）：请检查云端地址是否正确';
    }
    if (/400/.test(msg)) {
      return t === 'supabase' ? '请求被拒绝（400）：多半是没建 RLS 策略，请重跑建表 SQL 的 policy 部分' : '请求被拒绝（400）';
    }
    if (!/^HTTP/.test(msg)) return '网络不通或被浏览器拦截（跨域）：请确认地址可访问';
    return msg;
  }

  function pullRemote() {
    return cloudPull().then(function (items) {
      var n = merge(items);
      if (n) { store.save(); renderWeek(); renderHistory(); }
      return n;
    });
  }

  function pushRemote() {
    return cloudPush(store.data.items);
  }

  /**
   * 同步。关键点：上传前一定先拉取合并，
   * 否则电脑端的全量数据会把手机端还没上传的新作业覆盖掉。
   * mode: 'pull' 只拉 | 'push' 先拉后推 | 'both' 先拉后推
   */
  function sync(mode, silent) {
    var s = store.data.settings;
    if (!hasCloud()) {
      if (!silent) toast('请先在设置里选择云端存储方式，并填写家庭码');
      return Promise.resolve(0);
    }
    if (!cloudReady()) {
      var lack = (s.syncType === 'supabase' ? '项目地址 / anon key / 家庭码' : '家庭码');
      setSyncState('云端配置不完整：还缺 ' + lack, false);
      updateBanner('云端配置不完整，作业只保存在这台设备上。', 'error');
      if (!silent) toast('配置还没填完整：' + lack);
      return Promise.resolve(0);
    }
    if (!hasFetch()) {
      setSyncState('当前浏览器不支持联网同步', false);
      updateBanner('这个浏览器不支持自动同步，可用「导出备份 / 导入备份」搬家', 'error');
      return Promise.resolve(0);
    }
    if (syncing) { pending = true; return Promise.resolve(0); }

    syncing = true;
    if (!silent) setSyncState(mode === 'pull' ? '正在从云端拉取…' : '正在与云端同步…');

    var chain, pulled = 0;
    if (mode === 'pull') {
      chain = pullRemote();
    } else {
      chain = pullRemote()
        .then(function (n) { pulled = n; return pushRemote(); })
        .then(function () { return pulled; });
    }

    return chain.then(function (n) {
      syncing = false;
      lastSyncAt = new Date();
      var txt = '已连接云端 · 最后同步 ' + timeText() + (n ? '（本次更新 ' + n + ' 条）' : '');
      setSyncState(txt, true);
      updateBanner('');
      if (!silent) toast(mode === 'pull' ? '已从云端同步 ✅' : '已同步到云端 ☁️');
      if (pending) { pending = false; setTimeout(function () { sync('both', true); }, 300); }
      return n;
    }, function (e) {
      syncing = false;
      pending = false;
      var msg = errText(e);
      setSyncState('云端连接失败：' + msg, false);
      updateBanner('跨设备同步未生效：' + msg + '。现在的作业只保存在这台设备上。', 'error');
      if (!silent) toast('同步失败：' + msg);
      return 0;
    });
  }

  function startAutoSync() {
    clearInterval(autoTimer);
    var s = store.data.settings;
    if (!s.syncOn || !hasCloud()) return;
    autoTimer = setInterval(function () {
      if (!document.hidden) sync('both', true);
    }, 30000);
  }

  /* ==================== 设置 ==================== */
  function renderSettings() {
    var s = store.data.settings;
    var act = document.activeElement;
    if (act !== $('syncCode')) $('syncCode').value = s.syncCode || '';
    if (act !== $('syncApi')) $('syncApi').value = s.syncApi || '';
    if (act !== $('sbUrl')) $('sbUrl').value = s.sbUrl || '';
    if (act !== $('sbKey')) $('sbKey').value = s.sbKey || '';
    $('syncType').value = s.syncType || 'none';
    $('syncOn').checked = !!s.syncOn;
    applySyncUI();
  }

  // 按存储方式显示对应的配置项
  function applySyncUI() {
    var t = $('syncType').value;
    $('cfgSupabase').hidden = (t !== 'supabase');
    $('cfgRest').hidden = (t !== 'rest');
    $('cfgCode').hidden = (t === 'none');
    $('cfgCommon').hidden = (t === 'none');
    $('howtoSupabase').hidden = (t !== 'supabase');
    $('howtoRest').hidden = (t !== 'rest');
  }

  /* ==================== 批量粘贴 ==================== */
  var batch = { subject: '语文', rows: [] };

  function openBatch() {
    batch.subject = '语文';
    batch.rows = [];
    var d = todayKey();
    $('bDate').value = d;
    $('bDue').value = d;
    $('bWeekend').checked = false;
    $('bText').value = '';
    $('bPreview').innerHTML = '';
    $('bPreviewWrap').hidden = true;
    $('btnBatchSave').disabled = true;
    $('btnBatchSave').textContent = '确认添加';
    syncBatchSubjectUI();
    $('batchModal').classList.add('is-open');
    $('batchModal').setAttribute('aria-hidden', 'false');
  }
  function closeBatch() {
    $('batchModal').classList.remove('is-open');
    $('batchModal').setAttribute('aria-hidden', 'true');
  }
  function syncBatchSubjectUI() {
    Array.prototype.forEach.call($('batchSubject').children, function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-value') === batch.subject);
    });
  }

  function renderPreview() {
    var box = $('bPreview');
    box.innerHTML = '';
    // 先显示容器，否则 autoGrow 量到的 scrollHeight 是 0
    $('bPreviewWrap').hidden = batch.rows.length === 0;
    batch.rows.forEach(function (r, i) {
      var row = el('div', 'preview-row');

      var top = el('div', 'preview-top');
      top.appendChild(el('span', 'preview-no', '第 ' + (i + 1) + ' 条'));

      var selType = document.createElement('select');
      selType.className = 'mini-select';
      TYPES.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.k;
        o.textContent = t.i + ' ' + t.k;
        if (t.k === r.type) o.selected = true;
        selType.appendChild(o);
      });
      selType.addEventListener('change', function () { r.type = this.value; });
      top.appendChild(selType);

      var selSub = document.createElement('select');
      selSub.className = 'mini-select';
      SUBJECT_KEYS.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s;
        o.textContent = (SUBJECTS[s] || { icon: '📌' }).icon + ' ' + s;
        if (s === r.subject) o.selected = true;
        selSub.appendChild(o);
      });
      selSub.addEventListener('change', function () { r.subject = this.value; });
      top.appendChild(selSub);

      var del = el('button', 'mini-btn', '🗑️');
      del.title = '移除这一条';
      del.addEventListener('click', function () {
        batch.rows.splice(i, 1);
        renderPreview();
      });
      top.appendChild(del);
      row.appendChild(top);

      var ta = document.createElement('textarea');
      ta.className = 'preview-text';
      ta.rows = 2;
      ta.value = r.content;
      ta.addEventListener('input', function () { r.content = this.value; autoGrow(this); });
      row.appendChild(ta);

      var lab = el('label', 'switch small');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!r.submit;
      cb.addEventListener('change', function () { r.submit = this.checked; });
      var track = el('span', 'switch-track');
      track.appendChild(el('span', 'switch-dot'));
      lab.appendChild(cb);
      lab.appendChild(track);
      lab.appendChild(el('span', 'switch-text', '📤 需上交'));
      row.appendChild(lab);

      box.appendChild(row);
      autoGrow(ta);
    });

    var n = batch.rows.length;
    $('bPreviewWrap').hidden = n === 0;
    $('btnBatchSave').disabled = n === 0;
    $('btnBatchSave').textContent = n ? ('确认添加 ' + n + ' 条') : '确认添加';
  }

  function batchParse() {
    var rows = parseHomework($('bText').value);
    if (!rows.length) { toast('没有识别到作业内容，请先粘贴'); return; }
    batch.rows = rows.map(function (r) {
      return { content: r.content, type: r.type, subject: r.subject || batch.subject, submit: r.submit };
    });
    renderPreview();
    toast('识别到 ' + batch.rows.length + ' 条，可逐条修改后添加');
  }

  function batchSave() {
    var date = $('bDate').value || todayKey();
    var due = $('bDue').value || date;
    var weekend = $('bWeekend').checked;
    var n = 0;
    batch.rows.forEach(function (r) {
      if (!String(r.content || '').trim()) return;
      saveItem({
        subject: r.subject,
        type: r.type,
        content: r.content.trim(),
        date: date,
        due: due,
        done: false,
        submit: !!r.submit,
        weekend: weekend
      });
      n++;
    });
    if (!n) { toast('没有可添加的内容'); return; }
    closeBatch();
    toast('已添加 ' + n + ' 条作业 🎉');
  }

  /* ==================== 弹窗 ==================== */
  var draft = { kind: 'homework', subject: '语文', type: '写', category: 'todo', title: '', time: '', note: '', attachments: [] };

  function buildTypeChips() {
    var box = $('choiceType');
    box.innerHTML = '';
    TYPES.forEach(function (t) {
      var b = el('button', 'chip' + (draft.type === t.k ? ' is-on' : ''), t.i + ' ' + t.k);
      b.setAttribute('data-type', t.k);
      box.appendChild(b);
    });
  }
  function buildKindChips() {
    var box = $('choiceKind');
    if (!box) return;
    box.innerHTML = '';
    var opts = [{ kind: 'homework', cat: '', icon: '📖', label: '作业' }].concat(
      EVENT_CATS.map(function (c) { return { kind: 'event', cat: c, icon: eventMeta(c).icon, label: eventMeta(c).label }; })
    );
    opts.forEach(function (o) {
      var on = (draft.kind === o.kind) && (o.kind === 'event' ? draft.category === o.cat : true);
      var b = el('button', 'chip' + (on ? ' is-on' : ''), o.icon + ' ' + o.label);
      b.setAttribute('data-kind', o.kind);
      if (o.cat) b.setAttribute('data-cat', o.cat);
      box.appendChild(b);
    });
  }
  function syncSubjectUI() {
    Array.prototype.forEach.call($('choiceSubject').children, function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-value') === draft.subject);
    });
  }
  // 根据当前是作业还是事项，显隐对应字段
  function applyKindUI() {
    var isEvent = draft.kind === 'event';
    Array.prototype.forEach.call(document.querySelectorAll('.hw-only'), function (n) { n.hidden = isEvent; });
    Array.prototype.forEach.call(document.querySelectorAll('.ev-only'), function (n) { n.hidden = !isEvent; });
    buildKindChips();
  }

  function openModal(item, opts) {
    var dateKey = (typeof opts === 'string') ? opts : (opts && opts.date);
    var preKind = (typeof opts === 'object' && opts && opts.kind) ? opts.kind : null;
    var preCat = (typeof opts === 'object' && opts && opts.category) ? opts.category : null;
    view.editing = item || null;
    var isEvent = item ? (item.kind && item.kind !== 'homework') : (preKind === 'event');
    draft.kind = isEvent ? 'event' : 'homework';
    draft.category = isEvent ? (item ? (item.category || 'other') : (preCat || 'todo')) : 'todo';
    draft.subject = item && !isEvent ? item.subject : '语文';
    draft.type = item && !isEvent ? item.type : '写';
    draft.title = item && isEvent ? (item.title || '') : '';
    draft.time = item && isEvent ? (item.time || '') : '';
    draft.note = item && isEvent ? (item.note || '') : '';
    draft.attachments = (item && item.attachments) ? item.attachments.slice() : [];

    $('modalTitle').textContent = (item ? '编辑' : '添加') + (isEvent ? '事项' : '作业');
    $('btnDelete').hidden = !item;

    var dk = dateKey;
    if (dk === 'week') dk = (toKey(view.monday) <= todayKey() && todayKey() <= toKey(addDays(view.monday, 6))) ? todayKey() : toKey(view.monday);
    $('fDate').value = item ? item.date : (dk || todayKey());
    $('fContent').value = item && !isEvent ? (item.content || '') : '';
    $('fTitle').value = draft.title;
    $('fTime').value = draft.time;
    $('fNote').value = draft.note;
    $('fDue').value = item && !isEvent ? (item.due || $('fDate').value) : $('fDate').value;
    $('fDone').checked = item ? item.done : false;
    $('fSubmit').checked = item && !isEvent ? !!item.submit : false;
    $('fWeekend').checked = item && !isEvent ? !!item.weekend : false;

    renderAttachList();
    buildTypeChips();
    syncSubjectUI();
    applyKindUI();
    $('editModal').classList.add('is-open');
    $('editModal').setAttribute('aria-hidden', 'false');
    // 必须在弹窗显示后再测高，否则 scrollHeight 为 0
    autoGrow($('fContent'));
    autoGrow($('fNote'));
  }
  function closeModal() {
    $('editModal').classList.remove('is-open');
    $('editModal').setAttribute('aria-hidden', 'true');
    view.editing = null;
  }

  // 日详情：月历点某天后，列出当天所有作业与事项，并可快速添加
  function openDay(dateKey) {
    view.dayKey = dateKey;
    var d = parseKey(dateKey);
    $('dayTitle').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + (WEEKDAY[(d.getDay() + 6) % 7] || '');
    var list = $('dayList');
    list.innerHTML = '';
    var items = alive().filter(function (it) { return it.date === dateKey; });
    items.sort(function (a, b) { return (a.time || '').localeCompare(b.time || '') || ((a.createdAt || 0) - (b.createdAt || 0)); });
    if (!items.length) list.appendChild(emptyNode('🗓️', '这一天还没有安排'));
    else items.forEach(function (it) { list.appendChild(cardNode(it)); });
    $('dayModal').classList.add('is-open');
    $('dayModal').setAttribute('aria-hidden', 'false');
  }
  function closeDay() {
    $('dayModal').classList.remove('is-open');
    $('dayModal').setAttribute('aria-hidden', 'true');
    view.dayKey = null;
  }

  /* ==================== 附件（图片） ==================== */
  // 探测浏览器是否支持 canvas（jsdom 不支持时会跳过压缩，直接存原图）
  var CANVAS_OK = false;
  try { var _c = document.createElement('canvas'); CANVAS_OK = !!(_c.getContext && _c.getContext('2d')); } catch (e) {}

  // 把选中的图片文件转成（压缩后的）data URL，避免原图体积撑爆浏览器存储
  function fileToDataUrl(file, cb) {
    if (!window.FileReader) { cb(''); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      if (!CANVAS_OK) { cb(dataUrl); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1280, w = img.width, h = img.height;
          if (w > max || h > max) {
            if (w >= h) { h = Math.round(h * max / w); w = max; }
            else { w = Math.round(w * max / h); h = max; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(canvas.toDataURL('image/jpeg', 0.82));
        } catch (e) { cb(dataUrl); }
      };
      img.onerror = function () { cb(dataUrl); };
      img.src = dataUrl;
    };
    reader.onerror = function () { cb(''); };
    reader.readAsDataURL(file);
  }

  function renderAttachList() {
    var box = $('attachList');
    if (!box) return;
    box.innerHTML = '';
    draft.attachments.forEach(function (a, i) {
      var item = el('div', 'attach-item');
      var im = el('img', 'attach-thumb'); im.src = a.data; im.alt = a.name || '';
      item.appendChild(im);
      var del = el('button', 'attach-del', '✕');
      del.setAttribute('data-aidx', i);
      del.title = '删除这张图片';
      item.appendChild(del);
      box.appendChild(item);
    });
  }

  function openLightbox(it, idx) {
    var a = (it && it.attachments && it.attachments[idx]);
    if (!a) return;
    var lb = $('lightbox');
    lb.querySelector('img').src = a.data;
    lb.querySelector('.lightbox-name').textContent = a.name || '附件图片';
    lb.hidden = false;
  }
  function closeLightbox() { $('lightbox').hidden = true; }

  /* ==================== 事件绑定 ==================== */
  function bind() {
    // 视图切换
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.remove('is-active'); });
        t.classList.add('is-active');
        var v = t.getAttribute('data-view');
        Array.prototype.forEach.call(document.querySelectorAll('.view'), function (s) { s.classList.remove('is-active'); });
        $('view-' + v).classList.add('is-active');
        $('fab').style.display = (v === 'settings') ? 'none' : '';
      });
    });

    $('syncBannerBtn').addEventListener('click', function () {
      document.querySelector('.tab[data-view="settings"]').click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 周导航
    $('prevWeek').addEventListener('click', function () { view.monday = addDays(view.monday, -7); renderWeek(); });
    $('nextWeek').addEventListener('click', function () { view.monday = addDays(view.monday, 7); renderWeek(); });
    $('todayBtn').addEventListener('click', function () { view.monday = mondayOf(new Date()); renderWeek(); });

    // 周 / 月 / 年 切换
    Array.prototype.forEach.call(document.querySelectorAll('#periodSeg .seg-btn'), function (b) {
      b.addEventListener('click', function () { setPeriod(b.getAttribute('data-period')); });
    });
    $('periodPrev').addEventListener('click', function () {
      if (view.period === 'week') { view.monday = addDays(view.monday, -7); renderWeek(); }
      else if (view.period === 'month') { view.cursor = new Date(view.cursor.getFullYear(), view.cursor.getMonth() - 1, 1); renderMonth(); }
      else { view.cursor = new Date(view.cursor.getFullYear() - 1, 0, 1); renderYear(); }
    });
    $('periodNext').addEventListener('click', function () {
      if (view.period === 'week') { view.monday = addDays(view.monday, 7); renderWeek(); }
      else if (view.period === 'month') { view.cursor = new Date(view.cursor.getFullYear(), view.cursor.getMonth() + 1, 1); renderMonth(); }
      else { view.cursor = new Date(view.cursor.getFullYear() + 1, 0, 1); renderYear(); }
    });
    $('periodToday').addEventListener('click', function () {
      var t = new Date();
      if (view.period === 'week') { view.monday = mondayOf(t); renderWeek(); }
      else { view.cursor = new Date(t.getFullYear(), t.getMonth(), 1); renderPeriod(); }
    });

    // 月历：点某天看当天事项，点或格子里的 ＋ 在该天添加
    $('monthGrid').addEventListener('click', function (e) {
      var add = e.target.closest('.mc-add');
      if (add) { openModal(null, { date: add.getAttribute('data-date'), kind: 'event' }); return; }
      var cell = e.target.closest('.mc-cell');
      if (cell) openDay(cell.getAttribute('data-date'));
    });
    // 年历：点某个月进入月视图
    $('yearGrid').addEventListener('click', function (e) {
      var card = e.target.closest('.ym-card');
      if (!card) return;
      view.cursor = new Date(view.cursor.getFullYear(), parseInt(card.getAttribute('data-month'), 10), 1);
      setPeriod('month');
    });
    // 日详情弹窗
    $('dayModal').addEventListener('click', function (e) {
      if (e.target.closest('[data-dclose]')) { closeDay(); return; }
      var add = e.target.closest('[data-dayadd]');
      if (add) { closeDay(); openModal(null, { date: view.dayKey, kind: add.getAttribute('data-dayadd') }); return; }
    });
    $('dayList').addEventListener('click', function (e) {
      var card = e.target.closest('.hw');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var act = e.target.closest('[data-act]');
      var a = act ? act.getAttribute('data-act') : '';
      if (a === 'toggle') { closeDay(); toggleItem(id); return; }
      if (a === 'attach') { openLightbox(findItem(id), +e.target.getAttribute('data-idx')); return; }
      closeDay(); openModal(findItem(id));
    });

    // 本周筛选
    chipGroup('filterSubject', function (v) { view.subject = v; renderWeek(); });
    chipGroup('filterStatus', function (v) { view.status = v; renderWeek(); });
    chipGroup('histRange', function (v) { view.histRange = v; renderHistory(); });
    chipGroup('histSubject', function (v) { view.histSubject = v; renderHistory(); });
    chipGroup('histStatus', function (v) { view.histStatus = v; renderHistory(); });

    // 看板交互
    $('board').addEventListener('click', function (e) {
      var addBtn = e.target.closest('[data-add]');
      if (addBtn) { openModal(null, addBtn.getAttribute('data-add')); return; }
      var card = e.target.closest('.hw');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var act = e.target.closest('[data-act]');
      var a = act ? act.getAttribute('data-act') : '';
      if (a === 'toggle') toggleItem(id);
      else if (a === 'expand') toggleExpand(card);
      else if (a === 'attach') openLightbox(findItem(id), +e.target.getAttribute('data-idx'));
      else if (a === 'edit') openModal(findItem(id));
    });

    // 历史跳转
    $('historyList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-week]');
      if (!row) return;
      view.monday = parseKey(row.getAttribute('data-week'));
      renderWeek();
      document.querySelector('.tab[data-view="week"]').click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // FAB
    $('fab').addEventListener('click', function () { openModal(null); });

    // 附件：选择图片并压缩后加入草稿
    $('fAttach').addEventListener('change', function () {
      var files = this.files || [];
      if (!files.length) return;
      var pending = files.length;
      Array.prototype.forEach.call(files, function (f) {
        fileToDataUrl(f, function (url) {
          if (url) draft.attachments.push({ name: f.name || '图片', type: f.type || 'image', data: url });
          pending--;
          if (!pending) renderAttachList();
        });
      });
      this.value = '';
    });
    // 附件：删除某张
    $('attachList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-aidx]');
      if (!b) return;
      draft.attachments.splice(+b.getAttribute('data-aidx'), 1);
      renderAttachList();
    });
    // 灯箱关闭
    $('lightbox').addEventListener('click', function (e) {
      if (e.target.closest('.lightbox-close') || e.target === this) closeLightbox();
    });

    // 批量粘贴
    $('btnBatch').addEventListener('click', openBatch);
    $('batchModal').addEventListener('click', function (e) {
      if (e.target.closest('[data-bclose]')) closeBatch();
    });
    $('batchSubject').addEventListener('click', function (e) {
      var b = e.target.closest('[data-value]');
      if (!b) return;
      batch.subject = b.getAttribute('data-value');
      syncBatchSubjectUI();
    });
    $('btnParse').addEventListener('click', batchParse);
    $('btnBatchSave').addEventListener('click', batchSave);
    $('btnClearBatch').addEventListener('click', function () {
      $('bText').value = '';
      batch.rows = [];
      renderPreview();
      toast('已清空');
    });

    // 内容框随输入自动增高
    $('fContent').addEventListener('input', function () { autoGrow(this); });

    // 截止日期快捷按钮
    function bindQuickDue(boxId, inputId) {
      $(boxId).addEventListener('click', function (e) {
        var b = e.target.closest('[data-due]');
        if (!b) return;
        var v = quickDueKey(b.getAttribute('data-due'));
        $(inputId).value = v;
        toast('截止日期已设为 ' + md(parseKey(v)));
      });
    }
    bindQuickDue('quickDue', 'fDue');
    bindQuickDue('bQuickDue', 'bDue');

    // 弹窗
    $('editModal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });
    $('choiceSubject').addEventListener('click', function (e) {
      var b = e.target.closest('[data-value]');
      if (!b) return;
      draft.subject = b.getAttribute('data-value');
      syncSubjectUI();
    });
    $('choiceType').addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]');
      if (!b) return;
      draft.type = b.getAttribute('data-type');
      buildTypeChips();
    });
    $('choiceKind').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (!b) return;
      draft.kind = b.getAttribute('data-kind');
      if (draft.kind === 'event') draft.category = b.getAttribute('data-cat') || 'todo';
      applyKindUI();
    });
    $('btnSave').addEventListener('click', function () {
      var date = $('fDate').value || todayKey();
      var payload = {
        id: view.editing ? view.editing.id : null,
        kind: draft.kind,
        date: date,
        done: $('fDone').checked,
        attachments: draft.attachments
      };
      if (draft.kind === 'homework') {
        var content = $('fContent').value.trim();
        if (!content) { toast('请填写作业内容'); $('fContent').focus(); return; }
        payload.subject = draft.subject;
        payload.type = draft.type;
        payload.content = content;
        payload.due = $('fDue').value || date;
        payload.submit = $('fSubmit').checked;
        payload.weekend = $('fWeekend').checked;
      } else {
        var title = $('fTitle').value.trim();
        if (!title) { toast('请填写事项标题'); $('fTitle').focus(); return; }
        payload.category = draft.category;
        payload.title = title;
        payload.time = $('fTime').value || '';
        payload.note = $('fNote').value.trim();
      }
      saveItem(payload);
      closeModal();
    });
    $('btnDelete').addEventListener('click', function () {
      var it = view.editing;
      closeModal();
      if (it) deleteItem(it.id);
    });

    // 设置：云端存储
    $('syncType').addEventListener('change', function () {
      store.data.settings.syncType = this.value;
      store.save();
      applySyncUI();
      if (this.value === 'none') {
        clearInterval(autoTimer);
        store.data.settings.syncOn = false;
        $('syncOn').checked = false;
        store.save();
        setSyncState('已关闭云端存储，数据只存在这台设备');
        updateBanner('现在只保存在这台设备上，手机 / 平板看不到。开启云端存储即可共享。', 'warn');
      } else {
        setSyncState('配置已保存，点「测试连接」确认能否连通');
      }
    });
    $('sbUrl').addEventListener('input', function () {
      store.data.settings.sbUrl = this.value.trim(); store.save();
    });
    $('sbKey').addEventListener('input', function () {
      store.data.settings.sbKey = this.value.trim(); store.save();
    });
    $('syncCode').addEventListener('input', function () {
      store.data.settings.syncCode = this.value.trim(); store.save();
    });
    $('syncApi').addEventListener('input', function () {
      store.data.settings.syncApi = this.value.trim(); store.save();
    });
    $('btnCopySql').addEventListener('click', function () {
      var sql = $('sqlBlock').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sql).then(
          function () { toast('建表 SQL 已复制，去 Supabase 粘贴即可'); },
          function () { toast('复制失败，请手动选中复制'); }
        );
      } else {
        toast('请手动选中这段 SQL 复制');
      }
    });
    $('syncOn').addEventListener('change', function () {
      var on = this.checked;
      store.data.settings.syncOn = on;
      store.save();
      if (on) {
        if (!hasCloud() || !cloudReady()) {
          this.checked = false;
          store.data.settings.syncOn = false;
          store.save();
          toast('请先把云端配置和家庭码填完整');
          return;
        }
        sync('both', false);
        startAutoSync();
      } else {
        clearInterval(autoTimer);
        setSyncState('已关闭自动同步（本机数据仍保留，可随时手动同步）');
      }
    });
    $('btnPush').addEventListener('click', function () { sync('both', false); startAutoSync(); });
    $('btnPull').addEventListener('click', function () { sync('pull', false); });
    $('btnTest').addEventListener('click', function () { sync('pull', false); });

    document.addEventListener('visibilitychange', function () {
      var s = store.data.settings;
      if (!document.hidden && s.syncOn && hasCloud()) sync('both', true);
    });

    // 备份
    $('btnExport').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '作业备份-' + todayKey() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      toast('备份文件已下载');
    });
    $('btnImport').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var p = JSON.parse(fr.result);
          var items = Array.isArray(p) ? p : (p.items || []);
          if (!items.length) { toast('文件里没有作业数据'); return; }
          var n = merge(items);
          store.save(); renderWeek(); renderHistory();
          toast('导入成功，新增/更新 ' + n + ' 条');
          if (store.data.settings.syncCode) sync('both', true);
        } catch (err) { toast('文件格式不正确'); }
      };
      fr.readAsText(f);
      e.target.value = '';
    });

    $('btnClear').addEventListener('click', function () {
      if (!confirm('确定清空本机的全部作业记录吗？此操作不可恢复。')) return;
      store.data.items = [];
      store.save(); renderWeek(); renderHistory();
      toast('本机数据已清空');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal(); closeDay(); }
    });
  }

  function chipGroup(id, cb) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('is-on'); });
      b.classList.add('is-on');
      cb(b.getAttribute('data-value'));
    });
  }

  /* ==================== 启动 ==================== */
  function init() {
    store.load();
    migrateTypes();
    bind();
    setPeriod(view.period);
    renderAll();
    var s = store.data.settings;
    var cloudOn = s.syncType && s.syncType !== 'none' && s.syncCode;
    $('aboutText').textContent = cloudOn
      ? '数据已连接云端（' + (s.syncType === 'supabase' ? 'Supabase 云数据库' : '自建服务') + '），手机、平板、电脑填同一个家庭码即可看到同一份作业。当前共有 ' + alive().length + ' 条记录。'
      : '数据只保存在这台设备的浏览器里，刷新不会丢失；开启「跨设备同步」后，多设备共享同一份数据。当前共有 ' + alive().length + ' 条记录。';

    if (cloudOn) {
      setSyncState('正在连接云端…');
      sync('both', true);
      startAutoSync();
    } else {
      setSyncState('未开启同步：填好家庭码，手机和电脑就能看到同一份作业');
      updateBanner('现在只保存在这台设备上，手机 / 平板看不到。开启跨设备同步即可共享。', 'warn');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
