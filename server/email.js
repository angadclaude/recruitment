// Emails on their way to Google's relay. Google garbles emojis outside the basic set: 🎉 📅 📍 🔥 arrived as "������" in
// the welcome email (20 Oct; ✅ ⚡ ⏰ ✨ were fine). So the HTML goes as plain ASCII, every other character written as
// &#…; (the email looks exactly the same). A subject or plain text can't use &#…;, so those emojis are left out there:
// the Friday team roundup arrived as "������ Team week: 46 appointments · 15 booked" (23 Oct, 📋).
'use strict';

/** Every character outside plain ASCII as a numeric HTML entity (whole emojis, not their halves). */
function asciiHtml(html) {
  return String(html).replace(/[^\x00-\x7E]/gu, ch => '&#' + ch.codePointAt(0) + ';');
}

/** A subject or plain text without the emojis Google garbles (outside the basic set: 📋 🎉 📞 go, ✅ ⚠️ ❌ ⏰ stay). */
function plainSafe(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/[\u{10000}-\u{10FFFF}][\uFE0F\u200D]*/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
}

/** A queued email (MailApp { via: 'mail', msg } or GmailApp { via: 'gmail', opts }) made safe: HTML, subject and plain text. */
function emailSafe(m) {
  if (!m) return m;
  if (m.via === 'mail' && m.msg) {
    const x = Object.assign({}, m.msg, { subject: plainSafe(m.msg.subject), body: plainSafe(m.msg.body) });
    if (x.htmlBody) x.htmlBody = asciiHtml(x.htmlBody);
    return Object.assign({}, m, { msg: x });
  }
  if (m.via === 'gmail') {
    const g = Object.assign({}, m, { subject: plainSafe(m.subject), body: plainSafe(m.body) });
    if (m.opts && m.opts.htmlBody) g.opts = Object.assign({}, m.opts, { htmlBody: asciiHtml(m.opts.htmlBody) });
    return g;
  }
  return m;
}

module.exports = { asciiHtml, plainSafe, emailSafe };
