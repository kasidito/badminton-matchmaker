// Runs tools/google-sheet-report.gs against a tiny in-memory imitation of SpreadsheetApp.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(token) {
  const sheets = {};
  function makeSheet(name) {
    const rows = [];
    const sh = {
      rows,
      appendRow: r => rows.push(r.slice()),
      setFrozenRows: () => {}, getLastRow: () => rows.length,
      getRange: (r, c, nr, nc) => ({
        setFontWeight: () => {},
        getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)),
        setValues: v => { v.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); },
        clearContent: () => { rows.splice(r - 1, nr); }
      })
    };
    return sh;
  }
  sheets['ชีต1'] = makeSheet('ชีต1');
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.keys(sheets).map(n => Object.assign(sheets[n], { getName: () => n })), deleteSheet: sh => { delete sheets[sh.getName()]; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
    JSON, String, Date
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'google-sheet-report.gs'), 'utf8')
    .replace("const TOKEN = 'PASTE_THE_TOKEN_FROM_THE_APP';", `const TOKEN = '${token}';`);
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const post = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  // values created inside the vm context belong to another realm; copy them out for deep comparisons
  const plain = x => JSON.parse(JSON.stringify(x));
  return { post, sheets, plain, setup: () => ctx.setup() };
}

const report = {
  token: 't0k', nightId: 7, date: '2026-10-21', label: 'วันพุธที่ 21 ตุลาคม 2569', matchCount: 1,
  players: [{ name: 'ชิน', level: 'เก่ง', played: 1, won: 1, lost: 0, mmrStart: 1700, mmrEnd: 1712 },
            { name: 'โฟล์ค', level: 'กลาง', played: 1, won: 0, lost: 1, mmrStart: 1500, mmrEnd: 1490 }],
  matches: [{ no: 1, court: 1, mode: 'ปกติ', teamA: 'ชิน + เดือน', teamB: 'โฟล์ค + ภู', winner: 'A', start: '20:05', end: '20:21' }],
  ranking: [{ name: 'ชิน', mmr: 1712, level: 'เก่ง', career: 11 }, { name: 'โฟล์ค', mmr: 1490, level: 'กลาง', career: 3 }]
};

test('rejects a wrong token and an unset token', () => {
  assert.strictEqual(load('t0k').post({ token: 'nope', test: true }).ok, false);
  assert.match(load('PASTE_THE_TOKEN_FROM_THE_APP').post({ token: 'x', test: true }).error, /TOKEN/);
});

test('test ping succeeds without writing anything', () => {
  const s = load('t0k');
  assert.strictEqual(s.post({ token: 't0k', test: true }).ok, true);
  assert.deepStrictEqual(Object.keys(s.sheets), ['ชีต1']);
});

test('writes nights, players, matches and ranking; ignores a resend', () => {
  const s = load('t0k');
  assert.strictEqual(s.post(report).ok, true);
  assert.strictEqual(s.sheets['คืน'].rows.length, 2);
  assert.strictEqual(s.sheets['ผู้เล่นรายคืน'].rows.length, 3);
  assert.deepStrictEqual(s.plain(s.sheets['ผู้เล่นรายคืน'].rows[1].slice(2)), ['ชิน', 'เก่ง', 1, 1, 0, 1700, 1712, 12]);
  assert.strictEqual(s.sheets['แมตช์'].rows[1][7], 'ชิน + เดือน');
  assert.deepStrictEqual(s.plain(s.sheets['อันดับล่าสุด'].rows.map(r => r[1])), ['ชื่อ', 'ชิน', 'โฟล์ค']);
  const again = s.post(report);
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(s.sheets['ผู้เล่นรายคืน'].rows.length, 3);
});

test('ranking is replaced, not appended, on the next night', () => {
  const s = load('t0k');
  s.post(report);
  s.post(Object.assign({}, report, { nightId: 8, ranking: [{ name: 'โฟล์ค', mmr: 1520, level: 'กลาง', career: 4 }] }));
  assert.deepStrictEqual(s.plain(s.sheets['อันดับล่าสุด'].rows.map(r => r[1])), ['ชื่อ', 'โฟล์ค']);
  assert.strictEqual(s.sheets['คืน'].rows.length, 3);
});

test('setup creates the four tabs and removes the empty default tab', () => {
  const s = load('t0k');
  s.post; // loaded
  vmSetup(s);
  assert.deepStrictEqual(Object.keys(s.sheets).sort(), ['คืน', 'ผู้เล่นรายคืน', 'อันดับล่าสุด', 'แมตช์'].sort());
});
function vmSetup(s) { s.setup(); }
