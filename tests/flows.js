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
  check('level changes saved to players', d.players.find(p => p.id === 2).level === 'A' && d.players.find(p => p.id === 10).start_mmr === 1350);

  check('delete buttons are hidden until "ลบสมาชิก" is pressed', (await page.$('[data-act=remove]')) === null);
  await page.click('[data-act=editmembers]');
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
  check('fill draws 2 courts and leaves 2 in the queue', (await page.$$('.match')).length === 2 && (await page.$$('.chip')).length === 2);
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
  const onCourt = await page.$eval('[data-act=pick][data-ci="1"][data-s="0"][data-i="0"]', el => [...el.childNodes].find(n => n.nodeType === 3).textContent);
  await page.click('[data-tab=people]');
  const rowSwitch = await page.$$eval('.row', (rows, name) => { const r = rows.find(x => x.querySelector('.who b').textContent === name); return r ? r.querySelector('input[data-act=toggle]').dataset.id : null; }, onCourt.replace(/MMR.*$/, ''));
  await page.$eval(`input[data-act=toggle][data-id="${rowSwitch}"]`, el => { el.scrollIntoView({ block: 'center' }); el.click(); });
  await page.click('[data-tab=play]');
  check('checking out someone on court flags that court', (await viewText(page)).includes('ปิดสถานะเล่นแล้ว'));
  check('a flagged court cannot be saved', (await page.$('[data-act=save][data-ci="1"]')) === null);
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
  check('first tap on delete only asks to confirm', (await page.textContent('[data-act=hdel][data-i="0"]')).includes('กดอีกครั้ง') && (await db(page)).matches.length === before);
  await page.click('[data-act=hdel][data-i="0"]');
  await saved(page);
  check('second tap deletes the match and DB follows', (await db(page)).matches.length === before - 1);
  check('summary fits on a phone', await noSideScroll(page));

  // board mode hides controls
  await page.click('[data-tab=play]');
  check('board-mode icon is not shown on a phone (it is in Settings)', !(await page.isVisible('#boardBtn')));
  await page.click('#setBtn'); await page.click('label:has([data-act=boardsw]) .track'); await page.click('[data-tab=play]');
  check('board mode hides court buttons', !(await page.isVisible('.court-actions')) && !(await page.isVisible('[data-act=win]')) && !(await page.isVisible('#dock')));
  await page.click('#setBtn'); await page.click('label:has([data-act=boardsw]) .track'); await page.click('[data-tab=play]');

  // session closed elsewhere (another device ended the night)
  await page.evaluate(() => { const s = window.__fakeDb().sessions.find(x => x.status === 'open'); s.status = 'closed'; localStorage.setItem('fake-supabase-db', JSON.stringify(window.__fakeDb())); });
  await page.click('[data-act=mode][data-ci="0"]');
  await saved(page);
  d = await db(page);
  check('if the night was closed elsewhere, the app opens a new one and keeps saving', d.sessions.filter(s => s.status === 'open').length === 1 && d.sessions.length === 2, JSON.stringify(d.sessions.map(s => s.status)));

  // reset
  await page.click('#setBtn');
  await page.click('[data-act=reset]');
  await page.click('[data-act=reset]');
  await saved(page);
  d = await db(page);
  check('reset clears tonight and puts MMR back to levels', d.matches.filter(m => m.session_id === d.sessions.find(s => s.status === 'open').id).length === 0 && d.players.find(p => p.id === 2).start_mmr === 1650);
  check('no script errors on phone run', page.errors.length === 0, page.errors.join(' | '));

  /* ---------- new in this release ---------- */
  const p4 = await newPage(browser, base, 1180, 820);
  await p4.evaluate(() => localStorage.clear());
  await p4.reload();
  await signIn(p4);
  // a night opened on an earlier day but never used moves to today
  check('unused night from an earlier day is not left with an old date', (await p4.textContent('#date')).includes('ยังไม่เปิดคืน') || (await p4.textContent('#date')).startsWith('คืน'));
  await p4.click('#setBtn');
  await p4.click('[data-act="courts-"]');          // 2 courts before the post arrives
  await p4.click('[data-tab=people]');
  await p4.fill('#nameIn', 'พุธ 21 ตค 20:00 - 22:00  3 สนาม\n1. ชิน\n2. โฟล์ค\n3. เดือน\n14.\n------\nถอนชื่อหลังอังคารเที่ยงแล้วไม่มีคนแทนหารค่าสนามนะคะ');
  await p4.click('#addForm button[type=submit]');
  await p4.waitForSelector('#toast:not([hidden])');
  check('pasting the post sets the court count from "3 สนาม"', (await p4.textContent('#toast')).includes('ตั้ง 3 สนาม'));
  check('people not here yet are tucked away', !(await p4.isVisible('[data-act=checkall]')));
  await p4.click('details:has([data-act=checkall]) > summary');
  await p4.click('[data-act=checkall]');
  await p4.click('[data-tab=play]');
  const hint = await p4.textContent('.slot .next');
  check('empty court shows who goes on next', hint && hint.includes('ถัดไป'), hint);
  check('only the first empty court promises names', (await p4.$$('.slot .next')).length === 1 && (await p4.textContent('#view')).includes('คิวต่อจากสนาม 1'));
  await p4.click('[data-act=draw][data-ci="0"]');
  const firstFour = hint.replace('ถัดไป', '').split(/,\s*/).map(x => x.trim().replace(/โหมดนี้.*$/, '')).filter(Boolean);
  const court1 = await p4.$$eval('[data-ci="0"].pl', els => els.map(e => [...e.childNodes].find(n => n.nodeType === 3).textContent));
  check('the hinted players are exactly the ones drawn onto court 1', firstFour.length === 4 && firstFour.every(n => court1.includes(n)), JSON.stringify({ firstFour, court1 }));
  await p4.click('.fill-inline');

  // multi-step undo from the header, long after the toast is gone
  await p4.click('[data-act=win][data-ci="0"][data-s="0"]');
  await p4.click('[data-act=save][data-ci="0"]');
  await p4.click('[data-act=draw][data-ci="0"]');
  await p4.waitForTimeout(7500);                 // toast has expired
  // steps so far: draw court 1, fill the rest, save court 1, draw court 1
  check('toast has gone but header undo is available', !(await p4.isVisible('#toast')) && !(await p4.isDisabled('#undoBtn')));
  await p4.click('#undoBtn');                    // undo the draw
  check('undo 1 empties court 1 again', (await p4.$('[data-act=draw][data-ci="0"]')) !== null);
  await p4.click('#undoBtn');                    // undo the save
  check('undo 2 brings back the result', (await p4.textContent('#doneCount')) === '0' && (await p4.$('.team.win')) !== null);
  await p4.click('#undoBtn');                    // undo the fill
  check('undo 3 removes the courts filled together', (await p4.$$('.match')).length === 1);
  await p4.click('#undoBtn');                    // undo the first draw
  check('undo 4 goes back to empty courts', (await p4.$$('.match')).length === 0);
  check('undo stack is now empty', await p4.isDisabled('#undoBtn') || (await p4.getAttribute('#undoBtn', 'title')).includes('ย้อนกลับ'));

  // a night with one result: LINE summary, then End day stores MMR and uncertainty for next time
  await p4.evaluate(() => { window.__shared = []; navigator.share = t => { window.__shared.push(t.text); return Promise.resolve(); }; });
  await p4.click('[data-tab=play]');
  await p4.click('.fill-inline');
  await p4.click('[data-act=win][data-ci="0"][data-s="1"]');
  await p4.click('[data-act=save][data-ci="0"]');
  await p4.click('[data-tab=sum]');
  await p4.click('[data-act=share-night]');
  const shared = await p4.evaluate(() => window.__shared[0] || '');
  check('LINE summary lists the ranking and games per person', shared.includes('อันดับ') && shared.includes('เล่นคนละ 1 เกม') && shared.includes('Budmintan'), shared.slice(0, 120));
  check('LINE summary has no emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(shared));
  await p4.click('#setBtn');
  await p4.click('[data-act=end]'); await p4.click('[data-act=end]');
  await p4.waitForFunction(() => !document.querySelector('.busy'));
  d = await db(p4);
  check('End day stores each player\'s uncertainty for next time', d.players.filter(p => p.club_id === 1 && p.start_sigma != null).length >= 4);
  await p4.click('[data-tab=sum]');
  await p4.click('details:has([data-act=share-day]) > summary');
  await p4.click('[data-act=share-day]');
  check('a finished night can be shared too', (await p4.evaluate(() => window.__shared.length)) === 2);
  await p4.click('[data-act=sumview][data-v=all]');
  await p4.waitForSelector('.srow2');
  check('all-nights stats list everyone who played', (await p4.$$('.srow2')).length >= 4);
  await p4.click('.srow2');
  check('opening a player shows partner and streak facts', (await p4.textContent('.statdetail')).includes('ชนะติดกันมากสุด'));
  await p4.click('#setBtn');

  // download all data
  const [dl] = await Promise.all([p4.waitForEvent('download'), p4.click('[data-act=export]')]);
  const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('download contains every table', ['players', 'sessions', 'matches', 'match_players', 'session_players', 'rating_adjustments'].every(k => Array.isArray(file[k])) && file.matches.length >= 1);

  // change password
  await p4.fill('#newPw', 'short');
  await p4.click('#pwForm button[type=submit]');
  check('short new password is refused by the form', !(await p4.$eval('#newPw', el => el.checkValidity())) && !(await db(p4)).passwordChanged);
  await p4.fill('#newPw', 'a-much-longer-pass');
  await p4.click('#pwForm button[type=submit]');
  await p4.waitForSelector('text=เปลี่ยนรหัสผ่านแล้ว');
  check('password change goes to Supabase', (await db(p4)).passwordChanged === 'a-much-longer-pass');
  check('no script errors on new-feature run', p4.errors.length === 0, p4.errors.join(' | '));

  // forgot password and recovery link
  const p5 = await newPage(browser, base, 390, 844);
  await p5.evaluate(() => { localStorage.clear(); });
  await p5.reload();
  await p5.click('[data-act=forgot]');
  await p5.fill('#femail', 'admin@example.com');
  await p5.click('#forgotForm button[type=submit]');
  await p5.waitForSelector('text=ส่งลิงก์ตั้งรหัสผ่านใหม่');
  const reqs = await p5.evaluate(() => window.__resetRequests);
  check('forgot password asks Supabase to email a link back to this page', reqs && reqs[0].email === 'admin@example.com' && reqs[0].redirectTo.startsWith(base));
  await p5.evaluate(() => { const d = window.__fakeDb(); d.auth = { user: { id: 'u1', email: 'admin@example.com' } }; localStorage.setItem('fake-supabase-db', JSON.stringify(d)); });
  await p5.goto(base + '?from=email#access_token=x&type=recovery');   // a fresh page load, as when opening the email link
  await p5.waitForSelector('#recoverForm');
  await p5.fill('#rpw', 'brand-new-pass');
  await p5.fill('#rpw2', 'different-pass');
  await p5.click('#recoverForm button[type=submit]');
  check('recovery screen catches mismatched passwords', (await p5.textContent('.err')).includes('ไม่ตรงกัน'));
  await p5.fill('#rpw', 'brand-new-pass');
  await p5.fill('#rpw2', 'brand-new-pass');
  await p5.click('#recoverForm button[type=submit]');
  await p5.waitForSelector('#gate', { state: 'hidden' });
  check('after setting a new password the admin lands in the app', (await db(p5)).passwordChanged === 'brand-new-pass');
  check('no script errors on password run', p5.errors.length === 0, p5.errors.join(' | '));

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
  await p2.click('details:has(#importForm) > summary');
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

  /* ---------- edit a member's name and MMR, admins, theme ---------- */
  await p2.click('[data-tab=people]');
  const firstId = await p2.$eval('[data-act=edit-player]', b => b.dataset.id);
  const oldName = (await db(p2)).players.find(p => String(p.id) === firstId).name;
  await p2.click(`[data-act=edit-player][data-id="${firstId}"]`);
  await p2.fill('#pName', 'ชื่อใหม่');
  await p2.fill('#pMmr', '1777');
  await p2.click('#playerForm button[type=submit]');
  await p2.waitForSelector('#playerForm', { state: 'detached' });
  await saved(p2);
  d = await db(p2);
  check('rename is written to the players table', d.players.find(p => String(p.id) === firstId).name === 'ชื่อใหม่', oldName);
  check('MMR edit from the member editor is stored as an adjustment', d.rating_adjustments.some(r => String(r.player_id) === firstId && r.to_mmr === 1777));
  check('renamed member shows the new name and MMR', (await viewText(p2)).includes('ชื่อใหม่') && (await viewText(p2)).includes('1777'));
  const other = d.players.find(p => String(p.id) !== firstId);
  await p2.click(`[data-act=edit-player][data-id="${other.id}"]`);
  await p2.fill('#pName', 'ชื่อใหม่');
  await p2.click('#playerForm button[type=submit]');
  await p2.waitForSelector('#toast:not([hidden])');
  check('duplicate name is refused', (await p2.textContent('#toast')).includes('มีชื่อ') && (await db(p2)).players.find(p => p.id === other.id).name === other.name);
  await p2.click('[data-act=edit-player-cancel]');

  await p2.click('#setBtn');
  await p2.waitForSelector('#adminAddForm');
  check('admins card lists the signed-in admin', (await viewText(p2)).includes('admin@example.com'));
  await p2.fill('#admEmail', 'helper@example.com');
  await p2.fill('#admPw', 'short');
  await p2.click('#adminAddForm button[type=submit]');
  await p2.waitForTimeout(300);
  check('short starting password is refused', !(await db(p2)).users.some(a => a.email === 'helper@example.com'));
  await p2.fill('#admEmail', 'helper@example.com');
  await p2.fill('#admPw', 'start-pass-1');
  await p2.click('#adminAddForm button[type=submit]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  const helperId = ((await db(p2)).users.find(a => a.email === 'helper@example.com') || {}).id;
  check('new admin is added to this club', (await db(p2)).club_admins.some(a => a.user_id === helperId && a.club_id === 1) && (await viewText(p2)).includes('helper@example.com'));
  await p2.click(`[data-act=admin-reset][data-id="${helperId}"]`);
  await p2.fill('#admResetPw', 'new-pass-22');
  await p2.click('#adminResetForm button[type=submit]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  check('admin can set another admin\'s password', (await db(p2)).users.find(a => a.id === helperId).password === 'new-pass-22');
  check('own row has no remove button', (await p2.$('[data-act=admin-remove][data-id="u1"]')) === null);
  await p2.click(`[data-act=admin-remove][data-id="${helperId}"]`);
  await p2.click(`[data-act=admin-remove][data-id="${helperId}"]`);
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  check('removing an admin takes two taps and works', !(await db(p2)).club_admins.some(a => a.user_id === helperId));

  /* ---------- clubs: a second club is fully separate ---------- */
  await p2.click('details.sdetails:has(#newClubForm) > summary');
  await p2.fill('#newClubName', 'ก๊วนสอง');
  await p2.click('#newClubForm button[type=submit]');
  await p2.waitForSelector('#addForm');
  check('new club opens on the players tab with nobody in it', !(await viewText(p2)).includes('ชิน') && (await p2.textContent('#date')).includes('ก๊วนสอง'));
  await p2.fill('#nameIn', 'เอ\nบี\nโฟล์ค');
  await p2.click('#addForm button[type=submit]');
  await p2.waitForSelector('#toast:not([hidden])');
  d = await db(p2);
  check('a name that exists in another club is a new member here', d.players.filter(p => p.name === 'โฟล์ค').length === 2 && d.players.filter(p => p.club_id === 2).length === 3, JSON.stringify(d.players.filter(p => p.club_id !== 1)) + ' toast=' + (await p2.textContent('#toast')));
  await p2.click('#setBtn');
  await p2.fill('#admEmail', 'club2@example.com');
  await p2.fill('#admPw', 'club-two-pass');
  await p2.click('#adminAddForm button[type=submit]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  await p2.click('[data-act=logout]');
  await p2.waitForSelector('#loginForm');
  await p2.fill('#email', 'club2@example.com');
  await p2.fill('#password', 'correct-horse');
  await p2.click('#loginForm button');
  await p2.waitForSelector('#app:not([hidden])');
  await p2.click('[data-tab=people]');
  const seen = await p2.$$eval('.row .who b', els => els.map(e => e.textContent));
  check('an admin of the second club sees only its players', seen.length === 3 && seen.includes('เอ') && !seen.includes('ตั้ง'), seen.join(','));
  await p2.click('#setBtn');
  check('they cannot switch to the first club', (await p2.$('[data-act=club-switch]')) === null);
  await p2.click('[data-act=logout]');
  await p2.waitForSelector('#loginForm');
  await signIn(p2);
  await p2.click('#setBtn');
  await p2.click('[data-act=club-switch]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  await p2.click('[data-tab=people]');
  const back = await p2.$$eval('.row .who b', els => els.map(e => e.textContent));
  check('the owner can switch back and the first club is intact', back.includes('ตั้ง') && !back.includes('เอ'), back.join(','));

  /* ---------- check-in: near spellings are asked about, aliases are remembered ---------- */
  await p2.fill('#nameIn', '1. นัท ซ้าย\n2. ป็อป');
  await p2.click('#addForm button[type=submit]');
  await p2.waitForSelector('.askcard');
  check('near spellings are asked about instead of added', (await p2.$$('.askrow')).length === 2 && !(await db(p2)).players.some(p => p.name === 'นัท ซ้าย'));
  await p2.click('.askrow:has-text("นัท ซ้าย") [data-act=ask-same]');
  await p2.click('.askrow:has-text("ป็อป") [data-act=ask-new]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  d = await db(p2);
  check('"ใช่" remembers the spelling on the member', (d.players.find(p => p.name === 'นัทซ้าย' && p.club_id === 1).aliases || []).includes('นัท ซ้าย'));
  check('"คนใหม่" adds a separate member', d.players.some(p => p.name === 'ป็อป' && p.club_id === 1));
  await p2.fill('#nameIn', 'นัท ซ้าย');
  await p2.click('#addForm button[type=submit]');
  await p2.waitForSelector('#toast:not([hidden])');
  check('next time the remembered spelling checks in without asking', !(await p2.$('.askcard')));

  /* ---------- adding a member while offline ---------- */
  await p2.evaluate(() => { window.__fakeOffline = true; });
  await p2.fill('#nameIn', 'คนออฟไลน์');
  await p2.click('#addForm button[type=submit]');
  await p2.waitForSelector('#toast:not([hidden])');
  check('offline check-in keeps the new member locally', (await p2.textContent('#view')).includes('คนออฟไลน์') && (await p2.textContent('#view')).includes('รอบันทึก'));
  await p2.evaluate(() => { window.__fakeOffline = false; });
  await p2.click('#syncPill');
  await p2.waitForSelector('#syncPill.saved', { timeout: 15000 });
  d = await db(p2);
  const off = d.players.find(p => p.name === 'คนออฟไลน์');
  check('back online, the member is saved with a real id and joins tonight', off && off.id > 0 && d.session_players.some(x => x.player_id === off.id) && !d.session_players.some(x => x.player_id < 0));
  check('the waiting tag is gone', !(await p2.textContent('#view')).includes('รอบันทึก'));

  /* ---------- leave a club, delete a test club ---------- */
  await p2.click('#setBtn');
  await p2.click('[data-act=club-switch]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  await p2.click('#setBtn');
  await p2.click('details.sdetails:has([data-act=club-leave]) > summary');
  await p2.click('[data-act=club-leave]'); await p2.click('[data-act=club-leave]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  d = await db(p2);
  check('leaving a club removes only this admin from it', !d.club_admins.some(x => x.club_id === 2 && x.user_id === 'u1') && d.club_admins.some(x => x.club_id === 2) && d.players.some(p => p.club_id === 2));
  check('after leaving, the app is back on the remaining club', (await p2.textContent('#date')).includes('ก๊วนแบด'));
  await p2.click('#setBtn');
  await p2.click('details.sdetails:has(#newClubForm) > summary');
  await p2.fill('#newClubName', 'ทดลอง');
  await p2.click('#newClubForm button[type=submit]');
  await p2.waitForSelector('#addForm');
  await p2.fill('#nameIn', 'x1\nx2');
  await p2.click('#addForm button[type=submit]');
  await p2.waitForSelector('#toast:not([hidden])');
  await p2.click('#setBtn');
  await p2.click('details.sdetails:has(#deleteClubForm) > summary');
  await p2.fill('#delClubName', 'ผิดชื่อ');
  await p2.click('#deleteClubForm button[type=submit]');
  check('deleting needs the exact club name', (await db(p2)).clubs.some(c => c.name === 'ทดลอง'));
  await p2.fill('#delClubName', 'ทดลอง');
  await p2.click('#deleteClubForm button[type=submit]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  d = await db(p2);
  check('deleting a club removes it with its members', !d.clubs.some(c => c.name === 'ทดลอง') && !d.players.some(p => p.name === 'x1'));
  await p2.click('#setBtn');
  await p2.click('details.sdetails:has(.sbody p) > summary').catch(() => {});
  check('the last club cannot be left or deleted', (await p2.$('[data-act=club-leave]')) === null && (await p2.$('#deleteClubForm')) === null);

  /* ---------- pair rules and optional scores ---------- */
  await p2.click('[data-tab=people]');
  const idOf = async n => (await db(p2)).players.find(p => p.name === n && p.club_id === 1).id;
  await p2.selectOption('#ruleA', String(await idOf('Ard')));
  await p2.selectOption('#ruleB', String(await idOf('ภู')));
  await p2.selectOption('#ruleKind', 'with');
  await p2.click('#ruleForm button[type=submit]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  await p2.selectOption('#ruleA', String(await idOf('เดือน')));
  await p2.selectOption('#ruleB', String(await idOf('กร')));
  await p2.selectOption('#ruleKind', 'apart');
  await p2.click('#ruleForm button[type=submit]');
  await p2.waitForSelector('[data-act=rule-del] >> nth=1');
  check('pair rules are saved for the club', (await db(p2)).pair_rules.length === 2 && (await viewText(p2)).includes('เล่นคู่กันเสมอ'));
  await p2.click('[data-act=checkall]').catch(() => {});
  await p2.click('[data-tab=play]');
  await p2.evaluate(() => { const b = document.querySelector('[data-act=fill]:not([disabled])'); if (b) b.click(); });
  await p2.waitForTimeout(200);
  const courtsNow = await p2.$$eval('.match', els => els.map(m => [...m.querySelectorAll('.team')].map(t => [...t.querySelectorAll('.pl')].map(b => [...b.childNodes].find(n => n.nodeType === 3).textContent))));
  const flat = c => c[0].concat(c[1]);
  check('rules hold on the courts', courtsNow.length > 0 && courtsNow.every(c => !(flat(c).includes('เดือน') && flat(c).includes('กร')) && (!(flat(c).includes('Ard') || flat(c).includes('ภู')) || c.some(t => t.includes('Ard') && t.includes('ภู')))), JSON.stringify(courtsNow));
  await p2.fill('[data-act=score][data-ci="0"][data-s="0"]', '21');
  await p2.fill('[data-act=score][data-ci="0"][data-s="1"]', '15');
  await p2.click('h2');                                   // leave the score boxes
  await p2.waitForSelector('[data-act=save][data-ci="0"]');
  check('typing the score picks the winner', (await p2.$('.match >> nth=0')).$('.team.win') !== null && (await p2.textContent('[data-act=save][data-ci="0"]')).includes('ชนะ'));
  await p2.click('[data-act=save][data-ci="0"]');
  await saved(p2);
  d = await db(p2);
  check('the score is stored with the match', d.matches.some(m => m.score_a === 21 && m.score_b === 15));
  await p2.click('[data-tab=sum]');
  check('history shows the score', (await viewText(p2)).includes('21–15'));
  await p2.click('[data-tab=people]');
  await p2.click('[data-act=rule-del]');
  await p2.waitForFunction(() => !document.querySelector('.busy'));
  check('a rule can be removed', (await db(p2)).pair_rules.length === 1);

  await p2.click('#setBtn');
  await p2.click('[data-act=theme][data-v=dark]');
  check('theme switch sets dark', (await p2.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await p2.reload();
  await p2.waitForSelector('#app:not([hidden])');
  check('theme choice survives a reload', (await p2.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await p2.click('#setBtn');
  await p2.click('[data-act=theme][data-v=auto]');
  check('auto theme removes the override', (await p2.evaluate(() => document.documentElement.dataset.theme)) === undefined);
  check('no script errors in edit/admin/theme run', p2.errors.length === 0, p2.errors.join(' | '));

  /* ---------- a signed-in user who is not an admin ---------- */
  const p3 = await newPage(browser, base, 390, 844);
  await p3.evaluate(() => { localStorage.clear(); });
  await p3.reload();
  await p3.evaluate(() => { const d = window.__fakeDb(); d.club_admins = []; localStorage.setItem('fake-supabase-db', JSON.stringify(d)); });
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
