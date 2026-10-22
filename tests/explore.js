/* Randomised long-run check ("monkey test") against tests/fake-supabase.js.
   Plays whole nights with random taps (results, redraws, swaps, rests, check-outs, undo, court changes,
   tab switches) at phone and tablet sizes, in light and dark, and checks invariants after every step.
   Seeded, so a failure can be replayed: node tests/explore.js [seed] [steps] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); res.end(buf); });
});
const SEED = +(process.argv[2] || 7), STEPS = +(process.argv[3] || 220);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); return !!cond; };

async function run(browser, base, label, viewport, scheme, seed) {
  const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.route('**/supabase.js', r => r.fulfill({ body: fake, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#loginForm');
  await page.fill('#email', 'admin@example.com');
  await page.fill('#password', 'correct-horse');
  await page.click('#loginForm button');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('[data-tab=people]');
  await page.fill('#nameIn', 'พุธ 3 สนาม\n' + ['ชิน', 'โฟล์ค', 'เดือน', 'นัทซ้าย', 'เปตอง', 'ป๊อป', 'Ard', 'ภู', 'กร', 'ตรัย', 'บีม', 'Yiip', 'ตั้ง', 'มิว', 'ใหม่หนึ่ง'].map((n, i) => (i + 1) + '. ' + n).join('\n'));
  await page.click('#addForm button[type=submit]');
  await page.waitForTimeout(150);
  await page.click('[data-tab=play]');

  const state = () => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bmm-cache-u1-')) return JSON.parse(localStorage.getItem(k)).S; return null; });
  // pick a random visible match; a re-render between finding and clicking is not an app error, so retry once
  const clickIf = async sel => {
    for (let t = 0; t < 2; t++) {
      const els = []; for (const el of await page.$$(sel)) if (await el.isVisible().catch(() => false)) els.push(el);
      if (!els.length) return false;
      const el = els[Math.floor(R() * els.length)];
      try { await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await el.click({ timeout: 3000 }); return true; } catch (e) {
        if (/intercepts pointer events/.test(e.message)) { blocked++; return false; }
        // the page re-rendered between finding and clicking (a removed node reports "not visible"): look again
        if (/not attached|detached/.test(e.message) || !(await el.evaluate(n => n.isConnected).catch(() => false))) continue;
        throw e;
      }
    }
    return false;
  };
  const tab = async t => { if (!(await page.$(`.tab.on[data-tab=${t}]`))) await page.click(`[data-tab=${t}]`); };
  let violations = 0, saves = 0, blocked = 0;   // blocked = a toast or the bottom menu sat on the target; a person would scroll or wait
  const actions = [
    ['save', 6, async () => { await tab('play'); if (!(await clickIf('[data-act=win]'))) return; if (await clickIf('[data-act=save]')) saves++; }],
    ['fill', 4, async () => { await tab('play'); await clickIf('[data-act=fill]:not([disabled])'); }],
    ['draw', 2, async () => { await tab('play'); await clickIf('[data-act=draw]'); }],
    ['redraw', 2, async () => { await tab('play'); await clickIf('[data-act=redraw]'); }],
    ['swap', 2, async () => { await tab('play'); if (await clickIf('.pl')) { if (!(await clickIf('.chip[data-act=pickq]'))) await clickIf('[data-act=unsel]'); } }],
    ['rest', 2, async () => { await tab('play'); await page.click('[data-act=restpick]'); await clickIf('.chip.pick'); await page.click('[data-act=restpick]'); }],
    ['checkout', 1, async () => { await tab('people'); await clickIf('label.sw:has([data-act=toggle]) .track'); }],
    ['undo', 1, async () => { if (await page.$('#undoBtn:not([disabled])')) await page.click('#undoBtn'); }],
    ['mode', 1, async () => { await tab('play'); await clickIf('[data-act=mode]'); }],
    ['courts', 1, async () => { await page.click('#setBtn'); await clickIf(R() < 0.5 ? '[data-act="courts+"]:not([disabled])' : '[data-act="courts-"]:not([disabled])'); }],
    ['mmr', 1, async () => { await tab('rank'); if (await clickIf('[data-act=edit-mmr]')) { await page.fill('#mmrIn', String(1300 + Math.floor(R() * 600))); await page.click('#mmrForm button[type=submit]'); } }],
    ['history', 1, async () => { await tab('sum'); if (R() < 0.5) await clickIf('[data-act=hflip]'); }],
    ['level', 1, async () => { await tab('people'); const s = []; for (const el of await page.$$('select.lvl')) if (await el.isVisible()) s.push(el); if (s.length) await s[Math.floor(R() * s.length)].selectOption(pick(['B', 'N', 'I', 'A', 'P'])); }]
  ];
  const bag = []; actions.forEach(a => { for (let i = 0; i < a[1]; i++) bag.push(a); });
  for (let step = 0; step < STEPS; step++) {
    const a = pick(bag);
    try { await a[2](); } catch (e) { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${label.replace('/', '-')}-${step}.png`, fullPage: true }); errors.push(`step ${step} ${a[0]}: ${e.message.split('\n').filter(l => /intercepts|not stable|not visible|disabled|outside/.test(l)).slice(-1)[0] || e.message.split('\n')[0]}`); }
    const S = await state();
    if (!S) continue;
    const onCourt = [].concat(...S.live.filter(Boolean).map(c => c.t[0].concat(c.t[1])));
    const ids = new Set(S.players.map(p => p.id));
    const bad = [];
    if (new Set(onCourt).size !== onCourt.length) bad.push('player on two courts');
    if (onCourt.some(id => !ids.has(id))) bad.push('unknown player on court');
    if (S.live.length !== S.courts.length) bad.push('court slots out of step');
    if (S.done.some(m => m.w !== 0 && m.w !== 1)) bad.push('finished match without a winner');
    if (S.live.some(c => c && c.t.some(t => t.length !== 2))) bad.push('team without two players');
    if (S.adj.some(x => x.at < 0 || x.at > S.done.length)) bad.push('MMR edit out of range');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) bad.push('page scrolls sideways');
    // layout guard: icons keep their box and player names stay one compact line
    const odd = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.bird').forEach(b => { const s = b.querySelector('img'); if (s && Math.abs(s.getBoundingClientRect().height - b.getBoundingClientRect().height) > 1) out.push('emblem overflows its box'); });
      document.querySelectorAll('.pl').forEach(p => { if (p.getBoundingClientRect().height > 90) out.push('player name row too tall'); });
      return [...new Set(out)];
    });
    bad.push(...odd);
    if (bad.length) { violations++; if (violations < 4) check(`${label}: step ${step} after ${a[0]}`, false, bad.join(', ')); }
  }
  // the server must end up with exactly what the screen shows
  await page.waitForSelector('#syncPill.saved', { timeout: 10000 }).catch(() => {});
  const S = await state();
  const d = await page.evaluate(() => window.__fakeDb());
  const open = d.sessions.find(s => s.status === 'open' && s.club_id === 1);
  check(`${label}: no invariant broke in ${STEPS} steps (${saves} results saved)`, violations === 0, violations + ' bad steps');
  check(`${label}: saved matches equal finished matches on screen`, open && d.matches.filter(m => m.session_id === open.id).length === S.done.length, open && (d.matches.filter(m => m.session_id === open.id).length + ' vs ' + S.done.length));
  check(`${label}: every match has four players stored`, d.matches.every(m => d.match_players.filter(x => x.match_id === m.id).length === 4));
  // end the night and make sure the next night starts clean
  await page.click('#setBtn');
  await page.click('[data-act=end]');
  await page.click('[data-act=end]');
  await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 15000 });
  const d2 = await page.evaluate(() => window.__fakeDb());
  check(`${label}: end of night closes it and leaves no open night`, !d2.sessions.some(s => s.status === 'open' && s.club_id === 1));
  check(`${label}: no script errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  await run(browser, base, 'phone/light', { width: 390, height: 844 }, 'light', SEED);
  await run(browser, base, 'phone/dark', { width: 375, height: 667 }, 'dark', SEED + 1);
  await run(browser, base, 'ipad/landscape', { width: 1180, height: 820 }, 'light', SEED + 2);
  await run(browser, base, 'ipad/portrait', { width: 820, height: 1180 }, 'dark', SEED + 3);
  await browser.close(); server.close();
  let failed = 0;
  results.forEach(r => { if (!r.ok) failed++; console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok || r.detail == null ? '' : '  -> ' + r.detail)); });
  console.log(`\n${results.length - failed}/${results.length} passed (seed ${SEED})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
