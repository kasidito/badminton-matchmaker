/* UI, local cache and sync. Matching and rating rules live in algo.js; network calls in db.js. */
(function () {
  'use strict';
  var A = window.Algo;
  var MODE_LABEL = { normal: 'ปกติ', competitive: 'แข่งขัน', social: 'สังสรรค์' };
  var MODE_ORDER = ['normal', 'competitive', 'social'];
  // starting levels are named after the bird rank they start in (owner's choice, 21 Oct 2026)
  var LV_LABEL = { B: 'ลูกเจี๊ยบ', N: 'นกกระจอก', I: 'นกพิราบ', A: 'เหยี่ยว', P: 'อินทรี' };
  var LV_ORDER = ['B', 'N', 'I', 'A', 'P'];
  var LV_HINT = { B: 'ตีโต้ได้ไม่กี่ลูก เสิร์ฟยังพลาด', N: 'เล่นเป็นเกมได้ แต่พลาดบ่อย', I: 'คุมลูกได้ ยืนตำแหน่งคู่ถูก', A: 'ตบหนัก เล่นเกมรุกได้', P: 'เคยแข่งหรือเคยติดทีม' };
  var BIRD_HINT = { chick: 'เพิ่งฟักออกจากไข่', sparrow: 'เริ่มบินได้ ตีโต้เป็นเกม', pigeon: 'บินคล่อง เล่นได้ทุกตำแหน่ง', hawk: 'สายรุก ตบแรง', eagle: 'เจ้าเวหา คุมเกมได้', phoenix: 'ตำนานของก๊วน' };

  var S = null;   // the session being run (shape documented in CLAUDE.md)
  /* this tab, so realtime echoes of our own saves are ignored (sessionStorage: two tabs are two "devices") */
  var DEV = (function () { try { var d = sessionStorage.getItem('bmm-dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('bmm-dev', d); } return d; } catch (e) { return Math.random().toString(36).slice(2, 10); } })();
  var ui = { tab: 'play', sel: null, confirm: null, ct: null, editId: null, toast: null, tt: null, user: null, busy: null, status: 'saved', statusMsg: '', undos: [] };
  var sync = { timer: null, running: false, dirty: false };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ic(n) { return '<svg class="ico" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function byId() { var m = {}; S.players.forEach(function (p) { m[p.id] = p; }); return m; }
  function activeCount() { return S.players.filter(function (p) { return p.active; }).length; }
  function fmtDelta(d) { return d > 0 ? '+' + d : String(d); }
  function mins(ts) { return ts ? Math.max(0, Math.floor((Date.now() - ts) / 60000)) : null; }
  var LONG_MIN = 20;      // a court playing this long gets an orange flag
  function courtAge(ts) { var m = mins(ts); return m ? 'เล่นมา ' + m + ' นาที' : 'เพิ่งเริ่ม'; }
  function longestText() {
    var best = null;
    S.live.forEach(function (c, i) { if (c && c.at && (!best || c.at < best.at)) best = { at: c.at, i: i }; });
    if (!best) return 'ยังไม่มีสนามที่เล่นอยู่';
    var m = mins(best.at);
    return (m >= LONG_MIN ? 'นานสุด ' : 'เล่นนานสุด ') + 'สนาม ' + (best.i + 1) + ' · ' + (m || 0) + ' น.';
  }
  function waitText(pre, ts) { var w = mins(ts); return pre + (w ? ' · รอ ' + w + ' น.' : ''); }
  function hmSince(t0) { var el = Math.max(0, Date.now() - t0); return Math.floor(el / 3600000) + ':' + ('0' + Math.floor(el / 60000) % 60).slice(-2); }
  function thaiDate(d, opts) { try { return d.toLocaleDateString('th-TH', opts); } catch (e) { return d.toISOString().slice(0, 10); } }
  function todayTitle() { return thaiDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function todayISO() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function sessionUsed(s) {
    var st = s.state;
    if (!st) return false;
    return (st.done && st.done.length) || (st.live && st.live.some(Boolean)) || (st.players && st.players.some(function (p) { return p.active; }));
  }
  function renderDate() {
    var el = $('date'); if (!el) return;
    var d = thaiDate(new Date(), { weekday: 'short', day: 'numeric', month: 'short' });
    el.textContent = (ui.club ? ui.club.name + ' · ' : '') + (S && S.sessionId ? 'คืนนี้ ' + d : d + ' · ยังไม่เปิดคืน');
  }
  function errMsg(e) { return (e && e.message) ? e.message : String(e); }

  /* ---------- error log ----------
     Unexpected errors and failed saves go to public.client_logs (Supabase only, no outside service) so the owner can
     read them without screenshots. The last 20 also stay on this device (localStorage bmm-logs) for the report button,
     and ones made offline are sent after the next good save. Player names and emails are cut out before anything is
     kept; the same message is kept at most once per 10 minutes and at most 20 are sent per page load. */
  var LOGKEY = 'bmm-logs', LOGMAX = 20, logs = { seen: {}, sent: 0, busy: false };
  function logsRead() { try { var a = JSON.parse(localStorage.getItem(LOGKEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function logsWrite(a) { try { localStorage.setItem(LOGKEY, JSON.stringify(a.slice(-LOGMAX))); } catch (e) { } }
  function scrub(text, max) {
    var t = String(text == null ? '' : text)
      .replace(/Key \([^)]*\)=\([^)]*\)/g, 'Key (…)=(…)')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
    var names = [];
    ((S && S.players) || []).forEach(function (p) { if (p && p.name) names.push(p.name); ((p && p.aliases) || []).forEach(function (n) { names.push(n); }); });
    names.filter(function (n) { return String(n).trim().length >= 2; }).sort(function (a, b) { return b.length - a.length; })
      .forEach(function (n) { t = t.split(n).join('<ชื่อ>'); });
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  function deviceText() {
    var standalone = false;
    try { standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { }
    return ((navigator.userAgent || '').slice(0, 220) + ' | ' + (standalone ? 'home-screen' : 'browser') + ' | ' + screen.width + 'x' + screen.height).slice(0, 300);
  }
  function logError(kind, message, detail) {
    try {
      var msg = scrub(message || 'unknown', 500), key = kind + '|' + msg, now = Date.now();
      if (logs.seen[key] && now - logs.seen[key] < 600000) return;
      logs.seen[key] = now;
      var a = logsRead();
      a.push({ at: now, kind: kind, message: msg, detail: detail ? scrub(detail, 4000) : null, tab: String(ui.tab || '').slice(0, 20), v: myStamp(), club: ui.club ? ui.club.id : null, sent: false });
      logsWrite(a);
      sendLogs();
    } catch (e) { }
  }
  async function sendLogs() {
    if (logs.busy || !ui.user || navigator.onLine === false || !window.DB) return;
    var todo = logsRead().filter(function (e) { return !e.sent; });
    if (!todo.length) return;
    logs.busy = true;
    var done = [];
    try {
      for (var i = 0; i < todo.length && logs.sent < 20; i++) {
        var e = todo[i];
        await DB.log({ club_id: e.club, kind: e.kind, message: e.message, detail: e.detail, tab: e.tab, app_version: e.v, device: deviceText() });
        done.push(e.at + '|' + e.message); logs.sent++;
      }
    } catch (x) { }                                   // never log a failure to log
    finally {
      logs.busy = false;
      if (done.length) logsWrite(logsRead().map(function (e) { if (done.indexOf(e.at + '|' + e.message) >= 0) e.sent = true; return e; }));
    }
  }
  window.addEventListener('error', function (ev) {
    if (!ev || (!ev.message && !ev.error)) return;
    logError('error', ev.message || errMsg(ev.error), (ev.error && ev.error.stack) || ((ev.filename || '') + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0)));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    if (r && r.name === 'AbortError') return;          // a closed share sheet, not a bug
    logError('rejection', errMsg(r), r && r.stack);
  });
  function reportText() {
    var d = new Date(), pad = function (n) { return ('0' + n).slice(-2); };
    var hm = function (ms) { var t = new Date(ms); return pad(t.getDate()) + '/' + pad(t.getMonth() + 1) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()); };
    var here = S ? S.players.filter(function (p) { return p.active; }).length : 0;
    var lines = [
      'Budmintan รายงานปัญหา',
      'เวลา: ' + hm(d.getTime()) + '/' + d.getFullYear(),
      'เวอร์ชัน: ' + (myStamp() || '-'),
      'ก๊วน: #' + (ui.club ? ui.club.id : '-') + ' · คืน #' + (S && S.sessionId || '-'),
      'หน้า: ' + ui.tab,
      'บันทึก: ' + ui.status + (ui.statusMsg ? ' (' + scrub(ui.statusMsg, 200) + ')' : '') + (ui.lastSaved ? ' · ล่าสุด ' + hm(ui.lastSaved) : '') + (sync.dirty ? ' · มีของค้างบันทึก' : ''),
      'เน็ต: ' + (navigator.onLine === false ? 'ออฟไลน์' : 'ออนไลน์'),
      'คืนนี้: มา ' + here + ' คน · ' + (S ? S.done.length : 0) + ' แมตช์ · ' + (S ? S.courts.length : 0) + ' สนาม',
      'เครื่อง: ' + deviceText()
    ];
    var a = logsRead().filter(function (e) { return e.kind !== 'report'; });
    lines.push('', 'ข้อผิดพลาดล่าสุด (' + a.length + '):');
    if (!a.length) lines.push('- ไม่มี');
    a.slice().reverse().forEach(function (e, i) {
      lines.push((i + 1) + '. ' + hm(e.at) + ' [' + e.kind + '] ' + e.message + ' · หน้า ' + (e.tab || '-') + (e.sent ? '' : ' · ยังไม่ส่ง'));
    });
    return lines.join('\n');
  }
  function iso(ms) { return ms ? new Date(ms).toISOString() : null; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function confirmTap(key) {
    if (ui.confirm === key) { ui.confirm = null; return true; }
    ui.confirm = key; clearTimeout(ui.ct);
    ui.ct = setTimeout(function () { ui.confirm = null; render(); }, 4000);
    return false;
  }
  function selName() {
    var s = ui.sel; if (!s) return '';
    var id = s.id != null ? s.id : (S.live[s.ci] ? S.live[s.ci].t[s.s][s.i] : null);
    var p = byId()[id]; return p ? p.name : '';
  }
  function sameSel(a) {
    var s = ui.sel; if (!s) return false;
    if (a.id != null) return s.id === a.id;
    return s.id == null && s.ci === a.ci && s.s === a.s && s.i === a.i;
  }

  /* ---------- local cache (survives refresh and bad wifi) ---------- */
  function cacheKey() { return 'bmm-cache-' + (ui.user ? ui.user.id : 'anon') + (ui.club ? '-' + ui.club.id : ''); }
  function readCache() {
    var ok = function (c) { return c && c.S && c.S.v === 4 ? c : null; };
    try {
      var c = ok(JSON.parse(localStorage.getItem(cacheKey()) || 'null'));
      // caches written before clubs existed have no club in the key; buildState only trusts them for the same night id
      if (!c && ui.user && ui.club && ui.clubs && ui.clubs[0].id === ui.club.id) c = ok(JSON.parse(localStorage.getItem('bmm-cache-' + ui.user.id) || 'null'));
      return c;
    } catch (e) { return null; }
  }
  function clubKey() { return 'bmm-club-' + (ui.user ? ui.user.id : 'anon'); }
  function savedClub() { try { return JSON.parse(localStorage.getItem(clubKey()) || 'null'); } catch (e) { return null; } }
  function writeCache() { try { localStorage.setItem(cacheKey(), JSON.stringify({ S: S, dirty: sync.dirty, at: Date.now() })); } catch (e) { } }

  /* ---------- sync to Supabase ---------- */
  function buildPayload() {
    var trail = [];
    A.ratings(S.done, S.players, S.adj, trail);
    var st = A.stats(S.done, S.players), on = {};
    A.liveIds(S).forEach(function (id) { on[id] = 1; });
    var state = JSON.parse(JSON.stringify(S)); delete state.days;
    return {
      state: state,
      court_modes: S.courts.map(function (c) { return c.mode; }),
      flex: S.flex || 0,
      players: S.players.map(function (p) {
        return {
          id: p.id, level: p.level || 'I', start_mmr: Math.round(A.startOf(p)), career_games: p.games || 0,
          in_session: !!(p.active || st.played[p.id] > 0 || on[p.id]), active: !!p.active, base: p.base || 0
        };
      }),
      matches: S.done.map(function (m, i) {
        var tr = trail[i];
        return {
          seq: i + 1, court: m.court || 0, mode: m.mode || 'normal', a: m.t[0], b: m.t[1], w: m.w, sc: A.validScore(m.sc) ? m.sc : null,
          started_at: iso(m.at), ended_at: iso(m.end),
          players: m.t[0].concat(m.t[1]).map(function (id) {
            var team = m.t[0].indexOf(id) >= 0 ? 0 : 1;
            return { id: id, team: team, won: m.w === team, before: tr ? +tr.before[id].toFixed(2) : null, after: tr ? +tr.after[id].toFixed(2) : null };
          })
        };
      }),
      adjustments: S.adj.map(function (a) { return { id: a.id, at: a.at, to: a.to }; })
    };
  }
  function setStatus(st, msg) { ui.status = st; ui.statusMsg = msg || ''; renderStatus(); }
  function changed() {
    sync.dirty = true; writeCache(); setStatus('pending');
    clearTimeout(sync.timer); sync.timer = setTimeout(runSync, 1200);
  }
  /* members added while offline carry a temporary negative id; give them real ids before anything else syncs */
  async function flushPending() {
    var pend = S.players.filter(function (p) { return p.pending; });
    for (var i = 0; i < pend.length; i++) {
      var p = pend[i], row;
      try { row = await DB.addPlayer(p.name, p.level || 'I'); }
      catch (e) {
        if (e.code !== '23505') throw e;           // the name exists (added elsewhere or removed earlier): use that member
        row = (await DB.loadPlayers()).filter(function (x) { return x.name.toLowerCase() === p.name.toLowerCase(); })[0];
        if (!row) throw e;
        if (!row.active) await DB.setPlayerActive(row.id, true);
      }
      var old = p.id;
      if (S.players.some(function (q) { return q !== p && q.id === row.id; })) S.players = S.players.filter(function (q) { return q !== p; });
      A.remapId(S, old, row.id);
      p.pending = false;
      ui.newIds = (ui.newIds || []).map(function (x) { return x === old ? row.id : x; });
      if (ui.sel && ui.sel.id === old) ui.sel.id = row.id;
      if (ui.editPlayer === old) ui.editPlayer = row.id;
    }
    if (pend.length) { writeCache(); render(); }
  }
  function isOffline(e) { return !navigator.onLine || /fetch|network|load failed|timeout/i.test(errMsg(e)); }
  var tempSeq = 0;
  function pendingPlayer(n, base) {
    var p = fromRow({ id: -(Date.now() % 1000000000) * 10 - (tempSeq++ % 10), name: n, level: 'I', start_mmr: A.LV.I, career_games: 0, aliases: [] }, true, base);
    p.pending = true; return p;
  }
  /* A night is opened on the first change that belongs to it (check-in, draw, result, MMR edit). */
  function needsSession() {
    return S.done.length > 0 || S.adj.length > 0 || S.live.some(Boolean) || S.players.some(function (p) { return p.active; });
  }
  async function openOrCreateSession() {
    var ns;
    try { ns = await DB.createSession(todayTitle(), S.courts.map(function (c) { return c.mode; }), S.flex || 0); }
    catch (e) {
      if (e.code !== '23505') throw e;            // another device opened tonight first: join it
      ns = await DB.openSession();
      if (!ns) throw e;
    }
    S.sessionId = ns.id; S.title = ns.title;
    renderDate();
    return ns;
  }
  async function runSync() {
    if (sync.running || !sync.dirty) return;
    sync.running = true; sync.dirty = false; setStatus('saving');
    try {
      await flushPending();
      if (!S.sessionId) {
        if (!needsSession()) { writeCache(); setStatus('saved'); return; }
        await openOrCreateSession();
      }
      S.by = DEV; S.at = Date.now();
      try { await DB.sync(S.sessionId, buildPayload()); }
      catch (e) {
        if (e.code !== 'P0002') throw e;           // night was closed on another device: open a new one and retry
        await openOrCreateSession();
        await DB.sync(S.sessionId, buildPayload());
      }
      writeCache(); ui.lastSaved = Date.now();
      pushLive(); sendLogs();
      setStatus(sync.dirty ? 'pending' : 'saved');
    } catch (e) {
      sync.dirty = true; writeCache();
      if (!isOffline(e)) logError('sync', errMsg(e), e && e.code ? 'code ' + e.code : null);
      setStatus(navigator.onLine ? 'error' : 'offline', errMsg(e));
      clearTimeout(sync.timer); sync.timer = setTimeout(runSync, 10000);
    } finally {
      sync.running = false;
      if (sync.dirty && ui.status === 'pending') { clearTimeout(sync.timer); sync.timer = setTimeout(runSync, 800); }
    }
  }
  async function flushSync() {
    clearTimeout(sync.timer);
    while (sync.running) await sleep(100);
    if (sync.dirty) await runSync();
    if (sync.dirty) throw new Error('ยังบันทึกขึ้นระบบไม่ได้');
  }
  window.addEventListener('online', function () { if (sync.dirty) runSync(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && sync.dirty) runSync(); });
  window.addEventListener('beforeunload', function (e) { if (sync.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- boot ---------- */
  function showGate(html) { $('app').hidden = true; $('dock').hidden = true; var g = $('gate'); g.hidden = false; g.innerHTML = '<div class="gate-card">' + html + '</div>'; }
  function loginHtml(err) {
    return '<span class="logo">' + ic('shuttle') + '</span><h1>Budmintan</h1><p class="muted">จัดคู่ก๊วนแบด · สำหรับผู้ดูแลก๊วน</p>' +
      '<form id="loginForm" class="add" autocomplete="on">' +
      '<label>อีเมล<input class="field" id="email" type="email" autocomplete="username" required></label>' +
      '<label>รหัสผ่าน<input class="field" id="password" type="password" autocomplete="current-password" required></label>' +
      (err ? '<p class="err">' + esc(err) + '</p>' : '') +
      '<button class="btn primary" type="submit">เข้าสู่ระบบ</button>' +
      '<button class="btn" type="button" data-act="forgot">ลืมรหัสผ่าน</button></form>';
  }
  function forgotHtml(err, ok) {
    return '<span class="logo">' + ic('shuttle') + '</span><h1>ลืมรหัสผ่าน</h1>' +
      (ok ? '<p>' + esc(ok) + '</p>' :
        '<p class="muted">ใส่อีเมลผู้ดูแล ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้</p>' +
        '<form id="forgotForm" class="add" autocomplete="on"><label>อีเมล<input class="field" id="femail" type="email" autocomplete="username" required></label>' +
        (err ? '<p class="err">' + esc(err) + '</p>' : '') +
        '<button class="btn primary" type="submit">ส่งลิงก์</button></form>') +
      '<button class="btn" type="button" data-act="tologin">กลับไปหน้าเข้าสู่ระบบ</button>';
  }
  function recoverHtml(err) {
    return '<span class="logo">' + ic('shuttle') + '</span><h1>ตั้งรหัสผ่านใหม่</h1>' +
      '<form id="recoverForm" class="add" autocomplete="off">' +
      '<label>รหัสผ่านใหม่<input class="field" id="rpw" type="password" minlength="8" autocomplete="new-password" required></label>' +
      '<label>ยืนยันรหัสผ่านใหม่<input class="field" id="rpw2" type="password" minlength="8" autocomplete="new-password" required></label>' +
      (err ? '<p class="err">' + esc(err) + '</p>' : '') +
      '<button class="btn primary" type="submit">บันทึกรหัสผ่าน</button></form>';
  }
  async function boot() {
    var recovering = /type=recovery/.test(location.hash);   // arrived from a reset-password email
    showGate('<p>กำลังโหลด…</p>');
    try { DB.init(); } catch (e) { showGate('<h1>โหลดระบบไม่ได้</h1><p class="muted">ตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้านี้</p>'); return; }
    var user = null;
    try { user = await DB.getUser(); } catch (e) { }
    if (recovering && user) { showGate(recoverHtml()); return; }
    if (recovering && !user) { showGate(loginHtml('ลิงก์ตั้งรหัสผ่านหมดอายุหรือใช้ไปแล้ว ขอลิงก์ใหม่ได้ที่ปุ่ม ลืมรหัสผ่าน')); return; }
    if (!user) { showGate(loginHtml()); return; }
    await startFor(user);
  }
  function fromRow(row, active, base) {
    return { id: row.id, name: row.name, active: !!active, base: base || 0, level: row.level, start: row.start_mmr, sigma: row.start_sigma == null ? null : +row.start_sigma, aliases: row.aliases || [], games: row.career_games, freeSince: active ? Date.now() : 0, qr: Math.random() };
  }
  /* widen sigma for members who have been away (A.idleSigma). p.sigma is reset from the database on every load, so this
     never compounds; p.sigma0 keeps the stored value for members who end up not playing tonight (see A.carryForward). */
  function applyIdle() {
    var last = {}, today = todayISO();
    (S.days || []).forEach(function (d) { if (d.date) (d.players || []).forEach(function (r) { if (r.id != null && (!last[r.id] || d.date > last[r.id])) last[r.id] = d.date; }); });
    S.players.forEach(function (p) {
      if (p.pending || p.sigma == null) return;
      p.sigma0 = p.sigma;
      var since = last[p.id] ? (Date.parse(today) - Date.parse(last[p.id])) / 86400000 / 7 : 52;   // not in the last 30 nights: a long time
      p.sigma = A.idleSigma(p.sigma, since);
    });
  }
  /* session may be null: tonight has not been opened yet */
  function buildState(session, rows, cache) {
    var st, sid = session ? session.id : null;
    if (cache && cache.dirty && cache.S.sessionId === sid) st = cache.S;      // unsynced local changes win
    else if (session && session.state && session.state.v === 4) st = session.state;
    else {
      var modes = session ? session.court_modes : (cache ? cache.S.courts.map(function (c) { return c.mode; }) : ['normal', 'normal', 'normal']);
      st = { v: 4, players: [], courts: modes.map(function (m) { return { mode: m }; }), live: [], done: [], adj: [],
        flex: session ? session.flex : (cache ? (cache.S.flex || 0) : 4) };
    }
    st.sessionId = sid;
    st.title = session ? session.title : null;
    var have = {}; st.players.forEach(function (p) { have[p.id] = p; });
    var used = {}; st.done.forEach(function (m) { m.t[0].concat(m.t[1]).forEach(function (id) { used[id] = 1; }); });
    st.live.forEach(function (c) { if (c) c.t[0].concat(c.t[1]).forEach(function (id) { used[id] = 1; }); });
    var keep = [];
    st.players.forEach(function (p) { if (p.pending) keep.push(p); });   // added offline, not in the database yet
    rows.forEach(function (r) {
      var p = have[r.id];
      if (p) { p.name = r.name; p.aliases = r.aliases || []; p.sigma = r.start_sigma == null ? null : +r.start_sigma; if (r.active || used[r.id]) keep.push(p); }
      else if (r.active) keep.push(fromRow(r, false, 0));
    });
    st.players = keep;
    st.days = [];
    return st;
  }
  async function startFor(user) {
    ui.user = user;
    showGate('<p>กำลังโหลดข้อมูล…</p>');
    var clubs = null;
    try { clubs = await DB.myClubs(); } catch (e) { }
    if (clubs && !clubs.length) {
      showGate('<h1>บัญชีนี้ยังไม่ใช่ผู้ดูแล</h1><p class="muted">' + esc(user.email || '') + ' เข้าสู่ระบบได้ แต่ยังไม่ได้เป็นผู้ดูแลของก๊วนไหน ให้ผู้ดูแลก๊วนเพิ่มอีเมลนี้ที่ ตั้งค่า > ผู้ดูแลก๊วน</p><button class="btn" data-act="logout">' + ic('logout') + 'ออกจากระบบ</button>');
      return;
    }
    var saved = savedClub();
    var club = clubs ? (clubs.filter(function (c) { return saved && c.id === saved.id; })[0] || clubs[0]) : saved;
    if (!club) { showGate('<h1>โหลดข้อมูลไม่ได้</h1><p class="muted">ต่อระบบไม่ได้ ลองใหม่เมื่อออนไลน์</p><button class="btn primary" data-act="reload">ลองใหม่</button>'); return; }
    ui.clubs = clubs || [club];
    await openClub(club);
  }
  /* leave or delete the current club, then move to another one this admin runs */
  async function dropClub(call, okMsg) {
    var gone = ui.club;
    ui.busy = 'กำลังบันทึก…'; render();
    try { await flushSync(); } catch (e) { }
    try { await call(); }
    catch (e) {
      ui.busy = null;
      var m = errMsg(e);
      toast(/last_admin/.test(m) ? 'คุณเป็นผู้ดูแลคนเดียว ให้ลบก๊วนแทน หรือเพิ่มผู้ดูแลก่อน' : /only_club/.test(m) ? 'ต้องมีก๊วนอื่นอยู่ก่อน' : /name_mismatch/.test(m) ? 'ชื่อก๊วนไม่ตรง' : 'ทำไม่สำเร็จ: ' + m, null);
      render(); return;
    }
    try { localStorage.removeItem(cacheKey()); } catch (e) { }
    sync.dirty = false;
    ui.clubs = (ui.clubs || []).filter(function (c) { return c.id !== gone.id; });
    ui.busy = null;
    await openClub(ui.clubs[0]);
    ui.tab = 'play'; toast(okMsg, null); render();
  }
  function leaveClub() { return dropClub(function () { return DB.leaveClub(ui.club.id); }, 'ออกจากก๊วน ' + ui.club.name + ' แล้ว'); }
  async function switchClub(id) {
    var c = (ui.clubs || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    ui.busy = 'กำลังสลับก๊วน…'; render();
    try { await flushSync(); } catch (e) { ui.busy = null; toast('ยังบันทึกคืนนี้ขึ้นระบบไม่ได้ ต่อเน็ตแล้วลองสลับอีกครั้ง', null); render(); return; }
    ui.busy = null;
    await openClub(c);
    ui.tab = 'play';
    toast('สลับไปก๊วน ' + c.name + ' แล้ว', null); render();
  }
  /* load one club's members, open night and history; everything after this is scoped to it */
  async function openClub(club) {
    ui.club = { id: club.id, name: club.name };
    DB.setClub(club.id);
    try { localStorage.setItem(clubKey(), JSON.stringify(ui.club)); } catch (e) { }
    S = null; ui.undos = []; ui.admins = null; ui.newIds = []; ui.nameAsk = []; ui.allStats = null; ui.statId = null; ui.month = null; ui.h2h = null; closeCard(); ui.liveOpen = false; ui.shareFallback = null; ui.det = {}; ui.sel = null; ui.editPlayer = null; ui.resetId = null; ui.restPick = false;
    sync.dirty = false;
    var cache = readCache();
    try {
      var res = await Promise.all([DB.loadPlayers(), DB.openSession(), DB.loadClosedDays(30), DB.loadRules().catch(function () { return null; })]);
      var session = res[1];
      // a night opened on an earlier day but never used is moved to today
      if (session && session.played_on !== todayISO() && !sessionUsed(session)) {
        try { session = await DB.retitleSession(session.id, todayTitle(), todayISO()); } catch (e) { }
      }
      S = buildState(session, res[0], cache);
      S.days = res[2];
      applyIdle();
      if (res[3]) S.rules = res[3]; else S.rules = S.rules || [];
      sync.dirty = !!(cache && cache.dirty && cache.S.sessionId === (session ? session.id : null));
    } catch (e) {
      if (!cache) { showGate('<h1>โหลดข้อมูลไม่ได้</h1><p class="muted">' + esc(errMsg(e)) + '</p><button class="btn primary" data-act="reload">ลองใหม่</button>'); return; }
      S = cache.S; sync.dirty = !!cache.dirty;
      toast('ต่อระบบไม่ได้ ใช้ข้อมูลในเครื่องไปก่อน จะบันทึกขึ้นระบบเมื่อออนไลน์', null);
    }
    A.normalize(S);
    $('gate').hidden = true; $('app').hidden = false;
    render();
    if (sync.dirty) { setStatus('pending'); sync.timer = setTimeout(runSync, 500); } else setStatus('saved');
    if (ui.unwatch) ui.unwatch();
    ui.unwatch = DB.watchNights(onRemoteNight);
  }

  /* ---------- realtime: another admin device changed tonight ----------
     Last save wins: the newer state replaces ours unless we have changes not saved yet (then ours goes up next and
     the other device follows us). Our own saves come back too; S.by tells them apart. */
  function onRemoteNight(row) {
    if (!S || !row || (row.state && row.state.by === DEV)) return;
    if (row.status === 'closed') {
      if (row.id === S.sessionId && !sync.dirty) { toast('อีกเครื่องจบคืนนี้แล้ว', null); openClub(ui.club); }
      return;
    }
    if (row.status !== 'open' || !row.state || row.state.v !== 4) return;
    if (sync.dirty || sync.running) return;
    if (S.sessionId && row.id !== S.sessionId) return;
    if (S.at && row.state.at && row.state.at <= S.at) return;       // older than what we have
    var keep = { days: S.days, rules: S.rules };
    S = row.state; S.sessionId = row.id; S.title = row.title; S.days = keep.days; S.rules = keep.rules;
    A.normalize(S);
    ui.sel = null; ui.undos = [];
    writeCache(); renderDate(); render();
    setStatus('saved');
  }

  /* ---------- players' live view (QR) ---------- */
  function liveView() {
    var RT = A.ratings(S.done, S.players, S.adj), st = A.stats(S.done, S.players), map = byId();
    var who = function (id) { var p = map[id]; return p ? { n: p.name, b: RT.B[id] } : { n: '-', b: 0 }; };
    var L = A.lineup(S, null), nx = A.nextFour(S);
    return {
      at: Date.now(), done: S.done.length,
      courts: S.live.map(function (c, i) { return c ? { n: i + 1, mode: S.courts[i].mode, since: c.at || null, t: c.t.map(function (t) { return t.map(who); }) } : { n: i + 1, mode: S.courts[i].mode, empty: true }; }),
      next: (nx && nx.length === 4 ? nx : []).map(function (id) { return who(id).n; }),
      queue: L.list.map(function (x) { return x.id; }).concat(L.held).map(function (id) { var p = map[id]; return { n: p.name, b: RT.B[id], g: st.played[id] || 0, since: p.freeSince || null, rest: !!p.rest }; })
    };
  }
  function pushLive() {
    if (!S || !S.sessionId || !S.share) return;
    DB.setLive(S.sessionId, S.share, liveView()).catch(function () { });
  }
  function liveUrl() { return location.origin + location.pathname.replace(/index\.html$/, '').replace(/[^/]*$/, '') + 'live.html#' + S.share; }
  function newToken() {
    var a = new Uint8Array(16); try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.random() * 256; }
    return Array.prototype.map.call(a, function (x) { return 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]; }).join('');
  }
  var qrLib = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    if (qrLib) return qrLib;
    qrLib = new Promise(function (ok, bad) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      sc.onload = ok; sc.onerror = function () { qrLib = null; bad(new Error('โหลดตัวสร้าง QR ไม่ได้')); };
      document.head.appendChild(sc);
    });
    return qrLib;
  }
  async function openLive() {
    if (!activeCount()) { toast('เช็กอินผู้เล่นก่อน แล้วค่อยเปิดลิงก์ให้ผู้เล่นดู', null); return; }
    if (!S.share) { S.share = newToken(); changed(); }
    ui.liveOpen = true; ui.qrSvg = null; render();
    try { await loadQr(); var q = window.qrcode(0, 'M'); q.addData(liveUrl()); q.make(); ui.qrSvg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
    catch (e) { ui.qrSvg = ''; toast(errMsg(e), null); }
    render();
  }
  function liveModal() {
    var url = liveUrl();
    return '<div class="modal" role="dialog" aria-modal="true" aria-label="ลิงก์ให้ผู้เล่นดูคิว"><div class="modalbox livebox">' +
      '<h2>ให้ผู้เล่นดูคิว</h2><p class="muted small">สแกน QR หรือเปิดลิงก์ เห็นสนาม คนลงต่อ และคิวของคืนนี้ อัปเดตเองทุกไม่กี่วินาที ไม่ต้องล็อกอิน ไม่แสดงคะแนน MMR</p>' +
      '<div class="qr">' + (ui.qrSvg == null ? '<span class="muted small">กำลังสร้าง QR…</span>' : ui.qrSvg) + '</div>' +
      '<p class="livelink small">' + esc(url) + '</p>' +
      '<div class="acts"><button class="btn primary" data-act="live-share">' + ic('share') + 'ส่งลิงก์</button>' +
      '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">เปิดดู</a>' +
      '<button class="btn" data-act="live-new">เปลี่ยนลิงก์</button>' +
      '<button class="btn" data-act="live-off">ปิดลิงก์</button>' +
      '<button class="btn" data-act="live-close">' + ic('x') + 'ปิด</button></div>' +
      '<p class="muted small">ลิงก์ใช้ได้เฉพาะคืนนี้ จบคืนแล้วใช้ไม่ได้ กด "เปลี่ยนลิงก์" ถ้าลิงก์หลุดไปที่อื่น</p></div></div>';
  }

  /* ---------- player edit (name is written straight to players; MMR is a normal manual edit in S.adj) ---------- */
  async function savePlayerEdit(f) {
    var id = +f.dataset.id, p = A.findP(S, id); if (!p) return;
    var name = $('pName').value.replace(/\s+/g, ' ').trim(), val = parseInt($('pMmr').value, 10);
    var cur = Math.round(A.ratings(S.done, S.players, S.adj).R[id]);
    if (!name) { toast('ใส่ชื่อก่อน', null); return; }
    if (S.players.some(function (x) { return x.id !== id && x.name.toLowerCase() === name.toLowerCase(); })) { toast('มีชื่อ "' + name + '" อยู่แล้ว', null); return; }
    var msgs = [];
    if (name !== p.name) {
      ui.busy = 'กำลังบันทึกชื่อ…'; render();
      try { if (!p.pending) await DB.updatePlayer(id, { name: name }); msgs.push('เปลี่ยนชื่อเป็น ' + name); p.name = name; }
      catch (err) { ui.busy = null; toast(err.code === '23505' ? 'มีชื่อนี้ในระบบแล้ว (อาจเป็นสมาชิกที่ถูกลบไป)' : 'เปลี่ยนชื่อไม่ได้: ' + errMsg(err), null); render(); return; }
      ui.busy = null;
    }
    var snap = null;
    if (!isNaN(val) && val !== cur) {
      var to = Math.max(0, Math.min(5000, val));
      snap = JSON.stringify(S); S.adj.push({ at: S.done.length, id: id, to: to }); msgs.push('ตั้ง MMR เป็น ' + to);
    }
    ui.editPlayer = null;
    if (msgs.length) { toast(msgs.join(' และ ') + ' แล้ว', snap); changed(); }
    render();
  }

  /* ---------- other admins (edge function manage-admins) ---------- */
  var ADMIN_ERR = {
    bad_email: 'อีเมลไม่ถูกต้อง', short_password: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร', cannot_remove_self: 'ถอดสิทธิ์ตัวเองไม่ได้',
    last_admin: 'ต้องมีผู้ดูแลอย่างน้อย 1 คน', not_admin: 'บัญชีนี้ไม่ใช่ผู้ดูแล', not_signed_in: 'ต้องเข้าสู่ระบบใหม่',
    use_change_password: 'รหัสของตัวเองให้เปลี่ยนที่หัวข้อบัญชี', not_admin_target: 'คนนี้ไม่ใช่ผู้ดูแลแล้ว',
    other_club_admin: 'คนนี้ดูแลก๊วนอื่นที่คุณไม่ได้ดูแลด้วย ตั้งรหัสให้ไม่ได้', no_club: 'ยังไม่ได้เลือกก๊วน'
  };
  function adminErr(e) { var m = errMsg(e); return ADMIN_ERR[m] || m; }
  async function loadAdmins() {
    if (ui.adminsLoading) return;
    ui.adminsLoading = true;
    try { ui.admins = { list: (await DB.admins({ action: 'list' })).admins }; }
    catch (e) { ui.admins = { error: adminErr(e) }; }
    ui.adminsLoading = false;
    if (ui.tab === 'set') render();
  }
  async function adminAction(body, okMsg) {
    ui.busy = 'กำลังบันทึก…'; render();
    var ok = false;
    try {
      var r = await DB.admins(body);
      ui.admins = { list: r.admins }; ok = true;
      toast(okMsg || (r.created ? 'เพิ่ม ' + body.email + ' แล้ว แจ้งอีเมลและรหัสผ่านให้เขาเข้าสู่ระบบ' : 'เพิ่ม ' + body.email + ' เป็นผู้ดูแลแล้ว ใช้รหัสผ่านเดิมของบัญชีนั้น'), null);
    } catch (e) { toast(adminErr(e), null); }
    ui.busy = null; render();
    return ok;
  }
  function adminsBody() {
    var h = '';
    if (!ui.admins) { loadAdmins(); h += '<span class="muted small">กำลังโหลด…</span>'; }
    else if (ui.admins.error) h += '<p class="err">โหลดรายชื่อไม่ได้: ' + esc(ui.admins.error) + '</p><button class="btn sm" data-act="admins-reload">ลองใหม่</button>';
    else {
      h += '<div class="alist">';
      ui.admins.list.forEach(function (a) {
        var seen = a.last_sign_in_at ? 'เข้าล่าสุด ' + new Date(a.last_sign_in_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : 'ยังไม่เคยเข้า';
        h += '<div class="arow"><div class="who"><b>' + esc(a.email) + '</b><span>' + (a.me ? 'คุณ · ' : '') + seen + '</span></div>';
        if (!a.me) h += '<div class="acts"><button class="btn xs" data-act="admin-reset" data-id="' + esc(a.id) + '">ตั้งรหัสใหม่</button>' +
          '<button class="btn xs' + (ui.confirm === 'adm' + a.id ? ' danger' : '') + '" data-act="admin-remove" data-id="' + esc(a.id) + '">' + (ui.confirm === 'adm' + a.id ? 'กดอีกครั้งเพื่อยืนยัน' : 'ถอดสิทธิ์') + '</button></div>';
        h += '</div>';
        if (ui.resetId === a.id) h += '<form class="mmr-edit" id="adminResetForm" data-id="' + esc(a.id) + '" autocomplete="off"><input class="field" id="admResetPw" type="text" minlength="8" placeholder="รหัสผ่านใหม่ อย่างน้อย 8 ตัว" aria-label="รหัสผ่านใหม่ของ ' + esc(a.email) + '" required><button class="btn primary" type="submit">ตั้ง</button><button class="btn" type="button" data-act="admin-reset-cancel">ยกเลิก</button></form>';
      });
      h += '</div><form class="add sblock" id="adminAddForm" autocomplete="off"><b class="small">เพิ่มผู้ดูแล</b>' +
        '<input class="field" id="admEmail" type="email" inputmode="email" placeholder="อีเมล" aria-label="อีเมลผู้ดูแลใหม่" required>' +
        '<input class="field" id="admPw" type="text" minlength="8" placeholder="รหัสผ่านเริ่มต้น อย่างน้อย 8 ตัว" aria-label="รหัสผ่านเริ่มต้น">' +
        '<button class="btn primary" type="submit">' + ic('plus') + 'เพิ่มผู้ดูแล</button>' +
        '<p class="muted small">ระบบไม่ส่งอีเมล ให้บอกอีเมลและรหัสนี้กับผู้ดูแลใหม่เอง แล้วให้เขาเปลี่ยนรหัสที่ ตั้งค่า > บัญชี ถ้าอีเมลนี้มีบัญชีอยู่แล้ว ไม่ต้องใส่รหัส</p></form>';
    }
    return h;
  }

  /* ---------- theme: per device, auto follows the system ---------- */
  function themePref() { try { return localStorage.getItem('bmm-theme') || 'auto'; } catch (e) { return 'auto'; } }
  function setTheme(v) {
    try { if (v === 'auto') localStorage.removeItem('bmm-theme'); else localStorage.setItem('bmm-theme', v); } catch (e) { }
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme');
    renderThemeBtn();
  }
  /* the header sun/moon button flips between light and dark (Settings still offers อัตโนมัติ) */
  function themeNow() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function renderThemeBtn() {
    var b = $('themeBtn'); if (!b) return;
    var dark = themeNow() === 'dark', label = dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
    b.innerHTML = ic(dark ? 'sun' : 'moon'); b.setAttribute('aria-label', label); b.title = label;
  }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderThemeBtn); } catch (e) { }

  /* ---------- LINE summary: plain text, no emojis, posted through the share sheet (or copied) ---------- */
  function dayText(day) {
    var rows = day.players.slice().sort(function (a, b) { return b.mmr - a.mmr; });
    var lines = ['สรุป' + (ui.club ? ui.club.name : 'ก๊วน') + ' · ' + day.label, rows.length + ' คน · ' + day.count + ' แมตช์', '', 'อันดับ'];
    rows.slice(0, 12).forEach(function (r, i) {
      var d = r.mmr - r.start;
      lines.push((i + 1) + '. ' + r.name + ' ' + r.mmr + ' (' + (d >= 0 ? '+' : '') + d + ') ' + A.BIRDS[A.birdIndex(r.mmr)].name + ' · ชนะ ' + r.win + '/' + r.played);
    });
    if (rows.length > 12) lines.push('และอีก ' + (rows.length - 12) + ' คน');
    var ups = rows.filter(function (r) { return A.birdIndex(r.mmr) > A.birdIndex(r.start); });
    if (ups.length) lines.push('', 'เลื่อนขั้น: ' + ups.map(function (r) { return r.name + ' เป็น' + A.BIRDS[A.birdIndex(r.mmr)].name; }).join(', '));
    var best = rows.slice().sort(function (a, b) { return b.win - a.win || b.mmr - a.mmr; })[0];
    if (best && best.win) lines.push('ชนะมากสุด: ' + best.name + ' ' + best.win + ' เกม');
    var g = rows.map(function (r) { return r.played; });
    if (g.length) {
      var lo = Math.min.apply(null, g), hi = Math.max.apply(null, g);
      lines.push('เล่นคนละ ' + lo + (lo === hi ? '' : '–' + hi) + ' เกม');
    }
    lines.push('', 'Budmintan');
    return lines.join('\n');
  }
  async function shareText(text) {
    if (navigator.share) {
      try { await navigator.share({ text: text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('คัดลอกสรุปแล้ว เปิด LINE แล้ววางในกลุ่มได้เลย', null); }
    catch (e) { ui.shareFallback = text; toast('คัดลอกอัตโนมัติไม่ได้ กดค้างที่ข้อความเพื่อคัดลอกเอง', null); render(); }
  }

  /* ---------- all-time stats for this club (loaded on demand) ---------- */
  async function loadAllStats() {
    if (ui.allLoading) return;
    ui.allLoading = true;
    try { ui.allStats = await DB.loadAllStats(); } catch (e) { ui.allStats = { error: errMsg(e) }; }
    ui.allLoading = false;
    if (ui.tab === 'sum') render();
  }
  function statsModel(data) {
    var P = {};
    var get = function (id) { return P[id] || (P[id] = { id: id, g: 0, w: 0, nights: {}, trail: [], part: {}, opp: {}, streak: 0, best: 0 }); };
    data.matches.forEach(function (m) {
      (m.match_players || []).forEach(function (mp) {
        var r = get(mp.player_id), mine = m.team_a.indexOf(mp.player_id) >= 0 ? m.team_a : m.team_b, other = mine === m.team_a ? m.team_b : m.team_a;
        r.g++;
        if (mp.won) { r.w++; r.streak++; r.best = Math.max(r.best, r.streak); } else r.streak = 0;
        r.nights[m.session_id] = 1;
        if (mp.rating_after != null) r.trail.push(+mp.rating_after);
        mine.forEach(function (x) { if (x !== mp.player_id) { var k = r.part[x] || (r.part[x] = { g: 0, w: 0 }); k.g++; if (mp.won) k.w++; } });
        other.forEach(function (x) { var k = r.opp[x] || (r.opp[x] = { g: 0, l: 0 }); k.g++; if (!mp.won) k.l++; });
      });
    });
    return P;
  }
  function spark(trail, w, h) {
    if (trail.length < 2) return '<span class="spark"></span>';
    var lo = Math.min.apply(null, trail), hi = Math.max.apply(null, trail), span = hi - lo || 1;
    var pts = trail.map(function (v, i) { return (i / (trail.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - lo) / span * (h - 4)).toFixed(1); }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }
  /* loading / error placeholder shared by the month and all-nights views; null when the data is in */
  function statsGate() {
    if (!ui.allStats) { loadAllStats(); return '<div class="card span"><span class="muted">กำลังโหลดสถิติ…</span></div>'; }
    if (ui.allStats.error) return '<div class="card span"><p class="err">โหลดสถิติไม่ได้: ' + esc(ui.allStats.error) + '</p><button class="btn sm" data-act="stats-reload">ลองใหม่</button></div>';
    return null;
  }
  function viewAllStats() {
    var gate = statsGate(); if (gate) return gate;
    var data = ui.allStats, P = statsModel(data), map = byId(), RT = A.ratings(S.done, S.players, S.adj);
    var played = {}; data.matches.forEach(function (m) { played[m.session_id] = 1; });
    var rows = Object.keys(P).map(function (k) { return P[k]; }).filter(function (r) { return map[r.id]; })
      .sort(function (a, b) { return b.g - a.g || b.w - a.w; });
    var h = '<div class="strip span"><div class="fact"><b>' + Object.keys(played).length + '</b><span>คืนที่มีการแข่ง</span></div><div class="fact"><b>' + data.matches.length + '</b><span>แมตช์ทั้งหมด</span></div><div class="fact"><b>' + rows.length + '</b><span>คนที่เคยลงสนาม</span></div></div>';
    if (!rows.length) return h + '<div class="card span"><span class="muted">ยังไม่มีแมตช์ที่บันทึก</span></div>';
    var nm = function (id) { return map[id] ? esc(map[id].name) : 'สมาชิกเก่า'; };
    var att = A.attendance(data, todayISO());
    h += awayCard(att, map);
    h += h2hCard(data, rows.map(function (r) { return map[r.id]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); }));
    h += '<div class="card span"><h2>ทุกคืน</h2><p class="muted small">รวมคืนนี้ส่วนที่บันทึกขึ้นระบบแล้ว แตะชื่อเพื่อดูคู่หูและกราฟคะแนน</p><div class="alltable">';
    rows.forEach(function (r) {
      var open = ui.statId === r.id, mmr = Math.round(RT.R[r.id] != null ? RT.R[r.id] : (r.trail[r.trail.length - 1] || 1500));
      h += '<button class="srow2' + (open ? ' on' : '') + '" data-act="stat-open" data-id="' + r.id + '" aria-expanded="' + open + '">' + bird(A.birdIndex(mmr), 'md') +
        '<span class="who"><b>' + nm(r.id) + '</b><span>' + Object.keys(r.nights).length + ' คืน · ' + r.g + ' เกม · ชนะ ' + Math.round(r.w / r.g * 100) + '%' + (att[r.id] && att[r.id].streak >= 2 ? ' · มาติด ' + att[r.id].streak + ' สัปดาห์' : '') + '</span></span>' +
        spark(r.trail.slice(-30), 80, 26) + '<b class="mm">' + mmr + '</b></button>';
      if (open) {
        var pk = Object.keys(r.part).map(function (k) { return { id: +k, g: r.part[k].g, w: r.part[k].w }; }).filter(function (x) { return x.g >= 2; })
          .sort(function (a, b) { return b.w / b.g - a.w / a.g || b.g - a.g; })[0];
        var ok = Object.keys(r.opp).map(function (k) { return { id: +k, g: r.opp[k].g, l: r.opp[k].l }; }).filter(function (x) { return x.g >= 2; })
          .sort(function (a, b) { return b.l / b.g - a.l / a.g || b.g - a.g; })[0];
        h += '<div class="statdetail">' + (r.trail.length > 1 ? spark(r.trail, 300, 70) + '<span class="muted small">MMR ' + Math.round(Math.min.apply(null, r.trail)) + '–' + Math.round(Math.max.apply(null, r.trail)) + ' จาก ' + r.trail.length + ' เกม</span>' : '') +
          '<div class="statfacts"><span><b>คู่หูมือขึ้น</b>' + (pk ? nm(pk.id) + ' ชนะด้วยกัน ' + pk.w + '/' + pk.g : 'ยังเล่นคู่ใครไม่ถึง 2 เกม') + '</span>' +
          '<span><b>คู่ปรับ</b>' + (ok && ok.l ? nm(ok.id) + ' แพ้ให้ ' + ok.l + '/' + ok.g : 'ยังไม่มี') + '</span>' +
          '<span><b>ชนะติดกันมากสุด</b>' + r.best + ' เกม</span></div>' +
          '<button class="btn sm" data-act="card" data-id="' + r.id + '">' + ic('share') + 'การ์ดยศของ ' + nm(r.id) + '</button></div>';
      }
    });
    return h + '</div></div>';
  }

  /* <details> keep their open/closed state across re-renders (a confirm tap re-renders the page) */
  function det(key, defOpen) { ui.det = ui.det || {}; var o = key in ui.det ? ui.det[key] : !!defOpen; return ' data-k="' + key + '"' + (o ? ' open' : ''); }
  // only the admin's own taps are remembered (a default-open section fires toggle too, which must not stick)
  document.addEventListener('click', function (e) {
    var sm = e.target.closest && e.target.closest('summary'), d = sm && sm.parentElement;
    if (d && d.dataset && d.dataset.k) { ui.det = ui.det || {}; ui.det[d.dataset.k] = !d.open; }
  }, true);

  /* ---------- pair rules (club-wide, saved in the database) ---------- */
  function rulesCard() {
    var map = byId(), members = S.players.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); }).filter(function (p) { return !p.pending; });
    var h = '<div class="card span"><h2>คู่พิเศษ</h2><p class="muted small">เล่นคู่กันเสมอ: ถ้ามาทั้งคู่ จะลงสนามพร้อมกันเป็นทีมเดียวกัน ถ้าอีกคนยังเล่นอยู่ อีกคนจะรอ · ไม่ให้เจอกัน: ไม่ลงสนามเดียวกันเลย กฎใช้เฉพาะคืนที่มาทั้งสองคน</p>';
    (S.rules || []).forEach(function (r) {
      var a = map[r.a], b = map[r.b]; if (!a || !b) return;
      h += '<div class="srow"><div class="stext"><b>' + esc(a.name) + (r.kind === 'with' ? ' + ' : ' / ') + esc(b.name) + '</b><span>' + (r.kind === 'with' ? 'เล่นคู่กันเสมอ' : 'ไม่ให้เจอกัน') + '</span></div>' +
        '<button class="icon danger-ico" data-act="rule-del" data-id="' + r.id + '" aria-label="ลบกฎ ' + esc(a.name) + ' กับ ' + esc(b.name) + '">' + ic('trash') + '</button></div>';
    });
    var opts = members.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    h += '<form id="ruleForm" class="ruleform" autocomplete="off"><select class="field" id="ruleA" aria-label="คนแรก"><option value="">เลือกคน</option>' + opts + '</select>' +
      '<select class="field" id="ruleB" aria-label="คนที่สอง"><option value="">เลือกคน</option>' + opts + '</select>' +
      '<select class="field" id="ruleKind" aria-label="แบบของกฎ"><option value="with">เล่นคู่กันเสมอ</option><option value="apart">ไม่ให้เจอกัน</option></select>' +
      '<button class="btn sm primary" type="submit">' + ic('plus') + 'เพิ่มกฎ</button></form></div>';
    return h;
  }
  async function addRule() {
    var a = +$('ruleA').value, b = +$('ruleB').value, kind = $('ruleKind').value;
    if (!a || !b || a === b) { toast('เลือกสองคนที่ต่างกัน', null); return; }
    if ((S.rules || []).some(function (r) { return (r.a === a && r.b === b) || (r.a === b && r.b === a); })) { toast('สองคนนี้มีกฎอยู่แล้ว ลบอันเดิมก่อน', null); return; }
    if (kind === 'with' && (S.rules || []).some(function (r) { return r.kind === 'with' && [r.a, r.b].some(function (x) { return x === a || x === b; }); })) { toast('คนหนึ่งเล่นคู่กันเสมอได้กับคนเดียว', null); return; }
    try { var row = await DB.addRule(a, b, kind); S.rules = (S.rules || []).concat([row]); writeCache(); toast('เพิ่มกฎแล้ว', null); }
    catch (e) { toast('เพิ่มกฎไม่ได้: ' + (isOffline(e) ? 'ต้องออนไลน์' : errMsg(e)), null); }
    render();
  }
  async function deleteRule(id) {
    try { await DB.deleteRule(id); S.rules = (S.rules || []).filter(function (r) { return r.id !== id; }); writeCache(); toast('ลบกฎแล้ว', null); }
    catch (e) { toast('ลบกฎไม่ได้: ' + (isOffline(e) ? 'ต้องออนไลน์' : errMsg(e)), null); }
    render();
  }

  /* ---------- bird ranks ---------- */
  /* ---------- month view: awards and a LINE recap ---------- */
  function monthLabel(ym) { return thaiDate(new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1), { month: 'long', year: 'numeric' }); }
  function shortDay(d) { return d ? thaiDate(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)), { day: 'numeric', month: 'short' }) : ''; }
  function monthModel(ym) {
    var map = byId();
    var ms = A.monthStats(ui.allStats, ym, function (id) { return map[id] ? map[id].level || 'I' : 'I'; });
    ms.rows = ms.rows.filter(function (r) { return map[r.id]; });     // removed members stay out of the boards
    ms.rows.forEach(function (r) { r.name = map[r.id].name; });
    ms.awards = A.monthAwards(ms);
    return ms;
  }
  function monthText(ms) {
    var aw = ms.awards, L = ['สรุปเดือน' + monthLabel(ms.ym) + ' · ' + (ui.club ? ui.club.name : 'ก๊วน'), ms.nights + ' คืน · ' + ms.matches + ' แมตช์ · ' + ms.rows.length + ' คน'];
    if (aw.improved.length) {
      L.push('', 'พัฒนาสูงสุด');
      aw.improved.forEach(function (r, i) { L.push((i + 1) + '. ' + r.name + ' ' + fmtDelta(r.gain) + ' MMR (' + r.start + ' → ' + r.end + ')'); });
    }
    if (aw.busiest.length) L.push('', 'ขยันสุด: ' + aw.busiest[0].name + ' ' + aw.busiest[0].g + ' เกม ' + aw.busiest[0].nights + ' คืน');
    if (aw.wins.length) L.push('ชนะมากสุด: ' + aw.wins[0].name + ' ' + aw.wins[0].w + ' เกม');
    if (aw.rate.length) L.push('อัตราชนะสูงสุด: ' + aw.rate[0].name + ' ' + Math.round(aw.rate[0].w / aw.rate[0].g * 100) + '% (' + aw.rate[0].w + '/' + aw.rate[0].g + ')');
    if (aw.streak.length) L.push('ชนะติดกันยาวสุด: ' + aw.streak[0].name + ' ' + aw.streak[0].best + ' เกม');
    if (aw.promoted.length) L.push('', 'เลื่อนยศเดือนนี้: ' + aw.promoted.map(function (r) { return r.name + ' เป็น' + A.BIRDS[r.birdTo].name; }).join(', '));
    L.push('', 'Budmintan');
    return L.join('\n');
  }
  function awardCard(title, hint, list, val) {
    var h = '<div class="card award"><div class="ahead"><h2>' + title + '</h2>' + (hint ? '<span class="muted small">' + hint + '</span>' : '') + '</div>';
    if (!list.length) return h + '<span class="muted small">ยังไม่มีใครเข้าเกณฑ์</span></div>';
    list.forEach(function (r, i) {
      h += '<div class="awrow' + (i === 0 ? ' first' : '') + '"><span class="pos">' + (i + 1) + '</span>' + bird(r.birdTo, 'md') + '<b class="nm">' + esc(r.name) + '</b><span class="val">' + val(r) + '</span></div>';
    });
    return h + '</div>';
  }
  function viewMonth() {
    var gate = statsGate(); if (gate) return gate;
    var months = A.monthsOf(ui.allStats);
    if (!months.length) return '<div class="card span"><span class="muted">ยังไม่มีแมตช์ที่บันทึก</span></div>';
    if (months.indexOf(ui.month) < 0) ui.month = months[0];
    var i = months.indexOf(ui.month), ms = monthModel(ui.month), aw = ms.awards;
    var h = '<div class="monthbar span"><button class="hbtn" data-act="month-step" data-d="1" aria-label="เดือนก่อนหน้า"' + (i >= months.length - 1 ? ' disabled' : '') + '><span class="rot-l">' + ic('chev') + '</span></button>' +
      '<b>' + monthLabel(ui.month) + '</b><button class="hbtn" data-act="month-step" data-d="-1" aria-label="เดือนถัดไป"' + (i <= 0 ? ' disabled' : '') + '><span class="rot-r">' + ic('chev') + '</span></button></div>';
    h += '<div class="strip span"><div class="fact"><b>' + ms.nights + '</b><span>คืนที่เล่น</span></div><div class="fact"><b>' + ms.matches + '</b><span>แมตช์</span></div><div class="fact"><b>' + ms.rows.length + '</b><span>คนที่ลงสนาม</span></div></div>';
    h += '<div class="card span sharecard"><div class="line"><div class="stext"><b>ส่งสรุปเดือนนี้ไป LINE</b><span>คนพัฒนาสูงสุด ขยันสุด ชนะมากสุด และคนเลื่อนยศ</span></div>' +
      '<button class="btn primary" data-act="share-month">' + ic('share') + 'ส่งไป LINE</button></div>' +
      '<details' + det('monthpv') + '><summary class="small">ดูข้อความก่อนส่ง' + ic('chev') + '</summary><pre class="sharetext">' + esc(monthText(ms)) + '</pre></details></div>';
    if (ui.shareFallback) h += '<div class="card span"><b>กดค้างเพื่อคัดลอก</b><textarea class="field" rows="8" readonly>' + esc(ui.shareFallback) + '</textarea></div>';
    h += '<div class="awards span">' +
      awardCard('พัฒนาสูงสุด', 'MMR ที่ขึ้นในเดือนนี้ เล่นอย่างน้อย 3 เกม', aw.improved, function (r) { return '<b class="up">' + fmtDelta(r.gain) + '</b><small>' + r.start + ' → ' + r.end + '</small>'; }) +
      awardCard('ขยันสุด', 'เกมที่เล่นในเดือนนี้', aw.busiest, function (r) { return '<b>' + r.g + '</b><small>เกม · ' + r.nights + ' คืน</small>'; }) +
      awardCard('ชนะมากสุด', '', aw.wins, function (r) { return '<b>' + r.w + '</b><small>จาก ' + r.g + ' เกม</small>'; }) +
      awardCard('อัตราชนะสูงสุด', 'เล่นอย่างน้อย 5 เกม', aw.rate, function (r) { return '<b>' + Math.round(r.w / r.g * 100) + '%</b><small>' + r.w + '/' + r.g + '</small>'; }) +
      awardCard('ชนะติดกันยาวสุด', '', aw.streak, function (r) { return '<b>' + r.best + '</b><small>เกมติด</small>'; }) +
      '</div>';
    if (aw.promoted.length) {
      h += '<div class="card span"><h2>เลื่อนยศเดือนนี้</h2><div class="promos">' + aw.promoted.map(function (r) {
        return '<div class="promo">' + bird(r.birdFrom, 'sm') + '<span class="arrow">' + '<span class="rot-r">' + ic('chev') + '</span></span>' + bird(r.birdTo, 'md') + '<span><b>' + esc(r.name) + '</b><small>' + A.BIRDS[r.birdTo].name + '</small></span></div>';
      }).join('') + '</div></div>';
    }
    var rows = ms.rows.slice().sort(function (a, b) { return b.gain - a.gain || b.g - a.g; });
    h += '<div class="card span"><h2>ทุกคนในเดือนนี้</h2><p class="muted small">เรียงตาม MMR ที่ได้ในเดือนนี้</p><div class="mtable">';
    rows.forEach(function (r, k) {
      h += '<div class="mrow"><span class="pos">' + (k + 1) + '</span>' + bird(r.birdTo, 'sm') + '<b class="nm">' + esc(r.name) + '</b><span class="muted small">' + r.g + ' เกม · ชนะ ' + Math.round(r.w / r.g * 100) + '%</span><b class="' + (r.gain > 0 ? 'up' : r.gain < 0 ? 'down' : '') + '">' + fmtDelta(r.gain) + '</b></div>';
    });
    return h + '</div></div>';
  }

  /* ---------- members who have not played for 3+ weeks (for the admin to message) ---------- */
  var AWAY_DAYS = 21;
  function awayCard(att, map) {
    var list = Object.keys(att).map(function (k) { return { id: +k, a: att[k] }; })
      .filter(function (x) { return map[x.id] && !map[x.id].active && x.a.daysAway >= AWAY_DAYS; })
      .sort(function (x, y) { return y.a.daysAway - x.a.daysAway; });
    if (!list.length) return '';
    return '<div class="card span"><details' + det('away') + '><summary>หายไปนาน (' + list.length + ')' + ic('chev') + '</summary>' +
      '<p class="muted small">ไม่ได้ลงเล่นมา 3 สัปดาห์ขึ้นไป ลองทักชวนกลับมาในกลุ่ม LINE</p><div class="awaylist">' + list.map(function (x) {
        return '<div class="awayrow"><b>' + esc(map[x.id].name) + '</b><span class="muted small">หายไป ' + Math.floor(x.a.daysAway / 7) + ' สัปดาห์ · มาล่าสุด ' + shortDay(x.a.last) + '</span></div>';
      }).join('') + '</div></details></div>';
  }

  /* ---------- head-to-head: pick two members ---------- */
  function h2hCard(data, members) {
    ui.h2h = ui.h2h || [null, null];
    var sel = function (i) {
      return '<select class="field" data-act="h2h" data-i="' + i + '" aria-label="ผู้เล่นคนที่ ' + (i + 1) + '"><option value="">เลือกชื่อ</option>' + members.map(function (p) {
        return '<option value="' + p.id + '"' + (ui.h2h[i] === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('') + '</select>';
    };
    var h = '<div class="card span h2h"><h2>เจอกัน</h2><p class="muted small">เลือกสองชื่อ ดูว่าเคยเจอกันกี่ครั้ง ใครชนะ และเป็นคู่กันแล้วรอดไหม</p><div class="h2hpick">' + sel(0) + '<span class="vs">VS</span>' + sel(1) + '</div>';
    var a = ui.h2h[0], b = ui.h2h[1], map = byId();
    if (a == null || b == null || a === b || !map[a] || !map[b]) return h + '</div>';
    var r = A.headToHead(data, a, b), na = esc(map[a].name), nb = esc(map[b].name);
    if (!r.vs.g && !r.with.g) return h + '<p class="muted">สองคนนี้ยังไม่เคยลงสนามเดียวกัน</p></div>';
    h += '<div class="h2hres"><div class="side' + (r.vs.a > r.vs.b ? ' lead' : '') + '"><b>' + r.vs.a + '</b><span>' + na + '</span></div><div class="mid">ชนะกันเอง<br>' + r.vs.g + ' เกม</div><div class="side' + (r.vs.b > r.vs.a ? ' lead' : '') + '"><b>' + r.vs.b + '</b><span>' + nb + '</span></div></div>';
    h += '<div class="statfacts"><span><b>เป็นคู่กัน</b>' + (r.with.g ? r.with.g + ' เกม ชนะ ' + r.with.w + ' (' + Math.round(r.with.w / r.with.g * 100) + '%)' : 'ยังไม่เคย') + '</span>' +
      '<span><b>เจอกันล่าสุด</b>' + shortDay(r.lastDay) + '</span></div>';
    return h + '</div>';
  }

  /* ---------- personal rank card: a PNG drawn on a canvas, shared to LINE ---------- */
  // Fixed colours on purpose: the card is an exported picture and must look the same in light and dark mode.
  var CARD = { bg: '#0b1f44', bg2: '#163370', ink: '#ffffff', muted: '#c7d2ea', hi: '#c6f432', onHi: '#0b1f44', line: 'rgba(255,255,255,.14)' };
  function cardStats(id) {
    var P = statsModel(ui.allStats), r = P[id], map = byId(), RT = A.ratings(S.done, S.players, S.adj);
    if (!r || !map[id]) return null;
    var mmr = Math.round(RT.R[id] != null ? RT.R[id] : (r.trail[r.trail.length - 1] || 1500)), bi = A.birdIndex(mmr);
    var pk = Object.keys(r.part).map(function (k) { return { id: +k, g: r.part[k].g, w: r.part[k].w }; }).filter(function (x) { return x.g >= 2 && map[x.id]; })
      .sort(function (a, b) { return b.w / b.g - a.w / a.g || b.g - a.g; })[0];
    var next = A.BIRDS[bi + 1];
    return { name: map[id].name, mmr: mmr, bird: bi, g: r.g, w: r.w, nights: Object.keys(r.nights).length, best: r.best,
      partner: pk ? map[pk.id].name + ' ชนะด้วยกัน ' + pk.w + '/' + pk.g : null, next: next ? { name: next.name, need: next.min - mmr, from: bi === 0 ? next.min - 150 : A.BIRDS[bi].min, to: next.min } : null };
  }
  function birdImage(k) {
    return new Promise(function (ok, bad) {
      var img = new Image();
      img.onload = function () { ok(img); }; img.onerror = function () { bad(new Error('emblem did not load')); };
      img.src = birdSrc(k, true);
    });
  }
  async function makeCard(id) {
    var c = cardStats(id); if (!c) return;
    ui.busy = 'กำลังทำการ์ด…'; render();
    try {
      if (document.fonts && document.fonts.load) await Promise.all(['400', '600', '800'].map(function (w) { return document.fonts.load(w + ' 40px Prompt').catch(function () { }); }));
      var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d'), F = function (w, px) { return w + ' ' + px + 'px Prompt, "Noto Sans Thai", sans-serif'; };
      var grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, CARD.bg2); grad.addColorStop(1, CARD.bg);
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillStyle = CARD.muted; g.font = F(600, 34); g.fillText('Budmintan · ' + (ui.club ? ui.club.name : ''), W / 2, 92);
      var em = await birdImage(A.BIRDS[c.bird].k);
      g.drawImage(em, W / 2 - 230, 130, 460, 460);
      g.fillStyle = CARD.ink; g.font = F(800, 96); g.fillText(c.name, W / 2, 700, W - 120);
      var bn = A.BIRDS[c.bird].name; g.font = F(800, 44);
      var bw = g.measureText(bn).width + 64;
      g.fillStyle = CARD.hi; roundRect(g, W / 2 - bw / 2, 752, bw, 72, 36); g.fill();
      g.fillStyle = CARD.onHi; g.fillText(bn, W / 2, 804);
      g.fillStyle = CARD.ink; g.font = F(800, 120); g.fillText(String(c.mmr), W / 2, 960);
      g.fillStyle = CARD.muted; g.font = F(600, 32); g.fillText('MMR', W / 2, 1002);
      if (c.next) {                                    // progress to the next bird
        var bx = 190, bwid = W - 380, p = Math.max(0, Math.min(1, (c.mmr - c.next.from) / (c.next.to - c.next.from)));
        if (!isFinite(p)) p = 0;
        g.fillStyle = CARD.line; roundRect(g, bx, 1032, bwid, 16, 8); g.fill();
        g.fillStyle = CARD.hi; roundRect(g, bx, 1032, Math.max(16, bwid * p), 16, 8); g.fill();
        g.fillStyle = CARD.muted; g.font = F(400, 28); g.fillText('อีก ' + Math.max(1, c.next.need) + ' MMR ถึง' + c.next.name, W / 2, 1090);
      } else { g.fillStyle = CARD.hi; g.font = F(600, 30); g.fillText('ยศสูงสุดของก๊วน', W / 2, 1060); }
      var facts = [[String(c.g), 'เกม'], [Math.round(c.w / Math.max(1, c.g) * 100) + '%', 'ชนะ'], [String(c.nights), 'คืน'], [String(c.best), 'ชนะติด']];
      g.strokeStyle = CARD.line; g.lineWidth = 2; g.beginPath(); g.moveTo(90, 1128); g.lineTo(W - 90, 1128); g.stroke();
      facts.forEach(function (f, i) {
        var x = 90 + (W - 180) / 4 * (i + .5);
        g.fillStyle = CARD.ink; g.font = F(800, 60); g.fillText(f[0], x, 1202);
        g.fillStyle = CARD.muted; g.font = F(400, 28); g.fillText(f[1], x, 1242);
      });
      g.fillStyle = CARD.muted; g.font = F(400, 28);
      g.fillText(c.partner ? 'คู่หูมือขึ้น: ' + c.partner : thaiDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, 1306, W - 120);
      var blob = await new Promise(function (ok) { cv.toBlob(ok, 'image/png'); });
      closeCard();
      ui.card = { url: URL.createObjectURL(blob), blob: blob, name: c.name };
    } catch (e) { toast('ทำการ์ดไม่ได้: ' + errMsg(e), null); }
    ui.busy = null; render();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function closeCard() { if (ui.card && ui.card.url) { try { URL.revokeObjectURL(ui.card.url); } catch (e) { } } ui.card = null; }
  function cardFileName() { return 'budmintan-' + (ui.card ? ui.card.name : 'card').replace(/[^\w฀-๿-]+/g, '') + '.png'; }
  async function shareCard() {
    if (!ui.card) return;
    var file = new File([ui.card.blob], cardFileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    toast('ส่งต่อจากแอปไม่ได้ กดค้างที่รูปเพื่อบันทึก หรือกดดาวน์โหลด', null);
  }
  function cardModal() {
    return '<div class="modal" role="dialog" aria-modal="true" aria-label="การ์ดยศของ ' + esc(ui.card.name) + '"><div class="modalbox">' +
      '<img class="cardimg" src="' + ui.card.url + '" alt="การ์ดยศของ ' + esc(ui.card.name) + '">' +
      '<p class="muted small">กดส่งต่อเพื่อเลือก LINE หรือกดค้างที่รูปเพื่อบันทึก</p>' +
      '<div class="acts"><button class="btn primary" data-act="card-share">' + ic('share') + 'ส่งต่อ</button>' +
      '<a class="btn" href="' + ui.card.url + '" download="' + esc(cardFileName()) + '">' + ic('download') + 'ดาวน์โหลด</a>' +
      '<button class="btn" data-act="card-close">' + ic('x') + 'ปิด</button></div></div></div>';
  }

  /* rank emblems are pictures in img/birds (192 px for the UI, 512 px for the rank card); bump BIRD_V when they change */
  var BIRD_V = 1;
  function birdSrc(k, big) { return 'img/birds/' + k + (big ? '-512' : '') + '.webp?v=' + BIRD_V; }
  function bird(i, size) {
    var b = A.BIRDS[i] || A.BIRDS[0];
    return '<span class="bird bd-' + b.k + (size ? ' ' + size : '') + '" role="img" aria-label="' + b.name + '" title="' + b.name + '"><img src="' + birdSrc(b.k) + '" alt="" decoding="async" draggable="false"></span>';
  }
  function birdRange(i) {
    var lo = A.BIRDS[i].min, hi = i + 1 < A.BIRDS.length ? A.BIRDS[i + 1].min - 1 : null;
    return i === 0 ? 'ต่ำกว่า ' + A.BIRDS[1].min : hi == null ? lo + ' ขึ้นไป' : lo + '–' + hi;
  }
  /* rank changes caused by the last saved match, for the toast */
  function birdChanges(before, after, ids) {
    var out = [], map = byId();
    ids.forEach(function (id) {
      if (before.B[id] == null || before.B[id] === after.B[id] || !map[id]) return;
      out.push({ name: map[id].name, i: after.B[id], up: after.B[id] > before.B[id] });
    });
    return out;
  }
  function setLevel(id, lv) {
    var p = A.findP(S, id); if (!p || !LV_LABEL[lv]) return;
    p.level = lv; p.start = A.LV[lv];
    // saved straight away too, so it sticks even before tonight is opened
    if (!p.pending) DB.updatePlayer(p.id, { level: p.level, start_mmr: p.start }).catch(function () { });
  }

  /* ---------- views ---------- */
  function teamHtml(c, ci, s, map, RT, st, p) {
    var t = c.t[s], cls = s ? 'tb' : 'ta', state = c.w == null ? '' : (c.w === s ? ' win' : ' lose');
    var names = t.map(function (id, i) {
      var pl = map[id], pos = { ci: ci, s: s, i: i };
      var r = Math.round(RT.R[id] || 1500);
      return '<button class="pl' + (sameSel(pos) ? ' sel' : '') + (!pl || !pl.active ? ' gone' : '') + '" data-act="pick" data-ci="' + ci + '" data-s="' + s + '" data-i="' + i + '" aria-label="เลือก ' + (pl ? esc(pl.name) : '') + ' เพื่อสลับ">' + (pl ? bird(RT.B[id], 'sm') + esc(pl.name) : '-') + '<small>' + r + '</small>' + (pl && pl.rest ? '<span class="restmark">พักตาหน้า</span>' : '') + '</button>';
    }).join('<span class="plus">+</span>');
    var avg = Math.round(((RT.R[t[0]] || 1500) + (RT.R[t[1]] || 1500)) / 2);
    var pct = Math.round((s ? 1 - p : p) * 100);
    return '<div class="team ' + cls + state + '"><span class="tlabel">ทีม ' + (s ? 'B' : 'A') + '</span>' + names +
      '<span class="tmeta" title="MMR เฉลี่ยของทีม และโอกาสชนะ">เฉลี่ย ' + avg + ' · ' + pct + '%</span>' +
      '<label class="scin"><span>แต้ม</span><input type="number" inputmode="numeric" min="0" max="99" placeholder="–" data-act="score" data-ci="' + ci + '" data-s="' + s + '" value="' + (c.sc && c.sc[s] != null ? c.sc[s] : '') + '" aria-label="แต้มทีม ' + (s ? 'B' : 'A') + ' สนาม ' + (ci + 1) + '"></label>' +
      '<button class="won' + (c.w === s ? ' on' : '') + '" data-act="win" data-ci="' + ci + '" data-s="' + s + '" aria-pressed="' + (c.w === s) + '">' + ic('check') + (c.w === s ? 'ชนะ' : 'ทีมนี้ชนะ') + '</button></div>';
  }
  function courtHtml(c, ci, map, RT, st, free, next) {
    var mode = S.courts[ci].mode;
    var head = '<div class="court-head"><span class="cname">สนาม ' + (ci + 1) + '</span>' +
      '<button class="modechip m-' + mode + '" data-act="mode" data-ci="' + ci + '" aria-label="โหมดสนาม ' + (ci + 1) + ': ' + MODE_LABEL[mode] + ' แตะเพื่อเปลี่ยน">' + MODE_LABEL[mode] + '</button>';
    if (!c) {
      var hint;
      if (next && next.after != null) hint = '<span>สนามว่าง · คิวต่อจากสนาม ' + (next.after + 1) + '</span>';
      else if (next && next.length === 4) hint = '<span class="next"><b>ถัดไป</b> ' + next.map(function (id) { return esc(map[id].name); }).join(', ') +
        (mode !== 'normal' && S.flex ? '<small>โหมดนี้อาจเลือกคนถัดไปในคิวแทน เพื่อให้ระดับเหมาะ</small>' : '') + '</span>';
      else hint = '<span>สนามว่าง' + (free < 4 ? ' · คนรอคิวไม่ถึง 4 คน' : '') + '</span>';
      return '<section class="court">' + head + '</div><div class="slot">' + hint + (free >= 4 ? '<button class="btn sm hi" data-act="draw" data-ci="' + ci + '">' + ic('shuffle') + 'สุ่มลงสนามนี้</button>' : '') + '</div></section>';
    }
    var stale = A.isStale(S, c), m = mins(c.at);
    var long = m != null && m >= LONG_MIN;
    head += '<span class="badge' + (long ? ' warn' : '') + '" data-tick="court" data-t="' + (c.at || '') + '">' + courtAge(c.at) + '</span>';
    head += '<button class="redraw" data-act="redraw" data-ci="' + ci + '" aria-label="สุ่มสนาม ' + (ci + 1) + ' ใหม่ (ไม่นับแมตช์)">' + ic('shuffle') + 'สุ่มใหม่</button></div>';
    var p = A.winProb(RT, c.t);
    var h = '<section class="court' + (long ? ' long' : '') + '">' + head;
    if (stale) h += '<div class="note">มีคนในสนามนี้ปิดสถานะเล่นแล้ว แตะชื่อเพื่อสลับกับคนในคิว หรือกดสุ่มใหม่</div>';
    h += '<div class="match' + (A.hasRes(c) ? ' picked' : '') + '">' + teamHtml(c, ci, 0, map, RT, st, p) + '<div class="vs" aria-hidden="true"><span>VS</span></div>' + teamHtml(c, ci, 1, map, RT, st, p) + '</div>';
    if (A.hasRes(c) && !stale) {
      var wn = c.t[c.w].map(function (id) { return map[id] ? esc(map[id].name) : '-'; }).join(' + ');
      h += '<div class="court-actions one"><button class="btn primary big" data-act="save" data-ci="' + ci + '">' + ic('check') + 'บันทึกผล: ' + wn + ' ชนะ</button></div>';
    }
    return h + '</section>';
  }
  function fillState() {
    var empty = A.emptySlots(S).length, free = A.freeCount(S);
    if (!empty) return { label: 'ทุกสนามมีคนเล่นอยู่', dis: true };
    if (free < 4) return { label: 'คนรอคิวไม่ถึง 4 คน', dis: true };
    return { label: 'สุ่มลงสนามว่าง (' + Math.min(empty, Math.floor(free / 4)) + ')', dis: false };
  }
  /* night banner: four facts, then who is sitting out right now (tap to swap, same as the queue) */
  function boardHtml(map, RT, st, q) {
    var on = A.liveIds(S).length / 4, here = S.players.filter(function (p) { return p.active; });
    var starts = S.done.map(function (m) { return m.at; }).concat(S.live.map(function (c) { return c && c.at; })).filter(Boolean);
    var t0 = starts.length ? Math.min.apply(null, starts) : null, el = t0 ? Math.max(0, Date.now() - t0) : 0;
    var hm = Math.floor(el / 3600000) + ':' + ('0' + Math.floor(el / 60000) % 60).slice(-2);
    var counts = here.map(function (p) { return st.played[p.id] || 0; });
    var lo = counts.length ? Math.min.apply(null, counts) : 0, hi = counts.length ? Math.max.apply(null, counts) : 0;
    var fair = hi - lo <= 1;
    var resting = here.filter(function (p) { return p.rest; });
    var sitting = q.length + resting.filter(function (p) { return A.liveIds(S).indexOf(p.id) < 0; }).length;
    var clock = function (ms) { var d = new Date(ms); return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); };
    var h = '<section class="board" aria-label="สรุปคืนนี้"><svg class="wm" aria-hidden="true"><use href="#i-shuttle"/></svg><div class="facts4">' +
      '<div class="fact"><span>แมตช์ที่จบ</span><b id="doneCount">' + S.done.length + '</b><small>กำลังเล่น ' + on + '/' + S.courts.length + ' สนาม</small><small class="longest" data-tick="longest">' + longestText() + '</small></div>' +
      '<div class="fact"><span>เวลาเล่น</span><b data-tick="hm" data-t="' + (t0 || '') + '">' + (t0 ? hm : '–') + '</b><small>' + (t0 ? 'เริ่ม ' + clock(t0) + ' น.' : 'ยังไม่เริ่ม') + '</small></div>' +
      '<div class="fact"><span>เกมต่อคน</span><b>' + (lo === hi ? lo : lo + '–' + hi) + '</b><small class="' + (fair ? 'ok' : 'warn') + '">' + (fair ? 'เท่ากันดี' : 'ต่างกัน ' + (hi - lo) + ' เกม') + '</small></div>' +
      '<div class="fact"><span>มาวันนี้</span><b>' + here.length + '</b><small>สนามละ 4 · พัก ' + sitting + ' คน</small></div></div>';
    h += '<div class="rest"><div class="rest-h"><b>พักตานี้</b><span>' + (sitting ? sitting + ' คน' + (q.length && !ui.restPick ? ' · แตะชื่อเพื่อสลับลงสนาม' : '') : '') + '</span>' +
      '<button class="restbtn' + (ui.restPick ? ' on' : '') + '" data-act="restpick" aria-pressed="' + !!ui.restPick + '">' + (ui.restPick ? ic('check') + 'เสร็จ' : ic('pause') + 'ขอพัก') + '</button></div>';
    if (ui.restPick) {
      // pick who sits out the next draw: anyone here tonight, on court or waiting
      h += '<p class="rest-help">แตะชื่อคนที่ขอพัก ระบบจะข้ามเขา 1 ตาแล้วให้กลับมาต้นคิว</p><div class="chips">';
      here.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); }).forEach(function (p) {
        h += '<button class="chip pick' + (p.rest ? ' resting' : '') + '" data-act="rest" data-id="' + p.id + '" aria-pressed="' + !!p.rest + '">' + bird(RT.B[p.id], 'sm') + '<span class="cn">' + esc(p.name) + '</span>' + (p.rest ? '<span class="tag-rest">พัก</span>' : '') + '</button>';
      });
      return h + '</div></div></section>';
    }
    if (!q.length && !resting.length) h += '<p class="rest-none">ไม่มีคนพัก ทุกคนอยู่ในสนาม</p>';
    if (resting.length) {
      h += '<div class="chips restline"><span class="rl">ขอพัก 1 ตา</span>';
      resting.forEach(function (p) {
        h += '<button class="chip resting" data-act="rest" data-id="' + p.id + '" aria-label="ยกเลิกพักของ ' + esc(p.name) + '">' + bird(RT.B[p.id], 'sm') + '<span class="cn">' + esc(p.name) + '</span><span class="cm">' + (A.liveIds(S).indexOf(p.id) >= 0 ? 'หลังจบเกม' : 'ข้ามตาหน้า') + '</span>' + ic('x') + '</button>';
      });
      h += '</div>';
    }
    if (q.length) {
      var L = A.lineup(S, null), nx = A.nextFour(S), heldSet = {};
      L.held.forEach(function (id) { heldSet[id] = 1; });
      h += '<div class="chips">';
      L.list.map(function (x) { return x.id; }).concat(L.held).forEach(function (id) {
        var pl = map[id], w = mins(pl.freeSince), isNext = nx.indexOf(id) >= 0, mate = heldSet[id] ? (S.rules || []).filter(function (r) { return r.kind === 'with' && (r.a === id || r.b === id); })[0] : null;
        h += '<button class="chip' + (isNext ? ' next' : '') + (heldSet[id] ? ' resting' : '') + (sameSel({ id: id }) ? ' sel' : '') + '" data-act="pickq" data-id="' + id + '">' + bird(RT.B[id], 'sm') +
          '<span class="cn">' + esc(pl.name) + '</span><span class="cm" data-tick="wait" data-t="' + (pl.freeSince || '') + '" data-pre="' + (st.played[id] ? st.played[id] + ' เกม' : 'ยังไม่เล่น') + '">' + waitText(st.played[id] ? 'เล่น ' + st.played[id] : 'ยังไม่เล่น', pl.freeSince) + '</span>' +
          (isNext ? '<span class="tag-next">ลงต่อ</span>' : mate ? '<span class="tag-rest">รอคู่</span>' : '') + '</button>';
      });
      h += '</div>';
    }
    return h + '</div></section>';
  }
  function viewPlay() {
    var map = byId(), RT = A.ratings(S.done, S.players, S.adj), st = A.stats(S.done, S.players);
    var q = A.queueOrder(S, null), free = A.freeCount(S), fl = fillState();
    var h = '<div class="roundhead"><h2>สนาม</h2>' +
      '<button class="btn sm livebtn" data-act="live-open">' + ic('qr') + 'ให้ผู้เล่นดูคิว</button>' +
      '<button class="btn primary fill-inline" data-act="fill"' + (fl.dis ? ' disabled' : '') + '>' + ic('shuffle') + fl.label + '</button></div>';
    h += boardHtml(map, RT, st, q);
    if (ui.sel) h += '<div class="selbar"><span>' + ic('swap') + ' เลือก <b>' + esc(selName()) + '</b> แตะคนอื่นในสนามหรือคิวเพื่อสลับ</span><button class="btn sm" data-act="unsel">ยกเลิก</button></div>';
    if (activeCount() < 4) {
      h += '<div class="card start"><h2>เริ่มคืนนี้</h2><p class="muted small">ยังเช็กอินไม่ถึง 4 คน</p>' +
        '<ol><li>คัดลอกโพสต์ลงชื่อจากไลน์</li><li>วางในแท็บผู้เล่น แล้วกดเช็กอิน</li><li>กลับมาที่นี่ แล้วกดสุ่มลงสนามว่าง</li></ol>' +
        '<button class="btn primary" data-act="tab" data-tab="people">' + ic('users') + 'ไปเช็กอินผู้เล่น</button></div>';
    }
    h += '<div class="playgrid"><div class="courts">';
    // any single draw takes the top 4 of the queue, so only the first empty court can promise names
    var firstEmpty = -1;
    S.live.forEach(function (c, ci) {
      var next = null;
      if (!c) {
        if (firstEmpty < 0) { firstEmpty = ci; next = A.nextFour(S); }
        else next = { after: firstEmpty };
      }
      h += courtHtml(c, ci, map, RT, st, free, next);
    });
    return h + '</div></div>' + (ui.liveOpen && S.share ? liveModal() : '');
  }
  function memberRow(p, st, RT, on) {
    if (ui.editPlayer === p.id) return playerEditor(p, RT);
    var canDel = ui.editMembers && st.played[p.id] === 0 && !on[p.id];
    return '<div class="row' + (p.active ? '' : ' off') + '">' + bird(RT.B[p.id], 'md') + '<div class="who"><b>' + esc(p.name) + '</b><span>' + (p.pending ? '<i class="provtxt">รอบันทึก</i> · ' : '') + (p.active ? 'เล่น ' + st.played[p.id] + ' · ' : '') + 'MMR ' + Math.round(RT.R[p.id]) + '</span></div>' +
      '<select class="lvl" data-act="level" data-id="' + p.id + '" aria-label="ยศตั้งต้นของ ' + esc(p.name) + '">' + LV_ORDER.map(function (l) { return '<option value="' + l + '"' + ((p.level || 'I') === l ? ' selected' : '') + '>' + LV_LABEL[l] + '</option>'; }).join('') + '</select>' +
      '<label class="sw"><input type="checkbox" data-act="toggle" data-id="' + p.id + '"' + (p.active ? ' checked' : '') + ' aria-label="มาวันนี้ ' + esc(p.name) + '"><span class="track"></span></label>' +
      (canDel ? '<button class="icon danger-ico" data-act="remove" data-id="' + p.id + '" aria-label="ลบ ' + esc(p.name) + ' ออกจากสมาชิก">' + ic('trash') + '</button>'
        : ui.editMembers ? '<span class="icon"></span>' : '<button class="icon" data-act="edit-player" data-id="' + p.id + '" aria-label="แก้ชื่อหรือ MMR ของ ' + esc(p.name) + '">' + ic('pencil') + '</button>') + '</div>';
  }
  function playerEditor(p, RT) {
    return '<form class="row editrow" id="playerForm" data-id="' + p.id + '" autocomplete="off">' +
      bird(RT.B[p.id], 'md') +
      '<label class="small">ชื่อ<input class="field" id="pName" value="' + esc(p.name) + '" maxlength="40" required></label>' +
      '<label class="small">MMR<input class="field" id="pMmr" type="number" inputmode="numeric" min="0" max="5000" step="1" value="' + Math.round(RT.R[p.id]) + '"></label>' +
      '<div class="acts"><button class="btn sm primary" type="submit">' + ic('check') + 'บันทึก</button><button class="btn sm" type="button" data-act="edit-player-cancel">ยกเลิก</button></div></form>';
  }
  function viewPeople() {
    var st = A.stats(S.done, S.players), RT = A.ratings(S.done, S.players, S.adj), on = {};
    A.liveIds(S).forEach(function (id) { on[id] = 1; });
    var here = S.players.filter(function (p) { return p.active; }), away = S.players.filter(function (p) { return !p.active; });
    var fresh = (ui.newIds || []).map(function (id) { return A.findP(S, id); }).filter(Boolean);
    var h = '';
    if ((ui.nameAsk || []).length) {
      h += '<div class="card span askcard"><h2>ชื่อนี้ใช่คนเดิมไหม</h2><p class="muted small">ชื่อจากโพสต์สะกดคล้ายสมาชิกที่มีอยู่ ถ้าใช่ ระบบจะจำชื่อนี้ไว้ ครั้งหน้าเช็กอินให้เอง</p>';
      ui.nameAsk.forEach(function (q, i) {
        h += '<div class="askrow"><b>"' + esc(q.name) + '"</b><div class="askbtns">' + q.ids.map(function (id) {
          var p = A.findP(S, id); if (!p) return '';
          return '<button class="btn sm primary" data-act="ask-same" data-i="' + i + '" data-id="' + id + '">' + ic('check') + 'ใช่ ' + esc(p.name) + '</button>';
        }).join('') + '<button class="btn sm" data-act="ask-new" data-i="' + i + '">' + ic('plus') + 'คนใหม่</button></div></div>';
      });
      h += '</div>';
    }
    if (fresh.length) {
      h += '<div class="card span newcard"><div class="line"><h2>เลือกยศตั้งต้นให้คนใหม่ (' + fresh.length + ')</h2><button class="btn sm primary" data-act="new-done">' + ic('check') + 'เสร็จ</button></div>' +
        '<p class="muted small">เลือกนกที่ใกล้ฝีมือที่สุดเป็นจุดเริ่ม หลังจากนั้นยศขึ้นลงตามผลแข่ง ฟีนิกซ์ต้องไต่ขึ้นไปเอง</p>';
      fresh.forEach(function (p) {
        h += '<div class="newrow"><b>' + esc(p.name) + '</b><div class="lvpick" role="group" aria-label="ยศตั้งต้นของ ' + esc(p.name) + '">' + LV_ORDER.map(function (l) {
          var on = (p.level || 'I') === l;
          return '<button class="' + (on ? 'on' : '') + '" data-act="setlevel" data-id="' + p.id + '" data-lv="' + l + '" aria-pressed="' + on + '">' + bird(A.birdIndex(A.LV[l]), 'sm') + '<span>' + LV_LABEL[l] + '</span></button>';
        }).join('') + '</div><span class="muted small">' + LV_HINT[p.level || 'I'] + '</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="card"><h2>เช็กอินวันนี้</h2><form class="add" id="addForm" autocomplete="off">' +
      '<textarea id="nameIn" rows="3" placeholder="วางโพสต์ลงชื่อจากไลน์ได้ทั้งโพสต์" aria-label="รายชื่อ"></textarea>' +
      '<button class="btn primary" type="submit">' + ic('plus') + 'เช็กอิน</button>' +
      '<p class="muted small">วางโพสต์ที่มีเลข 1. 2. 3. ระบบตั้งคนที่มาให้ตรงกับโพสต์ เพิ่มชื่อใหม่ และตั้งจำนวนสนามให้ (กดย้อนกลับได้)</p></form></div>';
    h += '<div class="card"><div class="line"><h2>มาวันนี้ (' + here.length + ')</h2>' + (here.length ? '<button class="btn sm ghost" data-act="checknone">ยกเลิกทั้งหมด</button>' : '') + '</div>';
    if (!here.length) h += '<p class="muted small">ยังไม่มีใครเช็กอิน วางโพสต์ด้านบน หรือเปิดสวิตช์ในรายชื่อ "ยังไม่มา"</p>';
    here.forEach(function (p) { h += memberRow(p, st, RT, on); });
    h += '</div>';
    h += '<div class="card"><details' + (ui.editMembers ? ' open' : det('away', !here.length)) + '><summary>ยังไม่มา (' + away.length + ')' + ic('chev') + '</summary>';
    if (away.length) h += '<div class="line" style="margin:6px 0"><span class="muted small">เปิดสวิตช์เมื่อมาถึง</span><button class="btn sm ghost" data-act="checkall">เช็กอินทุกคน</button></div>';
    else h += '<p class="muted small">มาครบทุกคน</p>';
    away.forEach(function (p) { h += memberRow(p, st, RT, on); });
    h += '</details></div>';
    h += rulesCard();
    h += '<div class="line"><span class="muted small">ยศตั้งต้นใช้ตอนเพิ่มคนใหม่และตอนรีเซ็ต: ลูกเจี๊ยบ 1200 · นกกระจอก 1350 · นกพิราบ 1500 · เหยี่ยว 1650 · อินทรี 1800</span>' +
      '<button class="btn sm ghost" data-act="editmembers">' + (ui.editMembers ? ic('check') + 'เสร็จ' : ic('trash') + 'ลบสมาชิก') + '</button></div>';
    if (ui.editMembers) h += '<p class="note small">แตะถังขยะสีแดงเพื่อลบคนที่ยังไม่ได้เล่นคืนนี้ ประวัติเดิมยังอยู่ในระบบ</p>';
    return h;
  }
  function nextText(RT, id) { var n = A.nextBird(RT.B[id], RT.R[id]); return n ? ' · อีก ' + n.need + ' ถึง' + n.name : ''; }
  function viewRank() {
    var RT = A.ratings(S.done, S.players, S.adj);
    var list = S.players.filter(function (p) { return p.active || RT.G[p.id] > 0; });
    list.sort(function (a, b) { return RT.R[b.id] - RT.R[a.id] || RT.G[b.id] - RT.G[a.id] || a.id - b.id; });
    var h = '<div class="roundhead"><h2>อันดับ</h2><span class="sub">MMR · คืนนี้ ' + S.done.length + ' แมตช์ · ป้ายสีคือขึ้นหรือลงคืนนี้ · นิ่ง % = คะแนนเชื่อถือได้แค่ไหน (60% ขึ้นไปถือว่านิ่ง)</span></div>';
    var top = list[0];
    if (top && ui.editId !== top.id) {
      var tg = RT.G[top.id], tw = RT.W[top.id], tr = Math.round(RT.R[top.id]);
      h += '<section class="hero"><span class="medal-wrap">' + bird(RT.B[top.id], 'lg') + '<span class="medal">1</span></span><div class="who"><small>อันดับหนึ่ง · ' + A.BIRDS[RT.B[top.id]].name + '</small><b>' + esc(top.name) + '</b><small>ชนะ ' + tw + ' แพ้ ' + (tg - tw) + nextText(RT, top.id) + '</small></div>' +
        '<div class="score"><b>' + tr + '</b>' + deltaHtml(tr - A.startOf(top)) + '</div>' +
        '<button class="icon" data-act="edit-mmr" data-id="' + top.id + '" aria-label="แก้ MMR ของ ' + esc(top.name) + '">' + ic('pencil') + '</button></section>';
    }
    h += '<div class="card"><div class="rklist">';
    if (!list.length) h += '<span class="muted">ยังไม่มีคนเช็กอิน</span>';
    list.forEach(function (p, i) {
      if (i === 0 && ui.editId !== p.id) return;
      var g = RT.G[p.id], w = RT.W[p.id], rt = Math.round(RT.R[p.id]);
      if (ui.editId === p.id) {
        h += '<div class="rk compact" style="grid-template-columns:1fr"><b>' + esc(p.name) + '</b><form class="mmr-edit" id="mmrForm" data-id="' + p.id + '" autocomplete="off"><input class="field" id="mmrIn" type="number" inputmode="numeric" min="0" max="5000" step="1" value="' + rt + '" aria-label="MMR ของ ' + esc(p.name) + '"><button class="btn primary" type="submit">บันทึก</button><button class="btn" type="button" data-act="edit-cancel">ยกเลิก</button></form></div>';
        return;
      }
      h += '<div class="rk' + (i < 3 ? ' podium' : '') + '"><span class="pos">' + (i + 1) + '</span>' +
        bird(RT.B[p.id], 'md') + '<div class="who"><b>' + esc(p.name) + (A.certainty(RT.Sg[p.id]) < 60 ? '<span class="prov">นิ่ง ' + A.certainty(RT.Sg[p.id]) + '%</span>' : '') + '</b><span>' + A.BIRDS[RT.B[p.id]].name + ' · ชนะ ' + w + ' แพ้ ' + (g - w) + nextText(RT, p.id) + (p.active ? '' : ' · กลับแล้ว') + '</span></div>' +
        '<div class="score"><b>' + rt + '</b>' + deltaHtml(rt - A.startOf(p)) + '</div>' +
        '<button class="icon" data-act="edit-mmr" data-id="' + p.id + '" aria-label="แก้ MMR ของ ' + esc(p.name) + '">' + ic('pencil') + '</button></div>';
    });
    h += '</div></div>';
    var tally = A.BIRDS.map(function () { return 0; });
    list.forEach(function (p) { tally[RT.B[p.id]]++; });
    h += '<div class="card span"><h2>ระดับนก</h2><p class="muted small">ขึ้นระดับทันทีที่คะแนนถึง และลดระดับเมื่อคะแนนต่ำกว่าเส้นเกิน 40 แต้ม คิดจากผลในก๊วนนี้เท่านั้น</p><div class="birds">' +
      A.BIRDS.map(function (b, i) {
        return '<div class="btile">' + bird(i, 'xl') + '<b>' + b.name + '</b><span class="rng">' + birdRange(i) + '</span><span class="muted small">' + BIRD_HINT[b.k] + '</span>' + (tally[i] ? '<span class="cnt">' + tally[i] + ' คน</span>' : '') + '</div>';
      }).join('') + '</div></div>';
    h += '<button class="btn' + (ui.confirm === 'rank' ? ' danger' : '') + '" data-act="rank-reset" style="justify-self:start">' + (ui.confirm === 'rank' ? 'กดอีกครั้งเพื่อยืนยัน' : 'รีเซ็ต MMR ตามระดับ') + '</button>';
    return h;
  }
  function deltaHtml(d) { return '<span class="delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + fmtDelta(d) + '</span>'; }
  function matchText(nm, m) {
    return nm(m.t[0][0]) + ' + ' + nm(m.t[0][1]) + (m.w === 0 ? ' <b>(ชนะ)</b>' : '') + ' พบ ' + nm(m.t[1][0]) + ' + ' + nm(m.t[1][1]) + (m.w === 1 ? ' <b>(ชนะ)</b>' : '') +
      (A.validScore(m.sc) ? ' · <b>' + m.sc[0] + '–' + m.sc[1] + '</b>' : '');
  }
  function modeTag(mode) { return mode && mode !== 'normal' ? ' <span class="tag m-' + mode + '">' + MODE_LABEL[mode] + '</span>' : ''; }
  function viewSummary() {
    var v = ui.sumView || 'night';
    var head = '<div class="roundhead span"><h2>สรุป</h2>' + seg('ช่วงเวลา', [['night', 'คืนนี้'], ['month', 'รายเดือน'], ['all', 'ทุกคืน']], v, 'sumview', 'v') + '</div>';
    var modal = ui.card ? cardModal() : '';
    if (v === 'all') return head + viewAllStats() + modal;
    if (v === 'month') return head + viewMonth() + modal;
    return head + viewNight();
  }
  function viewNight() {
    var st = A.stats(S.done, S.players), map = byId();
    var list = S.players.filter(function (p) { return p.active || st.played[p.id] > 0; });
    list.sort(function (a, b) { return st.played[b.id] - st.played[a.id] || a.id - b.id; });
    var counts = list.map(function (p) { return st.played[p.id]; });
    var max = counts.length ? Math.max.apply(null, counts) : 0, min = counts.length ? Math.min.apply(null, counts) : 0;
    var spread = max - min, pmax = 0;
    Object.keys(st.P).forEach(function (k) { if (st.P[k] > pmax) pmax = st.P[k]; });
    var h = '';
    if (S.done.length) h += '<div class="card span sharecard"><div class="line"><div class="stext"><b>ส่งสรุปคืนนี้ไป LINE</b><span>อันดับ ใครเลื่อนขั้นนก และจำนวนเกมของแต่ละคน ให้คนในก๊วนดูได้โดยไม่ต้องเข้าแอป</span></div>' +
      '<button class="btn primary" data-act="share-night">' + ic('share') + 'ส่งไป LINE</button></div>' +
      '<details' + det('sharepv') + '><summary class="small">ดูข้อความก่อนส่ง' + ic('chev') + '</summary><pre class="sharetext">' + esc(dayText(A.daySnapshot(S, todayTitle()))) + '</pre></details></div>';
    if (ui.shareFallback) h += '<div class="card span"><b>กดค้างเพื่อคัดลอก</b><textarea class="field" rows="8" readonly>' + esc(ui.shareFallback) + '</textarea></div>';
    h += '<div class="strip span">' +
      '<div class="fact"><b>' + S.done.length + '</b><span>แมตช์ที่จบคืนนี้</span></div>' +
      '<div class="fact"><b>' + spread + '</b><span>คนเล่นมากสุดกับน้อยสุดต่างกัน (แมตช์)</span></div>' +
      '<div class="fact"><b>' + (pmax > 1 ? pmax : 0) + '</b><span>คู่หูเดิมซ้ำมากสุด (ครั้ง)</span></div></div>';
    h += '<div class="card' + (S.done.length ? '' : ' span') + '"><h2>จำนวนแมตช์ของแต่ละคน</h2>';
    if (!list.length) h += '<span class="muted">ยังไม่มีข้อมูล</span>';
    else {
      h += '<div class="bars">';
      list.forEach(function (p) {
        var c = st.played[p.id];
        h += '<div class="brow"><div class="who"><b>' + esc(p.name) + '</b></div><div class="btrack"><div class="fill" style="width:' + (max ? Math.round(c / max * 100) : 0) + '%"></div></div><span class="num">' + c + '</span></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    if (S.done.length) {
      var nm = function (id) { return map[id] ? esc(map[id].name) : '-'; };
      h += '<div class="card"><details' + det('today', true) + '><summary>แมตช์วันนี้ (แก้ไขได้)' + ic('chev') + '</summary><div class="hist">';
      for (var i = S.done.length - 1; i >= 0; i--) {
        var m = S.done[i];
        h += '<div class="hm"><span>แมตช์ ' + (i + 1) + ' · สนาม ' + ((m.court || 0) + 1) + modeTag(m.mode) + '</span><span>' + matchText(nm, m) + '</span>' +
          '<div class="acts"><button class="btn xs" data-act="hflip" data-i="' + i + '">' + ic('swap') + 'สลับผู้ชนะ</button><button class="btn xs' + (ui.confirm === 'hdel' + i ? ' danger' : '') + '" data-act="hdel" data-i="' + i + '">' + ic('trash') + (ui.confirm === 'hdel' + i ? 'กดอีกครั้งเพื่อลบ' : 'ลบแมตช์นี้') + '</button></div></div>';
      }
      h += '</div></details></div>';
    }
    if (S.days.length) {
      h += '<div class="card span"><h2>เกมที่จบแล้ว (' + S.days.length + ')</h2>';
      for (var di = S.days.length - 1; di >= 0; di--) {
        var d = S.days[di];
        h += '<details' + det('day' + di) + '><summary><span>' + esc(d.label) + ' · ' + d.count + ' แมตช์</span>' + ic('chev') + '</summary><div class="hist">' +
          '<button class="btn sm" data-act="share-day" data-i="' + di + '" style="justify-self:start">' + ic('share') + 'ส่งสรุปคืนนี้ไป LINE</button>';
        d.players.forEach(function (r, ri) {
          h += '<div class="rk compact' + (ri < 3 ? ' podium' : '') + '"><span class="pos">' + (ri + 1) + '</span><div class="who"><b>' + esc(r.name) + '</b><span>เล่น ' + r.played + ' · ชนะ ' + r.win + ' · แพ้ ' + (r.played - r.win) + '</span></div><div class="score"><b>' + r.mmr + '</b>' + deltaHtml(r.mmr - r.start) + '</div></div>';
        });
        var en = function (s) { return esc(s); };
        h += '<details' + det('daym' + di) + '><summary class="small">แมตช์ทั้งหมด' + ic('chev') + '</summary><div class="hist">';
        for (var mi = d.matches.length - 1; mi >= 0; mi--) h += '<div class="hm"><span>แมตช์ ' + (mi + 1) + modeTag(d.matches[mi].mode) + '</span><span>' + matchText(en, d.matches[mi]) + '</span></div>';
        h += '</div></details></div></details>';
      }
      h += '</div>';
    }
    return h;
  }
  /* Settings: grouped cards in two fixed columns (one on phone). Each column is its own stack, so opening a
     section only grows that card and never moves cards between columns. */
  function group(icon, title, body) { return '<section class="sgroup"><h3 class="ghead">' + ic(icon) + title + '</h3><div class="card scard">' + body + '</div></section>'; }
  function seg(label, opts, cur, act, key) {
    return '<div class="seg" role="group" aria-label="' + label + '">' + opts.map(function (o) {
      return '<button class="' + (cur === o[0] ? 'on' : '') + '" data-act="' + act + '" data-' + key + '="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function viewSettings() {
    var tonight = '<div class="srow"><div class="stext"><b>จำนวนสนาม</b><span>สนามละ 4 คน · มาวันนี้ ' + activeCount() + ' คน</span></div>' +
      '<div class="stepper"><button class="sq" data-act="courts-" aria-label="ลดสนาม"' + (S.courts.length <= 1 ? ' disabled' : '') + '>' + ic('minus') + '</button><span class="val">' + S.courts.length + '</span><button class="sq" data-act="courts+" aria-label="เพิ่มสนาม"' + (S.courts.length >= 10 ? ' disabled' : '') + '>' + ic('plus') + '</button></div></div>';
    S.courts.forEach(function (c, ci) {
      tonight += '<div class="srow"><div class="stext"><b>สนาม ' + (ci + 1) + '</b></div>' +
        '<div class="seg" role="group" aria-label="โหมดสนาม ' + (ci + 1) + '">' + MODE_ORDER.map(function (m) { return '<button class="' + (c.mode === m ? 'on' : '') + '" data-act="setmode" data-ci="' + ci + '" data-mode="' + m + '" aria-pressed="' + (c.mode === m) + '">' + MODE_LABEL[m] + '</button>'; }).join('') + '</div></div>';
    });
    tonight += '<div class="legend"><span><b class="m-normal">ปกติ</b> จัดตามคิว ทีมสูสีพอประมาณ</span><span><b class="m-competitive">แข่งขัน</b> 4 คนระดับใกล้กัน จับเก่งสุดกับอ่อนสุดเป็นทีม</span><span><b class="m-social">สังสรรค์</b> ผสมคนเก่งกับมือใหม่ นับ MMR ครึ่งเดียว</span></div>';

    var end = '<div class="sblock"><button class="btn big' + (ui.confirm === 'end' ? ' danger' : ' primary') + '" data-act="end">' + ic('flag') + (ui.confirm === 'end' ? 'กดอีกครั้งเพื่อจบเกมวันนี้' : 'จบเกมวันนี้และเก็บสถิติ') + '</button>' +
      '<p class="muted small">บันทึกแมตช์และอันดับขึ้นระบบ ยก MMR ไปใช้ครั้งหน้า สนามที่ยังไม่บันทึกผลจะไม่ถูกนับ ต้องออนไลน์</p></div>' +
      '<div class="srow"><div class="stext"><b>เริ่มเกมใหม่</b><span>ล้างแมตช์คืนนี้ MMR กลับไปเท่าตอนเริ่มคืน คืนก่อนๆ ไม่กระทบ กดย้อนกลับได้</span></div>' +
      '<button class="btn sm' + (ui.confirm === 'reset' ? ' danger' : '') + '" data-act="reset">' + ic('trash') + (ui.confirm === 'reset' ? 'กดอีกครั้ง' : 'รีเซ็ต') + '</button></div>';

    var look = '<div class="srow"><div class="stext"><b>สีของแอป</b><span>อัตโนมัติ = ตามที่ตั้งในเครื่อง</span></div>' + seg('สีของแอป', [['auto', 'อัตโนมัติ'], ['light', 'สว่าง'], ['dark', 'มืด']], themePref(), 'theme', 'v') + '</div>' +
      '<div class="srow"><div class="stext"><b>จอไม่ดับระหว่างเล่น</b><span>' + ('wakeLock' in navigator ? 'เปิดค้างไว้ตอนแอปอยู่หน้าจอ ปิดแอปแล้วจอดับตามปกติ' : 'เครื่องนี้ยังไม่รองรับ (iPhone/iPad ต้อง iOS 18.4 ขึ้นไป และเปิดจากไอคอนบนหน้าจอโฮม)') + '</span></div><label class="sw"><input type="checkbox" data-act="wakesw"' + (wakeWanted() ? ' checked' : '') + ' aria-label="จอไม่ดับระหว่างเล่น"><span class="track"></span></label></div>';

    var account = '<div class="srow"><div class="stext"><b>' + esc(ui.user && ui.user.email || '') + '</b><span>เข้าสู่ระบบอยู่</span></div><button class="btn sm" data-act="logout">' + ic('logout') + 'ออกจากระบบ</button></div>' +
      '<form id="pwForm" class="sblock add" autocomplete="off"><label class="small">เปลี่ยนรหัสผ่าน<input class="field" id="newPw" type="password" minlength="8" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร"></label><button class="btn sm" type="submit">เปลี่ยนรหัสผ่าน</button></form>';

    var nLogs = logsRead().filter(function (e) { return e.kind !== 'report'; }).length;
    var data = '<div class="srow"><div class="stext"><b>รายงานปัญหา</b><span>คัดลอกข้อมูลวินิจฉัยไปวางในแชท · ' + (nLogs ? 'มีข้อผิดพลาดเก็บไว้ ' + nLogs + ' รายการ' : 'ยังไม่มีข้อผิดพลาด') + '</span></div><button class="btn sm" data-act="report">' + ic('bug') + 'รายงานปัญหา</button></div>' +
      '<div class="srow"><div class="stext"><b>ดาวน์โหลดข้อมูลทั้งหมด</b><span>ไฟล์ JSON ของสมาชิก ทุกคืน และทุกแมตช์</span></div><button class="btn sm" data-act="export">' + ic('download') + 'ดาวน์โหลด</button></div>' +
      '<details class="sdetails"' + det('flex') + '><summary><span class="stext"><b>ความยืดหยุ่นของคิว</b><span>ตอนนี้ ' + (S.flex || 0) + ' · สนามแข่งขันและสังสรรค์</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<div class="line"><span class="muted small">เลือกจากคิวเพิ่มได้อีกกี่คน</span>' + seg('ความยืดหยุ่นของคิว', [[0, '0'], [2, '2'], [4, '4'], [6, '6']], S.flex || 0, 'flex', 'n') + '</div>' +
      '<p class="muted small">0 = ตามคิวเป๊ะ · ยิ่งมาก ระดับยิ่งใกล้ แต่บางคนอาจรอนานขึ้นนิดหน่อย คนที่เล่นน้อยกว่ายังได้ก่อนเสมอ</p></div></details>' +
      '<details class="sdetails"' + det('import') + '><summary><span class="stext"><b>นำเข้าจากแอปเดิม</b><span>ใช้ข้อมูลจากปุ่ม "คัดลอกข้อมูลสำรอง"</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<p class="muted small">ระบบจับคู่ชื่อ เพิ่มคนที่ยังไม่มี และนำแมตช์เข้าเกมนี้ ทำได้เมื่อเกมนี้ยังไม่มีแมตช์</p>' +
      '<form id="importForm" class="add" autocomplete="off"><textarea id="impText" rows="3" placeholder="วางข้อมูลสำรองที่นี่" aria-label="ข้อมูลสำรองจากแอปเดิม"></textarea><button class="btn sm" type="submit"' + (S.done.length ? ' disabled' : '') + '>นำเข้า</button></form></div></details>';
    var clubs = '<form id="clubForm" class="srow" autocomplete="off"><label class="stext"><b>ชื่อก๊วนนี้</b><input class="field" id="clubName" maxlength="60" value="' + esc(ui.club ? ui.club.name : '') + '" aria-label="ชื่อก๊วน" required></label><button class="btn sm" type="submit">บันทึกชื่อ</button></form>';
    (ui.clubs || []).forEach(function (c) {
      if (ui.club && c.id === ui.club.id) return;
      clubs += '<div class="srow"><div class="stext"><b>' + esc(c.name) + '</b><span>ก๊วนอื่นที่คุณดูแล</span></div><button class="btn sm" data-act="club-switch" data-id="' + c.id + '">' + ic('swap') + 'สลับไปก๊วนนี้</button></div>';
    });
    clubs += '<details class="sdetails"' + det('newclub') + '><summary><span class="stext"><b>สร้างก๊วนใหม่</b><span>ผู้เล่นและประวัติแยกจากก๊วนนี้ทั้งหมด</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<form id="newClubForm" class="add" autocomplete="off"><input class="field" id="newClubName" maxlength="60" placeholder="ชื่อก๊วน เช่น ก๊วนแบดวันเสาร์" aria-label="ชื่อก๊วนใหม่" required><button class="btn sm primary" type="submit">' + ic('plus') + 'สร้างและสลับไป</button></form>' +
      '<p class="muted small">คุณจะเป็นผู้ดูแลของก๊วนใหม่ แล้วเพิ่มบัญชีคนอื่นเป็นผู้ดูแลได้ที่หัวข้อผู้ดูแลก๊วน คนที่เป็นผู้ดูแลเฉพาะก๊วนนั้นจะไม่เห็นผู้เล่นของก๊วนนี้</p></div></details>';
    var many = (ui.clubs || []).length > 1;
    clubs += '<details class="sdetails"' + det('danger') + '><summary><span class="stext"><b>ออกจากก๊วน หรือลบก๊วน</b><span>' + (many ? 'ใช้กับก๊วนที่สร้างไว้ทดลอง' : 'ต้องมีก๊วนอื่นอยู่ก่อน จึงออกหรือลบก๊วนนี้ได้') + '</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      (many ? '<div class="line"><span class="muted small">ออกจากก๊วน: คุณจะไม่เห็นก๊วนนี้อีก ต้องมีผู้ดูแลคนอื่นเหลืออยู่</span><button class="btn sm' + (ui.confirm === 'leave' ? ' danger' : '') + '" data-act="club-leave">' + ic('logout') + (ui.confirm === 'leave' ? 'กดอีกครั้งเพื่อออก' : 'ออกจากก๊วน') + '</button></div>' +
        '<form id="deleteClubForm" class="add" autocomplete="off"><label class="small">ลบก๊วนนี้ถาวร ทั้งผู้เล่น คืนเล่น และประวัติ พิมพ์ชื่อก๊วนเพื่อยืนยัน<input class="field" id="delClubName" placeholder="' + esc(ui.club ? ui.club.name : '') + '" aria-label="พิมพ์ชื่อก๊วนเพื่อยืนยันการลบ"></label><button class="btn sm danger" type="submit">' + ic('trash') + 'ลบก๊วนนี้</button></form>'
        : '<p class="muted small">สร้างหรือสลับไปก๊วนอื่นก่อน แล้วค่อยกลับมาออกหรือลบก๊วนนี้</p>') + '</div></details>';
    return '<div class="scol">' + group('court', 'คืนนี้', tonight) + group('flag', 'จบคืน', end) + group('palette', 'หน้าตา', look) + '</div>' +
      '<div class="scol">' + group('users', 'ก๊วน', clubs) + group('shield', 'ผู้ดูแลก๊วน', adminsBody()) + group('gear', 'บัญชี', account) + group('sliders', 'ข้อมูลและขั้นสูง', data) + '</div>';
  }
  function dockHtml() {
    if (activeCount() < 4) return '<div class="dock-in"><button class="btn primary" data-act="tab" data-tab="people">' + ic('users') + 'ไปเช็กอินผู้เล่น</button></div>';
    var f = fillState();
    return '<div class="dock-in"><button class="btn primary" data-act="fill"' + (f.dis ? ' disabled' : '') + '>' + ic('shuffle') + f.label + '</button></div>';
  }
  function renderToast() {
    var el = $('toast');
    if (!ui.toast) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.classList.toggle('lift', ui.tab === 'play');
    el.classList.toggle('promo', ui.toast.bird != null);
    el.innerHTML = (ui.toast.bird != null ? bird(ui.toast.bird, 'md') : '') + '<span class="tmsg">' + esc(ui.toast.msg) + '</span>' + (ui.toast.undo ? '<button data-act="undo">' + ic('undo') + 'ย้อนกลับ</button>' : '');
  }
  function renderUndo() {
    var b = $('undoBtn'); if (!b) return;
    var last = ui.undos[ui.undos.length - 1];
    b.disabled = !last;
    b.title = last ? 'ย้อนกลับ: ' + last.label : 'ยังไม่มีอะไรให้ย้อนกลับ';
    b.setAttribute('aria-label', b.title);
  }
  function renderStatus() {
    var el = $('syncPill'); if (!el) return;
    var map = {
      saved: ['saved', 'check', 'บันทึกแล้ว'], pending: ['', 'cloud-up', 'รอบันทึก'], saving: ['', 'cloud-up', 'กำลังบันทึก'],
      offline: ['offline', 'cloud-off', 'ออฟไลน์ เก็บในเครื่อง'], error: ['error', 'cloud-off', 'บันทึกไม่ได้ แตะลองใหม่']
    };
    var m = map[ui.status] || map.pending;
    if (ui.status === 'saved' && ui.lastSaved) { var d = new Date(ui.lastSaved); m = m.slice(); m[2] = 'บันทึก ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
    el.className = 'sync ' + m[0];
    el.title = ui.statusMsg || m[2];
    el.innerHTML = ic(m[1]) + '<span class="lbl">' + m[2] + '</span>';
  }
  function render() {
    if (!S) return;
    var v = $('view'), dock = $('dock');
    renderThemeBtn();
    $('setBtn').classList.toggle('on', ui.tab === 'set');
    document.querySelectorAll('.tab').forEach(function (b) { var on = b.dataset.tab === ui.tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    v.innerHTML = ui.tab === 'play' ? viewPlay() : ui.tab === 'people' ? viewPeople() : ui.tab === 'rank' ? viewRank() : ui.tab === 'sum' ? viewSummary() : viewSettings();
    v.className = 'tab-' + ui.tab + (ui.tab === 'play' ? ' pad-dock' : '');
    dock.hidden = ui.tab !== 'play';
    dock.innerHTML = dockHtml();
    renderToast(); renderStatus(); renderUndo(); renderDate();
    var old = document.querySelector('.busy'); if (old) old.remove();
    if (ui.busy) { var b = document.createElement('div'); b.className = 'busy'; b.innerHTML = '<div>' + esc(ui.busy) + '</div>'; document.body.appendChild(b); }
    if (ui.tab === 'rank' && ui.editId != null) { var mi = $('mmrIn'); if (mi) { mi.focus(); mi.select(); } }
  }
  /* snap = state before the action. Passing it records an undo step (kept for the whole night, up to 30). */
  function toast(msg, snap) {
    if (snap) { ui.undos.push({ snap: snap, label: msg }); if (ui.undos.length > 30) ui.undos.shift(); }
    ui.toast = { msg: msg, undo: !!snap };
    clearTimeout(ui.tt);
    ui.tt = setTimeout(function () { ui.toast = null; renderToast(); }, snap ? 10000 : 7000);   // an undo offer stays longer
    if (S) renderToast();
  }

  /* ---------- actions ---------- */
  function setActive(id, on) {
    var p = A.findP(S, id); if (!p) return;
    if (on && !p.active) {
      var st = A.stats(S.done, S.players);
      var act = S.players.filter(function (q) { return q.active; });
      var mc = act.length ? Math.min.apply(null, act.map(function (q) { return (q.base || 0) + st.played[q.id]; })) : 0;
      var cur = (p.base || 0) + st.played[id];
      if (cur < mc) p.base = (p.base || 0) + mc - cur;
      p.freeSince = Date.now();
      p.qr = Math.random();
    }
    p.active = on;
  }
  /* add one new member; offline it is kept locally with a temporary id and saved later */
  async function addMember(n, base) {
    try {
      var row = await DB.addPlayer(n, 'I');
      S.players.push(fromRow(row, true, base)); ui.newIds = (ui.newIds || []).concat([row.id]);
      return 'added';
    } catch (e) {
      if (e.code === '23505') {   // name exists but was removed earlier: bring them back
        try {
          var r = (await DB.loadPlayers()).filter(function (x) { return x.name.toLowerCase() === n.toLowerCase(); })[0];
          if (r) { await DB.setPlayerActive(r.id, true); S.players.push(fromRow(r, true, base)); return 'added'; }
        } catch (e2) { }
      }
      if (isOffline(e)) { var p = pendingPlayer(n, base); S.players.push(p); ui.newIds = (ui.newIds || []).concat([p.id]); return 'pending'; }
      return 'failed';
    }
  }
  function lateBase() { return (S.done.length || A.liveIds(S).length) ? A.minCredit(S) : 0; }
  async function checkIn(text) {
    var names = A.parseNames(text), added = 0, checked = 0, offline = 0, failed = [], asked = 0, seen = {};
    if (!names.length) { toast('ไม่พบชื่อในข้อความ', null); return; }
    var base = lateBase();
    ui.busy = 'กำลังเช็กอิน…'; render();
    ui.nameAsk = ui.nameAsk || [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i], m = A.matchName(n, S.players);
      if (m.exact) { seen[m.exact.id] = 1; if (!m.exact.active) { setActive(m.exact.id, true); checked++; } continue; }
      m.similar.forEach(function (p) { seen[p.id] = 1; });
      if (m.similar.length) {
        if (!ui.nameAsk.some(function (x) { return x.name === n; })) { ui.nameAsk.push({ name: n, ids: m.similar.map(function (p) { return p.id; }) }); asked++; }
        continue;
      }
      var res = await addMember(n, base);
      if (res === 'added') added++; else if (res === 'pending') { added++; offline++; } else failed.push(n);
    }
    ui.busy = null;
    // the LINE post says how many courts were booked ("3 สนาม"); only change it before play starts
    var courts = A.parseCourts(text), courtMsg = '';
    if (courts && courts !== S.courts.length && !S.done.length && !S.live.some(Boolean)) {
      A.setCourtCount(S, courts); courtMsg = ' · ตั้ง ' + courts + ' สนามตามโพสต์';
    }
    // a numbered post is the whole list for the night: uncheck everyone not in it (undo restores them).
    // People on court stay; near-spelling matches waiting for an answer stay.
    var onCourt = A.liveIds(S), outMsg = '', outSnap = null;
    if (A.isRoster(text)) {
      var outs = S.players.filter(function (p) { return p.active && !seen[p.id] && (ui.newIds || []).indexOf(p.id) < 0; });
      var gone = outs.filter(function (p) { return onCourt.indexOf(p.id) < 0; }), playing = outs.filter(function (p) { return onCourt.indexOf(p.id) >= 0; });
      if (gone.length) {
        outSnap = JSON.stringify(S);
        gone.forEach(function (p) { setActive(p.id, false); });
        outMsg = ' · เอาออก ' + gone.length + ' คนที่ไม่อยู่ในโพสต์ (' + gone.map(function (p) { return p.name; }).join(', ') + ')';
      }
      if (playing.length) outMsg += ' · ' + playing.map(function (p) { return p.name; }).join(', ') + ' ยังอยู่ในสนาม ไม่ได้เอาออก';
    }
    changed();
    toast('เช็กอิน ' + checked + ' คน · เพิ่มใหม่ ' + added + ' คน' + courtMsg + outMsg + (asked ? ' · มีชื่อคล้ายคนเดิม ' + asked + ' ชื่อ ช่วยยืนยันด้านบน' : '') +
      (offline ? ' · ออฟไลน์อยู่ จะบันทึกคนใหม่เมื่อต่อเน็ต' : '') + (failed.length ? ' · เพิ่มไม่ได้: ' + failed.join(', ') : ''), outSnap);
    render();
  }
  /* answer for one "ใช่คนเดิมไหม" question: same person (remember the spelling) or a new member */
  async function answerName(i, sameId) {
    var q = (ui.nameAsk || [])[i]; if (!q) return;
    ui.nameAsk.splice(i, 1);
    if (sameId != null) {
      var p = A.findP(S, sameId); if (!p) { render(); return; }
      if (!p.active) setActive(p.id, true);
      p.aliases = (p.aliases || []).concat([q.name]);
      if (!p.pending) DB.updatePlayer(p.id, { aliases: p.aliases }).catch(function () { });
      changed(); toast('เช็กอิน ' + p.name + ' แล้ว และจำชื่อ "' + q.name + '" ไว้ครั้งหน้า', null);
    } else {
      ui.busy = 'กำลังเพิ่ม…'; render();
      var res = await addMember(q.name, lateBase());
      ui.busy = null; changed();
      toast(res === 'failed' ? 'เพิ่ม ' + q.name + ' ไม่ได้' : 'เพิ่ม ' + q.name + ' เป็นสมาชิกใหม่แล้ว' + (res === 'pending' ? ' (จะบันทึกเมื่อต่อเน็ต)' : ''), null);
    }
    render();
  }
  async function removePlayer(id) {
    var st = A.stats(S.done, S.players);
    if (st.played[id] !== 0 || A.liveIds(S).indexOf(id) >= 0) return;
    var p = A.findP(S, id);
    try { if (!(p && p.pending)) await DB.setPlayerActive(id, false); }
    catch (e) { toast('ลบไม่ได้ ต้องออนไลน์', null); return; }
    S.players = S.players.filter(function (q) { return q.id !== id; });
    changed(); toast('ลบ ' + (p ? p.name : '') + ' ออกจากสมาชิกแล้ว', null); render();
  }
  async function endDay() {
    if (!S.done.length) { toast('ยังไม่มีแมตช์ที่บันทึก', null); render(); return; }
    ui.busy = 'กำลังจบเกมและบันทึก…'; render();
    try {
      await flushSync();
      await DB.closeSession(S.sessionId, A.carryForward(S));
      var snap = A.endGame(S, S.title || todayTitle());
      S.sessionId = null; S.title = null; S.share = null;   // next night opens at its first check-in; its own link
      S.players.forEach(function (p) { p.active = false; });
      ui.undos = []; ui.allStats = null;
      changed(); renderDate();
      try { S.days = await DB.loadClosedDays(30); } catch (e) { }
      toast('จบเกมแล้ว บันทึก ' + snap.count + ' แมตช์ขึ้นระบบ · ส่งสรุปไป LINE ได้ที่แท็บสรุป', null);
    } catch (e) {
      toast('จบเกมไม่สำเร็จ: ' + errMsg(e) + ' ข้อมูลยังอยู่ ลองใหม่เมื่อออนไลน์', null);
    }
    ui.busy = null; render();
  }

  async function downloadAll() {
    ui.busy = 'กำลังเตรียมไฟล์…'; render();
    try {
      var data = await DB.exportAll();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'badminton-backup-' + todayISO() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast('ดาวน์โหลดข้อมูลแล้ว ' + data.players.length + ' คน ' + data.matches.length + ' แมตช์', null);
    } catch (e) { toast('ดาวน์โหลดไม่ได้: ' + errMsg(e), null); }
    ui.busy = null; render();
  }
  async function importOld(text) {
    var d;
    try { d = JSON.parse(text); if (!d || d.v !== 4 || !Array.isArray(d.players)) throw 0; }
    catch (e) { toast('ข้อมูลไม่ถูกต้อง ตรวจว่าวางข้อความสำรองครบทั้งหมด', null); return; }
    if (S.done.length) { toast('เกมนี้มีแมตช์แล้ว จบเกมหรือเริ่มเกมใหม่ก่อนนำเข้า', null); return; }
    ui.busy = 'กำลังนำเข้า…'; render();
    try {
      var idByName = {};
      S.players.forEach(function (p) { idByName[p.name.toLowerCase()] = p.id; });
      for (var i = 0; i < d.players.length; i++) {
        var op = d.players[i], k = op.name.toLowerCase();
        if (!idByName[k]) { var row = await DB.addPlayer(op.name, op.level || 'I'); S.players.push(fromRow(row, false, 0)); idByName[k] = row.id; }
      }
      for (var j = 0; j < (d.days || []).length; j++) await DB.importClosedDay(d.days[j], idByName);
      var map = {};
      d.players.forEach(function (op) { map[op.id] = idByName[op.name.toLowerCase()]; });
      var ok = function (t) { return t.every(function (x) { return x.every(function (id) { return !!map[id]; }); }); };
      S.done = (d.done || []).filter(function (m) { return ok(m.t); }).map(function (m) {
        return { t: m.t.map(function (x) { return x.map(function (id) { return map[id]; }); }), w: m.w, mode: m.mode || 'normal', court: m.court || 0, at: m.at || null, end: m.end || null };
      });
      S.adj = (d.adj || []).filter(function (a) { return map[a.id]; }).map(function (a) { return { at: a.at, id: map[a.id], to: a.to }; });
      if (Array.isArray(d.courts) && d.courts.length) S.courts = d.courts.map(function (c) { return { mode: c.mode || 'normal' }; });
      S.live = S.courts.map(function () { return null; });
      S.flex = d.flex != null ? d.flex : S.flex;
      d.players.forEach(function (op) {
        var p = A.findP(S, map[op.id]); if (!p) return;
        p.active = op.active !== false; p.base = op.base || 0; p.level = op.level || p.level;
        if (op.start != null) p.start = op.start; if (op.games != null) p.games = op.games; p.freeSince = op.freeSince || 0;
      });
      changed(); await flushSync();
      try { S.days = await DB.loadClosedDays(30); } catch (e) { }
      toast('นำเข้าแล้ว ' + S.done.length + ' แมตช์ และเกมเก่า ' + (d.days || []).length + ' วัน', null);
    } catch (e) {
      toast('นำเข้าไม่สำเร็จ: ' + errMsg(e), null);
    }
    ui.busy = null; render();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    var a = t.dataset.act;
    if (a === 'logout') { DB.signOut().then(function () { location.reload(); }); return; }
    if (a === 'reload') { location.reload(); return; }
    if (a === 'forgot') { showGate(forgotHtml()); return; }
    if (a === 'tologin') { showGate(loginHtml()); return; }
    if (!S) return;
    var ci = +t.dataset.ci, before = JSON.stringify(S), msg = null, snap = before, birdToast = null;
    if (a !== 'undo' && a !== 'tab') ui.toast = null;
    if (a === 'tab') { ui.tab = t.dataset.tab; ui.confirm = null; ui.editId = null; ui.sel = null; ui.editMembers = false; ui.editPlayer = null; ui.resetId = null; ui.restPick = false; try { window.scrollTo(0, 0); } catch (x) { } }
    else if (a === 'sync') { if (sync.dirty) runSync(); }
    else if (a === 'theme-toggle') { setTheme(themeNow() === 'dark' ? 'light' : 'dark'); renderThemeBtn(); return; }
    else if (a === 'undo') {
      var step = ui.undos.pop();
      if (step) {
        var keep = { days: S.days, sessionId: S.sessionId, title: S.title };
        S = JSON.parse(step.snap); S.days = keep.days; S.sessionId = keep.sessionId; S.title = keep.title;
        A.normalize(S); ui.sel = null;
        toast('ย้อนกลับแล้ว: ' + step.label, null);
      } else ui.toast = null;
    }
    else if (a === 'export') { downloadAll(); return; }
    else if (a === 'report') { var rep = reportText(); logError('report', 'ผู้ดูแลกดรายงานปัญหา', rep); shareText(rep); return; }
    else if (a === 'win') { var c = S.live[ci], s = +t.dataset.s; if (c) c.w = c.w === s ? null : s; }
    else if (a === 'save') {
      var lc = S.live[ci], ids0 = lc ? lc.t[0].concat(lc.t[1]) : [], rb = A.ratings(S.done, S.players, S.adj);
      if (A.saveResult(S, ci)) {
        msg = 'บันทึกผลสนาม ' + (ci + 1) + ' แล้ว';
        var ch = birdChanges(rb, A.ratings(S.done, S.players, S.adj), ids0);
        if (ch.length) {
          msg += ' · ' + ch.map(function (x) { return x.name + (x.up ? ' เลื่อนเป็น' : ' ลดเป็น') + A.BIRDS[x.i].name; }).join(' · ');
          var upc = ch.filter(function (x) { return x.up; })[0];
          if (upc) birdToast = upc.i;
        } else msg += ' สนามว่าง รอสุ่มคู่ใหม่';
      }
      ui.sel = null;
    }
    else if (a === 'draw') { if (A.drawCourt(S, ci, Math.random)) msg = 'สุ่มลงสนาม ' + (ci + 1) + ' แล้ว'; ui.sel = null; }
    else if (a === 'redraw') { if (A.redrawCourt(S, ci, Math.random)) msg = 'สุ่มสนาม ' + (ci + 1) + ' ใหม่แล้ว ไม่นับแมตช์'; ui.sel = null; }
    else if (a === 'fill') { var n = A.fillEmpty(S, Math.random); if (n) msg = 'สุ่มลง ' + n + ' สนามแล้ว'; ui.sel = null; }
    else if (a === 'mode') { var cur = S.courts[ci].mode; S.courts[ci].mode = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % 3]; }
    else if (a === 'setmode') { S.courts[ci].mode = t.dataset.mode; }
    else if (a === 'flex') { S.flex = +t.dataset.n; }
    else if (a === 'unsel') { ui.sel = null; }
    else if (a === 'pick' || a === 'pickq') {
      var pos = a === 'pickq' ? { id: +t.dataset.id } : { ci: ci, s: +t.dataset.s, i: +t.dataset.i };
      if (!ui.sel) ui.sel = pos;
      else if (sameSel(pos)) ui.sel = null;
      else if (ui.sel.id != null && pos.id != null) ui.sel = pos;
      else {
        var n1 = selName();
        var n2 = byId()[pos.id != null ? pos.id : S.live[pos.ci].t[pos.s][pos.i]];
        if (A.swapPos(S, ui.sel, pos)) msg = 'สลับ ' + n1 + ' กับ ' + (n2 ? n2.name : '') + ' แล้ว';
        ui.sel = null;
      }
    }
    else if (a === 'courts+') { A.setCourtCount(S, S.courts.length + 1); }
    else if (a === 'courts-') { A.setCourtCount(S, S.courts.length - 1); msg = 'ลดเหลือ ' + S.courts.length + ' สนาม'; }
    else if (a === 'checkall') { S.players.forEach(function (p) { if (!p.active) setActive(p.id, true); }); msg = 'เช็กอินทุกคนแล้ว'; }
    else if (a === 'checknone') { S.players.forEach(function (p) { p.active = false; }); msg = 'ยกเลิกเช็กอินทุกคนแล้ว'; }
    else if (a === 'remove') { removePlayer(+t.dataset.id); return; }
    else if (a === 'editmembers') { ui.editMembers = !ui.editMembers; }
    else if (a === 'edit-mmr') ui.editId = +t.dataset.id;
    else if (a === 'edit-player') ui.editPlayer = +t.dataset.id;
    else if (a === 'setlevel') { setLevel(+t.dataset.id, t.dataset.lv); }
    else if (a === 'club-switch') { switchClub(+t.dataset.id); return; }
    else if (a === 'rule-del') { deleteRule(+t.dataset.id); return; }
    else if (a === 'club-leave') { if (confirmTap('leave')) { leaveClub(); return; } }
    else if (a === 'ask-same') { answerName(+t.dataset.i, +t.dataset.id); return; }
    else if (a === 'ask-new') { answerName(+t.dataset.i, null); return; }
    else if (a === 'sumview') { ui.sumView = t.dataset.v; if (ui.sumView !== 'night') ui.allStats = null; }
    else if (a === 'month-step') { var mo = ui.allStats && !ui.allStats.error ? A.monthsOf(ui.allStats) : []; var mi = mo.indexOf(ui.month) + (+t.dataset.d); if (mo[mi]) ui.month = mo[mi]; }
    else if (a === 'share-month') { shareText(monthText(monthModel(ui.month))); return; }
    else if (a === 'card') { makeCard(+t.dataset.id); return; }
    else if (a === 'live-open') { openLive(); return; }
    else if (a === 'live-close') { ui.liveOpen = false; }
    else if (a === 'live-share') { var lu = liveUrl(); if (navigator.share) { navigator.share({ title: 'คิวคืนนี้', url: lu }).catch(function () { }); } else shareText(lu); return; }
    else if (a === 'live-new') { S.share = newToken(); ui.liveOpen = false; changed(); openLive(); toast('เปลี่ยนลิงก์แล้ว ลิงก์เดิมใช้ไม่ได้', null); return; }
    else if (a === 'live-off') { if (S.sessionId) DB.setLive(S.sessionId, null).catch(function () { }); S.share = null; ui.liveOpen = false; msg = 'ปิดลิงก์ดูคิวแล้ว'; }
    else if (a === 'card-share') { shareCard(); return; }
    else if (a === 'card-close') { closeCard(); }
    else if (a === 'stats-reload') { ui.allStats = null; }
    else if (a === 'stat-open') { ui.statId = ui.statId === +t.dataset.id ? null : +t.dataset.id; }
    else if (a === 'share-night') { shareText(dayText(A.daySnapshot(S, todayTitle()))); return; }
    else if (a === 'share-day') { var sd = S.days[+t.dataset.i]; if (sd) shareText(dayText(sd)); return; }
    else if (a === 'restpick') { ui.restPick = !ui.restPick; ui.sel = null; }
    else if (a === 'rest') { var rp = A.findP(S, +t.dataset.id); if (rp && A.toggleRest(S, rp.id)) msg = rp.rest ? rp.name + ' ขอพัก 1 ตา' : rp.name + ' กลับเข้าคิวแล้ว'; }
    else if (a === 'new-done') { ui.newIds = []; }
    else if (a === 'edit-player-cancel') ui.editPlayer = null;
    else if (a === 'theme') { setTheme(t.dataset.v); }
    else if (a === 'admin-reset') { ui.resetId = t.dataset.id; }
    else if (a === 'admin-reset-cancel') { ui.resetId = null; }
    else if (a === 'admin-remove') { if (confirmTap('adm' + t.dataset.id)) { adminAction({ action: 'remove', id: t.dataset.id }, 'ถอดสิทธิ์ผู้ดูแลแล้ว'); return; } }
    else if (a === 'admins-reload') { ui.admins = null; }
    else if (a === 'edit-cancel') ui.editId = null;
    else if (a === 'rank-reset') { if (confirmTap('rank')) { S.players.forEach(function (p) { S.adj.push({ at: S.done.length, id: p.id, to: A.LV[p.level || 'I'] }); }); msg = 'รีเซ็ต MMR ตามระดับแล้ว'; } }
    else if (a === 'hflip') { var m = S.done[+t.dataset.i]; if (m) { m.w = 1 - m.w; msg = 'สลับผู้ชนะแมตช์ ' + (+t.dataset.i + 1) + ' แล้ว คิด MMR ใหม่ให้แล้ว'; } }
    else if (a === 'hdel') {
      var di = +t.dataset.i;
      if (confirmTap('hdel' + di)) { S.done.splice(di, 1); S.adj.forEach(function (x) { if (x.at > di) x.at--; }); msg = 'ลบแมตช์ ' + (di + 1) + ' แล้ว'; }
    }
    else if (a === 'end') { if (confirmTap('end')) { endDay(); return; } }
    else if (a === 'reset') { if (confirmTap('reset')) { A.resetGame(S); msg = 'ล้างคืนนี้แล้ว MMR กลับไปเท่าตอนเริ่มคืน'; } }
    if (msg) { toast(msg, snap); if (birdToast != null) { ui.toast.bird = birdToast; renderToast(); } }
    if (JSON.stringify(S) !== before) changed();
    render();
  });
  document.addEventListener('focusout', function (e) {
    var t = e.target, n = e.relatedTarget;
    if (S && t.dataset && t.dataset.act === 'score' && !(n && n.dataset && n.dataset.act === 'score')) setTimeout(render, 0);
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !S) return;
    var a = t.dataset.act;
    if (a === 'toggle') setActive(+t.dataset.id, t.checked);
    else if (a === 'level') {
      setLevel(+t.dataset.id, t.value);
    }
    else if (a === 'wakesw') { setWake(t.checked); render(); return; }
    else if (a === 'h2h') { ui.h2h = ui.h2h || [null, null]; ui.h2h[+t.dataset.i] = t.value ? +t.value : null; render(); return; }
    else if (a === 'score') {
      var sc = S.live[+t.dataset.ci]; if (!sc) return;
      var v = t.value === '' ? null : Math.max(0, Math.min(99, parseInt(t.value, 10)));
      sc.sc = sc.sc || [null, null]; sc.sc[+t.dataset.s] = isNaN(v) ? null : v;
      if (A.validScore(sc.sc)) sc.w = sc.sc[0] > sc.sc[1] ? 0 : 1;   // the higher score wins
      changed(); return;                       // re-render when focus leaves the score boxes, so the next box keeps the tap
    }
    else return;
    changed(); render();
  });
  document.addEventListener('submit', async function (e) {
    var f = e.target; e.preventDefault();
    if (f.id === 'loginForm') {
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ…';
      try { var u = await DB.signIn($('email').value.trim(), $('password').value); await startFor(u); }
      catch (err) { showGate(loginHtml('เข้าสู่ระบบไม่ได้: ' + errMsg(err))); }
      return;
    }
    if (f.id === 'forgotForm') {
      var em = $('femail').value.trim();
      try { await DB.resetPassword(em, location.origin + location.pathname); showGate(forgotHtml(null, 'ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ' + em + ' แล้ว เปิดอีเมลบนเครื่องนี้แล้วกดลิงก์')); }
      catch (err) { showGate(forgotHtml('ส่งไม่ได้: ' + errMsg(err))); }
      return;
    }
    if (f.id === 'recoverForm') {
      var p1 = $('rpw').value, p2 = $('rpw2').value;
      if (p1.length < 8) { showGate(recoverHtml('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')); return; }
      if (p1 !== p2) { showGate(recoverHtml('รหัสผ่านสองช่องไม่ตรงกัน')); return; }
      try { var ru = await DB.updatePassword(p1); await startFor(ru); toast('ตั้งรหัสผ่านใหม่แล้ว', null); }
      catch (err) { showGate(recoverHtml('ตั้งรหัสผ่านไม่ได้: ' + errMsg(err))); }
      return;
    }
    if (!S) return;
    if (f.id === 'addForm') { await checkIn($('nameIn').value); }
    else if (f.id === 'importForm') { await importOld($('impText').value); }
    else if (f.id === 'pwForm') {
      var np = $('newPw').value;
      if (np.length < 8) { toast('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร', null); return; }
      try { await DB.updatePassword(np); $('newPw').value = ''; toast('เปลี่ยนรหัสผ่านแล้ว', null); }
      catch (err) { toast('เปลี่ยนรหัสผ่านไม่ได้: ' + errMsg(err), null); }
    }
    else if (f.id === 'playerForm') { await savePlayerEdit(f); }
    else if (f.id === 'ruleForm') { await addRule(); }
    else if (f.id === 'clubForm') {
      var cn = $('clubName').value.replace(/\s+/g, ' ').trim();
      if (!cn || !ui.club) return;
      try { await DB.renameClub(ui.club.id, cn); ui.club.name = cn; (ui.clubs || []).forEach(function (c) { if (c.id === ui.club.id) c.name = cn; }); try { localStorage.setItem(clubKey(), JSON.stringify(ui.club)); } catch (x) { } toast('เปลี่ยนชื่อก๊วนแล้ว', null); }
      catch (err) { toast('เปลี่ยนชื่อก๊วนไม่ได้: ' + errMsg(err), null); }
      render();
    }
    else if (f.id === 'deleteClubForm') {
      var typed = $('delClubName').value.replace(/\s+/g, ' ').trim();
      if (!ui.club || typed !== ui.club.name) { toast('พิมพ์ชื่อก๊วนให้ตรงก่อน: ' + (ui.club ? ui.club.name : ''), null); return; }
      await dropClub(function () { return DB.deleteClub(ui.club.id, typed); }, 'ลบก๊วน ' + typed + ' แล้ว');
    }
    else if (f.id === 'newClubForm') {
      var nn = $('newClubName').value.replace(/\s+/g, ' ').trim();
      if (!nn) return;
      ui.busy = 'กำลังสร้างก๊วน…'; render();
      try {
        await flushSync();
        var cid = await DB.createClub(nn);
        ui.clubs = (ui.clubs || []).concat([{ id: cid, name: nn }]);
        ui.busy = null;
        await openClub({ id: cid, name: nn });
        ui.tab = 'people';
        toast('สร้างก๊วน ' + nn + ' แล้ว เริ่มจากวางรายชื่อผู้เล่น', null); render();
      } catch (err) { ui.busy = null; toast('สร้างก๊วนไม่ได้: ' + errMsg(err), null); render(); }
    }
    else if (f.id === 'adminAddForm') {
      var em2 = $('admEmail').value.trim(), pw2 = $('admPw').value;
      if (await adminAction({ action: 'add', email: em2, password: pw2 }, null)) { $('admEmail').value = ''; $('admPw').value = ''; }
    }
    else if (f.id === 'adminResetForm') {
      if (await adminAction({ action: 'reset', id: f.dataset.id, password: $('admResetPw').value }, 'ตั้งรหัสผ่านใหม่ให้แล้ว แจ้งรหัสนี้ให้เจ้าของบัญชี')) ui.resetId = null;
      render();
    }
    else if (f.id === 'mmrForm') {
      var val = parseInt($('mmrIn').value, 10);
      if (!isNaN(val)) {
        var snap = JSON.stringify(S);
        S.adj.push({ at: S.done.length, id: +f.dataset.id, to: Math.max(0, Math.min(5000, val)) });
        ui.editId = null; toast('แก้ MMR แล้ว', snap); changed(); render();
      }
    }
  });
  /* clocks on the courts tab: update only the time texts, never re-render, so a tap that lands mid-update still hits its button */
  setInterval(function () {
    if (!S || ui.tab !== 'play') return;
    document.querySelectorAll('[data-tick]').forEach(function (el) {
      var t = +el.dataset.t || 0, k = el.dataset.tick;
      el.textContent = k === 'court' ? courtAge(t) : k === 'hm' ? (t ? hmSince(t) : '–') : k === 'longest' ? longestText() : waitText(el.dataset.pre, t);
      if (k === 'court') {                      // the orange flag follows the clock without a re-render
        var lg = t && mins(t) >= LONG_MIN, sec = el.closest('.court');
        el.classList.toggle('warn', !!lg); if (sec) sec.classList.toggle('long', !!lg);
      }
      if (k === 'longest') el.classList.toggle('warn', /^นานสุด/.test(el.textContent));
    });
  }, 30000);
  /* ---------- keep the screen on during a night (Screen Wake Lock; iOS 18.4+ in home-screen apps) ----------
     Asked for on the first tap and again whenever the app comes back to the front; the system drops it when hidden. */
  var wake = { lock: null, asking: false };
  function wakeWanted() { try { return localStorage.getItem('bmm-wake') !== 'off'; } catch (e) { return true; } }
  async function keepAwake() {
    if (!S || wake.lock || wake.asking || !wakeWanted() || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wake.asking = true;
    try { wake.lock = await navigator.wakeLock.request('screen'); wake.lock.addEventListener('release', function () { wake.lock = null; }); } catch (e) { }
    wake.asking = false;
  }
  function setWake(on) {
    try { localStorage.setItem('bmm-wake', on ? 'on' : 'off'); } catch (e) { }
    if (on) keepAwake(); else if (wake.lock) { wake.lock.release().catch(function () { }); wake.lock = null; }
  }
  document.addEventListener('click', keepAwake, true);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') keepAwake(); });

  /* ---------- self-update ----------
     GitHub Pages lets phones cache index.html for up to 10 minutes, and a home-screen app can keep an old copy longer.
     On start and whenever the app comes back to the front, fetch index.html past every cache and compare its ?v= stamp
     with the one this page loaded; if it moved on, reload at a URL the cache has never seen. Local changes are already
     in localStorage, so a reload loses nothing. Never while typing; at most one try per new stamp. */
  function myStamp() { var el = document.querySelector('script[src*="js/app.js"]'), m = el && el.src.match(/[?&]v=(\w+)/); return m ? m[1] : null; }
  async function checkUpdate() {
    var mine = myStamp();
    if (!mine || navigator.onLine === false) return;
    try {
      var r = await fetch('index.html?check=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      var m = (await r.text()).match(/js\/app\.js\?v=(\w+)/);
      if (!m || m[1] === mine) return;
      var ae = document.activeElement;
      if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
      try { if (sessionStorage.getItem('bmm-upd') === m[1]) return; sessionStorage.setItem('bmm-upd', m[1]); } catch (e) { }
      if (sync.dirty && S) writeCache();
      location.replace(location.pathname + '?v=' + m[1] + location.hash);
    } catch (e) { }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkUpdate(); });
  setTimeout(checkUpdate, 3000);

  boot();
})();
