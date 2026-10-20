/* Thin wrapper around Supabase. Every function throws on error so callers can show it. */
(function (root) {
  'use strict';
  var c = null;

  function must(res) {
    if (res.error) { var e = new Error(res.error.message || 'Database error'); e.code = res.error.code; throw e; }
    return res.data;
  }
  function iso(ms) { return ms ? new Date(ms).toISOString() : null; }

  var DB = {
    init: function () {
      var cfg = root.APP_CONFIG;
      c = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return c;
    },
    client: function () { return c; },

    /* auth */
    getUser: async function () { var r = await c.auth.getSession(); return r.data.session ? r.data.session.user : null; },
    signIn: async function (email, password) { return must(await c.auth.signInWithPassword({ email: email, password: password })).user; },
    signOut: async function () { await c.auth.signOut(); },
    isAdmin: async function (uid) {
      var rows = must(await c.from('admins').select('user_id').eq('user_id', uid).limit(1));
      return rows.length > 0;
    },

    /* players */
    loadPlayers: async function () {
      return must(await c.from('players').select('id,name,level,start_mmr,career_games,active').order('id'));
    },
    addPlayer: async function (name, level) {
      return must(await c.from('players').insert({ name: name, level: level || 'I' }).select('id,name,level,start_mmr,career_games,active').single());
    },
    setPlayerActive: async function (id, active) {
      must(await c.from('players').update({ active: active }).eq('id', id));
    },

    /* sessions */
    openSession: async function () {
      var rows = must(await c.from('sessions').select('*').eq('status', 'open').order('started_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    createSession: async function (title, courtModes, flex) {
      return must(await c.from('sessions').insert({
        title: title, court_count: courtModes.length, court_modes: courtModes, flex: flex
      }).select('*').single());
    },
    sync: async function (sessionId, p) {
      return must(await c.rpc('sync_session', {
        p_session_id: sessionId, p_state: p.state, p_court_modes: p.court_modes, p_flex: p.flex,
        p_players: p.players, p_matches: p.matches, p_adjustments: p.adjustments
      }));
    },
    closeSession: async function (sessionId, carry) {
      must(await c.rpc('close_session', { p_session_id: sessionId, p_players: carry }));
    },

    /* past sessions, oldest first, in the same shape the app keeps in S.days */
    loadClosedDays: async function (limit) {
      var sess = must(await c.from('sessions').select('id,title,played_on,ended_at,state')
        .eq('status', 'closed').order('played_on', { ascending: false }).order('id', { ascending: false }).limit(limit || 30));
      if (!sess.length) return [];
      var ids = sess.map(function (s) { return s.id; });
      var ms = must(await c.from('matches')
        .select('id,session_id,seq,court,mode,team_a,team_b,winner,match_players(player_id,won,rating_before,rating_after)')
        .in('session_id', ids).order('seq'));
      var names = {};
      must(await c.from('players').select('id,name')).forEach(function (p) { names[p.id] = p.name; });
      var nm = function (id) { return names[id] || '-'; };
      return sess.reverse().map(function (s) {
        if (s.state && s.state.importedDay) return s.state.importedDay;
        var list = ms.filter(function (m) { return m.session_id === s.id; });
        var agg = {};
        list.forEach(function (m) {
          (m.match_players || []).forEach(function (mp) {
            var a = agg[mp.player_id] || (agg[mp.player_id] = { name: nm(mp.player_id), played: 0, win: 0, start: null, mmr: null });
            a.played++; if (mp.won) a.win++;
            if (a.start == null && mp.rating_before != null) a.start = Math.round(+mp.rating_before);
            if (mp.rating_after != null) a.mmr = Math.round(+mp.rating_after);
          });
        });
        var rows = Object.keys(agg).map(function (k) { var a = agg[k]; if (a.start == null) a.start = 1500; if (a.mmr == null) a.mmr = a.start; return a; })
          .sort(function (a, b) { return b.mmr - a.mmr; });
        var label = s.title;
        try { label = new Date(s.played_on + 'T12:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { }
        return {
          ts: s.ended_at ? Date.parse(s.ended_at) : 0, label: label, count: list.length, players: rows,
          matches: list.map(function (m) { return { t: [m.team_a.map(nm), m.team_b.map(nm)], w: m.winner, mode: m.mode }; })
        };
      });
    },

    /* imports a day that was finished in the old single-page app (names only, no ratings trail) */
    importClosedDay: async function (day, idByName) {
      var s = must(await c.from('sessions').insert({
        title: day.label + ' (นำเข้า)', status: 'closed', ended_at: iso(day.ts) || new Date().toISOString(),
        state: { importedDay: day }
      }).select('id').single());
      for (var i = 0; i < day.matches.length; i++) {
        var m = day.matches[i];
        var a = m.t[0].map(function (n) { return idByName[n.toLowerCase()]; });
        var b = m.t[1].map(function (n) { return idByName[n.toLowerCase()]; });
        if (a.concat(b).some(function (x) { return !x; })) continue;
        var row = must(await c.from('matches').insert({
          session_id: s.id, seq: i + 1, court: 0, mode: m.mode || 'normal', team_a: a, team_b: b, winner: m.w
        }).select('id').single());
        must(await c.from('match_players').insert(a.map(function (id) { return { match_id: row.id, player_id: id, team: 0, won: m.w === 0 }; })
          .concat(b.map(function (id) { return { match_id: row.id, player_id: id, team: 1, won: m.w === 1 }; }))));
      }
      return s.id;
    }
  };
  root.DB = DB;
})(window);
