# J&L Recruitment App: handover for Claude

The recruitment app for **LINK Marketing** and **JUSS Marketing** (Angad runs both). It covers check-in QR, the presenter's room rating and notes, the candidate's evaluation, the booker's call outcomes and call log, Chase, Day 1 (New Starts List, reminders, arrivals), new-starter onboarding, the incentive, and phone alerts. About 80 people use it: admins (Angad, Jess, Satpal, Rubal), the recruitment team (Jess and Rubal), bookers and presenters. **Fiza Iqbal left the business on 26 Oct 2026**: Angad deleted her account that day (the app switched it off instead, because she has candidates, so her history stays in pay and All). Don't add her back to anything. Built in a Claude Code cloud session from 12 to 18 Oct 2026, then handed to Angad's Windows PC: since 18 Oct 2026 it's looked after from the folder `Desktop\Claude playground\J&L Recruitment App` (this repo's clone).

**Working with Angad:** he's not technical and usually on his phone. Give plain English, the exact clicks, and links. Be direct. Stress-test his ideas and tell him if one is weak. Show the data. Never send him code to edit by hand except pasting `Code.gs` (below).

## How it fits together
- **`app/src/`**: the source.
  - `Code.gs` is the server: Google Apps Script bound to the Google Sheet (ID in `app/SETUP.md`). All the data and rules live there.
  - `JS.html`, `Styles.html`, `Logos.html`, `QR.html` and `Bulletin.html` are the app.
- **`app/build.js`**: builds the static app into **`join/`** (committed; hosting serves it as-is, with no build step). Run `node app/build.js` after every change under `app/src/`.
- **`join/config.js`**: the Apps Script web app URL and the OneSignal App ID. The build never overwrites it.
- **Hosting:**
  - **Vercel** at `https://jl-recruitment.vercel.app/` (since 18 Oct 2026): project `jl-recruitment` in the Vercel team "Link Marketing" (Pro), Git-connected to this repo, so every merge to `main` goes live in about a minute. `vercel.json` at the root serves `join/`.
  - **GitHub Pages** at the old address `https://angadclaude.github.io/recruitment/join/` stays on only to forward old links, QR codes and home-screen icons to Vercel (`app/move.js`). Keep it on, and keep the repo public (Pages and the raw `Code.gs` links need that).
  - Where the app lives is set in `app/site.json` (`url` + `movedFrom`); `CONFIG.PUBLIC_URL` in `Code.gs` must match `url`.
- **Alerts:** OneSignal web push. The REST API key is a Script Property in Apps Script; it must never go in chat or GitHub.
- **Sheet columns:** new columns append themselves (`readTable` plus `tidyHeaders`). Never reorder or insert columns by hand.
- **The Supabase back end (live since 19 Oct 2026, PR #79):** the same `Code.gs` runs on Vercel, unchanged. The app (`join/config.js` `API_URL: '/api/rpc'`) talks only to Vercel, and the data lives in Supabase, not the Sheet. Google's copy of `Code.gs` only runs the relay.
  - `server/worker.js` runs `Code.gs` in a worker thread with the Google services rebuilt on Postgres: each Sheet tab = `jl.tabs` + `jl.rows` (ordered), CacheService = `jl.cache`, PropertiesService = `jl.props`, LockService = a Postgres advisory lock. Code.gs is synchronous, so every database call waits on the main thread (`server/runtime.js`, Atomics).
  - `server/runtime.js`: one job = one transaction, one job at a time per instance. Emails go into `jl.outbox` and are sent after the commit.
  - `server/live.js` wires it to Supabase (the shared project; schema `jl`, next to FR's `public`, `leaders` and `hf`), OneSignal, and Google's **email relay**.
  - The relay is the Google-only part of `Code.gs` (`relayMail`, `relayInfo`, `relayExport`, `relayFreeze`, `relaySwitch`, `relayMirror`, `relayEarnings`, `relayBell`). Emails still go out from Gmail ("send mail as" Jess / Rubal / Fiza), and the OneSignal key stays in Google. Calls carry Vercel's `RELAY_SECRET`; `Code.gs` holds only its SHA-256 (`RELAY_SECRET_SHA256`).
  - `api/rpc.js` is the app's API (same requests and answers as Google's `/exec`). `api/cron.js` is Vercel Cron every 5 minutes, replacing Google's timers in London time. It does nothing until `jl.props.VERCEL_LIVE` is set.
  - `scripts/import-from-google.js` copies every tab and setting from Google, then compares them field by field (`--apply`, `--verify`).
  - Local secrets in the repo root (gitignored): `.env.supabase`, `.env.relay`, `.env.cron`.
  - **Safety nets (28 Oct stress test):** every once-a-day alert claims its key with `claim(key, val)` before it sends (the lock commits it on Vercel), and each keepWarm step runs on its own. A database step that fails inside a job fails the job (`dbFailed` in `runtime.js`: Postgres would silently roll the whole job back). Each email is claimed (`jl.outbox.claimed_at`) before it's sent, so the 5-minute retry can't send it twice. The cron's daily claim is one statement. `api/rpc.js` re-checks `VERCEL_LIVE` every 30 s.
  - **Test it the same way:** `$env:JL_BACKEND = "pg"` makes `app/dev/server.js` (and so e2e/speed/room) run on this back end with PGlite (in-memory Postgres). Both back ends must pass everything.

## Shipping a change
1. Branch from `main` and edit `app/src/`. Then run `node app/build.js`.
2. Run the tests:
   - **Main suite:** `node app/dev/e2e.js <scratch folder>` (e.g. `/tmp/shots`). The argument is where screenshots go, never `join/`. It must be **all ✓**: 379 checks at handover.
   - **Other harnesses:**
     - `dev/speed.js`: must print ALL INSTANT.
     - `dev/room.js`: busy room, 20 check-ins; `CPU=10` for a slow phone.
     - `dev/move-test.js`: address moves.
     - `dev/book.js`: booking a presentation after the call (both back ends, 49 checks).
     - `dev/hyrre.js`: Megan's bookings from Hyrre (both back ends, 51 checks).
     - `dev/backend.js`: the Vercel back end's safety nets on PGlite (a daily alert claimed before it goes, a failed database step fails the job, an email claimed before it's sent, outbox kept 14 days).
   - **Needs:** Node 22+ and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). `pdftotext` is optional.
   - **On Angad's PC (PowerShell):** Playwright is installed in `%LOCALAPPDATA%\jl-recruitment-tools`, so first run `$env:NODE_PATH = "$env:LOCALAPPDATA\jl-recruitment-tools\node_modules"`. Run the harnesses one at a time: with `speed.js` running alongside, an e2e step (Chase → Nudge all) once timed out. Alone, e2e passes 379/379 on UK time and on UTC. Git is at `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (not on PATH in older shells). This clone has `core.autocrlf=false`: keep files LF, or the build's version hash changes. `private/` (ignored locally) holds files that must never go in this public repo.
   - **Test browser clocks** follow the fake server clock (`setTime`), so tests don't depend on today's real date.
3. Commit, open a PR, merge. Vercel picks up `main` by itself within about a minute.
4. **`Code.gs` changes go live on merge**, because Vercel runs it. Angad only pastes it into Apps Script when a `relay*` function (the Google-only part) changes. On 23 Oct he was asked to paste for a welcome-email wording change; it did no harm, but it wasn't needed. When a paste is needed, give him:
   - the commit-pinned link `https://raw.githubusercontent.com/angadclaude/recruitment/<merge-sha>/app/src/Code.gs`;
   - the steps: Sheet → Extensions → Apps Script → `Code.gs` → select all → paste → Save → **Deploy → Manage deployments → ✏️ → New version → Deploy**.
5. The repo is **public**. Never commit secrets, passwords or internal business documents.

## Rules
- **Bookers** see only their own candidates. **Admins** see everyone. **Presenters** see everyone else's candidates as name, who booked them and room rating only.
- **Onboarding** (their details to copy into Databyte, the welcome email) is for admins only. **Databyte is done by hand** (Angad, 27 Oct): no Databyte buttons in the app, only the Copy boxes, and the welcome email can go any time (no lock).
- **The recruitment team** (`THANKS_TEAM` + `RECRUIT_TEAM` in `Code.gs`) send thank-yous, Day 1 details and follow-ups as LINK or JUSS, signed with their own name, and the welcome emails. Everyone else follows the candidate's company. **Only Jess and Rubal since 26 Oct** (Angad: Fiza off): `RECRUIT_TEAM` is empty; e2e puts an address back in it to keep testing it.
  - **Their LINK / JUSS tap is for that one message only (Angad, 29 Oct: "so that I don't have to keep coming back").** Jess sent Aatif Ahmed's thank-you as LINK; the tap was saved as the company he joins, so his page said "Joining LINK · messages and welcome email from Link Marketing", though Nathan, his booker, is JUSS. Now the tap is recorded on the send (`thanks_co` / `offer_co`) and never on them (`markSent`, `onboardSend`; `setBrand` is a no-op for old phones).
  - **The company someone joins = their placement (FR | HF on Day 1), else their booking's, else their booker's** (`brandCo`). Only the placement, a booker correction or a booker's move in Team changes it.
  - **The buttons:** the company they join comes first in its colours, the other one plain ("Just this one as LINK", `coPair` / `coAlt`), and that tap toasts "Sent as LINK this once · Aatif still joins JUSS" (`oneOff`).
  - **Once** (`brandTapUndone`, `BRAND_TAP_UNDONE_2`): every company from an old tap (not placed, welcome email not sent, Day 1 still to come or none) went back to their booking's (Book Appts) or else their booker's. 29 Oct live data: Julie James (Day 1 2 Nov), Riya Harjai, Joshua Carnis (Nathan asked "what does Joining LINK mean?") and 7 who declined or weren't suitable; the second pass (v2) caught the Book Appts ones the first skipped: Payam Safie, Ishaq Echenikh, John Sabharwal (every booking is JUSS). Past Day 1s were left as they happened (Nadine Rhoda, Christian Ray, Fiza Baig, Jasika Baskar).
- **Outcome deadline** is Friday 18:00 (later outcomes are marked LATE).
  - Someone in on a **Saturday or Sunday** is due the coming Friday (`outcomeDeadline`).
  - **LATE goes by the first outcome logged** (`firstOutcomeAt`): a later change (a Day 1 no-show rebooked the next week, an admin's correction) never turns an on-time outcome LATE, so past weeks' late counts don't move. The call log still marks each response that came after the deadline.
- **Day 1 tab and New Starts List order (always, Angad 25 Oct):** JUSS on top, LINK below; in each company Monday's starters then Tuesday's, by name, no-shows at the bottom (`d1Order`). That's the default; the tab can also sort *Name A–Z* and show one campaign (`d1View`), and the PDF follows what's on screen.
- **Campaign = where a starter is placed, FR or HF, per person (27 Oct).** The default is their company's (JUSS = HF, LINK = FR). An admin switches it in one tap on the Day 1 row (`setCampaign`, `campaign` column, `campaignOf` on server and app).
  - Angad's 26 Oct rule "JUSS = HF always" didn't match his own printed list: 6 of the 12 JUSS starters who arrived went to FR (orange = FR, pink = HF on the team's highlighter).
  - The Day 1 list, its PDF, availability, the poster and the results all follow the placement.
  - **The starting placement stays the booker's company** (Angad, 28 Oct, asked and answered "No"): a Book Appts applicant booked by a LINK booker starts FR on Day 1 even though their messages go as JUSS, until someone taps HF. Don't make it follow `brand`.
  - **The placement is the company they join (Angad, 28 Oct):** HF = JUSS, FR = LINK (`campBrand`). `setCampaign` sets `brand` to it, so their welcome email, welcome page, Day 1 details and every message after come from that company. Ellexie Hodson (LINK booker, moved to JUSS) still showed Link Marketing before this; `brandFollowsPlacement` fixed everyone placed whose welcome email hadn't gone (once, `BRAND_FOLLOWS_PLACEMENT`). Their booker's `company` (pay, lists) doesn't change. Their page shows "🏢 Joining JUSS · HF" when it differs from the booker's (`joinLine`).
  - **A booker corrected** (`reassignBooker`) **or a booker moved company in Team** (`saveUser` → `bookerMovedCompany`): the company they join follows the booker's, unless they're placed (then the placement's). A booking's company that wasn't the old one stays (`followCompany`); any other is dropped.
  - **A booker moves company (Angad, 28 Oct: Mamadou Bamba LINK → JUSS; Ellexie, booked by him that week, still showed LINK):** their check-ins from that week on follow them (`company` and the company they join); earlier weeks read as they happened. The Team save says "this week's N now JUSS". `companyFollowsBooker` caught up the week of 26 Oct once (`COMPANY_FOLLOWS_BOOKER`).
  - **Colours (Angad, 27 Oct):** HF = HelloFresh green, FR = NDCS purple. This applies to the marked-up New Starts List rows and the FR | HF switch. The paper used pink / orange highlighter; don't go back to those.
- **The numbers mean one thing everywhere (Angad, 26 Oct: "I don't want to explain this again"):**
  - **Checked in** = everyone.
  - **Attended / appointments** = rated in the room (walk outs too), Mon–Fri, **minus non-qualifiers**, the incentive's net (`counted(c) && !c.pay_reason`).
  - **Non-qualifiers** = came in but don't count (`notCounting`: not eligible, repeat, removed by admin).
  - **Checked in = attended + non-qualifiers + not rated.**
  - Applies to Today, the daily poster's *attended*, the Friday weekly total, Week top 5, Appts Attended (hero *Attended*, the *Bookers + booked by admins + no booker yet* line, rows say *checked in*), the Appointments total PDF (cells and total net, non-qualifiers in their own column), the 18:00 booker alert, and the Friday week and team roundups.
  - `figuresAgree` in e2e checks every one of them against each other for two weeks. Any new figure must use these definitions and join that check.
- **Bulletin (Angad, 26 + 27 Oct; "basic rules", he doesn't want to repeat them):**
  - **Two is a bell 🔔, three is a gong 💿.** Only bookers on **2 or more** are on the bulletin at all, daily Top performers and Week top 5 (`dailyRows`, `weeklyRows`). **Anyone on 1 is not on it**: no name, no "1 each" line, no "No booker yet" line. (26 Oct I'd put the 1s on a shared unnamed line so the names added up; on 27 Oct Angad said no: "anyone that gets one appointment in should not be on the bulletin".)
  - **Megan (Hyrre's AI caller) shows as "Office"** on Top performers and Week top 5 (Angad, 28 Oct; `posterName`).
  - **The BAR shout-out stays as it is** (Angad, 28 Oct: "BARs are separate"): it names whoever has the most BARs over 2 weeks, even on 1 appointment that week.
  - So the names **don't** add up to the headline, by design. *First appointments attended* = counted minus non-qualifiers (everyone's, 1s included). Top performers = the bookers on 2+, each with their net. More 2+ bookers than fit: the lowest share the last line by name.
  - *Non-qualifiers* = Today's **Non-qual** (`notCounting`).
  - e2e checks all of this.
- **Someone who leaves (Angad, 26 Oct):** `CONFIG.HANDOVER` credits their *new* check-ins to whoever took over, until a date: typed names (`matchBooker(typed, day)`), picks from an out-of-date list (`liveBooker`), and their name in the check-in list. After the date: no booker, and an admin sets it. Nobody switched off is ever credited. **Alerts** about their candidates go to whoever took over (`successorOf` in `notify`, no end date): the one-off ones and the timers' too (Nudge, the evening digest, Saturday's LATE, the Friday roundup), titled with whose they are, "… (Fiza's)" (`alertable`, `whose`). Megan Hyrre's go to Rubal and Jess the same way. **Now: Fiza → Angad until Sun 1 Nov 2026** (company = Angad's, LINK, so FR).
- **Who booked an appointment never changes after the fact (Angad, 27 Oct).** Past weeks must read exactly as they happened. Only an admin's manual **Booker → Save** (a correction) moves one. PR #140 broke this: it moved Fiza's open candidates to Angad, so w/e 25 Oct showed Angad with appointments he never had. `undoHandoverOpen` put them all back once (PR #141), and e2e proves a leaver's week reads identically before and after they leave.
- **Names: always the app's (Angad, 27 Oct: "that's what is based on the documents").**
  - Never take a spelling from a Canva page, a printed list or a screenshot, and don't suggest changing an app name to match one. His NS w/e 01/11/26 Canva had "PRICE MAHMOOD", "TARANIH RAGAGURU" and "Mel Abraham" by hand; the app's Prince Mahmood, Taranih Rajagopal and Mel Anouman are right.
  - Posters, lists and PDFs print the app's full name.
- **A booker's app (Angad, 29 Oct: "a much simpler view"; he approved the mock-up):** four tabs, **Mine · New starts · NS Availability · Appts Attended**. No Chase tab for bookers (admins keep it); `?c=chase` opens Mine for them.
  - **Mine** (`viewMine`), top to bottom:
    - a short score card ("5/5 · Target smashed · 8 checked in · 3 don't count", no reasons);
    - **📞 Do now** (`doNow`: Chase's log the call / call back / stale for them, this week and carried over; compact rows `doRow` with 📞 and Outcome / Update; the red number on Mine);
    - **🎓 Day 1 · <day>** for each Day 1 still to come (`myDay1`, `d1Row`: 📲 details not sent → 🎉 Send, ⏳ not confirmed → 💬 Remind, ✅ confirmed);
    - **📋 This week's outcomes**, one line each (`outPill`), with non-qualifiers folded into one grey line ("Don't count (3): Zehra, Omar, Parishka · student visa", `foldWhy`).
  - Do now and Day 1 read the Chase / Day 1 lists plus the week's own list (`myCands`), so a just-logged outcome moves at once.
  - **New starts** = their own starters, the Day 1 view week by week (`viewAcademy`, `d1Title` / `d1Sub`). **NS Availability** = everyone's availability (`viewAvail`).
- **Other things Angad has settled (don't re-ask):**
  - **Day 1 reminders** name one company, the candidate's (`brandOf`), never "LINK Marketing and JUSS Marketing".
  - **Day 1** has a **Dropped out** option (two taps, Undo), left out of counts and onboarding.
  - **FieldIQ: no ticks (Angad, 29 Oct: "All I want is for the new starts to be able to download FieldIQ without any errors. I don't want any more ticks").** Starters like Arifah Akthar hit FieldIQ's "Your account isn't activated yet": they hadn't tapped the link in FieldIQ's own invite (FieldIQ is TFO's app; this app can't see or change it). A FieldIQ ✅ tick on Day 1 was built and taken out the same day (PR #172; its `fieldiq_at` / `fieldiq_by` columns stay, unused). Instead the welcome email (step 1, `onboardEmail`) and the heads-up WhatsApp (`msgWelcomeHeadsUp`) say the order in bold (invite first, **only then** download and log in, "📲 Download FieldIQ (after its invite)") and quote that exact error with its meaning and fix ("You haven't tapped that invitation link yet. Can't find the invitation? Reply and we'll send it again"), so starters sort it themselves.
    - **No "Databyte first" lock (asked, "Keep as is"):** until 27 Oct 14:40 the welcome email waited for "Added to Databyte" (7 of 7 went after it); since then 19 went with no Databyte check (13 starting Mon 2 Nov, Arifah's among them). FieldIQ only invites people once they're on Databyte, so the email can arrive first. Don't bring the lock (or a tick) back unless he asks; the team doing Databyte in the same sitting as the welcome email is the process fix.
  - **Adding someone who's already on the team (Angad, 30 Oct: "this is the error I'm getting… with two people").** One had been added by another admin with a typo in their email (their logins were refused), the other was on by name only (no email), so "Add a person" stopped at "already on the team. Tap their name to edit them" (the list is on another screen). Now it shows who's on file (company · access · email, or **no email**) and what saving would change ("email a → b", "+ Availability", "− Availability"), with **✏️ Update <name>**: the same record, so their check-ins and pay stay theirs (`onFile`; `findOnFile` refetches the team list when this phone's copy doesn't have them yet; `fileChanges`, `fileMerge`; a near spelling becomes one of their other names). The candidate page's "＋ Someone not on the list…" credits an exact match the same way. No server change. Never put team members' emails in this repo.
  - **New Starts List:** *Closed by* comes after *Booked by*.
  - **Today's summary:** Checked in · Non-qual · Rated · Evaluated · To call.
  - **Today shows each person's outcome next to their name** once it's logged (Angad, 28 Oct: "rather than us opening his profile and seeing at the bottom that he is declined"): ❌ Declined, 🚫 Not suitable, 📵 No answer, 🔁 Call back <time> (Thinking it over), Academy <date> / ✅ Day 1 confirmed / 🎉 Send congratulations, Awaiting admin (`item(c, 'outcome')`, `statusPill`). Not for someone else's candidate in a presenter's view (`limited`).
  - **The Day 1 details WhatsApp (`msgAcademy`) carries their company's playbook (Angad approved the mock-up, 27 Oct):** "📘 *Read your Link Org Playbook* / *JUSS Playbook* so you walk in on Day 1 already knowing how we work 👇", the link (`PLAYBOOKS` in `JS.html`, same as `CONFIG.<co>.playbook`), then "First time? Tap *New BA – set up profile* to make your login 🔐". New starters make their own playbook login; nobody hands them one. It follows the company the message is sent as, after the Pre-Coaching link. Not on the Day 1 reminder.
  - **The booking confirmation** says "approximately 60–90 minutes". There's one confirmed state (⏳ Not confirmed yet / ✅ Mark as confirmed).
  - **Book Appts:** day by day with ‹ ›, or the week. Each has PDFs: who was booked and who came. Chase has a week PDF of who hasn't responded.
- **"Thinking it over"** needs a call-back time. **"No answer" / "Thinking it over"** older than 2 weeks shows as 🔴 Stale on Chase until a final answer is logged.
- **GDPR:** full details for 12 weeks, then trimmed (notes and answers wiped, the call log's notes too). Everything is deleted after 6 months.
  - The trim keeps `visa_expiry` and `rag`: a visa expired stays a non-qualifier and a walk out a walk out, so past weeks and pay never change.
  - An admin's decision note lives on the candidate only (the Log says "with a note"). Emails' copies in `jl.outbox` are deleted after 14 days.
  - **The convictions answer (q13) is never sent back to the evaluation page** (`myEval`): anyone with the mobile can open "Change my answers" on the day, so they answer it again.
- **Search:** a presenter finds someone else's candidate by name only, never by mobile or email (`search`, `fullAccess`).
- **Check-in:** one kept on the phone with no signal counts on the day it was made (the phone sends how long it waited, `made` → `sent` by its own clock, so a phone set to the wrong date can't move it; up to 3 days). The same email twice in a day on another mobile is a repeat (counted once). A pick from an old list under another name that isn't theirs any more is read as typed (a form left open since a handover ended).
- **Names** keep accents and their capitals ("José García", "Ştefan"): `cleanName` / `firstOf`.
- **Never:** paste passwords in chat; log into Cube; pull IQ Suite / Acwyre data without Angad's sign-off; recreate the old web-app mailer (welcome emails go through Gmail "send mail as" from Apps Script).

## NEXT TASK: one ecosystem, released in one go (Angad, 18 Oct 2026)
He asked for J&L to be "an entire ecosystem" with his playbooks (FR `link-fr-playbook.vercel.app`, Leaders `link-leaders-playbook.vercel.app`, JUSS Playbook `juss-playbook.vercel.app` (was `juss-hf-playbook.vercel.app`, which still works), all on the same Supabase) without losing anything. He chose:
- **Everything in one go.** Build and rehearse it all behind the scenes, then switch on one quiet day.
- **One login for all apps:** work email + 6-digit code.
- **The immersive look** of the playbooks. A separate session may do this on its own branch and must not merge before switch day.

Status:
1. Welcome emails link to the Vercel playbooks: done (PR #77, Apps Script version 34).
2. Supabase back end: built (above). e2e passes on both back ends.
3. Still to do:
   - set Vercel's environment variables (needs Angad's OK);
   - deploy `Code.gs` with the relay to Apps Script;
   - rehearsal import plus a preview test (`REHEARSAL=1`: emails only to Angad, no phone alerts);
   - the one-login hub;
   - the look;
   - switch day.

**Order (Angad, 18 Oct):** switch the invisible back end first, once he has tried the rehearsal (branch `switch-to-supabase`, preview `https://jl-recruitment-git-switch-to-supabase-angadclaude.vercel.app`, REHEARSAL=1). Then release the new look and the one login together.

**Switch-day runbook:** `scripts/switch.js` (needs Apps Script on the relay version of `Code.gs`, version 35+). `node scripts/switch.js status` shows where things stand at any time.
1. `node scripts/switch.js freeze`: Google stops saving, its timers stop, and phones retry by themselves. Wait 60 s for any running timer to finish.
2. `node scripts/import-from-google.js --apply`. It must report **0 mismatches**.
3. `node scripts/switch.js live`: Vercel's API answers and its timers run.
4. `node scripts/switch.js forward`: Google passes every request on to Vercel (old open tabs keep working).
5. Merge the `switch-to-supabase` PR (`join/config.js` `API_URL: '/api/rpc'`). Every merge needs Angad's OK in chat.
6. Check: log in, Today / Chase / Day 1, a test check-in, an alert to Angad's phone, the Log in Supabase.

**Undo:** `unforward`, `notlive`, `unfreeze`, and revert `config.js`. Google's data is untouched from step 1 onwards, but anything saved on Vercel after the switch would need copying back.

**One login, findings:** FR (73 users) and Leaders (93) all have emails. HelloFresh has 295 users and only 46 have email usernames, so the hub needs a one-time "connect your old account" step (old username + password once).

## Done: hosting moved to Vercel (18 Oct 2026)
Angad wants all his apps on Vercel so they link into each other (the FR playbook is at `link-fr-playbook.vercel.app`). Vercel team "Link Marketing" is on **Pro**, so the Hobby plan's non-commercial rule doesn't apply.

`app/move.js` forwards the old address to the new one (`node app/dev/move-test.js` proves it):
- same page and same link (`?c=`, `?t=`, welcome links, slide QR codes);
- people stay logged in (carried in the `#`, which never reaches a server);
- it holds back on a phone that still has saves waiting to reach Google.

What was done:
1. **Vercel:** the GitHub app is installed on `angadclaude` (all repositories). `angadclaude/recruitment` was imported as `jl-recruitment` (Framework: Other) through the **Git-connected** import, never `vercel deploy` from a folder, so every merge deploys.
2. **The app points at it:** `app/site.json` (`url` + `movedFrom`), `CONFIG.PUBLIC_URL` in `Code.gs`, `SETUP.md`, `README.md`. The e2e and screenshot scripts read the address from `site.json`.
3. **After the merge, Angad's part:**
   - he pastes `Code.gs` (pinned link, New version); from then on welcome links, alert taps, slide QR codes and email images use Vercel;
   - OneSignal: the app's Settings → Push & In-App → Web → **Site URL** = `https://jl-recruitment.vercel.app` (same App ID, so `join/config.js` doesn't change). Alerts are tied to the web address, so everyone turns them on again once; **Team → Alerts check** shows who hasn't.
   - phone check: the old link opens the Vercel app still logged in, alerts turn on, Today / Chase / Day 1 load.
4. **Team message** (short, WhatsApp-style): open the new link (still logged in) → **Turn on alerts** → add it to the home screen again and delete the old icon.

Old links keep working through the forward, so nothing has to be reprinted.

## Done: booking a presentation after the call (23 Oct 2026)
Jess, Rubal and Angad (`CONFIG.BOOK_TEAM`) book Teamtailor applicants into a Mon–Fri 10:00 presentation from the **Book Appts** tab (`viewBook`; for them Team moves into the menu, 7 tabs don't fit a phone). Data: the **Bookings** tab (made by itself the first time it's needed, `newTab`). The app writes three WhatsApp messages in the thank-you's style, no hearts, signed by the sender, "In association with JUSS Marketing Ltd" (`msgBookConfirm`, `msgBookRemind`, `msgBookMissed` in `JS.html`; Angad approved the wording). Alerts: 18:00 the evening before (`maybeBookingReminders`, `?c=bookrem` opens the send list) and 10:30 on the day (`maybeMissedBookings`). Check-in matches the booking by mobile (`bookingFor`): the booking's booker wins, `brand` = JUSS, `booking_note` shows to the presenter. Show-up card on Appts Attended (admins, `showupFor`). On a computer every wa.me button copies the message and opens the chat empty (`IS_DESKTOP` listener next to `waUrl`): WhatsApp's desktop app turns pre-filled emojis into "�". CONFIRM like Day 1: each booking has a `confirm_token`; the messages link to `booked.html?t=…&n=…&d=…` (`startBooked` / `renderBooked`, public `bookingInfo` / `confirmBooking`, the booker gets an alert). The office robot (`office-texting` branch) is on hold.

## Done: new starters' availability, Week 1 and Week 2 (27 Oct 2026)
This replaces the "Juss & Link - NS Availability - 2026" Google Sheet (a W1 / Pics / W2 tab per week since Jan 2025) and the Canva poster. Angad: "the app becomes the all-in-one go-to". **The app is the one place now**; the Sheet stays as the archive of old weeks, and nobody re-creates tabs.
- **Where:** Day 1 tab → **🗓️ Availability · Week 1 & Week 2**, and the account menu → **🗓️ New starters' availability** for everyone (`viewAvail`).
  - **Every booker has a New starts tab (Angad, 27 Oct):** Hasini, coaching her new starters in the BA Academy, couldn't find them (bookers have no Day 1 tab, and the menu item was buried). Non-admin bookers get it in the bottom bar as **NS Availability** since 29 Oct (was "New starts"; `tabs()`, `asTab` in `viewAvail`, no back arrow): everyone's starters, read-only, not just their own (Angad: "instead of getting just their own, they can see the entire availability for everyone"). A "your own on Mine" card was built and dropped for this. Admins keep it inside Day 1. With the tab there, the account menu doesn't repeat it.
- **Data:** `Availability` + `StarterPhotos` tabs (`availRows`, `availWeek`, `saveAvail`, `addStarter`, `removeStarter`, `saveStarterPhoto`, `availPhotos`).
  - **Rows:** everyone ticked **Arrived** on Day 1 gets a row by themselves (cohort = their Day 1 week), plus anyone added by hand ("someone who started without the app").
  - **Fields:** name and mobile are copied in. Coach = whoever booked them (if that person has left, whoever took over). Driver, Week 1 and Week 2 as `w1` / `w2` (7 letters Mon–Sun: I in / O out / - not said), notes, photo (480 × 572 JPEG, head and shoulders, under 140k characters; the first ones, to 27 Oct, were 360 px squares). Coach can also be **🏢 Office** (`coach_id` `office`).
- **Angad's decisions (27 Oct, don't re-ask):**
  - **Who fills it in:** the one-to-one on Day 1 is done by Angad, Satpal or someone they delegate. Editors are `canAvail` = admins, **presenters** (Angad, 27 Oct: "whoever is the presenter in the app… the ability to edit the availability") and anyone ticked **Availability** in Team. Non-admin presenters and bookers both get the **New starts** tab; presenters see the full page there.
  - **Everyone can view it, but bookers see less (Angad, 27 Oct, replacing "phone numbers included"):** non-editors see each starter's picture, name, coach and their **Week 1 and Week 2 days together** on screen (two labelled rows, W1 / W2). No poster, per-day counts, "no days yet" warning, numbers or notes on screen. **The details are in the PDF:** two buttons, 📄 Week 1 PDF and 📄 Week 2 PDF (Angad first said no PDF, then: "bookers should be able to click on the PDF and see the details of the person"). `availWeek` blanks only `said_days` for them. Editors keep the full page.
  - **Kept for good:** numbers, notes and photos. The 6-month clear-out only touches Candidates.
  - **Anyone can be removed (Angad, 27 Oct):** editors tap them → **🗑️ Remove from availability** (two taps).
    - `removeStarter` sets `removed_at` / `_by`, so the row stays and Day 1 doesn't add them back.
    - They're off the list, the poster, the PDF and the alerts.
    - **↩️ Put back** (`restoreStarter`) at the top of the list returns them as they were.
  - **Pictures on availability and the Day 1 list are cropped to the face** (`avThumb` / `fillThumbs`, 168 × 200, made once per photo), and on availability they're bigger (64 × 76).
  - **Pictures:** a photo of each starter; the app makes the poster.
  - **A = one of his best new starts (Angad, 27 Oct: "so I can just tap on that").** A round **A** at the top right of each card: one tap and it's green, tap again and it's off (`gradeStarter`, columns `grade` / `grade_by` / `grade_at`). He first said A / B / C (green / amber / red), then settled on **A only**; don't add B or C unless he asks. **Only admins set it** (`gradeStarter`: Angad, Satpal, Jess, Rubal; I chose admins-only once presenters could edit, so the A stays his call). **Everyone sees it** (Angad, 27 Oct: "whatever I see on my account is what the booker should be able to see"): a read-only green A on the card for presenters and bookers, and the green name on everyone's PDF. **On the PDF** their name is highlighted in HelloFresh green (#7FA82E, the app's HF colour; a row's `mark: 'hf'` in `listPdf`), with a key under the day totals (Angad, 27 Oct). Not on the poster.
- **The poster (Angad, 27 Oct, don't redesign it):**
  - **Kept from the app's poster:** the top (JUSS | LINK, 🎉 "WELCOME OUR NEW STARTERS", "WEEK 1 | DAY 1 W/E dd/mm/yyyy"), the **HELLO FRESH** and **FUNDRAISING** ribbons, and the Mission footer. It's one page, HelloFresh then Fundraising (`drawStarters` in `Bulletin.html`, 1536 × 2304).
  - **Each starter, as on the team's Canva pages** (his NS w/e 01/11/26 pages; he first asked to "match it exactly… you can't even see someone's face"):
    - a head-and-shoulders photo in a rounded blue frame (220 × 261 proportions);
    - the NAME in capitals (Roboto Bold; two lines when long, as TARANIH / RAGAGURU);
    - then the coach in italics (Arimo Italic): **OFFICE** (`office` flag = coach is an admin, in `OFFICE_BOOKERS`, or 🏢 Office), else **"HASINI - PR"**.
    - **Ramis is not office (Angad, 27 Oct):** his starters show "RAMIS - PR". The one exception is w/e 01/11/26, where his two (Harishanker Mohandas, Taranih Rajagopal) go to the office "just for this once": their availability coach is set to 🏢 Office by hand. Don't add him to `OFFICE_BOOKERS`, and don't change who booked them.
  - **Order and layout:**
    - Office first, then each coach's starters together;
    - fixed columns, a part-filled last row on the left;
    - the biggest cards that fit (`STEP` / `PITCH` as a share of the frame).
  - **Share / Save:** one JPEG `JL-new-starters-<we>.jpg`; on iPhone Save = the Share sheet → Save Image (`savePoster`). The preview fills the phone, so it has a ✕ at the top (as does the PDF preview).
  - **Faces:**
    - Every photo goes through `framePhoto`: the face is found (`findFace`, our own runner of the pico cascade `img/facefinder.bin`, MIT, `img/face-LICENSE.txt`) and framed head and shoulders with room above the head (face ≈ 32% of the height, centre 40% down: `faceFrame`). The Canva-tight 37% / 30% cut the tops of heads (Angad, 27 Oct).
    - The crop screen lets them drag, pinch or slide, then ✅ Use photo.
    - Older square photos are framed from their face when the poster is drawn (`autoFrame`); they're soft, so retaking them gives a sharper poster.
    - Checked against all 15 of his 26 Oct photos: the face was found in every one.
  - **Photos from a file (`photoImportFile` / `photoImport`, Availability → 📥 Add photos from a file)** are for putting a week's photos in for Angad without anyone retaking them.
    - The file is JSON `{ we, photos: [{ name, data }] }`, sent to him privately (SendUserFile).
    - It runs in the opener's own session (`canAvail`): it shows who each photo is for (by the app's first names) and saves them on ✅.
    - On 27 Oct the session's safety check refused both other routes, and rightly: signing in as Angad with a code from his inbox, and pushing the photos (even encrypted) to this public repo. Never do either.
- **The week's rhythm (Angad, 27 Oct, don't re-ask):**
  - **Monday, Day 1:** Jess and Rubal (admins) tick **Arrived**, then tap **📷 Photo** on the same Day 1 row (`day1Photo`, back camera). The photo is their availability photo and shows as their picture on the Day 1 list.
  - **Tuesday around 2–3pm:** the one-to-one where they commit to their days. Days stay **blank until then** (not pre-filled).
  - **18:00 from the day after their Day 1** (`maybeAvailReminder`, `AVAIL_REMIND_TIME`; Angad moved it from 17:00 on 27 Oct because the availability chat can run long):
    - **Satpal, Rubal, Jess and Angad (the admins, Angad 27 Oct)** get all the new starters, done vs missing: "🗓️ Availability: 12 of 15 done · Still to fill in: …" daily until everyone has Week 1 days, then "✅ Availability ready: 15 new starters · Week 1 in: Tue 13 · … · 🚗 4 drive · tap for the poster and the PDF" once a week. Delegates ticked **Availability** don't get it (he named the four);
    - **each coach** (non-admin, active) gets their own new starters, done vs missing: "🗓️ Your new starters: 1 of 2 done" with a line each ("Jasraj: Mon Tue Wed Thu Fri", "Adham: not filled in yet") daily while any are missing, then "✅ Your new starters' days" once (`AVAIL_COACH_READY_<week>`).
  - **Tuesday he wants ready:** the poster in the team WhatsApp, who's in each day, that alert, and the PDF.
- **Didn't continue / not ticked Arrived any more** (`no_longer`): editors still see them, flagged (anything filled in is kept), but they're off the day counts, the poster, the PDFs and the bookers' New starts, like the alerts and the bell sheets.
- **A booker corrected after Day 1** (`reassignBooker`): their availability coach follows (`coachOf`), unless a coach was picked by hand or 🏢 Office.
- **Extras:**
  - per-day headcount with 🚗 drivers;
  - "N with no Week 1 days yet" on screen;
  - "Said 5 days, in 3" against their evaluation answer (`q6_days`);
  - their coach gets an alert when days change after the first fill;
  - a PDF like the sheet (`availPdf`, "NS Availability W1 w-e dd.mm.yyyy"). Notes print in full under each starter, across the table (Angad, 27 Oct: "I want to see all the notes"; a row's `note` in `listPdf`), not in a Notes column that cut them short.
- **e2e section "availability"** covers all of it, on both back ends.

## Done: the morning after Day 1 (27 Oct 2026)
Every Tuesday the team brought Angad the printed New Starts List marked up by hand:
- pink highlighter = HF, orange = FR;
- struck through = didn't start (NI, not confirmed, no-show), or arrived but didn't come back;
- a tally of starts by booker ("Office 5 · Hasini 3 · Ramis 2 …") and "NDCS 9 / HF 6".

The app now does all of it, and **he decided the flow is mine to set**:
1. **Monday, in the room:** Day 1 tab, as before: Arrived / No-show / 🚫 Dropped out (NI). Plus the **FR | HF** switch on each row.
2. **Next morning:** **🚪 Didn't continue** (two taps, Undo) on anyone who came on Day 1 but not back (`markDay1` `left` / `stayed`, columns `day1_left_at` / `_by`). They still count as a Day 1 start, and they drop off availability.
3. **09:00 the morning after a Day 1:** admins get the results (`maybeDay1Results`, `D1_RESULTS_TIME`; tap opens Day 1). The first one is for Day 1 Mon 2 Nov (`D1_RESULTS_FROM`): 26 Oct's FR / HF were only on paper, so an alert for it would have shown the wrong split.
   - "🎓 Day 1 Monday 26th October: 15 of 23 started"
   - "FR 9 · HF 6 · 2 didn't continue"
   - "Office 5 · Hasini 3 …"
   - "Didn't start: 4 dropped out, 3 didn't confirm, 1 no-show"
4. **The Day 1 tab** shows the same results card per day (`d1Results` in the app = `day1Results` on the server; keep them identical).
5. **From the next day, 📄 New Starts List comes out marked up:** rows in their campaign's colour, struck through for anyone who didn't start or didn't continue, Arrived = Left / No, and the results underneath. On the day itself it's still the plain sign-in sheet.

- **"Office"** = bookings by admins, or by anyone in `CONFIG.OFFICE_BOOKERS` (Fiza Iqbal), as in the team's tally (`isOffice`; `office` flag in `shape`).
- **Fix their name** (admins, on their page, `fixName`) updates availability too. Only for a real typo against their documents: the app's names are the source (see Rules).
- **Not built, ask if needed:** the ✓ ticks the team put next to some pink (HF) rows. Meaning unknown.

## Bell sheets: new starters each week (Angad, 27 Oct 2026)
Once availability is filled in, the new starters go into the **NEW STARTS** section at the bottom of that week's bell sheet. The team used to copy them across from the old availability Google Sheet.
- **Which sheet:** by campaign (`campaignOf`).
  - FR → "🧏🏻‍♂️LINK 2026 FR BELL SHEET", section **NEW STARTS**.
  - HF → "🍋JUSS HF🍋 BELLSHEET", section **NEW STARTS - SLOUGH**.
  - The tab is the Day 1 week, "WE dd.mm.yy" (e.g. `WE 01.11.26`).
- **Only columns A and B are filled in:**
  - A = their full name in capitals, as the app has it (the New Starts List);
  - B = their coach in capitals: the first name of whoever booked them.
  - **OFFICE** when there's no coach (Angad: "just put it as office"): booked by an admin, by `OFFICE_BOOKERS` (Fiza), or availability coach 🏢 Office.
  - Office first, then each coach's starters together.
- **What the other letters mean (Angad, 27 Oct):** the days are typed into the template rows already, and they're the plan, not formulas.
  - **BA AC = BA Academy**, in-house, on Monday and Tuesday.
  - **S = Shadow day**, on Wednesday.
  - Thursday onwards is blank. FR also has **NS** in column C.
  - Never change, move or delete any of these.
- **Filling:** use the empty template rows. Never overwrite a row that already has a name, and never delete rows.
- **w/e 01/11/26** was done by hand through the Sheets connector (FR 9, HF 6).
- **From then on it's automatic (built 27 Oct):**
  - **When:** from `AVAIL_REMIND_TIME` (18:00) the day after their Day 1, anyone with Week 1 days in who isn't on yet. Later fills go on within 5 minutes.
  - **How:**
    - Vercel's cron (`api/cron.js` → `server/bell.js` `bellToSheets`) asks `bellDue`.
    - Google writes them (`relayBell`, Google-only, so a change to it needs Angad's paste).
    - `bellDone` keeps who's on (`BELL_SENT_<we>`, avail row ids) and tells the admins.
  - **What `relayBell` does:**
    - finds the tab by its date (the HF tab names vary: "WE 5.07.26", " WE 23.11.2025": `bellTabDate`);
    - the section ends at a blank row, the next section's title (A only) or "(Please DO NOT TOUCH)";
    - it only fills A:B of rows whose A and B are empty, skips a name already there, and never inserts or deletes rows.
  - **Problems** (no tab yet, no section, no empty rows left, Google's Code.gs not updated) alert the admins once each (`BELL_PROBLEM_<we>`) and are retried every 5 minutes.
  - **Switched FR ↔ HF after going on** (`BELL_SENT` keeps the campaign): they go onto the new sheet too, and the admins get "🔔 Bell sheets: moved campaign · NAME: clear them from the FR bell sheet" (the app never deletes rows).
  - **A name typed a little differently by hand** is the same person (`bellKey`: first and last word, letters only, no accents or nickname in brackets), so "HILAIRE (EMMANUEL) EBILA" isn't added twice. `relayBell` is Google-only: this needed Angad's paste (28 Oct).
  - **The sheets' links:** an admin setting on availability (**🔔 Bell sheets** card, `setBellSheets` → `BELL_SHEETS` in props). **Never put their IDs in this repo:** the FR sheet is "anyone with the link can view" and the HF one "anyone with the link can edit" (27 Oct).
  - e2e "availability" tests it on both back ends (the fake bell books are in `gas.js` `__books`; `/dev/bell` runs the cron step).

## Data fixes Angad asked for
- **26 Oct 2026:** Fiza's 2 appointments that day were Angad's (he entered them under her by mistake). Angad moved both himself (candidate → **Booker** → Angad → **Save**, `reassignBooker`, which also moves the candidate's company to the booker's). The rest of that week is automatic (`HANDOVER`, above). Her earlier candidates stay hers, and their alerts go to Angad (the PR #140 move was undone on 27 Oct, see Rules).

## Done: Megan's bookings from Hyrre (27 Oct 2026)
Hyrre (hyrre.co.uk, org "JMO", Slough = pipeline **403**) is the AI screening-call recruiter Slough uses since 26 Oct: its caller "Megan" pencils people into the 10:00 and Rubal approves them there. At **08:15 and 17:15** a Claude scheduled task on Angad's PC (**hyrre-morning-pull**) runs `node scripts/hyrre-sync.js snippet` (key in `.env.hyrre` → one-time 15-min ticket, `hyrreTicket`), then runs `scripts/hyrre-pull.js` in a Chrome tab on hyrre.co.uk logged in as Rubal. It reads Slough's appointments (look-only GETs, header `X-Pipeline-Id: 403`) and POSTs them to `/api/rpc` `hyrreImport`; `api/rpc.js` lets the `https://hyrre.co.uk` origin read the answer.
- Approved ones become Bookings rows with `hyrre_id` + `hyrre_at`, keyed by Hyrre id + day. A moved day = old row cancelled + new row; declined or removed (still to come) = cancelled. Rows that came or no-showed are never touched.
- Booker: **Megan Hyrre** (Users row id `hyrremegan`, admin role, switched off, no email: Office Recruitment, no incentive, hidden from Team, can't be edited). "Booked by Rubal/Jess" in Hyrre's note credits them. `liveBooker` keeps Megan's bookings hers; `successorsOf` sends her alerts to `CONFIG.HYRRE.ALERTS_TO` (Rubal, Jess).
- **Our reminder goes to them too (Angad, 30 Oct), signed Megan** (`bookSigner`: whoever booked them, "Megan" for hers), with a CONFIRM link (`confirm_token`). They're in the 18:00 evening-before alert (`remindAlerts`: "📲 N of Megan's to remind for tomorrow" to Rubal and Jess) and, after the 08:15 pull, "📲 N of Megan's to remind for today" for any not reminded since the evening before (`hyrreMorningReminders`, once a morning, `BOOK_HY_REMINDED`). A reminder counts from the evening before (`bookReminded`). Hyrre still sends its own confirmation and texts (approval SMS + email, 22:00 email, 09:00 SMS).
- J&L can't edit, cancel, confirm-message or "missed you" them (`HYRRE_OWNS`): only `remind` and `yes`. The 10:30 alert says to mark them absent in Hyrre.
- **Not built: marking attended / no-show in Hyrre from our check-ins** (Angad asked, 30 Oct). Hyrre does it with `PATCH /api/applications/<id>/first-appointment/` `{attendance_status: "attended" | "no_show", ask_rebook}` (no_show + ask_rebook sends its rebook email); values seen: none / attended / no_show. Claude Code's safety check stopped the write to Hyrre until Angad allows it.
- `maybeHyrreLate`: no pull by 09:15 on a weekday → the booking team is alerted.
- Hyrre's MCP (OAuth, read-only) only admits Claude/ChatGPT (`unknown_app` for anything else), so there's no server-side link. Ask Matt (Hyrre) for an API key or webhook if Angad wants it without his PC.
- Tests: `node app/dev/hyrre.js <dir>`, 51 checks on both back ends. **Never change Hyrre settings or templates** (Angad, 27 Oct).

## Open items (ask Angad when relevant)
- **The HF bell sheet is "anyone with the link can edit"** (owner Jess, 27 Oct). Suggested to Angad: switch General access to Viewer (or Restricted) and keep named editors. His call.
- **Optional:** auto-deploy `Code.gs` from GitHub with `clasp`, to remove the paste step. It needs the Apps Script API turned on and a `CLASPRC_JSON` GitHub secret, which he sets himself and never pastes in chat.
- The full team guide is `app/SETUP.md`.
