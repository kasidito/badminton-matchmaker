/* Matching and rating logic. Pure functions, no DOM, no network.
   Loaded in the browser as window.Algo and in Node tests via require(). */
(function (root) {
  'use strict';

  var LV = { N: 1300, I: 1500, A: 1700 };           // starting MMR per level
  var MODE_W = { competitive: 1, normal: 1, social: 0.5 }; // rating weight per court mode

  function keyOf(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function hasRes(c) { return !!c && (c.w === 0 || c.w === 1); }
  function startOf(p) { return p.start == null ? LV[p.level || 'I'] : p.start; }
  function findP(T, id) { for (var i = 0; i < T.players.length; i++) if (T.players[i].id === id) return T.players[i]; return null; }

  /* match counts and partner/opponent history, finished matches only */
  function stats(done, players) {
    var played = {}, P = {}, O = {};
    players.forEach(function (p) { played[p.id] = 0; });
    done.forEach(function (m) {
      var t1 = m.t[0], t2 = m.t[1];
      t1.concat(t2).forEach(function (id) { if (id in played) played[id]++; });
      var k1 = keyOf(t1[0], t1[1]), k2 = keyOf(t2[0], t2[1]);
      P[k1] = (P[k1] || 0) + 1; P[k2] = (P[k2] || 0) + 1;
      t1.forEach(function (a) { t2.forEach(function (b) { var k = keyOf(a, b); O[k] = (O[k] || 0) + 1; }); });
    });
    return { played: played, P: P, O: O };
  }

  /* Elo v2. Each player's expectation uses their own rating (75%) and partner (25%) against the
     opponent team average. K = 48 for the first 10 career matches, then 24. Social courts count half.
     adj = manual edits [{at: matchIndex, id, to}] applied before that match is replayed.
     trail (optional array) receives {before:{id:r}, after:{id:r}} per match index. */
  function ratings(done, players, adj, trail) {
    var R = {}, G = {}, W = {}, C = {};
    players.forEach(function (p) { R[p.id] = startOf(p); G[p.id] = 0; W[p.id] = 0; C[p.id] = p.games || 0; });
    function applyAdj(k) { (adj || []).forEach(function (a) { if (a.at === k && (a.id in R)) R[a.id] = a.to; }); }
    for (var i = 0; i < done.length; i++) {
      applyAdj(i);
      var m = done[i], ids = m.t[0].concat(m.t[1]), ok = true;
      ids.forEach(function (id) { if (!(id in R)) ok = false; });
      if (!ok || !hasRes(m)) { if (trail) trail[i] = null; continue; }
      var mult = MODE_W[m.mode || 'normal'] || 1;
      var avg = [(R[m.t[0][0]] + R[m.t[0][1]]) / 2, (R[m.t[1][0]] + R[m.t[1][1]]) / 2];
      var d = {}, before = {};
      ids.forEach(function (id) { before[id] = R[id]; });
      [0, 1].forEach(function (s) {
        var team = m.t[s], opp = avg[1 - s], won = m.w === s ? 1 : 0;
        team.forEach(function (id, j) {
          var eff = 0.75 * R[id] + 0.25 * R[team[1 - j]];
          var e = 1 / (1 + Math.pow(10, (opp - eff) / 400));
          var k = C[id] < 10 ? 48 : 24;
          d[id] = k * mult * (won - e);
        });
      });
      ids.forEach(function (id) { R[id] += d[id]; G[id]++; C[id]++; });
      m.t[m.w].forEach(function (id) { W[id]++; });
      if (trail) { var after = {}; ids.forEach(function (id) { after[id] = R[id]; }); trail[i] = { before: before, after: after }; }
    }
    applyAdj(done.length);
    return { R: R, G: G, W: W, C: C };
  }
  function winProb(R, t) {
    var a = (R[t[0][0]] + R[t[0][1]]) / 2, b = (R[t[1][0]] + R[t[1][1]]) / 2;
    return 1 / (1 + Math.pow(10, (b - a) / 400));
  }
  function liveIds(T) { var o = []; T.live.forEach(function (c) { if (c) o = o.concat(c.t[0], c.t[1]); }); return o; }
  function isStale(T, c) {
    if (!c) return false;
    return c.t[0].concat(c.t[1]).some(function (id) { var p = findP(T, id); return !p || !p.active; });
  }
  /* waiting players in priority order: fewest matches, then longest wait */
  function queueOrder(T, rnd) {
    var on = {}; liveIds(T).forEach(function (id) { on[id] = 1; });
    var st = stats(T.done, T.players);
    return T.players.filter(function (p) { return p.active && !on[p.id]; }).map(function (p) {
      // ties are broken by a random number drawn when the player became free (p.qr), so the order
      // shown on screen and the order a draw uses are the same
      return { id: p.id, credit: (p.base || 0) + st.played[p.id], since: p.freeSince || 0, r: p.qr != null ? p.qr : (rnd ? rnd() : p.id) };
    }).sort(function (a, b) { return a.credit - b.credit || a.since - b.since || a.r - b.r; });
  }
  function teamCost(t, mode, P, O, A, RM) {
    function pc(a, b) { var k = keyOf(a, b); return 3 * (2 * (P[k] || 0) + 1) + (A[k] ? 12 : 0); }
    function oc(a, b) { return 2 * (O[keyOf(a, b)] || 0) + 1; }
    var t1 = t[0], t2 = t[1];
    var k = pc(t1[0], t1[1]) + pc(t2[0], t2[1]) + oc(t1[0], t2[0]) + oc(t1[0], t2[1]) + oc(t1[1], t2[0]) + oc(t1[1], t2[1]);
    var d = Math.abs(RM[t1[0]] + RM[t1[1]] - RM[t2[0]] - RM[t2[1]]);
    return k + d / (mode === 'normal' ? 30 : 15);
  }
  function bestSplit(f, mode, P, O, A, RM, rnd) {
    var a = f[0], b = f[1], c = f[2], e = f[3];
    var opts = shuffle([[[a, b], [c, e]], [[a, c], [b, e]], [[a, e], [b, c]]], rnd);
    var bo = null, bc = Infinity;
    opts.forEach(function (o) { var k = teamCost(o, mode, P, O, A, RM); if (k < bc) { bc = k; bo = o; } });
    var r = f.map(function (id) { return RM[id]; });
    var sp = Math.max.apply(null, r) - Math.min.apply(null, r);
    if (mode === 'competitive') bc += sp / 5;
    else if (mode === 'social') bc -= sp / 12;
    return { t: bo, cost: bc };
  }
  /* Choose players for the given empty courts. flex lets competitive/social courts look past the
     first 4*k people in the queue; skipping someone costs, skipping someone with fewer matches costs more. */
  function planCourts(T, slots, rnd, avoid, exclude) {
    var ex = {}; (exclude || []).forEach(function (id) { ex[id] = 1; });
    var st = stats(T.done, T.players);
    var RM = ratings(T.done, T.players, T.adj).R;
    var ranked = queueOrder(T, rnd).filter(function (x) { return !ex[x.id]; });
    var k = Math.min(slots.length, Math.floor(ranked.length / 4));
    if (k < 1) return [];
    var use = slots.slice(0, k);
    var modes = use.map(function (ci) { return (T.courts[ci] || {}).mode || 'normal'; });
    var N = k * 4;
    var special = modes.some(function (m) { return m !== 'normal'; });
    var flex = special ? Math.max(0, Math.min(T.flex || 0, ranked.length - N)) : 0;
    var cand = ranked.slice(0, N + flex);
    var A = {};
    (avoid || []).forEach(function (t) { A[keyOf(t[0][0], t[0][1])] = 1; A[keyOf(t[1][0], t[1][1])] = 1; });
    var tries = (k === 1 && !flex) ? 1 : 600;
    var best = null, bestCost = Infinity;
    for (var t = 0; t < tries; t++) {
      var chosen;
      if (flex) {
        chosen = cand.map(function (x, i) { return { x: x, k: i + rnd() * (flex + 3) }; })
          .sort(function (a, b) { return a.k - b.k; }).slice(0, N).map(function (o) { return o.x; });
      } else chosen = cand.slice();
      var inSet = {}; chosen.forEach(function (x) { inSet[x.id] = 1; });
      var maxC = Math.max.apply(null, chosen.map(function (x) { return x.credit; }));
      var cost = 0;
      cand.forEach(function (x, i) {
        if (inSet[x.id]) return;
        if (i < N) cost += 10;
        if (x.credit < maxC) cost += 30 * (maxC - x.credit);
        if (x.credit + 1 < maxC) cost += 1000;   // never leave someone 2+ matches behind for a better mix
      });
      var ids = chosen.map(function (x) { return x.id; });
      var order;
      if (special && k > 1 && rnd() < 0.5) {
        order = ids.map(function (id) { return { id: id, k: RM[id] + (rnd() - 0.5) * 60 }; })
          .sort(function (a, b) { return b.k - a.k; }).map(function (o) { return o.id; });
        var blocks = []; for (var c = 0; c < k; c++) blocks.push(order.slice(c * 4, c * 4 + 4));
        shuffle(blocks, rnd); order = [].concat.apply([], blocks);
      } else order = shuffle(ids, rnd);
      var courts = [];
      for (var c2 = 0; c2 < k; c2++) {
        var r = bestSplit(order.slice(c2 * 4, c2 * 4 + 4), modes[c2], st.P, st.O, A, RM, rnd);
        cost += r.cost; courts.push(r.t);
      }
      if (cost < bestCost) { bestCost = cost; best = courts; }
    }
    return use.map(function (ci, i) { return { ci: ci, t: best[i] }; });
  }
  function normalize(T) {
    while (T.courts.length < 1) T.courts.push({ mode: 'normal' });
    while (T.live.length < T.courts.length) T.live.push(null);
    if (T.live.length > T.courts.length) T.live.length = T.courts.length;
  }
  function fill(T, slots, rnd, avoid) {
    var res = planCourts(T, slots, rnd, avoid, liveIds(T));
    var ts = Date.now();
    res.forEach(function (r) { T.live[r.ci] = { t: r.t, w: null, at: ts }; });
    return res.length;
  }
  function drawCourt(T, ci, rnd) { if (T.live[ci] && !isStale(T, T.live[ci])) return 0; T.live[ci] = null; return fill(T, [ci], rnd, null); }
  function redrawCourt(T, ci, rnd) {
    var c = T.live[ci]; T.live[ci] = null;
    var n = fill(T, [ci], rnd, c ? [c.t] : null);
    if (!n) T.live[ci] = c;
    return n;
  }
  function emptySlots(T) { var s = []; T.live.forEach(function (c, i) { if (!c || isStale(T, c)) s.push(i); }); return s; }
  function fillEmpty(T, rnd) {
    var s = emptySlots(T);
    s.forEach(function (i) { T.live[i] = null; });
    return fill(T, s, rnd, null);
  }
  function freeCount(T) {
    var on = {};
    T.live.forEach(function (c) { if (c && !isStale(T, c)) c.t[0].concat(c.t[1]).forEach(function (id) { on[id] = 1; }); });
    return T.players.filter(function (p) { return p.active && !on[p.id]; }).length;
  }
  function saveResult(T, ci) {
    var c = T.live[ci];
    if (!hasRes(c) || isStale(T, c)) return false;
    var ts = Date.now();
    T.done.push({ t: c.t, w: c.w, mode: (T.courts[ci] || {}).mode || 'normal', court: ci, at: c.at || ts, end: ts });
    c.t[0].concat(c.t[1]).forEach(function (id) { var p = findP(T, id); if (p) { p.freeSince = ts; p.qr = Math.random(); } });
    T.live[ci] = null;
    return true;
  }
  /* a, b: {ci, s, i} for a court position or {id} for a waiting player */
  function swapPos(T, a, b) {
    if (a.id != null && b.id != null) return false;
    function get(x) { return x.id != null ? x.id : T.live[x.ci].t[x.s][x.i]; }
    function set(x, id) { T.live[x.ci].t[x.s][x.i] = id; T.live[x.ci].w = null; }
    var ia = get(a), ib = get(b);
    if (ia === ib) return false;
    if (a.id == null) set(a, ib);
    if (b.id == null) set(b, ia);
    return true;
  }
  function setCourtCount(T, n) {
    n = Math.max(1, Math.min(10, n));
    while (T.courts.length < n) { T.courts.push({ mode: 'normal' }); T.live.push(null); }
    while (T.courts.length > n) {
      var last = T.courts.length - 1;
      if (hasRes(T.live[last])) saveResult(T, last);
      T.courts.pop(); T.live.pop();
    }
  }
  function minCredit(T) {
    var st = stats(T.done, T.players);
    var act = T.players.filter(function (p) { return p.active; });
    if (!act.length) return 0;
    return Math.min.apply(null, act.map(function (p) { return (p.base || 0) + st.played[p.id]; }));
  }
  /* summary of the current session, used for history and for End day */
  function daySnapshot(T, label) {
    var RT = ratings(T.done, T.players, T.adj);
    var nm = function (id) { var p = findP(T, id); return p ? p.name : '-'; };
    var rows = T.players.filter(function (p) { return RT.G[p.id] > 0; }).map(function (p) {
      return { name: p.name, played: RT.G[p.id], win: RT.W[p.id], mmr: Math.round(RT.R[p.id]), start: startOf(p) };
    }).sort(function (a, b) { return b.mmr - a.mmr; });
    return {
      ts: Date.now(), label: label, count: T.done.length, players: rows,
      matches: T.done.map(function (m) { return { t: [m.t[0].map(nm), m.t[1].map(nm)], w: m.w, mode: m.mode || 'normal' }; })
    };
  }
  /* MMR and career games each player carries into the next session */
  function carryForward(T) {
    var RT = ratings(T.done, T.players, T.adj);
    return T.players.map(function (p) { return { id: p.id, start_mmr: Math.round(RT.R[p.id]), career_games: RT.C[p.id] }; });
  }
  function endGame(T, label) {
    if (!T.done.length) return null;
    var snap = daySnapshot(T, label);
    var carry = carryForward(T), byId = {};
    carry.forEach(function (c) { byId[c.id] = c; });
    T.days.push(snap);
    T.players.forEach(function (p) { p.start = byId[p.id].start_mmr; p.games = byId[p.id].career_games; p.base = 0; p.freeSince = 0; });
    T.done = []; T.adj = []; T.live = T.courts.map(function () { return null; });
    return snap;
  }
  function resetGame(T) {
    T.done = []; T.adj = []; T.live = T.courts.map(function () { return null; });
    T.players.forEach(function (p) { p.base = 0; p.start = LV[p.level || 'I']; p.games = 0; p.freeSince = 0; });
  }
  /* Accepts a pasted LINE sign-up post ("1. ชิน") or a comma/newline list. Returns names. */
  function parseNames(text) {
    var lines = String(text).split(/\r?\n/);
    var num = /^\s*\d+\s*[.)]/;
    var numbered = lines.filter(function (l) { return num.test(l); });
    var src = numbered.length >= 2
      ? numbered.map(function (l) { return l.replace(/^\s*\d+\s*[.)]\s*/, ''); })
      : String(text).split(/[\n,，、]+/);
    return src.map(function (s) { return s.trim().slice(0, 24); })
      .filter(function (s) { return s && /[A-Za-z฀-๿À-ɏ぀-ヿ一-鿿]/.test(s); });
  }

  /* "พุธ 21 ตค 20:00 - 22:00  3 สนาม" -> 3. Returns null when the post does not say. */
  function parseCourts(text) {
    var m = String(text).match(/(\d{1,2})\s*สนาม/);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return n >= 1 && n <= 10 ? n : null;
  }

  var Algo = {
    LV: LV, MODE_W: MODE_W, keyOf: keyOf, shuffle: shuffle, hasRes: hasRes, startOf: startOf, findP: findP,
    stats: stats, ratings: ratings, winProb: winProb, liveIds: liveIds, isStale: isStale, queueOrder: queueOrder,
    planCourts: planCourts, normalize: normalize, drawCourt: drawCourt, redrawCourt: redrawCourt,
    emptySlots: emptySlots, fillEmpty: fillEmpty, freeCount: freeCount, saveResult: saveResult, swapPos: swapPos,
    setCourtCount: setCourtCount, minCredit: minCredit, daySnapshot: daySnapshot, carryForward: carryForward,
    endGame: endGame, resetGame: resetGame, parseNames: parseNames, parseCourts: parseCourts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Algo;
  else root.Algo = Algo;
})(typeof window !== 'undefined' ? window : this);
