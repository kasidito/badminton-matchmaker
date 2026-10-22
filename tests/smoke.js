/* End-to-end check of the real UI against tests/fake-supabase.js.
   Run: node tests/smoke.js   (needs Playwright; serves the repo on a local port) */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); res.end(buf); });
});

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/supabase.js', r => r.fulfill({ body: fake, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  const db = () => page.evaluate(() => window.__fakeDb());
  const waitSaved = () => page.waitForSelector('#syncPill.saved', { timeout: 8000 });

  await page.goto(base);
  await page.waitForSelector('#loginForm');
  check('login screen shows when signed out', true);

  await page.fill('#email', 'admin@example.com');
  await page.fill('#password', 'wrong');
  await page.click('#loginForm button');
  await page.waitForSelector('.err');
  check('wrong password shows an error', (await page.textContent('.err')).includes('Invalid'));

  await page.fill('#email', 'admin@example.com');
  await page.fill('#password', 'correct-horse');
  await page.click('#loginForm button');
  await page.waitForSelector('#app:not([hidden])');
  check('admin signs in; no night is opened until someone checks in', (await db()).sessions.length === 0);
  check('header says tonight is not opened yet', (await page.textContent('#date')).includes('ยังไม่เปิดคืน'));
  check('loading screen is gone after sign-in', !(await page.isVisible('#gate')));
  check('empty toast bar is not shown', !(await page.isVisible('#toast')));

  await page.click('[data-tab=people]');
  const post = 'พุธ 21 ตค 20:00 - 22:00  3 สนาม\n1. ชิน \n2. โฟล์ค\n3. เดือน\n4. นัทซ้าย\n5. เปตอง \n6. ป๊อป \n7. Ard\n8. ภู \n9. กร\n10. ตรัย\n11. บีม\n12. Yiip\n13. ตั้ง\n14. มิว\n15. \n------------------\n16.\n17.\n\nถอนชื่อหลังอังคารเที่ยงแล้วไม่มีคนแทนหารค่าสนามนะคะ';
  await page.fill('#nameIn', post);
  await page.click('#addForm button[type=submit]');
  await page.waitForSelector('#toast:not([hidden])');
  const t1 = await page.textContent('#toast');
  check('pasting the LINE post checks in 13 and adds 1 new player', t1.includes('เช็กอิน 13') && t1.includes('เพิ่มใหม่ 1'), t1);
  check('new player is saved to the players table', (await db()).players.some(p => p.name === 'มิว'));
  check('new players get a level picker', (await page.textContent('.newcard')).includes('มิว'));
  const miuId = (await db()).players.find(p => p.name === 'มิว').id;
  await page.click(`[data-act=setlevel][data-id="${miuId}"][data-lv=P]`);
  await page.waitForTimeout(100);
  check('picking a level saves it with its starting MMR', (await db()).players.find(p => p.id === miuId).level === 'P' && (await db()).players.find(p => p.id === miuId).start_mmr === 1800);
  await page.click('[data-act=new-done]');
  check('level picker closes', (await page.$('.newcard')) === null);
  await page.waitForSelector('#syncPill.saved', { timeout: 8000 });
  check('first check-in opens tonight', (await db()).sessions.filter(s => s.status === 'open').length === 1);
  check('header shows the club and tonight', (await page.textContent('#date')).startsWith('ก๊วนแบด · คืนนี้'));

  await page.click('[data-tab=rank]');
  check('bird legend shows six ranks', (await page.$$('.btile')).length === 6);
  check('ranking rows carry a bird badge', (await page.$$('.rk .bird')).length > 5);
  await page.click('[data-tab=play]');
  check('banner lists who sits out before the draw', (await page.$$('.chip')).length === 14);
  const restName = await page.$eval('.chip .cn', el => el.textContent);
  await page.click('[data-act=restpick]');
  await page.click(`.chip.pick:has(.cn:text-is("${restName}"))`);
  await page.click('[data-act=restpick]');
  check('resting player is listed under ขอพัก', (await page.textContent('.restline')).includes(restName));
  await page.click('.fill-inline');
  const onCourtNames = await page.$$eval('.pl', els => els.map(e => [...e.childNodes].find(n => n.nodeType === 3).textContent));
  check('resting player is skipped by the draw', !onCourtNames.includes(restName) && onCourtNames.length === 12, onCourtNames.join(','));
  check('after sitting out once they are back in the queue', (await page.$('.restline')) === null && (await page.$$eval('.chip .cn', els => els.map(e => e.textContent))).includes(restName));
  const courts = await page.$$eval('.match', els => els.length);
  check('fill draws all 3 courts', courts === 3, courts);

  await page.click('[data-act=win][data-ci="0"][data-s="0"]');
  await page.click('[data-act=save][data-ci="0"]');
  check('saving court 1 leaves it empty (no auto-draw)', await page.$('[data-act=draw][data-ci="0"]') !== null);

  const courtName = await page.$eval('[data-act=pick][data-ci="1"][data-s="0"][data-i="0"]', el => [...el.childNodes].find(n => n.nodeType === 3).textContent);
  const queueName = await page.$eval('.chip .cn', el => el.textContent);
  await page.click('[data-act=pick][data-ci="1"][data-s="0"][data-i="0"]');
  await page.click('.chip');
  const swapMsg = await page.textContent('#toast');
  check('swap toast names both players', swapMsg.includes('สลับ ' + courtName + ' กับ ' + queueName), swapMsg);

  await waitSaved();
  let d = await db();
  check('finished match reaches the database with 4 player rows', d.matches.length === 1 && d.match_players.length === 4, d.matches.length + '/' + d.match_players.length);
  check('rating before/after stored', d.match_players.every(mp => mp.rating_before != null && mp.rating_after != null));
  check('live session state stored for resume', d.sessions.find(s => s.status === 'open').state.live.filter(Boolean).length === 2);

  // reload resumes the same night
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  check('reload resumes with courts and results intact', (await page.$$eval('.match', els => els.length)) === 2 && (await page.textContent('#doneCount')) === '1');

  // offline: change is kept locally and saved once back online
  await page.evaluate(() => { window.__fakeOffline = true; });
  await page.click('[data-act=win][data-ci="1"][data-s="1"]');
  await page.click('[data-act=save][data-ci="1"]');
  await page.waitForSelector('#syncPill.error, #syncPill.offline', { timeout: 8000 });
  check('failed save is shown in the header', true);
  check('local cache marks unsynced work', await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('bmm-cache') && JSON.parse(localStorage.getItem(k)).dirty)));
  await page.evaluate(() => { window.__fakeOffline = false; });
  await page.click('#syncPill');
  await waitSaved();
  check('tapping the status retries and saves', (await db()).matches.length === 2);

  // flip a past result
  await page.click('[data-tab=sum]');
  await page.click('[data-act=hflip][data-i="0"]');
  await waitSaved();
  d = await db();
  check('flipping a winner updates the stored match', d.matches.find(m => m.seq === 1).winner === 1);

  // end of day
  await page.click('#setBtn');
  await page.click('[data-act=end]');
  await page.click('[data-act=end]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  await waitSaved();
  d = await db();
  check('end of day closes the night and leaves the next one unopened', d.sessions.filter(s => s.status === 'closed').length === 1 && d.sessions.filter(s => s.status === 'open').length === 0);
  check('MMR carried into players table', d.players.some(p => p.start_mmr !== 1500));
  await page.click('[data-tab=sum]');
  check('finished day appears in history', (await page.textContent('#view')).includes('เกมที่จบแล้ว (1)'));
  await page.click('[data-tab=play]');
  check('new night starts with nobody checked in, with a start guide', (await page.textContent('#view')).includes('ยังเช็กอินไม่ถึง 4 คน') && (await page.textContent('#view')).includes('เริ่มคืนนี้'));

  await page.screenshot({ path: path.join(__dirname, '..', '..', 'smoke-ipad.png') });
  check('no script errors', errors.length === 0, errors.join(' | '));

  await browser.close(); server.close();
  let failed = 0;
  results.forEach(r => { if (!r.ok) failed++; console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok || r.detail == null ? '' : '  -> ' + r.detail)); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
