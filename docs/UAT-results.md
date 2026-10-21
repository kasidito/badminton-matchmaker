# UAT results

Automated walk of `docs/UAT.md` with `npm run uat` (fake backend, Chromium at iPad landscape, iPad portrait, phone, phone dark).

Run: 21 Oct 2026. Result: **53 pass, 0 fail, 5 manual**.

Found and fixed during this run: board mode still showed the ทีมนี้ชนะ buttons (they moved into the team cards earlier) and the ขอพัก button; both are now hidden in board mode.

## Sign in

| Result | Check | Note |
|---|---|---|
| PASS | Opening the link shows the sign-in screen |  |
| PASS | A wrong password shows an error |  |
| PASS | The admin signs in and lands on สนาม (Courts) |  |
| PASS | Closing and reopening the app keeps you signed in |  |
| PASS | The header shows Budmintan and the club name |  |

## Check-in

| Result | Check | Note |
|---|---|---|
| PASS | Pasting the full LINE post checks in everyone, ignores the date line, empty numbers and footer |  |
| PASS | A new name in the post is added and asks for a starting bird |  |
| PASS | Courts are set from "3 สนาม" |  |
| PASS | Picking a starting bird sets the starting MMR |  |
| PASS | A near spelling asks "ใช่คนเดิมไหม" instead of adding a duplicate |  |
| PASS | Toggling a member's switch checks them out |  |
| PASS | and back in |  |

## Courts

| Result | Check | Note |
|---|---|---|
| PASS | สุ่มลงสนามว่าง fills every empty court; nobody is on two courts |  |
| PASS | Each court shows Team A and B with average MMR and win chance |  |
| PASS | ทีมนี้ชนะ highlights the winner; tapping again clears it |  |
| PASS | บันทึกผล only appears once a winner is picked |  |
| PASS | After บันทึกผล the court is empty and stays empty |  |
| PASS | สุ่มใหม่ changes the players and does not count a match |  |
| PASS | Undo reverses the last draw |  |
| PASS | Court mode chip cycles ปกติ → แข่งขัน → สังสรรค์ |  |
| PASS | Typing an optional score picks the winner |  |

## Manual swap

| Result | Check | Note |
|---|---|---|
| PASS | Tap a player, then a player on another court: they swap |  |
| PASS | Tap a player, then a name under พักตานี้: they swap |  |
| PASS | Swapping inside one court changes partners |  |
| PASS | Swapping on a court with a winner picked clears the winner |  |

## Ranking, history and rest

| Result | Check | Note |
|---|---|---|
| PASS | Ranking moves after each saved match (winners up, losers down) |  |
| PASS | Editing a player's MMR (pencil) sticks |  |
| PASS | Bird emblems and the bird legend show |  |
| PASS | สลับผู้ชนะ flips a past result |  |
| PASS | ลบแมตช์นี้ needs a second tap and removes it |  |
| PASS | ขอพัก puts someone in "ขอพัก 1 ตา" |  |
| PASS | and the x takes them back |  |
| MANUAL | Win chance and rating use OpenSkill; ยังไม่นิ่ง shows for new players | covered by unit tests; check the numbers feel right on a real night |

## Saving and connection

| Result | Check | Note |
|---|---|---|
| PASS | The header shows บันทึกแล้ว after each change |  |
| PASS | Offline: the app keeps working and the header warns |  |
| PASS | Back online it saves (บันทึกแล้ว) and the matches are in the database |  |
| PASS | Refreshing mid-session brings results back |  |
| MANUAL | A second device shows the same night | needs two real devices |
| MANUAL | The night is visible in Supabase (Table editor → matches) | check once in the dashboard |

## Summary, LINE and stats

| Result | Check | Note |
|---|---|---|
| PASS | ส่งไป LINE shares ranking, games per person, no emoji |  |
| PASS | ทุกคืน lists members with games, win %, MMR |  |

## End of night

| Result | Check | Note |
|---|---|---|
| PASS | จบเกมวันนี้ needs two taps and closes the night |  |
| PASS | MMR and uncertainty carry over to next time |  |
| PASS | Summary → เกมที่จบแล้ว shows tonight |  |
| PASS | A new night starts with nobody checked in |  |
| PASS | เริ่มเกมใหม่ resets ratings to the starting birds |  |
| PASS | and undo brings them back |  |

## Layout

| Result | Check | Note |
|---|---|---|
| PASS | iPad landscape: one-row header with the menu, no bottom bar, 3 courts in a row | {"tabsFixed":false,"dock":"none","oneRow":true,"perRow":1} |
| PASS | iPad portrait: bottom menu, nothing scrolls sideways on any tab |  |
| PASS | Phone: bottom menu, nothing scrolls sideways on any tab |  |
| PASS | Phone dark: bottom menu, nothing scrolls sideways on any tab |  |
| PASS | Board mode shows big names and hides every button on the courts |  |
| MANUAL | Add to Home Screen shows the Budmintan icon and opens full screen | needs the real iPad / iPhone |

## Clubs, admins and pair rules

| Result | Check | Note |
|---|---|---|
| PASS | Settings shows ก๊วน, ผู้ดูแลก๊วน, บัญชี and ข้อมูลและขั้นสูง |  |
| PASS | Adding a second admin works |  |
| PASS | A pair rule can be added (คู่พิเศษ) |  |
| MANUAL | Forgot password email arrives | needs the real Supabase with SMTP set up |

## Overall

| Result | Check | Note |
|---|---|---|
| PASS | No script errors during the whole walk |  |
