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

test('weaker partner gains more for the same win; social counts half', () => {
  const T = session(4, ['normal'], 0);
  T.players[0].start = 1700; T.players[1].start = 1300;
  const r = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal' }], T.players, []).R;
  assert.ok(r[2] - 1300 > r[1] - 1700);
  assert.ok(r[3] < 1500 && r[4] < 1500);
  const rs = A.ratings([{ t: [[1, 2], [3, 4]], w: 0, mode: 'social' }], T.players, []).R;
  assert.ok(Math.abs((rs[1] - 1700) * 2 - (r[1] - 1700)) < 1e-9);
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

test('reset puts everyone back to their level rating', () => {
  const T = session(6, ['normal'], 0, ['N', 'I', 'A']);
  T.players.forEach(p => { p.start = 1600; p.games = 12; });
  A.resetGame(T);
  assert.deepStrictEqual(T.players.map(p => p.start), [1350, 1500, 1650, 1350, 1500, 1650]);
  assert.ok(T.players.every(p => p.games === 0));
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
});

test('bird ranks: promote at the floor, drop only after falling 25 below it', () => {
  assert.strictEqual(A.BIRDS[A.birdIndex(1200)].k, 'chick');
  assert.strictEqual(A.BIRDS[A.birdIndex(1500)].k, 'pigeon');
  assert.strictEqual(A.BIRDS[A.birdIndex(1900)].k, 'phoenix');
  const hawk = A.birdIndex(1575);
  assert.strictEqual(A.stepBird(A.birdIndex(1570), 1576), hawk);   // up straight away
  assert.strictEqual(A.stepBird(hawk, 1560), hawk);                 // 15 below the floor: still a hawk
  assert.strictEqual(A.stepBird(hawk, 1549), A.birdIndex(1549));    // 26 below: drops
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
