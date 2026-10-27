# Hyrre messages in our style (drafts, NOT loaded into Hyrre)

Angad, 27 Oct 2026: Hyrre keeps sending its own texts and emails for now. These are our versions, in the style of the app's
booking messages (punchy, emoji-led, signed, "In association with JUSS Marketing Ltd", no hearts), ready for the team to load
into Hyrre when it's ready: Slough pipeline → Settings → **Candidate Comms** → the event → custom body.

- `{curly}` words are Hyrre's own placeholders. Hyrre fills them in.
- **Texts stay plain.** One emoji makes a text cost a credit per 70 characters instead of per 160, so a text with emojis costs
  2–3 credits instead of 1. The emojis go in the emails.
- Hyrre's emails don't do WhatsApp's `*bold*`, so there's none here.
- Who signs them: "The JUSS Marketing Recruitment Team" for now. If they should be signed by Rubal, change that line.
- The address and map link are the ones the app's booking messages use. Hyrre's `{location}` is the Slough pipeline's address.

---

## 1. Confirmation (Hyrre event: **Approval**, sent when Rubal approves)

**Email subject:** `You're booked in: {date} at {time} 🎉`

**Email:**
```
Hey {candidate_first_name}! 👋

You're booked in for your Appointment Presentation 🎉

📅 {date} · {time}
⏱️ Approximately 60–90 minutes

📍 Where
JUSS Marketing, 2nd Floor East
Automotive House, Grays Place, Slough SL2 5AF
🗺️ https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A
🚗 Parking right outside the main entrance
🚆 By train? Exit Slough station from platform 5

👔 Dress code: office wear / smart casual
📄 Documents: none needed yet 🙌

Can't make it? Pick another day here: {rebook_url}
Questions before then? Call or text {recruiter_phone} 💬

Kind regards,
The JUSS Marketing Recruitment Team
In association with JUSS Marketing Ltd
```

**Text (plain, 1 credit):**
```
Hi {candidate_first_name}, you're booked in! JUSS Marketing presentation {date} at {time}, Automotive House, Grays Place, Slough SL2 5AF. Arrive 10 mins early.
```

## 2. Evening reminder (Hyrre event: **Reminder**; the email goes 12 hours before, the text 1 hour before)

**Email subject:** `Tomorrow's the day: {time} at JUSS Marketing 🙌`

**Email:**
```
Hey {candidate_first_name}! 👋

Tomorrow's the day! 🙌
Your Appointment Presentation with JUSS Marketing

📅 {date} · {time}
📍 Automotive House, Slough (2 mins from the station)
🗺️ https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A

⏰ Aim to arrive 10 minutes early
👔 Office wear / smart casual

Something come up? Pick another day: {rebook_url}

See you tomorrow! 🔥

Kind regards,
The JUSS Marketing Recruitment Team
In association with JUSS Marketing Ltd
```

**Text (1 hour before, plain, 1 credit):**
```
Hi {candidate_first_name}, see you in {time_to_start} at JUSS Marketing, Automotive House, Grays Place, Slough SL2 5AF. Running late? Text {recruiter_phone}
```

## 3. Sorry we missed you (Hyrre event: **Absent rebook**, sent when someone's marked absent with Shift + click)

**Email subject:** `We missed you today. Let's rebook 📅`

**Email:**
```
Hey {candidate_first_name}! 👋

We missed you at your Appointment Presentation today 😕 Everything OK?

Your spot isn't gone: let's get you rebooked 📅
We run presentations Monday to Friday at 10:00 AM.

👉 Pick the day that suits you: {rebook_url}

Questions? Call or text {recruiter_phone} 💬

Kind regards,
The JUSS Marketing Recruitment Team
In association with JUSS Marketing Ltd
```

**Text (plain, 1 credit; Hyrre has this one switched off today, email only):**
```
Hi {candidate_first_name}, we missed you at today's JUSS Marketing presentation. Your spot isn't gone: pick a new day here {rebook_url}
```
