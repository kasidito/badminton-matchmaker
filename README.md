# Budmintan (จัดคู่ก๊วนแบด)

A web app for running a badminton club night. The admin checks players in, the app draws doubles matches court by court so everyone plays a similar number of games, results go into an MMR ranking, and every match is saved to Supabase.

Built for one admin on an iPad or phone at the court. Players do not log in.

## What it does

- **Check-in**: paste the LINE sign-up post as it is ("พุธ … 3 สนาม / 1. ชิน 2. โฟล์ค …"). Existing members are checked in, new names are added, and the court count is taken from "N สนาม" if play hasn't started. Names spelled close to an existing member are asked about ("ใช่คนเดิมไหม") and the spelling is remembered. New members can be added offline; they are saved when the connection is back.
- **Fair rotation**: whoever has played the fewest matches goes on next; ties go to whoever has waited longest. Late arrivals start level with the person who has played least.
- **Court by court**: each court is drawn, played and saved on its own. Saving a result leaves the court empty until the admin draws it again. Nothing is drawn automatically.
- **Manual swap**: tap a player, then tap another player on any court or in the queue to swap them.
- **Court modes**: Normal, Competitive (close ratings) and Social (strong and new players mixed, half MMR weight), set per court.
- **MMR**: OpenSkill (Weng-Lin) on an MMR-like scale, with uncertainty per player. Five starting levels (1200–1800). Six bird ranks from ลูกเจี๊ยบ to ฟีนิกซ์.
- **History**: fix or delete any of tonight's results and ratings recalculate. "End day" closes the night and carries MMR forward.
- **Undo**: every draw, save, swap, reset and MMR edit can be undone step by step from the header, for the whole night.
- **Next up**: the first empty court shows the 4 people the next draw will take.
- **LINE summary**: one tap shares tonight's (or any past night's) ranking, rank-ups and games per person through the phone's share sheet.
- **All-time stats**: nights, games, win rate, MMR graph, best partner, toughest opponent and longest win streak per member.
- **Clubs**: separate ก๊วน with their own members, nights and admins.
- **Backups**: Settings → ดาวน์โหลดข้อมูลทั้งหมด saves every table as a JSON file.
- **Password**: forgot-password email and change-password in Settings.
- **Works offline**: every change is kept on the device and saved to Supabase as soon as the connection is back. The header shows the save status.
- **iPad layouts** for portrait and landscape; a sun/moon button in the header switches light and dark.

## Using it

1. Open the app link and sign in with the admin email and password.
2. **ผู้เล่น (Players)**: paste tonight's LINE post and press เช็กอิน / เพิ่ม. Set each new player's level.
3. **สนาม (Courts)**: press สุ่มลงสนามว่าง to fill the courts.
4. When a match ends: tap ทีมนี้ชนะ on the winning team, then บันทึกผล. Draw that court again when you're ready.
5. At the end of the night: gear icon, then จบเกมวันนี้และเก็บสถิติ (tap twice to confirm).

The header pill shows บันทึกแล้ว (saved), รอบันทึก / กำลังบันทึก (saving), or a warning if saving failed. Tap the warning to retry. Don't clear the browser's data while it shows a warning.

## Project layout

```
index.html            page shell, icon sprite, script tags
css/app.css           all styles (light/dark tokens, phone and iPad layouts)
js/config.js          Supabase URL and publishable key (safe to commit)
js/algo.js            matching, MMR and parsing rules — pure functions, unit tested
js/db.js              Supabase calls
js/app.js             UI, local cache, background sync
supabase/migrations/  database schema and functions, in the order applied
tests/                unit tests and an end-to-end smoke test with a fake Supabase
docs/UAT.md           user acceptance test checklist
CLAUDE.md             decisions and conventions for anyone (or any AI) changing the code
```

No build step. The files are served as they are.

## Setup

### Supabase

Project `badminton-matchmaker` (Singapore, `vhvlhuimelqsnglhayxs`).

1. Apply the files in `supabase/migrations/` in name order (SQL editor, or `supabase db push`).
2. Authentication → Users → **Add user** with the admin's email and a password.
3. Make that user the admin of a club (SQL editor). After that, admins add other admins and new clubs from the app (Settings → ก๊วน / ผู้ดูแลก๊วน), through the `manage-admins` edge function:
   ```sql
   insert into public.clubs (name) values ('ก๊วนแบด');
   insert into public.club_admins (club_id, user_id)
   select (select max(id) from public.clubs), id from auth.users where email = 'you@example.com';
   ```
   Deploy `supabase/functions/manage-admins` (verify JWT on).
4. Authentication → URL Configuration: set **Site URL** to `https://kasidito.github.io/budmintan/` and add the same address under **Redirect URLs**. The forgot-password email links back here.

Row level security limits every row to the admins of its club (`club_admins`); a signed-in user who runs no club sees nothing. The key in `js/config.js` is the publishable key, which is meant to be public. Never commit the `service_role` key.

### Email (forgot password)

Supabase's built-in mailer only reaches members of the Supabase organisation. To email every admin, set custom SMTP:

- **No domain (simplest): Gmail.** Google account → Security → turn on 2-Step Verification → App passwords → create one named "Supabase" (16 characters).
  Supabase → Authentication → Emails → SMTP Settings → enable custom SMTP: host `smtp.gmail.com`, port `587`, username = the Gmail address, password = the app password, sender email = the same Gmail, sender name `Budmintan`. Save. Gmail allows about 500 emails a day.
- **With your own domain: Resend** (free tier). Verify the domain in Resend, create an API key, then the same SMTP screen: host `smtp.resend.com`, port `465`, username `resend`, password = the API key. Without a verified domain Resend only delivers to the Resend account's own email.
- Optional: Authentication → Emails → Templates → Reset password, Thai subject "ตั้งรหัสผ่านใหม่ Budmintan"; and Security notifications → Password changed, to email admins when their password changes.

### Hosting on GitHub Pages

Repository → Settings → Pages → Deploy from a branch → `main` / root. The site appears at `https://<user>.github.io/budmintan/ (repo renamed from badminton-matchmaker on 21 Oct 2026; GitHub does not redirect the old Pages address)`.

## Tests

```bash
npm test              # unit tests: js/algo.js and the Apps Script (Node 18+)
npm run e2e           # both UI runs against the fake Supabase (needs Playwright + Chromium)
                      #   tests/smoke.js  main evening on iPad landscape
                      #   tests/flows.js  phone width, undo, reset, import, late arrival, admins, clubs, non-admin
npm run explore       # seeded random long run (phone + iPad, light + dark) with invariant checks: node tests/explore.js [seed] [steps]
npm run test:db       # replays every migration in PGlite and checks what each kind of user can read and write
```

## Data model

| Table | Holds |
|---|---|
| `clubs` | ก๊วน; every player and night belongs to one |
| `club_admins` | who runs which club |
| `players` | members of a club, level, MMR carried into the next night, career match count |
| `sessions` | one row per club night; `state` is the live snapshot used to resume |
| `session_players` | who was checked in that night |
| `matches` | finished matches in order, court, mode, teams, winner |
| `match_players` | each player's MMR before and after every match |
| `rating_adjustments` | manual MMR edits |

`sync_session()` rewrites one open night's rows in a single transaction, so fixing an old result, deleting a match or undoing is always consistent. `close_session()` ends the night and stores each player's carried MMR.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).
