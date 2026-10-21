# UAT checklist

Run on the iPad you'll use at the court, in landscape and portrait. Mark each line Pass / Fail and note anything odd.

Tester: ______  Date: ______  Device: ______

## 1. Sign in
- [ ] Opening the link shows the sign-in screen
- [ ] A wrong password shows an error
- [ ] The admin account signs in and lands on สนาม (Courts)
- [ ] Closing and reopening the app keeps you signed in
- [ ] A non-admin account sees "บัญชีนี้ยังไม่ใช่ผู้ดูแล" and no data

## 2. Check-in
- [ ] Pasting the full LINE post checks in everyone listed, ignores the date line, empty numbers and the footer
- [ ] A new name in the post is added as a member
- [ ] Toggling a member's switch checks them in or out
- [ ] Changing a level changes their starting MMR (Ranking tab)
- [ ] A late arrival checked in mid-session goes to the front of the queue but doesn't jump ahead of people with fewer matches

## 3. Courts
- [ ] สุ่มลงสนามว่าง fills every empty court; nobody is on two courts
- [ ] Each court shows Team A and Team B clearly, with average MMR and win chance
- [ ] ทีมนี้ชนะ highlights the winner; tapping it again clears it
- [ ] บันทึกผล is disabled until a winner is picked
- [ ] After บันทึกผล the court is **empty** and stays empty until you draw it
- [ ] สุ่มสนามนี้ใหม่ changes the players and doesn't count a match
- [ ] Undo (ย้อนกลับ) reverses the last save, draw, redraw or swap
- [ ] Court mode chip cycles ปกติ → แข่งขัน → สังสรรค์

## 4. Manual swap
- [ ] Tap a player, then a player on another court: they swap
- [ ] Tap a player, then a name in the queue: the queued player goes on, the other goes to the queue
- [ ] Swapping inside one court changes partners
- [ ] Swapping on a court with a winner picked clears the winner

## 5. Ranking and history
- [ ] Ranking changes after each saved match; the weaker partner gains more for a win
- [ ] Editing a player's MMR (pencil) sticks after more matches
- [ ] Summary → สลับผู้ชนะ flips a past result and the ranking updates
- [ ] Summary → ลบแมตช์นี้ removes it and match counts update

## 6. Saving and connection
- [ ] The header shows บันทึกแล้ว a moment after each change
- [ ] Turn on Airplane mode, save a result: the app keeps working and the header shows a warning
- [ ] Turn Airplane mode off: tap the warning (or wait), it changes to บันทึกแล้ว
- [ ] Refresh the page mid-session: courts, queue and results come back
- [ ] Open the app on a second device: it shows the same night (last saved state)
- [ ] In Supabase (Table editor → matches) the night's matches are there

## 7. End of night
- [ ] Gear → จบเกมวันนี้และเก็บสถิติ needs two taps
- [ ] After it: Summary → เกมที่จบแล้ว shows tonight with the ranking
- [ ] A new night starts with nobody checked in and MMR carried over
- [ ] เริ่มเกมใหม่ (รีเซ็ต MMR) clears tonight and resets ratings to levels; undo brings it back

## 8. Layout
- [ ] iPad landscape: header on one row, courts two per row, queue on the right, no bottom bar
- [ ] iPad portrait: courts two per row, queue below, fill button at the bottom
- [ ] Phone: everything readable, nothing cut off or scrolling sideways
- [ ] Board mode (screen icon) shows big names and hides buttons
- [ ] Dark mode is readable

## 9. New in this release
- [ ] Before anyone checks in, the Courts tab shows a short "เริ่มคืนนี้" guide and the bottom button goes to check-in
- [ ] Players tab: "มาวันนี้" list on top, "ยังไม่มา" folded below; delete icons only appear after pressing "ลบสมาชิก"
- [ ] A court shows "บันทึกผล: <winners> ชนะ" only after a winner is picked
- [ ] Signing in before club night shows "ยังไม่เปิดคืน" in the header; the first check-in changes it to tonight's date
- [ ] The first empty court shows "ถัดไป" with 4 names; สุ่มลงสนามนี้ puts exactly those 4 on that court
- [ ] The undo button in the header steps back several actions, even after the bottom message has gone
- [ ] ลบแมตช์นี้ needs a second tap
- [ ] Settings → ดาวน์โหลดข้อมูลทั้งหมด downloads a .json file
- [ ] Settings → เปลี่ยนรหัสผ่าน works; sign out and in with the new password
- [ ] Sign-in → ลืมรหัสผ่าน sends an email; its link opens the app and lets you set a new password

## 10. Import from the old app
- [ ] Old app: Settings → คัดลอกข้อมูลสำรอง; new app: Settings → นำเข้าจากแอปเดิม → นำเข้า
- [ ] Players are matched by name, new ones are added, matches and past days appear

Issues found:

| # | Step | What happened | Expected |
|---|---|---|---|
| | | | |

## 11. Release 21 Oct
- [ ] Paste a post with a near spelling (e.g. "นัท ซ้าย"): the Players tab asks "ใช่คนเดิมไหม"; ใช่ checks in the member and next time the same spelling checks in without asking; คนใหม่ adds a new member
- [ ] Turn on airplane mode, check in a new name: it appears with "รอบันทึก"; turn the network back on: the tag disappears and the member is saved
- [ ] Summary tab → ส่งไป LINE opens the share sheet (or copies); the text has the ranking, rank-ups and games per person
- [ ] Summary tab → ทุกคืน lists members with nights, games, win %, MMR; tapping one shows the MMR graph, best partner and toughest opponent
- [ ] Settings → ก๊วน → create a test club, then ออกจากก๊วน หรือลบก๊วน → delete it by typing its name; you are back in ก๊วนแบด
- [ ] Ratings: a new player moves about ±30 per match, players with more games move less; "ยังไม่นิ่ง" shows for roughly the first 10 matches

