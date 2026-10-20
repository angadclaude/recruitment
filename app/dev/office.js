// The office robot, end to end, with pretend Twilio / ElevenLabs / Anthropic / Teamtailor (server/fakenet.js): nobody is
// called or messaged. Applicants arrive, get called, answer (or don't), get WhatsApps / texts, book, get reminders, check in.
// Usage: node app/build.js && node app/dev/office.js <screenshot-dir>   (own dev server on :8790; JL_BACKEND=pg for Supabase)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8790, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const SHOTS = process.argv[2] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(r => server.stdout.on('data', d => { if (/dev server/.test(String(d))) r(); }));
process.on('exit', () => server.kill());

const post = (p, b, headers) => fetch(BASE + p, { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b), headers: headers || {} }).then(r => r.text().then(t => { try { return JSON.parse(t); } catch (e) { return { status: r.status, text: t }; } }));
const getJson = p => fetch(BASE + p).then(r => r.json());
const ev = js => post('/dev/eval', { js }).then(r => r.out);
const run = (fn, ...args) => post('/dev/run', { fn, args }).then(r => r.out);
async function api(token, action, payload) {
  const r = await post('/api', Object.assign({ action, token }, payload || {}));
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r.data;
}
async function apiErr(token, action, payload) { const r = await post('/api', Object.assign({ action, token }, payload || {})); return r.ok ? '' : r.error; }
async function login(email) {
  await api('', 'requestCode', { email });
  const m = (await getJson('/dev/mail')).filter(x => x.to === email && /login code/.test(x.subject)).pop();
  return (await api('', 'verifyCode', { email, code: m.subject.match(/(\d{6})/)[1] })).token;
}
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); };
let NOW = 0;
const setTime = async iso => { NOW = new Date(iso).getTime(); await post('/dev/time', { iso }); };
const tick = () => fetch(BASE + '/api/robot-tick').then(r => r.json());
const reqs = async () => JSON.parse(await ev('JSON.stringify(__net.reqs)'));
const since = async n => (await reqs()).slice(n);
const sent = list => list.filter(x => x.to === 'twilio' && /Messages\.json$/.test(x.url)).map(x => x.body);
const ap = async (token, mobile) => (await api(token, 'robotList')).items.filter(a => a.mobile === mobile)[0];
const full = (token, id) => api(token, 'robotGet', { id });

// Webhooks, signed exactly as Twilio and ElevenLabs sign them
const TW_TOKEN = 'tw-test-token-123', EL_SECRET = 'wsec_test_secret', INIT = () => ev("PropertiesService.getScriptProperties().getProperty('ROBOT_INIT_KEY')");
function form(o) { return Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&'); }
function twSig(url, params, tok) { return crypto.createHmac('sha1', tok || TW_TOKEN).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64'); }
async function twilioIn(params, query, badSig) {
  const p = '/api/robot?h=' + (query || 'msg'), url = BASE + p;
  return post(p, form(params), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': badSig ? 'nope' : twSig(url, params) });
}
const text = (mobile, body, wa) => twilioIn(Object.assign({ From: (wa ? 'whatsapp:' : '') + '+44' + mobile.slice(1), To: '+447311027272', Body: body, MessageSid: 'SM' + Math.random(), NumMedia: '0' }, wa ? { ProfileName: 'WA Name', WaId: '44' + mobile.slice(1) } : {}));
async function elevenHook(type, data, opts) {
  const raw = JSON.stringify({ type, event_timestamp: Math.floor(NOW / 1000), data });
  const t = Math.floor(NOW / 1000) - ((opts && opts.age) || 0);
  const sig = 't=' + t + ',v0=' + crypto.createHmac('sha256', (opts && opts.secret) || EL_SECRET).update(t + '.' + raw).digest('hex');
  return post('/api/robot?h=voice', raw, { 'content-type': 'application/json', 'elevenlabs-signature': sig });
}
function callResult(conv, dc, opts) {
  const o = opts || {};
  return { agent_id: 'agent_test', conversation_id: conv, status: 'done',
    transcript: o.transcript || [{ role: 'agent', message: 'Hi, is that you?' }, { role: 'user', message: 'Yes, hi' }, { role: 'agent', message: 'Lovely' }],
    metadata: { call_duration_secs: o.secs || 150, termination_reason: '' },
    analysis: { call_successful: 'success', transcript_summary: o.summary || 'Answered the questions and chose a presentation.',
      data_collection_results: Object.fromEntries(Object.keys(dc).map(k => [k, { data_collection_id: k, value: dc[k] }])) },
    conversation_initiation_client_data: { dynamic_variables: o.dyn || {} } };
}

(async () => {
  await ready;
  console.log('office robot' + (process.env.JL_BACKEND === 'pg' ? ' (Supabase back end)' : ''));
  await run('setup');
  await post('/dev/props', { ONESIGNAL_APP_ID: 'test-app', ONESIGNAL_API_KEY: 'test-key' });
  await setTime('2026-10-19T09:30:00+01:00');  // Monday morning
  const admin = await login('angad@linkmarketing.org.uk');
  const users = (await api(admin, 'listUsers')).users, idOf = e => users.find(u => u.email === e).id;
  const JESS = idOf('jess@linkmarketing.org.uk'), RUBAL = idOf('rubal@jussmarketing.co.uk');
  const pushesTo = async id => (await getJson('/dev/pushes')).filter(p => p.body.include_aliases.external_id.includes(id));
  const booker = await api(admin, 'saveUser', { user: { name: 'Bea Booker', email: 'bea@example.com', company: 'LINK', roles: ['booker'], active: true } });
  const bea = await login('bea@example.com');

  // ── Off until an admin switches it on; only admins and the recruitment team see it ──
  let L = await api(admin, 'robotList');
  ok(L.cfg.mode === 'off' && L.cfg.name === 'Ava' && L.cfg.company === 'JUSS' && L.items.length === 0, 'starts Off: nobody is called or messaged until an admin switches it on');
  ok((await tick()).off === true, 'the every-minute timer does nothing while it\'s Off');
  ok(/admins and the recruitment team/.test(await apiErr(bea, 'robotList')), 'a booker can\'t see the applicants (admins and the recruitment team only)');
  ok(/Admin only/.test(await apiErr(bea, 'robotSettings', { cfg: { mode: 'live' } })), 'only an admin can switch it on');
  ok((await api(admin, 'me')).robot.name === 'Ava' && (await api(bea, 'me')).robot === null, 'the app knows who gets the Applicants page');
  ok(/at least one presentation day/.test(await apiErr(admin, 'robotSettings', { cfg: { days: [] } })) && /must be a UK mobile/.test(await apiErr(admin, 'robotSettings', { cfg: { number: '0123' } })), 'settings are checked (presentation days, a UK mobile for the robot)');

  // ── Setting up the voice: the agent, its number, the signed webhooks ──
  ok(/ElevenLabs key/.test(await apiErr(admin, 'robotSetupVoice')), 'setting up the voice needs the ElevenLabs key in Vercel first');
  await post('/dev/props', { ELEVENLABS_API_KEY: 'el-test', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: TW_TOKEN, TEAMTAILOR_API_KEY: 'tt-test' });
  await api(admin, 'robotSettings', { cfg: { mode: 'test', number: '07311 027272' } });
  let n0 = (await reqs()).length;
  const sv = await api(admin, 'robotSetupVoice');
  const svr = await since(n0);
  const agent = svr.find(x => /agents\/create/.test(x.url)).body, cs = agent.conversation_config, ps = agent.platform_settings;
  ok(sv.agentId === 'agent_test' && sv.phoneId === 'phnum_test' && (await api(admin, 'robotList')).cfg.agent, 'set up the voice: agent created, the number connected, saved');
  ok(svr.some(x => /workspace\/webhooks/.test(x.url) && x.body.settings.auth_type === 'hmac' && /api\/robot\?h=voice$/.test(x.body.settings.webhook_url)) &&
    svr.some(x => /convai\/settings/.test(x.url) && /api\/robot\?h=init$/.test(x.body.conversation_initiation_client_data_webhook.url) && x.body.conversation_initiation_client_data_webhook.request_headers['X-Robot-Key']),
    'call results come back signed (HMAC), and inbound calls ask the app who\'s ringing (with a key only ElevenLabs has)');
  ok(svr.some(x => /IncomingPhoneNumbers\/PN0000\.json/.test(x.url) && /api\/robot\?h=msg$/.test(x.body.SmsUrl)), 'texts to the number come to the app');
  ok(cs.agent.first_message === '{{opening}}' && cs.agent.prompt.built_in_tools.voicemail_detection && cs.agent.prompt.built_in_tools.end_call && cs.agent.prompt.timezone === 'Europe/London',
    'the voice opens with a line the app writes per call, leaves a short voicemail, hangs up itself, on London time');
  const script = cs.agent.prompt.prompt;
  ok(/self-employed/.test(script) && /presentation/.test(script) && /Never promise or guarantee earnings/.test(script) && /£400 to £600 a week/.test(script) && /choose their own days/.test(script) && /Never tell anyone they are rejected/.test(script),
    'its script is self-employed (choose your days, a presentation, typical £400–£600 commission-only, no guarantees) and it never turns anyone down');
  ok(['age', 'se', 'days', 'commute', 'want', 'why', 'slot', 'slot_day', 'call_back', 'not_interested', 'no_calls', 'wants_person', 'reached_voicemail'].every(k => ps.data_collection[k]) &&
    ps.privacy.retention_days === 84, 'after each call ElevenLabs notes the answers and the day chosen; recordings kept 12 weeks like everything else');

  // ── Test mode: only people added by hand ──
  await ev("__net.tt.push({ id: 900, cand: 500, first: 'Tina', last: 'Teamtailor', phone: '+447700900500', email: 'tina@example.com', job: '23' })");
  await tick();
  ok(!(await api(admin, 'robotList')).items.length && !(await reqs()).some(x => x.to === 'teamtailor'), 'Test mode: Teamtailor isn\'t touched, nobody from it is called');
  const me1 = await api(admin, 'robotAddOne', { full_name: 'angad tester', mobile: '07700 900001', email: 'a@example.com' });
  ok(me1.status === 'new' && me1.full_name === 'Angad Tester' && me1.mobile === '07700900001' && me1.source === 'manual', 'add someone by hand (Angad\'s own phone to try it)');
  ok((await api(admin, 'robotAddOne', { full_name: 'Angad Tester', mobile: '07700900001' })).existed, 'adding the same mobile again finds the same person');

  // ── 1. The call: answered, all 6 questions, picks a presentation → booked, WhatsApp / text with the address ──
  n0 = (await reqs()).length;
  let t = await tick();
  const dial = (await since(n0)).find(x => /outbound-call/.test(x.url));
  const dv = dial.body.conversation_initiation_client_data.dynamic_variables;
  ok(t.called === 1 && dial.body.to_number === '+447700900001' && dial.body.agent_id === 'agent_test' && dial.body.agent_phone_number_id === 'phnum_test', 'within a minute the robot rings them from the office number');
  ok(/^Hi, is that Angad\? It's Ava, the AI assistant at JUSS Marketing, calling about your Brand Ambassador application\. This call is recorded\./.test(dv.opening),
    'it opens by saying it\'s an AI assistant, who for, and that the call is recorded');
  ok(dv.slot_1 === 'Tuesday 20th October at 10am' && dv.slot_2 === 'Wednesday 21st October at 10am' && dv.slot_3 === 'Thursday 22nd October at 10am', 'it offers the next presentations (Mon–Fri 10am, from the next day)');
  let a1 = await full(admin, me1.id);
  ok(a1.status === 'calling' && a1.tries === '1' && a1.calls[0].conv, 'they show as "On a call now"');
  ok((await tick()).called === 0, 'never two calls to the same person at once');
  // A forged result is ignored
  await elevenHook('post_call_transcription', callResult(a1.calls[0].conv, { age: 'yes', se: 'yes', days: '5', commute: 'yes', slot: 2 }), { secret: 'wrong' });
  await elevenHook('post_call_transcription', callResult(a1.calls[0].conv, { age: 'yes' }), { age: 3600 });
  ok((await full(admin, me1.id)).status === 'calling', 'a call result without ElevenLabs\' signature (or over 30 minutes old) is ignored');
  n0 = (await reqs()).length;
  await elevenHook('post_call_transcription', callResult(a1.calls[0].conv, { age: 'yes', se: 'yes', days: '5', commute: 'yes', want: 'Flexible work', why: 'I love talking to people', slot: 2, slot_day: 'Wednesday 21st October' }));
  a1 = await full(admin, me1.id);
  let out = sent(await since(n0));
  ok(a1.status === 'booked' && a1.slot === '2026-10-21 10:00' && a1.answers.days === '5' && a1.answers.want === 'Flexible work', 'the call booked them for the day they chose, with their answers saved');
  ok(out.length === 1 && out[0].To === '+447700900001' && out[0].From === '+447311027272' && /^You're booked in, Angad! Your presentation is on Wednesday 21st October at 10am \(about 1 hour 15 minutes\)\./.test(out[0].Body) &&
    /Automotive House, Grays Place, Slough SL2 5AF/.test(out[0].Body) && /business smart casual/.test(out[0].Body) && /[^\x0A\x0D\x20-\x7E£]/.test(out[0].Body) === false,
    'they get the booking straight away from the office number: day, time, address, business smart casual (plain characters: one text, not four)');
  ok(a1.calls[0].res === 'answered' && /chose a presentation/.test(a1.calls[0].sum) && /Them: Yes, hi/.test(a1.calls[0].tr), 'the call\'s summary and what was said are on their record');
  n0 = (await reqs()).length;
  await elevenHook('post_call_transcription', callResult(a1.calls[0].conv, { age: 'yes', se: 'yes', days: '5', commute: 'yes', slot: 2 }));
  ok(!sent(await since(n0)).length, 'the same result twice (a retry) changes nothing and sends nothing');

  // ── 2. Reminders, confirming by reply, checking in ──
  await setTime('2026-10-20T18:05:00+01:00');
  n0 = (await reqs()).length; await tick(); out = sent(await since(n0));
  ok(out.length === 1 && /^Hi Angad, see you tomorrow at 10am at JUSS Marketing/.test(out[0].Body) && /Reply YES to confirm/.test(out[0].Body), 'the evening before (18:00): a reminder');
  n0 = (await reqs()).length; await tick();
  ok(!sent(await since(n0)).length, 'only once');
  n0 = (await reqs()).length;
  await text('07700900001', 'Yes!');
  a1 = await full(admin, me1.id); out = sent(await since(n0));
  ok(a1.confirmed_at && out.length === 1 && /See you on Wednesday 21st October at 10am/.test(out[0].Body), 'they reply YES: confirmed (no AI needed for that)');
  await setTime('2026-10-21T08:05:00+01:00');
  n0 = (await reqs()).length; await tick(); out = sent(await since(n0));
  ok(out.length === 1 && /^Morning Angad! See you today at 10am/.test(out[0].Body), 'the morning of (08:00): see you today');
  await setTime('2026-10-21T09:52:00+01:00');
  const p0 = (await pushesTo(RUBAL)).length;
  const ci = await api('', 'checkin', { form: { full_name: 'Angad Tester', mobile: '07700900001', email: 'a@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true } });
  const cand = await api(admin, 'getCandidate', { id: ci.id });
  a1 = await full(admin, me1.id);
  ok(cand.booked_via === 'robot' && cand.company === 'JUSS' && cand.recruit_source === 'Office Recruitment' && a1.status === 'attended' && a1.candidate_id === ci.id,
    'they check in with the QR code as normal: linked to the robot\'s booking, an Office Recruitment for JUSS (nobody earns the incentive)');
  ok(cand.flags.some(f => f.level === 'green' && /office robot/.test(f.text)) && !cand.flags.some(f => /Booker not confirmed/.test(f.text)), 'no "booker not confirmed" warning for a robot booking');
  const rp = (await pushesTo(RUBAL)).slice(p0);
  ok(rp.some(p => /Angad just checked in/.test(p.body.headings.en) && /booked by Ava/.test(p.body.contents.en)) && !rp.some(p => /No booker/.test(p.body.headings.en)), 'Jess and Rubal hear they\'re in (not "No booker")');
  ok(!(await api(admin, 'payReport', { weekEnding: '2026-10-25' })).unassigned.some(x => x.id === ci.id), 'and they\'re not on the incentive page as "needs a booker"');

  // ── 3. No answer: voicemail, a WhatsApp / text to do it by message, the questions by chat, booked ──
  await setTime('2026-10-21T12:00:00+01:00');
  const b = await api(admin, 'robotAddOne', { full_name: 'Bob Missed', mobile: '07700900002' });
  await tick();
  let b1 = await full(admin, b.id);
  n0 = (await reqs()).length;
  await elevenHook('call_initiation_failure', { agent_id: 'agent_test', conversation_id: b1.calls[0].conv, failure_reason: 'no-answer', metadata: { type: 'twilio', body: { CallStatus: 'no-answer' } } });
  b1 = await full(admin, b.id); out = sent(await since(n0));
  ok(b1.status === 'new' && b1.next_at === '2026-10-21 14:00' && b1.calls[0].res === 'no answer', 'no answer: try again in 2 hours');
  ok(out.length === 1 && /^Hi Bob, it's Ava, the AI assistant at JUSS Marketing\. I just tried to call about your Brand Ambassador application\. Shall we do it here instead\?/.test(out[0].Body) && /are you 18 or over\?/.test(out[0].Body),
    'and a message: do it here instead (first question straight away), or reply CALL ME');
  const say = async (m, body, wa) => { const k = (await reqs()).length; await text(m, body, wa); return sent(await since(k)).map(x => x.Body).join(' | '); };
  ok(/allowed to be self-employed in the UK\?/.test(await say('07700900002', 'yes')), 'they reply by message: the robot asks the next question (no Claude key: plain rules)');
  b1 = await full(admin, b.id);
  ok(b1.status === 'chat' && !b1.next_at, 'chatting now: no more calls unless they ask');
  ok(/choose your days/.test(await say('07700900002', 'Yes I am')), 'self-employed: yes → days');
  ok(/get to our office in Slough\?/.test(await say('07700900002', '5 days')), '5 days → getting to Slough');
  ok(/looking for in your next role\?/.test(await say('07700900002', 'yep')), 'yes → what are you looking for');
  ok(/made you apply for a sales role\?/.test(await say('07700900002', 'Something with good money')), '→ why sales');
  const choose = await say('07700900002', 'I like people');
  ok(/That's everything I need! Your first appointment is a presentation at our Slough office/.test(choose) && /1\) Thu 22 Oct, 10am/.test(choose) && /3\) Mon 26 Oct, 10am/.test(choose),
    'then the presentation options (weekdays only: Thursday, Friday, then Monday)');
  ok(/You're booked in, Bob! Your presentation is on Friday 23rd October at 10am/.test(await say('07700900002', '2')), 'they reply 2 → booked for Friday, details sent');
  b1 = await full(admin, b.id);
  ok(b1.status === 'booked' && b1.answers.want === 'Something with good money' && b1.thread.filter(x => x.d === 'in').length === 7, 'their whole chat is on their record');
  ok(/1\) Thu 22 Oct/.test(await say('07700900002', 'Can I change the day please')) && !/Fri 23/.test((await full(admin, b.id)).thread.filter(x => x.d === 'out').pop().t),
    'they ask to change the day: other days (not the one they have)');
  ok(/booked in, Bob! Your presentation is on Thursday 22nd October/.test(await say('07700900002', '1')), 'moved to Thursday');

  // ── 4. A "no" goes to Jess and Rubal: the robot never turns anyone down ──
  const c = await api(admin, 'robotAddOne', { full_name: 'Cara Visa', mobile: '07700900003' });
  await tick();
  let c1 = await full(admin, c.id);
  const pj = (await pushesTo(JESS)).length;
  await elevenHook('post_call_transcription', callResult(c1.calls[0].conv, { age: 'yes', se: 'unsure', days: '', commute: 'unknown' }));
  c1 = await full(admin, c.id);
  const jp = (await pushesTo(JESS)).slice(pj);
  ok(c1.status === 'person' && /Not sure they can be self-employed/.test(c1.flag) && jp.some(p => /Needs you: Cara Visa/.test(p.body.headings.en)) && (await pushesTo(RUBAL)).some(p => /Needs you: Cara Visa/.test(p.body.headings.en)),
    'not sure about self-employment (visa?): handed to Jess and Rubal with an alert, never rejected by the robot');
  const d = await api(admin, 'robotAddOne', { full_name: 'Dan Twodays', mobile: '07700900004' });
  await ev("__net.fail.push('+447700900004')");  // the call won't go
  await setTime('2026-10-21T12:30:00+01:00'); await tick();
  let d1 = await full(admin, d.id);
  ok(d1.status === 'new' && d1.tries === '0' && d1.next_at === '2026-10-21 12:45' && /didn't go/.test(d1.thread.pop().t), 'a call that couldn\'t be placed is tried again in 15 minutes (not counted as a try)');
  await ev("__net.fail.splice(0)");
  ok(/allowed to be self-employed/.test(await say('07700900004', 'Yes')) && /choose your days/.test(await say('07700900004', 'yes')), 'they message first instead: straight into the questions');
  const pr = (await pushesTo(RUBAL)).length;
  await say('07700900004', '2');
  d1 = await full(admin, d.id);
  ok(d1.status === 'person' && /Wants 2 days a week/.test(d1.flag) && /Someone from our team will message you shortly/.test(d1.thread.filter(x => x.d === 'out').pop().t) &&
    (await pushesTo(RUBAL)).slice(pr).some(p => /Needs you: Dan Twodays/.test(p.body.headings.en)), 'fewer than 4 days: "someone from our team will message you", and Jess / Rubal decide');
  n0 = (await reqs()).length;
  await text('07700900004', 'Ok thanks');
  ok(!sent(await since(n0)).length && (await pushesTo(RUBAL)).some(p => /Dan Twodays messaged the office number/.test(p.body.headings.en)), 'while they\'re with a person, the robot stays quiet and the team is told about new messages');
  // Take over / hand back / message as the office
  d1 = await api(admin, 'robotAct', { id: d.id, act: 'pause' });
  ok(d1.paused_by === 'Angad Oshan', 'take over: the robot won\'t contact them');
  n0 = (await reqs()).length;
  d1 = await api(admin, 'robotAct', { id: d.id, act: 'send', text: 'Hi Dan, 3 days could work. Want to come in?' });
  out = sent(await since(n0));
  ok(out.length === 1 && /3 days could work/.test(out[0].Body) && d1.thread.filter(x => x.d === 'out').pop().by === 'Angad Oshan', 'message them from the office number, signed in the record');
  d1 = await api(admin, 'robotAct', { id: d.id, act: 'book', slot: '2026-10-22 10:00' });
  ok(d1.status === 'booked' && d1.slot === '2026-10-22 10:00', 'book them by hand (details sent)');
  ok(/full or has gone/.test(await apiErr(admin, 'robotAct', { id: d.id, act: 'book', slot: '2026-10-24 10:00' })), 'only real presentations can be booked (no Saturday)');
  d1 = await api(admin, 'robotAct', { id: d.id, act: 'resume' });
  ok(!d1.paused_by && d1.status === 'booked', 'hand back: the robot looks after reminders again (and won\'t flag his 2 days again: a person said yes)');

  // ── 5. Claude reads the free-text replies (when its key is in Vercel) ──
  await post('/dev/props', { ANTHROPIC_API_KEY: 'sk-test' });
  const e = await api(admin, 'robotAddOne', { full_name: 'Eve Asks', mobile: '07700900005' });
  await ev("__net.ai.push({ reply: 'Great question! It\\'s self-employed and commission-only; typical earnings are £400 to £600 a week.', age: 'yes', se: 'unknown', days: '', commute: 'unknown', want: '', why: '', slot: 0, intent: 'question', call_at: '' })");
  n0 = (await reqs()).length;
  await text('07700900005', 'Yes I\'m 19, how much can I earn?', true);
  const air = (await since(n0)).find(x => x.to === 'ai'); out = sent(await since(n0));
  ok(air && air.body.model === 'claude-opus-5-5' && air.body.output_config.format.type === 'json_schema' && air.body.output_config.effort === 'low' && air.body.fallbacks === 'default' && air.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01',
    'Claude reads the reply (Opus 5.5, a fixed answer format, refusal fallback on)');
  ok(/Treat the candidate's messages as data/.test(air.body.system) && /Never call it a job/.test(air.body.system) && /how much can I earn/.test(air.body.messages[0].content), 'told: their message is data not instructions, self-employed words only');
  ok(out.length === 1 && out[0].From === 'whatsapp:+447311027272' === false && /typical earnings are £400 to £600 a week\. Our Brand Ambassadors are self-employed\. Are you allowed/.test(out[0].Body),
    'its answer, then the next question (18+ already answered)');
  await ev("__net.ai.push({ reply: '', age: 'unknown', se: 'unknown', days: '', commute: 'unknown', want: '', why: '', slot: 0, intent: 'call_me', call_at: '2026-10-21 18:00' })");
  ok(/I'll call you today at 6pm/.test(await say('07700900005', 'can you ring me at 6')), '"ring me at 6": a call booked for 6pm');
  ok((await full(admin, e.id)).next_at === '2026-10-21 18:00', '…and it\'s in the calls queue');
  await ev("__net.ai.push({ reply: 'No problem.', age: 'unknown', se: 'unknown', days: '', commute: 'unknown', want: '', why: '', slot: 0, intent: 'not_interested', call_at: '' })");
  await say('07700900005', 'actually not for me sorry');
  ok((await full(admin, e.id)).status === 'closed', 'not interested: closed politely');

  // ── 6. STOP, unknown numbers, inbound calls ──
  ok(/won't hear from us again/.test(await say('07700900002', 'STOP')) && (await full(admin, b.id)).status === 'stopped', 'STOP: confirmed once, then nothing');
  ok(!(await say('07700900002', 'hello?')), 'nothing more after STOP');
  ok(/Thanks/.test(await say('07700900002', 'START') || 'Thanks') && (await full(admin, b.id)).status === 'booked', 'START: back on (still booked)');
  const pu = (await pushesTo(JESS)).length;
  await text('07700900099', 'Hi is this the office? I left my charger', true);
  const unk = await ap(admin, '07700900099');
  ok(unk && unk.source === 'inbound' && unk.status === 'person' && (await pushesTo(JESS)).slice(pu).some(p => /messaged the office number/.test(p.body.headings.en)) , 'someone not on the list messages the office number: Jess and Rubal see it, the robot doesn\'t answer');
  const key = await INIT();
  const r401 = await post('/api/robot?h=init', JSON.stringify({ caller_id: '+447700900002' }), { 'x-robot-key': 'guess' });
  ok(r401.error === 'no' && !r401.dynamic_variables, 'inbound call lookup: refused without ElevenLabs\' key');
  const iv = await post('/api/robot?h=init', JSON.stringify({ caller_id: '+447700900002', called_number: '+447311027272', agent_id: 'agent_test', call_sid: 'CA1', conversation_id: 'conv_in1' }), { 'x-robot-key': key });
  ok(iv.type === 'conversation_initiation_client_data' && /^Hi Bob, it's Ava, the AI assistant at JUSS Marketing\. This call is recorded\. Are you calling about your presentation on Thursday 22nd October at 10am\?/.test(iv.dynamic_variables.opening),
    'Bob rings the number back: the robot knows him and his booking');
  const iv2 = await post('/api/robot?h=init', JSON.stringify({ caller_id: '+447700900777', conversation_id: 'conv_in2' }), { 'x-robot-key': key });
  ok(/you've reached JUSS Marketing in Slough/.test(iv2.dynamic_variables.opening) && iv2.dynamic_variables.slot_1 !== 'none', 'a stranger rings: the robot answers for the office and can still book them');
  await elevenHook('post_call_transcription', callResult('conv_in2', { caller_name: 'kim newbie', message_for_team: 'Wants to know about parking' }));
  const kim = await ap(admin, '07700900777');
  ok(kim.full_name === 'Kim Newbie' && kim.status === 'person' && /Rang the office number/.test(kim.flag), 'after the call: their name and message go to Jess and Rubal');

  // ── 7. Live: new Teamtailor applicants (only the robot's jobs), tagged so the team doesn't call them too ──
  await api(admin, 'robotSettings', { cfg: { mode: 'live', ttJobs: '23' } });
  await ev("__net.tt.splice(0); __net.tt.push({ id: 901, cand: 501, first: 'Tia', last: 'Applies', phone: '07700900011', email: 'tia@example.com', job: '23' }, { id: 902, cand: 502, first: 'Ola', last: 'Otherjob', phone: '+447700900012', email: 'ola@example.com', job: '99' }, { id: 903, cand: 503, first: 'No', last: 'Phone', phone: '12', email: 'np@example.com', job: '23' })");
  n0 = (await reqs()).length;
  t = await tick();
  const ttr = await since(n0);
  const tia = await ap(admin, '07700900011'), np = (await api(admin, 'robotList')).items.find(a => a.full_name === 'No Phone');
  ok(t.added === 2 && tia && tia.source === 'teamtailor' && tia.job === 'Brand Ambassador - Slough' && !(await ap(admin, '07700900012')), 'live: new Teamtailor applicants arrive (only the jobs it handles)');
  ok(np.status === 'person' && /No valid UK mobile/.test(np.flag), 'no usable mobile: straight to Jess and Rubal');
  const ttGet = ttr.find(x => x.to === 'teamtailor' && /job-applications/.test(x.url));
  ok(ttGet.headers.Authorization === 'Token token=tt-test' && ttGet.headers['X-Api-Version'] === '20240904' && /filter%5Bcreated-at%5D%5Bfrom%5D=/.test(ttGet.url) && /include=candidate%2Cjob/.test(ttGet.url), 'Teamtailor is asked properly (Admin key, pinned API version, only new applications)');
  ok(ttr.some(x => /outbound-call/.test(x.url) && x.body.to_number === '+447700900011') && JSON.stringify(await ev('JSON.stringify(__net.tags)')).includes('Contacted by Ava (robot)') && JSON.parse(await ev('JSON.stringify(__net.tags)'))['501'].includes('Existing'),
    'called straight away, and tagged "Contacted by Ava (robot)" in Teamtailor (their other tags kept)');
  await ev("__net.tt.push({ id: 901, cand: 501, first: 'Tia', last: 'Applies', phone: '07700900011', job: '23' })");
  t = await tick();
  ok(t.added === 0, 'the same application twice is ignored');

  // ── 8. 3 calls over 2 days, then Jess and Rubal ──
  let tia1 = await full(admin, tia.id);
  for (let i = 1; i <= 3; i++) {
    if (i > 1) { await setTime(tia1.next_at.replace(' ', 'T') + ':00+01:00'); await tick(); tia1 = await full(admin, tia.id); }
    await elevenHook('post_call_transcription', callResult(tia1.calls[tia1.calls.length - 1].conv, { reached_voicemail: true }, { transcript: [{ role: 'agent', message: 'Hi, is that Tia?', tool_calls: [{ tool_name: 'voicemail_detection' }] }] }));
    tia1 = await full(admin, tia.id);
  }
  ok(tia1.status === 'no_reply' && tia1.tries === '3' && /No answer after 3 calls/.test(tia1.flag) && tia1.calls.every(k => k.res === 'voicemail'), '3 calls (2 hours apart, then the next day), all voicemail: handed to Jess and Rubal');
  ok(tia1.thread.filter(x => x.d === 'out').length === 1, 'only one "we missed you" message, not three');

  // ── 9. No-shows, a sweep for lost call results, messages that bounce ──
  await setTime('2026-10-22T11:31:00+01:00');  // Thursday: Dan was booked for 10am and didn't check in
  await tick();
  d1 = await full(admin, d.id);
  ok(d1.status === 'no_show' && d1.thread.some(x => x.d === 'out' && /^Sorry we missed you today, Dan\. Would another day suit you\?/.test(x.t)), 'didn\'t turn up: "sorry we missed you, another day?"');
  ok(/booked in, Dan/.test(await say('07700900004', '1')), 'they reply 1: rebooked');
  const f1 = await api(admin, 'robotAddOne', { full_name: 'Finn Lost', mobile: '07700900006' });
  await tick();
  let ff = await full(admin, f1.id);
  await ev("__net.convs['" + ff.calls[0].conv + "'] = " + JSON.stringify(callResult(ff.calls[0].conv, { age: 'yes', se: 'yes', days: '4', commute: 'yes', slot: 1 })));
  await setTime('2026-10-22T11:50:00+01:00'); await tick();
  ff = await full(admin, f1.id);
  ok(ff.status === 'booked' && ff.slot === '2026-10-23 10:00', 'a call result that never arrived is fetched from ElevenLabs 15 minutes later (nobody gets stuck "on a call")');
  await api(admin, 'robotSettings', { cfg: { wa: true } });
  await text('07700900006', 'thanks!', true);  // opens the 24-hour WhatsApp window
  n0 = (await reqs()).length;
  await api(admin, 'robotAct', { id: f1.id, act: 'send', text: 'See you tomorrow Finn' });
  const waMsg = sent(await since(n0))[0];
  ok(waMsg.From === 'whatsapp:+447311027272' && waMsg.To === 'whatsapp:+447700900006' && /h=status&a=/.test(waMsg.StatusCallback), 'WhatsApp approved: inside the 24-hour window, messages go by WhatsApp');
  n0 = (await reqs()).length;
  const cb = new URL(waMsg.StatusCallback);
  await twilioIn({ MessageSid: 'SMx', MessageStatus: 'undelivered', ErrorCode: '63024', From: 'whatsapp:+447311027272', To: 'whatsapp:+447700900006' }, cb.search.slice(3));
  out = sent(await since(n0)); ff = await full(admin, f1.id);
  ok(out.length === 1 && out[0].From === '+447311027272' && /See you tomorrow Finn/.test(out[0].Body) && ff.wa === 'no', 'not on WhatsApp after all: sent again as a text, and texts from now on');
  n0 = (await reqs()).length;
  await twilioIn({ MessageSid: 'SMy', MessageStatus: 'undelivered', ErrorCode: '63024' }, cb.search.slice(3), true);
  ok(!sent(await since(n0)).length, 'a forged bounce (no Twilio signature) is ignored');
  const g = await api(admin, 'robotAddOne', { full_name: 'Gus Outside', mobile: '07700900007' });
  await api(admin, 'robotAct', { id: g.id, act: 'pause' });
  n0 = (await reqs()).length;
  await api(admin, 'robotAct', { id: g.id, act: 'send', text: 'Hello Gus' });
  ok(sent(await since(n0))[0].From === '+447311027272', 'outside the 24-hour window with no approved template: a text instead (WhatsApp would refuse it)');
  ok(/HX|robotSettings/.test(await apiErr(admin, 'robotSettings', { cfg: { tpl: { booked: 'not-an-id' } } })) || !(await api(admin, 'robotList')).cfg.tpl.booked, 'only real template IDs are kept');
  await api(admin, 'robotSettings', { cfg: { tpl: { booked: 'HX' + 'a1'.repeat(16) } } });
  n0 = (await reqs()).length;
  await api(admin, 'robotAct', { id: g.id, act: 'book', slot: '2026-10-23 10:00' });
  const tm = sent(await since(n0))[0];
  ok(tm.From === 'whatsapp:+447311027272' && tm.ContentSid === 'HX' + 'a1'.repeat(16) && !tm.Body && JSON.parse(tm.ContentVariables)['1'] === 'Gus' && JSON.parse(tm.ContentVariables)['2'] === 'Fri 23 Oct, 10am',
    'with Meta\'s approved "booked" message: WhatsApp outside the window too, with their name and the day filled in');

  // ── 10. The day's summary, closing, GDPR ──
  await setTime('2026-10-22T17:31:00+01:00');
  const ps0 = (await pushesTo(RUBAL)).length;
  await tick(); await tick();
  const sum = (await pushesTo(RUBAL)).slice(ps0).filter(p => /Ava today/.test(p.body.headings.en));
  ok(sum.length === 1 && /booked/.test(sum[0].body.headings.en) && /Need you:/.test(sum[0].body.contents.en), '17:30: Jess and Rubal get the robot\'s day, once');
  const g1 = await api(admin, 'robotAct', { id: g.id, act: 'close', reason: 'Wrong number' });
  ok(g1.status === 'closed' && /Wrong number \(Angad Oshan\)/.test(g1.closed_reason), 'close someone (wrong number, not suitable…)');
  ok((await api(admin, 'robotAct', { id: g.id, act: 'reopen' })).status === 'booked', 'and reopen (still booked for Friday)');
  await setTime('2027-01-25T03:00:00+00:00');  // 13+ weeks later
  await run('dailyMaintenance');
  const tr = await full(admin, me1.id);
  ok(!tr.thread.length && !Object.keys(tr.answers).length && !tr.email && tr.calls.every(k => !k.tr && !k.sum) && tr.mobile === '07700900001', 'after 12 weeks: chats, answers and call transcripts wiped; name and mobile kept');
  await setTime('2027-05-01T03:00:00+01:00');
  await run('dailyMaintenance');
  ok((await api(admin, 'robotList')).items.length === 0, 'after 6 months: deleted');

  // ── 11. The Sheet copy leaves the chats out ──
  const { slim } = require('../../server/mirror');
  const sl = slim('Applicants', ['id', 'thread', 'calls', 'full_name'], [['x', '[{"t":"hi"}]', '[{"tr":"..."}]', 'Ann']]);
  ok(sl[0][1] === '' && sl[0][2] === '' && sl[0][3] === 'Ann' && slim('Log', ['a'], [['y'.repeat(50000)]])[0][0].length < 41000, 'the team\'s Sheet copy: no chats or transcripts, and no cell over Google\'s limit');

  // ── 12. The page itself (phone-sized) ──
  let chromium; try { chromium = require('playwright').chromium; } catch (e) { chromium = null; }
  if (chromium) {
    await setTime('2026-10-23T09:00:00+01:00');
    await api(admin, 'robotSettings', { cfg: { mode: 'test' } });
    const h = await api(admin, 'robotAddOne', { full_name: 'Hana Screen', mobile: '07700900008' });
    await text('07700900008', 'yes', false);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.clock.setSystemTime(new Date(NOW)).catch(() => {});
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    process.on('exit', () => { if (errs.length) console.log('page errors:', errs.join('\n')); });
    await p.goto(APP + 'index.html');
    await p.click('#doors button[data-door=admin]');
    await p.fill('#em', 'jess@linkmarketing.org.uk'); await p.click('#go');
    await p.waitForSelector('#codeBox:not([hidden])');
    const m = (await getJson('/dev/mail')).filter(x => x.to === 'jess@linkmarketing.org.uk' && /login code/.test(x.subject)).pop();
    await p.fill('#code', m.subject.match(/(\d{6})/)[1]); await p.click('#go');
    await p.waitForSelector('.tabbar button');
    await p.waitForSelector('#robotBtn');
    await p.click('#robotBtn');
    await p.waitForSelector('#apF');
    await p.click('#apF .chip[data-f=all]');
    await p.waitForSelector('.item[data-ap="' + h.id + '"]');
    await p.screenshot({ path: SHOTS + '/robot-list.png' });
    ok(await p.$('text=Test: only people you add'), 'Applicants page: who\'s where, Test / Live shown');
    await p.click('.item[data-ap="' + h.id + '"]');
    await p.waitForSelector('.chat .bub.in');
    await p.screenshot({ path: SHOTS + '/robot-person.png', fullPage: true });
    ok(await p.$('text=Their answers') && await p.$('.bub.out') && await p.$('#apSend'), 'one person: answers, calls, the chat, and buttons to take over, book or message');
    await p.goBack(); await p.waitForSelector('#apSet');
    await p.click('#apSet'); await p.waitForSelector('#rsSave');
    await p.screenshot({ path: SHOTS + '/robot-settings.png', fullPage: true });
    ok(await p.$('text=WhatsApp approved by Meta'), 'settings: on/off, name, presentation times, calling hours, the number, WhatsApp');
    await browser.close();
  } else console.log('  (Playwright not found: page checks skipped)');

  console.log('\nOFFICE ROBOT: ALL CHECKS PASSED');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
