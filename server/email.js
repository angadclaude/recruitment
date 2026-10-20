// Emails on their way to Google's relay. Google garbles emojis outside the basic set: 🎉 📅 📍 🔥 arrived as "������" in
// the welcome email (20 Oct; ✅ ⚡ ⏰ ✨ were fine). So the HTML goes as plain ASCII, every other character written as
// &#…; (the email looks exactly the same). The subject and plain text are left as they are.
'use strict';

/** Every character outside plain ASCII as a numeric HTML entity (whole emojis, not their halves). */
function asciiHtml(html) {
  return String(html).replace(/[^\x00-\x7E]/gu, ch => '&#' + ch.codePointAt(0) + ';');
}

/** A queued email (MailApp { via: 'mail', msg } or GmailApp { via: 'gmail', opts }) with its HTML made safe. */
function emailSafe(m) {
  if (!m) return m;
  if (m.via === 'mail' && m.msg && m.msg.htmlBody) return Object.assign({}, m, { msg: Object.assign({}, m.msg, { htmlBody: asciiHtml(m.msg.htmlBody) }) });
  if (m.via === 'gmail' && m.opts && m.opts.htmlBody) return Object.assign({}, m, { opts: Object.assign({}, m.opts, { htmlBody: asciiHtml(m.opts.htmlBody) }) });
  return m;
}

module.exports = { asciiHtml, emailSafe };
