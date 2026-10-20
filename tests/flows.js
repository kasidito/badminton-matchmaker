/* Second end-to-end pass: the flows smoke.js does not cover, at phone width.
   Run: node tests/flows.js */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); res.end(buf); });
});
const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

async function newPage(browser, base, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route('**/supabase.js', r => r.fulfill({ body: fake, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(base);
  return page;
}
async function signIn(page) {
  await page.waitForSelector('#loginForm');
  await page.fill('#email', 'admin@example.com');
  await page.fill('#password', 'correct-horse');
  await page.click('#loginForm button');
  await page.waitForSelector('#gate', { state: 'hidden' });
}
const db = page => page.evaluate(() => window.__fakeDb());
const saved = page => page.waitForSelector('#syncPill.saved', { timeout: 8000 });
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const viewText = page => page.textContent('#view');

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();

  /* ---------- phone, full evening ---------- */
  const page = await newPage(browser, base, 390, 844);
  check('phone: sign-in screen fits', await noSideScroll(page));
  await signIn(page);

  await page.click('[data-tab=people]');
  await page.fill('#nameIn', '1. ชิน\n2. โฟล์ค\n3. เดือน\n4. นัทซ้าย\n5. เปตอง\n6. ป๊อป\n7. Ard\n8. ภู\n9. กร\n10. ตรัย');
  await page.click('#addForm button[type=submit]');
  await page.waitForSelector('#toast:not([hidden])');
  check('check-in 10 from a numbered list', (await page.textContent('#toast')).includes('เช็กอิน 10'));

  await page.selectOption('select[data-id="2"]', 'A');
  await page.selectOption('select[data-id="10"]', 'N');
  await saved(page);
  let d = await db(page);
  check('level changes saved to players', d.players.find(p => p.id === 2).level === 'A' && d.players.find(p => p.id === 10).start_mmr === 1300);

  await page.click('[data-act=remove][data-id="13"]');
  await page.waitForSelector('#toast:not([hidden])');
  await saved(page);
  d = await db(page);
  const names = await page.$$eval('.row .who b', els => els.map(e => e.textContent));
  check('removing an unplayed member archives them (history kept)', d.players.find(p => p.id === 13).active === false && !names.includes('ตั้ง'), names.join(','));

  // settings: courts and modes
  await page.click('#setBtn');
  await page.click('[data-act="courts-"]');
  await page.click('[data-act=setmode][data-ci="0"][data-mode=competitive]');
  await page.click('[data-act=setmode][data-ci="1"][data-mode=social]');
  check('settings fit on a phone', await noSideScroll(page));
  await page.click('[data-tab=play]');
  check('court count reduced to 2', (await page.$$('.court')).length === 2);

  // fill, then undo
  await page.click('#dock [data-act=fill]');
  check('fill draws 2 courts and leaves 2 in the queue', (await page.$$('.match')).length === 2 && (await page.$$('.qi')).length === 2);
  check('courts screen fits on a phone', await noSideScroll(page));
  await page.click('#toast [data-act=undo]');
  check('undo fill empties the courts again', (await page.$$('.match')).length === 0);
  await page.click('#dock [data-act=fill]');

  // save then undo, check DB follows
  await page.click('[data-act=win][data-ci="0"][data-s="1"]');
  await page.click('[data-act=save][data-ci="0"]');
  await saved(page);
  check('saved match reaches DB with its court mode', (await db(page)).matches.length === 1 && (await db(page)).matches[0].mode === 'competitive');
  await page.click('#toast [data-act=undo]');
  await saved(page);
  check('undo save removes the match from DB', (await db(page)).matches.length === 0);
  check('undo restores the court with the winner still picked', await page.$('.team.win') !== null);
  await page.click('[data-act=save][data-ci="0"]');

  // check a player out who is on court -> stale court
  const onCourt = await page.$eval('[data-act=pick][data-ci="1"][data-s="0"][data-i="0"]', el => el.textContent);
  await page.click('[data-tab=people]');
  const rowSwitch = await page.$$eval('.row', (rows, name) => { const r = rows.find(x => x.querySelector('.who b').textContent === name); return r ? r.querySelector('input[data-act=toggle]').dataset.id : null; }, onCourt.replace(/MMR.*$/, ''));
  await page.uncheck(`input[data-act=toggle][data-id="${rowSwitch}"]`, { force: true });
  await page.click('[data-tab=play]');
  check('checking out someone on court flags that court', (await viewText(page)).includes('ปิดสถานะเล่นแล้ว'));
  check('a flagged court cannot be saved', await page.isDisabled('[data-act=save][data-ci="1"]'));
  await page.click('#dock [data-act=fill]');
  check('fill redraws the flagged court and both courts are playing', (await page.$$('.match')).length === 2 && !(await viewText(page)).includes('ปิดสถานะเล่นแล้ว'));

  // late arrival gets catch-up credit: play enough that everyone has at least one match
  for (let k = 0; k < 4; k++) {
    for (const ci of [0, 1]) {
      if (await page.$(`[data-act=win][data-ci="${ci}"][data-s="0"]`)) {
        await page.click(`[data-act=win][data-ci="${ci}"][data-s="0"]`);
        await page.click(`[data-act=save][data-ci="${ci}"]`);
      }
    }
    await page.click('#dock [data-act=fill]');
  }
  await page.click('[data-tab=people]');
  await page.fill('#nameIn', 'บีม');
  await page.click('#addForm button[type=submit]');
  await page.waitForSelector('#toast:not([hidden])');
  await saved(page);
  d = await db(page);
  const openId = d.sessions.find(s => s.status === 'open').id;
  const ids = d.matches.filter(m => m.session_id === openId).map(m => m.id);
  const playedBy = id => d.match_players.filter(mp => ids.includes(mp.match_id) && mp.player_id === id).length;
  const others = d.session_players.filter(x => x.session_id === openId && x.active && x.player_id !== 11);
  const lowest = Math.min(...others.map(x => x.base + playedBy(x.player_id)));
  const sp = d.session_players.find(x => x.session_id === openId && x.player_id === 11);
  check('late arrival starts level with the lowest active player', sp && sp.base === lowest, JSON.stringify({ sp, lowest }));

  // rank edit
  await page.click('[data-tab=rank]');
  await page.click('[data-act=edit-mmr][data-id="1"]');
  await page.fill('#mmrIn', '1800');
  await page.click('#mmrForm button[type=submit]');
  await saved(page);
  check('manual MMR edit shows and is stored', (await viewText(page)).includes('1800') && (await db(page)).rating_adjustments.length === 1);
  check('ranking fits on a phone', await noSideScroll(page));

  // summary: delete a match
  await page.click('[data-tab=sum]');
  const before = (await db(page)).matches.length;
  await page.click('[data-act=hdel][data-i="0"]');
  await saved(page);
  check('deleting a match updates DB', (await db(page)).matches.length === before - 1);
  check('summary fits on a phone', await noSideScroll(page));

  // board mode hides controls
  await page.click('[data-tab=play]');
  await page.click('#boardBtn');
  check('board mode hides court buttons', !(await page.isVisible('.court-actions')) && !(await page.isVisible('#dock')));
  await page.click('#boardBtn');

  // session closed elsewhere (another device ended the night)
  await page.evaluate(() => { const s = window.__fakeDb().sessions.find(x => x.status === 'open'); s.status = 'closed'; localStorage.setItem('fake-supabase-db', JSON.stringify(window.__fakeDb())); });
  await page.click('[data-act=mode][data-ci="0"]');
  await saved(page);
  d = await db(page);
  check('if the night was closed elsewhere, the app opens a new one and keeps saving', d.sessions.filter(s => s.status === 'open').length === 1 && d.sessions.length === 2);

  // reset
  await page.click('#setBtn');
  await page.click('[data-act=reset]');
  await page.click('[data-act=reset]');
  await saved(page);
  d = await db(page);
  check('reset clears tonight and puts MMR back to levels', d.matches.filter(m => m.session_id === d.sessions.find(s => s.status === 'open').id).length === 0 && d.players.find(p => p.id === 2).start_mmr === 1700);
  check('no script errors on phone run', page.errors.length === 0, page.errors.join(' | '));

  /* ---------- import a backup from the old single-page app ---------- */
  const old = {
    v: 4, nextId: 4, flex: 4, board: false,
    courts: [{ mode: 'normal' }, { mode: 'social' }],
    players: [
      { id: 1, name: 'ชิน', active: true, base: 0, level: 'A', start: 1700, games: 0, freeSince: 0 },
      { id: 2, name: 'โฟล์ค', active: true, base: 0, level: 'I', start: 1500, games: 0, freeSince: 0 },
      { id: 3, name: 'มิวใหม่', active: true, base: 0, level: 'N', start: 1300, games: 0, freeSince: 0 },
      { id: 4, name: 'เดือน', active: true, base: 0, level: 'I', start: 1500, games: 0, freeSince: 0 }
    ],
    live: [null, null],
    done: [{ t: [[1, 2], [3, 4]], w: 0, mode: 'normal', court: 0, at: Date.now() - 900000, end: Date.now() - 60000 }],
    adj: [],
    days: [{ ts: Date.now() - 86400000, label: 'วันพุธที่ 14 ตุลาคม 2569', count: 1, players: [{ name: 'ชิน', played: 1, win: 1, mmr: 1520, start: 1500 }], matches: [{ t: [['ชิน', 'โฟล์ค'], ['มิวใหม่', 'เดือน']], w: 0, mode: 'normal' }] }]
  };
  const p2 = await newPage(browser, base, 1180, 820);
  await p2.evaluate(() => localStorage.clear());
  await p2.reload();
  await signIn(p2);
  await p2.click('#setBtn');
  await p2.fill('#impText', JSON.stringify(old));
  await p2.click('#importForm button[type=submit]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  await saved(p2);
  d = await db(p2);
  const open = d.sessions.find(s => s.status === 'open');
  check('import adds unknown names as members', d.players.some(p => p.name === 'มิวใหม่'));
  check('import brings tonight\'s matches into the open night', d.matches.filter(m => m.session_id === open.id).length === 1);
  check('import stores past days as closed nights', d.sessions.some(s => s.status === 'closed' && s.title.includes('นำเข้า')));
  await p2.click('[data-tab=sum]');
  check('imported past day shows in history', (await viewText(p2)).includes('14 ตุลาคม'));
  check('no script errors on import run', p2.errors.length === 0, p2.errors.join(' | '));

  /* ---------- a signed-in user who is not an admin ---------- */
  const p3 = await newPage(browser, base, 390, 844);
  await p3.evaluate(() => { localStorage.clear(); });
  await p3.reload();
  await p3.evaluate(() => { const d = window.__fakeDb(); d.admins = []; localStorage.setItem('fake-supabase-db', JSON.stringify(d)); });
  await p3.reload();
  await p3.fill('#email', 'stranger@example.com');
  await p3.fill('#password', 'correct-horse');
  await p3.click('#loginForm button');
  await p3.waitForSelector('text=บัญชีนี้ยังไม่ใช่ผู้ดูแล');
  check('non-admin is stopped with a clear message', !(await p3.isVisible('#app')));
  await p3.click('[data-act=logout]');
  await p3.waitForSelector('#loginForm');
  check('non-admin can sign out', true);

  await browser.close(); server.close();
  let failed = 0;
  results.forEach(r => { if (!r.ok) failed++; console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok || r.detail == null ? '' : '  -> ' + r.detail)); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
