/* ============================================================
   数学教师成长工作台 · 共享脚本（零依赖）
   数据全部保存在浏览器 localStorage；不含任何远程上报。
   schema_version = 1（PRD 7.3 / 8.1）
   ============================================================ */
(function () {
  'use strict';

  var SCHEMA = 1;
  var LS_KEY = 'mtw_store_v1';
  var MAX_EVENTS = 500;

  var UNITS = {
    'concept-intro':    { no: 'U1', name: '概念引入',  topic: '函数单调性', version: 'v0.1.0' },
    'definition-proof': { no: 'U2', name: '定义与证明', topic: '函数单调性', version: 'v0.1.0' },
    'error-diagnosis':  { no: 'U3', name: '错误诊断',  topic: '函数单调性', version: 'v0.1.0' }
  };

  /* ---------- store ---------- */
  var store = null;
  var lastSaveFailed = false;

  function blankStore() {
    return { schema_version: SCHEMA, drafts: [], practice: {}, rubrics: {}, usage: {}, events: [] };
  }
  function loadStore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return blankStore();
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || d.schema_version !== SCHEMA) return blankStore();
      d.drafts = Array.isArray(d.drafts) ? d.drafts : [];
      d.practice = d.practice || {};
      d.rubrics = d.rubrics || {};
      d.usage = d.usage || {};
      d.events = Array.isArray(d.events) ? d.events : [];
      return d;
    } catch (e) { return blankStore(); }
  }
  function saveStore() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(store));
      lastSaveFailed = false;
      return true;
    } catch (e) {
      lastSaveFailed = true;
      return false;
    }
  }
  function logEvent(name, task) {
    var now = Date.now();
    if (name === 'draft_save') {
      for (var i = store.events.length - 1; i >= 0 && i > store.events.length - 8; i--) {
        if (store.events[i].e === 'draft_save' && now - new Date(store.events[i].at).getTime() < 30000) return;
      }
    }
    store.events.push({ e: name, t: task || '', at: new Date().toISOString() });
    if (store.events.length > MAX_EVENTS) store.events = store.events.slice(-MAX_EVENTS);
  }
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- helpers ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  var toastTimer = null;
  function toast(msg) {
    var el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2600);
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* ---------- 全局：nav / toast ---------- */
  function initNav() {
    var burger = $('.nav__burger'), menu = $('.nav__menu');
    if (burger && menu) {
      burger.addEventListener('click', function () {
        var open = menu.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    var nav = $('.nav');
    if (nav) {
      var onScroll = function () { nav.classList.toggle('is-scrolled', window.scrollY > 8); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  /* ---------- 练习状态机（F03） ----------
     状态：未回答 → 已回答 → 已查看参考 → 已修订
     原始回答保留在 attempts[0]；相同内容重复提交不产生新记录 */
  var STATE_TEXT = { unanswered: '未回答', answered: '已回答', viewed: '已查看参考', revised: '已修订' };

  function practiceKey(unit, qid) { return unit + '::' + qid; }
  function getPractice(unit, qid) {
    return store.practice[practiceKey(unit, qid)] || null;
  }
  function practiceStatus(rec) {
    if (!rec) return 'unanswered';
    var attempts = rec.attempts || [];
    if (!attempts.length) return 'unanswered';
    if (!rec.viewed_at) return 'answered';
    if (new Date(attempts[attempts.length - 1].at).getTime() > new Date(rec.viewed_at).getTime()) return 'revised';
    return 'viewed';
  }
  function refreshPracticeUI(box, rec) {
    var badge = $('[data-state-badge]', box);
    if (badge) {
      var st = practiceStatus(rec);
      badge.textContent = STATE_TEXT[st];
      badge.className = 'tag ' + ({
        unanswered: '', answered: 'tag--active', viewed: 'tag--draft', revised: 'tag--done'
      }[st] || '');
    }
    var submitBtn = $('[data-action="submit"]', box);
    if (submitBtn) submitBtn.textContent = (rec && rec.attempts && rec.attempts.length) ? '更新我的回答' : '提交回答';
    var saved = $('.practice__saved', box);
    if (saved) saved.textContent = rec && rec.updated_at ? '本机已保存 · ' + fmtTime(rec.updated_at) : '';
  }

  function initPractice() {
    $$('[data-practice]').forEach(function (box) {
      var unit = box.getAttribute('data-unit');
      var qid = box.getAttribute('data-qid');
      var rec = getPractice(unit, qid);
      var answerZone = $('.practice__answer', box);
      var reference = $('.reference', box);

      // 恢复已保存的最新回答
      if (rec && rec.attempts && rec.attempts.length && answerZone) {
        var last = rec.attempts[rec.attempts.length - 1].data || {};
        if (last.choice) {
          var radio = $('input[type="radio"][value="' + last.choice + '"]', box);
          if (radio) { radio.checked = true; radio.closest('label').classList.add('is-picked'); }
        }
        if (last.texts) {
          $$('textarea', answerZone).forEach(function (ta, i) { if (last.texts[i] != null) ta.value = last.texts[i]; });
        }
      }
      if (rec && rec.viewed_at && reference) reference.classList.remove('is-hidden');
      refreshPracticeUI(box, rec);

      // 选项高亮
      $$('.choice input[type="radio"]', box).forEach(function (r) {
        r.addEventListener('change', function () {
          $$('.choice label', box).forEach(function (l) { l.classList.remove('is-picked'); });
          r.closest('label').classList.add('is-picked');
        });
      });

      // 提交（重复点击 / 内容未变化时不产生重复记录）
      $('[data-action="submit"]', box) && $('[data-action="submit"]', box).addEventListener('click', function () {
        var choice = null;
        var picked = $('.choice input[type="radio"]:checked', box);
        if (picked) choice = picked.value;
        var texts = $$('textarea', answerZone || box).map(function (ta) { return ta.value.trim(); });
        var hasChoice = !!choice;
        var hasText = texts.some(function (t) { return t.length > 0; });
        if (!hasChoice && !hasText) {
          toast('请先作出选择或填写内容，空白不能提交。');
          return;
        }
        var now = new Date().toISOString();
        var data = { choice: choice, texts: texts };
        if (!rec) rec = { key: practiceKey(unit, qid), unit: unit, qid: qid, first: data, attempts: [], viewed_at: null, updated_at: now };
        var lastA = rec.attempts[rec.attempts.length - 1];
        if (lastA && JSON.stringify(lastA.data) === JSON.stringify(data)) {
          toast('回答内容未变化，未产生新的提交记录。');
          return;
        }
        rec.attempts.push({ data: data, at: now });
        rec.updated_at = now;
        store.practice[rec.key] = rec;
        logEvent('practice_submit', unit);
        if (saveStore()) {
          refreshPracticeUI(box, rec);
          toast('已保存本机记录（第 ' + rec.attempts.length + ' 次回答）。');
        } else {
          toast('保存失败：浏览器本地存储不可用，请先导出备份。');
        }
      });

      // 查看参考分析（不要求先答对）
      $('[data-action="view-ref"]', box) && $('[data-action="view-ref"]', box).addEventListener('click', function () {
        if (!reference) return;
        reference.classList.remove('is-hidden');
        if (!rec) rec = { key: practiceKey(unit, qid), unit: unit, qid: qid, first: null, attempts: [], viewed_at: null, updated_at: null };
        rec.viewed_at = new Date().toISOString();
        store.practice[rec.key] = rec;
        saveStore();
        refreshPracticeUI(box, rec);
        reference.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      // 修改回答
      $('[data-action="revise"]', box) && $('[data-action="revise"]', box).addEventListener('click', function () {
        var ta = $('textarea', answerZone || box);
        if (ta) { ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    });
  }

  /* ---------- 自查量规（任务级，非能力评分） ---------- */
  function initRubric() {
    $$('[data-rubric]').forEach(function (box) {
      var unit = box.getAttribute('data-rubric');
      var radios = $$('input[type="radio"]', box);
      var veto = $('input[type="checkbox"][data-role="veto"]', box);
      var out = $('.rubric-score b', box);
      var savedAt = $('.rubric-score', box);

      function read() {
        var groups = {};
        radios.forEach(function (r) { if (r.checked) groups[r.name] = parseInt(r.value, 10); });
        var names = [];
        radios.forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
        var scores = names.map(function (n) { return (typeof groups[n] === 'number') ? groups[n] : null; });
        return { scores: scores, veto: veto ? veto.checked : false };
      }
      function render() {
        var r = read();
        var done = r.scores.filter(function (s) { return s !== null; }).length;
        var total = r.scores.reduce(function (a, b) { return a + (b || 0); }, 0);
        if (out) {
          if (done < r.scores.length) {
            out.textContent = '已评 ' + done + '/' + r.scores.length + ' 项';
          } else {
            out.textContent = '自评合计 ' + total + '/' + (r.scores.length * 2) + (r.veto ? ' · 已标记数学表述待核' : '');
          }
        }
      }
      function persist() {
        var r = read();
        r.updated_at = new Date().toISOString();
        store.rubrics[unit] = r;
        saveStore();
        render();
      }
      var saved = store.rubrics[unit];
      if (saved) {
        var names = [];
        radios.forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
        (saved.scores || []).forEach(function (s, i) {
          if (s === null || s === undefined) return;
          var r = radios.filter(function (x) { return x.name === names[i] && parseInt(x.value, 10) === s; })[0];
          if (r) r.checked = true;
        });
        if (veto && saved.veto) veto.checked = true;
      }
      radios.concat(veto ? [veto] : []).forEach(function (el) { el.addEventListener('change', persist); });
      render();
    });
  }

  /* ---------- 工作台（F04/F05） ---------- */
  var ws = { draft: null, timer: null };

  function findDraft(id) { return store.drafts.filter(function (d) { return d.id === id; })[0] || null; }
  function draftComplete(d) {
    return !!(d.goal && d.goal.trim() &&
      d.chain && d.chain.length && d.chain.some(function (s) { return s.ask && s.ask.trim(); }) &&
      d.errors && d.errors.trim() && d.check && d.check.trim());
  }
  function unitLabel(id) { var u = UNITS[id]; return u ? (u.topic + ' · ' + u.name) : (id || '未关联单元'); }

  function renderSideList(activeId) {
    var list = $('#ws-list');
    if (!list) return;
    list.innerHTML = '';
    var drafts = store.drafts.slice().sort(function (a, b) { return b.updated_at < a.updated_at ? -1 : 1; });
    if (!drafts.length) {
      list.innerHTML = '<li style="font-size:12px;color:var(--lv-ink-3);padding:8px 10px;">暂无草稿，先选择单元新建。</li>';
      return;
    }
    drafts.forEach(function (d) {
      var li = document.createElement('li');
      var u = UNITS[d.unit_id];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'session' + (d.id === activeId ? ' is-active' : '');
      btn.innerHTML =
        '<span class="session__avatar ' + (d.id === activeId ? 'session__avatar--deep' : '') + '">' + esc((u ? u.no : '草')) + '</span>' +
        '<span class="session__meta"><span class="session__name">' + esc(d.title || '未命名片段') + '</span>' +
        '<span class="session__preview">v' + (d.revision || 1) + ' · ' + (draftComplete(d) ? '四项完整' : '未完成草稿') + '</span></span>' +
        '<span class="session__aside"><span class="session__time">' + fmtTime(d.updated_at).slice(5) + '</span>' +
        (findUsage(d.id) && findUsage(d.id).status === 'used' ? '<span class="badge-count">✓</span>' : '') + '</span>';
      btn.addEventListener('click', function () { persistDraft(); location.href = '?draft=' + encodeURIComponent(d.id); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function findUsage(draftId) { return store.usage[draftId] || null; }

  function chainRow(s) {
    s = s || { ask: '', expect: '', follow: '' };
    var div = document.createElement('div');
    div.className = 'chain-row';
    div.innerHTML =
      '<div class="cell"><span>提问</span><textarea data-role="ask" placeholder="例如：讨论 [0,2] 上的严格递增，需要比较哪两个点？"></textarea></div>' +
      '<div class="cell"><span>预期回应</span><textarea data-role="expect" placeholder="例如：任取 0 ≤ x₁ &lt; x₂ ≤ 2"></textarea></div>' +
      '<div class="cell"><span>必要追问</span><textarea data-role="follow" placeholder="例如：如果只比较 1 和 2 呢？"></textarea></div>' +
      '<button type="button" class="chain-row__del" title="删除这一步" aria-label="删除这一步">✕</button>';
    $('[data-role="ask"]', div).value = s.ask || '';
    $('[data-role="expect"]', div).value = s.expect || '';
    $('[data-role="follow"]', div).value = s.follow || '';
    $('.chain-row__del', div).addEventListener('click', function () {
      div.remove();
      scheduleSave();
      if (!$('#chain-editor .chain-row')) addChainRow();
    });
    return div;
  }
  function addChainRow(s) { $('#chain-editor').appendChild(chainRow(s)); }

  function collectDraft() {
    var d = ws.draft;
    if (!d) return;
    d.title = $('#f-title').value.trim() || '未命名片段';
    d.goal = $('#f-goal').value;
    d.errors = $('#f-errors').value;
    d.check = $('#f-check').value;
    d.conditions = $('#f-conditions').value;
    d.selfcheck = $('#f-selfcheck').checked;
    d.chain = $$('#chain-editor .chain-row').map(function (row) {
      return {
        ask: $('[data-role="ask"]', row).value,
        expect: $('[data-role="expect"]', row).value,
        follow: $('[data-role="follow"]', row).value
      };
    });
  }
  function fillEditor(d) {
    $('#f-title').value = d.title || '';
    $('#f-goal').value = d.goal || '';
    $('#f-errors').value = d.errors || '';
    $('#f-check').value = d.check || '';
    $('#f-conditions').value = d.conditions || '';
    $('#f-selfcheck').checked = !!d.selfcheck;
    var ed = $('#chain-editor');
    ed.innerHTML = '';
    (d.chain && d.chain.length ? d.chain : [null]).forEach(function (s) { addChainRow(s); });
    $('#ws-unit-label').textContent = unitLabel(d.unit_id) + ' · 内容版本 ' + (UNITS[d.unit_id] ? UNITS[d.unit_id].version : '—');
    $('#ws-draft-meta').textContent = '方案 v' + (d.revision || 1) + (d.parent ? ' · 由 v' + (d.revision - 1) + ' 复制' : '') + ' · 草稿号 ' + d.id;
  }

  function setSaveState(ok, timeText) {
    var el = $('#ws-savestate');
    if (!el) return;
    el.classList.toggle('is-error', !ok);
    el.innerHTML = ok
      ? '<span class="dot"></span>已保存' + (timeText ? ' · ' + timeText : '')
      : '<span class="dot"></span>保存失败：本地存储不可用，请立即导出备份';
  }

  function persistDraft(showToast) {
    if (!ws.draft) return true;
    collectDraft();
    ws.draft.updated_at = new Date().toISOString();
    var ok = saveStore();
    if (ok) {
      logEvent('draft_save', ws.draft.unit_id);
      saveStore();
      setSaveState(true, fmtTime(ws.draft.updated_at).slice(11));
      renderSideList(ws.draft.id);
      renderPreview();
    } else {
      setSaveState(false);
      if (showToast) toast('保存失败：请立即使用「导出备份」保存当前内容。');
    }
    return ok;
  }
  function scheduleSave() {
    clearTimeout(ws.timer);
    ws.timer = setTimeout(function () { persistDraft(true); }, 800);
  }

  function buildMarkdown(d) {
    var complete = draftComplete(d);
    var lines = [];
    lines.push('# 教学片段：' + (d.title || '未命名片段'));
    lines.push('');
    lines.push('- 任务单元：' + unitLabel(d.unit_id) + '（' + d.unit_id + '）');
    lines.push('- 内容版本：' + (UNITS[d.unit_id] ? UNITS[d.unit_id].version : '—') + '（草稿 · 未复核）');
    lines.push('- 方案版本：v' + (d.revision || 1) + ' · 更新于 ' + fmtTime(d.updated_at));
    lines.push('- 数学表述自查：' + (d.selfcheck ? '已确认（使用者自查，不改变公开内容审核状态）' : '未确认'));
    lines.push('- 完整度：' + (complete ? '四项核心字段完整' : '【未完成草稿】'));
    lines.push('');
    lines.push('## 一、可观察目标');
    lines.push(d.goal && d.goal.trim() ? d.goal.trim() : '（未填写）');
    lines.push('');
    lines.push('## 二、问题链');
    var steps = (d.chain || []).filter(function (s) { return s.ask && s.ask.trim(); });
    if (!steps.length) lines.push('（未填写）');
    steps.forEach(function (s, i) {
      lines.push((i + 1) + '. 提问：' + s.ask.trim());
      if (s.expect && s.expect.trim()) lines.push('   预期回应：' + s.expect.trim());
      if (s.follow && s.follow.trim()) lines.push('   必要追问：' + s.follow.trim());
    });
    lines.push('');
    lines.push('## 三、预期错误与回应');
    lines.push(d.errors && d.errors.trim() ? d.errors.trim() : '（未填写）');
    lines.push('');
    lines.push('## 四、理解检查');
    lines.push(d.check && d.check.trim() ? d.check.trim() : '（未填写）');
    lines.push('');
    if (d.conditions && d.conditions.trim()) {
      lines.push('## 五、教学条件（选填）');
      lines.push(d.conditions.trim());
      lines.push('');
    }
    lines.push('> 本文件为教师个人改编稿，由「数学教师成长工作台」导出；演示内容未经专业教师复核，公式与表述请自行核对后使用。');
    return lines.join('\n');
  }

  function renderPreview() {
    var panel = $('#preview-panel');
    if (!panel || !ws.draft) return;
    var d = ws.draft;
    var complete = draftComplete(d);
    var html = [];
    html.push('<h1>' + esc(d.title || '未命名片段') + (complete ? '' : '（未完成草稿）') + '</h1>');
    html.push('<div class="doc-meta">任务单元：' + esc(unitLabel(d.unit_id)) + ' · 内容版本 ' + (UNITS[d.unit_id] ? UNITS[d.unit_id].version : '—') + '（草稿·未复核）<br>' +
      '方案 v' + (d.revision || 1) + ' · 更新 ' + fmtTime(d.updated_at) + ' · 数学表述自查：' + (d.selfcheck ? '已确认' : '未确认') + '</div>');
    html.push('<h2>一、可观察目标</h2><p>' + (d.goal && d.goal.trim() ? esc(d.goal) : '（未填写）') + '</p>');
    html.push('<h2>二、问题链（约 10 分钟课堂活动）</h2><ol>');
    var steps = (d.chain || []).filter(function (s) { return s.ask && s.ask.trim(); });
    if (!steps.length) html.push('<li>（未填写）</li>');
    steps.forEach(function (s) {
      html.push('<li>提问：' + esc(s.ask));
      if (s.expect && s.expect.trim()) html.push('<br>预期回应：' + esc(s.expect));
      if (s.follow && s.follow.trim()) html.push('<br>必要追问：' + esc(s.follow));
      html.push('</li>');
    });
    html.push('</ol>');
    html.push('<h2>三、预期错误与回应</h2><p>' + (d.errors && d.errors.trim() ? esc(d.errors) : '（未填写）') + '</p>');
    html.push('<h2>四、理解检查</h2><p>' + (d.check && d.check.trim() ? esc(d.check) : '（未填写）') + '</p>');
    if (d.conditions && d.conditions.trim()) html.push('<h2>五、教学条件（选填）</h2><p>' + esc(d.conditions) + '</p>');
    html.push('<div class="doc-foot">本预览为教师个人改编稿 · 由数学教师成长工作台生成 · 演示内容未经专业教师复核，请在课堂使用前自行核对数学表述。<br>导出动作 ≠ 已实际用于课堂；使用情况请到「我的记录」如实登记。</div>');
    $('.preview-doc', panel).innerHTML = html.join('');
  }

  function initWorkspace() {
    var emptyBox = $('#ws-empty');
    var editorBox = $('#ws-editor');
    var params = new URLSearchParams(location.search);
    var draftId = params.get('draft');
    var newUnit = params.get('unit');

    if (draftId) {
      ws.draft = findDraft(draftId);
      if (!ws.draft) {
        toast('未找到该草稿编号，请从列表重新进入。');
      }
    } else if (newUnit && UNITS[newUnit]) {
      var u = UNITS[newUnit];
      ws.draft = {
        id: uid('d'), unit_id: newUnit, unit_version: u.version,
        title: u.name + ' · 课堂片段', revision: 1, parent: null,
        goal: '', chain: [null], errors: '', check: '', conditions: '', selfcheck: false,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      store.drafts.push(ws.draft);
      persistDraft();
      history.replaceState(null, '', '?draft=' + encodeURIComponent(ws.draft.id));
    }
    if (!ws.draft) {
      var latest = store.drafts.slice().sort(function (a, b) { return b.updated_at < a.updated_at ? -1 : 1; })[0];
      if (latest) ws.draft = latest; else if (draftId || newUnit) { /* keep empty */ }
    }

    if (ws.draft) {
      emptyBox.classList.add('is-hidden');
      editorBox.classList.remove('is-hidden');
      fillEditor(ws.draft);
      setSaveState(!lastSaveFailed, fmtTime(ws.draft.updated_at).slice(11));
      renderSideList(ws.draft.id);
      renderPreview();
    } else {
      editorBox.classList.add('is-hidden');
      emptyBox.classList.remove('is-hidden');
      renderSideList(null);
    }

    // 编辑 → 防抖自动保存；离开页面前尝试保存
    editorBox.addEventListener('input', scheduleSave);
    editorBox.addEventListener('change', scheduleSave);
    window.addEventListener('beforeunload', function () { if (ws.draft) persistDraft(); });

    $('#chain-add') && $('#chain-add').addEventListener('click', function () { addChainRow(); scheduleSave(); });
    $('#f-selfcheck') && $('#f-selfcheck').addEventListener('change', function () {
      if ($('#f-selfcheck').checked) toast('已记录：你自查过数学表述。这只是使用者自查，不改变公开内容的审核状态。');
    });

    // 预览 / 打印 / 导出
    $('#btn-preview') && $('#btn-preview').addEventListener('click', function () {
      persistDraft();
      var panel = $('#preview-panel');
      var showing = panel.classList.toggle('is-hidden');
      if (!showing) { renderPreview(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    $('#btn-print') && $('#btn-print').addEventListener('click', function () {
      persistDraft();
      renderPreview();
      $('#preview-panel').classList.remove('is-hidden');
      logEvent('export_create', ws.draft.unit_id);
      saveStore();
      toast('正在打开打印窗口（仅记录“发起打印”，无法确认是否保存成功）。');
      setTimeout(function () { window.print(); }, 350);
    });
    $('#btn-copy') && $('#btn-copy').addEventListener('click', function () {
      persistDraft();
      var md = buildMarkdown(ws.draft);
      var done = function () {
        logEvent('export_create', ws.draft.unit_id); saveStore();
        toast('已复制为纯文本。粘贴到 Word 后公式可能变化，请核对。');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(done, function () { fallbackCopy(md); done(); });
      } else { fallbackCopy(md); done(); }
    });
    $('#btn-md') && $('#btn-md').addEventListener('click', function () {
      persistDraft();
      var name = '教学片段-' + (ws.draft.title || '未命名').replace(/[\\/:*?"<>|]/g, '') + '-v' + ws.draft.revision + '.md';
      download(name, buildMarkdown(ws.draft), 'text/markdown;charset=utf-8');
      logEvent('export_create', ws.draft.unit_id); saveStore();
      toast('Markdown 文件已开始下载。');
    });
    $('#btn-json') && $('#btn-json').addEventListener('click', function () {
      persistDraft();
      var payload = { type: 'mtw-draft', schema_version: SCHEMA, exported_at: new Date().toISOString(), draft: ws.draft };
      download('工作台备份-' + (ws.draft.title || '草稿').replace(/[\\/:*?"<>|]/g, '') + '.json', JSON.stringify(payload, null, 2), 'application/json');
      logEvent('export_create', ws.draft.unit_id); saveStore();
      toast('已导出可恢复的 JSON 备份（含内容与方案版本）。');
    });
    $('#btn-fork') && $('#btn-fork').addEventListener('click', function () {
      persistDraft();
      var src = ws.draft;
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = uid('d');
      copy.parent = src.id;
      copy.revision = (src.revision || 1) + 1;
      copy.created_at = new Date().toISOString();
      copy.updated_at = new Date().toISOString();
      store.drafts.push(copy);
      saveStore();
      toast('已复制为新版本 v' + copy.revision + '，旧版本保留。');
      location.href = '?draft=' + encodeURIComponent(copy.id);
    });
    $('#btn-del') && $('#btn-del').addEventListener('click', function () {
      if (!confirm('删除这份草稿？已关联的课堂复盘快照会保留，但草稿本身不可恢复。')) return;
      store.drafts = store.drafts.filter(function (d) { return d.id !== ws.draft.id; });
      saveStore();
      toast('草稿已删除。');
      location.href = location.pathname;
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    ta.remove();
  }

  /* ---------- 我的记录（F06 + 备份恢复） ---------- */
  var USAGE_TEXT = { planned: '计划使用', used: '已实际使用', unused: '未使用' };

  function renderRecords() {
    var list = $('#records-list');
    if (!list) return;
    var drafts = store.drafts.slice().sort(function (a, b) { return b.updated_at < a.updated_at ? -1 : 1; });
    var emptyBox = $('#records-empty');
    if (!drafts.length) {
      list.innerHTML = '';
      emptyBox.classList.remove('is-hidden');
      renderPracticeHistory();
      renderEventsLine();
      return;
    }
    emptyBox.classList.add('is-hidden');
    list.innerHTML = '';
    drafts.forEach(function (d) {
      var u = UNITS[d.unit_id] || {};
      var usage = findUsage(d.id);
      var card = document.createElement('div');
      card.className = 'row-card';
      var usageTag = usage
        ? '<span class="tag ' + (usage.status === 'used' ? 'tag--done' : usage.status === 'planned' ? 'tag--active' : '') + '">' + USAGE_TEXT[usage.status] + '</span>'
        : '<span class="tag">未记录使用</span>';
      card.innerHTML =
        '<div class="row-card__head" role="button" tabindex="0" aria-expanded="false">' +
          '<span class="row-card__avatar">' + esc(u.no || '草') + '</span>' +
          '<span class="row-card__meta">' +
            '<span class="row-card__title">' + esc(d.title || '未命名片段') +
              '<span class="tag tag--plain">v' + (d.revision || 1) + '</span>' +
              (draftComplete(d) ? '<span class="tag tag--done tag--plain">四项完整</span>' : '<span class="tag tag--draft tag--plain">未完成草稿</span>') +
              usageTag +
            '</span>' +
            '<span class="row-card__sub">' + esc(unitLabel(d.unit_id)) + ' · 更新 ' + fmtTime(d.updated_at) + ' · 草稿号 ' + esc(d.id) + '</span>' +
          '</span>' +
          '<span class="row-card__chev">▾</span>' +
        '</div>' +
        '<div class="row-card__body is-hidden">' + bodyHTML(d, usage) + '</div>';
      var head = $('.row-card__head', card);
      var body = $('.row-card__body', card);
      var toggle = function () {
        var hidden = body.classList.toggle('is-hidden');
        head.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      wireBody(card, d);
      list.appendChild(card);
    });
    renderPracticeHistory();
    renderEventsLine();
  }

  function bodyHTML(d, usage) {
    var usage = usage || { status: '' };
    var h = '';
    h += '<div class="ws__bar no-print" style="position:static;margin-bottom:16px;">' +
      '<a class="btn btn--pill-sm" href="../workspace/?draft=' + encodeURIComponent(d.id) + '">继续编辑</a>' +
      '<button type="button" class="btn btn--ghost-sm" data-act="fork">复制为新版本</button>' +
      '<button type="button" class="btn btn--ghost-sm" data-act="md">导出 Markdown</button>' +
      '<button type="button" class="btn btn--quiet" data-act="del">删除草稿</button>' +
      '</div>';
    h += '<h3 style="font-size:14px;font-weight:600;margin-bottom:10px;">课堂使用与复盘</h3>';
    h += '<div class="usage-grid">' +
      '<div class="field" style="margin-bottom:0;"><label class="field__label">使用状态</label><select data-role="u-status">' +
        '<option value=""' + (!usage.status ? ' selected' : '') + '>请选择</option>' +
        '<option value="planned"' + (usage.status === 'planned' ? ' selected' : '') + '>计划使用（已排入备课/课堂）</option>' +
        '<option value="used"' + (usage.status === 'used' ? ' selected' : '') + '>已实际使用</option>' +
        '<option value="unused"' + (usage.status === 'unused' ? ' selected' : '') + '>未使用</option>' +
      '</select></div>' +
      '<div class="field" style="margin-bottom:0;' + (usage.status === 'used' ? '' : 'display:none;') + '" data-role="u-date-wrap">' +
      '<label class="field__label">课堂日期</label><input type="text" data-role="u-date" placeholder="如 2026-10-15（仅已实际使用时可填）" value="' + esc(usage.used_date || '') + '"></div>' +
      '</div>';
    h += '<div class="field" style="' + (usage.status === 'unused' ? '' : 'display:none;') + '" data-role="u-reason-wrap">' +
      '<label class="field__label">未使用的原因</label><input type="text" data-role="u-reason" placeholder="如：与课时进度不匹配 / 来不及 / 忘记使用" value="' + esc(usage.reason || '') + '"></div>';
    h += '<div data-role="u-reflect-wrap" style="' + (usage.status === 'used' ? '' : 'display:none;') + '">' +
      '<p class="field__hint">复盘三项：区分"现场观察到的"与"我的解释"；下一步只选一个改动。导出动作不会自动标记为已使用。</p>' +
      '<div class="reflect-grid">' +
        '<div class="field"><label class="field__label">观察到什么</label><textarea data-role="u-obs" placeholder="学生实际回应、卡住的位置……">' + esc(usage.observation || '') + '</textarea></div>' +
        '<div class="field"><label class="field__label">我的解释是什么</label><textarea data-role="u-int" placeholder="你认为原因是什么（解释 ≠ 观察）">' + esc(usage.interpretation || '') + '</textarea></div>' +
        '<div class="field"><label class="field__label">下次准备改什么</label><textarea data-role="u-next" placeholder="只写一个改动">' + esc(usage.next_change || '') + '</textarea></div>' +
      '</div></div>';
    h += '<div class="practice__actions"><button type="button" class="btn btn--pill-sm" data-act="usage-save">保存使用与复盘</button>' +
      '<span class="practice__saved">' + (usage.updated_at ? '本机已保存 · ' + fmtTime(usage.updated_at) + ' · 已绑定方案快照 v' + ((usage.snapshot && usage.snapshot.revision) || 1) : '') + '</span></div>';
    if (usage.reflections && usage.reflections.length > 1) {
      h += '<details style="margin-top:12px;"><summary style="font-size:13px;color:var(--lv-ink-2);cursor:pointer;">历史复盘（' + usage.reflections.length + ' 条，不会被后续编辑覆盖）</summary><div class="mini-list" style="margin-top:10px;">';
      usage.reflections.forEach(function (r) {
        h += '<p>· ' + fmtTime(r.at) + '：' + esc((r.observation || '').slice(0, 60)) + (r.observation && r.observation.length > 60 ? '…' : '') + '</p>';
      });
      h += '</div></details>';
    }
    return h;
  }

  function wireBody(card, d) {
    var body = $('.row-card__body', card);
    $$('[data-act]', body).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = btn.getAttribute('data-act');
        if (act === 'fork') {
          var copy = JSON.parse(JSON.stringify(d));
          copy.id = uid('d');
          copy.parent = d.id;
          copy.revision = (d.revision || 1) + 1;
          copy.created_at = new Date().toISOString();
          copy.updated_at = new Date().toISOString();
          store.drafts.push(copy);
          saveStore();
          toast('已复制为新版本 v' + copy.revision + '。');
          renderRecords();
        } else if (act === 'md') {
          var name = '教学片段-' + (d.title || '未命名').replace(/[\\/:*?"<>|]/g, '') + '-v' + d.revision + '.md';
          var tmp = ws.draft; ws.draft = d;
          download(name, buildMarkdown(d), 'text/markdown;charset=utf-8');
          ws.draft = tmp;
          logEvent('export_create', d.unit_id); saveStore();
          toast('Markdown 已开始下载（导出 ≠ 已实际使用）。');
        } else if (act === 'del') {
          if (!confirm('删除这份草稿？已关联的复盘快照会保留，草稿本身不可恢复。')) return;
          store.drafts = store.drafts.filter(function (x) { return x.id !== d.id; });
          saveStore();
          renderRecords();
        } else if (act === 'usage-save') {
          var status = $('[data-role="u-status"]', body).value;
          var usage = findUsage(d.id) || { draft_id: d.id, created_at: new Date().toISOString(), reflections: [] };
          var prev = { status: usage.status, observation: usage.observation, interpretation: usage.interpretation, next_change: usage.next_change, used_date: usage.used_date, reason: usage.reason };
          usage.status = status;
          usage.used_date = status === 'used' ? ($('[data-role="u-date"]', body) || {}).value || '' : '';
          usage.reason = status === 'unused' ? ($('[data-role="u-reason"]', body) || {}).value || '' : '';
          usage.observation = status === 'used' ? ($('[data-role="u-obs"]', body) || {}).value || '' : usage.observation;
          usage.interpretation = status === 'used' ? ($('[data-role="u-int"]', body) || {}).value || '' : usage.interpretation;
          usage.next_change = status === 'used' ? ($('[data-role="u-next"]', body) || {}).value || '' : usage.next_change;
          if (!status) { toast('请先选择使用状态。'); return; }
          if (status === 'used' && !usage.used_date.trim()) { toast('已实际使用需填写课堂日期。'); return; }
          if (!usage.snapshot) {
            var src = findDraft(d.id) || d;
            usage.snapshot = { revision: src.revision, title: src.title, goal: src.goal, chain: src.chain, errors: src.errors, check: src.check, conditions: src.conditions, snapshotted_at: new Date().toISOString() };
          }
          var changed = JSON.stringify(prev) !== JSON.stringify({ status: usage.status, observation: usage.observation, interpretation: usage.interpretation, next_change: usage.next_change, used_date: usage.used_date, reason: usage.reason });
          usage.updated_at = new Date().toISOString();
          if (status === 'used') {
            usage.reflections.push({ at: usage.updated_at, observation: usage.observation, interpretation: usage.interpretation, next_change: usage.next_change });
            logEvent('reflection_save', d.unit_id);
          }
          logEvent('usage_confirm', d.unit_id);
          store.usage[d.id] = usage;
          saveStore();
          toast(changed ? '使用与复盘已保存（本机）。' : '内容未变化，未产生重复记录。');
          renderRecords();
        }
      });
    });
    // 状态切换显示条件字段
    var statusSel = $('[data-role="u-status"]', body);
    statusSel && statusSel.addEventListener('change', function () {
      $('[data-role="u-date-wrap"]', body).style.display = statusSel.value === 'used' ? '' : 'none';
      $('[data-role="u-reason-wrap"]', body).style.display = statusSel.value === 'unused' ? '' : 'none';
      $('[data-role="u-reflect-wrap"]', body).style.display = statusSel.value === 'used' ? '' : 'none';
    });
  }

  function renderPracticeHistory() {
    var box = $('#practice-history');
    if (!box) return;
    var keys = Object.keys(store.practice);
    if (!keys.length) {
      box.innerHTML = '<p class="field__hint">还没有练习记录。进入任一训练单元并提交回答后，这里会显示状态与时间。</p>';
      return;
    }
    var byUnit = {};
    keys.forEach(function (k) {
      var r = store.practice[k];
      (byUnit[r.unit] = byUnit[r.unit] || []).push(r);
    });
    var html = '';
    Object.keys(byUnit).forEach(function (unit) {
      var u = UNITS[unit] || {};
      html += '<p style="font-size:13px;font-weight:600;margin:10px 0 6px;">' + esc(u.topic ? u.topic + ' · ' + u.name : unit) + '</p><ul class="mini-list">';
      byUnit[unit].sort(function (a, b) { return a.qid < b.qid ? -1 : 1; }).forEach(function (r) {
        html += '<li>练习 ' + esc(r.qid) + ' — ' + STATE_TEXT[practiceStatus(r)] + ' · ' + (r.updated_at ? fmtTime(r.updated_at) : '未提交') +
          ' · 回答 ' + (r.attempts ? r.attempts.length : 0) + ' 次</li>';
      });
      html += '</ul>';
    });
    box.innerHTML = html;
  }

  function renderEventsLine() {
    var box = $('#events-line');
    if (!box) return;
    box.textContent = '本机已匿名记录任务事件 ' + store.events.length + ' 条（仅事件名/任务编号/时间，不含任何自由文本）。';
  }

  function initRecords() {
    renderRecords();
    $('#btn-export-all') && $('#btn-export-all').addEventListener('click', function () {
      var payload = { type: 'mtw-backup', schema_version: SCHEMA, exported_at: new Date().toISOString(), data: store };
      download('工作台全部数据备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload, null, 2), 'application/json');
      toast('备份已开始下载。这不是云端同步，请妥善保管文件。');
    });
    $('#btn-export-events') && $('#btn-export-events').addEventListener('click', function () {
      download('匿名任务事件-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ type: 'mtw-events', schema_version: SCHEMA, events: store.events }, null, 2), 'application/json');
    });
    $('#btn-import') && $('#btn-import').addEventListener('click', function () {
      $('#file-import').click();
    });
    $('#file-import') && $('#file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('导入失败：文件超过 2MB，超出预设大小校验。'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var obj;
        try { obj = JSON.parse(reader.result); }
        catch (err) { toast('导入失败：不是有效的 JSON 文件，未导入任何内容。'); return; }
        if (!obj || (obj.schema_version !== SCHEMA) || (obj.type !== 'mtw-backup' && obj.type !== 'mtw-draft')) {
          toast('导入失败：格式或版本不匹配（需要本站导出的备份文件），未导入。');
          return;
        }
        var count = 0;
        function adopt(obj) {
          obj.id = uid('i');
          obj.created_at = obj.created_at || new Date().toISOString();
          obj.updated_at = new Date().toISOString();
          store.drafts.push(obj);
          count++;
        }
        if (obj.type === 'mtw-draft' && obj.draft && obj.draft.unit_id) {
          adopt(obj.draft);
        } else if (obj.type === 'mtw-backup' && obj.data && Array.isArray(obj.data.drafts)) {
          obj.data.drafts.forEach(function (dr) { if (dr && dr.unit_id) adopt(JSON.parse(JSON.stringify(dr))); });
        }
        if (!count) { toast('备份中没有可导入的草稿。'); return; }
        saveStore();
        renderRecords();
        toast('已按新本地编号导入 ' + count + ' 份草稿，未覆盖任何现有内容。');
      };
      reader.readAsText(f);
    });
    $('#btn-wipe') && $('#btn-wipe').addEventListener('click', function () {
      if (!confirm('将删除本浏览器中全部草稿、练习、复盘与事件记录，且无法恢复。确定继续？')) return;
      if (!confirm('再次确认：真的要清除全部本地记录吗？建议先「导出全部数据」。')) return;
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* 忽略 */ }
      store = loadStore();
      renderRecords();
      toast('本地记录已全部清除。');
    });
  }

  /* ---------- 首页样例 Shell（会话切换） ---------- */
  function initShellDemo() {
    var sessions = $$('#shell-sessions .session');
    if (!sessions.length) return;
    var chat = $('#shell-chat');
    var title = $('#shell-title');
    var templates = {};
    $$('#shell-templates > .shell-tpl').forEach(function (t) { templates[t.getAttribute('data-tpl')] = t.innerHTML; });
    function activate(btn) {
      sessions.forEach(function (s) { s.classList.remove('is-active'); });
      btn.classList.add('is-active');
      var key = btn.getAttribute('data-tpl');
      chat.innerHTML = templates[key] || '';
      var av = $('.session__avatar', btn);
      var nm = $('.session__name', btn);
      title.textContent = nm ? nm.textContent : '';
    }
    sessions.forEach(function (s) { s.addEventListener('click', function () { activate(s); }); });
    if (sessions[0]) activate(sessions[0]);
  }

  /* ---------- 纠错表单 ---------- */
  function initErrata() {
    var form = $('#errata-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var no = $('#errata-unit').value;
      var ver = $('#errata-version').value.trim() || 'v0.1.0';
      var desc = $('#errata-desc').value.trim();
      var loc = $('#errata-loc').value.trim();
      if (!desc) { toast('请先描述问题。'); return; }
      var text = '【纠错反馈】数学教师成长工作台\n内容编号：' + no + '\n内容版本：' + ver +
        '\n位置：' + (loc || '未指明') + '\n问题描述：' + desc + '\n提交时间：' + new Date().toISOString() + '\n';
      var out = $('#errata-output');
      out.textContent = text;
      out.classList.remove('is-hidden');
      download('纠错反馈-' + no + '-' + new Date().toISOString().slice(0, 10) + '.txt', text);
      toast('纠错文本已生成并下载；正式反馈渠道确定前请妥善保存。');
    });
    $('#errata-copy') && $('#errata-copy').addEventListener('click', function () {
      var out = $('#errata-output');
      if (out.classList.contains('is-hidden')) { toast('请先生成纠错文本。'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out.textContent).then(function () { toast('已复制。'); });
      else { fallbackCopy(out.textContent); toast('已复制。'); }
    });
  }

  /* ---------- 单元页：task_start ---------- */
  function initUnitPage() {
    var body = document.body;
    var unit = body.getAttribute('data-unit');
    if (unit && UNITS[unit]) {
      logEvent('task_start', unit);
      saveStore();
    }
  }

  /* ---------- boot ---------- */
  store = loadStore();
  initNav();
  var page = document.body.getAttribute('data-page');
  if (page === 'home') initShellDemo();
  if (page === 'workspace') initWorkspace();
  if (page === 'records') initRecords();
  if (page === 'about') initErrata();
  initPractice();
  initRubric();
  initUnitPage();
})();
