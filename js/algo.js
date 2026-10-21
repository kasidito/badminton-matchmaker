/* Matching and rating logic. Pure functions, no DOM, no network.
   Loaded in the browser as window.Algo and in Node tests via require(). */
(function (root) {
  'use strict';

  var LV = { B: 1200, N: 1350, I: 1500, A: 1650, P: 1800 };   // starting MMR per level
  /* bird ranks by MMR. A rank goes up as soon as the floor is reached, and only drops after falling DROP below it,
     so someone sitting on the edge does not flip every match. */
  var BIRDS = [
    { k: 'chick', name: 'ลูกเจี๊ยบ', min: -Infinity }, { k: 'sparrow', name: 'นกกระจอก', min: 1275 },
    { k: 'pigeon', name: 'นกพิราบ', min: 1425 }, { k: 'hawk', name: 'เหยี่ยว', min: 1575 },
    { k: 'eagle', name: 'อินทรี', min: 1725 }, { k: 'phoenix', name: 'ฟีนิกซ์', min: 1875 }
  ];
  var DROP = 25;
  function birdIndex(r) { var i = 0; for (var j = 1; j < BIRDS.length; j++) if (r >= BIRDS[j].min) i = j; return i; }
  function stepBird(cur, r) { var n = birdIndex(r); return n > cur || r < BIRDS[cur].min - DROP ? n : cur; }
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

  /* OpenSkill (Weng-Lin, Bradley-Terry, two teams), on the MMR scale: mu starts at the level's MMR and
     sigma is the uncertainty. 1 OpenSkill point = SCALE MMR, so defaults are mu 25 -> 1500, sigma 25/3 -> 125.
     A new player moves about 30 MMR a match; a settled one (sigma ~50) about 10. Social courts count half.
     adj = manual edits [{at: matchIndex, id, to}] set mu before that match is replayed (sigma is kept).
     trail (optional array) receives {before:{id:r}, after:{id:r}} per match index. */
  var SCALE = 15, SIG0 = 25 / 3 * SCALE, BETA = SIG0 / 2, TAU = 25 / 300 * SCALE, KAPPA = 0.0001;
  var SETTLED = 105;   // sigma below this ~ 10 matches played; above it the rating is shown as "ยังไม่นิ่ง"
  function sigmaOf(p) { return p.sigma == null ? SIG0 : p.sigma; }
  function ratings(done, players, adj, trail) {
    var R = {}, Sg = {}, G = {}, W = {}, C = {}, B = {};
    players.forEach(function (p) { R[p.id] = startOf(p); Sg[p.id] = sigmaOf(p); G[p.id] = 0; W[p.id] = 0; C[p.id] = p.games || 0; B[p.id] = birdIndex(R[p.id]); });
    function applyAdj(k) { (adj || []).forEach(function (a) { if (a.at === k && (a.id in R)) { R[a.id] = a.to; B[a.id] = birdIndex(a.to); } }); }
    for (var i = 0; i < done.length; i++) {
      applyAdj(i);
      var m = done[i], ids = m.t[0].concat(m.t[1]), ok = true;
      ids.forEach(function (id) { if (!(id in R)) ok = false; });
      if (!ok || !hasRes(m)) { if (trail) trail[i] = null; continue; }
      var mult = (MODE_W[m.mode || 'normal'] || 1) * marginFactor(m.sc);
      var before = {};
      ids.forEach(function (id) { before[id] = R[id]; Sg[id] = Math.sqrt(Sg[id] * Sg[id] + TAU * TAU); });
      var T = m.t.map(function (t) { return { mu: R[t[0]] + R[t[1]], s2: Sg[t[0]] * Sg[t[0]] + Sg[t[1]] * Sg[t[1]] }; });
      var c = Math.sqrt(T[0].s2 + T[1].s2 + 2 * BETA * BETA);
      var p0 = 1 / (1 + Math.exp((T[1].mu - T[0].mu) / c)), pr = [p0, 1 - p0];
      var nr = {}, ns = {};
      [0, 1].forEach(function (s) {
        var won = m.w === s ? 1 : 0;
        var delta = T[s].s2 / c * (won - pr[s]);
        var eta = Math.sqrt(T[s].s2) / c * T[s].s2 / (c * c) * pr[s] * pr[1 - s];
        m.t[s].forEach(function (id) {
          var share = Sg[id] * Sg[id] / T[s].s2;
          nr[id] = R[id] + share * delta * mult;
          ns[id] = Math.sqrt(Sg[id] * Sg[id] * Math.max(1 - share * eta * mult, KAPPA));
        });
      });
      ids.forEach(function (id) { R[id] = nr[id]; Sg[id] = ns[id]; G[id]++; C[id]++; B[id] = stepBird(B[id], R[id]); });
      m.t[m.w].forEach(function (id) { W[id]++; });
      if (trail) { var after = {}; ids.forEach(function (id) { after[id] = R[id]; }); trail[i] = { before: before, after: after }; }
    }
    applyAdj(done.length);
    return { R: R, Sg: Sg, G: G, W: W, C: C, B: B };
  }
  /* optional score (e.g. [21, 15]): a close game moves ratings less, a big win more (0.75 at 0 points apart, 1.25 at 15+) */
  function validScore(sc) { return !!sc && sc.length === 2 && sc.every(function (x) { return typeof x === 'number' && isFinite(x) && x >= 0 && x <= 99; }) && sc[0] !== sc[1]; }
  function marginFactor(sc) { return validScore(sc) ? 0.75 + 0.5 * Math.min(Math.abs(sc[0] - sc[1]), 15) / 15 : 1; }
  function settled(RT, id) { return RT.Sg[id] < SETTLED; }
  /* chance team 0 wins, from the same model (needs RT from ratings for the sigmas) */
  function winProb(RT, t) {
    var a = RT.R[t[0][0]] + RT.R[t[0][1]], b = RT.R[t[1][0]] + RT.R[t[1][1]];
    var s2 = [t[0][0], t[0][1], t[1][0], t[1][1]].reduce(function (x, id) { return x + RT.Sg[id] * RT.Sg[id]; }, 0);
    return 1 / (1 + Math.exp((b - a) / Math.sqrt(s2 + 2 * BETA * BETA)));
  }
  function liveIds(T) { var o = []; T.live.forEach(function (c) { if (c) o = o.concat(c.t[0], c.t[1]); }); return o; }
  function isStale(T, c) {
    if (!c) return false;
    return c.t[0].concat(c.t[1]).some(function (id) { var p = findP(T, id); return !p || !p.active; });
  }
  /* waiting players in priority order: fewest matches, then longest wait */
  /* p.rest = "sit out the next draw": left out of the queue until a draw has skipped them once (see fill) */
  function queueOrder(T, rnd, withRest) {
    var on = {}; liveIds(T).forEach(function (id) { on[id] = 1; });
    var st = stats(T.done, T.players);
    return T.players.filter(function (p) { return p.active && !on[p.id] && (withRest || !p.rest); }).map(function (p) {
      // ties are broken by a random number drawn when the player became free (p.qr), so the order
      // shown on screen and the order a draw uses are the same
      return { id: p.id, credit: (p.base || 0) + st.played[p.id], since: p.freeSince || 0, r: p.qr != null ? p.qr : (rnd ? rnd() : p.id) };
    }).sort(function (a, b) { return a.credit - b.credit || a.since - b.since || a.r - b.r; });
  }
  /* pair rules (T.rules from the club): kind 'with' = always partners when both are here tonight,
     'apart' = never on the same court. A rule whose players are not both checked in is ignored. */
  function activeRules(T) {
    var here = {}; T.players.forEach(function (p) { if (p.active) here[p.id] = 1; });
    return (T.rules || []).filter(function (r) { return r.a !== r.b && here[r.a] && here[r.b]; });
  }
  function ruleMaps(T) {
    var W = {}, X = {}, mate = {};
    activeRules(T).forEach(function (r) {
      if (r.kind === 'with') { W[keyOf(r.a, r.b)] = 1; mate[r.a] = r.b; mate[r.b] = r.a; } else X[keyOf(r.a, r.b)] = 1;
    });
    return { W: W, X: X, mate: mate };
  }
  /* the queue as draws use it: a 'with' pair stands together at the place of the first of the two,
     and someone whose partner is still on court (or resting) waits for them (held) */
  function lineup(T, rnd) {
    var q = queueOrder(T, rnd), M = ruleMaps(T), inQ = {}, placed = {}, list = [], held = [];
    q.forEach(function (x) { inQ[x.id] = x; });
    q.forEach(function (x) {
      if (placed[x.id]) return;
      var m = M.mate[x.id];
      if (m != null && !inQ[m]) { held.push(x.id); return; }
      list.push(x); placed[x.id] = 1;
      if (m != null && !placed[m]) { list.push(inQ[m]); placed[m] = 1; x.pair = inQ[m].pair = x.id; }
    });
    return { list: list, held: held, maps: M };
  }
  /* take people in line order up to n without splitting a pair; on a single court also skip anyone who must not meet someone already taken */
  function takeUnits(list, n, X, oneCourt) {
    var out = [], i = 0;
    while (i < list.length && out.length < n) {
      var unit = list[i].pair != null && list[i + 1] && list[i + 1].pair === list[i].pair ? [list[i], list[i + 1]] : [list[i]];
      i += unit.length;
      if (out.length + unit.length > n) continue;
      if (oneCourt && unit.some(function (u) { return out.some(function (o) { return X[keyOf(u.id, o.id)]; }); })) continue;
      out = out.concat(unit);
    }
    return out;
  }
  /* the 4 people the next single-court draw will take (shown as "ถัดไป") */
  function nextFour(T) {
    var L = lineup(T, null), four = takeUnits(L.list, 4, L.maps.X, true);
    return four.length === 4 ? four.map(function (x) { return x.id; }) : [];
  }
  function teamCost(t, mode, P, O, A, RM, W) {
    function pc(a, b) { var k = keyOf(a, b); return 3 * (2 * (P[k] || 0) + 1) + (A[k] ? 12 : 0) - (W && W[k] ? 1000 : 0); }
    function oc(a, b) { return 2 * (O[keyOf(a, b)] || 0) + 1; }
    var t1 = t[0], t2 = t[1];
    var k = pc(t1[0], t1[1]) + pc(t2[0], t2[1]) + oc(t1[0], t2[0]) + oc(t1[0], t2[1]) + oc(t1[1], t2[0]) + oc(t1[1], t2[1]);
    var d = Math.abs(RM[t1[0]] + RM[t1[1]] - RM[t2[0]] - RM[t2[1]]);
    return k + d / (mode === 'normal' ? 30 : 15);
  }
  function bestSplit(f, mode, P, O, A, RM, rnd, W) {
    var a = f[0], b = f[1], c = f[2], e = f[3];
    var opts = shuffle([[[a, b], [c, e]], [[a, c], [b, e]], [[a, e], [b, c]]], rnd);
    var bo = null, bc = Infinity;
    opts.forEach(function (o) { var k = teamCost(o, mode, P, O, A, RM, W); if (k < bc) { bc = k; bo = o; } });
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
    var L = lineup(T, rnd), M = L.maps;
    var ranked = L.list.filter(function (x) { return !ex[x.id]; });
    var k = Math.min(slots.length, Math.floor(ranked.length / 4));
    while (k > 0 && takeUnits(ranked, k * 4, M.X, k === 1).length < k * 4) k--;   // pairs or apart rules can leave a court short
    if (k < 1) return [];
    var use = slots.slice(0, k);
    var modes = use.map(function (ci) { return (T.courts[ci] || {}).mode || 'normal'; });
    var N = k * 4;
    var special = modes.some(function (m) { return m !== 'normal'; });
    var flex = special ? Math.max(0, Math.min(T.flex || 0, ranked.length - N)) : 0;
    var cand = takeUnits(ranked, N + flex, M.X, k === 1 && !flex);
    if (cand.length < N + flex) { flex = Math.max(0, cand.length - N); }
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
      Object.keys(M.mate).forEach(function (a) { if (inSet[a] && !inSet[M.mate[a]]) cost += 5000; });   // never split a pair across sit-out
      var order;
      if (special && k > 1 && rnd() < 0.5) {
        order = ids.map(function (id) { return { id: id, k: RM[id] + (rnd() - 0.5) * 60 }; })
          .sort(function (a, b) { return b.k - a.k; }).map(function (o) { return o.id; });
        var blocks = []; for (var c = 0; c < k; c++) blocks.push(order.slice(c * 4, c * 4 + 4));
        shuffle(blocks, rnd); order = [].concat.apply([], blocks);
      } else order = shuffle(ids, rnd);
      var courts = [];
      for (var c2 = 0; c2 < k; c2++) {
        var r = bestSplit(order.slice(c2 * 4, c2 * 4 + 4), modes[c2], st.P, st.O, A, RM, rnd, M.W);
        cost += r.cost; courts.push(r.t);
      }
      courts.forEach(function (ct) {
        var all = ct[0].concat(ct[1]);
        all.forEach(function (a, i) { all.slice(i + 1).forEach(function (b) { if (M.X[keyOf(a, b)]) cost += 5000; }); });
        Object.keys(M.mate).forEach(function (a) {
          a = +a; if (all.indexOf(a) < 0) return;
          var mine = ct[0].indexOf(a) >= 0 ? ct[0] : ct[1];
          if (mine.indexOf(M.mate[a]) < 0) cost += 5000;   // pair must be partners on the same court
        });
      });
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
    var prio = {}; queueOrder(T, null, true).forEach(function (x) { prio[x.id] = x; });
    var res = planCourts(T, slots, rnd, avoid, liveIds(T));
    var ts = Date.now();
    res.forEach(function (r) { T.live[r.ci] = { t: r.t, w: null, at: ts }; });
    // a resting player has sat out once a draw took someone who was not ahead of them in the queue
    // (more matches, or the same matches and free no earlier); ties count as skipped
    var picked = []; res.forEach(function (r) { picked = picked.concat(r.t[0], r.t[1]); });
    T.players.forEach(function (p) {
      var me = prio[p.id]; if (!p.rest || !me) return;
      if (picked.some(function (id) { var x = prio[id]; return x && (x.credit > me.credit || (x.credit === me.credit && x.since >= me.since)); })) p.rest = false;
    });
    return res.length;
  }
  function toggleRest(T, id) { var p = findP(T, id); if (!p || !p.active) return false; p.rest = !p.rest; return true; }
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
    return T.players.filter(function (p) { return p.active && !on[p.id] && !p.rest; }).length;
  }
  function saveResult(T, ci) {
    var c = T.live[ci];
    if (!hasRes(c) || isStale(T, c)) return false;
    var ts = Date.now();
    var m = { t: c.t, w: c.w, mode: (T.courts[ci] || {}).mode || 'normal', court: ci, at: c.at || ts, end: ts };
    if (validScore(c.sc) && (c.sc[0] > c.sc[1] ? 0 : 1) === c.w) m.sc = c.sc.slice();
    T.done.push(m);
    c.t[0].concat(c.t[1]).forEach(function (id) { var p = findP(T, id); if (p) { p.freeSince = ts; p.qr = Math.random(); } });
    T.live[ci] = null;
    return true;
  }
  /* a, b: {ci, s, i} for a court position or {id} for a waiting player */
  function swapPos(T, a, b) {
    if (a.id != null && b.id != null) return false;
    function get(x) { return x.id != null ? x.id : T.live[x.ci].t[x.s][x.i]; }
    function set(x, id) { T.live[x.ci].t[x.s][x.i] = id; T.live[x.ci].w = null; T.live[x.ci].sc = null; }
    var ia = get(a), ib = get(b);
    if (ia === ib) return false;
    [a, b].forEach(function (x) { if (x.id != null) { var q = findP(T, x.id); if (q) q.rest = false; } });   // picked by hand: no longer resting
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
  /* MMR, uncertainty and career games each player carries into the next session */
  function carryForward(T) {
    var RT = ratings(T.done, T.players, T.adj);
    return T.players.map(function (p) { return { id: p.id, start_mmr: Math.round(RT.R[p.id]), start_sigma: Math.round(RT.Sg[p.id] * 100) / 100, career_games: RT.C[p.id] }; });
  }
  function endGame(T, label) {
    if (!T.done.length) return null;
    var snap = daySnapshot(T, label);
    var carry = carryForward(T), byId = {};
    carry.forEach(function (c) { byId[c.id] = c; });
    T.days.push(snap);
    T.players.forEach(function (p) { p.start = byId[p.id].start_mmr; p.sigma = byId[p.id].start_sigma; p.games = byId[p.id].career_games; p.base = 0; p.freeSince = 0; p.rest = false; });
    T.done = []; T.adj = []; T.live = T.courts.map(function () { return null; });
    return snap;
  }
  function resetGame(T) {
    T.done = []; T.adj = []; T.live = T.courts.map(function () { return null; });
    T.players.forEach(function (p) { p.base = 0; p.start = LV[p.level || 'I']; p.sigma = null; p.games = 0; p.freeSince = 0; p.rest = false; });
  }
  /* renumber a player everywhere in a night (a member added offline gets its real id after the first sync) */
  function remapId(T, from, to) {
    var sw = function (t) { for (var i = 0; i < t.length; i++) if (t[i] === from) t[i] = to; };
    T.players.forEach(function (p) { if (p.id === from) p.id = to; });
    T.live.forEach(function (c) { if (c) c.t.forEach(sw); });
    T.done.forEach(function (m) { m.t.forEach(sw); });
    T.adj.forEach(function (x) { if (x.id === from) x.id = to; });
  }
  /* names from LINE posts are spelled loosely: compare without spaces, dots, case or Thai tone marks */
  function nameKey(n) { return String(n).toLowerCase().replace(/[\s.\-_'"()]+/g, '').replace(/[\u0E48-\u0E4C]/g, ''); }
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var prev = []; for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var k = 1; k <= b.length; k++) cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /* exact = same name or a saved alias (case-insensitive); similar = members the admin should be asked about */
  function matchName(name, players) {
    var low = String(name).toLowerCase(), key = nameKey(name);
    var exact = players.filter(function (p) {
      return p.name.toLowerCase() === low || (p.aliases || []).some(function (a) { return String(a).toLowerCase() === low; });
    })[0];
    if (exact) return { exact: exact, similar: [] };
    var similar = players.filter(function (p) {
      var k = nameKey(p.name);
      if (!k || !key) return false;
      if (k === key) return true;
      var lim = Math.min(k.length, key.length) >= 6 ? 2 : Math.min(k.length, key.length) >= 3 ? 1 : 0;
      if (lim && editDistance(k, key) <= lim) return true;
      return Math.min(k.length, key.length) >= 3 && (k.indexOf(key) === 0 || key.indexOf(k) === 0);
    });
    return { exact: null, similar: similar.slice(0, 3) };
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
    LV: LV, BIRDS: BIRDS, birdIndex: birdIndex, stepBird: stepBird, MODE_W: MODE_W, keyOf: keyOf, shuffle: shuffle, hasRes: hasRes, startOf: startOf, findP: findP, toggleRest: toggleRest, validScore: validScore, marginFactor: marginFactor, lineup: lineup, nextFour: nextFour, remapId: remapId, matchName: matchName, nameKey: nameKey,
    stats: stats, ratings: ratings, winProb: winProb, settled: settled, SIG0: SIG0, liveIds: liveIds, isStale: isStale, queueOrder: queueOrder,
    planCourts: planCourts, normalize: normalize, drawCourt: drawCourt, redrawCourt: redrawCourt,
    emptySlots: emptySlots, fillEmpty: fillEmpty, freeCount: freeCount, saveResult: saveResult, swapPos: swapPos,
    setCourtCount: setCourtCount, minCredit: minCredit, daySnapshot: daySnapshot, carryForward: carryForward,
    endGame: endGame, resetGame: resetGame, parseNames: parseNames, parseCourts: parseCourts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Algo;
  else root.Algo = Algo;
})(typeof window !== 'undefined' ? window : this);
