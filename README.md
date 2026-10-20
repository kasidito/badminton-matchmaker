# จัดคู่ก๊วนแบด (Badminton Matchmaker)

A web app for running a badminton club night. The admin checks players in, the app draws doubles matches court by court so everyone plays a similar number of games, results go into an MMR ranking, and every match is saved to Supabase.

Built for one admin on an iPad or phone at the court. Players do not log in.

## What it does

- **Check-in**: paste the LINE sign-up post ("1. ชิน 2. โฟล์ค …"). Existing members are checked in and new names are added.
- **Fair rotation**: whoever has played the fewest matches goes on next; ties go to whoever has waited longest. Late arrivals start level with the person who has played least.
- **Court by court**: each court is drawn, played and saved on its own. Saving a result leaves the court empty until the admin draws it again. Nothing is drawn automatically.
- **Manual swap**: tap a player, then tap another player on any court or in the queue to swap them.
- **Court modes**: Normal, Competitive (close ratings) and Social (strong and new players mixed, half MMR weight), set per court.
- **MMR**: Elo-based, team aware. Starting level sets the first rating (beginner 1300, intermediate 1500, advanced 1700).
- **History**: fix or delete any of tonight's results and ratings recalculate. "End day" closes the night and carries MMR forward.
- **Works offline**: every change is kept on the device and saved to Supabase as soon as the connection is back. The header shows the save status.
- **iPad layouts** for portrait and landscape, plus a big-text board mode for a screen beside the court.

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
3. Make that user an admin (SQL editor):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
4. Authentication → URL Configuration: set the Site URL to the GitHub Pages address.

Row level security allows nothing unless the signed-in user is in `public.admins`. The key in `js/config.js` is the publishable key, which is meant to be public. Never commit the `service_role` key.

### Hosting on GitHub Pages

Repository → Settings → Pages → Deploy from a branch → `main` / root. The site appears at `https://<user>.github.io/badminton-matchmaker/`.

## Tests

```bash
npm test              # unit tests for js/algo.js (Node 18+)
npm run e2e           # both UI runs against the fake Supabase (needs Playwright + Chromium)
                      #   tests/smoke.js  main evening on iPad landscape
                      #   tests/flows.js  phone width, undo, reset, import, late arrival, non-admin
```

## Data model

| Table | Holds |
|---|---|
| `players` | members, level, MMR carried into the next night, career match count |
| `sessions` | one row per club night; `state` is the live snapshot used to resume |
| `session_players` | who was checked in that night |
| `matches` | finished matches in order, court, mode, teams, winner |
| `match_players` | each player's MMR before and after every match |
| `rating_adjustments` | manual MMR edits |
| `admins` | users allowed to use the app |

`sync_session()` rewrites one open night's rows in a single transaction, so fixing an old result, deleting a match or undoing is always consistent. `close_session()` ends the night and stores each player's carried MMR.

## Roadmap

- Google Sheet report appended on End day
- Rating system upgrade to OpenSkill, recalculated from stored history
- Cost split (court and shuttlecocks)
