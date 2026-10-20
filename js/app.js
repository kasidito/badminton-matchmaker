/* UI, local cache and sync. Matching and rating rules live in algo.js; network calls in db.js. */
(function () {
  'use strict';
  var A = window.Algo;
  var MODE_LABEL = { normal: 'ปกติ', competitive: 'แข่งขัน', social: 'สังสรรค์' };
  var MODE_ORDER = ['normal', 'competitive', 'social'];
  var LV_LABEL = { B: 'เพิ่งเริ่ม', N: 'มือใหม่', I: 'กลาง', A: 'เก่ง', P: 'โหด' };
  var LV_ORDER = ['B', 'N', 'I', 'A', 'P'];
  var LV_HINT = { B: 'ตีโต้ได้ไม่กี่ลูก เสิร์ฟยังพลาด', N: 'เล่นเป็นเกมได้ แต่พลาดบ่อย', I: 'คุมลูกได้ ยืนตำแหน่งคู่ถูก', A: 'ตบหนัก เล่นเกมรุกได้', P: 'เคยแข่งหรือเคยติดทีม' };
  var BIRD_HINT = { chick: 'เพิ่งฟักออกจากไข่', sparrow: 'เริ่มบินได้ ตีโต้เป็นเกม', pigeon: 'บินคล่อง เล่นได้ทุกตำแหน่ง', hawk: 'สายรุก ตบแรง', eagle: 'เจ้าเวหา คุมเกมได้', phoenix: 'ตำนานของก๊วน' };

  var S = null;   // the session being run (shape documented in CLAUDE.md)
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
          seq: i + 1, court: m.court || 0, mode: m.mode || 'normal', a: m.t[0], b: m.t[1], w: m.w,
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
      if (!S.sessionId) {
        if (!needsSession()) { writeCache(); setStatus('saved'); return; }
        await openOrCreateSession();
      }
      try { await DB.sync(S.sessionId, buildPayload()); }
      catch (e) {
        if (e.code !== 'P0002') throw e;           // night was closed on another device: open a new one and retry
        await openOrCreateSession();
        await DB.sync(S.sessionId, buildPayload());
      }
      writeCache();
      setStatus(sync.dirty ? 'pending' : 'saved');
    } catch (e) {
      sync.dirty = true; writeCache();
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
    return { id: row.id, name: row.name, active: !!active, base: base || 0, level: row.level, start: row.start_mmr, games: row.career_games, freeSince: active ? Date.now() : 0, qr: Math.random() };
  }
  /* session may be null: tonight has not been opened yet */
  function buildState(session, rows, cache) {
    var st, sid = session ? session.id : null;
    if (cache && cache.dirty && cache.S.sessionId === sid) st = cache.S;      // unsynced local changes win
    else if (session && session.state && session.state.v === 4) st = session.state;
    else {
      var modes = session ? session.court_modes : (cache ? cache.S.courts.map(function (c) { return c.mode; }) : ['normal', 'normal', 'normal']);
      st = { v: 4, players: [], courts: modes.map(function (m) { return { mode: m }; }), live: [], done: [], adj: [],
        flex: session ? session.flex : (cache ? (cache.S.flex || 0) : 4), board: cache ? !!cache.S.board : false };
    }
    st.sessionId = sid;
    st.title = session ? session.title : null;
    var have = {}; st.players.forEach(function (p) { have[p.id] = p; });
    var used = {}; st.done.forEach(function (m) { m.t[0].concat(m.t[1]).forEach(function (id) { used[id] = 1; }); });
    st.live.forEach(function (c) { if (c) c.t[0].concat(c.t[1]).forEach(function (id) { used[id] = 1; }); });
    var keep = [];
    rows.forEach(function (r) {
      var p = have[r.id];
      if (p) { p.name = r.name; if (r.active || used[r.id]) keep.push(p); }
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
    S = null; ui.undos = []; ui.admins = null; ui.newIds = []; ui.sel = null; ui.editPlayer = null; ui.resetId = null; ui.restPick = false;
    sync.dirty = false;
    var cache = readCache();
    try {
      var res = await Promise.all([DB.loadPlayers(), DB.openSession(), DB.loadClosedDays(30)]);
      var session = res[1];
      // a night opened on an earlier day but never used is moved to today
      if (session && session.played_on !== todayISO() && !sessionUsed(session)) {
        try { session = await DB.retitleSession(session.id, todayTitle(), todayISO()); } catch (e) { }
      }
      S = buildState(session, res[0], cache);
      S.days = res[2];
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
      try { await DB.updatePlayer(id, { name: name }); msgs.push('เปลี่ยนชื่อเป็น ' + name); p.name = name; }
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
  }

  /* ---------- bird ranks ---------- */
  function bird(i, size) {
    var b = A.BIRDS[i] || A.BIRDS[0];
    return '<span class="bird bd-' + b.k + (size ? ' ' + size : '') + '" role="img" aria-label="' + b.name + '" title="' + b.name + '"><svg aria-hidden="true"><use href="#b-' + b.k + '"/></svg></span>';
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
    DB.updatePlayer(p.id, { level: p.level, start_mmr: p.start }).catch(function () { });
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
    head += '<span class="badge">' + (m ? 'เล่นมา ' + m + ' นาที' : 'เพิ่งเริ่ม') + '</span>';
    head += '<button class="redraw" data-act="redraw" data-ci="' + ci + '" aria-label="สุ่มสนาม ' + (ci + 1) + ' ใหม่ (ไม่นับแมตช์)">' + ic('shuffle') + 'สุ่มใหม่</button></div>';
    var p = A.winProb(RT.R, c.t);
    var h = '<section class="court">' + head;
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
      '<div class="fact"><span>แมตช์ที่จบ</span><b id="doneCount">' + S.done.length + '</b><small>กำลังเล่น ' + on + '/' + S.courts.length + ' สนาม</small></div>' +
      '<div class="fact"><span>เวลาเล่น</span><b>' + (t0 ? hm : '–') + '</b><small>' + (t0 ? 'เริ่ม ' + clock(t0) + ' น.' : 'ยังไม่เริ่ม') + '</small></div>' +
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
      h += '<div class="chips">';
      q.forEach(function (x, i) {
        var pl = map[x.id], w = mins(pl.freeSince);
        h += '<button class="chip' + (i < 4 ? ' next' : '') + (sameSel({ id: x.id }) ? ' sel' : '') + '" data-act="pickq" data-id="' + x.id + '">' + bird(RT.B[x.id], 'sm') +
          '<span class="cn">' + esc(pl.name) + '</span><span class="cm">' + (st.played[x.id] ? 'เล่น ' + st.played[x.id] : 'ยังไม่เล่น') + (w ? ' · ' + w + ' น.' : '') + '</span>' + (i < 4 ? '<span class="tag-next">ลงต่อ</span>' : '') + '</button>';
      });
      h += '</div>';
    }
    return h + '</div></section>';
  }
  function viewPlay() {
    var map = byId(), RT = A.ratings(S.done, S.players, S.adj), st = A.stats(S.done, S.players);
    var q = A.queueOrder(S, null), free = A.freeCount(S), fl = fillState();
    var h = '<div class="roundhead"><h2>สนาม</h2>' +
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
        if (firstEmpty < 0) { firstEmpty = ci; next = q.slice(0, 4).map(function (x) { return x.id; }); }
        else next = { after: firstEmpty };
      }
      h += courtHtml(c, ci, map, RT, st, free, next);
    });
    return h + '</div></div>';
  }
  function memberRow(p, st, RT, on) {
    if (ui.editPlayer === p.id) return playerEditor(p, RT);
    var canDel = ui.editMembers && st.played[p.id] === 0 && !on[p.id];
    return '<div class="row' + (p.active ? '' : ' off') + '">' + bird(RT.B[p.id], 'md') + '<div class="who"><b>' + esc(p.name) + '</b><span>' + (p.active ? 'เล่น ' + st.played[p.id] + ' · ' : '') + 'MMR ' + Math.round(RT.R[p.id]) + '</span></div>' +
      '<select class="lvl" data-act="level" data-id="' + p.id + '" aria-label="ระดับของ ' + esc(p.name) + '">' + LV_ORDER.map(function (l) { return '<option value="' + l + '"' + ((p.level || 'I') === l ? ' selected' : '') + '>' + LV_LABEL[l] + '</option>'; }).join('') + '</select>' +
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
    if (fresh.length) {
      h += '<div class="card span newcard"><div class="line"><h2>ตั้งระดับให้คนใหม่ (' + fresh.length + ')</h2><button class="btn sm primary" data-act="new-done">' + ic('check') + 'เสร็จ</button></div>' +
        '<p class="muted small">ระดับใช้ตั้งคะแนนเริ่มต้น หลังจากนั้นคะแนนขยับตามผลแข่ง</p>';
      fresh.forEach(function (p) {
        h += '<div class="newrow"><b>' + esc(p.name) + '</b><div class="lvpick" role="group" aria-label="ระดับของ ' + esc(p.name) + '">' + LV_ORDER.map(function (l) {
          var on = (p.level || 'I') === l;
          return '<button class="' + (on ? 'on' : '') + '" data-act="setlevel" data-id="' + p.id + '" data-lv="' + l + '" aria-pressed="' + on + '">' + bird(A.birdIndex(A.LV[l]), 'sm') + '<span>' + LV_LABEL[l] + '</span></button>';
        }).join('') + '</div><span class="muted small">' + LV_HINT[p.level || 'I'] + '</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="card"><h2>เช็กอินวันนี้</h2><form class="add" id="addForm" autocomplete="off">' +
      '<textarea id="nameIn" rows="3" placeholder="วางโพสต์ลงชื่อจากไลน์ได้ทั้งโพสต์" aria-label="รายชื่อ"></textarea>' +
      '<button class="btn primary" type="submit">' + ic('plus') + 'เช็กอิน</button>' +
      '<p class="muted small">สมาชิกเดิมถูกเช็กอิน ชื่อใหม่ถูกเพิ่มเป็นสมาชิก และตั้งจำนวนสนามจากคำว่า "3 สนาม" ให้ด้วย</p></form></div>';
    h += '<div class="card"><div class="line"><h2>มาวันนี้ (' + here.length + ')</h2>' + (here.length ? '<button class="btn sm ghost" data-act="checknone">ยกเลิกทั้งหมด</button>' : '') + '</div>';
    if (!here.length) h += '<p class="muted small">ยังไม่มีใครเช็กอิน วางโพสต์ด้านบน หรือเปิดสวิตช์ในรายชื่อ "ยังไม่มา"</p>';
    here.forEach(function (p) { h += memberRow(p, st, RT, on); });
    h += '</div>';
    h += '<div class="card"><details' + (here.length && !ui.editMembers ? '' : ' open') + '><summary>ยังไม่มา (' + away.length + ')' + ic('chev') + '</summary>';
    if (away.length) h += '<div class="line" style="margin:6px 0"><span class="muted small">เปิดสวิตช์เมื่อมาถึง</span><button class="btn sm ghost" data-act="checkall">เช็กอินทุกคน</button></div>';
    else h += '<p class="muted small">มาครบทุกคน</p>';
    away.forEach(function (p) { h += memberRow(p, st, RT, on); });
    h += '</details></div>';
    h += '<div class="line"><span class="muted small">ระดับใช้ตั้ง MMR เริ่มต้น: เพิ่งเริ่ม 1200 · มือใหม่ 1350 · กลาง 1500 · เก่ง 1650 · โหด 1800</span>' +
      '<button class="btn sm ghost" data-act="editmembers">' + (ui.editMembers ? ic('check') + 'เสร็จ' : ic('trash') + 'ลบสมาชิก') + '</button></div>';
    if (ui.editMembers) h += '<p class="note small">แตะถังขยะสีแดงเพื่อลบคนที่ยังไม่ได้เล่นคืนนี้ ประวัติเดิมยังอยู่ในระบบ</p>';
    return h;
  }
  function viewRank() {
    var RT = A.ratings(S.done, S.players, S.adj);
    var list = S.players.filter(function (p) { return p.active || RT.G[p.id] > 0; });
    list.sort(function (a, b) { return RT.R[b.id] - RT.R[a.id] || RT.G[b.id] - RT.G[a.id] || a.id - b.id; });
    var h = '<div class="roundhead"><h2>อันดับ</h2><span class="sub">MMR · คืนนี้ ' + S.done.length + ' แมตช์ · ป้ายสีคือขึ้นหรือลงคืนนี้ · ยังไม่นิ่ง = เล่นไม่ถึง 10 แมตช์</span></div>';
    var top = list[0];
    if (top && ui.editId !== top.id) {
      var tg = RT.G[top.id], tw = RT.W[top.id], tr = Math.round(RT.R[top.id]);
      h += '<section class="hero"><span class="medal-wrap">' + bird(RT.B[top.id], 'lg') + '<span class="medal">1</span></span><div class="who"><small>อันดับหนึ่ง · ' + A.BIRDS[RT.B[top.id]].name + '</small><b>' + esc(top.name) + '</b><small>ชนะ ' + tw + ' แพ้ ' + (tg - tw) + '</small></div>' +
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
        bird(RT.B[p.id], 'md') + '<div class="who"><b>' + esc(p.name) + (RT.C[p.id] < 10 ? '<span class="prov">ยังไม่นิ่ง</span>' : '') + '</b><span>' + A.BIRDS[RT.B[p.id]].name + ' · ชนะ ' + w + ' แพ้ ' + (g - w) + (p.active ? '' : ' · กลับแล้ว') + '</span></div>' +
        '<div class="score"><b>' + rt + '</b>' + deltaHtml(rt - A.startOf(p)) + '</div>' +
        '<button class="icon" data-act="edit-mmr" data-id="' + p.id + '" aria-label="แก้ MMR ของ ' + esc(p.name) + '">' + ic('pencil') + '</button></div>';
    });
    h += '</div></div>';
    var tally = A.BIRDS.map(function () { return 0; });
    list.forEach(function (p) { tally[RT.B[p.id]]++; });
    h += '<div class="card span"><h2>ระดับนก</h2><p class="muted small">ขึ้นระดับทันทีที่คะแนนถึง และลดระดับเมื่อคะแนนต่ำกว่าเส้นเกิน 25 แต้ม คิดจากผลในก๊วนนี้เท่านั้น</p><div class="birds">' +
      A.BIRDS.map(function (b, i) {
        return '<div class="btile">' + bird(i, 'xl') + '<b>' + b.name + '</b><span class="rng">' + birdRange(i) + '</span><span class="muted small">' + BIRD_HINT[b.k] + '</span>' + (tally[i] ? '<span class="cnt">' + tally[i] + ' คน</span>' : '') + '</div>';
      }).join('') + '</div></div>';
    h += '<button class="btn' + (ui.confirm === 'rank' ? ' danger' : '') + '" data-act="rank-reset" style="justify-self:start">' + (ui.confirm === 'rank' ? 'กดอีกครั้งเพื่อยืนยัน' : 'รีเซ็ต MMR ตามระดับ') + '</button>';
    return h;
  }
  function deltaHtml(d) { return '<span class="delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + fmtDelta(d) + '</span>'; }
  function matchText(nm, m) {
    return nm(m.t[0][0]) + ' + ' + nm(m.t[0][1]) + (m.w === 0 ? ' <b>(ชนะ)</b>' : '') + ' พบ ' + nm(m.t[1][0]) + ' + ' + nm(m.t[1][1]) + (m.w === 1 ? ' <b>(ชนะ)</b>' : '');
  }
  function modeTag(mode) { return mode && mode !== 'normal' ? ' <span class="tag m-' + mode + '">' + MODE_LABEL[mode] + '</span>' : ''; }
  function viewSummary() {
    var st = A.stats(S.done, S.players), map = byId();
    var list = S.players.filter(function (p) { return p.active || st.played[p.id] > 0; });
    list.sort(function (a, b) { return st.played[b.id] - st.played[a.id] || a.id - b.id; });
    var counts = list.map(function (p) { return st.played[p.id]; });
    var max = counts.length ? Math.max.apply(null, counts) : 0, min = counts.length ? Math.min.apply(null, counts) : 0;
    var spread = max - min, pmax = 0;
    Object.keys(st.P).forEach(function (k) { if (st.P[k] > pmax) pmax = st.P[k]; });
    var h = '<div class="strip span">' +
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
      h += '<div class="card"><details open><summary>แมตช์วันนี้ (แก้ไขได้)' + ic('chev') + '</summary><div class="hist">';
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
        h += '<details><summary><span>' + esc(d.label) + ' · ' + d.count + ' แมตช์</span>' + ic('chev') + '</summary><div class="hist">';
        d.players.forEach(function (r, ri) {
          h += '<div class="rk compact' + (ri < 3 ? ' podium' : '') + '"><span class="pos">' + (ri + 1) + '</span><div class="who"><b>' + esc(r.name) + '</b><span>เล่น ' + r.played + ' · ชนะ ' + r.win + ' · แพ้ ' + (r.played - r.win) + '</span></div><div class="score"><b>' + r.mmr + '</b>' + deltaHtml(r.mmr - r.start) + '</div></div>';
        });
        var en = function (s) { return esc(s); };
        h += '<details><summary class="small">แมตช์ทั้งหมด' + ic('chev') + '</summary><div class="hist">';
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
      '<div class="srow"><div class="stext"><b>เริ่มเกมใหม่</b><span>ล้างแมตช์คืนนี้ และตั้ง MMR ทุกคนกลับตามระดับ กดย้อนกลับได้</span></div>' +
      '<button class="btn sm' + (ui.confirm === 'reset' ? ' danger' : '') + '" data-act="reset">' + ic('trash') + (ui.confirm === 'reset' ? 'กดอีกครั้ง' : 'รีเซ็ต') + '</button></div>';

    var look = '<div class="srow"><div class="stext"><b>สีของแอป</b><span>อัตโนมัติ = ตามที่ตั้งในเครื่อง</span></div>' + seg('สีของแอป', [['auto', 'อัตโนมัติ'], ['light', 'สว่าง'], ['dark', 'มืด']], themePref(), 'theme', 'v') + '</div>' +
      '<div class="srow"><div class="stext"><b>โหมดจอใหญ่</b><span>ตัวใหญ่ ซ่อนปุ่ม ไว้วางโชว์ข้างสนาม</span></div><label class="sw"><input type="checkbox" data-act="boardsw"' + (S.board ? ' checked' : '') + ' aria-label="โหมดจอใหญ่"><span class="track"></span></label></div>';

    var account = '<div class="srow"><div class="stext"><b>' + esc(ui.user && ui.user.email || '') + '</b><span>เข้าสู่ระบบอยู่</span></div><button class="btn sm" data-act="logout">' + ic('logout') + 'ออกจากระบบ</button></div>' +
      '<form id="pwForm" class="sblock add" autocomplete="off"><label class="small">เปลี่ยนรหัสผ่าน<input class="field" id="newPw" type="password" minlength="8" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร"></label><button class="btn sm" type="submit">เปลี่ยนรหัสผ่าน</button></form>';

    var sc = sheetCfg(), pending = sheetQueue().length;
    var data = '<div class="srow"><div class="stext"><b>ดาวน์โหลดข้อมูลทั้งหมด</b><span>ไฟล์ JSON ของสมาชิก ทุกคืน และทุกแมตช์</span></div><button class="btn sm" data-act="export">' + ic('download') + 'ดาวน์โหลด</button></div>' +
      '<details class="sdetails"><summary><span class="stext"><b>ความยืดหยุ่นของคิว</b><span>ตอนนี้ ' + (S.flex || 0) + ' · สนามแข่งขันและสังสรรค์</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<div class="line"><span class="muted small">เลือกจากคิวเพิ่มได้อีกกี่คน</span>' + seg('ความยืดหยุ่นของคิว', [[0, '0'], [2, '2'], [4, '4'], [6, '6']], S.flex || 0, 'flex', 'n') + '</div>' +
      '<p class="muted small">0 = ตามคิวเป๊ะ · ยิ่งมาก ระดับยิ่งใกล้ แต่บางคนอาจรอนานขึ้นนิดหน่อย คนที่เล่นน้อยกว่ายังได้ก่อนเสมอ</p></div></details>' +
      '<details class="sdetails"><summary><span class="stext"><b>นำเข้าจากแอปเดิม</b><span>ใช้ข้อมูลจากปุ่ม "คัดลอกข้อมูลสำรอง"</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<p class="muted small">ระบบจับคู่ชื่อ เพิ่มคนที่ยังไม่มี และนำแมตช์เข้าเกมนี้ ทำได้เมื่อเกมนี้ยังไม่มีแมตช์</p>' +
      '<form id="importForm" class="add" autocomplete="off"><textarea id="impText" rows="3" placeholder="วางข้อมูลสำรองที่นี่" aria-label="ข้อมูลสำรองจากแอปเดิม"></textarea><button class="btn sm" type="submit"' + (S.done.length ? ' disabled' : '') + '>นำเข้า</button></form></div></details>' +
      '<details class="sdetails"' + (sc.url || pending ? ' open' : '') + '><summary><span class="stext"><b>รายงาน Google Sheet</b><span>ไม่บังคับ · ส่งสรุปตอนจบเกม</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<form id="sheetForm" class="add" autocomplete="off">' +
      '<label class="small">ลิงก์ Web app<input class="field" id="sheetUrl" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(sc.url) + '"></label>' +
      '<label class="small">รหัส (token) ต้องตรงกับในสคริปต์<input class="field" id="sheetToken" value="' + esc(sc.token) + '"></label>' +
      '<div class="line"><button class="btn xs" type="button" data-act="gentoken">สร้างรหัสใหม่</button><button class="btn xs" type="button" data-act="copytoken">คัดลอกรหัส</button></div><button class="btn sm primary" type="submit">บันทึกและส่งทดสอบ</button></form>' +
      (pending ? '<button class="btn sm" data-act="flushsheet">' + ic('cloud') + 'ส่งรายงานที่ค้าง (' + pending + ')</button>' : '') + '</div></details>';

    var clubs = '<form id="clubForm" class="srow" autocomplete="off"><label class="stext"><b>ชื่อก๊วนนี้</b><input class="field" id="clubName" maxlength="60" value="' + esc(ui.club ? ui.club.name : '') + '" aria-label="ชื่อก๊วน" required></label><button class="btn sm" type="submit">บันทึกชื่อ</button></form>';
    (ui.clubs || []).forEach(function (c) {
      if (ui.club && c.id === ui.club.id) return;
      clubs += '<div class="srow"><div class="stext"><b>' + esc(c.name) + '</b><span>ก๊วนอื่นที่คุณดูแล</span></div><button class="btn sm" data-act="club-switch" data-id="' + c.id + '">' + ic('swap') + 'สลับไปก๊วนนี้</button></div>';
    });
    clubs += '<details class="sdetails"' + (ui.newClubOpen ? ' open' : '') + '><summary><span class="stext"><b>สร้างก๊วนใหม่</b><span>ผู้เล่นและประวัติแยกจากก๊วนนี้ทั้งหมด</span></span>' + ic('chev') + '</summary><div class="sbody">' +
      '<form id="newClubForm" class="add" autocomplete="off"><input class="field" id="newClubName" maxlength="60" placeholder="ชื่อก๊วน เช่น ก๊วนแบดวันเสาร์" aria-label="ชื่อก๊วนใหม่" required><button class="btn sm primary" type="submit">' + ic('plus') + 'สร้างและสลับไป</button></form>' +
      '<p class="muted small">คุณจะเป็นผู้ดูแลของก๊วนใหม่ แล้วเพิ่มบัญชีคนอื่นเป็นผู้ดูแลได้ที่หัวข้อผู้ดูแลก๊วน คนที่เป็นผู้ดูแลเฉพาะก๊วนนั้นจะไม่เห็นผู้เล่นของก๊วนนี้</p></div></details>';
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
    el.classList.toggle('lift', ui.tab === 'play' && !S.board);
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
      saved: ['saved', 'cloud', 'บันทึกแล้ว'], pending: ['', 'cloud', 'รอบันทึก'], saving: ['', 'cloud', 'กำลังบันทึก'],
      offline: ['offline', 'cloud-off', 'ออฟไลน์ เก็บในเครื่อง'], error: ['error', 'cloud-off', 'บันทึกไม่ได้ แตะลองใหม่']
    };
    var m = map[ui.status] || map.pending;
    el.className = 'sync ' + m[0];
    el.title = ui.statusMsg || m[2];
    el.innerHTML = ic(m[1]) + '<span class="lbl">' + m[2] + '</span>';
  }
  function render() {
    if (!S) return;
    var v = $('view'), dock = $('dock');
    document.body.classList.toggle('board', !!S.board);
    $('boardBtn').classList.toggle('on', !!S.board);
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
    ui.tt = setTimeout(function () { ui.toast = null; renderToast(); }, 7000);
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
  async function checkIn(text) {
    var names = A.parseNames(text), added = 0, checked = 0, failed = [];
    if (!names.length) { toast('ไม่พบชื่อในข้อความ', null); return; }
    var base = (S.done.length || A.liveIds(S).length) ? A.minCredit(S) : 0;
    ui.busy = 'กำลังเช็กอิน…'; render();
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var ex = S.players.filter(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })[0];
      if (ex) { if (!ex.active) { setActive(ex.id, true); checked++; } continue; }
      try {
        var row = await DB.addPlayer(n, 'I');
        S.players.push(fromRow(row, true, base)); added++;
        ui.newIds = (ui.newIds || []).concat([row.id]);
      } catch (e) {
        if (e.code === '23505') {   // name exists but was removed earlier: bring them back
          try {
            var all = await DB.loadPlayers();
            var r = all.filter(function (x) { return x.name.toLowerCase() === n.toLowerCase(); })[0];
            if (r) { await DB.setPlayerActive(r.id, true); S.players.push(fromRow(r, true, base)); added++; continue; }
          } catch (e2) { }
        }
        failed.push(n);
      }
    }
    ui.busy = null;
    // the LINE post says how many courts were booked ("3 สนาม"); only change it before play starts
    var courts = A.parseCourts(text), courtMsg = '';
    if (courts && courts !== S.courts.length && !S.done.length && !S.live.some(Boolean)) {
      A.setCourtCount(S, courts); courtMsg = ' · ตั้ง ' + courts + ' สนามตามโพสต์';
    }
    changed();
    toast('เช็กอิน ' + checked + ' คน · เพิ่มใหม่ ' + added + ' คน' + courtMsg + (failed.length ? ' · เพิ่มไม่ได้: ' + failed.join(', ') + ' (ต้องออนไลน์)' : ''), null);
    render();
  }
  async function removePlayer(id) {
    var st = A.stats(S.done, S.players);
    if (st.played[id] !== 0 || A.liveIds(S).indexOf(id) >= 0) return;
    var p = A.findP(S, id);
    try { await DB.setPlayerActive(id, false); }
    catch (e) { toast('ลบไม่ได้ ต้องออนไลน์', null); return; }
    S.players = S.players.filter(function (q) { return q.id !== id; });
    changed(); toast('ลบ ' + (p ? p.name : '') + ' ออกจากสมาชิกแล้ว', null); render();
  }
  async function endDay() {
    if (!S.done.length) { toast('ยังไม่มีแมตช์ที่บันทึก', null); render(); return; }
    ui.busy = 'กำลังจบเกมและบันทึก…'; render();
    try {
      await flushSync();
      var report = buildReport();
      await DB.closeSession(S.sessionId, A.carryForward(S));
      var snap = A.endGame(S, S.title || todayTitle());
      S.sessionId = null; S.title = null;              // next night opens at its first check-in
      S.players.forEach(function (p) { p.active = false; });
      ui.undos = [];
      changed(); renderDate();
      try { S.days = await DB.loadClosedDays(30); } catch (e) { }
      var msg = 'จบเกมแล้ว บันทึก ' + snap.count + ' แมตช์ขึ้นระบบ';
      if (sheetCfg().url) {
        saveQueue(sheetQueue().concat([report]));
        ui.busy = 'กำลังส่งรายงานไป Google Sheet…'; render();
        var sent = await flushReports();
        msg += sent ? ' · ส่งรายงานไป Google Sheet แล้ว' : ' · ส่งรายงานไม่ได้ ไปที่ตั้งค่าเพื่อส่งอีกครั้ง';
      }
      toast(msg, null);
    } catch (e) {
      toast('จบเกมไม่สำเร็จ: ' + errMsg(e) + ' ข้อมูลยังอยู่ ลองใหม่เมื่อออนไลน์', null);
    }
    ui.busy = null; render();
  }

  /* ---------- Google Sheet report (Apps Script web app, see tools/google-sheet-report.gs) ---------- */
  var SHEET_KEY = 'bmm-sheet', QUEUE_KEY = 'bmm-sheet-queue';
  function sheetCfg() { try { return JSON.parse(localStorage.getItem(SHEET_KEY) || 'null') || { url: '', token: '' }; } catch (e) { return { url: '', token: '' }; } }
  function saveSheetCfg(c) { try { localStorage.setItem(SHEET_KEY, JSON.stringify(c)); } catch (e) { } }
  function sheetQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; } }
  function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) { } }
  function hhmm(ms) { if (!ms) return ''; try { return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }); } catch (e) { return ''; } }
  function buildReport() {
    var RT = A.ratings(S.done, S.players, S.adj), map = byId();
    var nm = function (id) { return map[id] ? map[id].name : '-'; };
    return {
      nightId: S.sessionId, date: todayISO(), label: S.title || todayTitle(), matchCount: S.done.length,
      players: S.players.filter(function (p) { return RT.G[p.id] > 0; }).map(function (p) {
        return { name: p.name, level: LV_LABEL[p.level || 'I'], played: RT.G[p.id], won: RT.W[p.id], lost: RT.G[p.id] - RT.W[p.id], mmrStart: Math.round(A.startOf(p)), mmrEnd: Math.round(RT.R[p.id]) };
      }).sort(function (a, b) { return b.mmrEnd - a.mmrEnd; }),
      matches: S.done.map(function (m, i) {
        return { no: i + 1, court: (m.court || 0) + 1, mode: MODE_LABEL[m.mode || 'normal'], teamA: m.t[0].map(nm).join(' + '), teamB: m.t[1].map(nm).join(' + '), winner: m.w === 0 ? 'A' : 'B', start: hhmm(m.at), end: hhmm(m.end) };
      }),
      ranking: S.players.map(function (p) { return { name: p.name, level: LV_LABEL[p.level || 'I'], mmr: Math.round(RT.R[p.id]), career: RT.C[p.id] }; })
        .sort(function (a, b) { return b.mmr - a.mmr; })
    };
  }
  async function postReport(body, cfg) {
    var res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: cfg.token }, body)) });
    var out = await res.json();
    if (!out || !out.ok) throw new Error((out && out.error) || 'Google Sheet ตอบกลับไม่สำเร็จ');
    return out;
  }
  async function flushReports() {
    var cfg = sheetCfg(), q = sheetQueue();
    if (!cfg.url || !q.length) return 0;
    var sent = 0, rest = [];
    for (var i = 0; i < q.length; i++) {
      try { await postReport(q[i], cfg); sent++; if (q[i].nightId) DB.markExported(q[i].nightId).catch(function () { }); }
      catch (e) { rest.push(q[i]); }
    }
    saveQueue(rest);
    return sent;
  }
  function randomToken() {
    var a = new Uint8Array(18); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
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
    else if (a === 'board') { S.board = !S.board; ui.sel = null; }
    else if (a === 'undo') {
      var step = ui.undos.pop();
      if (step) {
        var keep = { days: S.days, sessionId: S.sessionId, title: S.title };
        S = JSON.parse(step.snap); S.days = keep.days; S.sessionId = keep.sessionId; S.title = keep.title;
        A.normalize(S); ui.sel = null;
        toast('ย้อนกลับแล้ว: ' + step.label, null);
      } else ui.toast = null;
    }
    else if (a === 'gentoken') { var ti = $('sheetToken'); if (ti) ti.value = randomToken(); return; }
    else if (a === 'copytoken') {
      var tv = ($('sheetToken') || {}).value || '';
      if (!tv) { toast('ยังไม่มีรหัส กดสร้างรหัสใหม่ก่อน', null); return; }
      navigator.clipboard.writeText(tv).then(function () { toast('คัดลอกรหัสแล้ว นำไปวางในสคริปต์ตรง TOKEN', null); }, function () { var el = $('sheetToken'); el.focus(); el.select(); toast('คัดลอกอัตโนมัติไม่ได้ เลือกข้อความแล้วคัดลอกเอง', null); });
      return;
    }
    else if (a === 'flushsheet') {
      ui.busy = 'กำลังส่งรายงาน…'; render();
      flushReports().then(function (n) { ui.busy = null; toast(n ? 'ส่งรายงานแล้ว ' + n + ' คืน' : 'ยังส่งไม่ได้ ตรวจลิงก์ รหัส และอินเทอร์เน็ต', null); render(); });
      return;
    }
    else if (a === 'export') { downloadAll(); return; }
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
    else if (a === 'reset') { if (confirmTap('reset')) { A.resetGame(S); msg = 'เริ่มเกมใหม่แล้ว MMR กลับตามระดับ'; } }
    if (msg) { toast(msg, snap); if (birdToast != null) { ui.toast.bird = birdToast; renderToast(); } }
    if (JSON.stringify(S) !== before) changed();
    render();
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !S) return;
    var a = t.dataset.act;
    if (a === 'toggle') setActive(+t.dataset.id, t.checked);
    else if (a === 'level') {
      setLevel(+t.dataset.id, t.value);
    }
    else if (a === 'boardsw') S.board = t.checked;
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
    else if (f.id === 'sheetForm') {
      var cfg = { url: $('sheetUrl').value.trim(), token: $('sheetToken').value.trim() };
      saveSheetCfg(cfg);
      if (!cfg.url) { toast('ลบการตั้งค่า Google Sheet แล้ว', null); render(); return; }
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url)) { toast('ลิงก์ต้องขึ้นต้นด้วย https://script.google.com/', null); return; }
      ui.busy = 'กำลังส่งทดสอบ…'; render();
      try { await postReport({ test: true }, cfg); toast('เชื่อม Google Sheet สำเร็จ', null); }
      catch (err) { toast('ส่งทดสอบไม่ผ่าน: ' + errMsg(err) + ' ตรวจลิงก์ รหัส และการ deploy แบบ Anyone', null); }
      ui.busy = null; render();
    }
    else if (f.id === 'playerForm') { await savePlayerEdit(f); }
    else if (f.id === 'clubForm') {
      var cn = $('clubName').value.replace(/\s+/g, ' ').trim();
      if (!cn || !ui.club) return;
      try { await DB.renameClub(ui.club.id, cn); ui.club.name = cn; (ui.clubs || []).forEach(function (c) { if (c.id === ui.club.id) c.name = cn; }); try { localStorage.setItem(clubKey(), JSON.stringify(ui.club)); } catch (x) { } toast('เปลี่ยนชื่อก๊วนแล้ว', null); }
      catch (err) { toast('เปลี่ยนชื่อก๊วนไม่ได้: ' + errMsg(err), null); }
      render();
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
  setInterval(function () {
    var ae = document.activeElement;
    if (S && ui.tab === 'play' && !ui.busy && !(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) render();
  }, 30000);
  boot();
})();
