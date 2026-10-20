// The office robot's webhooks (Twilio: WhatsApp / texts; ElevenLabs: calls). See server/robot.js.
'use strict';
const { waitUntil } = require('@vercel/functions');
const { runtime } = require('../server/live');
const { robotRequest } = require('../server/robot');

module.exports = async (req, res) => {
  const rt = await runtime();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return robotRequest(req, res, {
    call: (fn, ...args) => rt.call(fn, ...args),
    later: waitUntil,
    base: 'https://' + host,
    cronSecret: process.env.CRON_SECRET,
    live: async () => (await rt.withDb(q => q("select 1 from jl.props where key = 'VERCEL_LIVE'"))).length > 0,
  });
};
// Signatures are checked on the exact bytes Twilio and ElevenLabs sent
module.exports.config = { api: { bodyParser: false } };
