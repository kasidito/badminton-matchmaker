/* Thin wrapper around Supabase. Every function throws on error so callers can show it.
   players are read with select('*') so the app keeps working while a newer column (start_sigma, aliases) is being rolled out. */
(function (root) {
  'use strict';
  var c = null;
  var club = null;   // every players/sessions query is scoped to the club picked in the app

  function must(res) {
    if (res.error) { var e = new Error(res.error.message || 'Database error'); e.code = res.error.code; throw e; }
    return res.data;
  }
  function iso(ms) { return ms ? new Date(ms).toISOString() : null; }

  var DB = {
    init: function () {
      var cfg = root.APP_CONFIG;
      c = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
      });
      return c;
    },
    client: function () { return c; },

    /* auth */
    getUser: async function () { var r = await c.auth.getSession(); return r.data.session ? r.data.session.user : null; },
    signIn: async function (email, password) { return must(await c.auth.signInWithPassword({ email: email, password: password })).user; },
    signOut: async function () { await c.auth.signOut(); },
    /* clubs: row level security returns only the clubs this user runs */
    myClubs: async function () { return must(await c.from('clubs').select('id,name').order('id')); },
    setClub: function (id) { club = id; },
    createClub: async function (name) { return must(await c.rpc('create_club', { p_name: name })); },
    renameClub: async function (id, name) { must(await c.from('clubs').update({ name: name }).eq('id', id)); },
    /* pair rules of this club: [{id, a, b, kind: 'with'|'apart'}] */
    loadRules: async function () { return must(await c.from('pair_rules').select('id,a,b,kind').eq('club_id', club).order('id')); },
    addRule: async function (a, b, kind) { return must(await c.from('pair_rules').insert({ club_id: club, a: a, b: b, kind: kind }).select('id,a,b,kind').single()); },
    deleteRule: async function (id) { must(await c.from('pair_rules').delete().eq('id', id)); },
    leaveClub: async function (id) { must(await c.rpc('leave_club', { p_club_id: id })); },
    deleteClub: async function (id, name) { must(await c.rpc('delete_club', { p_club_id: id, p_name: name })); },

    /* players */
    loadPlayers: async function () {
      return must(await c.from('players').select('*').eq('club_id', club).order('id'));
    },
    addPlayer: async function (name, level) {
      return must(await c.from('players').insert({ club_id: club, name: name, level: level || 'I' }).select('*').single());
    },
    setPlayerActive: async function (id, active) {
      must(await c.from('players').update({ active: active }).eq('id', id));
    },

    /* sessions */
    openSession: async function () {
      var rows = must(await c.from('sessions').select('*').eq('club_id', club).eq('status', 'open').order('started_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    createSession: async function (title, courtModes, flex) {
      return must(await c.from('sessions').insert({
        club_id: club, title: title, court_count: courtModes.length, court_modes: courtModes, flex: flex
      }).select('*').single());
    },
    retitleSession: async function (id, title, playedOn) {
      return must(await c.from('sessions').update({ title: title, played_on: playedOn, started_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'open').select('*').single());
    },
    /* other admins: list/add/remove/reset via the manage-admins edge function (needs the service role) */
    admins: async function (body) {
      var r = await c.functions.invoke('manage-admins', { body: Object.assign({ club_id: club }, body) });
      if (r.error) {
        var m = r.error.message;
        try { var b = await r.error.context.json(); if (b && b.error) m = b.error; } catch (e) { }
        throw new Error(m);
      }
      return r.data;
    },
    updatePlayer: async function (id, fields) {
      must(await c.from('players').update(fields).eq('id', id));
    },
    /* every finished and open match of this club, for the all-time stats page */
    loadAllStats: async function () {
      var sess = must(await c.from('sessions').select('id,played_on,status').eq('club_id', club).order('id'));
      var ids = sess.map(function (s) { return s.id; });
      if (!ids.length) return { sessions: [], matches: [] };
      var ms = must(await c.from('matches').select('id,session_id,seq,team_a,team_b,winner,ended_at,match_players(player_id,won,rating_before,rating_after)')
        .in('session_id', ids).order('session_id').order('seq'));
      return { sessions: sess, matches: ms };
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

    /* players' live view (QR link): the trimmed picture of tonight and its secret token, see live.html */
    setLive: async function (sessionId, token, live) {
      must(await c.from('sessions').update({ share_token: token || null, live: token ? live : null }).eq('id', sessionId));
    },
    /* other admin devices of this club: every change to its nights arrives here (Supabase Realtime, RLS applies) */
    watchNights: function (onRow) {
      if (!c.channel || club == null) return function () { };
      var ch = c.channel('nights-' + club)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: 'club_id=eq.' + club }, function (p) { if (p && p.new) onRow(p.new); })
        .subscribe();
      return function () { try { c.removeChannel(ch); } catch (e) { } };
    },

    /* every table, for the "download all data" backup */
    exportAll: async function () {
      var out = { exportedAt: new Date().toISOString() };
      out.club = must(await c.from('clubs').select('*').eq('id', club))[0] || null;
      out.players = must(await c.from('players').select('*').eq('club_id', club));
      out.sessions = must(await c.from('sessions').select('*').eq('club_id', club));
      var sids = out.sessions.map(function (s) { return s.id; });
      out.session_players = must(await c.from('session_players').select('*').in('session_id', sids));
      out.matches = must(await c.from('matches').select('*').in('session_id', sids));
      out.match_players = must(await c.from('match_players').select('*').in('match_id', out.matches.map(function (m) { return m.id; })));
      out.rating_adjustments = must(await c.from('rating_adjustments').select('*').in('session_id', sids));
      return out;
    },

    /* password */
    resetPassword: async function (email, redirectTo) { must(await c.auth.resetPasswordForEmail(email, { redirectTo: redirectTo })); },
    updatePassword: async function (pw) { return must(await c.auth.updateUser({ password: pw })).user; },

    /* past sessions, oldest first, in the same shape the app keeps in S.days */
    loadClosedDays: async function (limit) {
      var sess = must(await c.from('sessions').select('id,title,played_on,ended_at,state')
        .eq('club_id', club).eq('status', 'closed').order('played_on', { ascending: false }).order('id', { ascending: false }).limit(limit || 30));
      if (!sess.length) return [];
      var ids = sess.map(function (s) { return s.id; });
      var ms = must(await c.from('matches')
        .select('*,match_players(player_id,won,rating_before,rating_after)')
        .in('session_id', ids).order('seq'));
      var names = {};
      must(await c.from('players').select('id,name').eq('club_id', club)).forEach(function (p) { names[p.id] = p.name; });
      var nm = function (id) { return names[id] || '-'; };
      return sess.reverse().map(function (s) {
        if (s.state && s.state.importedDay) return s.state.importedDay;
        var list = ms.filter(function (m) { return m.session_id === s.id; });
        var agg = {};
        list.forEach(function (m) {
          (m.match_players || []).forEach(function (mp) {
            var a = agg[mp.player_id] || (agg[mp.player_id] = { id: mp.player_id, name: nm(mp.player_id), played: 0, win: 0, start: null, mmr: null });
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
          ts: s.ended_at ? Date.parse(s.ended_at) : 0, date: s.played_on, label: label, count: list.length, players: rows,
          matches: list.map(function (m) { var x = { t: [m.team_a.map(nm), m.team_b.map(nm)], w: m.winner, mode: m.mode }; if (m.score_a != null && m.score_b != null) x.sc = [m.score_a, m.score_b]; return x; })
        };
      });
    },

    /* imports a day that was finished in the old single-page app (names only, no ratings trail) */
    importClosedDay: async function (day, idByName) {
      var s = must(await c.from('sessions').insert({
        club_id: club, title: day.label + ' (นำเข้า)', status: 'closed', ended_at: iso(day.ts) || new Date().toISOString(),
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
