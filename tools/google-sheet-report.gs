/**
 * Google Apps Script: receives the end-of-night report from the badminton app and writes it
 * into the spreadsheet this script is attached to. Setup steps are in README.md
 * ("Google Sheet report").
 *
 * Sheets it creates and fills:
 *   คืน              one row per night (date, label, night id, matches, players, sent at)
 *   ผู้เล่นรายคืน      one row per player per night (played, won, lost, MMR start/end/change)
 *   แมตช์             one row per match
 *   อันดับล่าสุด       current ranking, rewritten every night
 *
 * Sending the same night twice is safe: the second copy is ignored.
 */

// Paste the token shown in the app (Settings → รายงาน Google Sheet → สร้างรหัสใหม่ → คัดลอกรหัส).
const TOKEN = 'PASTE_THE_TOKEN_FROM_THE_APP';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!TOKEN || TOKEN.indexOf('PASTE') === 0) return reply({ ok: false, error: 'ยังไม่ได้ใส่ TOKEN ในสคริปต์' });
    if (body.token !== TOKEN) return reply({ ok: false, error: 'รหัส (token) ไม่ตรงกับในสคริปต์' });
    if (body.test) return reply({ ok: true, test: true });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const id = String(body.nightId || body.date);

      const nights = sheet(ss, 'คืน', ['วันที่', 'คืน', 'รหัสคืน', 'จำนวนแมตช์', 'จำนวนผู้เล่น', 'ส่งเมื่อ']);
      const seen = nights.getLastRow() > 1
        ? nights.getRange(2, 3, nights.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); })
        : [];
      if (seen.indexOf(id) >= 0) return reply({ ok: true, duplicate: true });
      nights.appendRow([body.date, body.label, id, body.matchCount, body.players.length, new Date()]);

      append(sheet(ss, 'ผู้เล่นรายคืน', ['วันที่', 'รหัสคืน', 'ชื่อ', 'ระดับ', 'เล่น', 'ชนะ', 'แพ้', 'MMR เริ่ม', 'MMR จบ', 'เปลี่ยน']),
        body.players.map(function (p) {
          return [body.date, id, p.name, p.level, p.played, p.won, p.lost, p.mmrStart, p.mmrEnd, p.mmrEnd - p.mmrStart];
        }));

      append(sheet(ss, 'แมตช์', ['วันที่', 'รหัสคืน', 'แมตช์', 'สนาม', 'โหมด', 'ทีม A', 'ทีม B', 'ทีมที่ชนะ', 'เริ่ม', 'จบ']),
        body.matches.map(function (m) {
          return [body.date, id, m.no, m.court, m.mode, m.teamA, m.teamB, m.winner === 'A' ? m.teamA : m.teamB, m.start, m.end];
        }));

      const rank = sheet(ss, 'อันดับล่าสุด', ['อันดับ', 'ชื่อ', 'ระดับ', 'MMR', 'แมตช์สะสม']);
      if (rank.getLastRow() > 1) rank.getRange(2, 1, rank.getLastRow() - 1, 5).clearContent();
      append(rank, body.ranking.map(function (r, i) { return [i + 1, r.name, r.level, r.mmr, r.career]; }));

      return reply({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

const SHEETS = {
  'คืน': ['วันที่', 'คืน', 'รหัสคืน', 'จำนวนแมตช์', 'จำนวนผู้เล่น', 'ส่งเมื่อ'],
  'ผู้เล่นรายคืน': ['วันที่', 'รหัสคืน', 'ชื่อ', 'ระดับ', 'เล่น', 'ชนะ', 'แพ้', 'MMR เริ่ม', 'MMR จบ', 'เปลี่ยน'],
  'แมตช์': ['วันที่', 'รหัสคืน', 'แมตช์', 'สนาม', 'โหมด', 'ทีม A', 'ทีม B', 'ทีมที่ชนะ', 'เริ่ม', 'จบ'],
  'อันดับล่าสุด': ['อันดับ', 'ชื่อ', 'ระดับ', 'MMR', 'แมตช์สะสม']
};

/** Run once from the Apps Script editor: creates the four tabs and asks for permission. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) { sheet(ss, name, SHEETS[name]); });
  ss.getSheets().forEach(function (sh) {
    if (!SHEETS[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function sheet(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}

function append(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
