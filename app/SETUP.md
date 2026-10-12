# Setting up the Recruitment App (about 20 minutes, one time)

Everything runs inside your Google account: no new accounts, no monthly fees.
Data sits in a private Google Sheet that only you can open. Nobody else needs access to the Sheet; everyone uses the app.

> **Tip:** Do this on a laptop, logged into the Google account the alert emails should come from
> (e.g. `angad@linkmarketing.org.uk`, or a shared `recruitment@` account if you have one).

---

## Step 1. Create the Sheet
1. Go to **sheets.new**.
2. Name it **Recruitment App — DO NOT EDIT**.

## Step 2. Paste in the app
1. In the Sheet: **Extensions → Apps Script**. A new tab opens.
2. You'll see a file called `Code.gs`. Delete what's in it and paste in everything from [`src/Code.gs`](src/Code.gs).
3. Add five HTML files. For each one, click **＋ → HTML**, type the name exactly as shown (without `.html`), delete what's inside, and paste the file's contents:

   | Name to type | Paste from |
   |---|---|
   | `Index` | [`src/Index.html`](src/Index.html) |
   | `Styles` | [`src/Styles.html`](src/Styles.html) |
   | `JS` | [`src/JS.html`](src/JS.html) |
   | `Logos` | [`src/Logos.html`](src/Logos.html) |
   | `QR` | [`src/QR.html`](src/QR.html) |

4. Click the ⚙️ **Project Settings** cog (left side) and set **Time zone → (GMT+00:00) London**.
5. Click 💾 **Save**.

## Step 3. Run setup (creates the tabs, the 4 admins and the reminders)
1. Back in the editor (`< >` icon), in the dropdown at the top choose **`setup`** and click **▶ Run**.
2. Google asks for permission. Click **Review permissions**, choose your account, then **Advanced → Go to project (unsafe) → Allow**.
   *(It says "unsafe" only because you wrote the app yourself rather than Google checking it.)*
3. Wait for "Execution completed". Your Sheet now has the tabs `Users, Candidates, History, Codes, Sessions, Log`.

## Step 4. Bring in the last 12 months from the old form (for repeat candidates)
1. In the dropdown choose **`importHistory`** → **▶ Run**.
2. It copies name, mobile, email and booker from **Evaluation form → Form Responses 1** (last 12 months only) into the `History` tab.

## Step 5. Publish the app
1. Top right: **Deploy → New deployment**.
2. Click the ⚙️ next to "Select type" → **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. *(Candidates have no Google login, so this has to be "Anyone". Staff still log in with an emailed code.)*
4. **Deploy** → copy the **Web app URL** (ends in `/exec`).

You now have **two links**:

| Who | Link |
|---|---|
| **Staff** (admins, presenters, bookers) | your URL + `?app=staff` (e.g. `https://script.google.com/macros/s/AKfy…/exec?app=staff`) |
| **Candidates** | Don't share a link. They scan the **QR code** the presenter shows. It changes every day, so nobody can check in from home. |

## Step 6. Add your team
1. Open the **staff link** on your phone → enter your email → type the 6-digit code from your inbox.
2. Go to **👥 Team → + Add person**: name, email, **LINK or JUSS** (this decides which welcome message they send) and access:
   - **Booker**: sees only their own candidates, logs outcomes, sends WhatsApps
   - **Presenter**: today's list, notes, stars, opens evaluations
   - **Admin**: everything, plus adding and removing people
3. Send each person the staff link and tell them: *"Open it → Share → **Add to Home Screen**."* It then works like an app.

Angad, Jess, Satpal and Rubal are already admins.

---

## Daily routine
1. **Presenter**: open the app → **Today → 📷 Show check-in QR** on the room screen or laptop.
2. Candidates scan it and check in (about a minute). They appear on the presenter's list straight away.
3. During the talk: tap each name → **In the room ✅**, Green/Amber/Red, ★1–5, tags, notes → **Save**.
4. End of the talk: tap **✅ Presentation finished — open evaluations**. The form appears on every candidate's phone automatically.
5. **Booker** gets an email the moment an evaluation lands → opens the one-page snapshot → calls → logs the outcome → taps **🎉 Send BA Academy Day 1 details** (WhatsApp opens with the LINK or JUSS message ready, then they just hit send).

## Automatic emails (free, sent through your Gmail)
| When | Who | What |
|---|---|---|
| The moment an evaluation is submitted | the booker | "📋 X's evaluation is in — call them" + link |
| A booker books a 🔴 candidate | all admins | "Needs your decision" |
| Wed + Fri 10:00 | every booker | "You're on 3/5 net attended this week" |
| Sat 14:00 | bookers with calls outstanding | "⚠️ 2 outcomes to log by 19:00" |
| Mon 09:00 | admins | last week's pay report |
| Every night 02:00 | — | deletes anything older than 12 months (GDPR) |

## The rules built in (change any of them at the top of `Code.gs`)
- **Net attended** (pay): Mon–Fri, **confirmed in the room by the presenter**, 18+, eligible to work self-employed (Tier 4, Skilled Worker, asylum-pending and needs-sponsorship don't count), not a repeat within 12 months, and not removed by an admin (e.g. failed share code). Target **5**.
- **Outcome deadline: Saturday 19:00.** Outcomes logged on Sunday are accepted but marked **LATE**, and the pay report shows each booker's late count.
- **Presenter marks RED** → the booker can't send the Academy message until an admin approves.
- **Rejected in the last 12 months and comes back** → red banner "do not progress", and admin decides.
- **Conviction answer**: only admins see it.

## Changing something later
Edit the code in Apps Script → **Save** → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The links stay the same.

## Good to know
- People outside your Google Workspace may see a small grey Google banner at the top ("created by a Google Apps Script user"). That's normal.
- Pages take 1–2 seconds to load. Google's free hosting is slower than a paid server.
- Bookers on iPhone may occasionally need to log in again (Safari clears logins inside embedded pages). It's a 10-second email code.
- WhatsApp links can't attach the poster image. The message contains the full Week 1 schedule as text instead. Bookers can still forward the poster if they want.
- Gmail sending limit is 1,500 emails/day on Google Workspace. You'll use about 50.
