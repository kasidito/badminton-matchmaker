# Roadmap

Status as of 21 Oct 2026, 00:30. Owner decides order; update this file when something ships or changes.

## Now: get to UAT

| # | Task | Who | Status |
|---|---|---|---|
| 1 | Supabase → Authentication → URL Configuration: Site URL + Redirect URL = the Pages address (for forgot password) | Owner | Waiting |
| 2 | Wed 21 Oct: run the night on the old app, press "คัดลอกข้อมูลสำรอง" at the end, then import it (Settings → ข้อมูลและขั้นสูง → นำเข้าจากแอปเดิม) | Owner | Waiting |
| 3 | Run `docs/UAT.md` on the iPad and the phone; report issues | Owner | Waiting |
| 4 | Add a second admin to ก๊วนแบด as a backup (forgot-password emails only reach Supabase team members) | Owner | Suggested |
| 5 | Optional: leaked password protection (Supabase advisor; needs a paid plan) | Owner | Optional |

## Shipped (20–21 Oct)

- Sporty look (design C), no stripes, light/dark/auto, app name **Budmintan**, home-screen icon
- Courts banner: matches, play time, games per person, who sits out (tap to swap), ขอพัก (sit out one draw)
- Bird ranks as emblems (ลูกเจี๊ยบ → ฟีนิกซ์), rank-up toast, legend on the ranking tab
- Five starting levels and a level picker for new names
- Edit member name and MMR; other admins (add with starting password, remove, reset password)
- **Clubs**: players and nights per club, create/switch/rename clubs, admins per club, permissions checked in the database
- Settings regrouped in two fixed columns
- Tests: unit, two UI runs, seeded random long runs (`npm run explore`), database permission replay (`npm run test:db`)

## Next (suggested, owner to pick)

| # | Item | Size | Why |
|---|---|---|---|
| 1 | Name matching on check-in: "ใช่คนเดิมไหม" for near-identical names, remember nicknames | S | LINE posts spell names differently; avoids duplicate members |
| 2 | Copy tonight's summary to LINE (ranking, games per person, rank-ups) | S | Players see results without logging in |
| 3 | In-app stats: all-time table, MMR chart per player, best partner, attendance | M | Replaces the Google Sheet idea |
| 4 | Court timer alert (court over 20 min) and "สนามนี้นานสุด" on the banner | S | Fairness on busy nights |
| 5 | Leave a club / delete an empty club | S | Clean-up after testing clubs |
| 6 | Email sending through a free SMTP (e.g. Resend) for forgot password and new-admin invites | M | Today emails only reach Supabase team members |
| 7 | OpenSkill ratings: compute from `match_players` history after 4–6 weeks, compare with Elo | M | Owner approved, waiting for data |
| 8 | Remove Google Sheet code (owner skipped it) | S | Less to maintain |
| 9 | Offline queue for adding members (today needs internet) | M | Bad wifi at the court |

## Later / ideas

- Optional score entry (e.g. 21–15) feeding MMR margin
- Pair rules: always together / never together
- Leaving at a set time
- Monthly or seasonal leaderboards (season reset toward 1500, best rank of the season)
- Read-only link for players (only if the admin-only rule changes)
- Cost split (court + shuttles), paid checkbox. **On hold by owner's decision, 20 Oct 2026.**
