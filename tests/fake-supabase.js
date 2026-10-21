/* In-memory stand-in for supabase-js, used only by tests/smoke.js. Mirrors the SQL functions in
   supabase/migrations closely enough to exercise the app: tables, inserts, filters, the
   sync_session and close_session RPCs, and email/password sign-in. Data persists in localStorage
   so a page reload can be tested. Set window.__fakeOffline = true to make every call fail. */
(function () {
  var KEY = 'fake-supabase-db';
  var names = ['ชิน', 'โฟล์ค', 'เดือน', 'นัทซ้าย', 'เปตอง', 'ป๊อป', 'Ard', 'ภู', 'กร', 'ตรัย', 'บีม', 'Yiip', 'ตั้ง'];
  function fresh() {
    return {
      seq: { players: names.length, sessions: 0, matches: 0, clubs: 1 }, auth: null,
      users: [{ id: 'u1', email: 'admin@example.com' }],
      clubs: [{ id: 1, name: 'ก๊วนแบด' }],
      club_admins: [{ club_id: 1, user_id: 'u1' }],
      players: names.map(function (n, i) { return { id: i + 1, club_id: 1, name: n, level: 'I', start_mmr: 1500, start_sigma: null, aliases: [], career_games: 0, active: true }; }),
      sessions: [], session_players: [], matches: [], match_players: [], rating_adjustments: []
    };
  }
  var db = JSON.parse(localStorage.getItem(KEY) || 'null') || fresh();
  function persist() { localStorage.setItem(KEY, JSON.stringify(db)); }
  window.__fakeDb = function () { return db; };
  window.__rpcLog = [];
  function fail(msg, code) { var e = new Error(msg); e.code = code; throw e; }
  function offline() { if (window.__fakeOffline) fail('Failed to fetch'); }
  function today() { return new Date().toISOString().slice(0, 10); }

  function query(table) {
    var st = { filters: [], order: [], lim: null, op: 'select', payload: null, single: false, sel: '*' };
    var api = {
      select: function (c) { st.sel = c || '*'; if (st.op !== 'select') st.returning = true; return api; },
      eq: function (c, v) { st.filters.push(function (r) { return r[c] === v; }); return api; },
      in: function (c, vs) { st.filters.push(function (r) { return vs.indexOf(r[c]) >= 0; }); return api; },
      order: function (c, o) { st.order.push([c, o && o.ascending === false ? -1 : 1]); return api; },
      limit: function (n) { st.lim = n; return api; },
      insert: function (p) { st.op = 'insert'; st.payload = p; return api; },
      update: function (p) { st.op = 'update'; st.payload = p; return api; },
      single: function () { st.single = true; return api; },
      then: function (ok) {
        try { offline(); var data = exec(); persist(); ok({ data: data, error: null }); }
        catch (e) { ok({ data: null, error: { message: e.message, code: e.code } }); }
      }
    };
    function exec() {
      var rows = db[table];
      var me = db.auth && db.auth.user.id;
      var mine = db.club_admins.filter(function (x) { return x.user_id === me; }).map(function (x) { return x.club_id; });
      // row level security, roughly: clubs and club-owned rows are visible only to that club's admins
      if (table === 'clubs' || table === 'players' || table === 'sessions') {
        var col = table === 'clubs' ? 'id' : 'club_id';
        rows = rows.filter(function (r) { return mine.indexOf(r[col]) >= 0; });
        if (st.op === 'insert') rows = db[table];
      }
      if (st.op === 'insert') {
        var list = Array.isArray(st.payload) ? st.payload : [st.payload];
        var out = list.map(function (p) {
          var r = JSON.parse(JSON.stringify(p));
          if (table === 'players') {
            if (mine.indexOf(r.club_id) < 0) fail('new row violates row-level security policy for table "players"', '42501');
            if (db.players.some(function (x) { return x.club_id === r.club_id && x.name.toLowerCase() === r.name.toLowerCase(); })) fail('duplicate key value violates unique constraint "players_club_name_key"', '23505');
            r = Object.assign({ level: 'I', start_mmr: 1500, start_sigma: null, aliases: [], career_games: 0, active: true }, r);
          }
          if (table === 'sessions') {
            if (mine.indexOf(r.club_id) < 0) fail('new row violates row-level security policy for table "sessions"', '42501');
            if ((r.status || 'open') === 'open' && db.sessions.some(function (s) { return s.club_id === r.club_id && s.status === 'open'; })) fail('duplicate key value violates unique constraint "sessions_one_open"', '23505');
            r = Object.assign({ status: 'open', court_modes: ['normal', 'normal', 'normal'], flex: 4, state: null, played_on: today(), started_at: new Date().toISOString(), ended_at: null }, r);
            r.court_count = r.court_modes.length;
          }
          if (db.seq[table] != null) r.id = ++db.seq[table];
          rows.push(r); return r;
        });
        return st.single ? out[0] : out;
      }
      var hit = rows.filter(function (r) { return st.filters.every(function (f) { return f(r); }); });
      if (st.op === 'update') {
        hit.forEach(function (r) { Object.assign(r, st.payload); });
        if (!st.returning) return null;
        var copy = JSON.parse(JSON.stringify(hit));
        return st.single ? copy[0] : copy;
      }
      hit = hit.slice();
      st.order.slice().reverse().forEach(function (o) { hit.sort(function (a, b) { return (a[o[0]] > b[o[0]] ? 1 : a[o[0]] < b[o[0]] ? -1 : 0) * o[1]; }); });
      if (st.lim != null) hit = hit.slice(0, st.lim);
      hit = JSON.parse(JSON.stringify(hit));
      if (table === 'matches' && st.sel.indexOf('match_players(') >= 0) {
        hit.forEach(function (m) { m.match_players = db.match_players.filter(function (mp) { return mp.match_id === m.id; }); });
      }
      return st.single ? hit[0] : hit;
    }
    return api;
  }

  function rpc(name, a) {
    return new Promise(function (ok) {
      try {
        offline();
        window.__rpcLog.push({ name: name, args: JSON.parse(JSON.stringify(a)) });
        var me = db.auth && db.auth.user.id;
        if (name === 'create_club') {
          if (!db.club_admins.some(function (x) { return x.user_id === me; })) fail('only club admins can create clubs', '42501');
          if (!(a.p_name || '').trim()) fail('name required', '22023');
          var cid = ++db.seq.clubs;
          db.clubs.push({ id: cid, name: a.p_name.trim() }); db.club_admins.push({ club_id: cid, user_id: me });
          persist(); ok({ data: cid, error: null }); return;
        }
        if (name === 'leave_club' || name === 'delete_club') {
          var cl = a.p_club_id, mineAll = db.club_admins.filter(function (x) { return x.user_id === me; });
          if (!mineAll.some(function (x) { return x.club_id === cl; })) fail('not a club admin', '42501');
          if (mineAll.length <= 1) fail('only_club', 'P0001');
          if (name === 'leave_club') {
            if (db.club_admins.filter(function (x) { return x.club_id === cl; }).length <= 1) fail('last_admin', 'P0001');
            db.club_admins = db.club_admins.filter(function (x) { return !(x.club_id === cl && x.user_id === me); });
          } else {
            var club = db.clubs.filter(function (c) { return c.id === cl; })[0];
            if (!club || club.name !== (a.p_name || '').trim()) fail('name_mismatch', 'P0001');
            var sids = db.sessions.filter(function (x) { return x.club_id === cl; }).map(function (x) { return x.id; });
            var mids = db.matches.filter(function (m) { return sids.indexOf(m.session_id) >= 0; }).map(function (m) { return m.id; });
            db.match_players = db.match_players.filter(function (x) { return mids.indexOf(x.match_id) < 0; });
            db.matches = db.matches.filter(function (m) { return mids.indexOf(m.id) < 0; });
            ['session_players', 'rating_adjustments'].forEach(function (t) { db[t] = db[t].filter(function (x) { return sids.indexOf(x.session_id) < 0; }); });
            db.sessions = db.sessions.filter(function (x) { return x.club_id !== cl; });
            db.players = db.players.filter(function (x) { return x.club_id !== cl; });
            db.club_admins = db.club_admins.filter(function (x) { return x.club_id !== cl; });
            db.clubs = db.clubs.filter(function (c) { return c.id !== cl; });
          }
          persist(); ok({ data: null, error: null }); return;
        }
        var s = db.sessions.filter(function (x) { return x.id === a.p_session_id && x.status === 'open'; })[0];
        if (!s) fail('session ' + a.p_session_id + ' is not open', 'P0002');
        if (name === 'sync_session') {
          s.state = a.p_state; s.court_modes = a.p_court_modes; s.court_count = a.p_court_modes.length; s.flex = a.p_flex;
          a.p_players.forEach(function (r) { var p = db.players.filter(function (x) { return x.id === r.id; })[0]; if (p) { p.level = r.level; p.start_mmr = r.start_mmr; p.career_games = r.career_games; } });
          db.session_players = db.session_players.filter(function (x) { return x.session_id !== s.id; })
            .concat(a.p_players.filter(function (r) { return r.in_session; }).map(function (r) { return { session_id: s.id, player_id: r.id, base: r.base, active: r.active }; }));
          var old = db.matches.filter(function (m) { return m.session_id === s.id; }).map(function (m) { return m.id; });
          db.matches = db.matches.filter(function (m) { return m.session_id !== s.id; });
          db.match_players = db.match_players.filter(function (mp) { return old.indexOf(mp.match_id) < 0; });
          a.p_matches.forEach(function (m) {
            var id = ++db.seq.matches;
            db.matches.push({ id: id, session_id: s.id, seq: m.seq, court: m.court, mode: m.mode, team_a: m.a, team_b: m.b, winner: m.w, started_at: m.started_at, ended_at: m.ended_at });
            m.players.forEach(function (x) { db.match_players.push({ match_id: id, player_id: x.id, team: x.team, won: x.won, rating_before: x.before, rating_after: x.after }); });
          });
          db.rating_adjustments = db.rating_adjustments.filter(function (x) { return x.session_id !== s.id; })
            .concat(a.p_adjustments.map(function (x) { return { session_id: s.id, player_id: x.id, at_seq: x.at, to_mmr: x.to }; }));
        } else if (name === 'close_session') {
          a.p_players.forEach(function (r) { var p = db.players.filter(function (x) { return x.id === r.id; })[0]; if (p) { p.start_mmr = r.start_mmr; p.start_sigma = r.start_sigma; p.career_games = r.career_games; } });
          s.status = 'closed'; s.ended_at = new Date().toISOString(); s.played_on = today(); s.state = null;
        } else fail('unknown rpc ' + name);
        persist(); ok({ data: null, error: null });
      } catch (e) { ok({ data: null, error: { message: e.message, code: e.code } }); }
    });
  }

  window.supabase = {
    createClient: function () {
      return {
        from: query,
        rpc: rpc,
        functions: {
          invoke: function (name, o) {
            var b = o.body || {}, me = db.auth && db.auth.user.id, club = b.club_id;
            var bad = function (code) { return Promise.resolve({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: function () { return Promise.resolve({ error: code }); } } } }); };
            if (name !== 'manage-admins' || !me) return bad('not_signed_in');
            var inClub = function (uid, cid) { return db.club_admins.some(function (x) { return x.user_id === uid && x.club_id === cid; }); };
            if (!inClub(me, club)) return bad('not_admin');
            var user = function (id) { return db.users.filter(function (u) { return u.id === id; })[0] || {}; };
            var out = function (extra) { return Object.assign({ admins: db.club_admins.filter(function (x) { return x.club_id === club; }).map(function (x) { return { id: x.user_id, email: user(x.user_id).email || '', me: x.user_id === me, last_sign_in_at: null }; }) }, extra || {}); };
            var only = function (uid) { return db.club_admins.filter(function (x) { return x.user_id === uid; }).every(function (x) { return inClub(me, x.club_id); }); };
            var created = false;
            if (b.action === 'add') {
              var hit = db.users.filter(function (u) { return u.email === b.email; })[0];
              if (!hit) { if ((b.password || '').length < 8) return bad('short_password'); hit = { id: 'u' + (db.users.length + 1), email: b.email, password: b.password }; db.users.push(hit); created = true; }
              if (!inClub(hit.id, club)) db.club_admins.push({ club_id: club, user_id: hit.id });
            } else if (b.action === 'remove') {
              if (b.id === me) return bad('cannot_remove_self');
              if (db.club_admins.filter(function (x) { return x.club_id === club; }).length <= 1) return bad('last_admin');
              db.club_admins = db.club_admins.filter(function (x) { return !(x.user_id === b.id && x.club_id === club); });
            } else if (b.action === 'reset') {
              if ((b.password || '').length < 8) return bad('short_password');
              if (!inClub(b.id, club)) return bad('not_admin_target');
              if (!only(b.id)) return bad('other_club_admin');
              user(b.id).password = b.password;
            } else if (b.action !== 'list') return bad('unknown_action');
            persist(); return Promise.resolve({ data: out({ created: created }), error: null });
          }
        },
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: db.auth } }); },
          signInWithPassword: function (c) {
            if (c.password !== 'correct-horse') return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
            var u = db.users.filter(function (x) { return x.email === c.email; })[0];
            if (!u) { u = { id: 'u' + (db.users.length + 1), email: c.email }; db.users.push(u); }
            db.auth = { user: { id: u.id, email: u.email } }; persist();
            return Promise.resolve({ data: { user: db.auth.user }, error: null });
          },
          signOut: function () { db.auth = null; persist(); return Promise.resolve({ error: null }); },
          resetPasswordForEmail: function (email, o) { window.__resetRequests = (window.__resetRequests || []).concat([{ email: email, redirectTo: o && o.redirectTo }]); return Promise.resolve({ data: {}, error: null }); },
          updateUser: function (u) { if (!db.auth) return Promise.resolve({ data: null, error: { message: 'Auth session missing!' } }); db.passwordChanged = u.password; persist(); return Promise.resolve({ data: { user: db.auth.user }, error: null }); }
        }
      };
    }
  };
})();
