/* INTELLECT — единый пульт: лампа WLED, Samsung TV, ИИ-ассистент, дом, ПК.
   Без сборки и библиотек. Отдаётся самим ботом на :8090 — только в домашней сети. */
(() => {
  'use strict';

  // ------------------------------------------------------------ утилиты
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const haptic = (ms = 10) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
  let toastT;
  const toast = (text) => {
    const t = $('#toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  };
  const fmtMin = (sec) => sec > 0 ? `· ${Math.ceil(sec / 60)} мин` : '';
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} },
  };

  // ------------------------------------------------------------ API
  const API = {
    base: store.get('intellect_api') || '',
    token: store.get('intellect_token') || '',
    online: false,
    authRequired: true,
    version: '',
    async call(path, { method = 'GET', body, auth = true, timeout = 15000 } = {}) {
      if (!this.base) throw Object.assign(new Error('Адрес бота не задан'), { code: 'NOBASE' });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth && this.token) headers['X-Intellect-Token'] = this.token;
      let res;
      try {
        res = await fetch(this.base + path, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal, cache: 'no-store',
        });
      } catch (e) {
        throw Object.assign(new Error('Нет связи с ботом'), { code: 'NET' });
      } finally { clearTimeout(timer); }
      if (res.status === 401) throw Object.assign(new Error('Неверный пароль'), { code: 401 });
      if (res.status === 429) throw Object.assign(new Error('Слишком много попыток — подожди'), { code: 429 });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw Object.assign(new Error(data.error || `Ошибка ${res.status}`), { code: res.status, data });
      return data;
    },
    get: (p) => API.call(p),
    post: (p, body = {}) => API.call(p, { method: 'POST', body }),
    del: (p, body = {}) => API.call(p, { method: 'DELETE', body }),
    /** Проверить адрес: отвечает ли там INTELLECT. */
    async probe(base) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      try {
        const r = await fetch(base.replace(/\/+$/, '') + '/api/ping', { signal: ctl.signal, cache: 'no-store' });
        const j = await r.json();
        return (j && j.ok && j.app === 'INTELLECT') ? j : null;
      } catch (_) { return null; } finally { clearTimeout(t); }
    },
  };

  /** Найти адрес API: сохранённый → свой origin (сайт отдаёт сам бот) → спросить.
      С 2.4.0 — только домашняя сеть: никаких внешних источников адреса. */
  async function discoverBase() {
    const saved = store.get('intellect_api');
    if (saved) { API.base = saved.replace(/\/+$/, ''); return 'saved'; }
    if (/^https?:/.test(location.origin) && await API.probe(location.origin)) { API.base = location.origin; return 'origin'; }
    return null;
  }

  // ------------------------------------------------------------ состояние/навигация
  const TABS = [
    ['light', '💡', 'Свет'], ['tv', '📺', 'ТВ'], ['chat', '✨', 'Ассистент'],
    ['home', '🏠', 'Дом'], ['pc', '🖥', 'ПК'],
  ];
  const state = { tab: store.get('intellect_tab') || 'light', lamp: null, effects: [], palettes: [], tv: null, pending: false, lampPollT: null };

  function buildTabs() {
    for (const host of [$('#tabbar'), $('#sidebar')]) {
      host.innerHTML = '';
      for (const [id, ico, name] of TABS) {
        host.append(el('button', { class: 'tab', 'data-tab': id, onclick: () => showTab(id) },
          el('span', { class: 'ico' }, ico), el('span', {}, name)));
      }
    }
  }
  function showTab(id) {
    state.tab = id; store.set('intellect_tab', id);
    $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === id));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    $('#topTitle').textContent = (TABS.find(t => t[0] === id) || [])[2] || '';
    if (id === 'light') { loadLamp(); startLampPoll(); } else stopLampPoll();
    if (id === 'tv') loadTv();
    if (id === 'home') loadHome();
    if (id === 'pc') loadPc();
    if (id === 'chat') setTimeout(() => $('#chat').scrollTop = 1e9, 50);
  }

  function setOnline(ok) {
    API.online = ok;
    const d = $('#dot'); d.classList.toggle('online', ok); d.classList.toggle('offline', !ok);
    const b = $('#banner');
    if (!ok) { b.textContent = '⚠️ Нет связи с ботом. Проверь, что компьютер включён и START.bat запущен.'; b.classList.remove('hidden'); }
    else b.classList.add('hidden');
  }

  /** Общая обработка ошибок запросов. */
  function onError(e) {
    if (e.code === 401) { openSheet('Нужен пароль'); return; }
    if (e.code === 'NOBASE') { openSheet('Подключение'); return; }
    if (e.code === 'NET') { setOnline(false); return; }
    toast(e.message || 'Ошибка');
  }

  // ------------------------------------------------------------ СВЕТ
  const SWATCHES = [[255,255,255],[255,170,80],[255,0,0],[255,120,0],[255,220,0],[0,255,80],[0,200,255],[0,60,255],[150,0,255],[255,0,150]];
  const SCENES = [
    ['сон', '🌙'], ['ночник', '🕯'], ['вечер', '🌆'], ['чтение', '📖'], ['работа', '💼'],
    ['кино', '🎬'], ['романтика', '💞'], ['релакс', '🌊'], ['дискотека', '🪩'],
  ];
  let briDrag = false, sxDrag = false, ixDrag = false;

  function paintWheel() {
    const c = $('#wheel'), ctx = c.getContext('2d'), r = c.width / 2;
    for (let a = 0; a < 360; a++) {
      ctx.beginPath(); ctx.moveTo(r, r);
      ctx.arc(r, r, r, (a - 1) * Math.PI / 180, (a + 1) * Math.PI / 180);
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, '#fff'); g.addColorStop(1, `hsl(${a},100%,50%)`);
      ctx.fillStyle = g; ctx.fill();
    }
  }
  function wheelPick(ev) {
    const c = $('#wheel'), rect = c.getBoundingClientRect();
    const p = ev.touches ? ev.touches[0] : ev;
    const x = (p.clientX - rect.left) / rect.width * c.width, y = (p.clientY - rect.top) / rect.height * c.height;
    const d = c.getContext('2d').getImageData(Math.max(0, Math.min(c.width - 1, x | 0)), Math.max(0, Math.min(c.height - 1, y | 0)), 1, 1).data;
    if (d[3] === 0) return;
    setColor([d[0], d[1], d[2]]);
  }
  let colorT;
  function setColor(rgb) {
    $$('#swatches .swatch').forEach(s => s.classList.toggle('sel', s.dataset.rgb === rgb.join(',')));
    clearTimeout(colorT);
    colorT = setTimeout(() => lampRaw({ on: true, seg: [{ col: [rgb] }] }), 120);
  }
  function kelvinToRgb(k) {
    const t = k / 100; let r, g, b;
    r = t <= 66 ? 255 : Math.min(255, 329.7 * Math.pow(t - 60, -0.133));
    g = t <= 66 ? Math.min(255, 99.47 * Math.log(t) - 161.1) : Math.min(255, 288.1 * Math.pow(t - 60, -0.0755));
    b = t >= 66 ? 255 : (t <= 19 ? 0 : Math.min(255, 138.5 * Math.log(t - 10) - 305));
    return [r, g, b].map(v => Math.max(0, Math.round(v)));
  }

  async function lampRaw(payload) {
    haptic();
    try {
      const r = await API.post('/api/lamp/raw', payload);
      if (r && r.state) applyLampState(r.state, true);
    } catch (e) { onError(e); }
  }
  async function lampCmd(command) {
    haptic();
    try { await API.post('/api/devices/command', { device: 'lamp', command }); await loadLamp(); }
    catch (e) { onError(e); }
  }

  function applyLampState(st, partial) {
    if (!st) return;
    state.lamp = Object.assign(state.lamp || {}, st);
    const s = state.lamp;
    $('#lampPower').classList.toggle('on', !!s.on);
    $('#lampStatus').textContent = s.on ? 'включена' : 'выключена';
    const seg = (s.seg && s.seg[0]) || {};
    if (!briDrag && s.bri != null) { $('#bri').value = s.bri; $('#bri').style.setProperty('--fill', (s.bri / 255 * 100) + '%'); $('#briVal').textContent = Math.round(s.bri / 255 * 100) + '%'; }
    if (!sxDrag && seg.sx != null) { $('#sx').value = seg.sx; $('#sx').style.setProperty('--fill', (seg.sx / 255 * 100) + '%'); }
    if (!ixDrag && seg.ix != null) { $('#ix').value = seg.ix; $('#ix').style.setProperty('--fill', (seg.ix / 255 * 100) + '%'); }
    if (seg.col && seg.col[0]) {
      const key = seg.col[0].slice(0, 3).join(',');
      $$('#swatches .swatch').forEach(b => b.classList.toggle('sel', b.dataset.rgb === key));
    }
    if (seg.fx != null) $$('#effects .item').forEach(i => i.classList.toggle('sel', +i.dataset.fx === seg.fx));
  }

  function renderEffects(filter = '') {
    const host = $('#effects'); host.innerHTML = '';
    const q = filter.trim().toLowerCase();
    const cur = state.lamp && state.lamp.seg && state.lamp.seg[0] ? state.lamp.seg[0].fx : -1;
    let n = 0;
    state.effects.forEach((name, i) => {
      if (!name || name.startsWith('RSVD')) return;
      if (q && !name.toLowerCase().includes(q)) return;
      n++;
      host.append(el('button', { class: 'item' + (i === cur ? ' sel' : ''), 'data-fx': i, onclick: () => lampRaw({ on: true, seg: [{ fx: i }] }) },
        el('span', { class: 't' }, name), el('span', { class: 'muted small' }, '#' + i)));
    });
    if (!n) host.append(el('div', { class: 'empty' }, state.effects.length ? 'Ничего не найдено' : 'Список эффектов недоступен'));
  }

  async function loadLamp() {
    try {
      const r = await API.get('/api/lamp/state');
      setOnline(true);
      if (r.effects && r.effects.length && r.effects.length !== state.effects.length) { state.effects = r.effects; state.palettes = r.palettes || []; renderEffects($('#fxSearch').value); }
      if (!r.online) { $('#lampStatus').textContent = 'лампа не отвечает'; $('#lampPower').classList.remove('on'); return; }
      applyLampState(r.state);
      if (r.state && r.state.seg) renderEffectsSel();
    } catch (e) { if (e.code !== 'NET') onError(e); else setOnline(false); }
    loadTimers();
  }
  function renderEffectsSel() {
    const cur = state.lamp.seg[0].fx;
    $$('#effects .item').forEach(i => i.classList.toggle('sel', +i.dataset.fx === cur));
  }
  function startLampPoll() { stopLampPoll(); state.lampPollT = setInterval(() => { if (!document.hidden) loadLamp(); }, 3000); }
  function stopLampPoll() { clearInterval(state.lampPollT); state.lampPollT = null; }

  // таймеры лампы/ТВ
  const TIMER_MIN = [15, 30, 60, 120, 0];
  async function loadTimers() {
    try {
      const t = await API.get('/api/timer');
      $('#lampTimer').textContent = fmtMin(t.lamp); $('#tvTimer').textContent = fmtMin(t.tv);
    } catch (_) {}
  }
  function buildTimerBtns(hostId, kind) {
    const host = $(hostId); host.innerHTML = '';
    for (const m of TIMER_MIN) host.append(el('button', { class: 'btn sm', onclick: async () => {
      haptic();
      try { const t = await API.post('/api/timer', { kind, minutes: m }); $('#lampTimer').textContent = fmtMin(t.lamp); $('#tvTimer').textContent = fmtMin(t.tv); toast(m ? `Выключу через ${m} мин` : 'Таймер снят'); }
      catch (e) { onError(e); }
    } }, m ? `${m}м` : 'выкл'));
  }

  function initLight() {
    paintWheel();
    const w = $('#wheel');
    w.addEventListener('pointerdown', (e) => { w.setPointerCapture(e.pointerId); wheelPick(e); });
    w.addEventListener('pointermove', (e) => { if (e.buttons) wheelPick(e); });
    const sw = $('#swatches');
    for (const rgb of SWATCHES) sw.append(el('button', { class: 'swatch', 'data-rgb': rgb.join(','), style: `background: rgb(${rgb.join(',')})`, 'aria-label': 'цвет', onclick: () => setColor(rgb) }));
    const sc = $('#scenes');
    for (const [name, ico] of SCENES) sc.append(el('button', { class: 'scene', 'data-scene': name, onclick: () => { $$('#scenes .scene').forEach(s => s.classList.toggle('sel', s.dataset.scene === name)); lampCmd({ action: 'scene', name }); } },
      el('span', { class: 'ico' }, ico), el('span', {}, name)));
    $('#lampPower').addEventListener('click', () => lampRaw({ on: 't' }));
    const slider = (id, flag, build) => {
      const s = $(id); let t;
      const fill = () => s.style.setProperty('--fill', ((s.value - s.min) / (s.max - s.min) * 100) + '%');
      s.addEventListener('input', () => { flag(true); fill(); if (id === '#bri') $('#briVal').textContent = Math.round(s.value / 255 * 100) + '%'; clearTimeout(t); t = setTimeout(() => lampRaw(build(+s.value)), 150); });
      s.addEventListener('change', () => { flag(false); });
      fill();
    };
    slider('#bri', v => briDrag = v, (v) => ({ on: true, bri: v }));
    slider('#sx', v => sxDrag = v, (v) => ({ seg: [{ sx: v }] }));
    slider('#ix', v => ixDrag = v, (v) => ({ seg: [{ ix: v }] }));
    slider('#kelvin', () => {}, (v) => ({ on: true, seg: [{ fx: 0, col: [kelvinToRgb(v)] }] }));
    $('#fxSearch').addEventListener('input', (e) => renderEffects(e.target.value));
    buildTimerBtns('#lampTimerBtns', 'lamp');
    buildTimerBtns('#tvTimerBtns', 'tv');
  }

  // ------------------------------------------------------------ ТВ
  async function tvKey(key) {
    haptic(12);
    try { await API.post('/api/tv/key', { key }); } catch (e) { onError(e); }
  }
  function renderTv(cfg) {
    state.tv = cfg || {};
    const ok = !!(cfg && (cfg.configured || cfg.ip));
    $('#tvNotSet').classList.toggle('hidden', ok);
    $('#tvName').textContent = ok ? (cfg.model || cfg.name || 'Samsung TV') : 'Телевизор';
    $('#tvStatus').textContent = ok ? `${cfg.ip}${cfg.method ? ' · ' + cfg.method : ''}${cfg.online === false ? ' · не отвечает' : (cfg.online ? ' · на связи' : '')}` : 'не настроен';
    $('#tvCfgInfo').textContent = ok ? `Сейчас: ${cfg.name || cfg.model || ''} ${cfg.ip} (${cfg.method || '?'})` : 'Телевизор не настроен';
    if (ok) $('#tvIp').value = cfg.ip;
  }
  async function loadTv() {
    try {
      const [cfg, dev] = await Promise.all([API.get('/api/tv/config'), API.get('/api/devices').catch(() => null)]);
      setOnline(true);
      if (dev && dev.devices && dev.devices.tv) cfg.online = dev.devices.tv.online;
      renderTv(cfg);
      $('#tvPower').classList.toggle('on', !!(dev && dev.devices && dev.devices.tv && dev.devices.tv.online));
    } catch (e) { onError(e); }
    loadTimers();
  }
  async function tvScan() {
    const list = $('#tvScanList'); list.innerHTML = ''; list.append(el('div', { class: 'empty' }, el('span', { class: 'spinner' }), ' Ищу телевизоры в сети… (5–10 с)'));
    try {
      const r = await API.get('/api/tv/scan');
      list.innerHTML = '';
      if (!r.tvs || !r.tvs.length) { list.append(el('div', { class: 'empty' }, 'Не нашёл. Телевизор включён и в той же Wi-Fi? Можно ввести IP вручную ниже.')); return; }
      for (const tv of r.tvs) list.append(el('button', { class: 'item', onclick: () => tvSetIp(tv.ip) },
        el('span', { class: 't' }, `${tv.name || tv.model || 'Samsung'} — ${tv.ip}`), el('span', { class: 'muted small' }, tv.method || '')));
      document.querySelector('[data-screen="tv"] .card:last-of-type').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { list.innerHTML = ''; onError(e); }
  }
  async function tvSetIp(ip) {
    ip = (ip || '').trim(); if (!ip) return;
    toast('Проверяю телевизор…');
    try { const cfg = await API.post('/api/tv/config', { ip }); renderTv(cfg); toast('Телевизор сохранён'); $('#tvScanList').innerHTML = ''; }
    catch (e) { onError(e); }
  }
  function initTv() {
    $$('[data-key]').forEach(b => b.addEventListener('click', () => tvKey(b.dataset.key)));
    $$('[data-act="tvscan"]').forEach(b => b.addEventListener('click', tvScan));
    $('#tvPower').addEventListener('click', async () => {
      haptic(15);
      const on = !$('#tvPower').classList.contains('on');
      try { await API.post('/api/tv/power', { on }); $('#tvPower').classList.toggle('on', on); toast(on ? 'Включаю телевизор' : 'Выключаю телевизор'); }
      catch (e) { onError(e); }
    });
    $('#apps').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-app]'); if (!b) return; haptic();
      try { await API.post('/api/tv/app', { app: b.dataset.app }); toast('Открываю…'); } catch (err) { onError(err); }
    });
    $('#ytGo').addEventListener('click', async () => {
      const q = $('#ytQuery').value.trim(); if (!q) return; haptic();
      try { await API.post('/api/tv/browser', { query: q }); toast('Ищу на YouTube…'); } catch (e) { onError(e); }
    });
    $('#ytQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ytGo').click(); });
    $('#tvAppsLoad').addEventListener('click', async () => {
      try {
        const r = await API.get('/api/tv/apps');
        const host = $('#apps');
        $$('.app.extra', host).forEach(x => x.remove());
        for (const a of (r.apps || [])) host.append(el('button', { class: 'app extra', 'data-app': a.id }, a.name));
        if (!(r.apps || []).length) toast('Телевизор не отдал список приложений');
      } catch (e) { onError(e); }
    });
    const np = $('#numpad');
    for (const d of [1,2,3,4,5,6,7,8,9,'', 0, '']) np.append(d === '' ? el('span') : el('button', { class: 'btn', onclick: () => tvKey('KEY_' + d) }, String(d)));
    $('#tvIpSave').addEventListener('click', () => tvSetIp($('#tvIp').value));
  }

  // ------------------------------------------------------------ АССИСТЕНТ
  function addMsg(text, who) {
    const c = $('#chat');
    c.append(el('div', { class: 'msg ' + who }, text));
    c.scrollTop = 1e9;
  }
  function setPending(on) { state.pending = on; $('#confirmBox').classList.toggle('hidden', !on); }
  async function sendChat(text) {
    text = (text || '').trim(); if (!text) return;
    addMsg(text, 'me'); $('#chatText').value = ''; autosize();
    const wait = el('div', { class: 'msg bot' }, el('span', { class: 'spinner' })); $('#chat').append(wait); $('#chat').scrollTop = 1e9;
    try {
      const r = await API.post('/api/chat', { text });
      wait.remove();
      addMsg(r.reply || 'Готово.', 'bot');
      setPending(!!(r.pending_confirmation && r.pending_confirmation.length));
      if (r.did_actions && state.tab === 'light') loadLamp();
    } catch (e) { wait.remove(); onError(e); if (e.code !== 401 && e.code !== 'NOBASE') addMsg('⚠️ ' + e.message, 'sys'); }
  }
  function autosize() { const t = $('#chatText'); t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }
  function initChat() {
    $('#btnSend').addEventListener('click', () => sendChat($('#chatText').value));
    $('#chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(e.target.value); } });
    $('#chatText').addEventListener('input', autosize);
    $('#btnConfirm').addEventListener('click', async () => {
      haptic(15); setPending(false);
      try { const r = await API.post('/api/chat/confirm', {}); addMsg(r.reply || 'Выполнено.', 'bot'); } catch (e) { onError(e); }
    });
    $('#btnCancel').addEventListener('click', async () => {
      setPending(false);
      try { const r = await API.post('/api/chat/cancel', {}); addMsg(r.reply || 'Отменено ✖️', 'bot'); } catch (e) { onError(e); }
    });
    // голос: распознаёт браузер (нужен https или localhost), текст уходит в чат
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const mic = $('#btnMic'); mic.classList.remove('hidden');
      let rec = null;
      mic.addEventListener('click', () => {
        if (rec) { try { rec.stop(); } catch (_) {} return; }
        rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = false; rec.maxAlternatives = 1;
        mic.classList.add('rec'); haptic(20);
        rec.onresult = (e) => { const t = e.results[0][0].transcript; sendChat(t); };
        rec.onerror = (e) => { toast('Голос: ' + (e.error === 'not-allowed' ? 'нет доступа к микрофону' : e.error)); };
        rec.onend = () => { mic.classList.remove('rec'); rec = null; };
        try { rec.start(); } catch (_) { mic.classList.remove('rec'); rec = null; }
      });
    }
  }

  // ------------------------------------------------------------ ДОМ
  async function loadHome() {
    try {
      const [a, t, m] = await Promise.all([API.get('/api/automations'), API.get('/api/tasks'), API.get('/api/memory')]);
      setOnline(true);
      const autos = $('#autos'); autos.innerHTML = '';
      for (const it of (a.items || [])) {
        autos.append(el('div', { class: 'item' },
          el('div', { class: 't' }, el('div', {}, it.name), el('div', { class: 'muted small' }, `${it.trigger_type || ''} ${it.trigger_spec || ''}${it.last_run ? ' · было: ' + it.last_run : ''}`)),
          el('button', { class: 'switch' + (it.enabled ? ' on' : ''), 'aria-label': 'вкл/выкл', onclick: async (e) => {
            const sw = e.currentTarget; const en = !sw.classList.contains('on'); haptic();
            try { await API.post('/api/automations/toggle', { id: it.id, enabled: en }); sw.classList.toggle('on', en); } catch (err) { onError(err); }
          } }),
          el('button', { class: 'iconbtn', 'aria-label': 'удалить', onclick: async () => { if (!confirm('Удалить автоматизацию?')) return; try { await API.post('/api/automations/delete', { id: it.id }); loadHome(); } catch (err) { onError(err); } } }, '🗑')));
      }
      if (!(a.items || []).length) autos.append(el('div', { class: 'empty' }, 'Автоматизаций пока нет. Скажи ассистенту: «каждый день в 23:00 выключай свет».'));
      const tasks = $('#tasks'); tasks.innerHTML = '';
      for (const it of (t.items || [])) tasks.append(el('div', { class: 'item' }, el('span', { class: 't' }, it.title),
        el('button', { class: 'btn sm', onclick: async () => { haptic(); try { await API.post('/api/tasks/done', { id: it.id }); loadHome(); } catch (err) { onError(err); } } }, '✓')));
      if (!(t.items || []).length) tasks.append(el('div', { class: 'empty' }, 'Открытых задач нет'));
      const mems = $('#mems'); mems.innerHTML = '';
      for (const it of (m.items || [])) mems.append(el('div', { class: 'item' }, el('span', { class: 't' }, it.content), el('span', { class: 'chip' }, it.kind || ''),
        el('button', { class: 'iconbtn', 'aria-label': 'забыть', onclick: async () => { try { await API.del('/api/memory', { id: it.id }); loadHome(); } catch (err) { onError(err); } } }, '🗑')));
      if (!(m.items || []).length) mems.append(el('div', { class: 'empty' }, 'Память пуста'));
    } catch (e) { onError(e); }
  }
  function initHome() {
    $('#taskAdd').addEventListener('click', async () => { const v = $('#taskText').value.trim(); if (!v) return; try { await API.post('/api/tasks/add', { title: v }); $('#taskText').value = ''; loadHome(); } catch (e) { onError(e); } });
    $('#memAdd').addEventListener('click', async () => { const v = $('#memText').value.trim(); if (!v) return; try { await API.post('/api/memory', { content: v }); $('#memText').value = ''; loadHome(); } catch (e) { onError(e); } });
  }

  // ------------------------------------------------------------ ПК
  const PC_LABELS = { host: 'Компьютер', os: 'Система', cpu: 'Процессор', ram: 'Память', disks: 'Диски', uptime: 'Аптайм', uptime_hours: 'Аптайм, ч', battery: 'Батарея', network: 'Сеть', temps: 'Температуры', top: 'Процессы', top_processes: 'Процессы', python: 'Python', boot_time: 'Включён с' };
  const pct = (v) => typeof v === 'number' ? v : (v && typeof v.percent === 'number' ? v.percent : null);
  function meter(p) { const cls = p > 90 ? 'bad' : (p > 75 ? 'warn' : ''); return el('div', { class: 'meter' }, el('i', { class: cls, style: `width:${Math.max(2, Math.min(100, p))}%` })); }
  function fmtVal(v) {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'да' : 'нет';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
    if (Array.isArray(v)) return v.map(fmtVal).join(', ');
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${fmtVal(x)}`).join(' · ');
    return String(v);
  }
  function pcCard(title, body) { return el('div', { class: 'card' }, el('h3', { style: 'margin-top:0' }, title), body); }
  async function loadPc() {
    const host = $('#pcCards');
    try {
      const d = await API.get('/api/system'); setOnline(true);
      host.innerHTML = '';
      for (const [k, v] of Object.entries(d)) {
        const title = PC_LABELS[k] || k;
        if (k === 'disks' && v && typeof v === 'object') {
          const b = el('div', { class: 'list' });
          for (const [name, info] of Object.entries(v)) {
            const p = pct(info); const free = info && (info.free_gb != null ? `${info.free_gb} ГБ свободно` : fmtVal(info));
            const row = el('div', {}, el('div', { class: 'row between' }, el('b', {}, name), el('span', { class: 'muted small' }, free)));
            if (p != null) row.append(meter(p));
            b.append(row);
          }
          host.append(pcCard(title, b)); continue;
        }
        if ((k === 'cpu' || k === 'ram') && pct(v) != null) {
          const p = pct(v);
          const extra = v && typeof v === 'object' ? Object.entries(v).filter(([kk]) => kk !== 'percent').map(([kk, x]) => `${kk}: ${fmtVal(x)}`).join(' · ') : '';
          host.append(pcCard(title, el('div', {}, el('div', { class: 'row between' }, el('b', {}, p.toFixed(0) + '%'), el('span', { class: 'muted small' }, extra)), meter(p)))); continue;
        }
        if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
          const b = el('div', { class: 'kv' });
          for (const it of v.slice(0, 12)) { b.append(el('span', { class: 'k' }, it.name || it.title || fmtVal(it)), el('span', {}, it.cpu != null ? `${it.cpu}% CPU` : (it.mem != null ? `${it.mem} МБ` : (it.value != null ? fmtVal(it.value) : '')))); }
          host.append(pcCard(title, b)); continue;
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const b = el('div', { class: 'kv' });
          for (const [kk, x] of Object.entries(v)) b.append(el('span', { class: 'k' }, PC_LABELS[kk] || kk), el('span', {}, fmtVal(x)));
          host.append(pcCard(title, b)); continue;
        }
        host.append(pcCard(title, el('div', {}, fmtVal(v))));
      }
      if (!host.children.length) host.append(el('div', { class: 'empty' }, 'Нет данных'));
    } catch (e) { host.innerHTML = ''; host.append(el('div', { class: 'empty' }, 'Не удалось получить данные о ПК')); onError(e); }
  }

  // ------------------------------------------------------------ НАСТРОЙКИ / ВХОД
  function openSheet(title, hint) {
    $('#sheetTitle').textContent = title || 'Настройки';
    $('#sheetHint').textContent = hint || (API.base ? '' : 'Адрес бота пришлёт Telegram-бот по команде /panel. В домашней сети это http://IP-компьютера:8090');
    $('#apiInput').value = API.base || '';
    $('#pwdInput').value = API.token || '';
    $('#sheetErr').textContent = '';
    $('#chipVer').textContent = API.version ? 'версия ' + API.version : 'версия —';
    $('#chipPing').textContent = API.online ? 'на связи' : 'нет связи';
    $('#chipPing').className = 'chip ' + (API.online ? 'ok' : 'bad');
    $('#sheetBg').classList.remove('hidden');
    refreshPanelLinks();
  }
  function closeSheet() { $('#sheetBg').classList.add('hidden'); }
  async function refreshPanelLinks() {
    const host = $('#panelLinks'); host.textContent = '';
    if (!API.base || !API.online) return;
    try {
      const p = await API.get('/api/panel');
      const parts = [];
      if (p.lan_url) parts.push(el('div', {}, 'Дома: ', el('a', { href: p.lan_url }, p.lan_url)));
      parts.forEach(x => host.append(x));
    } catch (_) {}
  }
  async function login() {
    const base = $('#apiInput').value.trim().replace(/\/+$/, '');
    const pwd = $('#pwdInput').value;
    const err = $('#sheetErr'); err.textContent = '';
    if (!base) { err.textContent = 'Укажи адрес бота'; return; }
    const full = /^https?:\/\//.test(base) ? base : 'http://' + base;
    $('#btnLogin').disabled = true;
    try {
      const ping = await API.probe(full);
      if (!ping) { err.textContent = 'По этому адресу бот не отвечает'; return; }
      API.base = full; API.token = pwd; API.version = ping.version || ''; API.authRequired = !!ping.auth;
      store.set('intellect_api', full); store.set('intellect_token', pwd || null);
      await API.get('/api/devices');              // проверка пароля
      setOnline(true); closeSheet(); toast('Подключено ✓'); showTab(state.tab);
    } catch (e) {
      if (e.code === 401) err.textContent = 'Неверный пароль';
      else if (e.code === 429) err.textContent = 'Слишком много попыток — подожди 15 минут';
      else err.textContent = e.message;
    } finally { $('#btnLogin').disabled = false; }
  }
  function initSheet() {
    $('#btnSettings').addEventListener('click', () => openSheet('Настройки'));
    $('#sheetClose').addEventListener('click', closeSheet);
    $('#sheetBg').addEventListener('click', (e) => { if (e.target === e.currentTarget && API.base) closeSheet(); });
    $('#btnLogin').addEventListener('click', login);
    $('#pwdInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('#btnLogout').addEventListener('click', () => { store.set('intellect_token', null); store.set('intellect_api', null); API.token = ''; API.base = ''; location.reload(); });
  }

  // ------------------------------------------------------------ старт
  async function boot() {
    buildTabs(); initLight(); initTv(); initChat(); initHome(); initSheet();
    const how = await discoverBase();
    if (!how) { setOnline(false); openSheet('Подключение'); showTab(state.tab); return; }
    const ping = await API.probe(API.base);
    if (ping) { API.version = ping.version || ''; API.authRequired = !!ping.auth; setOnline(true); } else setOnline(false);
    if (ping && ping.auth && !API.token) { showTab(state.tab); openSheet('Нужен пароль', 'Пароль пришлёт Telegram-бот по команде /panel'); return; }
    showTab(state.tab);
    // периодический пинг: показывать «нет связи» и восстанавливаться
    setInterval(async () => { if (document.hidden || !API.base) return; const p = await API.probe(API.base); setOnline(!!p); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) showTab(state.tab); });
  }
  boot();
})();
