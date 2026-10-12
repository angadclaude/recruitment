# Setting up the Recruitment App (about 25 minutes, one time)

**How it fits together:**

| Piece | What it does | Cost |
|---|---|---|
| **Google Sheet + Apps Script** | Stores the data (private) and runs the rules, logins and alerts | £0 |
| **GitHub Pages** (this repo, already on) | Hosts the app people open: the slide QR codes, welcome pages, staff app | £0 |
| **OneSignal** | Sends the phone push notifications | £0 (free plan) |

Your app's address: **https://angadclaude.github.io/recruitment/join/**

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

### A4. Import the last 12 months (for repeat candidates)
Choose **`importHistory`** → **▶ Run**.

### A5. Publish
**Deploy → New deployment → ⚙️ → Web app** → Execute as **Me**, Who has access **Anyone** → **Deploy**.
Copy the **Web app URL** (ends in `/exec`). You need it in B2.

*(Only using Google, without the GitHub web address? Set `PUBLIC_URL: ''` in Code.gs and also add the HTML files `Index`, `Styles`, `JS`, `Logos` and `QR` from `src/`.)*

---

## Part B. GitHub: the app people open (5 min)

### B1. Put the app live
The app lives in the `join/` folder on the `recruitment-app` branch. GitHub Pages publishes `main`, so merge the branch into `main`. *(Ask Claude to open the pull request, then click **Merge**.)*
Then check **repo → Settings → Pages → Source: Deploy from a branch → `main` / root**.

### B2. Connect it to Google
Open [`join/config.js`](../join/config.js) on GitHub → ✏️ edit → paste the URL from A5 between the quotes on `API_URL:` → **Commit**.
*(Or just send Claude the URL.)*

---

## Part C. OneSignal: phone notifications (10 min)

1. Sign up free at **onesignal.com** (click the link in OneSignal's confirmation email) → **New App** → name it *LINK × JUSS Recruitment* → choose **Web**.
2. **Typical Site** setup:
   - Site name: `Recruitment` · Site URL: `https://angadclaude.github.io`
   - Default icon: upload [`assets/icon-192.png`](assets/icon-192.png)
   - **Advanced → Service worker:** path `/recruitment/join/`, filename `OneSignalSDKWorker.js`, scope `/recruitment/join/`
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

1. Open **https://angadclaude.github.io/recruitment/join/** → log in with your email and the 6-digit code.
2. **👥 Team → + Add person** for every booker and presenter: name, email, **LINK or JUSS**, access.
3. Send everyone the link with this message:

> 📲 Our new recruitment app is live. Open https://angadclaude.github.io/recruitment/join/ → log in with your email.
> **iPhone:** tap Share ⎋ → *Add to Home Screen* → open it from the icon → tap **Turn on** for alerts.
> **Android:** Chrome menu ⋮ → *Install app* → tap **Turn on** for alerts.

**iPhone users must open it from the home-screen icon.** Apple only allows notifications for web apps added to the home screen (iOS 16.4+).

**Check each person before they leave the room:** tap their initials (top right). It must say **Alerts: on ✅**. If it says anything else, that line tells you what's wrong. Anyone who isn't on gets alerts by email only. Once a week, compare OneSignal → **Audience → Subscriptions** with the Team list.

## Part E. The slides
Put the two QR codes on the presentation once. They never change:
- **First slide:** [`docs/qr-1-checkin.png`](docs/qr-1-checkin.png) → check-in
- **Last slide:** [`docs/qr-2-evaluation.png`](docs/qr-2-evaluation.png) → evaluation

(Also downloadable any time from **Team → 📲 QR codes for the presentation slides**.)

---

## Daily routine
1. Candidates scan the **check-in QR** on the first slide. The booker gets a push: *"🙌 Jasraj just checked in"*.
2. **Presenter** taps each name on their phone → Green/Amber/Red, ★1–5, tags, notes. **Rating someone confirms they were in the room** (that's what counts for pay).
3. Last slide: candidates scan the **evaluation QR**. Same phone → straight in. Different phone → they type their mobile. Missed check-in → they check in there and then.
4. **Booker** gets *"📋 Jasraj's evaluation is in"* → one-page snapshot → call → log outcome → tap **🎉 Send BA Academy Day 1 details**.
5. Candidate taps the link in WhatsApp → their **personal welcome page** (Week 1 plan, poster, directions, add to calendar) → taps **🔒 Confirm I'm coming** → booker gets *"✅ Jasraj confirmed Day 1!"*
6. **Admins, end of day:** **Today → 📣 Today's bulletin → 📤 Share to WhatsApp**. The stats poster is built from the app: attended, non-qualifiers and top performers, on the same rules as Pay. On Fridays it adds the weekly total; tap **🏆 Week top 5** for the leaderboard. **✏️ Edit wording** lets you change the messages, tag someone as (BAR), and change the Mission / Plan numbers or the cash amount.

## Push alerts
| When | Who |
|---|---|
| Candidate checks in | their booker |
| Evaluation submitted | their booker |
| Candidate confirms Day 1 | their booker |
| Booker books a 🔴 candidate | all admins |
| Wed + Fri 10:00: "3/5 net attended" | every booker |
| Mon–Thu 18:00: your day (who came in, evaluations) + who still needs closing, sending Day 1 details or confirming | every booker who had appointments (nothing to say = no message) |
| **Fri 15:00 week roundup:** appointments, who's booked, who's not, no outcome yet, who's been sent the Day 1 WhatsApp (and who hasn't), net vs target | every booker who had appointments |
| **Fri 15:00 team roundup:** the same, one line per booker, loose ends first | admins |
| Sat 14:00: "2 outcomes due by 19:00" | bookers with calls outstanding |
| Mon 09:00: pay report ready | admins |

## Rules built in (top of `Code.gs`)
- **Net attended:** Mon–Fri, **rated by the presenter**, 18+, eligible to work self-employed, not seen in the last **6 months**, not removed by admin. Target 5.
- **Check-ins outside 07:00–17:00 still go through**, but admins see an amber "outside office hours" flag. Combined with "presenter must rate them", nobody can be checked in from home for pay.
- **Outcome deadline Saturday 19:00.** Sunday outcomes are accepted and marked LATE.
- **Presenter RED / previously rejected** → admin decides before the Academy message unlocks.
- **12-month auto-delete** (GDPR). Conviction answer is admin-only.

## Changing something later
Apps Script: edit → Save → **Deploy → Manage deployments → ✏️ → New version → Deploy**. The URL stays the same.
App screens: Claude edits `app/src`, runs `node app/build.js`, and pushes. GitHub Pages updates in about a minute.
