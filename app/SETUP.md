# Setting up the Recruitment App (about 25 minutes, one time)

**How it fits together:**

| Piece | What it does | Cost |
|---|---|---|
| **Google Sheet + Apps Script** | Stores the data (private) and runs the rules, logins and alerts | £0 |
| **Vercel** (project `jl-recruitment`, linked to this repo) | Hosts the app people open: the slide QR codes, welcome pages, staff app | Part of the Link Marketing Vercel Pro plan |
| **OneSignal** | Sends the phone push notifications | £0 (free plan) |

Your app's address: **https://jl-recruitment.vercel.app/**

*(Until 18 Oct 2026 it lived at https://angadclaude.github.io/recruitment/join/. GitHub Pages is still on, only to forward old links, QR codes and home-screen icons to the new address, logged in. Keep it on.)*

---

## Part A. Google: the data and the brain (5 min)

### A1. Open the Sheet
Already created in your Drive: **Recruitment App — DO NOT EDIT** (https://docs.google.com/spreadsheets/d/1QThJvy6l7HPrHQaa9jQst7tFmeCRqUZSWaI8oSxm--0/edit).

### A2. Paste in the code (one file)
1. In the Sheet: **Extensions → Apps Script**.
2. Open https://raw.githubusercontent.com/angadclaude/recruitment/main/app/src/Code.gs in a new tab → **Ctrl/Cmd + A** → **Ctrl/Cmd + C**.
3. Back in Apps Script, click inside `Code.gs` → **Ctrl/Cmd + A** → **Ctrl/Cmd + V** → 💾 **Save**.

### A3. Run setup
Choose **`setup`** in the dropdown → **▶ Run** → **Review permissions** → choose your account → **Advanced → Go to Untitled project (unsafe) → Allow**.
This creates the tabs, the 4 admins (Angad, Jess, Satpal, Rubal) and the scheduled alerts.

### A4. Import the last 6 months (for repeat candidates)
Choose **`importHistory`** → **▶ Run**.

### A5. Publish
**Deploy → New deployment → ⚙️ → Web app** → Execute as **Me**, Who has access **Anyone** → **Deploy**.
Copy the **Web app URL** (ends in `/exec`). You need it in B2.

*(Only using Google, without the Vercel web address? Set `PUBLIC_URL: ''` in Code.gs and also add the HTML files `Index`, `Styles`, `JS`, `Logos` and `QR` from `src/`.)*

---

## Part B. Vercel: the app people open (5 min)

### B1. Put the app live
The app lives in the `join/` folder. Vercel publishes `main` by itself about a minute after each merge. *(Claude opens the pull request; you click **Merge**.)*
Set up once (done 18 Oct 2026): Vercel → **Add New → Project → Import Git Repository** → `angadclaude/recruitment` → name `jl-recruitment` → Framework **Other** → **Deploy**. `vercel.json` tells it to serve `join/` with no build step.
GitHub Pages (**repo → Settings → Pages → `main` / root**) stays on only so the old address forwards to Vercel.

### B2. Connect it to Google
Open [`join/config.js`](../join/config.js) on GitHub → ✏️ edit → paste the URL from A5 between the quotes on `API_URL:` → **Commit**.
*(Or just send Claude the URL.)*

---

## Part C. OneSignal: phone notifications (10 min)

1. Sign up free at **onesignal.com** (click the link in OneSignal's confirmation email) → **New App** → name it *LINK × JUSS Recruitment* → choose **Web**.
2. **Typical Site** setup:
   - Site name: `Recruitment` · Site URL: `https://jl-recruitment.vercel.app`
   - Default icon: upload [`assets/icon-192.png`](assets/icon-192.png)
   - **Advanced → Service worker:** path `/`, filename `OneSignalSDKWorker.js`, scope `/` *(the app also sets these itself from the address it's opened on)*
   - Skip the "add code to site" step. It's already built in.
3. **Settings → Keys & IDs** → copy the **App ID**. Click **Add key** to create the **REST API Key**, and copy it straight away: it's only shown once.
4. Paste the **App ID** into [`join/config.js`](../join/config.js) after `ONESIGNAL_APP_ID:` → Commit.
5. In Apps Script: ⚙️ **Project Settings → Script properties → Add**:
   - `ONESIGNAL_APP_ID` = the App ID
   - `ONESIGNAL_API_KEY` = the REST API Key *(this one is secret, so it lives only in Google, never on GitHub)*
   - The property name goes in the left box and the value in the right box. Keep the existing `SS_ID` row.
6. Test it: open the app from the home-screen icon → tap **Turn on**. Your phone gets OneSignal's "Thanks for subscribing!" alert. Check someone in with you as booker, and your phone buzzes "🙌 … just checked in".

Until Part C is done, alerts go by email instead. Nothing breaks.

---

## Part D. Get the team on it

1. Open **https://jl-recruitment.vercel.app/** → tap **🛡️ Admin login** (Angad, Jess, Satpal, Rubal) → your email → the 6-digit code.
2. **👥 Team → + Add person** for every booker and presenter: name, email, **LINK or JUSS**, access. Bookers and presenters are BAs: they use **🙌 BA login**. Only bookers earn the **recruitment incentive** (net 5): admins can be picked as someone's booker, but they're never on the incentive board and get no incentive alerts.
3. Send everyone the link with this message:

> 📲 Our new recruitment app is live. Open https://jl-recruitment.vercel.app/ → tap **🙌 BA login** → your email → the 6-digit code we email you.
> **iPhone:** tap Share ⎋ → *Add to Home Screen* → open it from the icon → tap **Turn on** for alerts.
> **Android:** Chrome menu ⋮ → *Install app* → tap **Turn on** for alerts.

**iPhone users must open it from the home-screen icon.** Apple only allows notifications for web apps added to the home screen (iOS 16.4+).

**Check each person before they leave the room:** tap their initials (top right). It must say **Alerts: on ✅**. If it says anything else, that line tells you what's wrong. Anyone who isn't on gets alerts by email only.

**👥 Team → 🔔 Alerts check** shows everyone at once: who gets alerts on their phone, who has never logged in, who logged in but never allowed alerts. It also checks that OneSignal is connected, how many backup emails are left today, and that the scheduled alerts are running.
- **📧 Email setup steps** sends the 2-minute guide to everyone who isn't set up.
- **Test** sends a test alert to one phone. Ask them if it buzzed.
- New people get the setup email automatically when you add them.

Every alert the app sends is written to the **Log** tab (action `alert`): 📲 = reached their phone, ✉️ = went by email.

## Part E. The slides
Put the two QR codes on the presentation once. They never change:
- **First slide:** [`docs/qr-1-checkin.png`](docs/qr-1-checkin.png) → check-in
- **Last slide:** [`docs/qr-2-evaluation.png`](docs/qr-2-evaluation.png) → evaluation

(Also downloadable any time from **Team → 📲 QR codes for the presentation slides**.)

---

## Daily routine
1. Candidates scan the **check-in QR** on the first slide. The booker gets a push: *"🙌 Jasraj just checked in"*.
   - **⛔ Non-qualifiers** (under 18, or a right-to-work answer that rules them out: Student visa (Tier 4), Skilled Worker / Health & Care, asylum pending, needs sponsorship, or a visa that's already expired): Jess, Rubal and their booker get *"⛔ Non-qualifier checked in: …"* straight away. They get **no evaluation form**, never count for the incentive or as a top performer on the bulletin (only in its Non-qualifiers number), and nobody is chased for their outcome. Their thank-you WhatsApp is an honest version ("you need to be 18 or over" / "your visa or status doesn't allow self-employed work… message us when that changes"), with no "next steps by Friday" promise. **All → Non-qualifiers** lists them. Tapped the wrong answer? An admin fixes it on their page (**Admin → Ticked the wrong answer at check-in?**), then they can do the evaluation.
2. **Presenter** taps each name on their phone → Green/Amber/Red, ★1–5, tags, notes. **Rating someone confirms they were in the room** (that's what counts for the recruitment incentive).
3. Last slide: candidates scan the **evaluation QR**. Same phone → straight in. Different phone → they type their mobile. Missed check-in → they check in there and then.
   - **Question 1: "Who ran today's presentation?"** One tap on a presenter's first name (everyone with the **Presenter** role: Team → tap them → tick Presenter, admins included if they present), or **Someone else** (they type the name) or **Not sure**. Saved in the Sheet as `presented_by` (+ `presented_by_id`), shown on their page as *"🎤 Presentation by Nathan Mcgrath"*, and on **Incentive** (admins) as **🎤 Presenters this week**: in the room → evaluated → booked → started (arrived on Day 1), per presenter.
4. **Booker** gets *"📋 Jasraj's evaluation is in"* → one-page snapshot → call → log outcome → tap **🎉 Send BA Academy Day 1 details**.
5. Candidate taps the link in WhatsApp → their **personal welcome page** (Week 1 plan, poster, directions, add to calendar) → taps **🔒 Confirm I'm coming** → booker gets *"✅ Jasraj confirmed Day 1!"*
6. **Admins, end of day:** **Today → 📣 Today's bulletin → 📤 Share to WhatsApp**. The stats poster is built from the app: attended, non-qualifiers and top performers, on the same rules as the recruitment incentive. On Fridays it adds the weekly total; tap **🏆 Week top 5** for the leaderboard. **✏️ Edit wording** lets you change the messages, tag someone as (BAR), and change the Mission / Plan numbers or the cash amount.

## Push alerts
| When | Who |
|---|---|
| Candidate checks in | their booker |
| ⛔ Non-qualifier checks in | Jess, Rubal and their booker |
| Evaluation submitted | their booker |
| Candidate confirms Day 1 | their booker |
| Booker books a 🔴 candidate | all admins |
| Wed + Fri 10:00: "3/5 net attended" (recruitment incentive) | every booker (not admins) |
| Mon–Thu 18:00: your day (who came in, evaluations) + who still needs closing, sending Day 1 details or confirming | every booker who had appointments (nothing to say = no message) |
| **Fri 15:00 week roundup:** appointments, who's booked, who's not, no outcome yet, who's been sent the Day 1 WhatsApp (and who hasn't), net vs target | every booker who had appointments |
| **Fri 15:00 team roundup:** the same, one line per booker, loose ends first. Tap it → **Chase** tab | admins |
| **18:00 the evening before an Academy day:** "🎓 Tomorrow's BA Academy: 2 starters of yours · Jasraj ✅ · Adham ⏳" | each booker with a starter tomorrow |
| **18:00 the evening before an Academy day:** "🎓 Tomorrow: 6 starters expected · 4 confirmed" | admins |
| **10:00 on an Academy day:** "🎓 Day 1 today: 4 starters to remind" → opens the send list | Jess (LINK starters), Rubal (JUSS) |
| Sat 14:00: "🔴 2 outcomes LATE (due Fri 18:00)" | bookers who missed the deadline |
| Mon 09:00: recruitment incentive report | admins |
| **18:00 the evening before a presentation** (Sunday for Monday's): "📲 2 to remind for tomorrow · Sam ✅, Ruby ⏳" → opens the send list | whoever booked them (Jess, Rubal, Angad) |
| **10:30 on the day:** "😕 1 didn't come today" → Today, with "Sorry we missed you" + Rebook on their row | whoever booked them |

## 📅 Booking a presentation after the call (Jess, Rubal, Angad)
Applicants from Teamtailor are called by **Jess, Rubal or Angad** (`BOOK_TEAM` in `Code.gs`) and booked into a **10:00 presentation, Monday to Friday**. Everyone booked this way is **JUSS Marketing's** (`BOOK_CO`): that's where every CV applies.

1. **After the call:** the **Book Appts** tab (bottom bar; your **Team** is now under your initials, top right) → **📅 Book a presentation** → first name, surname, mobile, the day (the next 5 presentation days, or *Later date…*), where they applied (Teamtailor, Indeed, Referral, Other) and any notes for the presenter → **Next**.
2. **Send the confirmation:** **💬 WhatsApp** and **📱 Text** side by side at the top, then exactly what they'll get, signed *"Kind regards, <your name>, In association with JUSS Marketing Ltd"*. Text opens your phone's Messages (no WhatsApp stars). **On a laptop**, 💬 WhatsApp copies the message and opens the chat empty: press **Ctrl+V** and send (WhatsApp's computer app turns pre-filled emojis into "�"; pasted ones arrive fine). The message has their own **CONFIRM** link, like Day 1: a *"You're booked in"* page (the day, where, Maps, add to calendar) with **🔒 Confirm I'm coming**. When they tap it they turn ✅ in the app and you get *"✅ Jake confirmed Tuesday's presentation"*. If they reply YES instead, tap **✅ Mark as confirmed**.
3. **The evening before (18:00):** you get *"📲 N to remind for tomorrow"*. Tap it: the send list opens. One tap each (*"Tomorrow's the day!"*). You can also send them any time: **Day** → ‹ › to that day → **📲 Send … reminders**, or **Week** → **📲 Remind** under the day.
4. **Day or Week** (Angad, 23 Oct): **Day** shows one day at a time, ‹ › to flip through the weekdays, like Today: who's booked, who confirmed, who's had the confirmation and, once it's happened, who came and the show-up. **Week** shows the whole week in one go, day by day, ‹ › a week at a time, like All; tap a day to open it. Both update by themselves while they're open (every 10 s, 7am–5pm), so anyone Jess, Rubal or Angad books appears without a refresh. Bookings go back to last week's Monday. **📄 Booked appointments w/e … (PDF)**, like the All tab's: the week as a PDF, a table per day: who booked them, where they applied, confirmed (tapped CONFIRM / replied YES / no / not sent) and whether they came (green) or didn't (red), with the show-up so far.
   **On the day:** at check-in their mobile finds the booking (*"✓ Found your booking: today 10:00 AM, booked by Jess Grace"*), so the right person is credited even if they pick someone else, and the presenter sees your notes (*"📝 From the call: …"*).
5. **Didn't come (10:30):** their row turns red with **💬 Sorry we missed you** and **📅 Rebook**. Rebook makes a new booking; the missed one stays a no-show.
6. **Tap any name** (also someone booked on another device) for the booking: mobile, who booked them, every message sent (who, when, how), **Change the day**, or **Cancel this booking**.

**Show-up** (admins, Appts Attended): booked vs came this week, by who booked them and by where they applied. Today's count starts at 10:30. Cancelled bookings are left out.

**GDPR:** a booking's notes go after 12 weeks; the whole booking is deleted after 6 months, like everything else.

## 🔔 Chase tab: nobody drops out of the pipeline
A tab in the bottom bar for admins and bookers. The red number on it shows how many people are at risk right now. Someone is on it if, in the last 2 weeks (`CHASE_DAYS` in `Code.gs`):

| On the list as | Means | Off the list when |
|---|---|---|
| 📞 Log the call | rated in the room, no outcome yet (LATE after Fri 18:00) | an outcome is logged |
| 🔁 Call back | outcome is *No answer* or *Thinking it over* | updated to Booked / Declined / Not suitable |
| 🔴 Stale: close it out | *No answer* / *Thinking it over* and **over 2 weeks old**: these never just drop off (a call-back time still to come keeps them a 🔁 Call back) | updated to Booked / Declined / Not suitable |
| 📲 Send Day 1 text | booked onto the Academy, Day 1 WhatsApp not sent | it's sent (or they confirm) |
| ⏳ Day 1 not confirmed | text sent, they haven't tapped CONFIRM | they confirm |
| ❌ No-show: rebook | marked no-show on the Day 1 list | rebooked with a new date |

**Bookers** see their own, grouped like that, with Call / WhatsApp / Log outcome / Remind / Rebook on each person.

**Admins** see everyone, one card per booker. Tap a name to open them.
- **🔔 Nudge all** (Friday 3pm, or any time): each booker gets an alert listing exactly who ("⏰ Jess: 3 people to chase · 📞 Log the call: Ali (by Fri 18:00) · 🔁 Call back: Sam"). Tapping it opens their Chase tab. Email if they're not set up; no repeat within 30 minutes.
- **📄 Chase w/e … (PDF)** (admins, like the All tab's): the week on screen as a PDF, carried over included, a table per booker: name, company, mobile, appointment day, evaluated, what's needed (log the call / call back / stale, LATE in red) and their last logged call.
- **🔔 Nudge** on one card: just that booker.
- **💬 Post to team WhatsApp**: the same list, by booker, for the bookers' group.
- **👀 Needs you**: the admins' own loose ends: 🔴 bookings waiting on your decision, appointments with no booker, Day 1 not ticked.

An admin who also books has 7 tabs' worth, which won't fit a phone: their **Team** moves under their initials (top right).

The Friday 15:00 round-ups open the Chase tab: each booker's opens theirs, the team one opens everyone's.

## 🎓 Day 1 tab (admins): who's starting, reminders, the printed list
A tab in the bottom bar for admins (bookers: **Chase / Mine → 🎓 My Day 1 starters**, their own only). Everyone booked onto the BA Academy, by date.

**Monday morning (Jess / Rubal):**
1. **10:00:** Jess gets *"🎓 Day 1 today: 4 starters to remind"* (her LINK starters), Rubal gets the JUSS ones. Tap it.
2. The **Send reminders** list opens: one row per starter, theirs first. Tap **💬 Send** → WhatsApp opens with the reminder ready, signed by you → send → come back → next. When the replies come in, tap **✅ Mark as confirmed** for each. Not on WhatsApp = **📱 Text**. It counts "3 of 6 sent", and either of you can send any of them.
3. **📄 New Starts List (PDF)**: titled and saved as **New Starts List 19.10.2026** (that Day 1's date). **Always JUSS on top, LINK below** (a line between them, and *JUSS n · LINK n* at the top); in each, Monday's starters then Tuesday's, by name, no-shows at the bottom. The Day 1 tab lists them in the same order. The A4 sign-in sheet (name, mobile, company, booked by, **closed by** (whoever logged "Academy booked" on the call), confirmed, an Arrived box to tick, notes). The Day 1 tab shows *booked by … · closed by …* on each starter too. On a phone it opens the share sheet: **Print**, Save to Files or AirDrop. Shred it after Day 1 (it has phone numbers on it).
4. **On the day:** tap **Arrived** or **No-show** for each person (tap again to undo). That's your real show-up rate (`day1_status`, `day1_by`, `day1_at` on their row). A no-show goes straight onto their booker's Chase list to rebook.

**The reminder message** is Jess / Rubal's own wording, in `msgDay1Reminder` in `src/JS.html`. It fills in their first name, "today / tomorrow, Monday 5th October", their company's Google Maps pin (LINK or JUSS listing) and the sender's full name. Who was reminded and by whom: `day1_reminded_at`, `day1_reminded_by`.

**They reply "Yes" on WhatsApp** → tap **✅ Mark as confirmed** on their row (Day 1 tab, or **Said Yes 👍** on the booker's Chase tab). They then count as confirmed everywhere: the counts, the evening briefing, the PDF. Tapping the CONFIRM link on their welcome page does the same thing by itself.

Someone the admins haven't approved yet (🔴, pending) isn't on the list.

## Getting someone logged in (do it in the room)
1. **👥 Team → ＋ Add person** → name, email, LINK/JUSS → **Save**. You stay on their page; they also get the setup email.
2. Tap **🔑 Show a login code**.
3. On their phone: open the app → **BA login** → type their email → **Already have a code?** → type the code → **Log in**.
4. Then **Add to Home Screen** (iPhone) or **Install** (Android), open the app from the icon, and tap **🔔 Turn on**.
5. Tap their initials: it must say **Alerts: on ✅** before they leave.

Someone stuck later (email slow, in Spam, or "too many codes")? Same thing: Team → their name → 🔑. Correcting someone's email resends the setup steps to the new address. Every code request is in the **Log** tab (`login_code`: emailed / no active team member / limit reached).

## A booker who isn't on the app yet
- **At check-in:** if their name isn't in the list, the candidate types it and carries on. It shows as *Booker not confirmed: "Priya"*.
- **On the candidate page:** Admin → **Booker → ＋ Someone not on the list…**. The name is pre-filled from what the candidate typed; pick LINK/JUSS and tap **Add and credit them**. They're added to the team **by name only** (no email). From then on:
  - they're on the bulletin and the recruitment incentive;
  - they're in the check-in list;
  - any other check-in from the last 14 days where the candidate typed their name is credited to them automatically.
- **Later:** Team → tap them → add their email. They get the setup email, log in, and every candidate is already theirs.
- **Team → ＋ Add person:** works the same way. Leave the email blank for "not in the app yet".
- **Same person twice?** If the name is nearly the same as someone already on the team (a typo like "Ali Abass" for "Ali Abbas", or the same name inside a longer one like "Ali Abbas" and "Ramis - Ali Abbas"), the app asks *"… is already on the team. Same person?"*. Tap **✅ Yes: credit them**. Only add a new person if they really are someone else, because two entries split their incentive and bulletin credit.
- **Renaming someone** (Team → tap them → name) updates "booked by" on all their candidates.

## 🚀 New starter onboarding (Jess / Rubal, admins only)
When a booker books someone onto the Academy (or an admin approves a 🔴 booking), Jess (LINK) or Rubal (JUSS) gets **"🚀 New starter to onboard: Adham Soliman · Booked by Abdullahi for Monday 19th October"**. Tap it to open their page, which has the **🚀 Onboard** card at the top:

1. **Add to Databyte:** tap **Open Databyte ↗** (the onboarding dashboard) and add them as a new starter.
   - Copy each box across: first name, last name, email, phone (07700 900300), recruitment source.
   - **Recruitment source is a rule, not a choice:** booked by any booker → *Personal Recruitment*; booked by Jess / Rubal (any admin) or no booker → *Office Recruitment*. Wrong? Fix the booker on their page and it follows.
   - Tap **✅ Added to Databyte**. (There's no Databyte API, so this step stays copy-and-paste.)
2. **Welcome email:** **📧 Preview & send** shows the exact email ("LINK / JUSS Marketing - Your Brand Ambassador Journey Begins!"): their name, Day 1 date, Day 1 / Day 2 times, FieldIQ, pre-coaching (LINK), their Playbook (Link Org Playbook / JUSS Playbook), client, magazine, map and contact number. Tap **Send**.
   - It's locked until step 1, because FieldIQ only works once they're on Databyte.
   - **FieldIQ says "Your account isn't activated yet"?** They haven't tapped the link in FieldIQ's own invitation (email or text, it often lands in Junk). The welcome email and heads-up now say so as step 1. Can't find it at all? Check the email and mobile you typed into Databyte are right, then get the invitation sent again.
   - **It only ever goes from the recruitment team's own addresses**, signed by whoever sends it: Jess from `jess@linkmarketing.org.uk`, Rubal from `rubal@jussmarketing.co.uk`, Fiza from `recruitment@jussmarketing.co.uk` (any of them can send either company's). Anyone else pressing Send (Angad, Satpal) sends from the company's person: LINK → Jess, JUSS → Rubal. Replies go to that address, and it gets a copy.
   - The card and preview say who it's from. If the app can't send as that address yet, Send stays off: it never falls back to another address.

### LINK or JUSS: one tap (Jess, Rubal, Fiza)
The recruitment team work for both companies, so for **Jess, Rubal** (`THANKS_TEAM` in Code.gs) **and everyone in `RECRUIT_TEAM`** (Fiza: `recruitment@jussmarketing.co.uk`) every thank-you and Day 1 details button comes as a pair, **LINK** and **JUSS**, in the companies' colours:
- **Candidate page:** 💬 Thank-you **LINK | JUSS** and 🎉 Day 1 details **LINK | JUSS**. Under them, "📱 Text" / "✉️ Email" switch both buttons to that way of sending.
- **Thank everyone 💬:** **LINK | JUSS** on every row (Fiza's list is every appointment, LINK and JUSS). Tap, send, come back, next one. "📱 Text instead" switches that row.
- **Lists and Chase:** 🎉 Day 1 **LINK | JUSS**.

One tap opens WhatsApp (or their texts / email) with **that company's** message: wording, magazine, hearts, welcome page, pre-coaching (LINK), Google Maps pin, signed with the sender's own name. The company they tap is saved on the candidate, so everything after it follows (the welcome page they open, the welcome email, the Day 1 reminder), even when someone else sends it. Anyone else (Angad, Satpal, bookers) keeps one Send button, which follows the last choice, else the booker's company. **Pay, lists and reminders always follow the booker's company.**

To add someone to the recruitment team: add their email to `RECRUIT_TEAM` in Code.gs, and add them as a "Send mail as" address (below) so they can send welcome emails.

### Who sent it, and when
Every send is recorded: **who** tapped it, **when**, **as LINK or JUSS**, and **how** (WhatsApp / text / email).
- **Day 1 tab:** each starter shows "🎉 Day 1 details sent by Fiza Iqbal · Thu 15 Oct 16:03 · LINK · WhatsApp". Not sent yet = the red "Day 1 text not sent" pill.
- **Their page (tap them):** the same line at the top under "booked by", and **📨 Messages sent** in the Outcome section: thank-you, Day 1 details, welcome email, Day 1 reminder, each with who and when.
- If it's sent twice, the **latest** send shows (every send is still in the **Log** tab).
- Sends from before this went live are filled in once from the Log (who and how). Their company shows as the one on file.
- It records the **tap** that opens WhatsApp with the message ready. WhatsApp doesn't tell the app whether they then hit send.

### Thinking it over / No answer: follow-ups
- **Thinking it over:** pick **when they asked to be called back** (In 1 hour · Today 6pm · Tomorrow 12pm · Tomorrow 6pm · another day and time). It can't be saved without one. At that time, whoever logged it gets **"🔁 Call Pooja back now"** on their phone (once). Their pill shows **🔁 Call back Fri 16 Oct 18:00** (red once it's overdue), and their page has **🔁 Send "speak soon" + call-back time**: *"Take your time to think it over. As agreed, I'll call you back on Friday 16th October at 6:00 PM… call or text me on this number."*
- **No answer:** **📞 Send "we tried calling you"**: *"…call or text me back on this number"*. On their page and on the list card.
- Both are signed by **whoever sends them** (it's their number the candidate calls back), in the candidate's company (LINK / JUSS). Jess, Rubal and Fiza get **LINK | JUSS** buttons for both, like the thank-you and Day 1 details.

### Call log: every response, who and when
The Outcome section shows the **📞 Call log**: every response logged on the call (No answer, Thinking it over, Academy booked…), newest first, each with **who**, **day and time**, **LATE** if after Friday 18:00, the Day 1 date and the notes. One response = the usual "Logged Thu 15 Oct 16:35 by Fiza Iqbal" line. An admin rejecting an Academy booking shows as "Not suitable · Academy booking rejected". Responses logged before this went live are rebuilt once from the Log (saved in the `outcome_log` column).

### Welcome emails: one-time setup (whoever owns the Apps Script, usually Angad, on a computer)
The app sends through the script owner's Gmail, so that Gmail has to be allowed to send as both addresses:
1. In that Gmail: ⚙️ → **See all settings** → **Accounts** → **Send mail as** → **Add another email address**.
2. Name `Jess Grace`, email `jess@linkmarketing.org.uk`, untick **Treat as an alias** → **Next**. Google emails a code to that inbox: Jess reads it to you → **Verify**.
3. Do the same for `Rubal Oshan`, `rubal@jussmarketing.co.uk`. If Gmail asks for an SMTP server (a different Google account): server `smtp.gmail.com`, port `587`, username `rubal@jussmarketing.co.uk`, password = an **app password** Rubal makes at myaccount.google.com → Security → App passwords (needs 2-Step Verification on). Then the code goes to Rubal's inbox.
   And again for `Fiza Iqbal`, `recruitment@jussmarketing.co.uk` (same SMTP steps, with an app password made on that account).
4. In Apps Script: pick **setupWelcomeEmail** in the function menu → **Run** → approve the Gmail permission. The log shows ✅ ready (or ❌ and what's missing) for each address.
5. **Deploy → Manage deployments → ✏️ → New version** (as for any code change). The app picks it up within 10 minutes.

### Keeping welcome emails out of spam
- **In the app (already on):** the email asks them to reply **GOT IT** (a reply is the strongest "not spam" signal, and you know it arrived). Once it's sent, tap **💬 Heads-up** on the card: a WhatsApp (or text) saying *"just emailed your starter pack from rubal@…, check Spam / Promotions, tap Not spam, reply GOT IT"*, with the **FieldIQ download link** in it, so the one must-do before Day 1 never depends on the email.
- **Emojis (fixed 20 Oct):** Google garbled emojis like 🎉 📅 🔥 into "������", which looks like spam. Every email's HTML now goes to Google as plain ASCII (`server/email.js`), so they arrive intact.
- **DKIM on both domains (free, about 15 minutes each, Google Admin + whoever runs your DNS).** Checked 14 Oct 2026 from real emails: SPF ✅ and DMARC ✅ (policy *quarantine*) on both, but:
  - `jussmarketing.co.uk`: DKIM **fails** (Rubal's and Satpal's emails, from Outlook and iPhone). Found 20 Oct: DNS has **two** `google._domainkey` TXT records that differ by one character (`GlW7i9` vs `GIw7i9`, a typing slip), so receivers can't tell which key is real. Delete both and add the one Google Admin generates (below).
  - `linkmarketing.org.uk`: DKIM is Google's default, **not your domain's**.
  - So DMARC passes on SPF alone. Any forwarded email (old Hotmail / uni address forwarding to Gmail) fails it and gets quarantined: **spam**.
  - Fix, per domain: admin.google.com → Apps → Google Workspace → Gmail → **Authenticate email** → pick the domain → **Generate new record** (2048-bit) → add it at your DNS host as a TXT record named `google._domainkey` → wait an hour → **Start authentication**. Check: send an email to a Gmail address → ⋮ → **Show original** → DKIM: `PASS` with your domain.
- **Before the first real one:** send a welcome email to the address mail-tester.com gives you (free). It scores it out of 10 and names anything wrong.

**Day 1 tab:** **🚀 To onboard · N** lists everyone still to do. Each starter shows *Not on Databyte / Welcome email to send / Onboarded*.

**Who sees it:** admins only. Bookers never see the card, and the Google side refuses them too.

**Changing the email:** the links, numbers, playbooks, sending addresses (`from`) and wording are in `ONBOARD` and `onboardEmail` at the top of `Code.gs`. The Sheet keeps `recruit_source`, `databyte_at/by` and `onboard_email_at/by`.

## Bookers' other names (team members, their company)
Some bookers recruit under other names: a team member ("Daniel Thompson"), their company ("Stones Recruitment"), or both ("Sophie - Skye Promotions"). Candidates type whichever name they know.

- **Set them:** Team → tap the booker → **Other names they use**, one per line → **Save**. Check-ins from the last 2 weeks that typed any of them are credited to that booker straight away ("Saved ✓ 3 check-ins … now credited").
- **At check-in:** the other names appear as suggestions, so typing "Skye" offers "Sophie - Skye Promotions". If a candidate just types a name, the app credits the booker it clearly means:
  - an exact name ("Daniel Thompson", "MSA", "Amin");
  - a name inside what they typed ("Sophie from Skye Promotions");
  - a first name only one booker uses ("Daniel"; "Amin Musa" → Amin);
  - a small typo ("Linas Rakaukas").
- **If two bookers fit** (e.g. "Ali": Ali Milad or Ali Abbas), nobody is guessed. Jess and Rubal get the **❓ No booker** alert and pick.
- **Credit follows automatically:** bulletin, recruitment incentive, the booker's alerts, Chase. The candidate page shows *(they said "Daniel Thompson")* so you can see why, and the Log has an `auto_booker` line for each one.
- **One name, one booker:** a name already used by someone else is refused. Adding a new person whose name is someone's other name asks *"Same person?"*.
- Stored in the **Users** tab, column `aliases`, separated by `|`.

## Not on WhatsApp?
Every WhatsApp button has **Not on WhatsApp? 📱 Text · ✉️ Email** under it: the same message, sent from your own phone's texts or email. Once someone texts or emails a candidate, the app remembers **📵 Not on WhatsApp**, so the next person (e.g. the booker sending Day 1 details) gets a **Text** button instead.

## Rules built in (top of `Code.gs`)
- **Net attended:** Mon–Fri, **rated by the presenter**, 18+, eligible to work self-employed, not seen in the last **6 months**, not removed by admin. Target 5.
- **Check-ins outside 07:00–17:00 still go through**, but admins see an amber "outside office hours" flag. Combined with "presenter must rate them", nobody can be checked in from home for the incentive.
- **Outcome deadline Friday 18:00** (the thank-you WhatsApp promises candidates a call "by close of business Friday 6PM"). Later outcomes are accepted and marked LATE.
- **Made a mistake in the evaluation?** The candidate scans the evaluation QR again → **✏️ Change my answers** (same day, until their booker logs the call). The booker gets a push.
- **Busy moments, slow Google, no signal:** a candidate's screen never waits. "You're checked in", "Thank you" (evaluation) and "You're locked in" (Confirm) show the instant they tap. What they sent is kept on their phone and delivered in the background: it retries by itself, and again the next time they open any of our pages. If Google turns a check-in down, they're put back on the form with everything still filled in and the reason. The welcome link carries their first name and Day 1 date, so it opens straight away; Maps, Calendar and Pre-Coaching are warmed up before they tap.
- **Presenter RED / previously rejected** → admin decides before the Academy message unlocks.
- **Who sees what:** admins see everyone in full; a booker sees their own candidates in full. A presenter in the room sees everyone else's **name, who booked them and the room rating only**: no phone, email, right to work, evaluation answers or outcome.
- **GDPR, as the check-in page promises:** full details for **12 weeks**, then trimmed to the basics (name, contact, result, what the incentive needs). Evaluation answers, the convictions answer and presenter notes are wiped. Everything is deleted after **6 months** (= the repeat-candidate window). The conviction answer is admin-only.

## Changing something later
Apps Script: edit → Save → **Deploy → Manage deployments → ✏️ → New version → Deploy**. The URL stays the same.
App screens: Claude edits `app/src`, runs `node app/build.js`, and pushes. Vercel updates in about a minute after the merge.
