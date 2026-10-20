/* UI, local cache and sync. Matching and rating rules live in algo.js; network calls in db.js. */
(function () {
  'use strict';
  var A = window.Algo;
  var MODE_LABEL = { normal: 'ปกติ', competitive: 'แข่งขัน', social: 'สังสรรค์' };
  var MODE_ORDER = ['normal', 'competitive', 'social'];
  var LV_LABEL = { N: 'มือใหม่', I: 'กลาง', A: 'เก่ง' };

  var S = null;   // the session being run (shape documented in CLAUDE.md)
  var ui = { tab: 'play', sel: null, confirm: null, ct: null, editId: null, toast: null, tt: null, user: null, busy: null, status: 'saved', statusMsg: '' };
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
  function cacheKey() { return 'bmm-cache-' + (ui.user ? ui.user.id : 'anon'); }
  function readCache() { try { var c = JSON.parse(localStorage.getItem(cacheKey()) || 'null'); return c && c.S && c.S.v === 4 ? c : null; } catch (e) { return null; } }
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
  async function runSync() {
    if (sync.running || !sync.dirty) return;
    sync.running = true; sync.dirty = false; setStatus('saving');
    try {
      try { await DB.sync(S.sessionId, buildPayload()); }
      catch (e) {
        if (e.code !== 'P0002') throw e;           // session was closed elsewhere: open a new one and retry
        var ns = await DB.createSession(todayTitle(), S.courts.map(function (c) { return c.mode; }), S.flex || 0);
        S.sessionId = ns.id;
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
    return '<span class="logo">' + ic('shuttle') + '</span><h1>จัดคู่ก๊วนแบด</h1><p class="muted">สำหรับผู้ดูแลก๊วนเท่านั้น</p>' +
      '<form id="loginForm" class="add" autocomplete="on">' +
      '<label>อีเมล<input class="field" id="email" type="email" autocomplete="username" required></label>' +
      '<label>รหัสผ่าน<input class="field" id="password" type="password" autocomplete="current-password" required></label>' +
      (err ? '<p class="err">' + esc(err) + '</p>' : '') +
      '<button class="btn primary" type="submit">เข้าสู่ระบบ</button></form>';
  }
  async function boot() {
    showGate('<p>กำลังโหลด…</p>');
    try { DB.init(); } catch (e) { showGate('<h1>โหลดระบบไม่ได้</h1><p class="muted">ตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้านี้</p>'); return; }
    var user = null;
    try { user = await DB.getUser(); } catch (e) { }
    if (!user) { showGate(loginHtml()); return; }
    await startFor(user);
  }
  function fromRow(row, active, base) {
    return { id: row.id, name: row.name, active: !!active, base: base || 0, level: row.level, start: row.start_mmr, games: row.career_games, freeSince: active ? Date.now() : 0 };
  }
  function buildState(session, rows, cache) {
    var st;
    if (cache && cache.dirty && cache.S.sessionId === session.id) st = cache.S;      // unsynced local changes win
    else if (session.state && session.state.v === 4) st = session.state;
    else st = { v: 4, players: [], courts: session.court_modes.map(function (m) { return { mode: m }; }), live: [], done: [], adj: [], flex: session.flex, board: cache ? !!cache.S.board : false };
    st.sessionId = session.id;
    st.title = session.title;
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
    var cache = readCache();
    try {
      if (!(await DB.isAdmin(user.id))) {
        showGate('<h1>บัญชีนี้ยังไม่ใช่ผู้ดูแล</h1><p class="muted">' + esc(user.email || '') + ' เข้าสู่ระบบได้ แต่ยังไม่ได้รับสิทธิ์ผู้ดูแล ติดต่อเจ้าของระบบเพื่อเพิ่มสิทธิ์</p><button class="btn" data-act="logout">' + ic('logout') + 'ออกจากระบบ</button>');
        return;
      }
      var res = await Promise.all([DB.loadPlayers(), DB.openSession(), DB.loadClosedDays(30)]);
      var session = res[1];
      if (!session) {
        var modes = cache ? cache.S.courts.map(function (c) { return c.mode; }) : ['normal', 'normal', 'normal'];
        session = await DB.createSession(todayTitle(), modes, cache ? (cache.S.flex || 0) : 4);
      }
      S = buildState(session, res[0], cache);
      S.days = res[2];
      sync.dirty = !!(cache && cache.dirty && cache.S.sessionId === session.id);
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

  /* ---------- views ---------- */
  function teamHtml(c, ci, s, map, RT, st, p) {
    var t = c.t[s], cls = s ? 'tb' : 'ta', state = c.w == null ? '' : (c.w === s ? ' win' : ' lose');
    var names = t.map(function (id, i) {
      var pl = map[id], pos = { ci: ci, s: s, i: i };
      var r = Math.round(RT.R[id] || 1500);
      return '<button class="pl' + (sameSel(pos) ? ' sel' : '') + (!pl || !pl.active ? ' gone' : '') + '" data-act="pick" data-ci="' + ci + '" data-s="' + s + '" data-i="' + i + '" aria-label="เลือก ' + (pl ? esc(pl.name) : '') + ' เพื่อสลับ">' + (pl ? esc(pl.name) : '-') + '<small>MMR ' + r + ' · เล่น ' + (st.played[id] || 0) + '</small></button>';
    }).join('<span class="plus">+</span>');
    var avg = Math.round(((RT.R[t[0]] || 1500) + (RT.R[t[1]] || 1500)) / 2);
    var pct = Math.round((s ? 1 - p : p) * 100);
    return '<div class="team ' + cls + state + '"><span class="tlabel">ทีม ' + (s ? 'B' : 'A') + '</span>' + names +
      '<span class="tmeta" title="MMR เฉลี่ยของทีม · โอกาสชนะ">เฉลี่ย ' + avg + ' · ชนะ ' + pct + '%</span>' +
      '<button class="won' + (c.w === s ? ' on' : '') + '" data-act="win" data-ci="' + ci + '" data-s="' + s + '" aria-pressed="' + (c.w === s) + '">' + ic('check') + (c.w === s ? 'ชนะ' : 'ทีมนี้ชนะ') + '</button></div>';
  }
  function courtHtml(c, ci, map, RT, st, free) {
    var mode = S.courts[ci].mode;
    var head = '<div class="court-head"><span class="cname">สนาม ' + (ci + 1) + '</span>' +
      '<button class="modechip m-' + mode + '" data-act="mode" data-ci="' + ci + '" aria-label="โหมดสนาม ' + (ci + 1) + ': ' + MODE_LABEL[mode] + ' แตะเพื่อเปลี่ยน">' + MODE_LABEL[mode] + '</button>';
    if (!c) {
      return '<section class="court">' + head + '</div><div class="slot"><span>สนามว่าง</span><button class="btn sm primary" data-act="draw" data-ci="' + ci + '"' + (free >= 4 ? '' : ' disabled') + '>' + ic('shuffle') + 'สุ่มลงสนามนี้</button></div></section>';
    }
    var stale = A.isStale(S, c), m = mins(c.at);
    head += A.hasRes(c) ? '<span class="badge ready">เลือกผู้ชนะแล้ว กดบันทึก</span>' : '<span class="badge">เล่นมา ' + (m || 0) + ' นาที</span>';
    head += '</div>';
    var p = A.winProb(RT.R, c.t);
    var h = '<section class="court">' + head;
    if (stale) h += '<div class="note">มีคนในสนามนี้ปิดสถานะเล่นแล้ว แตะชื่อเพื่อสลับกับคนในคิว หรือกดสุ่มสนามนี้ใหม่</div>';
    h += '<div class="match">' + teamHtml(c, ci, 0, map, RT, st, p) + '<div class="vs"><span>VS</span></div>' + teamHtml(c, ci, 1, map, RT, st, p) + '</div>';
    h += '<div class="court-actions"><button class="btn sm" data-act="redraw" data-ci="' + ci + '">' + ic('shuffle') + 'สุ่มสนามนี้ใหม่</button>' +
      '<button class="btn sm primary" data-act="save" data-ci="' + ci + '"' + (A.hasRes(c) && !stale ? '' : ' disabled') + '>' + ic('check') + 'บันทึกผล</button></div>';
    return h + '</section>';
  }
  function fillState() {
    var empty = A.emptySlots(S).length, free = A.freeCount(S);
    if (!empty) return { label: 'ทุกสนามมีคนเล่นอยู่', dis: true };
    if (free < 4) return { label: 'คนรอคิวไม่ถึง 4 คน', dis: true };
    return { label: 'สุ่มลงสนามว่าง (' + Math.min(empty, Math.floor(free / 4)) + ')', dis: false };
  }
  function viewPlay() {
    var map = byId(), RT = A.ratings(S.done, S.players, S.adj), st = A.stats(S.done, S.players);
    var q = A.queueOrder(S, null), free = A.freeCount(S), fl = fillState();
    var h = '<div class="roundhead"><h2>สนาม</h2><span class="muted small" style="margin-right:auto">จบแล้ว ' + S.done.length + ' แมตช์ · รอคิว ' + q.length + ' คน</span>' +
      '<button class="btn primary fill-inline" data-act="fill"' + (fl.dis ? ' disabled' : '') + '>' + ic('shuffle') + fl.label + '</button></div>';
    if (ui.sel) h += '<div class="selbar"><span>' + ic('swap') + ' เลือก <b>' + esc(selName()) + '</b> แตะคนอื่นในสนามหรือคิวเพื่อสลับ</span><button class="btn sm" data-act="unsel">ยกเลิก</button></div>';
    if (activeCount() < 4) h += '<div class="note">ยังเช็กอินไม่ถึง 4 คน ไปที่แท็บผู้เล่นแล้ววางรายชื่อจากไลน์ หรือเปิดสวิตช์ทีละคน <button class="btn sm" data-act="tab" data-tab="people">' + ic('users') + 'ไปแท็บผู้เล่น</button></div>';
    h += '<div class="playgrid"><div class="courts">';
    S.live.forEach(function (c, ci) { h += courtHtml(c, ci, map, RT, st, free); });
    h += '</div><aside class="side"><div class="card"><div class="line"><h2>คิว</h2><span class="muted small">แตะชื่อเพื่อสลับกับคนในสนาม</span></div>';
    if (!q.length) h += '<span class="muted">ไม่มีคนรอ</span>';
    else {
      h += '<div class="qlist">';
      q.forEach(function (x, i) {
        if (i === 4) h += '<div class="qdiv">รอถัดไป</div>';
        var pl = map[x.id], w = mins(pl.freeSince);
        h += '<button class="qi' + (i < 4 ? ' next' : '') + (sameSel({ id: x.id }) ? ' sel' : '') + '" data-act="pickq" data-id="' + x.id + '"><span class="pos">' + (i + 1) + '</span><b>' + esc(pl.name) + '</b><span class="meta">เล่น ' + (st.played[x.id] || 0) + (w != null ? ' · รอ ' + w + ' นาที' : '') + '</span></button>';
      });
      h += '</div>';
    }
    return h + '</div></aside></div>';
  }
  function viewPeople() {
    var st = A.stats(S.done, S.players), RT = A.ratings(S.done, S.players, S.adj), on = {};
    A.liveIds(S).forEach(function (id) { on[id] = 1; });
    var h = '<div class="card"><h2>เช็กอินวันนี้</h2><form class="add" id="addForm" autocomplete="off">' +
      '<textarea id="nameIn" rows="4" placeholder="วางรายชื่อจากไลน์ได้เลย (1. ชิน 2. โฟล์ค ...) คนที่มีในระบบจะถูกเช็กอิน คนใหม่จะถูกเพิ่ม" aria-label="รายชื่อ"></textarea>' +
      '<div class="line"><span class="muted small">คนมาสายนับจำนวนแมตช์เริ่มเท่าคนที่เล่นน้อยสุด</span><button class="btn primary" type="submit">' + ic('plus') + 'เช็กอิน / เพิ่ม</button></div></form></div>';
    h += '<div class="card"><div class="line"><h2>สมาชิก (' + S.players.length + ')</h2><span class="muted small">มาวันนี้ ' + activeCount() + ' คน</span></div>' +
      '<div class="line"><span class="muted small">สวิตช์ = มาวันนี้</span><span style="display:flex;gap:8px"><button class="btn sm" data-act="checkall">เช็กอินทุกคน</button><button class="btn sm" data-act="checknone">ยกเลิกทั้งหมด</button></span></div>';
    if (!S.players.length) h += '<span class="muted">ยังไม่มีสมาชิก</span>';
    S.players.forEach(function (p) {
      var canDel = st.played[p.id] === 0 && !on[p.id];
      h += '<div class="row' + (p.active ? '' : ' off') + '"><div class="who"><b>' + esc(p.name) + '</b><span>เล่น ' + st.played[p.id] + ' · MMR ' + Math.round(RT.R[p.id]) + '</span></div>' +
        '<select class="lvl" data-act="level" data-id="' + p.id + '" aria-label="ระดับของ ' + esc(p.name) + '">' + ['N', 'I', 'A'].map(function (l) { return '<option value="' + l + '"' + ((p.level || 'I') === l ? ' selected' : '') + '>' + LV_LABEL[l] + '</option>'; }).join('') + '</select>' +
        '<label class="sw"><input type="checkbox" data-act="toggle" data-id="' + p.id + '"' + (p.active ? ' checked' : '') + ' aria-label="มาวันนี้ ' + esc(p.name) + '"><span class="track"></span></label>' +
        (canDel ? '<button class="icon" data-act="remove" data-id="' + p.id + '" aria-label="ลบ ' + esc(p.name) + ' ออกจากสมาชิก">' + ic('trash') + '</button>' : '<span></span>') + '</div>';
    });
    h += '<p class="muted small">ระดับใช้ตั้ง MMR เริ่มต้น: มือใหม่ 1300 · กลาง 1500 · เก่ง 1700 · ลบสมาชิกแล้วประวัติเดิมยังอยู่ในระบบ</p>';
    return h + '</div>';
  }
  function viewRank() {
    var RT = A.ratings(S.done, S.players, S.adj);
    var list = S.players.filter(function (p) { return p.active || RT.G[p.id] > 0; });
    list.sort(function (a, b) { return RT.R[b.id] - RT.R[a.id] || RT.G[b.id] - RT.G[a.id] || a.id - b.id; });
    var h = '<div class="card"><h2>อันดับ MMR</h2><p class="muted small">ผลวันนี้ ' + S.done.length + ' แมตช์ · ตัวเลขเล็กคือเปลี่ยนไปเท่าไรวันนี้ · "ยังไม่นิ่ง" คือเล่นไม่ถึง 10 แมตช์ คะแนนจะขยับเร็วกว่า</p></div>';
    h += '<div class="card"><div class="rklist">';
    if (!list.length) h += '<span class="muted">ยังไม่มีคนเช็กอิน</span>';
    list.forEach(function (p, i) {
      var g = RT.G[p.id], w = RT.W[p.id], rt = Math.round(RT.R[p.id]);
      if (ui.editId === p.id) {
        h += '<div class="rk compact" style="grid-template-columns:1fr"><b>' + esc(p.name) + '</b><form class="mmr-edit" id="mmrForm" data-id="' + p.id + '" autocomplete="off"><input class="field" id="mmrIn" type="number" inputmode="numeric" min="0" max="5000" step="1" value="' + rt + '" aria-label="MMR ของ ' + esc(p.name) + '"><button class="btn primary" type="submit">บันทึก</button><button class="btn" type="button" data-act="edit-cancel">ยกเลิก</button></form></div>';
        return;
      }
      h += '<div class="rk' + (i < 3 ? ' podium' : '') + '"><span class="pos">' + (i + 1) + '</span>' +
        '<div class="who"><b>' + esc(p.name) + (RT.C[p.id] < 10 ? '<span class="prov">ยังไม่นิ่ง</span>' : '') + '</b><span>' + LV_LABEL[p.level || 'I'] + ' · ชนะ ' + w + ' แพ้ ' + (g - w) + (p.active ? '' : ' · กลับแล้ว') + '</span></div>' +
        '<div class="score"><b>' + rt + '</b><span>' + fmtDelta(rt - A.startOf(p)) + '</span></div>' +
        '<button class="icon" data-act="edit-mmr" data-id="' + p.id + '" aria-label="แก้ MMR ของ ' + esc(p.name) + '">' + ic('pencil') + '</button></div>';
    });
    h += '</div></div>';
    h += '<button class="btn' + (ui.confirm === 'rank' ? ' danger' : '') + '" data-act="rank-reset" style="justify-self:start">' + (ui.confirm === 'rank' ? 'กดอีกครั้งเพื่อยืนยัน' : 'รีเซ็ต MMR ตามระดับ') + '</button>';
    return h;
  }
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
    var h = '<div class="card span"><div class="facts">' +
      '<div class="fact"><b>' + S.done.length + '</b><span>แมตช์ที่จบวันนี้</span></div>' +
      '<div class="fact"><b>' + spread + '</b><span>แมตช์ต่างกันสูงสุด</span></div>' +
      '<div class="fact"><b>' + (pmax > 1 ? pmax : 0) + '</b><span>คู่เดิมซ้ำสูงสุด</span></div></div></div>';
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
          '<div class="acts"><button class="btn" data-act="hflip" data-i="' + i + '">' + ic('swap') + 'สลับผู้ชนะ</button><button class="btn" data-act="hdel" data-i="' + i + '">' + ic('trash') + 'ลบแมตช์นี้</button></div></div>';
      }
      h += '</div></details></div>';
    }
    if (S.days.length) {
      h += '<div class="card span"><h2>เกมที่จบแล้ว (' + S.days.length + ')</h2>';
      for (var di = S.days.length - 1; di >= 0; di--) {
        var d = S.days[di];
        h += '<details><summary><span>' + esc(d.label) + ' · ' + d.count + ' แมตช์</span>' + ic('chev') + '</summary><div class="hist">';
        d.players.forEach(function (r, ri) {
          h += '<div class="rk compact' + (ri < 3 ? ' podium' : '') + '"><span class="pos">' + (ri + 1) + '</span><div class="who"><b>' + esc(r.name) + '</b><span>เล่น ' + r.played + ' · ชนะ ' + r.win + ' · แพ้ ' + (r.played - r.win) + '</span></div><div class="score"><b>' + r.mmr + '</b><span>' + fmtDelta(r.mmr - r.start) + '</span></div></div>';
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
  function viewSettings() {
    var h = '<div class="card"><div class="line"><div><h2>จำนวนสนาม</h2><span class="muted small">สนามละ 4 คน · มาวันนี้ ' + activeCount() + ' คน</span></div>' +
      '<div class="stepper"><button class="sq" data-act="courts-" aria-label="ลดสนาม"' + (S.courts.length <= 1 ? ' disabled' : '') + '>' + ic('minus') + '</button><span class="val">' + S.courts.length + '</span><button class="sq" data-act="courts+" aria-label="เพิ่มสนาม"' + (S.courts.length >= 10 ? ' disabled' : '') + '>' + ic('plus') + '</button></div></div></div>';
    h += '<div class="card"><h2>โหมดแต่ละสนาม</h2>';
    S.courts.forEach(function (c, ci) {
      h += '<div class="line"><span>สนาม ' + (ci + 1) + '</span><div class="seg" role="group" aria-label="โหมดสนาม ' + (ci + 1) + '">' + MODE_ORDER.map(function (m) { return '<button class="' + (c.mode === m ? 'on' : '') + '" data-act="setmode" data-ci="' + ci + '" data-mode="' + m + '" aria-pressed="' + (c.mode === m) + '">' + MODE_LABEL[m] + '</button>'; }).join('') + '</div></div>';
    });
    h += '<div class="legend"><span><b class="m-normal">ปกติ</b> จัดตามคิว ทีมสูสีพอประมาณ</span><span><b class="m-competitive">แข่งขัน</b> 4 คนระดับใกล้กัน จับเก่งสุดกับอ่อนสุดเป็นทีม</span><span><b class="m-social">สังสรรค์</b> ผสมคนเก่งกับมือใหม่ นับ MMR ครึ่งเดียว</span></div></div>';
    h += '<div class="card"><div class="line"><div><h2>ความยืดหยุ่นของคิว</h2><span class="muted small">สนามแข่งขันและสังสรรค์เลือกจากคิวเพิ่มได้อีกกี่คน</span></div>' +
      '<div class="seg" role="group" aria-label="ความยืดหยุ่นของคิว">' + [0, 2, 4, 6].map(function (n) { return '<button class="' + ((S.flex || 0) === n ? 'on' : '') + '" data-act="flex" data-n="' + n + '" aria-pressed="' + ((S.flex || 0) === n) + '">' + n + '</button>'; }).join('') + '</div></div>' +
      '<p class="muted small">0 = ตามคิวเป๊ะ · ยิ่งมาก ระดับยิ่งใกล้ แต่บางคนอาจรอนานขึ้นนิดหน่อย คนที่เล่นน้อยกว่ายังได้ก่อนเสมอ</p></div>';
    h += '<div class="card"><div class="line"><div><h2>โหมดจอใหญ่</h2><span class="muted small">ตัวใหญ่ ซ่อนปุ่ม ไว้วางโชว์ข้างสนาม</span></div><label class="sw"><input type="checkbox" data-act="boardsw"' + (S.board ? ' checked' : '') + ' aria-label="โหมดจอใหญ่"><span class="track"></span></label></div></div>';
    h += '<div class="card"><h2>จัดการเกม</h2>' +
      '<button class="btn' + (ui.confirm === 'end' ? ' danger' : ' primary') + '" data-act="end">' + ic('flag') + (ui.confirm === 'end' ? 'กดอีกครั้งเพื่อจบเกมวันนี้' : 'จบเกมวันนี้และเก็บสถิติ') + '</button>' +
      '<p class="muted small">บันทึกแมตช์และอันดับขึ้นระบบ ยก MMR ไปใช้ครั้งหน้า แล้วเปิดเกมใหม่ให้ ต้องออนไลน์ สนามที่ยังไม่บันทึกผลจะไม่ถูกนับ</p>' +
      '<button class="btn' + (ui.confirm === 'reset' ? ' danger' : '') + '" data-act="reset">' + ic('trash') + (ui.confirm === 'reset' ? 'กดอีกครั้งเพื่อล้างและรีเซ็ต MMR' : 'เริ่มเกมใหม่ (รีเซ็ต MMR)') + '</button>' +
      '<p class="muted small">ล้างแมตช์ของเกมนี้โดยไม่เก็บ และตั้ง MMR ทุกคนกลับตามระดับ เกมที่จบแล้วยังอยู่ กดย้อนกลับได้</p></div>';
    h += '<div class="card"><h2>นำเข้าจากแอปเดิม</h2><p class="muted small">วางข้อมูลจากปุ่ม "คัดลอกข้อมูลสำรอง" ของแอปเดิม ระบบจะจับคู่ชื่อ เพิ่มคนที่ยังไม่มี และนำแมตช์เข้าเกมนี้ ทำได้เมื่อเกมนี้ยังไม่มีแมตช์</p>' +
      '<form id="importForm" class="add" autocomplete="off"><textarea id="impText" rows="3" placeholder="วางข้อมูลสำรองที่นี่" aria-label="ข้อมูลสำรองจากแอปเดิม"></textarea><button class="btn" type="submit"' + (S.done.length ? ' disabled' : '') + '>นำเข้า</button></form></div>';
    h += '<div class="card"><div class="line"><div><h2>บัญชี</h2><span class="muted small">' + esc(ui.user && ui.user.email || '') + '</span></div><button class="btn" data-act="logout">' + ic('logout') + 'ออกจากระบบ</button></div></div>';
    return h;
  }
  function dockHtml() {
    var f = fillState();
    return '<div class="dock-in"><button class="btn primary" data-act="fill"' + (f.dis ? ' disabled' : '') + '>' + ic('shuffle') + f.label + '</button></div>';
  }
  function renderToast() {
    var el = $('toast');
    if (!ui.toast) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.classList.toggle('lift', ui.tab === 'play' && !S.board);
    el.innerHTML = '<span>' + esc(ui.toast.msg) + '</span>' + (ui.toast.snap ? '<button data-act="undo">' + ic('undo') + 'ย้อนกลับ</button>' : '');
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
    renderToast(); renderStatus();
    var old = document.querySelector('.busy'); if (old) old.remove();
    if (ui.busy) { var b = document.createElement('div'); b.className = 'busy'; b.innerHTML = '<div>' + esc(ui.busy) + '</div>'; document.body.appendChild(b); }
    if (ui.tab === 'rank' && ui.editId != null) { var mi = $('mmrIn'); if (mi) { mi.focus(); mi.select(); } }
  }
  function toast(msg, snap) {
    ui.toast = { msg: msg, snap: snap || null };
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
    changed();
    toast('เช็กอิน ' + checked + ' คน · เพิ่มใหม่ ' + added + ' คน' + (failed.length ? ' · เพิ่มไม่ได้: ' + failed.join(', ') + ' (ต้องออนไลน์)' : ''), null);
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
      await DB.closeSession(S.sessionId, A.carryForward(S));
      var snap = A.endGame(S, S.title || todayTitle());
      var ns = await DB.createSession(todayTitle(), S.courts.map(function (c) { return c.mode; }), S.flex || 0);
      S.sessionId = ns.id; S.title = ns.title;
      S.players.forEach(function (p) { p.active = false; });
      changed();
      try { S.days = await DB.loadClosedDays(30); } catch (e) { }
      toast('จบเกมแล้ว บันทึก ' + snap.count + ' แมตช์ขึ้นระบบ', null);
    } catch (e) {
      toast('จบเกมไม่สำเร็จ: ' + errMsg(e) + ' ข้อมูลยังอยู่ ลองใหม่เมื่อออนไลน์', null);
    }
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
    if (!S) return;
    var ci = +t.dataset.ci, before = JSON.stringify(S), msg = null, snap = before;
    if (a !== 'undo' && a !== 'tab') ui.toast = null;
    if (a === 'tab') { ui.tab = t.dataset.tab; ui.confirm = null; ui.editId = null; ui.sel = null; try { window.scrollTo(0, 0); } catch (x) { } }
    else if (a === 'sync') { if (sync.dirty) runSync(); }
    else if (a === 'board') { S.board = !S.board; ui.sel = null; }
    else if (a === 'undo') { if (ui.toast && ui.toast.snap) { var keepDays = S.days; S = JSON.parse(ui.toast.snap); S.days = keepDays; A.normalize(S); ui.sel = null; } ui.toast = null; }
    else if (a === 'win') { var c = S.live[ci], s = +t.dataset.s; if (c) c.w = c.w === s ? null : s; }
    else if (a === 'save') { if (A.saveResult(S, ci)) msg = 'บันทึกผลสนาม ' + (ci + 1) + ' แล้ว สนามว่าง รอสุ่มคู่ใหม่'; ui.sel = null; }
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
        if (A.swapPos(S, ui.sel, pos)) { var n2 = byId()[pos.id != null ? pos.id : S.live[pos.ci].t[pos.s][pos.i]]; msg = 'สลับ ' + n1 + ' กับ ' + (n2 ? n2.name : '') + ' แล้ว'; }
        ui.sel = null;
      }
    }
    else if (a === 'courts+') { A.setCourtCount(S, S.courts.length + 1); }
    else if (a === 'courts-') { A.setCourtCount(S, S.courts.length - 1); msg = 'ลดเหลือ ' + S.courts.length + ' สนาม'; }
    else if (a === 'checkall') { S.players.forEach(function (p) { if (!p.active) setActive(p.id, true); }); msg = 'เช็กอินทุกคนแล้ว'; }
    else if (a === 'checknone') { S.players.forEach(function (p) { p.active = false; }); msg = 'ยกเลิกเช็กอินทุกคนแล้ว'; }
    else if (a === 'remove') { removePlayer(+t.dataset.id); return; }
    else if (a === 'edit-mmr') ui.editId = +t.dataset.id;
    else if (a === 'edit-cancel') ui.editId = null;
    else if (a === 'rank-reset') { if (confirmTap('rank')) { S.players.forEach(function (p) { S.adj.push({ at: S.done.length, id: p.id, to: A.LV[p.level || 'I'] }); }); msg = 'รีเซ็ต MMR ตามระดับแล้ว'; } }
    else if (a === 'hflip') { var m = S.done[+t.dataset.i]; if (m) { m.w = 1 - m.w; msg = 'สลับผู้ชนะแมตช์ ' + (+t.dataset.i + 1) + ' แล้ว คิด MMR ใหม่ให้แล้ว'; } }
    else if (a === 'hdel') { var di = +t.dataset.i; S.done.splice(di, 1); S.adj.forEach(function (x) { if (x.at > di) x.at--; }); msg = 'ลบแมตช์แล้ว'; }
    else if (a === 'end') { if (confirmTap('end')) { endDay(); return; } }
    else if (a === 'reset') { if (confirmTap('reset')) { A.resetGame(S); msg = 'เริ่มเกมใหม่แล้ว MMR กลับตามระดับ'; } }
    if (msg) toast(msg, snap);
    if (JSON.stringify(S) !== before) changed();
    render();
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !S) return;
    var a = t.dataset.act;
    if (a === 'toggle') setActive(+t.dataset.id, t.checked);
    else if (a === 'level') { var p = A.findP(S, +t.dataset.id); if (p) { p.level = t.value; p.start = A.LV[t.value]; } }
    else if (a === 'boardsw') S.board = t.checked;
    else return;
    changed(); render();
  });
  document.addEventListener('submit', async function (e) {
    var f = e.target; e.preventDefault();
    if (f.id === 'loginForm') {
      var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ…';
      try { var u = await DB.signIn($('email').value.trim(), $('password').value); await startFor(u); }
      catch (err) { showGate(loginHtml('เข้าสู่ระบบไม่ได้: ' + errMsg(err))); }
      return;
    }
    if (!S) return;
    if (f.id === 'addForm') { await checkIn($('nameIn').value); }
    else if (f.id === 'importForm') { await importOld($('impText').value); }
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
  try { $('date').textContent = thaiDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { }
  boot();
})();
