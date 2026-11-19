/* دفتر الفواتير — التطبيق (الإصدار 3)
   البيانات تُحمَّل مرة وتُخزَّن في الجهاز (IndexedDB)، ثم تتحدث بالتغييرات فقط كل 15 ثانية.
   البحث والفلاتر والإحصاءات والتصدير تتم في الجهاز مباشرة. الرفع عبر طابور يتحمل انقطاع الإنترنت. */
(() => {
'use strict';
const CFG = window.APP_CONFIG || {};
const VERSION = CFG.VERSION || '3.0.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toLatin = s => String(s == null ? '' : s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const TYPES = {
  invoice: { l: 'فاتورة', p: 'فواتير عادية' }, electricity: { l: 'كهرباء', p: 'فواتير كهرباء' }, water: { l: 'ماء', p: 'فواتير ماء' },
  lease: { l: 'عقد إيجار', p: 'عقود إيجار' }, lease_cancel: { l: 'إلغاء عقد', p: 'إلغاء عقود' }, receipt: { l: 'إيصال دفع', p: 'إيصالات دفع' }
};
const INFO = t => t === 'receipt' || t === 'lease_cancel';
const baisa = a => (typeof a === 'number' && isFinite(a)) ? Math.round(a * 1000) : 0;
const fmtB = b => (b / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmt = a => (typeof a === 'number' && isFinite(a)) ? fmtB(baisa(a)) : '—';
const normNo = n => toLatin(n).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const normName = s => String(s || '').replace(/[\s\-–_.,()]+/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase().slice(0, 12);
// وقت الرفع: 19/11/2026 · 1:05 م
const fmtAt = ms => { if (!ms) return ''; const d = new Date(ms); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); let h = d.getHours(); const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${h}:${p(d.getMinutes())} ${ap}`; };
const monthName = ym => ym ? MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4) : '';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

/* ================= الأيقونات ================= */
const GLYPH = {
  invoice: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="#fff"/><path d="M9 8h6M9 12h6M9 16h4" stroke="#0B8F6E" stroke-width="1.8" stroke-linecap="round"/>',
  electricity: '<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6z" fill="#fff"/>',
  water: '<path d="M12 2.5c3.6 4.6 6.5 8 6.5 11.7a6.5 6.5 0 0 1-13 0C5.5 10.5 8.4 7.1 12 2.5z" fill="#fff"/><path d="M9 14.5a3 3 0 0 0 3 3" stroke="#0A78C2" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  lease: '<path d="M3 11 12 3.5 21 11v10H3z" fill="#fff"/><rect x="10" y="14" width="4" height="7" rx="1" fill="#6A45E6"/>',
  lease_cancel: '<path d="M5 3h10l4 4v14H5z" fill="#fff"/><path d="m9 11 6 6m0-6-6 6" stroke="#D93A3A" stroke-width="2" stroke-linecap="round"/>',
  receipt: '<rect x="2.5" y="6" width="19" height="12" rx="3" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#11908A"/><path d="M5.5 9.5h1M17.5 14.5h1" stroke="#11908A" stroke-width="1.8" stroke-linecap="round"/>'
};
const ico = (t, cls = '') => `<svg class="ico3d ${cls}" viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="8" width="40" height="37" rx="13" fill="#000" fill-opacity=".16"/><rect x="4" y="3" width="40" height="38" rx="13" fill="url(#g-${t})"/><rect x="8" y="5" width="32" height="14" rx="8" fill="url(#g-gloss)"/><g transform="translate(12 10)">${GLYPH[t] || GLYPH.invoice}</g></svg>`;
const coin = (cx, cy, s = 1) => `<g transform="translate(${cx} ${cy}) scale(${s})"><path d="M-28 0v10a28 10 0 0 0 56 0V0" fill="url(#g-coin-side)"/><ellipse rx="28" ry="10" fill="url(#g-coin)"/><ellipse rx="18" ry="6" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/></g>`;
const HERO_SVG = `<svg class="coins" viewBox="0 0 150 130" aria-hidden="true"><g transform="translate(86 6) rotate(9)"><rect x="-28" y="0" width="56" height="76" rx="8" fill="#000" fill-opacity=".15" transform="translate(4 5)"/><rect x="-28" y="0" width="56" height="76" rx="8" fill="url(#g-paper)"/><path d="M-17 16h34M-17 27h34M-17 38h24" stroke="#8CC8B8" stroke-width="5" stroke-linecap="round"/><path d="M-17 56h18" stroke="#0B8F6E" stroke-width="6" stroke-linecap="round"/></g>${coin(48, 108)}${coin(48, 94)}${coin(48, 80)}${coin(112, 112, .8)}</svg>`;
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8 8.5"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V11M12 20V5M19 20v-7"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>'
};

/* ================= الحالة ================= */
const S = {
  user: null, pin: '', rows: [], byId: new Map(), rev: 0, view: 'home', d: null,
  f: { q: '', type: 'all', year: 'all', status: 'all', by: 'all', from: '', to: '', min: '', max: '', sort: 'date' },
  limit: 150, syncing: false, online: navigator.onLine, lastSync: 0, syncErr: ''
};

/* ================= التخزين في الجهاز ================= */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      let rq;
      try { rq = indexedDB.open('daftar', 1); } catch (e) { return rej(e); }
      rq.onupgradeneeded = () => { const d = rq.result; ['kv', 'queue', 'img'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      rq.onsuccess = () => { this.db = rq.result; res(this.db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  },
  get(store, k) { return this.tx(store, 'readonly', s => s.get(k)).catch(() => undefined); },
  put(store, k, v) { return this.tx(store, 'readwrite', s => s.put(v, k)).catch(() => {}); },
  del(store, k) { return this.tx(store, 'readwrite', s => s.delete(k)).catch(() => {}); },
  async all(store) {
    try { const d = await this.open(); return await new Promise((res, rej) => { const out = []; const t = d.transaction(store, 'readonly'); const c = t.objectStore(store).openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); }; c.onerror = () => rej(c.error); }); }
    catch (e) { return []; }
  }
};
let persistT = 0;
function persist() { clearTimeout(persistT); persistT = setTimeout(() => { DB.put('kv', 'rows', S.rows); DB.put('kv', 'rev', S.rev); }, 600); }

/* ================= الاتصال بالخادم ================= */
const apiUrl = () => (lsGet('api_url') || CFG.API_URL || '').trim();
async function api(action, payload = {}, pin) {
  const url = apiUrl();
  if (!url) { const e = new Error('رابط الخادم غير مضبوط'); e.code = 'NO_URL'; throw e; }
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, pin: pin || S.pin }, payload)), redirect: 'follow' });
  } catch (err) { const e = new Error('ما فيه اتصال بالإنترنت أو الخادم'); e.code = 'NET'; throw e; }
  if (!res.ok) { const e = new Error('الخادم رد بخطأ ' + res.status); e.code = 'HTTP'; throw e; }
  let j;
  try { j = await res.json(); } catch (err) { const e = new Error('رد غير مفهوم من الخادم. تأكد من رابط الخادم'); e.code = 'BAD'; throw e; }
  if (!j.ok && j.code === 'AUTH' && action !== 'login') { logout('انتهت صلاحية الدخول، أدخل رمزك مرة ثانية'); }
  return j;
}

/* ================= البيانات ================= */
function fromWire(fields, a) {
  const o = {};
  fields.forEach((k, i) => { o[k] = a[i]; });
  o.rv = !!o.rv; o.ok = !!o.ok; o.hasImg = !!o.img;
  ['amt', 'rent', 'months', 'paid', 'at', 'upd'].forEach(k => { o[k] = (o[k] === '' || o[k] == null) ? null : Number(o[k]); });
  ['no', 'date', 'desc', 'why', 'hash', 'by', 'src', 'acct', 'cons', 'bmonth', 'ref', 'contract', 'landlord', 'tenant', 'prop', 'from', 'to', 'cancel', 'note', 'link'].forEach(k => { o[k] = o[k] == null ? '' : String(o[k]); });
  if (!TYPES[o.type]) o.type = 'invoice';
  return o;
}
function setAll(list) { S.rows = list; S.byId = new Map(list.map(r => [r.id, r])); S.d = null; persist(); }
function upsert(list) {
  list.forEach(r => { const i = S.rows.findIndex(x => x.id === r.id); if (i >= 0) S.rows[i] = r; else S.rows.push(r); S.byId.set(r.id, r); });
  S.d = null; persist();
}
function removeIds(ids) { if (!ids.length) return; const set = new Set(ids); S.rows = S.rows.filter(r => !set.has(r.id)); ids.forEach(id => S.byId.delete(id)); S.d = null; persist(); }

function keysOf(d) {
  const n = normNo(d.no), acct = normNo(d.acct || d.cons).replace(/[A-Z]$/, ''), b = d.amt == null ? '' : baisa(d.amt);
  switch (d.type) {
    case 'invoice': return [n && b !== '' ? 'inv|' + n + '|' + b : '', !n && d.date && b > 0 ? 'inv0|' + d.date + '|' + b + '|' + normName(d.desc) : ''];
    case 'electricity': case 'water': return [acct && d.bmonth ? 'ut|' + d.type + '|' + acct + '|' + d.bmonth : '', n ? 'utb|' + n : ''];
    case 'lease': return [n ? 'ls|' + n : '', ''];
    case 'lease_cancel': return [n ? 'lc|' + n + '|' + (d.cancel || '') : '', ''];
    case 'receipt': return [n ? 'rc|' + n : '', ''];
  }
  return ['', ''];
}

// الحسابات المشتقة: الترتيب، التراكمي، التكرار، الإحصاءات
function derive() {
  if (S.d) return S.d;
  const rows = S.rows.slice().sort((a, b) => {
    if (!a.date && b.date) return 1; if (a.date && !b.date) return -1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.at || 0) - (b.at || 0);
  });
  const cum = new Map(); let run = 0;
  rows.forEach(r => { r._b = INFO(r.type) ? 0 : baisa(r.amt); run += r._b; cum.set(r.id, run); });
  const groups = new Map();
  rows.forEach(r => { if (r.ok) return; keysOf(r).forEach(k => { if (!k) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }); if (r.hash) { const k = 'h|' + r.hash; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); } });
  const dup = new Map();
  groups.forEach((g, k) => { if (g.length < 2) return; g.forEach(r => { if (!dup.has(r.id)) dup.set(r.id, { others: g.filter(x => x !== r).map(x => x.id), why: k.startsWith('h|') ? 'نفس الصورة' : k.startsWith('ut|') ? 'نفس الحساب ونفس الشهر' : 'نفس الرقم والمبلغ' }); }); });
  const years = new Map(), types = new Map(), users = new Map();
  let rv = 0;
  rows.forEach(r => {
    if (r.rv) rv++;
    const y = r.date ? r.date.slice(0, 4) : 'none';
    if (!years.has(y)) years.set(y, { y, b: 0, c: 0, m: new Map() });
    const Y = years.get(y); Y.b += r._b; Y.c++;
    if (r.date) { const m = +r.date.slice(5, 7); const M = Y.m.get(m) || { m, b: 0, c: 0 }; M.b += r._b; M.c++; Y.m.set(m, M); }
    const T = types.get(r.type) || { t: r.type, b: 0, c: 0 }; T.b += r._b; T.c++; types.set(r.type, T);
    const u = r.by || 'غير معروف'; const U = users.get(u) || { u, b: 0, c: 0, rv: 0, last: 0 }; U.b += r._b; U.c++; if (r.rv) U.rv++; U.last = Math.max(U.last, r.at || 0); users.set(u, U);
  });
  S.d = { rows, cum, total: run, dup, years, types, users, rv };
  return S.d;
}

function filtered() {
  const d = derive(), f = S.f;
  const q = toLatin(f.q).trim().toLowerCase();
  const min = f.min === '' ? null : Number(toLatin(f.min)), max = f.max === '' ? null : Number(toLatin(f.max));
  let list = d.rows.filter(r => {
    if (f.type !== 'all' && r.type !== f.type) return false;
    if (f.year !== 'all' && (r.date ? r.date.slice(0, 4) : 'none') !== f.year) return false;
    if (f.status === 'rv' && !r.rv) return false;
    if (f.status === 'dup' && !d.dup.has(r.id)) return false;
    if (f.status === 'linked' && !r.link) return false;
    if (f.by !== 'all' && (r.by || 'غير معروف') !== f.by) return false;
    if (f.from && (!r.date || r.date < f.from)) return false;
    if (f.to && (!r.date || r.date > f.to)) return false;
    if (min != null && !isNaN(min) && (r.amt == null || r.amt < min)) return false;
    if (max != null && !isNaN(max) && (r.amt == null || r.amt > max)) return false;
    if (q) {
      const hay = [r.no, r.desc, r.acct, r.cons, r.ref, r.contract, r.landlord, r.tenant, r.prop, r.note, r.by, r.amt != null ? fmt(r.amt) : '', r.amt].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
  if (f.sort === 'date-desc') list = list.slice().reverse();
  else if (f.sort === 'amount') list = list.slice().sort((a, b) => b._b - a._b);
  else if (f.sort === 'added') list = list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  return list;
}
const isFiltered = () => { const f = S.f; return !!(f.q || f.type !== 'all' || f.year !== 'all' || f.status !== 'all' || f.by !== 'all' || f.from || f.to || f.min || f.max); };

/* ================= المزامنة ================= */
async function fullLoad() {
  const j = await api('all');
  if (!j.ok) throw new Error(j.error || 'تعذر التحميل');
  setAll(j.rows.map(a => fromWire(j.fields, a)));
  S.rev = j.rev || 0; persist();
}
async function sync(force) {
  if (!S.user || S.syncing) return;
  if (!navigator.onLine) { S.online = false; paintSync(); return; }
  S.syncing = true; paintSync();
  let changed = false;
  try {
    if (force || (!S.rows.length && !S.rev)) { await fullLoad(); changed = true; }
    else {
      const j = await api('sync', { since: S.rev });
      if (!j.ok) throw new Error(j.error || 'تعذرت المزامنة');
      if (j.reset) { await fullLoad(); changed = true; }
      else if (j.rev !== S.rev) {
        if (j.rows && j.rows.length) { upsert(j.rows.map(a => fromWire(j.fields, a))); changed = true; }
        if (j.del && j.del.length) { removeIds(j.del); changed = true; }
        S.rev = j.rev; persist();
      }
    }
    S.online = true; S.syncErr = ''; S.lastSync = Date.now();
    // نعيد الرسم فقط إذا تغيّرت البيانات فعلًا (هذا اللي كان يحرّك الصفحة كل 15 ثانية)
    if (changed) softRefresh();
  } catch (e) { S.syncErr = e.message; S.online = e.code !== 'NET'; }
  finally { S.syncing = false; paintSync(); }
}
function paintSync() {
  const el = $('#sync'); if (!el) return;
  el.className = 'sync' + (S.syncing ? ' busy' : (!S.online || S.syncErr) ? ' off' : '');
  el.querySelector('span').textContent = S.syncing ? 'تحديث…' : !S.online ? 'بدون إنترنت' : S.syncErr ? 'خطأ اتصال' : 'محدّث';
  el.title = S.syncErr || (S.lastSync ? 'آخر تحديث ' + new Date(S.lastSync).toLocaleTimeString('ar-OM') : '');
}
setInterval(() => { if (!document.hidden && S.user && !$('.sheet')) sync(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('online', () => { S.online = true; paintSync(); sync(); pump(); });
window.addEventListener('offline', () => { S.online = false; paintSync(); });

/* ================= الدخول ================= */
let pinBuf = '';
function renderLogin(msg) {
  const needUrl = !apiUrl();
  $('#app').innerHTML = `<div class="login"><div class="login-card c3d">
    ${HERO_SVG.replace('class="coins"', 'class="hero-ill"')}
    <h1>دفتر الفواتير</h1>
    ${needUrl ? `<p class="muted" style="margin:0">أول مرة: الصق رابط الخادم (ينتهي بـ ‎/exec)</p>
      <input class="input" id="url" dir="ltr" placeholder="https://script.google.com/macros/s/…/exec">
      <button class="btn primary" id="saveUrl" type="button" style="width:100%">حفظ الرابط</button>` :
      `<p class="muted" style="margin:0">أدخل رمز الدخول</p>
      <div class="pin-dots" id="dots"></div>
      <p class="err" id="err">${esc(msg || '')}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="btn" data-k="${n}" type="button">${n}</button>`).join('')}
        <button class="btn" data-k="del" type="button" aria-label="مسح">⌫</button><button class="btn" data-k="0" type="button">0</button><button class="btn primary" data-k="ok" type="button" aria-label="دخول">دخول</button></div>`}
  </div></div>`;
  if (needUrl) {
    $('#saveUrl').onclick = () => { const u = $('#url').value.trim(); if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u)) { toast('الرابط لازم يبدأ بـ https://script.google.com'); return; } lsSet('api_url', u); renderLogin(); };
    return;
  }
  pinBuf = ''; paintDots();
  $('.keypad').onclick = e => { const b = e.target.closest('[data-k]'); if (b) key(b.dataset.k); };
}
function paintDots() { const d = $('#dots'); if (d) d.innerHTML = Array.from({ length: Math.max(4, pinBuf.length) }, (_, i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join(''); }
function key(k) {
  if (k === 'del') pinBuf = pinBuf.slice(0, -1);
  else if (k === 'ok') return tryLogin();
  else if (pinBuf.length < 8) pinBuf += k;
  paintDots(); const er = $('#err'); if (er) er.textContent = '';
}
document.addEventListener('keydown', e => { if (S.user || !$('#dots')) return; if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('del'); else if (e.key === 'Enter') key('ok'); });
async function tryLogin() {
  if (pinBuf.length < 4) { $('#err').textContent = 'الرمز من 4 أرقام أو أكثر'; return; }
  const okBtn = $('[data-k="ok"]'); okBtn.disabled = true; okBtn.textContent = '…';
  try {
    const j = await api('login', {}, pinBuf);
    if (!j.ok) { pinBuf = ''; paintDots(); $('#err').textContent = j.error || 'رمز غير صحيح'; return; }
    S.pin = pinBuf; S.user = j.user; lsSet('pin', S.pin); lsSet('user', JSON.stringify(S.user));
    start();
  } catch (e) {
    $('#err').textContent = e.code === 'BAD' || e.code === 'HTTP' ? 'رابط الخادم غير صحيح أو الخادم غير منشور' : e.message;
    if (e.code === 'BAD' || e.code === 'HTTP') { const b = document.createElement('button'); b.className = 'btn small ghost'; b.textContent = 'تغيير رابط الخادم'; b.onclick = () => { lsSet('api_url', null); renderLogin(); }; $('#err').after(b); }
  } finally { okBtn.disabled = false; okBtn.textContent = 'دخول'; }
}
function logout(msg) { S.user = null; S.pin = ''; lsSet('pin', null); lsSet('user', null); renderLogin(msg); }

/* ================= الهيكل والتنقل ================= */
function renderShell() {
  const initial = (S.user.name || '؟').trim().charAt(0);
  $('#app').innerHTML = `<div class="shell">
    <header class="topbar"><div class="brandmark"><img src="icons/icon-192.png" alt="">دفتر الفواتير</div><span class="sp"></span>
      <span class="sync" id="sync"><i></i><span></span></span><button class="avatar" id="me" type="button" title="${esc(S.user.name)}">${esc(initial)}</button></header>
    <main id="main"></main>
    <nav class="nav c3d" aria-label="التنقل">
      <button data-v="home" type="button">${I.home}الرئيسية</button>
      <button data-v="docs" type="button">${I.docs}المستندات</button>
      <button data-v="upload" type="button" class="fab" aria-label="رفع مستند">${I.cam}</button>
      <button data-v="stats" type="button">${I.stats}الإحصاءات</button>
      <button data-v="more" type="button">${I.more}المزيد</button>
    </nav></div>`;
  $('.nav').onclick = e => { const b = e.target.closest('[data-v]'); if (b) go(b.dataset.v); };
  $('#me').onclick = () => go('more');
  $('#main').addEventListener('click', e => { const r = e.target.closest('.row[data-id]'); if (r) { openFrom(r.dataset.id); return; } const o = e.target.closest('[data-open]'); if (o) openFrom(o.dataset.open); });
  paintSync();
}
function go(v) { if (location.hash !== '#' + v) location.hash = v; else { S.view = v; S.enter = true; refresh(); } }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (['home', 'docs', 'upload', 'stats', 'more'].includes(v)) { S.view = v; S.limit = 150; S.enter = true; refresh(); window.scrollTo(0, 0); } });
// تحديث هادئ بعد المزامنة: يحافظ على مكان التمرير، ولا يقاطع الكتابة أو نافذة مفتوحة
let pendingRefresh = false;
function softRefresh() {
  const a = document.activeElement;
  const typing = a && a.closest && a.closest('#main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (typing || $('.sheet')) { pendingRefresh = true; return; }
  const y = window.scrollY;
  if (S.view === 'docs' && $('#list')) paintDocsResults();
  else if (S.view === 'upload' && $('#qbox')) paintQueue();
  else refresh();
  window.scrollTo(0, y);
}
document.addEventListener('focusout', () => { if (pendingRefresh) setTimeout(() => { if (pendingRefresh) { pendingRefresh = false; softRefresh(); } }, 400); });
new MutationObserver(() => { if (pendingRefresh && !$('.sheet')) { pendingRefresh = false; softRefresh(); } }).observe(document.body, { childList: true });
function refresh() {
  if (!S.user || !$('#main')) return;
  const enter = S.enter; S.enter = false;
  setTimeout(() => { const v = $('#main .view'); if (v && enter) v.classList.add('enter'); }, 0);
  $$('.nav [data-v]').forEach(b => b.setAttribute('aria-current', b.dataset.v === S.view ? 'page' : 'false'));
  const qn = Q.items.filter(i => i.st === 'wait' || i.st === 'run').length;
  const fab = $('.nav .fab'); if (fab) fab.innerHTML = I.cam + (qn ? `<span class="badge">${qn}</span>` : '');
  ({ home: vHome, docs: vDocs, upload: vUpload, stats: vStats, more: vMore }[S.view] || vHome)();
}

/* ================= الرئيسية ================= */
function vHome() {
  const d = derive();
  const qn = Q.items.filter(i => i.st === 'wait' || i.st === 'run').length;
  const years = [...d.years.values()].filter(Y => Y.y !== 'none').sort((a, b) => a.y < b.y ? -1 : 1);
  const maxY = Math.max(1, ...years.map(Y => Y.b));
  const recent = S.rows.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 6);
  $('#main').innerHTML = `<div class="view">
    <section class="hero" aria-label="إجمالي الصرف"><div>
      <div class="lbl">إجمالي الصرف</div>
      <div class="total"><bdi id="tot">${fmtB(d.total)}</bdi><small>ر.ع.</small></div>
      <div class="sub">${S.rows.length.toLocaleString('en-US')} مستند · أهلًا ${esc(S.user.name)}</div></div>
      ${HERO_SVG}
      <div class="chips">
        <button class="chip" data-st="rv" type="button">⚠️ ${d.rv} تحتاج مراجعة</button>
        <button class="chip" data-st="dup" type="button">⧉ ${d.dup.size} مكررة</button>
        ${qn ? `<button class="chip" data-go="upload" type="button">⏳ ${qn} بانتظار الرفع</button>` : ''}
      </div></section>
    <div class="quick">
      <label class="btn primary">${I.cam}تصوير مستند<input type="file" accept="image/*" capture="environment" data-pick="cam"></label>
      <label class="btn blue">${I.img}رفع من الصور<input type="file" accept="image/*" multiple data-pick="gal"></label>
    </div>
    <h2 class="h-sec">حسب نوع المستند</h2>
    <div class="grid-types">${Object.keys(TYPES).map(t => { const T = d.types.get(t) || { b: 0, c: 0 }; return `<button class="tcard c3d" data-type="${t}" type="button">${ico(t)}<div class="n">${INFO(t) ? T.c.toLocaleString('en-US') : fmtB(T.b)}</div><div class="s">${TYPES[t].p} · ${INFO(t) ? 'للعلم فقط' : T.c.toLocaleString('en-US') + ' مستند'}</div></button>`; }).join('')}</div>
    <section class="panel c3d"><h2 class="h-sec">الصرف حسب السنة</h2><div class="bars" style="margin-top:12px">
      ${years.length ? years.map(Y => `<div class="bar-row"><span class="num">${Y.y}</span><div class="bar"><i style="width:${Math.max(2, Y.b / maxY * 100).toFixed(1)}%"></i></div><span class="num">${fmtB(Y.b)}</span></div>`).join('') : '<p class="muted">يظهر هنا أول ما ترفعون مستندات.</p>'}
    </div></section>
    <section class="c3d"><h2 class="h-sec" style="padding:16px 16px 4px">آخر ما انرفع <button class="btn small ghost" data-go="docs" type="button">عرض الكل</button></h2>
      <div class="recent">${recent.length ? recent.map(rowHtml).join('') : '<div class="empty"><strong>ما فيه مستندات بعد</strong>صوّر أول مستند من الزر الأخضر.</div>'}</div></section>
  </div>`;
  $$('[data-st]').forEach(b => b.onclick = () => { resetF(); S.f.status = b.dataset.st; go('docs'); });
  $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  $$('[data-type]').forEach(b => b.onclick = () => { resetF(); S.f.type = b.dataset.type; go('docs'); });
  bindPickers($('#main'));
  countUp($('#tot'), d.total);
}
let lastTotal = null;
function countUp(el, target) {
  if (!el) return;
  const from = lastTotal == null ? 0 : lastTotal; lastTotal = target;
  if (from === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmtB(target); return; }
  const t0 = performance.now(), dur = 900;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtB(Math.round(from + (target - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function resetF() { S.f = { q: '', type: 'all', year: 'all', status: 'all', by: 'all', from: '', to: '', min: '', max: '', sort: 'date' }; S.limit = 150; }

/* ================= المستندات ================= */
function rowHtml(r) {
  const d = derive(); const dp = d.dup.get(r.id);
  return `<button class="row" data-id="${esc(r.id)}" type="button">${ico(r.type)}
    <div class="r-main"><div class="r-desc">${esc(r.desc || TYPES[r.type].l)}</div>
      <div class="r-meta"><bdi>${esc(r.date || 'بدون تاريخ')}</bdi><span>·</span><span>رقم <bdi>${esc(r.no || '—')}</bdi></span>${r.rv ? '<span class="tag warn">مراجعة</span>' : ''}${dp ? '<span class="tag dup">مكررة</span>' : ''}</div>
      ${r.at || r.by ? `<div class="r-up">⏱ رُفع <bdi>${esc(fmtAt(r.at))}</bdi>${r.by ? ' · ' + esc(r.by) : ''}</div>` : ''}
      ${r.note ? `<div class="r-note">${esc(r.note)}</div>` : ''}</div>
    <div class="r-amt">${INFO(r.type) ? '<div class="a info">للعلم فقط</div>' : `<div class="a">${fmt(r.amt)}</div>`}<div class="c">التراكمي ${fmtB(d.cum.get(r.id) || 0)}</div></div></button>`;
}
function openFrom(id) { if (S.byId.get(id)) openDoc(id); else toast('المستند بيظهر بعد التحديث'); }

function vDocs() {
  const d = derive(), f = S.f;
  const list = filtered();
  const years = [...d.years.keys()].sort();
  const usersL = [...d.users.keys()].sort();
  let sumB = 0; list.forEach(r => { sumB += r._b; });
  const adv = !!(f.by !== 'all' || f.from || f.to || f.min || f.max || f.sort !== 'date');
  $('#main').innerHTML = `<div class="view">
    <div class="searchbar"><input class="input" id="q" type="search" placeholder="بحث: رقم، محل، حساب، مستأجر، مبلغ…" value="${esc(f.q)}" aria-label="بحث"><button class="btn small" id="advBtn" type="button" aria-expanded="${adv}">${I.filter}فلترة</button></div>
    <div class="filters-row">
      <select class="input" id="fType" style="width:auto;min-height:40px"><option value="all">كل الأنواع</option>${Object.keys(TYPES).map(t => `<option value="${t}"${f.type === t ? ' selected' : ''}>${TYPES[t].p}</option>`).join('')}</select>
      <select class="input" id="fYear" style="width:auto;min-height:40px"><option value="all">كل السنوات</option>${years.map(y => `<option value="${y}"${f.year === y ? ' selected' : ''}>${y === 'none' ? 'بدون تاريخ' : y}</option>`).join('')}</select>
      ${[['all', 'الكل'], ['rv', 'تحتاج مراجعة'], ['dup', 'مكررة'], ['linked', 'مرتبطة']].map(([k, l]) => `<button class="chip" data-status="${k}" aria-pressed="${f.status === k}" type="button">${l}</button>`).join('')}
    </div>
    <section class="panel c3d" id="adv" ${adv ? '' : 'hidden'}><div class="fields">
      <div class="field"><label for="fBy">أدخلها</label><select id="fBy"><option value="all">الكل</option>${usersL.map(u => `<option${f.by === u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
      <div class="field"><label for="fSort">الترتيب</label><select id="fSort">${[['date', 'التاريخ: الأقدم أولًا'], ['date-desc', 'التاريخ: الأحدث أولًا'], ['amount', 'المبلغ: الأكبر أولًا'], ['added', 'آخر ما انرفع']].map(([k, l]) => `<option value="${k}"${f.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="fFrom">من تاريخ</label><input id="fFrom" type="date" value="${esc(f.from)}"></div>
      <div class="field"><label for="fTo">إلى تاريخ</label><input id="fTo" type="date" value="${esc(f.to)}"></div>
      <div class="field"><label for="fMin">المبلغ من</label><input id="fMin" inputmode="decimal" value="${esc(f.min)}" placeholder="0.000"></div>
      <div class="field"><label for="fMax">المبلغ إلى</label><input id="fMax" inputmode="decimal" value="${esc(f.max)}" placeholder="0.000"></div>
      <div class="actions-row full"><button class="btn small" id="clearF" type="button">مسح الفلاتر</button></div></div></section>
    <div class="actions-row" style="align-items:center">
      <div class="muted" id="dcount" style="flex:2;min-width:180px">${countHtml(list, sumB)}</div>
      <button class="btn small" id="exp" type="button">${I.dl}<span id="expL">${isFiltered() ? 'Excel للنتائج' : 'Excel للكل'}</span></button>
    </div>
    <div id="list">${listHtml(list)}</div></div>`;
  // البحث يحدّث النتائج فقط، وخانة البحث تبقى ثابتة (ما تنقفل لوحة المفاتيح)
  const q = $('#q'); let qt;
  q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { S.f.q = q.value; S.limit = 150; paintDocsResults(); }, 220); };
  $('#advBtn').onclick = () => { const a = $('#adv'); a.hidden = !a.hidden; $('#advBtn').setAttribute('aria-expanded', !a.hidden); };
  $('#fType').onchange = e => { S.f.type = e.target.value; S.limit = 150; vDocs(); };
  $('#fYear').onchange = e => { S.f.year = e.target.value; S.limit = 150; vDocs(); };
  $$('[data-status]').forEach(b => b.onclick = () => { S.f.status = b.dataset.status; S.limit = 150; vDocs(); });
  [['fBy', 'by'], ['fSort', 'sort'], ['fFrom', 'from'], ['fTo', 'to'], ['fMin', 'min'], ['fMax', 'max']].forEach(([id, k]) => { $('#' + id).onchange = e => { S.f[k] = e.target.value.trim(); S.limit = 150; vDocs(); }; });
  $('#clearF').onclick = () => { resetF(); vDocs(); };
  $('#exp').onclick = () => exportXlsx(filtered(), isFiltered());
  $('#list').addEventListener('click', e => { if (e.target.closest('#more')) { S.limit += 300; paintDocsResults(); } });
}
function countHtml(list, sumB) { return `<b class="num" style="color:var(--ink)">${list.length.toLocaleString('en-US')}</b> مستند ${isFiltered() ? 'مطابق' : ''} · المجموع <b class="num" style="color:var(--ink)">${fmtB(sumB)}</b> ر.ع.`; }
function paintDocsResults() {
  const list = filtered(); let sumB = 0; list.forEach(r => { sumB += r._b; });
  const c = $('#dcount'), l = $('#list'), e = $('#expL');
  if (c) c.innerHTML = countHtml(list, sumB);
  if (e) e.textContent = isFiltered() ? 'Excel للنتائج' : 'Excel للكل';
  if (l) l.innerHTML = listHtml(list);
}
function listHtml(list) {
  if (!S.rows.length) return '<div class="c3d empty"><strong>ما فيه مستندات بعد</strong>اضغط الزر الأخضر في الأسفل وصوّر أول مستند.</div>';
  if (!list.length) return '<div class="c3d empty"><strong>ما فيه نتائج</strong>غيّر البحث أو الفلاتر.</div>';
  const shown = list.slice(0, S.limit);
  let h = '';
  if (S.f.sort === 'date' || S.f.sort === 'date-desc') {
    const yT = new Map(), mT = new Map();
    list.forEach(r => { const y = r.date ? r.date.slice(0, 4) : 'none', m = r.date ? r.date.slice(0, 7) : 'none'; yT.set(y, (yT.get(y) || 0) + r._b); const M = mT.get(m) || [0, 0]; M[0] += r._b; M[1]++; mT.set(m, M); });
    let lastY = null, lastM = null;
    shown.forEach(r => {
      const y = r.date ? r.date.slice(0, 4) : 'none', m = r.date ? r.date.slice(0, 7) : 'none';
      if (y !== lastY) { if (lastM !== null) h += '</div>'; lastM = null; h += `<div class="year-h"><span style="font-size:inherit">${y === 'none' ? 'بدون تاريخ' : y}</span><span class="num">${fmtB(yT.get(y))} ر.ع.</span></div>`; lastY = y; }
      if (m !== lastM) { if (lastM !== null) h += '</div>'; const M = mT.get(m); h += `<div class="month-h"><h3>${m === 'none' ? 'تاريخ غير مقروء' : monthName(m)}</h3><span class="num">${M[1]} مستند · ${fmtB(M[0])} ر.ع.</span></div><div class="rows c3d">`; lastM = m; }
      h += rowHtml(r);
    });
    h += '</div>';
  } else h = '<div class="rows c3d">' + shown.map(rowHtml).join('') + '</div>';
  if (list.length > shown.length) h += `<button class="btn" id="more" type="button" style="width:100%;margin-top:14px">عرض المزيد (${(list.length - shown.length).toLocaleString('en-US')} متبقي)</button>`;
  return h;
}

/* ================= تفاصيل وتعديل مستند ================= */
const HINT = {
  invoice: '', electricity: 'المبلغ = مستحقات الشهر الحالي فقط (بدون المتأخرات). الفاتورة تنحسب في شهرها.',
  water: 'المبلغ = مستحقات الشهر الحالي فقط (بدون المتأخرات). الفاتورة تنحسب في شهرها.',
  lease: 'قيمة العقد تُحسب تلقائيًا = الإيجار الشهري × مدة العقد، وتنحسب في شهر بداية العقد.',
  lease_cancel: 'للعلم فقط: لا يُخصم أي مبلغ من الإجمالي. الملاحظة تتحدث تلقائيًا من العقد الأصلي.',
  receipt: 'للعلم فقط: لا يُخصم أي مبلغ من الإجمالي. يرتبط بالفاتورة برقم الحساب ورقم الفاتورة.'
};
const FIELDS = [
  ['acct', 'رقم الحساب', 'electricity water receipt'], ['cons', 'رقم المشترك', 'electricity water'], ['bmonth', 'فاتورة شهر', 'electricity water', 'month'],
  ['ref', 'رقم الفاتورة المدفوعة', 'receipt'], ['paid', 'المبلغ المدفوع', 'receipt', 'num'],
  ['landlord', 'المؤجر', 'lease lease_cancel'], ['tenant', 'المستأجر', 'lease lease_cancel'], ['from', 'من تاريخ', 'lease lease_cancel', 'date'],
  ['to', 'إلى تاريخ', 'lease lease_cancel', 'date'], ['rent', 'الإيجار الشهري', 'lease lease_cancel', 'num'], ['cancel', 'تاريخ الإلغاء', 'lease_cancel', 'date'],
  ['prop', 'العقار / العنوان', 'electricity water lease lease_cancel', 'full']
];
function openDoc(id) {
  const r = id ? S.byId.get(id) : null;
  const isNew = !r;
  const x = r || { type: 'invoice' };
  const d = derive(); const dp = r && d.dup.get(r.id);
  const admin = S.user.role === 'مدير';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="dt">
    <div style="display:flex;align-items:center;gap:12px">${ico(x.type, 'lg')}<div style="flex:1;min-width:0"><h2 id="dt">${isNew ? 'إضافة مستند يدويًا' : esc(x.desc || TYPES[x.type].l)}</h2>
      ${r ? `<p class="meta">${INFO(r.type) ? 'للعلم فقط' : fmt(r.amt) + ' ر.ع.'} · التراكمي ${fmtB(d.cum.get(r.id) || 0)}</p>` : ''}</div>
      <button class="btn small" data-close type="button" aria-label="إغلاق">✕</button></div>
    ${r && r.hasImg ? '<div class="photo" id="ph">جارٍ تحميل الصورة…</div><p class="meta">اضغط على الصورة للتكبير.</p>' : ''}
    ${r && r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    ${dp ? `<div class="dupcard">⧉ <b>مكررة (${esc(dp.why)})</b> مع: ${dp.others.slice(0, 3).map(o => { const v = S.byId.get(o); return v ? `<button class="btn small" data-open="${esc(o)}" type="button" style="margin:4px 2px 0">${esc(v.date || '؟')} · ${fmt(v.amt)} · ${esc(v.by || '')}</button>` : ''; }).join('')}</div>` : ''}
    <div class="fields">
      <div class="field full"><label for="e-type">نوع المستند</label><select id="e-type">${Object.keys(TYPES).map(t => `<option value="${t}"${x.type === t ? ' selected' : ''}>${TYPES[t].l}</option>`).join('')}</select></div>
      <div class="field"><label for="e-no" id="l-no">الرقم</label><input id="e-no" value="${esc(x.no)}" autocomplete="off"></div>
      <div class="field" data-for="invoice electricity water lease"><label for="e-amt" id="l-amt">المبلغ</label><input id="e-amt" inputmode="decimal" value="${x.amt != null && !INFO(x.type) ? Number(x.amt).toFixed(3) : ''}" placeholder="0.000" autocomplete="off"></div>
      <div class="field" data-for="invoice receipt"><label for="e-date" id="l-date">التاريخ</label><input id="e-date" type="date" value="${esc(x.date)}"></div>
      ${FIELDS.map(([k, l, types, kind]) => `<div class="field${kind === 'full' ? ' full' : ''}" data-for="${types}"><label for="e-${k}">${l}</label><input id="e-${k}" ${kind === 'date' ? 'type="date"' : kind === 'month' ? 'type="month"' : kind === 'num' ? 'inputmode="decimal"' : 'autocomplete="off"'} value="${esc(kind === 'num' ? (x[k] != null && x[k] !== '' ? Number(x[k]).toFixed(3) : '') : (x[k] || ''))}"></div>`).join('')}
      <div class="field full"><label for="e-desc">الوصف</label><textarea id="e-desc">${esc(x.desc)}</textarea></div>
      <p class="meta full" id="e-hint"></p>
    </div>
    <label class="check"><input type="checkbox" id="e-rv"${x.rv ? ' checked' : ''}><span>تحتاج مراجعة${x.why ? `<p class="why">${esc(x.why)}</p>` : ''}</span></label>
    ${dp || x.ok ? `<label class="check"><input type="checkbox" id="e-ok"${x.ok ? ' checked' : ''}><span>راجعتها، وهي ليست مكررة</span></label>` : ''}
    <p class="err" id="e-err"></p>
    <button class="btn primary" id="e-save" type="button">حفظ</button>
    <div class="actions-row"><button class="btn" data-close type="button">إغلاق</button>${r && admin ? '<button class="btn danger" id="e-del" type="button">حذف</button>' : ''}</div>
    ${r ? `<p class="meta">${[r.at && '⏱ رُفع ' + esc(fmtAt(r.at)), r.by && 'بواسطة ' + esc(r.by), r.upd && r.upd - (r.at || 0) > 60000 ? 'آخر تعديل ' + esc(fmtAt(r.upd)) : '', r.src && 'القراءة: ' + esc(r.src)].filter(Boolean).join(' · ')}</p>` : ''}
  </div>`;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-close]')) close(); const o = e.target.closest('[data-open]'); if (o) { close(); openDoc(o.dataset.open); } });
  document.addEventListener('keydown', function onk(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onk); } });
  const typeSel = $('#e-type', sheet);
  const syncFields = () => {
    const t = typeSel.value;
    $$('[data-for]', sheet).forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(t); });
    $('#l-no', sheet).textContent = (t === 'lease' || t === 'lease_cancel') ? 'رقم العقد' : t === 'receipt' ? 'رقم الإيصال' : 'رقم الفاتورة';
    $('#l-amt', sheet).textContent = (t === 'electricity' || t === 'water') ? 'مستحقات الشهر الحالي' : t === 'lease' ? 'قيمة العقد (تلقائي)' : 'المبلغ (ر.ع.)';
    $('#l-date', sheet).textContent = t === 'receipt' ? 'تاريخ الدفع' : 'التاريخ';
    $('#e-amt', sheet).readOnly = t === 'lease';
    $('#e-hint', sheet).textContent = HINT[t] || ''; $('#e-hint', sheet).hidden = !HINT[t];
  };
  typeSel.onchange = syncFields; syncFields();
  if (r && r.hasImg) loadImg(r.id).then(src => { const ph = $('#ph', sheet); if (!ph) return; if (!src) { ph.textContent = 'الصورة غير متوفرة'; return; } ph.innerHTML = '<img alt="صورة المستند">'; ph.firstChild.src = src; ph.onclick = () => ph.classList.toggle('zoom'); });
  const numv = id => toLatin($('#' + id, sheet).value.trim()).replace(/٫/g, '.').replace(/[,٬\s]/g, '');
  $('#e-save', sheet).onclick = async () => {
    const b = $('#e-save', sheet); b.disabled = true; b.textContent = 'جارٍ الحفظ…'; $('#e-err', sheet).textContent = '';
    const f = { type: typeSel.value, no: $('#e-no', sheet).value.trim(), date: $('#e-date', sheet).value, desc: $('#e-desc', sheet).value.trim(), amt: numv('e-amt'),
      rv: $('#e-rv', sheet).checked, why: x.why || '', ok: $('#e-ok', sheet) ? $('#e-ok', sheet).checked : !!x.ok };
    FIELDS.forEach(([k, , , kind]) => { f[k] = kind === 'num' ? numv('e-' + k) : $('#e-' + k, sheet).value.trim(); });
    try {
      const j = await api('save', { id: r ? r.id : null, f });
      if (!j.ok) { $('#e-err', sheet).innerHTML = esc(j.error || 'تعذر الحفظ') + (j.existing ? ` <button class="btn small" data-open="${esc(j.existing.id)}" type="button">عرض الأصلي</button>` : ''); return; }
      upsert([fromWire(j.fields, j.row)]); close(); toast('انحفظ ✓'); refresh(); setTimeout(() => window.dispatchEvent(new Event('app-sync')), 300);
    } catch (e) { $('#e-err', sheet).textContent = e.message; }
    finally { b.disabled = false; b.textContent = 'حفظ'; }
  };
  const del = $('#e-del', sheet);
  if (del) del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'اضغط مرة ثانية لتأكيد الحذف'; return; }
    del.disabled = true;
    try { const j = await api('delete', { id: r.id }); if (!j.ok) { toast(j.error); return; } removeIds([r.id]); close(); toast('انحذف'); refresh(); window.dispatchEvent(new Event('app-sync')); }
    catch (e) { toast(e.message); } finally { del.disabled = false; }
  };
}
window.addEventListener('app-sync', () => sync());
async function loadImg(id) {
  const c = await DB.get('img', id); if (c) return c;
  try { const j = await api('image', { id }); if (j.ok && j.data) { DB.put('img', id, j.data); return j.data; } } catch (e) {}
  return null;
}

/* ================= الرفع (طابور يتحمل انقطاع الإنترنت) ================= */
const Q = { items: [], running: 0, paused: false };
const CONC = 2;
async function loadQueue() { Q.items = (await DB.all('queue')).sort((a, b) => a.t - b.t); Q.items.forEach(i => { if (i.st === 'run') i.st = 'wait'; }); }
const saveItem = it => DB.put('queue', it.id, it);
// ملاحظة آيفون: لا نمسح قيمة حقل الاختيار إلا بعد قراءة كل الصور، لأن سفاري يحذف الملفات المؤقتة عند المسح
function bindPickers(root) {
  $$('input[data-pick]', root).forEach(inp => inp.onchange = async e => {
    const input = e.target; const f = Array.from(input.files || []);
    if (!f.length) return;
    toast(f.length === 1 ? 'انضافت الصورة للطابور' : 'انضافت ' + f.length + ' صورة للطابور');
    if (S.view !== 'upload') go('upload');
    await addFiles(f);
    try { input.value = ''; } catch (err) {}
  });
}
async function sha(buf) { try { const d = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(d).slice(0, 12)).map(b => ('0' + b.toString(16)).slice(-2)).join(''); } catch (e) { return ''; } }
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
function viaImg(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob), im = new Image();
    im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('الجهاز ما قدر يفتح الصورة')); };
    im.src = u;
  });
}
async function decode(blob) {
  if (window.createImageBitmap) { try { return await withTimeout(createImageBitmap(blob, { imageOrientation: 'from-image' }), 20000, 'decode-timeout'); } catch (e) {} }
  return withTimeout(viaImg(blob), 30000, 'الصورة كبيرة وأخذت وقت طويل');
}
async function compress(file) {
  const img = await decode(file);
  const w = img.width, h = img.height, s = Math.min(1, 1400 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  const enc = q => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', q));
  let out = await enc(0.8); if (out.size > 220000) out = await enc(0.65);
  const t = document.createElement('canvas'); const ts = 96 / Math.max(c.width, c.height); t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  if (img.close) try { img.close(); } catch (e) {}
  c.width = c.height = 0;   // تحرير الذاكرة (مهم في الآيفون)
  return { buf: await out.arrayBuffer(), thumb: t.toDataURL('image/jpeg', 0.6) };
}
let adding = 0;
async function addFiles(files) {
  keepAwake(); adding++;
  const hashes = new Set(S.rows.map(r => r.hash).filter(Boolean));
  const items = files.map(file => ({ id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: file.name || 'صورة', t: Date.now(), st: 'prep', msg: 'بانتظار التجهيز…' }));
  Q.items.push(...items); refreshUpload();
  for (let i = 0; i < files.length; i++) {
    const file = files[i], it = items[i];
    it.msg = 'تجهيز…'; refreshUpload();
    try {
      const raw = await withTimeout(file.arrayBuffer(), 30000, 'ما قدر يقرأ الصورة من الجهاز');
      it.hash = await sha(raw);
      const inQ = Q.items.find(o => o !== it && o.hash && o.hash === it.hash && o.st !== 'bad');
      if (it.hash && hashes.has(it.hash)) { const ex = S.rows.find(r => r.hash === it.hash); it.st = 'dup'; it.msg = 'مرفوض: نفس الصورة مرفوعة من قبل'; it.ex = ex ? { id: ex.id, no: ex.no, date: ex.date, desc: ex.desc, amt: ex.amt, by: ex.by, at: ex.at } : null; }
      else if (inQ) { it.st = 'dup'; it.msg = 'مرفوض: نفس الصورة مكررة في الاختيار'; }
      else {
        const c = await compress(new Blob([raw], { type: file.type || 'image/jpeg' }));
        it.buf = c.buf; it.thumb = c.thumb;
        it.st = 'wait'; it.msg = navigator.onLine ? 'بالانتظار' : 'بانتظار الإنترنت';
      }
    } catch (e) { it.st = 'bad'; it.msg = 'تعذر تجهيز الصورة: ' + (e && e.message || 'صيغة غير مدعومة') + '. جرّب تصوّرها بالكاميرا من داخل النظام.'; }
    await saveItem(it); refreshUpload();
    pump();
  }
  adding--;
}
function pump() {
  while (!Q.paused && navigator.onLine && Q.running < CONC) {
    const it = Q.items.find(i => i.st === 'wait'); if (!it) break;
    it.st = 'run'; it.msg = 'يقرأ المستند…'; Q.running++; refreshUpload();
    processItem(it).finally(() => { Q.running--; saveItem(it); refreshUpload(); pump(); if (!Q.running) { sync(); releaseAwake(); } });
  }
}
function b64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function processItem(it) {
  try {
    if (!it.buf && it.blob) it.buf = await it.blob.arrayBuffer();   // طوابير من الإصدار السابق
    if (!it.buf) { it.st = 'bad'; it.msg = 'الصورة مفقودة، اخترها مرة ثانية'; return; }
    const j = await api('upload', { b64: b64(it.buf), hash: it.hash });
    if (!j.ok) {
      if (j.code === 'RATE_LIMIT') { it.st = 'wait'; it.msg = 'ضغط على Claude، بيكمل بعد دقيقة'; pauseFor(60000); return; }
      it.st = 'bad'; it.msg = j.error || 'تعذرت القراءة';
      if (/credit|balance|رصيد/i.test(it.msg)) it.msg = 'رصيد Claude API خلص. اشحن الرصيد وأعد المحاولة';
      return;
    }
    if (j.status === 'duplicate') { it.st = 'dup'; it.msg = 'مرفوض: ' + j.reason; it.ex = j.existing; it.buf = null; it.blob = null; return; }
    const row = fromWire(j.fields, j.row); upsert([row]);
    it.st = 'ok'; it.rowId = row.id; it.buf = null; it.blob = null;
    it.msg = 'انحفظ · ' + TYPES[row.type].l + ' · ' + (row.rv ? 'تحتاج مراجعة' : INFO(row.type) ? 'للعلم' : fmt(row.amt) + ' ر.ع.');
  } catch (e) {
    if (e.code === 'NET') { it.st = 'wait'; it.msg = 'بانتظار الإنترنت'; pauseFor(15000); }
    else { it.st = 'bad'; it.msg = e.message; }
  }
}
function pauseFor(ms) { if (Q.paused) return; Q.paused = true; refreshUpload(); setTimeout(() => { Q.paused = false; pump(); }, ms); }
let wake = null;
async function keepAwake() { try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {} }
function releaseAwake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
window.addEventListener('beforeunload', e => { if (adding || Q.items.some(i => i.st === 'run' || i.st === 'prep')) { e.preventDefault(); e.returnValue = ''; } });
// تحديث الطابور في مكانه بدون إعادة رسم الصفحة (حتى ما تتحرك الصفحة مع كل صورة)
let qPaint = 0;
function refreshUpload() {
  const fab = $('.nav .fab');
  if (fab) { const qn = Q.items.filter(i => i.st === 'wait' || i.st === 'run' || i.st === 'prep').length; fab.innerHTML = I.cam + (qn ? `<span class="badge">${qn}</span>` : ''); }
  if (S.view !== 'upload' || qPaint) return;
  qPaint = requestAnimationFrame(() => { qPaint = 0; paintQueue(); });
}
function paintQueue() {
  const box = $('#qbox'); if (!box) return;
  const J = Q.items;
  const done = J.filter(i => ['ok', 'dup', 'bad'].includes(i.st)).length;
  const cnt = k => J.filter(i => i.st === k).length;
  const order = { run: 0, prep: 1, wait: 2, bad: 3, dup: 4, ok: 5 };
  const list = J.slice().sort((a, b) => (order[a.st] - order[b.st]) || (b.t - a.t)).slice(0, 120);
  const failedRetry = J.some(i => i.st === 'bad' && (i.buf || i.blob));
  box.innerHTML = `${!navigator.onLine ? '<div class="banner warn">📶 ما فيه إنترنت. الصور محفوظة في الجهاز وبتنرفع لحالها لما يرجع الاتصال.</div>' : ''}
    ${Q.paused ? '<div class="banner warn">⏳ توقف مؤقت، بيكمل تلقائيًا.</div>' : ''}
    ${adding ? '<div class="banner info">📷 جارٍ تجهيز الصور… خلّ الصفحة مفتوحة ولا تقفل الشاشة لين يخلص التجهيز.</div>' : ''}
    ${J.length ? `<section class="panel c3d">
      <div class="h-sec"><span>${done === J.length ? 'خلص الطابور' : 'جارٍ الرفع'} <span class="num muted">${done} من ${J.length}</span></span>
        <span class="actions-row" style="flex:none">${failedRetry ? '<button class="btn small" id="retry" type="button">إعادة الفاشلة</button>' : ''}${done ? '<button class="btn small" id="clearQ" type="button">مسح المنتهية</button>' : ''}</span></div>
      <div class="progress" style="margin-top:12px"><i style="width:${(J.length ? done / J.length * 100 : 0).toFixed(1)}%"></i></div>
      <div class="filters-row" style="margin-top:12px"><span class="chip ok">✓ ${cnt('ok')} انحفظ</span><span class="chip dup">⧉ ${cnt('dup')} مرفوض مكرر</span><span class="chip bad">✕ ${cnt('bad')} فشل</span><span class="chip">⏳ ${cnt('wait') + cnt('run') + cnt('prep')} بالانتظار</span></div>
    </section>
    <section class="c3d">${list.map(it => `<div class="q-item ${it.st}">${it.thumb ? `<img src="${it.thumb}" alt="">` : '<img alt="">'}
      <div class="q-txt"><div class="q-name">${esc(it.name)}</div><div class="q-msg">${esc(it.msg || '')}</div>
      ${it.st === 'dup' && it.ex ? `<div class="dupcard">المستند الأصلي: ${esc(it.ex.desc || '')} · رقم ${esc(it.ex.no || '—')} · ${esc(it.ex.date || '')} · ${fmt(it.ex.amt)}${it.ex.by ? ' · رفعه ' + esc(it.ex.by) : ''}${it.ex.at ? ' · ' + fmtAt(it.ex.at) : ''} <button class="btn small" data-open="${esc(it.ex.id)}" type="button">عرض الأصلي</button></div>` : ''}
      </div>${it.st === 'ok' && it.rowId ? `<button class="btn small" data-open="${esc(it.rowId)}" type="button">عرض</button>` : ''}</div>`).join('')}</section>` :
      `<section class="drop c3d">${ico('invoice', 'lg')}<h2 style="font-size:18px">ابدأ بتصوير أول مستند</h2><p class="muted" style="margin:0">أو اختر عشرات الصور مرة وحدة من المعرض. خلّ الصفحة مفتوحة لين يخلص الرفع.</p></section>`}`;
  const rt = $('#retry', box); if (rt) rt.onclick = () => { Q.items.forEach(i => { if (i.st === 'bad' && (i.buf || i.blob)) { i.st = 'wait'; i.msg = 'بالانتظار'; saveItem(i); } }); pump(); refreshUpload(); };
  const cq = $('#clearQ', box); if (cq) cq.onclick = async () => { const keep = []; for (const i of Q.items) { if (['ok', 'dup'].includes(i.st) || (i.st === 'bad' && !i.buf && !i.blob)) await DB.del('queue', i.id); else keep.push(i); } Q.items = keep; refreshUpload(); };
}
function vUpload() {
  $('#main').innerHTML = `<div class="view">
    <div class="quick">
      <label class="btn primary">${I.cam}تصوير مستند<input type="file" accept="image/*" capture="environment" data-pick="cam"></label>
      <label class="btn blue">${I.img}رفع من الصور<input type="file" accept="image/*" multiple data-pick="gal"></label>
    </div>
    <p class="muted" style="margin:0">صورة واحدة لكل مستند، بأي ترتيب. النظام يتعرف على النوع (فاتورة، كهرباء، ماء، عقد، إلغاء عقد، إيصال)، ويرفض أي مستند مرفوع من قبل ويوضح السبب.</p>
    <div id="qbox" style="display:flex;flex-direction:column;gap:18px"></div>
  </div>`;
  bindPickers($('#main'));
  paintQueue();
}

/* ================= الإحصاءات ================= */
function vStats() {
  const d = derive();
  const users = [...d.users.values()].sort((a, b) => b.c - a.c);
  const years = [...d.years.values()].sort((a, b) => a.y < b.y ? -1 : 1);
  const today = new Date().toISOString().slice(0, 10);
  const todayN = S.rows.filter(r => r.at && new Date(r.at).toISOString().slice(0, 10) === today).length;
  const linked = S.rows.filter(r => r.link).length;
  const sel = S.statYear && d.years.get(S.statYear) ? S.statYear : (years.filter(Y => Y.y !== 'none').slice(-1)[0] || {}).y;
  const Y = sel ? d.years.get(sel) : null;
  const maxM = Y ? Math.max(1, ...[...Y.m.values()].map(M => M.b)) : 1;
  $('#main').innerHTML = `<div class="view">
    <div class="kpis">
      <div class="kpi c3d"><div class="v num">${fmtB(d.total)}</div><div class="l">إجمالي الصرف (ر.ع.)</div></div>
      <div class="kpi c3d"><div class="v num">${S.rows.length.toLocaleString('en-US')}</div><div class="l">كل المستندات</div></div>
      <div class="kpi c3d"><div class="v num">${todayN.toLocaleString('en-US')}</div><div class="l">انرفعت اليوم</div></div>
      <div class="kpi c3d"><div class="v num" style="color:var(--amber)">${d.rv}</div><div class="l">تحتاج مراجعة</div></div>
      <div class="kpi c3d"><div class="v num" style="color:var(--violet)">${d.dup.size}</div><div class="l">مكررة قديمة للتنظيف</div></div>
      <div class="kpi c3d"><div class="v num">${linked}</div><div class="l">إيصالات وإلغاءات مرتبطة</div></div>
    </div>
    <section class="c3d"><h2 class="h-sec" style="padding:16px 16px 6px">إنجاز كل مستخدم</h2><div class="table-wrap"><table class="t">
      <thead><tr><th>المستخدم</th><th>المستندات</th><th>المبلغ المحتسب</th><th>تحتاج مراجعة</th><th>آخر رفع</th></tr></thead>
      <tbody>${users.map(U => `<tr><td>${esc(U.u)}</td><td>${U.c.toLocaleString('en-US')}</td><td>${fmtB(U.b)}</td><td>${U.rv}</td><td>${U.last ? new Date(U.last).toLocaleDateString('ar-OM') : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">لا يوجد بيانات بعد</td></tr>'}</tbody></table></div></section>
    <section class="c3d"><h2 class="h-sec" style="padding:16px 16px 6px">حسب نوع المستند</h2><div class="table-wrap"><table class="t">
      <thead><tr><th>النوع</th><th>العدد</th><th>المجموع المحتسب</th></tr></thead>
      <tbody>${Object.keys(TYPES).map(t => { const T = d.types.get(t) || { b: 0, c: 0 }; return `<tr><td>${TYPES[t].p}</td><td>${T.c.toLocaleString('en-US')}</td><td>${INFO(t) ? 'للعلم فقط' : fmtB(T.b)}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="panel c3d"><div class="h-sec"><span>الصرف الشهري</span><select class="input" id="sy" style="width:auto;min-height:40px">${years.filter(Y => Y.y !== 'none').map(Y => `<option${Y.y === sel ? ' selected' : ''}>${Y.y}</option>`).join('')}</select></div>
      <div class="bars" style="margin-top:14px">${Y ? MONTHS.map((n, i) => { const M = Y.m.get(i + 1); return `<div class="bar-row"><span>${n}</span><div class="bar"><i style="width:${M ? Math.max(2, M.b / maxM * 100).toFixed(1) : 0}%"></i></div><span class="num">${M ? fmtB(M.b) : '—'}</span></div>`; }).join('') : '<p class="muted">لا يوجد بيانات</p>'}</div>
      ${Y ? `<p class="meta" style="margin-top:12px">مجموع ${Y.y}: <b class="num">${fmtB(Y.b)}</b> ر.ع. · ${Y.c} مستند</p>` : ''}</section>
    <section class="c3d"><h2 class="h-sec" style="padding:16px 16px 6px">ملخص السنوات</h2><div class="table-wrap"><table class="t">
      <thead><tr><th>السنة</th><th>المستندات</th><th>المجموع</th></tr></thead>
      <tbody>${years.map(Y => `<tr><td>${Y.y === 'none' ? 'بدون تاريخ' : Y.y}</td><td>${Y.c}</td><td>${fmtB(Y.b)}</td></tr>`).join('')}<tr><td><b>المجموع الكلي</b></td><td><b>${S.rows.length}</b></td><td><b>${fmtB(d.total)}</b></td></tr></tbody></table></div></section>
  </div>`;
  const sy = $('#sy'); if (sy) sy.onchange = e => { S.statYear = e.target.value; vStats(); };
}

/* ================= المزيد / الإعدادات ================= */
function vMore() {
  const admin = S.user.role === 'مدير';
  const theme = lsGet('theme') || 'auto';
  $('#main').innerHTML = `<div class="view">
    <section class="panel c3d" style="display:flex;align-items:center;gap:14px"><div class="avatar" style="width:54px;height:54px;font-size:22px">${esc((S.user.name || '؟').charAt(0))}</div>
      <div style="flex:1"><h2 style="font-size:19px">${esc(S.user.name)}</h2><p class="meta">${esc(S.user.role)} · الإصدار ${esc(VERSION)}</p></div>
      <button class="btn small danger" id="out" type="button">خروج</button></section>
    <section class="panel c3d list-tight"><h2 class="h-sec">ملف Excel</h2>
      <p class="muted" style="margin:0">كل المستندات مرتبة بالتاريخ، مع عمود «يحتاج مراجعة» وتنبيه التكرار، وصفحات الملخص السنوي والشهري وحسب النوع. للنتائج المفلترة استخدم زر Excel في صفحة المستندات.</p>
      <button class="btn primary" id="xAll" type="button">${I.dl}تنزيل Excel لكل المستندات</button></section>
    <section class="panel c3d list-tight"><h2 class="h-sec">المظهر</h2>
      <div class="filters-row">${[['auto', 'تلقائي'], ['light', 'فاتح'], ['dark', 'داكن']].map(([k, l]) => `<button class="chip" data-theme="${k}" aria-pressed="${theme === k}" type="button">${l}</button>`).join('')}</div></section>
    <section class="panel c3d list-tight"><h2 class="h-sec">البيانات</h2>
      <p class="muted" style="margin:0">البيانات محفوظة في جدول Google وصورها في Google Drive بحساب المدير، ونسخة منها في هذا الجهاز للسرعة.</p>
      <button class="btn" id="full" type="button">تحديث كامل من الخادم</button></section>
    <section class="panel c3d list-tight"><h2 class="h-sec">🛟 النسخ الاحتياطية</h2>
      <p class="muted" style="margin:0">نسخة كاملة من الجدول تنحفظ <b>تلقائيًا كل يوم</b> في مجلد «دفتر الفواتير - نسخ احتياطية» في Google Drive (آخر 60 يوم). الصور محفوظة في مجلد «دفتر الفواتير - الصور».</p>
      <div class="note" id="bkInfo">جارٍ التحقق من آخر نسخة…</div>
      ${admin ? '<button class="btn primary" id="bkNow" type="button">سوِّ نسخة احتياطية الآن</button>' : ''}</section>
    ${admin ? `<section class="c3d" id="usersBox"><h2 class="h-sec" style="padding:16px 16px 6px">المستخدمين <button class="btn small" id="addU" type="button">+ مستخدم</button></h2><div id="ulist"><div class="skeleton" style="margin:12px"></div></div></section>
    <section class="panel c3d list-tight"><h2 class="h-sec">رابط الخادم</h2><input class="input" id="srv" dir="ltr" value="${esc(apiUrl())}"><button class="btn small" id="srvSave" type="button">حفظ الرابط لهذا الجهاز</button></section>` : ''}
    <section class="panel c3d list-tight"><h2 class="h-sec">تثبيت كتطبيق</h2>
      <p class="muted" style="margin:0">أندرويد: من قائمة كروم (⋮) اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»، أو ثبّت ملف APK إذا أرسله لك المدير. آيفون: من زر المشاركة في سفاري اختر «إضافة إلى الشاشة الرئيسية».</p>
      <button class="btn" id="inst" type="button" ${deferredInstall ? '' : 'hidden'}>تثبيت الآن</button></section>
  </div>`;
  $('#out').onclick = () => logout();
  $('#xAll').onclick = () => exportXlsx(derive().rows, false);
  $$('[data-theme]').forEach(b => b.onclick = () => { lsSet('theme', b.dataset.theme); applyTheme(); vMore(); });
  $('#full').onclick = async () => { const b = $('#full'); b.disabled = true; b.textContent = 'جارٍ التحميل…'; await sync(true); b.disabled = false; b.textContent = 'تحديث كامل من الخادم'; toast('تم التحديث'); };
  const inst = $('#inst'); if (inst) inst.onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); deferredInstall = null; inst.hidden = true; };
  const paintBk = b => { const el = $('#bkInfo'); if (!el) return; el.innerHTML = b ? `✅ آخر نسخة: <b>${esc(fmtAt(b.at))}</b> · ${Number(b.rows || 0).toLocaleString('en-US')} مستند${admin && b.url ? ` · <a href="${esc(b.url)}" target="_blank" rel="noopener">فتح النسخة</a>` : ''}` : '⚠️ ما فيه نسخة احتياطية للحين. لازم المدير يحدّث الخادم ويشغّل setup.'; };
  api('status').then(j => { if (j.ok) paintBk(j.backup); else paintBk(null); }).catch(() => { const el = $('#bkInfo'); if (el) el.textContent = 'تعذر التحقق (تأكد من الإنترنت).'; });
  const bk = $('#bkNow'); if (bk) bk.onclick = async () => { bk.disabled = true; bk.textContent = 'جارٍ النسخ…'; try { const j = await api('backup'); if (!j.ok) throw new Error(j.error); paintBk(j.backup); toast('✅ انحفظت نسخة احتياطية كاملة'); } catch (e) { toast('تعذرت النسخة: ' + e.message); } finally { bk.disabled = false; bk.textContent = 'سوِّ نسخة احتياطية الآن'; } };
  if (admin) {
    $('#srvSave').onclick = () => { lsSet('api_url', $('#srv').value.trim() || null); toast('انحفظ الرابط'); };
    $('#addU').onclick = () => editUser(null);
    loadUsers();
  }
}
let usersCache = [];
async function loadUsers() {
  try { const j = await api('users'); if (!j.ok) throw new Error(j.error); usersCache = j.users; paintUsers(); }
  catch (e) { const u = $('#ulist'); if (u) u.innerHTML = `<p class="err" style="padding:12px">${esc(e.message)}</p>`; }
}
function paintUsers() {
  const u = $('#ulist'); if (!u) return;
  u.innerHTML = usersCache.map((x, i) => `<div class="user-row"><div class="avatar">${esc(x.name.charAt(0))}</div><div style="flex:1;min-width:0"><b>${esc(x.name)}</b><div class="meta">${esc(x.role)} · الرمز <bdi>${esc(x.pin)}</bdi>${x.active ? '' : ' · <span style="color:var(--rose)">موقوف</span>'}</div></div><button class="btn small" data-u="${i}" type="button">تعديل</button></div>`).join('');
  $$('[data-u]', u).forEach(b => b.onclick = () => editUser(usersCache[+b.dataset.u]));
}
function editUser(x) {
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true"><h2>${x ? 'تعديل مستخدم' : 'مستخدم جديد'}</h2>
    <div class="fields"><div class="field full"><label for="u-name">الاسم</label><input id="u-name" value="${esc(x ? x.name : '')}"></div>
    <div class="field"><label for="u-pin">رمز الدخول (4 إلى 8 أرقام)</label><input id="u-pin" inputmode="numeric" dir="ltr" value="${esc(x ? x.pin : String(Math.floor(1000 + Math.random() * 9000)))}"></div>
    <div class="field"><label for="u-role">الصلاحية</label><select id="u-role"><option value="مستخدم">مستخدم: يرفع ويعدّل</option><option value="مدير"${x && x.role === 'مدير' ? ' selected' : ''}>مدير: كل شي + الحذف والمستخدمين</option></select></div></div>
    <label class="check"><input type="checkbox" id="u-act"${!x || x.active ? ' checked' : ''}><span>فعّال (يقدر يدخل)</span></label>
    <p class="err" id="u-err"></p>
    <div class="actions-row"><button class="btn" data-close type="button">إلغاء</button><button class="btn primary" id="u-save" type="button">حفظ</button></div></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-close]')) sheet.remove(); });
  $('#u-save', sheet).onclick = async () => {
    const b = $('#u-save', sheet); b.disabled = true;
    try {
      const j = await api('saveUser', { u: { orig: x ? x.name : '', name: $('#u-name', sheet).value.trim(), pin: toLatin($('#u-pin', sheet).value.trim()), role: $('#u-role', sheet).value, active: $('#u-act', sheet).checked } });
      if (!j.ok) { $('#u-err', sheet).textContent = j.error; return; }
      usersCache = j.users; paintUsers(); sheet.remove(); toast('انحفظ المستخدم');
    } catch (e) { $('#u-err', sheet).textContent = e.message; } finally { b.disabled = false; }
  };
}

/* ================= ملف Excel ================= */
function exportXlsx(list, isFilteredList) {
  if (typeof XLSX === 'undefined') { toast('مكتبة Excel ما تحمّلت، تأكد من الإنترنت'); return; }
  if (!list.length) { toast('ما فيه مستندات للتصدير'); return; }
  const d = derive();
  const serial = s => { const [y, m, dd] = s.split('-').map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000; };
  const NF = '#,##0.000';
  const head = ['م', 'نوع المستند', 'رقم الفاتورة / العقد', 'التاريخ', 'الوصف', 'المبلغ المحتسب (ر.ع.)', 'الإجمالي التراكمي', 'السنة', 'الشهر', 'يحتاج مراجعة', 'سبب المراجعة', 'تنبيه تكرار',
    'رقم الحساب', 'فاتورة شهر', 'رقم الفاتورة المدفوعة', 'المؤجر', 'المستأجر', 'العقار', 'من تاريخ', 'إلى تاريخ', 'الإيجار الشهري', 'المدة (شهور)', 'تاريخ الإلغاء', 'المبلغ المدفوع', 'ملاحظة', 'أدخلها', 'وقت الرفع', 'رابط الصورة (Drive)'];
  const S_ = v => ({ t: 's', v: v == null ? '' : String(v) });
  const N_ = (v, z) => (v === '' || v == null || isNaN(v)) ? S_('') : Object.assign({ t: 'n', v: Number(v) }, z ? { z } : {});
  const D_ = v => v ? { t: 'n', v: serial(v), z: 'yyyy-mm-dd' } : S_('');
  const rows = [head.map(S_)];
  let run = 0;
  list.forEach((r, i) => {
    run += r._b; const dp = d.dup.get(r.id);
    rows.push([N_(i + 1), S_(TYPES[r.type].l), S_(r.no), D_(r.date), S_(r.desc), N_(r._b / 1000, NF), N_((isFilteredList ? run : d.cum.get(r.id)) / 1000, NF),
      r.date ? N_(+r.date.slice(0, 4)) : S_(''), r.date ? N_(+r.date.slice(5, 7)) : S_(''), S_(r.rv ? 'نعم' : ''), S_(r.rv ? r.why : ''), S_(dp ? 'مكررة: ' + dp.why : ''),
      S_(r.acct), S_(r.bmonth), S_(r.ref), S_(r.landlord), S_(r.tenant), S_(r.prop), D_(r.from), D_(r.to), N_(r.rent, NF), N_(r.months), D_(r.cancel), N_(r.paid, NF), S_(r.note), S_(r.by),
      r.at ? { t: 'n', v: (r.at - Date.UTC(1899, 11, 30)) / 86400000 + 4 / 24, z: 'yyyy-mm-dd hh:mm' } : S_(''),
      typeof r.img === 'string' && r.img.length > 5 ? S_('https://drive.google.com/file/d/' + r.img + '/view') : S_('')]);
  });
  const last = list.length + 1;
  rows.push([]);
  rows.push([S_(''), S_(''), S_(''), S_(''), S_('المجموع الكلي'), { t: 'n', v: list.reduce((a, r) => a + r._b, 0) / 1000, f: `SUM(F2:F${last})`, z: NF }]);
  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1['!cols'] = [6, 11, 16, 12, 40, 16, 16, 7, 7, 11, 30, 22, 14, 10, 18, 22, 22, 24, 12, 12, 12, 10, 12, 12, 50, 14, 17, 40].map(w => ({ wch: w }));
  ws1['!autofilter'] = { ref: `A1:AB${last}` };
  const ref = "'المستندات'!", F = `${ref}F2:F${last}`, H = `${ref}H2:H${last}`, Im = `${ref}I2:I${last}`, B = `${ref}B2:B${last}`;
  const ys = new Map(), ms = new Map(); let noneB = 0, noneC = 0;
  list.forEach(r => { if (!r.date) { noneB += r._b; noneC++; return; } const y = +r.date.slice(0, 4), m = +r.date.slice(5, 7); const Y = ys.get(y) || { b: 0, c: 0 }; Y.b += r._b; Y.c++; ys.set(y, Y); const k = y * 100 + m; const M = ms.get(k) || { b: 0, c: 0 }; M.b += r._b; M.c++; ms.set(k, M); });
  const y2 = [[S_('السنة'), S_('عدد المستندات'), S_('المجموع (ر.ع.)')]];
  [...ys.keys()].sort().forEach((y, i) => { const r = i + 2, Y = ys.get(y); y2.push([N_(y), { t: 'n', v: Y.c, f: `COUNTIFS(${H},A${r})` }, { t: 'n', v: Y.b / 1000, f: `SUMIFS(${F},${H},A${r})`, z: NF }]); });
  if (noneC) y2.push([S_('بدون تاريخ'), N_(noneC), N_(noneB / 1000, NF)]);
  y2.push([S_('المجموع الكلي'), { t: 'n', v: list.length, f: `SUM(B2:B${y2.length})` }, { t: 'n', v: list.reduce((a, r) => a + r._b, 0) / 1000, f: `SUM(C2:C${y2.length})`, z: NF }]);
  const ws2 = XLSX.utils.aoa_to_sheet(y2); ws2['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 18 }];
  const m3 = [[S_('السنة'), S_('رقم الشهر'), S_('الشهر'), S_('عدد المستندات'), S_('المجموع (ر.ع.)')]];
  [...ms.keys()].sort((a, b) => a - b).forEach((k, i) => { const r = i + 2, M = ms.get(k), y = Math.floor(k / 100), m = k % 100; m3.push([N_(y), N_(m), S_(MONTHS[m - 1]), { t: 'n', v: M.c, f: `COUNTIFS(${H},A${r},${Im},B${r})` }, { t: 'n', v: M.b / 1000, f: `SUMIFS(${F},${H},A${r},${Im},B${r})`, z: NF }]); });
  m3.push([S_('المجموع'), S_(''), S_(''), { t: 'n', v: list.length - noneC, f: `SUM(D2:D${m3.length})` }, { t: 'n', v: (list.reduce((a, r) => a + r._b, 0) - noneB) / 1000, f: `SUM(E2:E${m3.length})`, z: NF }]);
  const ws3 = XLSX.utils.aoa_to_sheet(m3); ws3['!cols'] = [{ wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 18 }];
  const t4 = [[S_('نوع المستند'), S_('العدد'), S_('المجموع المحتسب (ر.ع.)'), S_('ملاحظة')]];
  Object.keys(TYPES).forEach((t, i) => { const r = i + 2; const c = list.filter(x => x.type === t); t4.push([S_(TYPES[t].l), { t: 'n', v: c.length, f: `COUNTIFS(${B},A${r})` }, { t: 'n', v: c.reduce((a, x) => a + x._b, 0) / 1000, f: `SUMIFS(${F},${B},A${r})`, z: NF }, S_(INFO(t) ? 'للعلم فقط — لا يدخل في الإجمالي' : '')]); });
  t4.push([S_('المجموع'), { t: 'n', v: list.length, f: `SUM(B2:B${t4.length})` }, { t: 'n', v: list.reduce((a, r) => a + r._b, 0) / 1000, f: `SUM(C2:C${t4.length})`, z: NF }, S_('')]);
  const ws4 = XLSX.utils.aoa_to_sheet(t4); ws4['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'المستندات');
  XLSX.utils.book_append_sheet(wb, ws2, 'ملخص سنوي');
  XLSX.utils.book_append_sheet(wb, ws3, 'ملخص شهري');
  XLSX.utils.book_append_sheet(wb, ws4, 'حسب النوع');
  wb.Workbook = { Views: [{ RTL: true }] };
  const now = new Date(), p = n => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `daftar-${isFilteredList ? 'filtered-' : ''}${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.xlsx`);
  toast('تم تجهيز ملف Excel (' + list.length.toLocaleString('en-US') + ' مستند)');
}

/* ================= أدوات عامة ================= */
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3600); }
function applyTheme() { const t = lsGet('theme') || 'auto'; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

/* ================= التشغيل ================= */
async function start() {
  const v = location.hash.slice(1);
  S.view = ['home', 'docs', 'upload', 'stats', 'more'].includes(v) ? v : 'home';
  renderShell();
  $('#main').innerHTML = '<div class="view"><div class="skeleton" style="height:180px;border-radius:28px"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  const [rows, rev] = await Promise.all([DB.get('kv', 'rows'), DB.get('kv', 'rev')]);
  if (Array.isArray(rows) && rows.length) { setAll(rows); S.rev = rev || 0; refresh(); }
  await loadQueue();
  await sync(!rows || !rows.length);
  refresh();
  pump();
}
async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const pin = lsGet('pin'), user = lsGet('user');
  if (pin && user && apiUrl()) { try { S.pin = pin; S.user = JSON.parse(user); start(); return; } catch (e) {} }
  renderLogin();
}
boot();
})();
