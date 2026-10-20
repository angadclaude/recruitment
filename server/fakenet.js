// Tests only: pretend Twilio, ElevenLabs, Anthropic and Teamtailor for the office robot, so the whole journey runs with
// nobody called or texted. Used by app/dev/gas.js (Google back end) and server/worker.js in test mode (Supabase back end).
// The test drives it through `__net` in Code.gs's world (/dev/eval):
//   __net.reqs   every request made (newest last): { to: 'twilio' | 'eleven' | 'ai' | 'teamtailor', method, url, body }
//   __net.tt     Teamtailor applications to hand out on the next poll: { id, cand, first, last, phone, email, job, title, at }
//   __net.ai     Claude's next answers (objects); none queued = Claude "unavailable", so the plain rules are used
//   __net.convs  conversations ElevenLabs knows: id → the GET /conversations/{id} answer
//   __net.fail   numbers (+44…) whose texts / calls fail
'use strict';

function net(ctx) { return ctx.__net || (ctx.__net = { reqs: [], tt: [], ai: [], convs: {}, fail: [], tags: {}, n: 0 }); }
const ok = (o, code) => ({ code: code || 200, text: JSON.stringify(o) });

/** One request → { code, text }, or null when it isn't one of the robot's services. */
function robotFake(ctx, r) {
  const url = String(r.url || ''), method = String(r.method || 'get').toLowerCase(), N = net(ctx);
  let body = r.payload;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* form text */ } }
  const rec = to => { N.reqs.push({ to: to, method: method, url: url, body: body, headers: r.headers || {} }); N.n++; };
  if (/^https:\/\/api\.twilio\.com\//.test(url)) {
    rec('twilio');
    if (/IncomingPhoneNumbers\.json/.test(url)) return ok({ incoming_phone_numbers: [{ sid: 'PN0000' }] });
    if (/IncomingPhoneNumbers\//.test(url)) return ok({ sid: 'PN0000' });
    const to = String((body && body.To) || '').replace(/^whatsapp:/, '');
    if (N.fail.indexOf(to) >= 0) return ok({ code: 21211, message: 'The \'To\' number is not a valid phone number.' }, 400);
    return ok({ sid: 'SM' + N.n, status: 'queued' }, 201);
  }
  if (/^https:\/\/api\.elevenlabs\.io\//.test(url)) {
    rec('eleven');
    if (/\/twilio\/outbound-call$/.test(url)) {
      if (N.fail.indexOf(body.to_number) >= 0) return ok({ success: false, message: 'Call failed to start', conversation_id: null, callSid: null });
      return ok({ success: true, message: 'ok', conversation_id: 'conv_' + N.n, callSid: 'CA' + N.n });
    }
    const conv = /\/conversations\/([^/?]+)$/.exec(url);
    if (conv) return N.convs[conv[1]] ? ok(N.convs[conv[1]]) : ok({ detail: 'not found' }, 404);
    if (/\/agents\/create$/.test(url)) return ok({ agent_id: 'agent_test' });
    if (/\/workspace\/webhooks$/.test(url)) return ok({ webhook_id: 'wh_test', webhook_secret: 'wsec_test_secret' });
    if (/\/phone-numbers$/.test(url) && method === 'post') return ok({ phone_number_id: 'phnum_test' });
    return ok({});
  }
  if (/^https:\/\/api\.anthropic\.com\//.test(url)) {
    rec('ai');
    const next = N.ai.shift();
    if (!next) return ok({ type: 'error', error: { type: 'overloaded_error', message: 'test: no answer queued' } }, 529);
    return ok({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(next) }] });
  }
  if (/^https:\/\/api\.teamtailor\.com\//.test(url)) {
    rec('teamtailor');
    const cand = /\/candidates\/([^/?]+)$/.exec(url);
    if (cand && method === 'get') return ok({ data: { id: cand[1], type: 'candidates', attributes: { tags: N.tags[cand[1]] || ['Existing'] } } });
    if (cand && method === 'patch') { N.tags[cand[1]] = body.data.attributes.tags; return ok({ data: body.data }); }
    if (/\/job-applications/.test(url)) {
      const list = N.tt.splice(0);
      return ok({
        data: list.map(x => ({ id: String(x.id), type: 'job-applications', attributes: { 'created-at': x.at || new Date().toISOString() },
          relationships: { candidate: { data: { type: 'candidates', id: String(x.cand) } }, job: { data: { type: 'jobs', id: String(x.job || '23') } } } })),
        included: list.map(x => ({ id: String(x.cand), type: 'candidates', attributes: { 'first-name': x.first, 'last-name': x.last, phone: x.phone, email: x.email, tags: [] } }))
          .concat(list.map(x => ({ id: String(x.job || '23'), type: 'jobs', attributes: { title: x.title || 'Brand Ambassador - Slough' } }))),
        meta: { 'record-count': list.length }, links: {},
      });
    }
    return ok({});
  }
  return null;
}

module.exports = { robotFake, net };
