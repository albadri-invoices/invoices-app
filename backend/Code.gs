/**
 * دفتر الفواتير — الخادم (الإصدار 3)
 * Google Sheets + Google Drive + Claude API. الواجهة: موقع/تطبيق مستقل يتصل بهذا الخادم عبر doPost.
 * البيانات: ورقة «البيانات». المستخدمون: ورقة «المستخدمين». التغييرات: ورقة «سجل التغييرات».
 * مفتاح Claude API في: إعدادات المشروع ← خصائص النص البرمجي ← ANTHROPIC_API_KEY
 * الترقية من الإصدار 2 لا تمسح أي بيانات: تضيف 3 أعمدة بعد العمود AD فقط.
 */

const CFG = {
  FAST_MODEL: 'claude-haiku-5-5',      // القراءة الأولى (سريعة ورخيصة)
  CAREFUL_MODEL: 'claude-sonnet-5-5',  // إعادة القراءة للمستندات غير الواضحة
  API_VERSION: '2026-10-21',
  DATA_SHEET: 'البيانات',
  USERS_SHEET: 'المستخدمين',
  LOG_SHEET: 'سجل التغييرات',
  IMAGES_FOLDER: 'دفتر الفواتير - الصور',
  EXPORT_FOLDER: 'دفتر الفواتير - ملفات Excel',
  APP_URL: 'https://abdoooalbadri-svg.github.io/invoices-app/',
};

const HEAD = ['المعرف', 'رقم الفاتورة / العقد', 'التاريخ', 'الوصف', 'المبلغ المحتسب (ر.ع.)', 'تحتاج مراجعة', 'سبب المراجعة',
  'ليست مكررة', 'ملف الصورة', 'بصمة الصورة', 'أدخلها', 'وقت الإدخال', 'نوع القراءة',
  'نوع المستند', 'رقم الحساب', 'رقم المشترك', 'فاتورة شهر', 'رقم الفاتورة المدفوعة', 'رقم العقد', 'المؤجر', 'المستأجر', 'العقار',
  'من تاريخ', 'إلى تاريخ', 'الإيجار الشهري', 'المدة (شهور)', 'تاريخ الإلغاء', 'المبلغ المدفوع', 'ملاحظة', 'مرتبط بـ',
  'آخر تعديل', 'مفتاح التكرار 1', 'مفتاح التكرار 2'];
const C = { id: 1, no: 2, date: 3, desc: 4, amt: 5, rv: 6, why: 7, ok: 8, img: 9, hash: 10, by: 11, at: 12, src: 13,
  type: 14, acct: 15, cons: 16, bmonth: 17, ref: 18, contract: 19, landlord: 20, tenant: 21, prop: 22,
  from: 23, to: 24, rent: 25, months: 26, cancel: 27, paid: 28, note: 29, link: 30, upd: 31, k1: 32, k2: 33 };
const NCOL = HEAD.length;
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const TYPES = { invoice: 'فاتورة', electricity: 'كهرباء', water: 'ماء', lease: 'عقد إيجار', lease_cancel: 'إلغاء عقد', receipt: 'إيصال دفع' };
const LINK_TAG = 'ربط: ';
let CURRENT_USER = '';   // اسم المستخدم الحالي (لسجل التغييرات)

/* ================= الصفحة القديمة: تحويل للنظام الجديد ================= */

function doGet() {
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div dir="rtl" style="font-family:Tahoma,sans-serif;max-width:480px;margin:15vh auto;padding:24px;text-align:center">' +
    '<h2>انتقلنا للنظام الجديد</h2><p>دفتر الفواتير صار له موقع وتطبيق جديد، وكل البيانات موجودة فيه.</p>' +
    '<p><a href="' + CFG.APP_URL + '" target="_top" style="display:inline-block;background:#0E8F74;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none">افتح النظام الجديد</a></p>' +
    '<p style="color:#666;font-size:13px">' + CFG.APP_URL + '</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('دفتر الفواتير');
}

/* ================= واجهة البرمجة (API) ================= */

function doPost(e) {
  let out;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = auth_(p.pin);
    CURRENT_USER = user.name;
    const admin = user.role === 'مدير';
    switch (p.action) {
      case 'login': out = { ok: true, user: { name: user.name, role: user.role } }; break;
      case 'all': out = apiAll_(); break;
      case 'sync': out = apiSync_(Number(p.since) || 0); break;
      case 'upload': out = apiUpload_(p, user); break;
      case 'save': out = apiSave_(p.id, p.f || {}, user); break;
      case 'delete': if (!admin) throw new Error('ADMIN_ONLY'); out = apiDelete_(p.id); break;
      case 'image': out = { ok: true, data: getImage(p.id) }; break;
      case 'users': if (!admin) throw new Error('ADMIN_ONLY'); out = { ok: true, users: listUsers_() }; break;
      case 'saveUser': if (!admin) throw new Error('ADMIN_ONLY'); out = saveUser_(p.u || {}); break;
      default: throw new Error('UNKNOWN_ACTION');
    }
  } catch (err) {
    const m = String(err && err.message || err);
    const code = m.split(':')[0];
    const msgs = {
      AUTH: 'رمز الدخول غير صحيح', LOCKED: 'محاولات دخول كثيرة. انتظر 10 دقايق وجرّب مرة ثانية',
      ADMIN_ONLY: 'هذي العملية للمدير فقط', RATE_LIMIT: 'ضغط على Claude، بيعيد المحاولة تلقائيًا', API_KEY_MISSING: 'مفتاح Claude API غير مضاف'
    };
    out = { ok: false, code: code, error: msgs[code] || m.slice(0, 300) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('FAILS') || 0);
  if (fails >= 20) throw new Error('LOCKED');
  pin = latin_(String(pin || '')).trim();
  const u = pin ? users_().filter(function (x) { return x.pin === pin && x.active; })[0] : null;
  if (!u) { cache.put('FAILS', String(fails + 1), 600); throw new Error('AUTH'); }
  return u;
}

function users_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('USERS');
  if (c) return JSON.parse(c);
  const sh = usersSheet_();
  const n = sh.getLastRow() - 1;
  const list = n > 0 ? sh.getRange(2, 1, n, 4).getValues().filter(function (r) { return r[0] && r[1]; }).map(function (r) {
    return { name: String(r[0]).trim(), pin: latin_(String(r[1])).trim(), role: String(r[2]).trim() === 'مدير' ? 'مدير' : 'مستخدم', active: String(r[3]).trim() !== 'لا' };
  }) : [];
  cache.put('USERS', JSON.stringify(list), 120);
  return list;
}

function listUsers_() { return users_().map(function (u) { return { name: u.name, pin: u.pin, role: u.role, active: u.active }; }); }

function saveUser_(u) {
  const name = String(u.name || '').trim(), pin = latin_(String(u.pin || '')).trim();
  if (!name) throw new Error('اكتب اسم المستخدم');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('رمز الدخول لازم يكون من 4 إلى 8 أرقام');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = usersSheet_();
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 4).getValues() : [];
    const orig = String(u.orig || '').trim();
    let at = -1;
    rows.forEach(function (r, i) {
      if (orig && String(r[0]).trim() === orig) at = i;
    });
    rows.forEach(function (r, i) {
      if (i !== at && latin_(String(r[1])).trim() === pin) throw new Error('هذا الرمز مستخدم لشخص ثاني، اختر رمز ثاني');
      if (i !== at && String(r[0]).trim() === name) throw new Error('هذا الاسم موجود، اختر اسم ثاني');
    });
    const row = [name, pin, u.role === 'مدير' ? 'مدير' : 'مستخدم', u.active === false ? 'لا' : 'نعم'];
    if (at >= 0) sh.getRange(at + 2, 1, 1, 4).setValues([row]); else sh.appendRow(row);
    const admins = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().filter(function (r) { return r[2] === 'مدير' && r[3] !== 'لا'; });
    if (!admins.length) throw new Error('لازم يبقى مدير واحد فعّال على الأقل');
  } finally { lock.releaseLock(); CacheService.getScriptCache().remove('USERS'); }
  return { ok: true, users: listUsers_() };
}

/* ================= التهيئة / الترقية (آمنة على البيانات) ================= */

function setup() {
  const sh = sheet_();
  if (sh.getMaxColumns() < NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), NCOL - sh.getMaxColumns());
  sh.getRange(1, 1, 1, NCOL).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
  ['B', 'C', 'J', 'O', 'P', 'Q', 'R', 'S', 'W', 'X', 'AA', 'AF', 'AG'].forEach(function (c) { sh.getRange(c + ':' + c).setNumberFormat('@'); });
  ['E', 'Y', 'AB'].forEach(function (c) { sh.getRange(c + ':' + c).setNumberFormat('#,##0.000'); });
  folderId_(CFG.IMAGES_FOLDER);
  // تعبئة مفاتيح التكرار ووقت التعديل للسجلات الموجودة (أعمدة جديدة فقط)
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const vals = sh.getRange(2, 1, n, NCOL).getValues();
    const now = Date.now();
    const add = vals.map(function (r) { const d = rowObj_(r); const k = keys_(d); return [d.upd || now, k[0], k[1]]; });
    sh.getRange(2, C.upd, n, 3).setValues(add);
  }
  logSheet_();
  const us = usersSheet_();
  let pinMsg = '';
  if (us.getLastRow() < 2) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    us.appendRow(['المدير', pin, 'مدير', 'نعم']);
    pinMsg = ' رمز دخول المدير: ' + pin + ' (تقدر تغيّره من الإعدادات داخل النظام).';
  } else {
    pinMsg = ' المستخدمين موجودين في ورقة «المستخدمين».';
  }
  CacheService.getScriptCache().remove('USERS');
  const text = callClaude_(CFG.FAST_MODEL, [{ type: 'text', text: 'Reply with only the word OK.' }], null, 'low');
  Logger.log('تم التجهيز بنجاح. عدد السجلات الموجودة: ' + Math.max(0, n) + '. رد Claude: ' + text + '.' + pinMsg);
}

function usersSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.USERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.USERS_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([['الاسم', 'رمز الدخول', 'الصلاحية (مدير / مستخدم)', 'فعّال (نعم / لا)']]).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('@');
    sh.setRightToLeft(true); sh.setFrozenRows(1);
  }
  return sh;
}
function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.LOG_SHEET);
    sh.getRange(1, 1, 1, 5).setValues([['رقم التغيير', 'المعرف', 'العملية', 'الوقت', 'المستخدم']]).setFontWeight('bold');
    sh.setRightToLeft(true); sh.setFrozenRows(1);
  }
  return sh;
}
function rev_() { return Math.max(0, logSheet_().getLastRow() - 1); }
function logChange_(id, op) {
  const sh = logSheet_();
  const rev = sh.getLastRow();   // رقم التغيير = رقم الصف - 1 بعد الإضافة
  sh.appendRow([rev, id, op, new Date(), CURRENT_USER]);
}
function touch_(sh, rowNum, id) {
  sh.getRange(rowNum, C.upd).setValue(Date.now());
  logChange_(id, 'u');
}

/* ================= قراءة البيانات للتطبيق ================= */

const WIRE = ['id', 'type', 'no', 'date', 'desc', 'amt', 'rv', 'why', 'ok', 'img', 'hash', 'by', 'at', 'src', 'acct', 'cons', 'bmonth', 'ref',
  'contract', 'landlord', 'tenant', 'prop', 'from', 'to', 'rent', 'months', 'cancel', 'paid', 'note', 'link', 'upd'];
function wire_(d) {
  return WIRE.map(function (k) {
    const v = d[k];
    if (k === 'img') return v ? 1 : 0;
    if (k === 'rv' || k === 'ok') return v ? 1 : 0;
    return v == null ? '' : v;
  });
}

function apiAll_() {
  const sh = sheet_();
  const rev = rev_();
  const n = sh.getLastRow() - 1;
  const vals = n > 0 ? sh.getRange(2, 1, n, NCOL).getValues() : [];
  return { ok: true, rev: rev, fields: WIRE, rows: vals.filter(function (r) { return r[0]; }).map(function (r) { return wire_(rowObj_(r)); }) };
}

function apiSync_(since) {
  const rev = rev_();
  if (since >= rev) return { ok: true, rev: rev, rows: [], del: [] };
  if (rev - since > 3000) return { ok: true, reset: true, rev: rev };
  const lg = logSheet_().getRange(since + 2, 1, rev - since, 3).getValues();
  const ups = {}, dels = {};
  lg.forEach(function (r) { const id = String(r[1]); if (r[2] === 'd') { dels[id] = 1; delete ups[id]; } else { ups[id] = 1; delete dels[id]; } });
  const ids = Object.keys(ups);
  const sh = sheet_();
  let rows = [];
  if (ids.length > 150) {
    const n = sh.getLastRow() - 1;
    const vals = n > 0 ? sh.getRange(2, 1, n, NCOL).getValues() : [];
    vals.forEach(function (r) { if (ups[String(r[0])]) rows.push(wire_(rowObj_(r))); });
  } else {
    ids.forEach(function (id) { const rn = findRow_(sh, C.id, id); if (rn) rows.push(wire_(rowObj_(sh.getRange(rn, 1, 1, NCOL).getValues()[0]))); });
  }
  return { ok: true, rev: rev, fields: WIRE, rows: rows, del: Object.keys(dels) };
}

/* ================= منع التكرار ================= */

function keys_(d) {
  const n = normNo_(d.no);
  const acct = normNo_(d.acct || d.cons).replace(/[A-Z]$/, '');
  const b = d.amt == null ? '' : Math.round(Number(d.amt) * 1000);
  switch (d.type) {
    case 'invoice': return [n && b !== '' ? 'inv|' + n + '|' + b : '', !n && d.date && b !== '' && b > 0 ? 'inv0|' + d.date + '|' + b + '|' + normName_(d.desc) : ''];
    case 'electricity': case 'water': return [acct && d.bmonth ? 'ut|' + d.type + '|' + acct + '|' + d.bmonth : '', n ? 'utb|' + n : ''];
    case 'lease': return [n ? 'ls|' + n : '', ''];
    case 'lease_cancel': return [n ? 'lc|' + n + '|' + (d.cancel || '') : '', ''];
    case 'receipt': return [n ? 'rc|' + n : '', ''];
  }
  return ['', ''];
}
function normName_(s) { return String(s || '').replace(/[\s\-–_.,()]+/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase().slice(0, 12); }

// يرجع {v: السجل الموجود, why: السبب} أو null
function findDup_(sh, d, selfId) {
  const k = keys_(d);
  const cands = [];
  [k[0], k[1]].forEach(function (key) {
    if (!key) return;
    [C.k1, C.k2].forEach(function (col) { findAll_(sh, col, key).forEach(function (r) { cands.push(r); }); });
  });
  if (d.hash) findAll_(sh, C.hash, d.hash).forEach(function (r) { cands.push(r); });
  for (let i = 0; i < cands.length; i++) {
    const v = rowObj_(sh.getRange(cands[i], 1, 1, NCOL).getValues()[0]);
    if (!v.id || v.id === selfId) continue;
    return { v: v, why: dupWhy_(d, v) };
  }
  return null;
}
function dupWhy_(d, v) {
  if (d.hash && d.hash === v.hash) return 'نفس الصورة مرفوعة من قبل';
  switch (d.type) {
    case 'invoice': return 'فاتورة بنفس الرقم ' + (v.no || '') + ' ونفس المبلغ ' + fmt3_(v.amt || 0) + ' موجودة من قبل';
    case 'electricity': case 'water':
      return (v.bmonth && v.bmonth === d.bmonth ? 'فاتورة ' + TYPES[d.type] + ' لنفس الحساب ' + (v.acct || d.acct) + ' ونفس الشهر ' + monthName_(v.bmonth) : 'فاتورة بنفس الرقم ' + v.no) + ' موجودة من قبل';
    case 'lease': return 'عقد الإيجار رقم ' + v.no + ' موجود من قبل';
    case 'lease_cancel': return 'إلغاء العقد رقم ' + v.no + ' بنفس تاريخ الإلغاء موجود من قبل';
    case 'receipt': return 'الإيصال رقم ' + v.no + ' موجود من قبل';
  }
  return 'المستند موجود من قبل';
}
function dupInfo_(v) {
  return { id: v.id, type: v.type, no: v.no, date: v.date, desc: v.desc, amt: v.amt, by: v.by, at: v.at };
}

/* ================= رفع مستند جديد ================= */

function apiUpload_(p, user) {
  if (!p || !p.b64) throw new Error('الصورة فاضية');
  const sh = sheet_();
  if (p.hash) {
    const hr = findRow_(sh, C.hash, p.hash);
    if (hr) { const v = rowObj_(sh.getRange(hr, 1, 1, NCOL).getValues()[0]); return { ok: true, status: 'duplicate', reason: 'نفس الصورة مرفوعة من قبل', existing: dupInfo_(v) }; }
  }
  let r = extract_(p.b64, CFG.FAST_MODEL, 'low');
  let d = toDoc_(r);
  let src = 'سريعة';
  if (d.rv && CFG.CAREFUL_MODEL) {
    const r2 = extract_(p.b64, CFG.CAREFUL_MODEL, 'medium');
    if (r2.ok) { d = toDoc_(r2); src = 'دقيقة'; }
  }
  d.hash = p.hash || '';
  // فحص التكرار قبل حفظ الصورة
  let dup = findDup_(sh, d, '');
  if (dup) return { ok: true, status: 'duplicate', reason: dup.why, existing: dupInfo_(dup.v), read: { type: d.type, no: d.no, amt: d.amt, date: d.date } };

  const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const name = (d.date || 'بدون-تاريخ') + '_' + TYPES[d.type] + '_' + String(d.no || 'بدون-رقم').replace(/[\\/:*?"<>|]/g, '-') + '_' + id + '.jpg';
  const file = DriveApp.getFolderById(folderId_(CFG.IMAGES_FOLDER))
    .createFile(Utilities.newBlob(Utilities.base64Decode(p.b64), 'image/jpeg', name));

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let row;
  try {
    dup = findDup_(sh, d, '');   // فحص ثاني داخل القفل (رفع متزامن من شخصين)
    if (dup) { file.setTrashed(true); return { ok: true, status: 'duplicate', reason: dup.why, existing: dupInfo_(dup.v) }; }
    d.id = id; d.img = file.getId(); d.by = user.name; d.at = new Date(); d.src = src;
    sh.appendRow(toRow_(d));
    const rn = sh.getLastRow();
    logChange_(id, 'u');
    relink_(sh, rn);
    row = wire_(rowObj_(sh.getRange(rn, 1, 1, NCOL).getValues()[0]));
  } finally { lock.releaseLock(); }
  return { ok: true, status: 'saved', fields: WIRE, row: row, rev: rev_() };
}

/* ================= التعديل والحذف ================= */

function apiSave_(id, f, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_();
    let rowNum = 0, d = blankDoc_();
    if (id) {
      rowNum = findRow_(sh, C.id, id);
      if (!rowNum) throw new Error('السجل انحذف');
      d = rowObj_(sh.getRange(rowNum, 1, 1, NCOL).getValues()[0]);
    }
    const old = { type: d.type, contract: d.contract, no: d.no };
    const t = TYPES[f.type] ? f.type : d.type;
    const num = function (v) { if (v === '' || v == null) return null; const n = Number(latin_(String(v)).replace(/[,٬\s]/g, '').replace('٫', '.')); if (isNaN(n)) throw new Error('رقم غير صحيح: ' + v); return round3_(n); };
    d.type = t; d.no = latin_(String(f.no || '')).trim() || null; d.desc = String(f.desc || '').slice(0, 300) || null;
    d.rv = !!f.rv; d.why = f.rv ? String(f.why || d.why || '') : ''; d.ok = !!f.ok;
    d.acct = String(f.acct || '').trim(); d.cons = String(f.cons || '').trim(); d.bmonth = cleanMonth_(f.bmonth);
    d.ref = String(f.ref || '').trim(); d.landlord = String(f.landlord || '').trim(); d.tenant = String(f.tenant || '').trim();
    d.prop = String(f.prop || '').trim(); d.from = cleanDate_(f.from) || ''; d.to = cleanDate_(f.to) || '';
    d.rent = num(f.rent); d.cancel = cleanDate_(f.cancel) || ''; d.paid = num(f.paid);
    d.date = cleanDate_(f.date);
    d.amt = num(f.amt);
    if (t === 'lease' || t === 'lease_cancel') { d.contract = d.no || ''; d.months = (d.from && d.to) ? monthsBetween_(d.from, d.to) : null; }
    if (t === 'lease') { if (d.rent != null && d.months) d.amt = round3_(d.rent * d.months); if (d.from) d.date = d.from; }
    if (t === 'lease_cancel') { d.amt = 0; if (d.cancel) d.date = d.cancel; }
    if (t === 'receipt') d.amt = 0;
    if ((t === 'electricity' || t === 'water') && d.bmonth) d.date = d.bmonth + '-01';
    if (t === 'invoice') { d.acct = d.cons = d.bmonth = d.ref = d.contract = d.landlord = d.tenant = d.from = d.to = d.cancel = ''; d.rent = d.months = d.paid = null; d.note = ''; d.link = ''; }
    // منع التكرار عند التعديل أو الإضافة اليدوية (إلا إذا كان معلّم «ليست مكررة»)
    if (!d.ok) {
      const dup = findDup_(sh, Object.assign({}, d, { hash: '' }), d.id || '');
      if (dup) return { ok: false, code: 'DUPLICATE', error: 'ما انحفظ: ' + dup.why, existing: dupInfo_(dup.v) };
    }
    if (!id) { d.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); d.by = user.name; d.at = new Date(); d.src = 'يدوي'; }
    if (rowNum) sh.getRange(rowNum, 1, 1, NCOL).setValues([toRow_(d)]);
    else { sh.appendRow(toRow_(d)); rowNum = sh.getLastRow(); }
    logChange_(d.id, 'u');
    relink_(sh, rowNum);
    if (old.type === 'lease' && old.contract && old.contract !== d.contract)
      rows_(sh, findAll_(sh, C.contract, old.contract)).forEach(function (o) { if (o.v.type === 'lease_cancel') linkCancel_(sh, o.r, o.v); });
    if ((old.type === 'electricity' || old.type === 'water') && old.no && old.no !== d.no)
      rows_(sh, findAll_(sh, C.ref, old.no)).forEach(function (o) { if (o.v.type === 'receipt') linkReceipt_(sh, o.r, o.v); });
    return { ok: true, fields: WIRE, row: wire_(rowObj_(sh.getRange(rowNum, 1, 1, NCOL).getValues()[0])), rev: rev_() };
  } finally { lock.releaseLock(); }
}

function apiDelete_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_();
    const r = findRow_(sh, C.id, id);
    if (!r) return { ok: true, rev: rev_() };
    const v = rowObj_(sh.getRange(r, 1, 1, NCOL).getValues()[0]);
    if (v.img) { try { DriveApp.getFileById(v.img).setTrashed(true); } catch (e) {} }
    sh.deleteRow(r);
    logChange_(id, 'd');
    if (v.type === 'lease' && v.contract)
      rows_(sh, findAll_(sh, C.contract, v.contract)).forEach(function (o) { if (o.v.type === 'lease_cancel') linkCancel_(sh, o.r, o.v); });
    if ((v.type === 'electricity' || v.type === 'water') && v.no)
      rows_(sh, findAll_(sh, C.ref, v.no)).forEach(function (o) { if (o.v.type === 'receipt') linkReceipt_(sh, o.r, o.v); });
  } finally { lock.releaseLock(); }
  return { ok: true, rev: rev_() };
}

function getImage(id) {
  const sh = sheet_();
  const r = findRow_(sh, C.id, id);
  if (!r) return null;
  const fid = sh.getRange(r, C.img).getValue();
  if (!fid) return null;
  try { return 'data:image/jpeg;base64,' + Utilities.base64Encode(DriveApp.getFileById(fid).getBlob().getBytes()); }
  catch (e) { return null; }
}

const PROMPT = [
  'You are reading a phone photo of ONE document from Oman. First decide doc_type:',
  '- "electricity": an electricity bill (فاتورة الكهرباء, Electricity Bill, e.g. Muscat Electricity Distribution / MEDC, Mazoon, Majan).',
  '- "water": a water bill (Water Bill, فاتورة المياه, e.g. Diam / ديم, Haya, PAEW).',
  '- "receipt": a payment receipt for a utility bill (e.g. Khedmah / OIFC, bank or kiosk receipt showing Account No, Bill Number, Paid Amount).',
  '- "lease": a tenancy / rent agreement (عقد إيجار, Tenancy Agreement).',
  '- "lease_cancel": a lease cancellation certificate (شهادة إلغاء عقد إيجار).',
  '- "invoice": any other purchase invoice, receipt or bill.',
  'Then fill the fields. Every field is a string: use an empty string "" for anything not present or not readable. Convert Arabic-Indic digits to Western digits.',
  'Dates are YYYY-MM-DD (Gregorian); printed dates in Oman are usually day-first. Months are YYYY-MM.',
  'Amounts are written as plain digit strings in Omani rial, e.g. "12.500" (3 decimals: twelve and a half rials). No currency text, no thousands separators.',
  '',
  'For "invoice": invoice_no, date (invoice date), description (max 80 chars, Arabic if the invoice is Arabic, start with vendor name), amount = FINAL total payable.',
  'For "electricity" / "water": invoice_no = Bill No. (رقم الفاتورة); account_no = Account No. (رقم الحساب); consumer_no = Consumer No. (رقم المشترك);',
  '  bill_month = the "Bill Month / فاتورة شهر" as YYYY-MM (e.g. "May 2019" -> 2019-05, "042019" -> 2019-04); date = Bill Date;',
  '  current_month_dues = "Total Current Month Dues / إجمالي مستحقات الشهر الحالي" ONLY (never the Total Payable Amount, never previous outstanding);',
  '  total_payable = "Total Payable Amount / إجمالي المستحقات"; property = the address / flat / shop line; description = company name.',
  'For "receipt": invoice_no = receipt number; bill_no = the Bill Number being paid; account_no = the Account No printed on the receipt;',
  '  service = "electricity" or "water" (MEDC / Mazoon / Majan = electricity; Diam / Haya / PAEW water = water); paid_amount = Paid Amount; date = payment date (stamp or printed).',
  'For "lease": contract_no = the contract number printed as "No." on the form (usually red, top-left); landlord = المؤجر name; tenant = المستأجر name;',
  '  property = flat/shop no, building no, area; start_date; end_date; monthly_rent = القيمة الإيجارية الشهرية (if only a yearly rent is shown, divide by 12).',
  'For "lease_cancel": contract_no = "رقم نموذج العقد" (NOT رقم الحفظ and NOT رقم الطلب); landlord; tenant; property (building / unit / area);',
  '  start_date and end_date of the cancelled contract; cancel_date = تاريخ إلغاء العقد; monthly_rent if a value is visible, else null.',
  '',
  'confidence: 0 to 1 for the key fields of this doc_type. issues: short Arabic notes about anything unclear (empty if all clear).',
  'not_invoice: true only if the image is none of the above.'
].join('\n');

// كل الحقول نصوص ("" = غير موجود) — واجهة Claude تمنع كثرة الحقول ذات النوعين
const NS = { type: 'string' }, NN = { type: 'string' };
const SCHEMA = {
  type: 'object',
  properties: {
    doc_type: { type: 'string', enum: ['invoice', 'electricity', 'water', 'receipt', 'lease', 'lease_cancel'] },
    invoice_no: NS, date: NS, description: NS, amount: NN,
    account_no: NS, consumer_no: NS, bill_month: NS, current_month_dues: NN, total_payable: NN,
    bill_no: NS, service: NS, paid_amount: NN,
    contract_no: NS, landlord: NS, tenant: NS, property: NS, start_date: NS, end_date: NS, monthly_rent: NN, cancel_date: NS,
    currency: { type: 'string' }, confidence: { type: 'number' }, issues: { type: 'array', items: { type: 'string' } }, not_invoice: { type: 'boolean' }
  },
  required: ['doc_type', 'invoice_no', 'date', 'description', 'amount', 'account_no', 'consumer_no', 'bill_month', 'current_month_dues',
    'total_payable', 'bill_no', 'service', 'paid_amount', 'contract_no', 'landlord', 'tenant', 'property', 'start_date', 'end_date',
    'monthly_rent', 'cancel_date', 'currency', 'confidence', 'issues', 'not_invoice'],
  additionalProperties: false
};

function extract_(b64, model, effort) {
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
    { type: 'text', text: PROMPT }
  ];
  try {
    const text = callClaude_(model, content, SCHEMA, effort);
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    if (String(e.message).indexOf('RATE_LIMIT') === 0 || String(e.message).indexOf('API_') === 0) throw e;
    return { ok: false, err: 'ما انقرأت: ' + String(e.message).slice(0, 80) };
  }
}

function callClaude_(model, content, schema, effort) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('API_KEY_MISSING: أضف ANTHROPIC_API_KEY في خصائص النص البرمجي');
  const body = { model: model, max_tokens: 4000, messages: [{ role: 'user', content: content }], output_config: { effort: effort } };
  if (schema) body.output_config.format = { type: 'json_schema', schema: schema };
  const opts = {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': CFG.API_VERSION },
    payload: JSON.stringify(body)
  };
  let res;
  for (let i = 0; i < 3; i++) {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', opts);
    const code = res.getResponseCode();
    if (code === 429) throw new Error('RATE_LIMIT');
    if (code === 529 || code >= 500) { Utilities.sleep(2000 * (i + 1)); continue; }
    break;
  }
  const code = res.getResponseCode();
  const json = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) throw new Error('API_' + code + ': ' + (json.error && json.error.message || 'خطأ'));
  if (json.stop_reason === 'refusal') throw new Error('رفض القراءة');
  const t = (json.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  if (!t) throw new Error('رد فاضي');
  return t;
}

/* ================= تحويل نتيجة القراءة إلى سجل ================= */

function blankDoc_() {
  return { type: 'invoice', no: null, date: null, desc: null, amt: null, rv: false, why: '', ok: false,
    acct: '', cons: '', bmonth: '', ref: '', contract: '', landlord: '', tenant: '', prop: '',
    from: '', to: '', rent: null, months: null, cancel: '', paid: null, note: '', link: '' };
}

function toDoc_(r) {
  const d = blankDoc_();
  const why = [];
  if (!(r.ok && r.data)) { d.rv = true; d.why = r.err || 'ما انقرأت'; return d; }
  const x = r.data;
  const s = function (v, n) { return v == null || String(v).trim() === '' ? '' : latin_(String(v)).trim().slice(0, n || 120); };
  const num = function (v) {
    if (typeof v === 'number') return isFinite(v) ? round3_(v) : null;
    if (v == null || String(v).trim() === '') return null;
    const n = parseFloat(latin_(String(v)).replace(/٫/g, '.').replace(/[,٬\s]/g, '').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? round3_(n) : null;
  };
  d.type = TYPES[x.doc_type] ? x.doc_type : 'invoice';
  if (x.not_invoice) why.push('قد لا يكون مستند مالي');

  if (d.type === 'invoice') {
    d.no = s(x.invoice_no, 60) || null; d.date = cleanDate_(x.date); d.desc = s(x.description, 160) || null; d.amt = num(x.amount);
    if (!d.no) why.push('رقم الفاتورة غير موجود');
    if (!d.date) why.push('التاريخ غير مقروء');
    if (d.amt == null) why.push('المبلغ غير مقروء');
    if (x.currency && String(x.currency).toUpperCase() !== 'OMR') why.push('العملة ' + x.currency);
  } else if (d.type === 'electricity' || d.type === 'water') {
    d.no = s(x.invoice_no || x.bill_no, 60) || null; d.acct = s(x.account_no, 40); d.cons = s(x.consumer_no, 40);
    d.bmonth = cleanMonth_(x.bill_month); d.amt = num(x.current_month_dues); d.prop = s(x.property, 120);
    d.date = d.bmonth ? d.bmonth + '-01' : cleanDate_(x.date);
    d.desc = 'فاتورة ' + TYPES[d.type] + (d.acct ? ' – حساب ' + d.acct : '') + (d.bmonth ? ' – ' + monthName_(d.bmonth) : '') + (x.description ? ' – ' + s(x.description, 50) : '');
    const tp = num(x.total_payable);
    if (tp != null && d.amt != null && Math.abs(tp - d.amt) > 0.0005)
      d.note = 'إجمالي المستحقات في الفاتورة ' + fmt3_(tp) + ' (يشمل متأخرات ' + fmt3_(tp - d.amt) + ') — المحتسب مستحقات الشهر الحالي فقط.';
    if (!d.no) why.push('رقم الفاتورة غير موجود');
    if (!d.acct) why.push('رقم الحساب غير مقروء');
    if (!d.bmonth) why.push('شهر الفاتورة غير مقروء');
    if (d.amt == null) why.push('مستحقات الشهر الحالي غير مقروءة');
  } else if (d.type === 'receipt') {
    d.no = s(x.invoice_no, 60) || null; d.ref = s(x.bill_no, 60); d.acct = s(x.account_no, 40); d.paid = num(x.paid_amount);
    d.date = cleanDate_(x.date); d.amt = 0;
    const svc = String(x.service || '').toLowerCase();
    d.prop = svc.indexOf('water') >= 0 ? 'ماء' : (svc.indexOf('elec') >= 0 ? 'كهرباء' : '');
    d.desc = 'إيصال دفع' + (d.prop ? ' ' + d.prop : '') + (d.acct ? ' – حساب ' + d.acct : '') + (d.ref ? ' – فاتورة ' + d.ref : '');
    if (!d.ref && !d.acct) why.push('رقم الفاتورة ورقم الحساب غير مقروءين');
    if (d.paid == null) why.push('المبلغ المدفوع غير مقروء');
  } else if (d.type === 'lease') {
    d.contract = s(x.contract_no, 40); d.no = d.contract || null; d.landlord = s(x.landlord); d.tenant = s(x.tenant); d.prop = s(x.property);
    d.from = cleanDate_(x.start_date) || ''; d.to = cleanDate_(x.end_date) || ''; d.rent = num(x.monthly_rent);
    d.months = (d.from && d.to) ? monthsBetween_(d.from, d.to) : null;
    d.amt = (d.rent != null && d.months) ? round3_(d.rent * d.months) : null;
    d.date = d.from || null;
    d.desc = 'عقد إيجار' + (d.contract ? ' رقم ' + d.contract : '') + (d.prop ? ' – ' + d.prop : '') + (d.tenant ? ' – المستأجر: ' + d.tenant : '');
    if (!d.contract) why.push('رقم العقد غير مقروء');
    if (!d.from || !d.to) why.push('مدة العقد غير مقروءة');
    if (d.rent == null) why.push('الإيجار الشهري غير مقروء');
  } else if (d.type === 'lease_cancel') {
    d.contract = s(x.contract_no, 40); d.no = d.contract || null; d.landlord = s(x.landlord); d.tenant = s(x.tenant); d.prop = s(x.property);
    d.from = cleanDate_(x.start_date) || ''; d.to = cleanDate_(x.end_date) || ''; d.rent = num(x.monthly_rent);
    d.months = (d.from && d.to) ? monthsBetween_(d.from, d.to) : null;
    d.cancel = cleanDate_(x.cancel_date) || ''; d.date = d.cancel || null; d.amt = 0;
    d.desc = 'إلغاء عقد إيجار' + (d.contract ? ' رقم ' + d.contract : '') + (d.tenant ? ' – المستأجر: ' + d.tenant : '');
    if (!d.contract) why.push('رقم العقد غير مقروء');
    if (!d.cancel) why.push('تاريخ الإلغاء غير مقروء');
  }
  if (typeof x.confidence !== 'number' || x.confidence < 0.8) why.push('ثقة القراءة منخفضة');
  (x.issues || []).slice(0, 3).forEach(function (t) { if (t) why.push(String(t).slice(0, 60)); });
  const uniq = why.filter(function (v, i, a) { return a.indexOf(v) === i; });
  d.rv = uniq.length > 0; d.why = uniq.join('، ');
  return d;
}

/* ================= الربط: العقد ↔ الإلغاء، الفاتورة ↔ الإيصال ================= */

// يُستدعى داخل القفل بعد إضافة/تعديل سجل في الصف rowNum
function relink_(sh, rowNum) {
  const me = rowObj_(sh.getRange(rowNum, 1, 1, NCOL).getValues()[0]);
  if (me.type === 'lease_cancel') linkCancel_(sh, rowNum, me);
  else if (me.type === 'receipt') linkReceipt_(sh, rowNum, me);
  else if (me.type === 'lease') {
    rows_(sh, findAll_(sh, C.contract, me.contract)).forEach(function (o) { if (o.v.type === 'lease_cancel') linkCancel_(sh, o.r, o.v); });
    // إلغاءات غير مربوطة تطابق المؤجر والمستأجر والتواريخ
    const all = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, NCOL).getValues() : [];
    all.forEach(function (row, i) {
      const v = rowObj_(row);
      if (v.type === 'lease_cancel' && !v.link && v.contract !== me.contract && v.from && v.from === me.from && (!v.to || v.to === me.to) &&
        similar_(v.landlord, me.landlord) && similar_(v.tenant, me.tenant)) linkCancel_(sh, i + 2, v);
    });
  }
  else if (me.type === 'electricity' || me.type === 'water') rows_(sh, findAll_(sh, C.ref, me.no)).forEach(function (o) { if (o.v.type === 'receipt') linkReceipt_(sh, o.r, o.v); });
}

function linkCancel_(sh, rowNum, c) {
  let lease = null;
  if (c.contract) lease = rows_(sh, findAll_(sh, C.contract, c.contract)).filter(function (o) { return o.v.type === 'lease'; })[0] || null;
  let how = 'رقم العقد';
  if (!lease && (c.landlord || c.tenant)) {   // بديل: المؤجر + المستأجر + المدة
    const all = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, NCOL).getValues() : [];
    for (let i = 0; i < all.length && !lease; i++) {
      const v = rowObj_(all[i]);
      if (v.type !== 'lease') continue;
      const sameParties = similar_(v.landlord, c.landlord) && similar_(v.tenant, c.tenant);
      const sameDates = c.from && v.from === c.from && (!c.to || v.to === c.to);
      if (sameParties && sameDates) { lease = { r: i + 2, v: v }; how = 'المؤجر والمستأجر وتواريخ العقد'; }
    }
  }
  const L = lease ? lease.v : null;
  const months = (L && L.months) || c.months || null;
  const rent = (L && L.rent != null) ? L.rent : (c.rent != null ? c.rent : (L && L.amt && months ? L.amt / months : null));
  const start = (L && L.from) || c.from;
  const end = (L && L.to) || c.to;
  const parts = ['إلغاء عقد إيجار' + (c.contract ? ' رقم ' + c.contract : '')];
  if (c.landlord || (L && L.landlord)) parts.push('المؤجر: ' + (c.landlord || L.landlord));
  if (c.tenant || (L && L.tenant)) parts.push('المستأجر: ' + (c.tenant || L.tenant));
  parts.push('تاريخ الإلغاء: ' + (c.cancel || 'غير مقروء'));
  if (start && end) parts.push('مدة العقد: ' + start + ' إلى ' + end);
  if (rent != null && months) {
    const total = round3_(rent * months);
    parts.push('مبلغ العقد الأصلي: ' + fmt3_(total) + ' (' + fmt3_(rent) + ' × ' + months + ' شهر)');
    if (c.cancel && start) {
      let used = monthsElapsed_(start, c.cancel);
      used = Math.max(0, Math.min(months, used));
      parts.push('انقضى: ' + used + ' شهر = ' + fmt3_(rent * used));
      parts.push('المتبقي: ' + (months - used) + ' شهر = ' + fmt3_(rent * (months - used)));
      if (end && c.cancel > end) parts.push('الإلغاء صار بعد انتهاء العقد');
    }
  }
  parts.push('للعلم فقط — لا يُخصم من إجمالي الصرف');
  let linkWhy = '';
  if (L) parts.push('مرتبط بالعقد الأصلي (حسب ' + how + ')');
  else linkWhy = 'ما لقيت العقد الأصلي' + (c.contract ? ' رقم ' + c.contract : '') + ' في النظام';
  writeLink_(sh, rowNum, c, parts.join(' · '), L ? L.id : '', linkWhy);
}

function linkReceipt_(sh, rowNum, rc) {
  const byNo = rc.ref ? rows_(sh, findAll_(sh, C.no, rc.ref)).filter(function (o) { return o.v.type === 'electricity' || o.v.type === 'water'; }) : [];
  let bill = null, linkWhy = '';
  const full = byNo.filter(function (o) { return sameAcct_(o.v, rc.acct); })[0];
  if (full) bill = full;
  else if (byNo.length) { bill = byNo[0]; linkWhy = 'رقم الفاتورة مطابق لكن رقم الحساب مختلف'; }
  else if (rc.acct) {
    const all = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, NCOL).getValues() : [];
    const cands = [];
    all.forEach(function (row, i) { const v = rowObj_(row); if ((v.type === 'electricity' || v.type === 'water') && sameAcct_(v, rc.acct)) cands.push({ r: i + 2, v: v }); });
    if (cands.length) {
      cands.sort(function (a, b) { return String(a.v.bmonth) < String(b.v.bmonth) ? 1 : -1; });
      bill = cands.filter(function (o) { return !rc.date || String(o.v.date) <= rc.date; })[0] || cands[0];
      linkWhy = 'رقم الحساب مطابق لكن رقم الفاتورة ' + (rc.ref ? 'مختلف' : 'غير مقروء');
    } else linkWhy = 'ما لقيت الفاتورة الأصلية في النظام';
  } else linkWhy = 'ما لقيت الفاتورة الأصلية في النظام';
  const B = bill ? bill.v : null;
  const parts = ['إيصال دفع' + (rc.prop ? ' ' + rc.prop : '') + (rc.acct ? ' · حساب ' + rc.acct : '') + (rc.ref ? ' · فاتورة رقم ' + rc.ref : '')];
  if (B) parts.push('للفاتورة: ' + TYPES[B.type] + (B.bmonth ? ' شهر ' + monthName_(B.bmonth) : '') + ' · مستحقات الشهر ' + fmt3_(B.amt || 0));
  parts.push('المدفوع: ' + (rc.paid != null ? fmt3_(rc.paid) : 'غير مقروء') + (rc.date ? ' بتاريخ ' + rc.date : ''));
  parts.push('للعلم فقط — لا يُخصم من إجمالي الصرف');
  writeLink_(sh, rowNum, rc, parts.join(' · '), B ? B.id : '', linkWhy);
}


function writeLink_(sh, rowNum, v, note, linkId, linkWhy) {
  const reasons = String(v.why || '').split('، ').filter(function (t) { return t && t.indexOf(LINK_TAG) !== 0; });
  if (linkWhy) reasons.push(LINK_TAG + linkWhy);
  sh.getRange(rowNum, C.rv, 1, 2).setValues([[reasons.length ? 'نعم' : '', reasons.join('، ')]]);
  sh.getRange(rowNum, C.note, 1, 2).setValues([[note, linkId]]);
  touch_(sh, rowNum, v.id);
}

/* ================= أدوات ================= */

function rowObj_(r) {
  const g = function (c) { return r[c - 1]; };
  const str = function (c) { const v = g(c); return v == null ? '' : String(v); };
  const num = function (c) { const v = g(c); if (v === '' || v == null) return null; const n = Number(v); return isNaN(n) ? null : n; };
  const label = str(C.type);
  let type = 'invoice';
  Object.keys(TYPES).forEach(function (k) { if (TYPES[k] === label) type = k; });
  return {
    id: str(C.id), no: str(C.no), date: dateStr_(g(C.date)), desc: str(C.desc), amt: num(C.amt),
    rv: g(C.rv) === 'نعم', why: str(C.why), ok: g(C.ok) === 'نعم', img: str(C.img), hash: str(C.hash), by: str(C.by),
    at: g(C.at) instanceof Date ? g(C.at).getTime() : 0, src: str(C.src),
    type: type, acct: str(C.acct), cons: str(C.cons), bmonth: cleanMonth_(g(C.bmonth) instanceof Date ? dateStr_(g(C.bmonth)) : str(C.bmonth)),
    ref: str(C.ref), contract: str(C.contract), landlord: str(C.landlord), tenant: str(C.tenant), prop: str(C.prop),
    from: dateStr_(g(C.from)) || '', to: dateStr_(g(C.to)) || '', rent: num(C.rent), months: num(C.months),
    cancel: dateStr_(g(C.cancel)) || '', paid: num(C.paid), note: str(C.note), link: str(C.link), upd: num(C.upd) || 0
  };
}
function toRow_(d) {
  const v = function (x) { return x == null ? '' : x; };
  const k = keys_(d);
  return [d.id, v(d.no), v(d.date), v(d.desc), v(d.amt), d.rv ? 'نعم' : '', d.rv ? v(d.why) : '', d.ok ? 'نعم' : '',
    v(d.img), v(d.hash), v(d.by), d.at instanceof Date ? d.at : (d.at ? new Date(d.at) : new Date()), v(d.src),
    TYPES[d.type] || TYPES.invoice, v(d.acct), v(d.cons), v(d.bmonth), v(d.ref), v(d.contract), v(d.landlord), v(d.tenant), v(d.prop),
    v(d.from), v(d.to), v(d.rent), v(d.months), v(d.cancel), v(d.paid), v(d.note), v(d.link),
    Date.now(), d.ok ? '' : k[0], d.ok ? '' : k[1]];
}
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(CFG.DATA_SHEET) || ss.insertSheet(CFG.DATA_SHEET, 0);
}
function folderId_(name) {
  const props = PropertiesService.getScriptProperties();
  const k = 'FOLDER_' + name;
  const id = props.getProperty(k);
  if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) {} }
  const f = DriveApp.createFolder(name);
  props.setProperty(k, f.getId());
  return f.getId();
}
function findRow_(sh, col, value) {
  if (!value || sh.getLastRow() < 2) return 0;
  const cell = sh.getRange(2, col, sh.getLastRow() - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}
function findAll_(sh, col, value) {
  if (!value || sh.getLastRow() < 2) return [];
  return sh.getRange(2, col, sh.getLastRow() - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findAll().map(function (c) { return c.getRow(); });
}
function rows_(sh, rowNums) {
  return rowNums.map(function (r) { return { r: r, v: rowObj_(sh.getRange(r, 1, 1, NCOL).getValues()[0]) }; });
}
function sameAcct_(bill, acct) {
  const a = normNo_(acct);
  if (!a) return false;
  return [bill.acct, bill.cons].some(function (b) {
    const n = normNo_(b);
    if (!n) return false;
    return n === a || (Math.abs(n.length - a.length) === 1 && (n.indexOf(a) === 0 || a.indexOf(n) === 0));
  });
}
function similar_(a, b) {
  const n = function (s) { return String(s || '').replace(/[\sـ]+/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase(); };
  const x = n(a), y = n(b);
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}
function latin_(s) {
  return String(s || '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
    .replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); });
}
function normNo_(n) { return latin_(n).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, ''); }
function round3_(n) { return Math.round(n * 1000) / 1000; }
function fmt3_(n) { return (Math.round(n * 1000) / 1000).toFixed(3).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function cleanDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return dateStr_(v);
  const m = latin_(String(v)).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}
function cleanMonth_(v) {
  if (!v) return '';
  let t = latin_(String(v)).trim();
  let k = t.match(/^(\d{2})[\/-]?(\d{4})$/);          // 042019 أو 04/2019
  if (k) t = k[2] + '-' + k[1];
  k = t.match(/^(\d{4})(\d{2})$/);                     // 201904
  if (k) t = k[1] + '-' + k[2];
  const m = t.match(/^(\d{4})-(\d{1,2})/);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1990 || +m[1] > 2100) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2);
}
function monthName_(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return cleanDate_(v);
}
// مدة العقد بالشهور: من 2018-01-01 إلى 2018-12-31 = 12
function monthsBetween_(from, to) {
  const s = from.split('-').map(Number), e0 = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10) + 1));
  const e = [e0.getUTCFullYear(), e0.getUTCMonth() + 1, e0.getUTCDate()];
  let m = (e[0] - s[0]) * 12 + (e[1] - s[1]) - (e[2] < s[2] ? 1 : 0);
  return Math.max(1, m);
}
// الشهور الكاملة المنقضية من بداية العقد إلى تاريخ الإلغاء
function monthsElapsed_(from, cancel) {
  const s = from.split('-').map(Number), c = cancel.split('-').map(Number);
  return (c[0] - s[0]) * 12 + (c[1] - s[1]) - (c[2] < s[2] ? 1 : 0);
}
