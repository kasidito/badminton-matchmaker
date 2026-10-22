// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/algo.js');

function session(n, modes, flex, levels) {
  const T = { v: 4, players: [], courts: modes.map(m => ({ mode: m })), live: modes.map(() => null), done: [], adj: [], days: [], flex };
  const lv = levels || ['I'];
  for (let i = 0; i < n; i++) { const l = lv[i % lv.length]; T.players.push({ id: i + 1, name: 'p' + i, active: true, base: 0, level: l, start: A.LV[l], games: 0, freeSince: 0 }); }
  return T;
}
const uniqueOnCourt = T => { const ids = A.liveIds(T); return new Set(ids).size === ids.length; };

/* simulate a night: courts finish at slightly different times, each is redrawn when it frees up */
function simulate(n, modes, flex, steps) {
  const T = session(n, modes, flex, ['N', 'I', 'A']);
  let t = 0, worst = 0;
  const clock = {}, spreadAtDraw = {};
  const draw = ci => {
    A.drawCourt(T, ci, Math.random); clock[ci] = t + 12 + Math.random() * 8;
    const c = T.live[ci]; if (!c) return;
    const R = A.ratings(T.done, T.players, T.adj).R, r = c.t.flat().map(id => R[id]);
    (spreadAtDraw[T.courts[ci].mode] ||= []).push(Math.max(...r) - Math.min(...r));
  };
  modes.forEach((_, ci) => draw(ci));
  for (let s = 0; s < steps; s++) {
    let ci = 0; modes.forEach((_, i) => { if (clock[i] < clock[ci]) ci = i; }); t = clock[ci];
    const c = T.live[ci]; if (c) { c.w = Math.random() < 0.5 ? 0 : 1; A.saveResult(T, ci); }
    draw(ci);
    assert.ok(uniqueOnCourt(T), 'a player is on two courts');
    const v = Object.values(A.stats(T.done, T.players).played);
    worst = Math.max(worst, Math.max(...v) - Math.min(...v));
  }
  const avg = {}; for (const [k, v] of Object.entries(spreadAtDraw)) avg[k] = v.reduce((a, b) => a + b, 0) / v.length;
  return { worst, avg };
}

test('match counts stay within 3 across a night (usually 2)', () => {
  for (const [n, modes, flex] of [[13, ['normal', 'normal', 'normal'], 0], [16, ['competitive', 'competitive', 'social'], 4], [10, ['competitive', 'social'], 6]]) {
    const r = simulate(n, modes, flex, 200);
    assert.ok(r.worst <= 3, `${n} players ${modes}: spread ${r.worst}`);
  }
});

test('social courts mix levels more than competitive courts', () => {
  let comp = 0, soc = 0;
  for (let i = 0; i < 5; i++) { const r = simulate(16, ['competitive', 'competitive', 'social'], 4, 150); comp += r.avg.competitive; soc += r.avg.social; }
  assert.ok(soc > comp, `social ${soc / 5} should exceed competitive ${comp / 5}`);
});

test('saving a result empties the court and does not redraw it', () => {
  const T = session(10, ['normal', 'normal'], 0);
  A.fillEmpty(T, Math.random);
  T.live[0].w = 1;
  assert.ok(A.saveResult(T, 0));
  assert.strictEqual(T.live[0], null);
  assert.strictEqual(T.done.length, 1);
});

test('a court without a result cannot be saved and is never counted', () => {
  const T = session(8, ['normal', 'normal'], 0);
  A.fillEmpty(T, Math.random);
  assert.strictEqual(A.saveResult(T, 0), false);
  A.redrawCourt(T, 0, Math.random);
  assert.strictEqual(T.done.length, 0);
});

test('swap with the queue, across courts, and clears a picked winner', () => {
  const T = session(10, ['normal', 'normal'], 0);
  A.fillEmpty(T, Math.random);
  const waiting = T.players.map(p => p.id).filter(id => !A.liveIds(T).includes(id));
  const out = T.live[0].t[0][0];
  A.swapPos(T, { ci: 0, s: 0, i: 0 }, { id: waiting[0] });
  assert.strictEqual(T.live[0].t[0][0], waiting[0]);
  assert.ok(!A.liveIds(T).includes(out));
  const x = T.live[0].t[0][1], y = T.live[1].t[1][0];
  T.live[0].w = 0;
  A.swapPos(T, { ci: 0, s: 0, i: 1 }, { ci: 1, s: 1, i: 0 });
  assert.strictEqual(T.live[0].t[0][1], y);
  assert.strictEqual(T.live[1].t[1][0], x);
  assert.strictEqual(T.live[0].w, null);
  assert.ok(uniqueOnCourt(T));
});

test('OpenSkill: new players move ~30, the less certain partner moves more, upsets pay more, social counts half', () => {
  const T = session(4, ['normal'], 0);
  const one = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' }], T.players, []);
  assert.ok(Math.abs(one.R[1] - 1500 - 29) < 3, 'first win is worth about 29');
  assert.ok(one.R[3] < 1500 && one.R[4] < 1500);
  assert.ok(one.Sg[1] < A.SIG0, 'uncertainty shrinks after a match');
  T.players[0].sigma = 50;                       // player 1 settled, partner 2 new
  const r = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' }], T.players, []).R;
  assert.ok(r[2] - 1500 > r[1] - 1500, 'new partner moves more');
  T.players[0].sigma = null; T.players[0].start = 1350; T.players[1].start = 1350;
  const up = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' }], T.players, []).R;
  assert.ok(up[1] - 1350 > one.R[1] - 1500, 'beating a stronger team pays more');
  const n = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' }], session(4, ['normal'], 0).players, []).R;
  const so = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'social' }], session(4, ['normal'], 0).players, []).R;
  assert.ok(Math.abs((so[1] - 1500) * 2 - (n[1] - 1500)) < 1e-9);
  const p = A.winProb(one, [[1, 2], [3, 4]]);
  assert.ok(p > 0.5 && p < 0.7, 'winners are now slightly favoured: ' + p);
});

test('rating trail records before and after for each match', () => {
  const T = session(4, ['normal'], 0);
  const trail = [];
  const done = [{ t: [[1, 2], [3, 4]], w: 1, mode: 'normal' }, { t: [[1, 3], [2, 4]], w: 0, mode: 'normal' }];
  const R = A.ratings(done, T.players, [], trail).R;
  assert.strictEqual(trail.length, 2);
  assert.strictEqual(trail[0].before[1], 1500);
  assert.strictEqual(trail[1].before[1], trail[0].after[1]);
  assert.strictEqual(trail[1].after[1], R[1]);
});

test('manual MMR edits apply from the point they were made', () => {
  const T = session(4, ['normal'], 0);
  const done = [{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' }];
  const R = A.ratings(done, T.players, [{ at: 1, id: 1, to: 1800 }]).R;
  assert.strictEqual(R[1], 1800);
});

test('end of day carries MMR forward and empties the session', () => {
  const T = session(8, ['normal', 'normal'], 0);
  A.fillEmpty(T, Math.random);
  T.live.forEach((c, i) => { c.w = 0; A.saveResult(T, i); });
  const carry = A.carryForward(T);
  const snap = A.endGame(T, 'test');
  assert.strictEqual(snap.count, 2);
  assert.strictEqual(T.done.length, 0);
  assert.ok(T.live.every(c => c === null));
  T.players.forEach(p => assert.strictEqual(p.start, carry.find(c => c.id === p.id).start_mmr));
});

test('reset clears tonight only: ratings carried from earlier nights stay', () => {
  const T = session(6, ['normal'], 0, ['N', 'I', 'A']);
  T.players.forEach(p => { p.start = 1600; p.sigma = 70; p.games = 12; });
  A.fillEmpty(T, Math.random); T.live[0].w = 0; A.saveResult(T, 0);
  T.adj.push({ at: 1, id: 1, to: 1800 });
  assert.notStrictEqual(Math.round(A.ratings(T.done, T.players, T.adj).R[1]), 1600);
  A.resetGame(T);
  assert.strictEqual(T.done.length, 0); assert.strictEqual(T.adj.length, 0);
  assert.ok(T.players.every(p => p.start === 1600 && p.sigma === 70 && p.games === 12));
  assert.ok(Object.values(A.ratings(T.done, T.players, T.adj).R).every(r => r === 1600));
});

test('parses a LINE sign-up post and plain lists', () => {
  const post = 'พุธ 21 ตค 20:00 - 22:00  3 สนาม\n1. ชิน \n2. โฟล์ค\n3. Ard\n14.\n------------------\n16.\nถอนชื่อหลังอังคารเที่ยง';
  assert.deepStrictEqual(A.parseNames(post), ['ชิน', 'โฟล์ค', 'Ard']);
  assert.deepStrictEqual(A.parseNames('ชิน, ตาล,โม'), ['ชิน', 'ตาล', 'โม']);
});

test('reads the number of courts from a LINE post', () => {
  assert.strictEqual(A.parseCourts('พุธ 21 ตค 20:00 - 22:00  3 สนาม\n1. ชิน'), 3);
  assert.strictEqual(A.parseCourts('ศุกร์ 2สนาม'), 2);
  assert.strictEqual(A.parseCourts('1. ชิน\n2. ตาล'), null);
  assert.ok(A.isRoster('พุธ 3 สนาม\n1. ชิน\n2. ตาล\n3.'));
  assert.ok(!A.isRoster('ชิน\nตาล'));
  assert.ok(!A.isRoster('1. ชิน'));
});

test('bird ranks: promote at the floor, drop only after falling 40 below it', () => {
  assert.strictEqual(A.BIRDS[A.birdIndex(1200)].k, 'chick');
  assert.strictEqual(A.BIRDS[A.birdIndex(1500)].k, 'pigeon');
  assert.strictEqual(A.BIRDS[A.birdIndex(1900)].k, 'phoenix');
  const hawk = A.birdIndex(1575);
  assert.strictEqual(A.stepBird(A.birdIndex(1570), 1576), hawk);   // up straight away
  assert.strictEqual(A.stepBird(hawk, 1540), hawk);                 // 35 below the floor: still a hawk
  assert.strictEqual(A.stepBird(hawk, 1534), A.birdIndex(1534));    // 41 below: drops
  // every starting level lands in its own bird
  assert.deepStrictEqual(['B', 'N', 'I', 'A', 'P'].map(l => A.BIRDS[A.birdIndex(A.LV[l])].k), ['chick', 'sparrow', 'pigeon', 'hawk', 'eagle']);
});

test('a player asked to rest sits out exactly one draw, then is first in line', () => {
  const T = session(9, ['normal', 'normal'], 0);
  const first = A.queueOrder(T, null)[0].id;
  A.toggleRest(T, first);
  assert.ok(!A.queueOrder(T, null).some(x => x.id === first), 'resting player is not in the queue');
  assert.strictEqual(A.freeCount(T), 8);
  A.drawCourt(T, 0, Math.random);
  assert.ok(!A.liveIds(T).includes(first), 'not drawn');
  assert.strictEqual(A.findP(T, first).rest, false, 'rest clears after being skipped once');
  assert.strictEqual(A.queueOrder(T, null)[0].id, first, 'back at the front');
});

test('name matching: aliases are exact, loose spellings are only suggested', () => {
  const P = [{ id: 1, name: 'นัทซ้าย', aliases: [] }, { id: 2, name: 'ป๊อป', aliases: ['pop'] }, { id: 3, name: 'Ard', aliases: [] }, { id: 4, name: 'ภู', aliases: [] }];
  assert.strictEqual(A.matchName('ard', P).exact.id, 3);
  assert.strictEqual(A.matchName('POP', P).exact.id, 2);
  assert.deepStrictEqual(A.matchName('นัท ซ้าย', P).similar.map(p => p.id), [1]);
  assert.deepStrictEqual(A.matchName('ป็อป', P).similar.map(p => p.id), [2]);
  assert.deepStrictEqual(A.matchName('Ardd', P).similar.map(p => p.id), [3]);
  assert.deepStrictEqual(A.matchName('ภูมิ', P).similar, [], 'two-letter names are not guessed');
  assert.deepStrictEqual(A.matchName('มิว', P).similar, []);
});

test('remapId moves a player everywhere in the night', () => {
  const T = session(8, ['normal', 'normal'], 0);
  A.fillEmpty(T, Math.random);
  const id = T.live[0].t[0][0];
  T.done.push({ t: [[id, 2], [3, 4]], w: 0 }); T.adj.push({ at: 0, id, to: 1600 });
  A.remapId(T, id, 99);
  assert.strictEqual(T.live[0].t[0][0], 99); assert.strictEqual(T.done[0].t[0][0], 99); assert.strictEqual(T.adj[0].id, 99);
  assert.ok(A.findP(T, 99) && !A.findP(T, id));
});

test('pair rules: a "with" pair is drawn together as partners, "apart" never share a court', () => {
  for (let run = 0; run < 40; run++) {
    const T = session(12, ['normal', 'normal'], 0);
    T.rules = [{ a: 1, b: 7, kind: 'with' }, { a: 2, b: 3, kind: 'apart' }];
    A.fillEmpty(T, Math.random);
    T.live.filter(Boolean).forEach(c => {
      const all = c.t[0].concat(c.t[1]);
      assert.ok(!(all.includes(2) && all.includes(3)), 'apart pair on one court');
      if (all.includes(1) || all.includes(7)) assert.ok(c.t.some(t => t.includes(1) && t.includes(7)), 'with pair not partners');
    });
  }
});

test('pair rules: someone waits for a partner who is still on court; single-court draws respect both rules', () => {
  const T = session(10, ['normal', 'normal'], 0);
  T.rules = [{ a: 1, b: 2, kind: 'with' }, { a: 3, b: 4, kind: 'apart' }];
  T.live[0] = { t: [[1, 5], [6, 8]], w: null, at: 1 };       // 1 is playing (rule broken by hand), 2 is free
  T.players.forEach(p => { p.qr = Math.random(); });           // the app gives everyone a tie-break number
  const L = A.lineup(T, null);
  assert.deepStrictEqual(L.held, [2], '2 waits for 1');
  const four = A.nextFour(T);
  assert.strictEqual(four.length, 4);
  assert.ok(!four.includes(2) && !(four.includes(3) && four.includes(4)), JSON.stringify(four));
  A.drawCourt(T, 1, Math.random);
  const c = T.live[1].t[0].concat(T.live[1].t[1]);
  assert.deepStrictEqual(c.slice().sort(), four.slice().sort(), 'the hint matches the draw');
  T.players.find(p => p.id === 1).active = false;            // partner went home: rule is ignored
  assert.deepStrictEqual(A.lineup(T, null).held, []);
});

test('optional score: close games move ratings less, big wins more; a score that disagrees with the winner is dropped', () => {
  const mk = sc => A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal', sc }], session(4, ['normal'], 0).players, []).R[1] - 1500;
  const plain = mk(undefined), close = mk([21, 19]), big = mk([21, 5]);
  assert.ok(close < plain && plain < big, [close, plain, big].join(' '));
  assert.ok(Math.abs(close / plain - (0.75 + 0.5 * 2 / 15)) < 1e-9);
  const T = session(4, ['normal'], 0);
  T.live[0] = { t: [[1, 2], [3, 4]], w: 1, sc: [21, 15], at: 1 };
  A.saveResult(T, 0);
  assert.strictEqual(T.done[0].sc, undefined);
});


test('score margin is judged against the expected result', () => {
  assert.strictEqual(A.marginFactor([21, 19], 0.5).toFixed(3), (0.75 + 0.5 * 2 / 15).toFixed(3));    // even game: as before
  assert.strictEqual(A.marginFactor([21, 6], 0.5), 1.25);
  assert.ok(A.marginFactor([21, 6], 0.85) < 1.15, 'a favourite crushing a weak pair gains less');
  assert.strictEqual(A.marginFactor([21, 19], 0.85), 0.75);
  assert.strictEqual(A.marginFactor([21, 10], 0.2), 1.25, 'a long shot winning big counts fully');
  // in a real replay: strong pair beating a weak pair 21-6 moves less than an even pair doing the same
  const P = [{ id: 1, start: 1800 }, { id: 2, start: 1800 }, { id: 3, start: 1350 }, { id: 4, start: 1350 }];
  const Q = [{ id: 1, start: 1500 }, { id: 2, start: 1500 }, { id: 3, start: 1500 }, { id: 4, start: 1500 }];
  const gain = (pl, sc) => A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal', sc }], pl, []).R[1] - pl[0].start;
  assert.ok(gain(P, [21, 6]) / gain(P, undefined) < gain(Q, [21, 6]) / gain(Q, undefined));
});

test('certainty, next bird and idle widening', () => {
  assert.strictEqual(A.certainty(A.SIG0), 0);
  assert.strictEqual(A.certainty(105), 60);
  assert.strictEqual(A.certainty(45), 100);
  assert.deepStrictEqual(A.nextBird(A.birdIndex(1500), 1500), { name: 'เหยี่ยว', need: 75 });
  assert.strictEqual(A.nextBird(5, 1900), null);
  assert.strictEqual(A.idleSigma(60, 2), 60, 'two weeks off changes nothing');
  assert.ok(A.idleSigma(60, 10) > 60 && A.idleSigma(60, 10) < A.idleSigma(60, 26));
  assert.strictEqual(A.idleSigma(60, 500), A.SIG0, 'capped at the starting uncertainty');
  assert.strictEqual(A.idleSigma(null, 30), null);
  // someone away who does not play tonight keeps their stored sigma when the night is carried forward
  const T = session(5, ['normal'], 0);
  T.players.forEach(p => { p.sigma0 = 60; p.sigma = A.idleSigma(60, 20); });
  T.done.push({ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' });
  const c = A.carryForward(T);
  assert.strictEqual(c.find(x => x.id === 5).start_sigma, 60);
  assert.ok(c.find(x => x.id === 1).start_sigma < A.idleSigma(60, 20), 'players who played use tonight\'s result');
});

test('index.html stamps every local css/js link with the same ?v= (no stale mix on phones)', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const links = html.match(/(?:href|src)="(?:css|js)\/[^"]+"/g);
  const vs = new Set(links.map(l => (l.match(/\?v=(\w+)"/) || [])[1]));
  assert.ok(links.length >= 5 && vs.size === 1 && !vs.has(undefined), links.join(' '));
});

/* ---------- club history ---------- */
function hist() {
  // 1 Sep: 1+2 beat 3+4.  1 Oct: 1+3 beat 2+4, then 2+3 beat 1+4, then 1+2 beat 3+4 (rating numbers made up but consistent)
  const mp = (id, won, before, after) => ({ player_id: id, won, rating_before: before, rating_after: after });
  return {
    sessions: [{ id: 1, played_on: '2026-09-01' }, { id: 2, played_on: '2026-10-01' }, { id: 3, played_on: '2026-10-08' }],
    matches: [
      { session_id: 1, seq: 1, team_a: [1, 2], team_b: [3, 4], winner: 0, match_players: [mp(1, true, 1500, 1530), mp(2, true, 1500, 1530), mp(3, false, 1500, 1470), mp(4, false, 1500, 1470)] },
      { session_id: 2, seq: 1, team_a: [1, 3], team_b: [2, 4], winner: 0, match_players: [mp(1, true, 1530, 1560), mp(3, true, 1470, 1500), mp(2, false, 1530, 1500), mp(4, false, 1470, 1440)] },
      { session_id: 2, seq: 2, team_a: [2, 3], team_b: [1, 4], winner: 0, match_players: [mp(2, true, 1500, 1530), mp(3, true, 1500, 1530), mp(1, false, 1560, 1530), mp(4, false, 1440, 1410)] },
      { session_id: 3, seq: 1, team_a: [1, 2], team_b: [3, 4], winner: 0, match_players: [mp(1, true, 1530, 1560), mp(2, true, 1530, 1560), mp(3, false, 1530, 1500), mp(4, false, 1410, 1380)] },
      { session_id: 3, seq: 2, team_a: [1, 2], team_b: [3, 4], winner: null, match_players: [] }
    ]
  };
}
test('months with matches, newest first', () => {
  assert.deepStrictEqual(A.monthsOf(hist()), ['2026-10', '2026-09']);
});
test('month stats count only that month and measure MMR change inside it', () => {
  const ms = A.monthStats(hist(), '2026-10', () => 'I');
  assert.strictEqual(ms.nights, 2);
  assert.strictEqual(ms.matches, 3);
  const r = id => ms.rows.find(x => x.id === id);
  assert.deepStrictEqual([r(1).g, r(1).w, r(1).start, r(1).end, r(1).gain, r(1).nights], [3, 2, 1530, 1560, 30, 2]);
  assert.deepStrictEqual([r(4).g, r(4).w, r(4).gain], [3, 0, -90]);
  assert.strictEqual(r(2).best, 2);
  const aw = A.monthAwards(ms);
  assert.deepStrictEqual(aw.improved.map(x => [x.id, x.gain]), [[1, 30], [2, 30], [3, 30]]);
  assert.strictEqual(aw.busiest.length, 3);
  assert.strictEqual(aw.rate.length, 0, 'nobody has 5 games, so no win-rate board');
  assert.ok(aw.promoted.every(x => x.birdTo > x.birdFrom));
});
test('head-to-head counts games as partners and as opponents', () => {
  const h = A.headToHead(hist(), 1, 2);
  assert.deepStrictEqual(h.with, { g: 2, w: 2 });
  assert.deepStrictEqual(h.vs, { g: 2, a: 1, b: 1 });
  assert.strictEqual(h.lastDay, '2026-10-08');
  assert.deepStrictEqual(A.headToHead(hist(), 1, 1).vs, { g: 0, a: 0, b: 0 });
});

test('attendance: last night, days away and a weekly streak that forgives one missed week', () => {
  const mp = (id) => ({ player_id: id, won: true });
  const m = (sid, ids) => ({ session_id: sid, seq: 1, team_a: ids.slice(0, 2), team_b: ids.slice(2), winner: 0, match_players: ids.map(mp) });
  const data = {
    sessions: [{ id: 1, played_on: '2026-09-02' }, { id: 2, played_on: '2026-09-09' }, { id: 3, played_on: '2026-09-16' }, { id: 4, played_on: '2026-09-23' }, { id: 5, played_on: '2026-09-30' }],
    matches: [m(1, [1, 2, 3, 4]), m(2, [1, 2, 3, 5]), m(3, [2, 3, 4, 5]), m(4, [1, 2, 3, 5]), m(5, [1, 2, 4, 5])]
  };
  const a = A.attendance(data, '2026-10-21');
  assert.strictEqual(a[2].streak, 5, 'every week');
  assert.strictEqual(a[1].streak, 4, 'missed one week: forgiven, still counts the rest');
  assert.strictEqual(a[3].streak, 4, 'missed the latest week only: forgiven');
  assert.strictEqual(a[4].streak, 2, 'a second miss ends the streak');
  assert.strictEqual(a[3].last, '2026-09-23');
  assert.strictEqual(a[3].daysAway, 28);
});
